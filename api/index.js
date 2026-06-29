import { createRequire } from 'module';
import zlib from 'zlib';
import { promisify } from 'util';

const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);

export const config = {
    api: { bodyParser: false }
};

async function getRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    let start = 0;
    while (start < buffer.length) {
        const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
        if (boundaryIndex === -1) break;
        const headerStart = boundaryIndex + boundaryBuffer.length + 2;
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
        if (headerEnd === -1) break;
        const headerStr = buffer.slice(headerStart, headerEnd).toString();
        const dataStart = headerEnd + 4;
        const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
        const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2;
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        parts.push({
            name: nameMatch ? nameMatch[1] : '',
            filename: filenameMatch ? filenameMatch[1] : null,
            data: buffer.slice(dataStart, dataEnd)
        });
        start = nextBoundary === -1 ? buffer.length : nextBoundary;
    }
    return parts;
}

// ── PDF extractor with FlateDecode support ─────────────────────────────────
async function extractPdfText(buffer) {
    const latin = buffer.toString('latin1');
    let text = '';

    // Find all objects that contain streams
    const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
    let objMatch;

    while ((objMatch = objRegex.exec(latin)) !== null) {
        const obj = objMatch[1];

        // Only process objects that have streams
        const streamStart = obj.indexOf('stream');
        const streamEnd = obj.indexOf('endstream');
        if (streamStart === -1 || streamEnd === -1) continue;

        // Get the dict header (before the stream keyword)
        const dictPart = obj.slice(0, streamStart);

        // Skip non-page-content streams (images, fonts, etc.)
        const isImage = /\/Subtype\s*\/Image/i.test(dictPart);
        if (isImage) continue;

        // Check if FlateDecode compressed
        const isFlate = /\/Filter\s*\/FlateDecode/i.test(dictPart) ||
                        /\/Filter\s*\[.*?FlateDecode.*?\]/i.test(dictPart);

        // Raw stream bytes (skip "stream\r\n" or "stream\n")
        const streamKeyEnd = obj.indexOf('stream', streamStart) + 6;
        const afterKeyword = obj[streamKeyEnd] === '\r' ? streamKeyEnd + 2 : streamKeyEnd + 1;
        const rawLatin = obj.slice(afterKeyword, streamEnd);
        const streamBuf = Buffer.from(rawLatin, 'latin1');

        let decoded = streamBuf;
        if (isFlate) {
            try {
                decoded = await inflate(streamBuf);
            } catch {
                try { decoded = await inflateRaw(streamBuf); } catch { continue; }
            }
        }

        const streamStr = decoded.toString('latin1');
        text += extractTextFromContentStream(streamStr) + ' ';
    }

    return text.trim();
}

function extractTextFromContentStream(str) {
    let out = '';

    // BT...ET blocks
    const btRegex = /BT([\s\S]*?)ET/g;
    let btMatch;
    while ((btMatch = btRegex.exec(str)) !== null) {
        const block = btMatch[1];

        // (string) Tj  or  (string) TJ
        const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
        let m;
        while ((m = tjRegex.exec(block)) !== null) {
            out += decodePdfString(m[1]) + ' ';
        }

        // [(string) ...] TJ  — array form
        const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
        while ((m = tjArrayRegex.exec(block)) !== null) {
            const inner = m[1];
            const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
            let sm;
            while ((sm = strRegex.exec(inner)) !== null) {
                out += decodePdfString(sm[1]);
            }
            out += ' ';
        }

        // Td / TD / T* operators imply newlines
        if (/\bTd\b|\bTD\b|\bT\*\b/.test(block)) out += '\n';
    }

    return out;
}

function decodePdfString(s) {
    return s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
}

// ── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let topic = '';
    let cardCount = 8;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
        const rawBody = await getRawBody(req);
        const boundary = contentType.split('boundary=')[1];
        const parts = parseMultipart(rawBody, boundary);

        const filePart = parts.find(p => p.filename);
        const countPart = parts.find(p => p.name === 'cardCount');

        if (countPart) cardCount = parseInt(countPart.data.toString()) || 8;
        if (!filePart) return res.status(400).json({ error: 'No file found.' });

        const filename = filePart.filename.toLowerCase();

        try {
            if (filename.endsWith('.txt')) {
                topic = filePart.data.toString('utf-8');

            } else if (filename.endsWith('.docx')) {
                // Dynamic import works fine — the real issue was ESM/CJS interop.
                // Use createRequire for reliability on Vercel.
                const require = createRequire(import.meta.url);
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer: filePart.data });
                topic = result.value;

            } else if (filename.endsWith('.pdf')) {
                topic = await extractPdfText(filePart.data);
                if (!topic || topic.trim().length < 10) {
                    return res.status(400).json({
                        error: 'Could not extract text from this PDF. Try copying the text and pasting it directly instead.'
                    });
                }

            } else {
                return res.status(400).json({ error: 'Unsupported file. Use PDF, DOCX, or TXT.' });
            }
        } catch (parseErr) {
            return res.status(500).json({ error: 'Failed to read file.', details: parseErr.message });
        }

    } else {
        // JSON body — parse it manually since bodyParser is disabled
        const rawBody = await getRawBody(req);
        const body = JSON.parse(rawBody.toString('utf-8'));
        topic = body.topic;
        cardCount = body.cardCount || 8;
    }

    if (!topic || topic.trim().length < 5) {
        return res.status(400).json({ error: 'Not enough text extracted.' });
    }

    const trimmedTopic = topic.trim().slice(0, 6000);

    const prompt = `Create exactly ${cardCount} flashcards about this topic: "${trimmedTopic}"

Respond with ONLY a JSON array, nothing else. No explanation, no text before or after.
Format:
[{"question":"...","answer":"..."},{"question":"...","answer":"..."}]`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a flashcard generator. You only respond with valid JSON arrays. Never add any text before or after the JSON.'
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096,
                temperature: 0.3
            })
        });

        const data = await response.json();
        if (!data.choices || !data.choices[0]) {
            return res.status(500).json({ error: 'Bad Groq response', raw: data });
        }

        const text = data.choices[0].message.content.trim();

        // Strip markdown fences if present, then extract the JSON array
        // using a match instead of destructive regexes that can eat content
        const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
        const match = stripped.match(/\[[\s\S]*\]/);

        if (!match) {
            return res.status(500).json({
                error: 'AI returned unexpected format.',
                raw: text.slice(0, 500)  // surface enough to debug
            });
        }

        const flashcards = JSON.parse(match[0]);
        res.json({ success: true, deck: flashcards });

    } catch (error) {
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
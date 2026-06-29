import { createRequire } from 'module';
import zlib from 'zlib';
import { promisify } from 'util';

const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);

export const config = {
    api: { bodyParser: false }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Normalize text from any source: replace fancy Unicode chars with plain ASCII
function normalizeText(text) {
    return text
        .replace(/\u2018|\u2019/g, "'")   // curly single quotes
        .replace(/\u201C|\u201D/g, '"')   // curly double quotes
        .replace(/\u2013|\u2014/g, '-')   // en-dash, em-dash
        .replace(/\u2026/g, '...')         // ellipsis
        .replace(/\u00A0/g, ' ')           // non-breaking space
        .replace(/[^\x00-\x7F]/g, ' ')    // any remaining non-ASCII
        .replace(/\s+/g, ' ')              // collapse whitespace
        .trim();
}

// ── PDF extractor (handles FlateDecode compressed streams) ───────────────────

async function extractPdfText(buffer) {
    const latin = buffer.toString('latin1');
    let text = '';

    const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
    let objMatch;

    while ((objMatch = objRegex.exec(latin)) !== null) {
        const obj = objMatch[1];
        const streamStart = obj.indexOf('stream');
        const streamEnd = obj.indexOf('endstream');
        if (streamStart === -1 || streamEnd === -1) continue;

        const dictPart = obj.slice(0, streamStart);
        if (/\/Subtype\s*\/Image/i.test(dictPart)) continue;

        const isFlate = /\/Filter\s*\/FlateDecode/i.test(dictPart) ||
                        /\/Filter\s*\[.*?FlateDecode.*?\]/i.test(dictPart);

        const streamKeyEnd = obj.indexOf('stream', streamStart) + 6;
        const afterKeyword = obj[streamKeyEnd] === '\r' ? streamKeyEnd + 2 : streamKeyEnd + 1;
        const rawLatin = obj.slice(afterKeyword, streamEnd);
        const streamBuf = Buffer.from(rawLatin, 'latin1');

        let decoded = streamBuf;
        if (isFlate) {
            try { decoded = await inflate(streamBuf); }
            catch { try { decoded = await inflateRaw(streamBuf); } catch { continue; } }
        }

        text += extractTextFromContentStream(decoded.toString('latin1')) + ' ';
    }

    return text.trim();
}

function extractTextFromContentStream(str) {
    let out = '';
    const btRegex = /BT([\s\S]*?)ET/g;
    let btMatch;
    while ((btMatch = btRegex.exec(str)) !== null) {
        const block = btMatch[1];
        // Single string: (text) Tj
        const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
        let m;
        while ((m = tjRegex.exec(block)) !== null) {
            out += decodePdfString(m[1]) + ' ';
        }
        // Array form: [(text)] TJ
        const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
        while ((m = tjArrayRegex.exec(block)) !== null) {
            const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
            let sm;
            while ((sm = strRegex.exec(m[1])) !== null) {
                out += decodePdfString(sm[1]);
            }
            out += ' ';
        }
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

// ── Main handler ─────────────────────────────────────────────────────────────

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
                const require = createRequire(import.meta.url);
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer: filePart.data });
                topic = result.value;

            } else if (filename.endsWith('.pdf')) {
                topic = await extractPdfText(filePart.data);
                if (!topic || topic.trim().length < 10) {
                    return res.status(400).json({
                        error: 'Could not extract text from this PDF. Try pasting the text directly instead.'
                    });
                }

            } else {
                return res.status(400).json({ error: 'Unsupported file. Use PDF, DOCX, or TXT.' });
            }
        } catch (parseErr) {
            return res.status(500).json({ error: 'Failed to read file.', details: parseErr.message });
        }

    } else {
        const rawBody = await getRawBody(req);
        const body = JSON.parse(rawBody.toString('utf-8'));
        topic = body.topic;
        cardCount = body.cardCount || 8;
    }

    if (!topic || topic.trim().length < 5) {
        return res.status(400).json({ error: 'Not enough text extracted.' });
    }

    // Normalize all text to plain ASCII, then cap to 3000 chars
    const cleanTopic = normalizeText(topic).slice(0, 3000);

    const prompt = `Create exactly ${cardCount} flashcards about this topic: ${JSON.stringify(cleanTopic)}

Respond with ONLY a JSON array, nothing else. No explanation, no text before or after.
Keep each answer concise — 1-2 sentences max.
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
                        content: 'You are a flashcard generator. You only respond with valid JSON arrays. Keep each answer to 1-2 sentences. Never add any text before or after the JSON.'
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 8000,
                temperature: 0.3
            })
        });

        const data = await response.json();
        if (!data.choices || !data.choices[0]) {
            return res.status(500).json({ error: 'Bad Groq response', raw: data });
        }

        const choice = data.choices[0];

        if (choice.finish_reason === 'length') {
            return res.status(500).json({
                error: 'Response was cut off. Try fewer cards or a shorter document.'
            });
        }

        const text = choice.message.content.trim();
        const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
        const match = stripped.match(/\[[\s\S]*\]/);

        if (!match) {
            return res.status(500).json({ error: 'AI returned unexpected format.', raw: text.slice(0, 300) });
        }

        const flashcards = JSON.parse(match[0]);
        res.json({ success: true, deck: flashcards });

    } catch (error) {
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
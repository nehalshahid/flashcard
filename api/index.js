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

function normalizeText(text) {
    return text
        .replace(/\u2018|\u2019/g, "'")
        .replace(/\u201C|\u201D/g, '"')
        .replace(/\u2013|\u2014/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u00A0/g, ' ')
        .replace(/[^\x00-\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
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
        const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
        let m;
        while ((m = tjRegex.exec(block)) !== null) {
            out += decodePdfString(m[1]) + ' ';
        }
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

    try {
        if (contentType.includes('multipart/form-data')) {
            const rawBody = await getRawBody(req);
            const boundary = contentType.split('boundary=')[1];
            const parts = parseMultipart(rawBody, boundary);

            const filePart = parts.find(p => p.filename);
            const countPart = parts.find(p => p.name === 'cardCount');

            if (countPart) cardCount = parseInt(countPart.data.toString()) || 8;
            if (!filePart) return res.status(400).json({ error: 'No file found.' });

            const filename = filePart.filename.toLowerCase();

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

        } else {
            const rawBody = await getRawBody(req);
            const body = JSON.parse(rawBody.toString('utf-8'));
            topic = body.topic;
            cardCount = body.cardCount || 8;
        }
    } catch (parseErr) {
        return res.status(500).json({ error: 'Failed to process request data.', details: parseErr.message });
    }

    if (!topic || topic.trim().length < 5) {
        return res.status(400).json({ error: 'Not enough text extracted.' });
    }

    // Normalized and sliced safely to ~200 input tokens.
    const cleanTopic = normalizeText(topic).slice(0, 800);

    const prompt = `Create exactly ${cardCount} flashcards about this topic: ${JSON.stringify(cleanTopic)}

Respond with ONLY a JSON array, nothing else. No explanation, no text before or after.
Each answer must be detailed and thorough: fully explain the concept, state why it matters, and include a concrete example. Aim for 3-5 sentences per answer.
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
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a flashcard generator. You only respond with valid JSON arrays. Write detailed answers of 3-5 sentences each — explain the concept fully, state why it matters, and include a concrete example. Never add any text before or after the JSON.'
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 3500,
                temperature: 0.3
            })
        });

        const data = await response.json();
        
        // Handle explicit API/Rate Limit Errors safely instead of crashing
        if (data.error) {
            return res.status(500).json({ error: 'Groq API Error', details: data.error.message });
        }

        if (!data.choices || !data.choices[0]) {
            return res.status(500).json({ error: 'Bad Groq response', raw: data });
        }

        const choice = data.choices[0];

        if (choice.finish_reason === 'length') {
            return res.status(500).json({
                error: 'Response was cut off because the details were too long. Try requesting 1 or 2 fewer cards.'
            });
        }

        const text = choice.message.content.trim();
        const stripped = text.replace(/```json/gi, '').replace(/```/g, '');
        
        let flashcards = null;
        try {
            // AUTO-REPAIR: If it ends with a valid object but misses the closing array bracket, fix it!
            let fixedStripped = stripped.trim();
            if (fixedStripped.startsWith('[') && !fixedStripped.endsWith(']')) {
                if (fixedStripped.endsWith('}')) {
                    fixedStripped += ']';
                } else {
                    // If it cut off mid-sentence, find the last complete card
                    const lastGoodObj = fixedStripped.lastIndexOf('}');
                    if (lastGoodObj !== -1) {
                        fixedStripped = fixedStripped.slice(0, lastGoodObj + 1) + ']';
                    }
                }
            }
            flashcards = JSON.parse(fixedStripped);
        } catch (e) {
            const match = stripped.match(/\[[\s\S]*\]/);
            if (match) {
                try {
                    flashcards = JSON.parse(match[0]);
                } catch (innerE) {
                    // Truncated or corrupt JSON
                }
            }
        }

        if (!flashcards) {
            return res.status(500).json({ 
                error: 'AI returned unexpected or truncated format.', 
                raw: text 
            });
        }

        res.json({ success: true, deck: flashcards });

    } catch (error) {
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
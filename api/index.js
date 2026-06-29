import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';

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
            if (filename.endsWith('.pdf')) {
                const parsed = await pdfParse(filePart.data);
                topic = parsed.text;
            } else if (filename.endsWith('.docx')) {
                const result = await mammoth.extractRawText({ buffer: filePart.data });
                topic = result.value;
            } else if (filename.endsWith('.txt')) {
                topic = filePart.data.toString('utf-8');
            } else {
                return res.status(400).json({ error: 'Unsupported file. Use PDF, DOCX, or TXT.' });
            }
        } catch (parseErr) {
            console.error('File parse error:', parseErr);
            return res.status(500).json({ error: 'Failed to read file.', details: parseErr.message });
        }

    } else {
        const body = req.body;
        topic = body.topic;
        cardCount = body.cardCount || 8;
    }

    if (!topic || topic.trim().length < 5) {
        return res.status(400).json({ error: 'Not enough text extracted.' });
    }

    const trimmedTopic = topic.trim().slice(0, 6000);

    const prompt = `You are an expert academic AI Flashcard Generator. 
Analyze the following content and extract exactly ${cardCount} distinct, high-yield flashcards.
Content: "${trimmedTopic}"
Return ONLY a valid JSON array. Each object must have exactly: "question" and "answer".
No markdown, no code blocks. Raw JSON only.`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7
            })
        });

        const data = await response.json();
        const text = data.choices[0].message.content.trim();
        const clean = text.replace(/```json|```/g, '').trim();
        const flashcards = JSON.parse(clean);

        res.json({ success: true, deck: flashcards });

    } catch (error) {
        console.error('Groq error:', error);
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
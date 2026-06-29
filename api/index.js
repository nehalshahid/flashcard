import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

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

async function extractPdfText(buffer) {
    const uint8Array = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
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
            if (filename.endsWith('.txt')) {
                topic = filePart.data.toString('utf-8');
            } else if (filename.endsWith('.pdf')) {
                topic = await extractPdfText(filePart.data);
            } else if (filename.endsWith('.docx')) {
                const mammoth = await import('mammoth');
                const result = await mammoth.default.extractRawText({ buffer: filePart.data });
                topic = result.value;
            } else {
                return res.status(400).json({ error: 'Unsupported file. Use PDF, DOCX, or TXT.' });
            }
        } catch (parseErr) {
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
                temperature: 0.3
            })
        });

        const data = await response.json();

        if (!data.choices || !data.choices[0]) {
            return res.status(500).json({ error: 'Bad Groq response', raw: data });
        }

        const text = data.choices[0].message.content.trim();
        const cleaned = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .replace(/^[^[]*/, '')
            .replace(/[^\]]*$/, '')
            .trim();

        const flashcards = JSON.parse(cleaned);
        res.json({ success: true, deck: flashcards });

    } catch (error) {
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
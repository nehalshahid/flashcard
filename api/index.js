import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { topic, cardCount } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic required.' });

    const count = cardCount || 8;

    const prompt = `
        You are an expert academic AI Flashcard Generator. 
        Analyze the following topic or raw lecture notes and extract exactly ${count} distinct, high-yield flashcards.
        Topic/Notes: "${topic}"
        Return ONLY a valid JSON array. Each object must have exactly: "question" and "answer".
        No markdown, no code blocks. Raw JSON only.
    `;

    try {
        const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
        const response = await model.generateContent(prompt);
        const flashcards = JSON.parse(response.response.text().trim());
        res.json({ success: true, deck: flashcards });

    } catch (error) {
        console.error("Generation Failure:", error);
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
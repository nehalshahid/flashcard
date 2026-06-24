export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { topic, cardCount } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic required.' });

    const count = cardCount || 8;

    const prompt = `You are an expert academic AI Flashcard Generator. 
Analyze the following topic or raw lecture notes and extract exactly ${count} distinct, high-yield flashcards.
Topic/Notes: "${topic}"
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
        console.error("Generation Failure:", error);
        res.status(500).json({ error: 'AI generation failed.', details: error.message });
    }
}
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Generation Endpoint
app.post('/api/generate-flashcards', async (req, res) => {
    const { topic, cardCount } = req.body;

    if (!topic) {
        return res.status(400).json({ error: 'Topic or context notes are required.' });
    }

    const count = cardCount || 8;

    // We explicitly request a structured JSON array back to eliminate parsing errors
    const structuralPrompt = `
        You are an expert academic AI Flashcard Generator. 
        Analyze the following topic or raw lecture notes and extract exactly ${count} distinct, high-yield flashcards.
        
        Topic/Notes: "${topic}"
        
        Return the response strictly as a valid JSON array of objects. 
        Each object must have exactly two fields: "question" and "answer".
        Do not wrap the response in markdown code blocks (\`\`\`json). Return raw JSON only.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: structuralPrompt,
        });

        const textResponse = response.text;
        
        // Parse the raw string into an array objects for the frontend
        const flashcards = JSON.parse(textResponse.trim());
        
        res.json({ success: true, deck: flashcards });

    } catch (error) {
        console.error("Gemini Generation Failure:", error);
        res.status(500).json({ 
            error: 'Failed to generate content via AI model.', 
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`⚡ AI Core running on port: http://localhost:${PORT}`);
});


export default app;
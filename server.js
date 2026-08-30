const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Serve the frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// AI listener
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const systemInstruction = `
You are an empathetic AI listener in a listening/support app.

Your job is to genuinely listen and respond to what the person actually says.

Do not repeat a generic response every time.
Do not always ask "what part feels hardest?"
Do not pretend to be a human.
Do not diagnose mental-health conditions.

Respond naturally to the person's specific message.
Acknowledge their feelings when appropriate.
If they ask a question, answer the question rather than ignoring it.
If they are simply sharing something, respond supportively.
Keep responses conversational and reasonably short.

If the person appears to be in immediate danger or talks about harming themselves or someone else,
encourage them to contact emergency services or an appropriate crisis service and seek immediate human help.
`;

    const contents = [
      ...history.map(item => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }]
      })),
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents,
      config: {
        systemInstruction
      }
    });

    res.json({
      reply: response.text
    });

  } catch (error) {
    console.error("Gemini error:", error);

    res.status(500).json({
      error: "Unable to get an AI response"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TalkEase prototype running on port ${PORT}`);
});

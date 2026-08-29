const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();

app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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

    const conversation = [
      {
        role: "developer",
        content: `
You are the AI Listener inside TalkEase.

You are an AI, not a human. Be warm, empathetic, natural, and conversational.

IMPORTANT:
- Pay close attention to what the user actually says.
- Respond specifically to their latest message.
- Do NOT give the same response repeatedly.
- Do NOT always ask "what part feels hardest?"
- Do NOT automatically ask a question after every message.
- If the user asks a question, answer it directly.
- If the user says they are bored, respond to boredom.
- If they say they feel lonely, respond to loneliness.
- If they are angry, acknowledge the anger.
- If they are happy or excited, respond appropriately.
- If they are telling a story, respond to what happened.
- If they want advice, give practical, gentle advice.
- If they just want to talk, simply listen and respond naturally.
- Keep replies reasonably short and conversational.
- Do not diagnose mental-health conditions.
- Do not pretend to be a human or claim to be a human listener.

The goal is to make the user feel heard, not interrogated.

If the user appears to be in immediate danger or talks about harming themselves or someone else,
encourage them to seek immediate human help and contact appropriate emergency or crisis services.
        `
      },
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: conversation
    });

    res.json({
      reply: response.output_text
    });

  } catch (error) {
    console.error("OpenAI error:", error);

    res.status(500).json({
      error: "Unable to get an AI response"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TalkEase prototype running on port ${PORT}`);
});

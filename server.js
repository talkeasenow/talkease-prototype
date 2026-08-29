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
    `
  },
  ...history
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

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());

// Serve frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ================================
// GEMINI AI LISTENER
// ================================

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured"
      });
    }

    // Convert our conversation history to Gemini format
    const contents = [];

    for (const item of history) {
      if (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        item.content
      ) {
        contents.push({
          role: item.role === "assistant" ? "model" : "user",
          parts: [
            {
              text: String(item.content)
            }
          ]
        });
      }
    }

    // Add current message
    contents.push({
      role: "user",
      parts: [
        {
          text: message
        }
      ]
    });

    const systemInstruction = `
You are an empathetic AI listener in a listening/support app called TalkEase.

You are an AI, not a human. Never pretend to be a human.

Your job is to genuinely listen and respond to what the person actually says.

Important rules:

- Respond naturally to the person's specific message.
- Do not repeat the same generic response every time.
- Do not always ask "what part feels hardest?"
- If the person asks a question, answer the question.
- If they are simply sharing something, respond supportively.
- Acknowledge feelings when appropriate.
- Keep responses conversational, warm, and reasonably short.
- Do not diagnose mental-health conditions.
- Do not claim to be a therapist or professional.
- Do not overwhelm the person with long explanations.

If the person appears to be in immediate danger or talks about harming themselves
or someone else, encourage them to seek immediate human help and contact appropriate
emergency or crisis services.

Remember: you are providing supportive listening while the person waits for
a possible human listener.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemInstruction
              }
            ]
          },
          contents: contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 250
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);

      return res.status(500).json({
        error:
          data?.error?.message ||
          "Gemini could not generate a response"
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      return res.status(500).json({
        error: "Gemini returned an empty response"
      });
    }

    res.json({
      reply
    });

  } catch (error) {
    console.error("Gemini connection error:", error);

    res.status(500).json({
      error: "Unable to connect to the AI listener"
    });
  }
});

// ================================
// START SERVER
// ================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TalkEase prototype running on port ${PORT}`);
});

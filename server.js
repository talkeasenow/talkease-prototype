const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================================================
   GEMINI AI
   ========================================================= */

const GEMINI_MODEL = "gemini-2.5-flash";

const AI_INSTRUCTIONS = `
You are the AI Listener inside TalkEase, a listening/support application.

You are an AI, not a human. Never pretend to be a human.

Your role is to listen carefully and respond naturally to what the person actually says.

Rules:
- Be warm, calm, empathetic and conversational.
- Respond to the specific message.
- Do not give the same generic response repeatedly.
- Do not repeatedly ask "what part feels hardest?"
- If the person asks a normal question, answer it.
- If they are sharing feelings, acknowledge what they said.
- Keep replies reasonably short and natural.
- Do not diagnose mental-health conditions.
- Do not claim to provide therapy.
- Do not pretend to be a human listener.
- Do not overwhelm the person with long explanations.

If the person says they may immediately hurt themselves, hurt someone else,
or are in immediate danger, encourage them to seek immediate human help,
contact local emergency services or an appropriate crisis service.
`;

function convertHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-20)
    .filter(item => {
      return (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
      );
    })
    .map(item => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: item.content
        }
      ]
    }));
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured on the server."
      });
    }

    let contents = convertHistory(history);

    /*
      The frontend normally sends the current message in history too.
      This prevents the same user message from being sent twice.
    */
    const last = contents[contents.length - 1];

    const alreadyContainsMessage =
      last &&
      last.role === "user" &&
      last.parts &&
      last.parts[0] &&
      last.parts[0].text === message.trim();

    if (!alreadyContainsMessage) {
      contents.push({
        role: "user",
        parts: [
          {
            text: message.trim()
          }
        ]
      });
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: AI_INSTRUCTIONS
            }
          ]
        },
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 300
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini could not generate a response."
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      console.error("Gemini returned no text:", data);

      return res.status(500).json({
        error: "Gemini returned an empty response."
      });
    }

    res.json({
      reply
    });

  } catch (error) {
    console.error("AI error:", error);

    res.status(500).json({
      error: "Unable to get an AI response."
    });
  }
});

/* =========================================================
   SIMPLE HUMAN LISTENER MATCHING
   ========================================================= */

const waitingTalkers = [];
const waitingListeners = [];

function removeFromQueue(socketId) {
  const remove = (queue) => {
    const index = queue.findIndex(item => item.socketId === socketId);

    if (index !== -1) {
      queue.splice(index, 1);
    }
  };

  remove(waitingTalkers);
  remove(waitingListeners);
}

function tryMatch() {
  while (
    waitingTalkers.length > 0 &&
    waitingListeners.length > 0
  ) {
    const talker = waitingTalkers.shift();
    const listener = waitingListeners.shift();

    const talkerSocket = io.sockets.sockets.get(talker.socketId);
    const listenerSocket = io.sockets.sockets.get(listener.socketId);

    if (!talkerSocket || !listenerSocket) {
      continue;
    }

    const room = `room-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    talkerSocket.join(room);
    listenerSocket.join(room);

    talkerSocket.data.room = room;
    listenerSocket.data.room = room;

    talkerSocket.data.role = "talker";
    listenerSocket.data.role = "listener";

    talkerSocket.emit("matched", {
      room,
      peer: listener.name || "Human listener"
    });

    listenerSocket.emit("matched", {
      room,
      peer: talker.name || "Talker"
    });
  }
}

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("join_queue", data => {
    const role = data?.role === "listener"
      ? "listener"
      : "talker";

    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : "Anonymous";

    removeFromQueue(socket.id);

    socket.data.role = role;
    socket.data.name = name;

    if (role === "talker") {
      waitingTalkers.push({
        socketId: socket.id,
        name
      });

      socket.emit(
        "waiting",
        "Looking for someone who's available to listen."
      );
    } else {
      waitingListeners.push({
        socketId: socket.id,
        name
      });

      socket.emit(
        "waiting",
        "You're available to listen to someone."
      );
    }

    tryMatch();
  });

  socket.on("send_message", data => {
    const room = socket.data.room;

    if (!room || !data?.text) {
      return;
    }

    io.to(room).emit("message", {
      text: String(data.text),
      sender: socket.id
    });
  });

  socket.on("end", () => {
    const room = socket.data.room;

    if (room) {
      io.to(room).emit("ended");
    }

    removeFromQueue(socket.id);
  });

  socket.on("cancel", () => {
    removeFromQueue(socket.id);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);

    const room = socket.data.room;

    if (room) {
      socket.to(room).emit("ended");
    }

    removeFromQueue(socket.id);
  });
});

/* =========================================================
   SERVER
   ========================================================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`TalkEase prototype running on port ${PORT}`);
  console.log(`AI provider: Google Gemini`);
  console.log(`AI model: ${GEMINI_MODEL}`);
});

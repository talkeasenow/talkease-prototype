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

/*
========================================================
GEMINI AI
========================================================
*/

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL = "gemini-3.6-flash";

const SYSTEM_INSTRUCTION = `
You are an empathetic AI listener in the TalkEase listening/support app.

You are an AI, not a human.

Your job is to listen carefully and respond naturally to what the person actually says.

Rules:

- Respond to the person's specific message.
- Do not repeat the same generic response.
- Do not always ask "what part feels hardest?"
- If the person asks a question, answer it.
- If the person is sharing feelings, acknowledge them naturally.
- Do not diagnose mental-health conditions.
- Do not pretend to be a human.
- Keep responses conversational, warm, supportive, and reasonably short.
- Do not overuse questions.
- Do not give long lectures unless the person asks for detail.

If the person appears to be in immediate danger or talks about harming themselves
or someone else, encourage them to seek immediate human help and contact appropriate
local emergency or crisis services.
`;

/*
Convert our frontend history into Gemini's format.
Gemini uses:
"user" for the person
"model" for the AI
*/

function buildGeminiContents(history, message) {
  const contents = [];

  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || !item.content) continue;

      if (item.role === "user") {
        contents.push({
          role: "user",
          parts: [
            {
              text: String(item.content)
            }
          ]
        });
      }

      if (item.role === "assistant" || item.role === "model") {
        contents.push({
          role: "model",
          parts: [
            {
              text: String(item.content)
            }
          ]
        });
      }
    }
  }

  /*
  Prevent the current message from being added twice.
  */

  const last = contents[contents.length - 1];

  if (
    !last ||
    last.role !== "user" ||
    last.parts[0].text !== String(message)
  ) {
    contents.push({
      role: "user",
      parts: [
        {
          text: String(message)
        }
      ]
    });
  }

  return contents;
}

/*
========================================================
AI CHAT ROUTE
========================================================
*/

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing.");

      return res.status(500).json({
        error: "Gemini API key is not configured on the server."
      });
    }

    const contents = buildGeminiContents(history, message);

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: SYSTEM_INSTRUCTION
            }
          ]
        },
        contents: contents
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", data);

      return res.status(geminiResponse.status).json({
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
    console.error("AI server error:", error);

    res.status(500).json({
      error: "Unable to connect to the AI right now."
    });
  }
});

/*
========================================================
SOCKET.IO HUMAN LISTENER QUEUE
========================================================
*/

const talkers = [];
const listeners = [];
const rooms = new Map();

function removeFromQueue(socketId) {
  const talkerIndex = talkers.findIndex(x => x.id === socketId);

  if (talkerIndex !== -1) {
    talkers.splice(talkerIndex, 1);
  }

  const listenerIndex = listeners.findIndex(x => x.id === socketId);

  if (listenerIndex !== -1) {
    listeners.splice(listenerIndex, 1);
  }
}

function findQueueUser(queue, socketId) {
  return queue.find(x => x.id === socketId);
}

function matchUsers() {
  while (talkers.length > 0 && listeners.length > 0) {

    const talker = talkers.shift();
    const listener = listeners.shift();

    const talkerSocket = io.sockets.sockets.get(talker.id);
    const listenerSocket = io.sockets.sockets.get(listener.id);

    if (!talkerSocket || !listenerSocket) {
      continue;
    }

    const room = `room-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    talkerSocket.join(room);
    listenerSocket.join(room);

    rooms.set(room, {
      talker: talker.id,
      listener: listener.id
    });

    console.log(
      "Matched:",
      talker.id,
      "<->",
      listener.id,
      "room:",
      room
    );

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

/*
========================================================
SOCKET EVENTS
========================================================
*/

io.on("connection", socket => {

  console.log("Socket connected:", socket.id);

  socket.on("join_queue", data => {

    const role = data?.role || "talker";
    const name = data?.name || "Anonymous";

    console.log(
      "Join queue:",
      socket.id,
      role,
      name
    );

    removeFromQueue(socket.id);

    if (role === "listener") {

      listeners.push({
        id: socket.id,
        name
      });

      socket.emit(
        "waiting",
        "You are available to listen. Waiting for someone to connect."
      );

    } else {

      talkers.push({
        id: socket.id,
        name
      });

      socket.emit(
        "waiting",
        "Looking for someone who's available to listen."
      );
    }

    matchUsers();
  });

  socket.on("send_message", data => {

    if (!data || !data.room || !data.text) {
      return;
    }

    const room = rooms.get(data.room);

    if (!room) {
      return;
    }

    io.to(data.room).emit("message", {
      text: String(data.text),
      sender: socket.id
    });
  });

  socket.on("end", () => {

    console.log("Chat ended:", socket.id);

    let roomToEnd = null;

    for (const [room, members] of rooms.entries()) {

      if (
        members.talker === socket.id ||
        members.listener === socket.id
      ) {
        roomToEnd = room;
        break;
      }
    }

    if (roomToEnd) {

      io.to(roomToEnd).emit("ended");

      rooms.delete(roomToEnd);
    }

    removeFromQueue(socket.id);
  });

  socket.on("cancel", () => {

    console.log("Queue cancelled:", socket.id);

    removeFromQueue(socket.id);
  });

  socket.on("disconnect", () => {

    console.log("Socket disconnected:", socket.id);

    removeFromQueue(socket.id);

    for (const [room, members] of rooms.entries()) {

      if (
        members.talker === socket.id ||
        members.listener === socket.id
      ) {

        io.to(room).emit("ended");

        rooms.delete(room);
      }
    }
  });
});

/*
========================================================
START SERVER
========================================================
*/

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(
    `TalkEase prototype running on port ${PORT}`
  );

  console.log(
    `Gemini model: ${GEMINI_MODEL}`
  );

  console.log(
    `Gemini API key configured: ${GEMINI_API_KEY ? "YES" : "NO"}`
  );
});


// --- TalkEase safety events (additive) ---
const safetyReports = [];
const blockedPairs = new Set();

io.on('connection', (socket) => {
  socket.on('safety_report', (payload = {}) => {
    safetyReports.push({
      socketId: socket.id,
      reason: String(payload.reason || 'unspecified').slice(0, 120),
      at: new Date().toISOString()
    });
    // Keep reports in memory for the prototype; production should persist securely.
    console.log('[safety] report received', socket.id, payload.reason || 'unspecified');
  });

  socket.on('safety_block', () => {
    // Prototype-only block marker. A production implementation should persist
    // the relationship against authenticated user IDs.
    console.log('[safety] block requested', socket.id);
  });
});

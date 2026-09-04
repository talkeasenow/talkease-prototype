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

/*
 * Gemini models are kept in fallback order so a temporary model/API
 * issue does not take down the AI waiting experience.
 *
 * Google currently documents Gemini 3.8 Flash and 3.7 Flash for
 * generateContent; 3.6 Flash remains a fallback for this prototype.
 */
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash"
];

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
- Never claim that you contacted emergency services or another human.
- If the person appears to be in immediate danger or talks about harming themselves
  or someone else, encourage immediate human help and appropriate local emergency
  or crisis services.
`;

function buildGeminiContents(history, message) {
  const contents = [];

  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || !item.content) continue;

      const role =
        item.role === "assistant" || item.role === "model"
          ? "model"
          : "user";

      contents.push({
        role,
        parts: [{ text: String(item.content) }]
      });
    }
  }

  const last = contents[contents.length - 1];
  const current = String(message);

  if (
    !last ||
    last.role !== "user" ||
    last.parts?.[0]?.text !== current
  ) {
    contents.push({
      role: "user",
      parts: [{ text: current }]
    });
  }

  return contents;
}

function geminiErrorMessage(data) {
  return (
    data?.error?.message ||
    data?.error?.status ||
    "Gemini request failed."
  );
}

async function callGemini(model, contents) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 300
        }
      }),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const err = new Error(geminiErrorMessage(data));
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      const err = new Error("Gemini returned no text.");
      err.status = 502;
      err.data = data;
      throw err;
    }

    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

/*
========================================================
AI CHAT ROUTE
========================================================
*/

app.post("/api/chat", async (req, res) => {
  const requestId =
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const { message, history = [] } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    if (!GEMINI_API_KEY) {
      console.error(`[AI ${requestId}] GEMINI_API_KEY is missing.`);
      return res.status(503).json({
        error: "AI is not configured on this server.",
        code: "MISSING_API_KEY",
        requestId
      });
    }

    const contents = buildGeminiContents(history, message);
    let lastError = null;

    for (const model of GEMINI_MODELS) {
      try {
        console.log(`[AI ${requestId}] Trying ${model}`);
        const reply = await callGemini(model, contents);

        console.log(`[AI ${requestId}] Success with ${model}`);

        return res.json({
          reply,
          model
        });
      } catch (error) {
        lastError = error;

        console.error(
          `[AI ${requestId}] ${model} failed:`,
          error.message
        );

        /*
         * Try the next model for model-not-found, quota/rate-limit,
         * transient server, or other upstream failures.
         */
      }
    }

    console.error(
      `[AI ${requestId}] All Gemini models failed. Last error:`,
      lastError?.message
    );

    return res.status(503).json({
      error:
        "The AI service is temporarily unavailable. Your message was not lost. Please try again.",
      code: "AI_UPSTREAM_UNAVAILABLE",
      requestId
    });

  } catch (error) {
    console.error(`[AI ${requestId}] Server error:`, error);

    return res.status(500).json({
      error: "The AI service encountered a temporary problem. Please try again.",
      code: "AI_SERVER_ERROR",
      requestId
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

  socket.on("voice_signal", data => {

    if (!data || !data.room || !data.type) return;

    const members = rooms.get(data.room);
    if (!members) return;

    const isMember =
      members.talker === socket.id ||
      members.listener === socket.id;

    if (!isMember) return;

    const allowed = new Set(["offer", "answer", "ice-candidate", "decline", "end"]);
    if (!allowed.has(data.type)) return;

    // Never trust a client-supplied destination. Relay only to the other room member.
    socket.to(data.room).emit("voice_signal", {
      room: data.room,
      type: data.type,
      data: data.data || null
    });
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
    `Gemini models: ${GEMINI_MODELS.join(", ")}`
  );

  console.log(
    `Gemini API key configured: ${GEMINI_API_KEY ? "YES" : "NO"}`
  );
});


/*
========================================================
PROTOTYPE SAFETY EVENTS
========================================================
*/
const safetyReports = [];

io.on("connection", socket => {
  socket.on("safety_report", payload => {
    safetyReports.push({
      socketId: socket.id,
      reason: String(payload?.reason || "unspecified").slice(0, 120),
      at: new Date().toISOString()
    });
    console.log("[safety] report received:", socket.id);
  });

  socket.on("safety_block", () => {
    console.log("[safety] block requested:", socket.id);
  });
});

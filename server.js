const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const OpenAI = require("openai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Serve TalkEase
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/*
  --------------------------------------------------
  HUMAN LISTENER QUEUE
  --------------------------------------------------
*/

const talkers = new Map();
const listeners = new Map();
const rooms = new Map();

function makeRoomId() {
  return "room_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function matchPeople() {
  if (talkers.size === 0 || listeners.size === 0) {
    return;
  }

  const talkerEntry = talkers.entries().next().value;
  const listenerEntry = listeners.entries().next().value;

  if (!talkerEntry || !listenerEntry) {
    return;
  }

  const [talkerId, talker] = talkerEntry;
  const [listenerId, listener] = listenerEntry;

  talkers.delete(talkerId);
  listeners.delete(listenerId);

  const room = makeRoomId();

  rooms.set(room, {
    talkerId,
    listenerId
  });

  const talkerSocket = io.sockets.sockets.get(talkerId);
  const listenerSocket = io.sockets.sockets.get(listenerId);

  if (!talkerSocket || !listenerSocket) {
    rooms.delete(room);

    if (talkerSocket) {
      talkers.set(talkerId, talker);
    }

    if (listenerSocket) {
      listeners.set(listenerId, listener);
    }

    return;
  }

  talkerSocket.join(room);
  listenerSocket.join(room);

  talkerSocket.emit("matched", {
    room,
    peer: listener.name || "Human listener"
  });

  listenerSocket.emit("matched", {
    room,
    peer: talker.name || "Talker"
  });

  console.log(`Matched ${talkerId} with ${listenerId} in ${room}`);
}

/*
  --------------------------------------------------
  SOCKET.IO
  --------------------------------------------------
*/

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join_queue", ({ role, name }) => {
    const userName = (name || "Anonymous").trim() || "Anonymous";

    // Remove this socket from either queue first
    talkers.delete(socket.id);
    listeners.delete(socket.id);

    if (role === "talker") {
      talkers.set(socket.id, {
        name: userName
      });

      socket.emit(
        "waiting",
        "Looking for someone to listen..."
      );
    } else if (role === "listener") {
      listeners.set(socket.id, {
        name: userName
      });

      socket.emit(
        "waiting",
        "Waiting for someone who would like to talk..."
      );
    }

    matchPeople();
  });

  socket.on("send_message", ({ room, text }) => {
    if (!room || !text || !text.trim()) {
      return;
    }

    const roomInfo = rooms.get(room);

    if (!roomInfo) {
      return;
    }

    // Make sure this socket actually belongs to this room
    if (
      socket.id !== roomInfo.talkerId &&
      socket.id !== roomInfo.listenerId
    ) {
      return;
    }

    io.to(room).emit("message", {
      text: text.trim(),
      sender: socket.id
    });
  });

  socket.on("end", () => {
    endConversation(socket);
  });

  socket.on("cancel", () => {
    removeFromQueues(socket.id);

    console.log("User cancelled:", socket.id);
  });

  socket.on("disconnect", () => {
    removeFromQueues(socket.id);
    endConversation(socket);

    console.log("User disconnected:", socket.id);
  });
});

function removeFromQueues(socketId) {
  talkers.delete(socketId);
  listeners.delete(socketId);
}

function endConversation(socket) {
  for (const [room, roomInfo] of rooms.entries()) {
    if (
      roomInfo.talkerId === socket.id ||
      roomInfo.listenerId === socket.id
    ) {
      rooms.delete(room);

      const otherId =
        roomInfo.talkerId === socket.id
          ? roomInfo.listenerId
          : roomInfo.talkerId;

      const otherSocket = io.sockets.sockets.get(otherId);

      if (otherSocket) {
        otherSocket.emit("ended");
        otherSocket.leave(room);
      }

      socket.leave(room);

      console.log(`Conversation ended: ${room}`);
    }
  }
}

/*
  --------------------------------------------------
  AI LISTENER
  --------------------------------------------------
*/

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    // Limit history so very long conversations don't grow indefinitely
    const safeHistory = Array.isArray(history)
      ? history.slice(-30)
      : [];

    const conversation = [
      {
        role: "developer",
        content: `
You are the AI Listener inside TalkEase.

You are an AI, not a human. Be warm, empathetic, natural, and conversational.

Your job is to genuinely listen and respond to what the person actually says.

IMPORTANT:
- Pay close attention to the user's latest message.
- Respond specifically to what they said.
- Do NOT repeat the same generic response.
- Do NOT always ask "what part feels hardest?"
- Do NOT automatically ask a question after every message.
- If the user asks a question, answer it directly.
- If they want advice, give practical and gentle suggestions.
- If they are simply sharing something, respond naturally.
- If they are lonely, acknowledge loneliness.
- If they are angry, acknowledge their anger.
- If they are sad, respond with empathy.
- If they are happy or excited, respond appropriately.
- If they are bored, respond to the boredom.
- Remember relevant details from earlier messages in the conversation.
- Keep replies reasonably short and conversational.
- Do not diagnose mental-health conditions.
- Do not pretend to be a human.
- Do not claim that you are a human listener.

The goal is to make the person feel heard, understood, and supported.

If the person appears to be in immediate danger or talks about harming themselves or someone else,
encourage them to seek immediate human help and contact appropriate emergency or crisis services.
        `
      },
      ...safeHistory
    ];

    // The frontend already puts the latest user message into history,
    // so we don't add it a second time here.

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

/*
  --------------------------------------------------
  START SERVER
  --------------------------------------------------
*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`TalkEase server running on port ${PORT}`);
});

const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.json());

// Serve frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =====================================================
// GEMINI AI
// =====================================================

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
        error: "GEMINI_API_KEY is not configured on the server"
      });
    }

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

Your job is to listen carefully and respond to what the person actually says.

Rules:
- Respond naturally to the person's specific message.
- Do not repeat the same generic response every time.
- Do not always ask "what part feels hardest?"
- If the person asks a question, answer it.
- If they are sharing something, respond supportively.
- Acknowledge feelings when appropriate.
- Keep responses warm, conversational, and reasonably short.
- Do not diagnose mental-health conditions.
- Do not claim to be a therapist.
- Do not pretend to be a human listener.

If the person appears to be in immediate danger or talks about harming
themselves or someone else, encourage them to seek immediate human help
and contact appropriate emergency or crisis services.

You are providing supportive listening while the person waits for a
possible human listener.
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
          contents,
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

    const reply = data?.candidates?.[0]?.content?.parts
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
      error: "Unable to connect to Gemini"
    });
  }
});

// =====================================================
// SOCKET.IO
// =====================================================

const waitingTalkers = [];
const waitingListeners = [];

io.on("connection", (socket) => {

  console.log("Socket connected:", socket.id);

  socket.on("join_queue", ({ role, name }) => {

    const displayName = name || "Anonymous";

    console.log(
      "Join queue:",
      socket.id,
      role,
      displayName
    );

    socket.data.role = role;
    socket.data.name = displayName;

    // -----------------------------------------------
    // TALKER
    // -----------------------------------------------

    if (role === "talker") {

      // Check if a listener is already waiting
      if (waitingListeners.length > 0) {

        const listener = waitingListeners.shift();

        const room = "room_" + socket.id + "_" + listener.id;

        socket.join(room);
        listener.join(room);

        socket.data.room = room;
        listener.data.room = room;

        socket.emit("matched", {
          room,
          peer: listener.data.name || "Human listener"
        });

        listener.emit("matched", {
          room,
          peer: displayName
        });

        console.log("Matched:", room);

      } else {

        waitingTalkers.push(socket);

        socket.emit(
          "waiting",
          "Looking for someone who's available to listen."
        );

        console.log("Talker waiting:", socket.id);
      }

      return;
    }

    // -----------------------------------------------
    // LISTENER
    // -----------------------------------------------

    if (role === "listener") {

      // Check if a talker is waiting
      if (waitingTalkers.length > 0) {

        const talker = waitingTalkers.shift();

        const room = "room_" + talker.id + "_" + socket.id;

        talker.join(room);
        socket.join(room);

        talker.data.room = room;
        socket.data.room = room;

        talker.emit("matched", {
          room,
          peer: displayName
        });

        socket.emit("matched", {
          room,
          peer: talker.data.name || "Talker"
        });

        console.log("Matched:", room);

      } else {

        waitingListeners.push(socket);

        socket.emit(
          "waiting",
          "You're available to listen. Waiting for someone to connect."
        );

        console.log("Listener waiting:", socket.id);
      }
    }
  });

  // ===================================================
  // HUMAN CHAT MESSAGE
  // ===================================================

  socket.on("send_message", ({ room, text }) => {

    if (!room || !text || !text.trim()) {
      return;
    }

    io.to(room).emit("message", {
      text: text.trim(),
      sender: socket.id
    });
  });

  // ===================================================
  // END CHAT
  // ===================================================

  socket.on("end", () => {

    const room = socket.data.room;

    if (room) {
      io.to(room).emit("ended");
    }

    removeFromQueues(socket);

    console.log("Chat ended:", socket.id);
  });

  // ===================================================
  // CANCEL
  // ===================================================

  socket.on("cancel", () => {

    removeFromQueues(socket);

    console.log("Queue cancelled:", socket.id);
  });

  // ===================================================
  // DISCONNECT
  // ===================================================

  socket.on("disconnect", () => {

    removeFromQueues(socket);

    console.log("Socket disconnected:", socket.id);
  });
});

// =====================================================
// REMOVE SOCKET FROM WAITING QUEUES
// =====================================================

function removeFromQueues(socket) {

  let index = waitingTalkers.indexOf(socket);

  if (index !== -1) {
    waitingTalkers.splice(index, 1);
  }

  index = waitingListeners.indexOf(socket);

  if (index !== -1) {
    waitingListeners.splice(index, 1);
  }
}

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`TalkEase prototype running on port ${PORT}`);
});

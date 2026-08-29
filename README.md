# TalkEase Final Prototype

A user-testing prototype for:
- Talker / Listener roles
- Real-time human matching and chat
- AI fallback while a human is unavailable
- Clear AI disclosure
- Human handoff screen
- 20-minute human conversation timer
- Feedback screen

## Run locally
Install Node.js 18+.

Then:
1. `npm install`
2. `npm start`
3. Open `http://localhost:3000` in two browser windows/devices.
4. On one device choose "I need someone to talk to".
5. On the other choose "I want to listen".
6. They will be matched automatically.

To test AI fallback, open the Talker side without a Listener and wait a few seconds.

## Public hosting
This app needs a Node.js host with WebSocket/Socket.IO support. A static host such as GitHub Pages is not sufficient for the real-time version.

The AI fallback here is a prototype simulation using local scripted responses. It is not connected to a live AI model.

Do not use this prototype for real sensitive conversations. Production requires authentication/privacy controls, secure transport, abuse prevention, moderation, reporting/blocking, crisis-safety flows, data retention policy, and a production AI integration.

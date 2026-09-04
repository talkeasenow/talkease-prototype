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


## AI Connection Reliability

The prototype now:
- uses the current Gemini `generateContent` REST pattern with the API key in the request header
- tries Gemini 3.8 Flash, then 3.7 Flash, then 3.6 Flash
- applies a 20-second upstream timeout
- logs the request ID/model/error on the server for diagnosis
- returns a clear temporary-unavailable response instead of hiding every upstream error behind a generic connection failure

### Deployment requirement

Set `GEMINI_API_KEY` in the deployment platform's server environment. Never put the key in `index.html` or client-side JavaScript.

The AI fallback sequence improves resilience, but a valid Gemini API key with the required access/quota is still necessary for live AI responses.


## Voice call prototype (WebRTC)

This version adds browser-to-browser audio calling for matched TalkEase users.
- Socket.IO is used only for WebRTC signaling (offer/answer/ICE).
- Audio stays peer-to-peer when the network allows it.
- Browser audio processing requests echo cancellation, noise suppression, and automatic gain control.
- The prototype uses public Google STUN servers; a TURN relay is still recommended before production launch for difficult NAT/firewall networks.
- Voice controls: microphone mute/unmute and end call.
- No conversation timer is used for voice.
- Voice status distinguishes a human match from an actually established WebRTC connection.

For production, add authenticated signaling, rate limiting, abuse controls, a managed/self-hosted TURN service, monitoring, and stronger authorization before allowing real sensitive conversations.

## Voice-call prototype notes

- Voice is audio-only and has **no call timer**.
- The UI includes **Mute** and **End call** controls.
- WebRTC is used for peer-to-peer audio; Socket.IO is used only for signaling.
- The prototype includes Google STUN servers by default, so no paid voice provider is required for initial testing.
- For reliable connectivity on mobile networks, CGNAT, corporate Wi-Fi, or restrictive firewalls, add a TURN server before investor/public testing. The client supports optional runtime values through `window.TALKEASE_TURN_URL`, `window.TALKEASE_TURN_USERNAME`, and `window.TALKEASE_TURN_CREDENTIAL`.

### Important deployment point

STUN-only WebRTC cannot guarantee a connection between every pair of users. A TURN relay is the normal production fallback when direct peer-to-peer ICE fails. Keep TURN credentials server-side or issue short-lived credentials; do not hard-code permanent secrets into the public HTML.


## Voice-call reliability fix in this build

The voice signaling path buffers trickled ICE candidates that arrive while an incoming call is waiting for the listener to press **Accept**. The previous build cleared that buffer when creating the answer-side peer connection, which could cause the WebRTC connection to fail even though the signaling server and UI were working. This build preserves those candidates until the remote offer is applied. It also handles remote voice-call termination and logs ICE candidate errors for easier diagnosis.

## How to test the voice call

1. Deploy this folder as the Node.js service on Render (or run it locally).
2. Open the app on **two separate devices or browser sessions**.
3. Join one as **Talker** and one as **Listener** so they are matched.
4. On the Talker device, tap **Voice**.
5. Allow microphone permission.
6. On the Listener device, tap **Accept voice call**.
7. Confirm both sides show **Voice connected** and test speaking, mute, and end call.

### Important limitation

This prototype uses public STUN servers and does **not** include a TURN relay. STUN is free and is enough for many networks, but it cannot guarantee connectivity across every mobile carrier, CGNAT, corporate network, or restrictive firewall. For investor/public testing, add a properly configured TURN service with short-lived credentials.

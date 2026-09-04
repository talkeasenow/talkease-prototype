# TalkEase Voice UI Fix V5

Changes from V4:
- Voice-call overlay is now fully opaque so the chat does not show through and wash out the call screen.
- Voice connection failure has a clearer error card and actionable retry/back-to-chat controls.
- A failed ICE state is no longer allowed to overwrite a call that is already connected.
- Retry/confirmation states clear the previous failure presentation cleanly.
- Existing WebRTC voice, mute/end controls, Chat vs Voice pricing choice, and private-audio messaging are preserved.

Note: reliable cross-network WebRTC still benefits from a TURN server. STUN-only calling can fail on some restrictive mobile/NAT networks.

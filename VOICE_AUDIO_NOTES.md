# TalkEase voice audio routing

The browser prototype now uses an earpiece-first audio routing attempt:

- Uses the WebRTC remote audio element with `playsinline` and remote playback disabled.
- If a native wrapper exposes `window.TalkEaseNativeAudio.setEarpiece(true)`, TalkEase calls it automatically.
- On browsers that expose `HTMLMediaElement.setSinkId()`, TalkEase tries a communications/earpiece/receiver output before falling back to the default output.
- If the browser does not expose output routing (common on mobile browsers), the browser/OS remains in control of the final audio route. The web page cannot reliably force Android Chrome's internal earpiece.

## Native Android recommendation

For an investor-ready Android app, implement the optional native bridge so the call uses Android's communication audio mode and earpiece. The bridge should:

1. request/hold `RECORD_AUDIO` permission;
2. set `AudioManager.MODE_IN_COMMUNICATION` while a voice call is active;
3. disable speakerphone while the call is active;
4. restore the previous audio mode when the call ends;
5. respect Bluetooth/headset routing when a user has connected one.

Do not secretly record or monitor calls. The goal is private audio from people nearby, with the other participant aware that a voice call is active.

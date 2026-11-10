# Current frozen build Web-only production smoke — 468f3b01

**Passed: actual exit 0, four of four checks.** This run executes the current consumer build's standalone Web path and complements [the same-build targeted native report](./final-targeted-4b165c6c.md). It does not reuse the earlier build's Web results.

Primary evidence: [raw report](./468f3b01-native.json), [hashes written before startup](./468f3b01-before.json). The raw filename follows the shared runner's existing naming convention; this execution was **Web-only**, with no Electron/native instance started. Managed job `bash-8a9e53943d94442c` was collected with actual exit 0.

```sh
PET_VOICE_BROWSER_EXE='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/browser/chromium-full-156-mirror-q6zv9a9g/chrome-linux64/chrome' \
  node --import tsx qa/probes/companion-voice-input-native.mjs --run-frozen --web-only
```

## Actual checks

| Check | Actual result |
| --- | --- |
| Denied permission | A separate exact-origin denied context queried `denied`; actual getUserMedia returned `NotAllowedError: Permission denied`; the product displayed the fixed microphone-permission failure. Zero tracks, AudioContexts, worklet frames, ASR requests or messages resulted. |
| Production catalog read/select/save | In the actual production settings dialog, saving an empty model established the saved binding; one real catalog request returned two ASR candidates, with unsupported `example/whisper-asr` disabled and TTS excluded. Selecting `xiaomi/mimo-v2.5-asr` changed only the draft while a real service read still showed the saved model empty. Explicit Save then committed the full selected model. No ASR inference occurred during catalog/save. |
| Real complete recording | In a separate exact-origin microphone-granted context, permission queried `granted`. Real synthetic-device getUserMedia, 16000 Hz AudioContext and the production `/voice-capture-worklet.js` executed. The page's own full binary HTTP capture reached the actual production service/native provider and controlled peer, then added exactly one ordinary message to the same Agent. The typed composer draft remained unchanged. |
| Recording cancel | A second actual recording was cancelled. Actual tracks ended and the product returned to startable state after its release path. ASR request count remained one and canonical user-message count remained one. No extra input was submitted. |

The worklet emitted **5 × 1600 + 192 = 8192 samples**. One actual browser audio POST used `application/octet-stream`, fixed ownership headers, declared **8192 samples**, and a **32768-byte** f32le body. The controlled native ASR peer received a **16428-byte mono16k PCM16 WAV containing exactly 8192 samples**. The partial **192-sample tail** was preserved.

Actual finish observations: track ended at **1794307747062**; worklet tail arrived at **1794307747071**, then end marker/port close/AudioContext closed at **1794307747072**. The real controlled native request used the expected own User-Agent `dsh-pet-voice/1`, local client-ID authorization, fixed `/v1/magpie/native/xiaomi/v1/chat/completions` route, bare model `mimo-v2.5-asr` and `max_completion_tokens=1024`. The saved logical model remained `xiaomi/mimo-v2.5-asr`.

## Frozen inputs and cleanup

All before/after runner/product hashes compare equal: **hashesUnchanged=true**. The current console, CSS and pet artifact hashes match those recorded in the same-build native targeted run. The browser is prepared private full Chrome for Testing **156.0.8078.4**; the old unsupported headless-shell was not used.

| Executed input | SHA256 |
| --- | --- |
| Web production client | `d8d82ef68366099d9fcbc0353227e2399b2a92b57263018e47e7e3a05dc363ac` |
| Console JS, `index-D6vt4eTl.js` | `7e430d6178a3f2b5f01f8fca248fca0b68e259e8e0d9ec50d3dca4009e3b3942` |
| Console CSS, `index-K_KCqIS7.css` | `b4e3ff82e5b96e9db705888c2ae4a2648720bc9f1b2dcb8452f00ebe5c5dc851` |
| Pet JS, `index-C-yAv87j.js` | `9bd628952ce67ec74c4a5376862cde0fb4766fde9fdb80d476e0292c2ea586c8` |
| Shared QA runner | `30efd61801e45032a5b3aac089f1a1f591f4049f05222e351f478a4f7d6c1e6d` |
| Full Chrome executable | `377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025` |

The full maps also cover actual service dist/external workspace source exports, Main/preload/worker, builtin admission, JS/CSS/worklets, relevant plugins, QA helpers and synthetic tone. The service executes its built production entry with declared external workspace exports via tsx.

Finally confirmed: browser closed, production service handled SIGTERM and exited **0**, controlled peer closed, and owned Xvfb closed. No Electron instance was started. No owned instances or uncollected jobs remain. Child HOME/XDG and SQLite roots were independent; all service/peer listeners used random **127.0.0.1** ports.

## Screenshots actually inspected

All four retained images were opened with `read_image` and show only synthetic QA content:

- [Actual denied-permission UI](./468f3b01-web-consent-denied.png)
- [Actual catalog selection before explicit save](./468f3b01-Web-catalog-selected.png)
- [Actual recording with typed draft preserved](./468f3b01-web-recording.png)
- [One accepted transcript after finish and unchanged count after cancel](./468f3b01-web-finished.png)

## Scope

This is the requested current-build Web denied/catalog/real-capture/message/cancel smoke. It does not rerun native, M2/M3, the 20-second cap, review, terminal-provider errors or Web credential/draft races. Native targeted regressions on the same build remain separately documented. Browser permission is explicitly pre-denied/pre-granted under Parent authorization; manual permission-prompt UI is not claimed. Q6 live-provider recognition remains unrun and unauthorized, as do physical hardware and Windows/macOS checks.

No product code/build/install/commit changes, fake bridge/stream/hook, automatic media-consent flag, live Magpie audio request, private account/key access, original 4120 data access or unrelated display/container action occurred. Older raw results retain their original build facts.

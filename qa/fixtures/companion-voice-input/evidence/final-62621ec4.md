# Final production synthetic voice acceptance — 62621ec4

**Result: passed; actual process exit 0; all 12 runner checks passed.** The final frozen production build was exercised through real Linux Electron 45.0.0 and full Chrome for Testing 156.0.8078.4. This closes the requested production synthetic-device roundtrip/cancel/source/target/catalog scope; it does not assert physical-device recognition or all PRD Q1–Q7 scenarios.

Primary evidence: [raw run report](./62621ec4-native.json) and [hashes written before startup](./62621ec4-before.json). Managed job `bash-ccfe4bf0acbf42f6` was collected with exit 0. All owned instances are closed.

```sh
PET_VOICE_BROWSER_EXE='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/browser/chromium-full-156-mirror-q6zv9a9g/chrome-linux64/chrome' \
  node --import tsx qa/probes/companion-voice-input-native.mjs --run-frozen
```

## Actual checks and measurements

| Boundary / scenario | Executed result |
| --- | --- |
| Main microphone authority | Direct real console `getUserMedia` without a live capture lease returned `NotAllowedError`. Actual source trust and activation used existing product confirmation/toggle controls. No Electron permission handler replacement or automatic media-consent flag. |
| Electron complete recording | Actual synthetic media device → getUserMedia → 16000 Hz AudioContext → built standalone worklet → fixed preload/Main binary acceptance → real production service/native ASR → controlled peer → one ordinary same-Agent canonical user message. Typed draft retained. |
| Finish tail integrity | Worklet emitted **10 × 1600 + 512 = 16512 samples**; Main accepted **16512**; provider WAV contained **16512 samples / 33068 bytes**. No fixed expected old sample total was used. |
| Actual release before transcription | Track stopped at **1794305357191**; partial tail received at **1794305357200**; worklet end at **1794305357201**; port closed at **1794305357207**; AudioContext closed at **1794305357208**; Main `finishing/cleanup=settled` at **1794305357211**; only then Main `transcribing/cleanup=settled` at **1794305357218**. Main ultimately idle/settled. |
| Desktop recording cancel | Actual tracks ended, contexts closed, Main settled. No new ASR call or canonical message. |
| Desktop ASR-pending cancel | Real held native HTTP request admitted once; actual peer response/socket aborted once. Releasing the peer response after cancellation did not add a message. No claim that a response was delivered after the socket abort. |
| Desktop source withdrawal | Real source trust-revocation confirmation stopped actual renderer tracks/context and settled Main lease/capture through the retirement notification. Withdrawal peer had zero ASR calls; accepted prior message remained. |
| Desktop connection retarget | Recording followed by real connection-form retarget to a second production service/Agent stopped old tracks/capture. New connection ID, target address and nonnull new Agent snapshot were checked. Old peer had zero ASR calls; second Agent had zero user messages; first Agent retained its accepted message. |
| Web permission denied | Independent origin-scoped denied context queried **denied**; real getUserMedia returned **NotAllowedError: Permission denied**; actual UI showed the permission reason; zero tracks, contexts, frames and ASR calls. |
| Web complete recording | Independent origin-scoped microphone grant queried **granted**. Actual getUserMedia/AudioContext/worklet loaded `/voice-capture-worklet.js`; own full HTTP capture path reached real service/provider/controlled peer and added exactly one further user message to the same Agent. Typed draft retained. |
| Web binary and tail | Worklet emitted **5 × 1600 + 576 = 8576 samples**. One actual HTTP audio POST had MIME **application/octet-stream**, declared samples **8576**, body **34304 bytes**, and all fixed ownership headers. Provider WAV contained **8576 samples / 17196 bytes**. Tracks ended and context closed. |
| Web recording cancel | Actual tracks ended; the UI returned to startable state after release. ASR count and canonical user count remained unchanged. |
| Native and Web production catalog controls | Each actual settings dialog saved an empty model; read the saved binding's actual catalog once; displayed **2 ASR candidates**, with unsupported `example/whisper-asr` disabled and TTS excluded; selected `xiaomi/mimo-v2.5-asr` into the UI draft while a real service read still showed saved model empty; explicit Save then committed the selected full model ID. Zero inference during catalog/save. Both surfaces passed separately through their real adapters. |

The report lists 12 runner check identifiers because the table groups catalog interactions and expands several transport observations. Successful finish moved canonical user count **0 → 1** for Electron and **1 → 2** for Web. Every tested cancellation kept that count unchanged. Equal synthetic transcripts from two distinct recordings remain two separate user inputs.

All native upstream calls were inspected by the owned loopback peer: fixed `POST /v1/magpie/native/xiaomi/v1/chat/completions`, User-Agent `dsh-pet-voice/1`, expected local client-ID authorization, bare `mimo-v2.5-asr`, `max_completion_tokens=1024`, bounded mono16k PCM16 WAV data URL. The logical saved model remained `xiaomi/mimo-v2.5-asr`. No live gateway/account or external model request occurred. Four peers in total observed audio counts **1 / 1(cancelled) / 0 / 1**, catalog counts **1 / 0 / 0 / 1**, and one actual aborted ASR response.

## Final build and cleanup

Full before/after SHA256 maps compare equal: **hashesUnchanged=true**. They cover the actual runner/helpers/tone, full Chrome and Electron executables, service dist and actual external workspace source exports, Main/preload/worker, builtin admission, console/pet JS/CSS/worklets, and relevant plugin source/dist. The prepared private full Chrome was selected explicitly; the earlier unsupported headless-shell was not reused.

| Selected executed input | SHA256 |
| --- | --- |
| Runner | `0aed5c5152f657ef83606713039430dec3e024c376069904dcab768e1fb86c9e` |
| Full Chrome executable | `377a9fc07b495c3b8d0ab8ec1fdfd153641759f9756fea34d8dfce4de82f5025` |
| Production service entry | `45ecb73b741912ca16a223bd0aa926b21816990a43a1b6eb4e861ab7de5609cd` |
| Console `index-Dml65atJ.js` | `a837a934c063adc95c493e13ea4acb1d33030a8c20f14bb946f70b92f37ec517` |
| Pet `index-BaoiBMiN.js` | `5b5696a7f12f4fd21fec0401c7431e6fd75b07ffdaa5c7b9d4bdddb8a29087d2` |
| Web client | `14450bbf7ff02def98efdc382e25a403114d1086d9cd1ba8db8561f0cdb0f9a5` |

The built service entry runs with its declared external workspace package exports via tsx; this is not a claim that every server dependency was bundled. Actual Electron Main/preload/renderer/runtime-worker production outputs were used. No source/module mock replaced the real service, capture, bridge, provider or UI.

Finally confirmed: native tracks ended, contexts closed, Main settled; Electron closed; browser closed; both production services handled SIGTERM with **exit code 0**; all four controlled peers closed; the owned Xvfb closed. Separate child HOME/XDG roots and SQLite data roots were used. Services and peers bound random **127.0.0.1** ports. There are no remaining owned running instances or background jobs.

QA changed only its authorized runner/new evidence/helper paths. It did not modify product code/builds, install tooling, commit, access private accounts/keys, use a physical microphone, contact live Magpie audio, touch original 4120 data, interrupt unrelated Xvfb displays or operate user containers.

## Screenshots actually inspected

All seven retained images were opened with `read_image` and contain only synthetic QA content:

- [Desktop catalog draft selection](./62621ec4-desktop-catalog-selected.png)
- [Desktop actual recording](./62621ec4-desktop-recording.png)
- [Desktop one accepted transcript and preserved typed draft](./62621ec4-desktop-finished.png)
- [Web actual permission-denied state](./62621ec4-web-consent-denied.png)
- [Web catalog draft selection](./62621ec4-Web-catalog-selected.png)
- [Web actual recording](./62621ec4-web-recording.png)
- [Web two distinct accepted recordings and preserved typed draft](./62621ec4-web-finished.png)

Visual observation outside the functional assertions: long catalog IDs create horizontal content scrolling in the settings dialog at the captured sizes. Read/select/save remained reachable and passed; this runner does not claim comprehensive layout or keyboard acceptance.

## Scope and remaining limits

This provides actual controlled production observations for Q1/Q2/Q4/Q5 and a frozen-run/cleanup contribution to Q7. Parent's separate root gate and Q3 Core/Docker continuity probe are separate evidence, not tests performed by this runner. The former native tail failure remains preserved in [5f655739](./checkpoint-5f655739.md). The former standalone headless-shell limitation is retained in the [private diagnostic archive](../acceptance.md#诊断留存与限制); it is resolved for the requested Web execution by the prepared full Chrome, without rewriting those earlier failed records.

Not tested here: Q6 live-provider recognition, physical OS microphone/recognition quality, Windows/macOS hardware and permissions, manual browser permission prompt UI, delayed native getUserMedia grant after cancellation, source/retarget races during every other asynchronous phase, optional preview/edit/retry/uncertainty flows or the full 20-second automatic cap. Web's browser permission was explicitly pre-granted/denied for the exact isolated origin under Parent authorization. Electron continued to use the real product Main permission chain. No automatic consent flag or real-account inference was introduced.

# Production synthetic voice checkpoint: failed tail integrity

Production run `5f655739` exited **1** at the normal desktop finish tail assertion. Execution stopped and every owned instance closed before reporting the product defect. Raw evidence: [run report](./5f655739-native.json), [pre-run hashes](./5f655739-before.json), [recording screenshot](./5f655739-desktop-recording.png), [post-finish screenshot](./5f655739-desktop-failure.png). Both screenshots were opened with `read_image` and contain only synthetic QA content.

## Actual observation

The real production Electron 45.0.0 Linux x64 console sampled the QA tone through actual `getUserMedia`, a real 16000 Hz AudioContext and the built standalone AudioWorklet. Main's real permission chain denied the same console's direct microphone request without a live capture lease (`NotAllowedError`). The fresh profile's capture source was disabled/untrusted; QA explicitly confirmed source trust and enabled the source using the existing product UI, without changing permission handlers or using automatic media-consent flags.

The worklet emitted `[1600, 1600, 1600, 1600, 1600, 1344]`: **9344 samples**. The controlled MiMo peer received one validated native request containing a WAV of **8000 samples**, 16044 bytes. The last **1344 samples** never reached Main's accepted sample count or the provider. Expected provider sample count equals the sum of all actual emitted worklet frames, including the partial tail; the assertion failed `8000 !== 9344`.

| Actual event | Unix milliseconds | Observation |
| --- | ---: | --- |
| Real microphone grant | 1794299027043 | Actual synthetic-device stream returned |
| AudioContext created | 1794299027046 | 16000 Hz |
| Production worklet module loaded | 1794299027063 | `capture-worklet-Du6ZZsMG.js` |
| Last full frame accepted in Main state | 1794299027582 | 8000 samples |
| Actual track stopped and finish command sent | 1794299027660 | Track state ended |
| Worklet partial tail and end marker received | 1794299027670 | 1344 samples then `end` |
| Worklet port and AudioContext closed | 1794299027671 | Context state closed |
| Main release settled | 1794299027674 | `finishing`, cleanup settled, still 8000 samples |
| Main transcription phase | 1794299027678 | Cleanup settled |
| Main idle | 1794299027809 | Capture cleared, cleanup settled |

The actual upstream request used `POST /v1/magpie/native/xiaomi/v1/chat/completions`, User-Agent `dsh-pet-voice/1`, the expected loopback public client-ID authorization, bare model `mimo-v2.5-asr` and bounded synthetic WAV. No catalog request or second ASR request occurred. Assertions before the failed tail check confirmed the same canonical Agent, exactly one user message `受控测试转录`, and preservation of the typed draft `保留的合成草稿`; the screenshot corroborates the canonical message. These partial successes do **not** close the production finish acceptance.

Source inspection points to the finish/send closing fence in [browser.ts](../../../../plugins/audio-capture/src/browser.ts): finish sets `closing` before requesting the tail, while `send` rejects frames after `closing`. This is a source-backed explanation of the observed desktop defect. A possible Web sample-count/body-length consequence was not executed and is not claimed as a production observation.

## Frozen inputs and cleanup

The report contains full SHA256 maps before and after execution for the runner, used QA helpers/tone, production service dist, external workspace source exports, Electron Main/preload/runtime worker, desktop console/pet JS/CSS/worklets, plugin dist/source and builtin admission. The maps compare equal (`hashesUnchanged: true`). The runner was extended only **after** this completed run; the raw report retains its actual executed runner hash.

Selected executed hashes:

| Artifact | SHA256 |
| --- | --- |
| Private Electron binary | `bcf2b3e430c49265f6da8b81b2f28032e0434155e1e7c4d8d7edfaf449b024dc` |
| Service production entry | `45ecb73b741912ca16a223bd0aa926b21816990a43a1b6eb4e861ab7de5609cd` |
| Desktop Main | `c533242414f5e7406861ffa111e6d9e5ede9a27782dd47832afb25a6afae2ddc` |
| Desktop preload | `81fc53eb0d14b4280879d44d5402e5b448114e76beb5676de266e6ed2229960b` |
| Desktop runtime worker | `dcd6cafdf54bd35d04ca4b5fdc4d1f849c8137bbb34b715a55a3f10316d2775f` |

The service ran its existing production `dist/main.mjs` with its declared external workspace package exports loaded via `tsx`; this is not a claim that all server dependencies were bundled. The production Main/preload/renderer/worker builds were used unchanged. The process used an independent SQLite data root plus separate child HOME/XDG roots. Only random 127.0.0.1 ports and an owned Xvfb display were used.

Finally confirmed: actual track ended, AudioContext closed, Main idle/cleanup settled; Electron closed; service SIGTERM exited code 0; controlled peer closed; owned Xvfb closed. All three managed runner jobs were collected. No product/build/install/commit, real microphone, real gateway audio, account/key access, existing display interruption or unrelated container action occurred.

## Earlier fixture corrections

- `76067835`: exit 1 because the runner assumed the fresh capture source was already active. Actual source was disabled/untrusted. No ASR. All instances closed; hashes equal. Runner corrected to use real source trust/enable controls.
- `c2dcd143`: exit 1 because Playwright `.check()` demanded an immediate checked state from an asynchronous product switch. No ASR. All instances closed; hashes equal. Runner corrected to click the real switch and await Main's active source projection.
- `5f655739`: exit 1 for the actual lost tail after real sampling and canonical message delivery, as described above. No product change was made during or after these runs by QA.

## Acceptance boundary and next execution

Q1/Q2/Q5 have partial actual native observations, but normal finish fails C9's required tail integrity. Cancellation during recording, ASR-pending/late results, source withdrawal, connection retarget and successful Web capture were **not reached**, because the first actual product failure stopped execution. Q3's independent Core/Docker evidence belongs to Parent's separate probe. Q6 real-provider/device evidence remains not run. Q7 is not complete.

Parent was informed immediately of the actual defect and cleanup. QA must receive a new source/build freeze after Parent's fix before running again. The QA runner has prepared the later source/target/cancel checks and, after Parent's explicit clarification, an isolated standalone Web context with an origin-scoped microphone grant. That Web grant is a user-authorized prerequisite and will not be represented as manual browser prompt validation; Electron's real Main permission chain remains mandatory. Those prepared additions have only passed `node --check`; they are not executed acceptance evidence.

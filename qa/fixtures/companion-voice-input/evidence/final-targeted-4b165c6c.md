# Final targeted production consumer regressions — 4b165c6c

**Passed: actual exit 0, eight checks.** This is the authorized targeted Linux production Electron run on the new frozen build, not a rerun or relabeling of the earlier Web/native full suite.

Primary evidence: [raw report](./4b165c6c-native.json), [hashes written before startup](./4b165c6c-before.json), [executed targeted cases](./targeted-cases.mjs). Managed job `bash-b712ac9602364e0f` was collected with actual exit 0. All owned instances are closed.

```sh
PET_VOICE_BROWSER_EXE='/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/browser/chromium-full-156-mirror-q6zv9a9g/chrome-linux64/chrome' \
  node --import tsx qa/probes/companion-voice-input-native.mjs --run-frozen --targeted-only
```

The private full Chrome path was supplied and its binary fingerprinted. This targeted native branch did not need or start a standalone browser. The earlier actual full Chrome + Electron scope remains accurately recorded for its previous build in [62621ec4](./final-62621ec4.md); that raw report was not modified.

## Actual regression checks

The runner first passed the real Main rejection without a live microphone lease, then explicitly trusted and enabled the capture source through existing product controls. The following six targeted checks also passed.

| Targeted scenario | Actual result |
| --- | --- |
| Voice state revision above Companion revision | Real sampling advanced voice revision to **35**, above Companion revision **16**. After actual directory read/provider save/feature save/stale provider save, Companion retained source **ready**, phase **live**, original connection/address/Agent, a complete snapshot and pending array. The actual console still rendered connected, admitted typing, and produced a new canonical typed message. This combines public Main state observations with a real consumer DOM/message check; it does not inspect or inject React state. |
| Independent provider draft, feature save and provider CAS | Feature preference save to review preserved the unsaved provider model draft and did not change committed provider model/revision. A real concurrent provider API save then advanced its Config and cleared its committed model. Saving the old open form returned fixed **“配置已被更新，请重新读取后保存”**; the unsaved draft remained and the newer saved model was not overwritten. |
| Catalog long-ID layout at 880×600 | Actual native window was resized to **880×600**. Actual catalog read and provider save completed. Dialog client/scroll widths were **423/423**, content **379/379**, document/viewport **880/880**: no horizontal overflow. Vertical scrolling remained available. |
| Arming and delayed real stream delivery | Real product capture entered arming with Cancel enabled and **no usable Finish**. The observer called the real getUserMedia and obtained an actual synthetic-device stream, then delayed only its delivery to product code. After cancellation, Main remained **retiring / cleanup pending / samples 0**, while the held real track was still live. Releasing delivery let product code stop that track and ACK release; Main settled, with zero ASR calls and zero added messages. |
| ASR 401 and 429 are voice-local terminal errors | Separate real controlled HTTP peers each received one actual ASR request and returned 401 or 429. Actual UI showed **“身份验证失败”** or **“请求过于频繁”**, respectively. Each added zero transcript messages, physically released capture and left the text connection live. A distinct actual typed message was accepted after each error. |
| Real 20-second automatic finish | No Finish click was sent. Actual sampling reached **320000 samples**, resulting in one bounded **640044-byte WAV** and one ASR request. Elapsed start-to-accepted-result time was **21160 ms**. Exactly one new canonical message/input ID was added; previous messages remained. |
| Review edit and explicit send | Recording in review mode returned one preview and zero new messages. Editing the preview still added zero messages. Explicit Send added exactly one new canonical message/input ID with the edited text. The separate typed composer draft remained unchanged. Only one ASR request occurred. |

The table expands several assertions within the runner's six targeted check identifiers, plus two setup checks, for eight total reported checks. Message verification uses actual before/after canonical message IDs and input IDs; equal transcript strings are not treated as proof of duplication or deduplication.

## Delayed delivery evidence boundary

The actual synthetic stream was granted at **1794307372308** and held by the observer before returning it to product code. Cancellation produced Main revision **39**, phase **retiring**, cleanup **pending**, and samples **0**. The observer still reported the real track live. Delivery resumed at **1794307372780**; product code stopped the real track at **1794307372780**, and its ordinary release path settled Main.

This is controlled delayed delivery of a genuinely acquired getUserMedia result, not an OS/browser permission prompt test. No synthetic stream object, fake permission result, fake bridge, replacement Main permission handler or forged release acknowledgement was used. The wrapper delegates to the actual browser call and actual track/context methods. The cleanup path also releases the QA delivery gate before draining capture if a test fails.

## Canonical message deltas

| Intent | New canonical input ID | Added user messages |
| --- | --- | ---: |
| Typed message after settings/state test | `8fc54235-fb6d-4391-a51a-262e9d9208f4` | 1 |
| Typed message after ASR 401 | `703a028a-ac89-471c-b225-7354aec41448` | 1 |
| Typed message after ASR 429 | `64dff51b-9a7d-477f-bd82-0ea6074351f5` | 1 |
| Automatic 20-second finish | `9ea153e2-625e-429a-b0f0-78d0a3e979e2` | 1 |
| Review before explicit Send, including edit | none | 0 |
| Explicit review Send | `057f538a-cbad-4e33-a2df-1459624d9c1b` | 1 |

Both ASR error captures and the delayed-stream cancellation added zero transcript messages. The accepted edited review text was `受控测试转录，已编辑-4b165c6c`; the automatic-cap text was the controlled peer's `受控测试转录`.

## Frozen inputs and actual cleanup

Before/after SHA256 maps compare equal: **hashesUnchanged=true**. They include the actual runner, targeted helper, observer, controlled peer, synthetic tone, private executables, production service dist/actual external workspace exports, Main/preload/worker, builtin admission, console/pet JS/CSS/worklets and relevant plugins.

| Executed input | SHA256 |
| --- | --- |
| Runner | `30efd61801e45032a5b3aac089f1a1f591f4049f05222e351f478a4f7d6c1e6d` |
| Targeted helper | `f2445463d643d7387ac4c6e4d6d2c3e6d5b0d0dc1fea61673b19c2c38390c952` |
| Capture observer | `e9457509616cf684e0d92a91d18b684e3961090a0b46a2076eea43dc741f7341` |
| Console JS, `index-D6vt4eTl.js` | `7e430d6178a3f2b5f01f8fca248fca0b68e259e8e0d9ec50d3dca4009e3b3942` |
| Console CSS, `index-K_KCqIS7.css` | `b4e3ff82e5b96e9db705888c2ae4a2648720bc9f1b2dcb8452f00ebe5c5dc851` |
| Pet JS, `index-C-yAv87j.js` | `9bd628952ce67ec74c4a5376862cde0fb4766fde9fdb80d476e0292c2ea586c8` |

Actual cleanup completed: tracks ended, contexts closed, Main idle/cleanup settled; Electron closed; the production service handled SIGTERM and exited **0**; all seven owned controlled peers closed; owned Xvfb closed. No browser session was started for this native-only extension. There are no remaining owned running instances or uncollected jobs.

All network listeners used random loopback ports. Child HOME/XDG and service SQLite roots were isolated. The service used its built production entry with declared external workspace exports via tsx; Electron used actual frozen Main/preload/renderer/worker artifacts. QA made no product/build/install/commit changes, touched no original 4120 data or private account/key, used no physical microphone, sent no live Magpie audio request and did not affect unrelated displays or containers.

## Screenshots actually inspected

All eight safe synthetic screenshots were opened with `read_image`:

- [880×600 catalog/settings layout](./4b165c6c-targeted-catalog-880x600.png)
- [Stale provider CAS preserves the dirty draft](./4b165c6c-targeted-provider-stale-baseline-retains-draft.png)
- [Cancellation awaiting delivery of a real stream](./4b165c6c-targeted-cancel-awaits-real-stream-delivery.png)
- [Fixed ASR 401 error](./4b165c6c-targeted-terminal-auth.png)
- [Fixed ASR 429 error](./4b165c6c-targeted-terminal-rate-limited.png)
- [Real automatic-cap canonical result](./4b165c6c-targeted-real-20s-auto-finish.png)
- [Edited review still unsent, typed draft preserved](./4b165c6c-targeted-review-edited-not-submitted.png)
- [Explicit review Send accepted](./4b165c6c-targeted-review-explicitly-sent.png)

## Remaining limits

This new run covers the authorized targeted native consumer regressions. It does not re-establish the previous twelve-check Web/native suite on this build, nor claim broader M2/M3 reruns. Web credential-write/dirty-draft behavior, every uncertainty/provider-retarget race, manual OS/browser prompt behavior, physical hardware, Windows/macOS and Q6 real-provider recognition remain outside this run. Parent's root gate and independent Core/Docker evidence remain separate. The old full-scope raw records and build fingerprints were preserved unchanged.

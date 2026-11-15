# M5 final controlled production native summary — d71f3948

**Passed: actual exit 0, ten checks.** Parent ran and collected managed job `b4a317bc33ed484a`; QA then read the raw result, exact applied-binding/profile/sink evidence, tool provenance and both screenshots. No repeat execution or raw-evidence rewrite was performed for this summary.

Evidence: [raw report](./d71f3948-native.json), [pre-start hash map](./d71f3948-before.json), [first completed reply screenshot](./d71f3948-first-completed.png), [final Pet screenshot](./d71f3948-final-Pet.png). Both images were opened with `read_image`; they contain only isolated synthetic QA content.

## Actual accepted scope

| Check | Executed result |
| --- | --- |
| Strict profile/default off | Generated profile supports linux-x64/win32-x64; actual builtin `pet.profile` is active, real preferences exist, and actual CAS save confirms `speechEnabled:true`. The local optional speech source remains off despite that legacy flag. A new formal reply with a valid controlled remote provider produces no TTS/player start. |
| Formal assistant automatic speech, one Pet player | Explicit UI source trust/enable/configuration admits one new formal scripted Harness assistant reply once. Real Main/preload/Pet WebAudio execute; first PCM is scheduled while the controlled native terminal is still held. Console creates no speech player context. |
| Reconnect/no replay | Matching fresh baseline is established after same-service reconnect. No historical request occurs in the recorded500ms observation window. |
| Cumulative audio above2MiB | **2,200,006 PCM bytes / 1,100,003 frames**,17 SSE audio events and34 actual response write/drain waits traverse the real service/Main/Pet path and complete. Pet peak active nodes **6**, chunks at most **64KiB**, ordered sequences and prior-chunk scheduling checks pass. |
| Complete long canonical reply | Real memory CAS writes and existing scripted Harness `say` publish a **7606-unit canonical assistant reply**. Native text parts are **2069 / 2062 / 3475 code points**, contiguous full-text coverage with matching per-slice SHA256, at most4 segments, one utterance identity and no extra logical FIFO slots. No renderer publication injection or raw SQL. |
| Whole stop during segment2 | First segment completes; stop while segment2 terminal is held prevents an old segment3 request. Source remains enabled; a later new reply is admitted as a different utterance and completes. |
| Partial failure/new reply recovery | Same configured binding emits `length` for one reply, which never becomes completed; its next new reply emits `stop` and is admitted/completed. No binding switch or hidden re-synthesis is needed to recover. |
| Actual disable | UI disable drains/releases current output and prevents subsequent formal replies from synthesizing while disabled. |
| Connection retarget | Old output is stopped/released; no old playback node starts after the actual old stop event, no extra old request and no old message lands on the fresh target. |
| Source trust withdrawal | Actual source revocation joins release and fences late/future synthesis; subsequent formal text remains independent. |

Canonical full-text SHA256: `a8b09f9170e5eaeb5a94996b5a3a3374f62746734bb1c90454b10e610e47b66d`.
The three native text-part hashes are `4e00aa9f5c5ccac6d255577677834864d24d6edd5ee7c0330b37de4f85c17fe1`, `75d7865e1d0908bdbbc97719ec02bfe0243f5668b83121e9510990199873fe98`, and `cb864e4071cb1ce5e52053015e5b44995259b69d7e19f723e29cb8906546b4c3`.

## Applied binding and real output routing

The runner waits for actual saved `readSpeech` providerRef/bindingId to equal Main's readonly `appliedBinding` on the current connection and a stable, locally settled state. It does not infer a new binding from a fixed revision count. For example, the saved provider revision3 binding `71f5bc51-2deb-44f9-8441-47786a61bfb8.2` equals the recorded stable Main applied binding before the new formal message; subsequent transitions are retained in the raw timeline.

Private Pulse15.99.1 used an independent Unix socket and only `module-native-protocol-unix` plus `module-null-sink`. Actual unique sink: **qa_speech_null / index0 / module-null-sink.c / s16le2ch48000Hz**. Actual sink-input PID **1862607** was checked through `/proc` ancestry to belong to the owned Electron process and mapped to sink0. There was no physical-device module. Public PCM/AudioBuffers use the24k mono codec; recorded actual AudioContext rate includes **44100**, while the software sink is48k stereo. Those distinct rates are not collapsed into a device-rate claim.

[Private tool provenance](../../../../.companion-data/tooling/pulse-null-d1i9P1/provenance.json) records the verified signed Ubuntu package-index chain, per-deb hashes, extraction-only daemon/pactl and three required private dependencies. Explicit PULSE_SERVER/PULSE_SINK, no-autospawn client config, self-contained null-only ALSA config and `--alsa-output-device=null` constrain software routing. WebAudio/bridge calls are real; the observer neither supplies contexts/nodes nor sends ACKs.

The final pre-process-close null-server check still saw one owned sink-input. This is recorded, not rewritten to zero. Actual node/context release was checked; subsequent Electron and Pulse process closure is separate. No assertion that the OS backend had zero clients before Electron exit, or that a person heard/stopped hearing sound, is made.

## Build and hash evidence

Actual app: **0.0.0 / Electron45.0.0 / Node24.22.0 / linux-x64**. Production service entry ran scripted mode at independent origins `http://127.0.0.1:42765` and `http://127.0.0.1:36265`, each with isolated data and child HOME roots. The built service retains declared external workspace exports; this is not an all-dependencies-bundled claim.

Before/after selected source/dist/runner/helper/plugin-manifest/tool-library maps compare equal (`hashesUnchanged:true`). Both bounded observer logs have `truncated:false`; absent events are not inferred from truncated metadata. Selected executed hashes:

| Input | SHA256 |
| --- | --- |
| Native runner | `340ead561c2469a515a500993b3f80ea03a54bbbbc24d06fa3a74eefd8ee059a` |
| Main production entry | `e5d45591e24adcd5a779ea849fb468cf62fc7b721822cfaf81d26cd785535e4f` |
| Service production entry | `c664fa53fe34ee4aa7bbf3715fe06bd705604dbe46c713a6124e370b56afe3ad` |
| Actual profile manifest | `dffd5c0c4602993c89475ec7a4e705fb63c23bed202a31277c8855c57048eece` |

Earlier blocked/partial runs remain their original build/cause/scope, including the profile generator blocker and35fad705's partial success. No independent inline lost-refresh test is relabeled as a native race reproduction. This new run actually retested the long path on the new Main build.

## Cleanup and limits

Actual cleanup: Electron exit **0**, both services exit **0**, every peer `listening:false/openSockets:0/pendingHandlers:0`, owned Xvfb closed, private Pulse PID1862426 exit **0**, subsequent private-socket connection rejected. Parent collected the job and reported no owned instances remaining. QA's follow-up was read-only; no new instance was started.

This is production controlled native/software-null evidence. It does not claim live Magpie/vendor quality, physical hearing, Windows/macOS, a latency distribution, full-process RSS, direct private consume-ACK timestamps, or manual permission UI. Reasoning/notice/multisay timing details remain layered source/gated-unit evidence; Core/Docker/ASR continuity belongs to the separately executed headless probe and is not counted among these ten native checks. Standalone Web zero-TTS with text/ASR is a separate probe being prepared, not a passed item here. Live TTS remains unexecuted and unauthorized; the one-shot proposal is separate. No original4120, DSH/account/key, product/build, old raw evidence or unrelated service/container was changed by this review.

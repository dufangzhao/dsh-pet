# M5 speech-output acceptance — verification complete

The optional Magpie TTS implementation has passed controlled production desktop/Web verification and the separately authorized one-shot live TTS check. The approved work commits are5e61f96/3287f42 and this child is archived; the session journal is maintained in the Trellis workspace. [PRD](../../../.trellis/tasks/archive/2026-11/11-11-shared-speech-output/prd.md) owns requirements, [code-spec](../../../.trellis/spec/backend/shared-speech-output.md) owns implementation contracts, and [operator guidance](../../../docs/39-shared-speech-output.md) explains use. This file is the canonical executed-scope record.

## Production desktop result

Parent-owned job `bash-b4a317bc33ed484a`, run **d71f3948**, actual exit0. [Raw result](evidence/d71f3948-native.json), [pre-run materials](evidence/d71f3948-before.json), [completed reply screenshot](evidence/d71f3948-first-completed.png), [final Pet screenshot](evidence/d71f3948-final-Pet.png). The completed-reply image was opened by Parent. Raw selected source/dist/runner/tool hashes match before/after; both bounded observers report no truncation.

All ten executed scenarios passed:

1. A real configured remote provider plus real active profile/saved legacy `speechEnabled:true` still produces zero TTS while the new local plugin is off.
2. Explicit source enable causes one new formal assistant message to synthesize once and play only on Pet. Actual source-node scheduling precedes the held native terminal; the owned Electron process has a verified input on the sole private Pulse null sink.
3. Reconnect establishes a fresh baseline without historical synthesis in the stated bounded observation window.
4. Actual playback of **2,200,006 PCM bytes /1,100,003 frames** completes. Pet peaks at **6 nodes**, IPC chunks remain at most64KiB, and the peer records34 real write/backpressure waits. This is about45.833 seconds at the fixed codec; it is not an all-process RSS measurement.
5. One formal scripted-Harness reply of **7606 UTF-16 units** is delivered as three contiguous slices of2069/2062/3475 code points, with exact per-slice SHA agreement and complete coverage. Full-text SHA256: `a8b09f9170e5eaeb5a94996b5a3a3374f62746734bb1c90454b10e610e47b66d`.
6. Stop during segment2 prevents the old third request; a later new reply still auto-plays.
7. A partial `length` result is never completed; the next new reply succeeds using the same binding.
8. Source disable actually releases playback and prevents future synthesis.
9. Retarget stops/releases the old playback without sending old audio or a message to the new Agent.
10. Trust withdrawal releases the owned playback and prevents late/future synthesis.

The actual app was Electron45.0.0 / Node24.22.0 / linux-x64. Its24kHz mono AudioBuffers and the actual private48kHz stereo null sink are separate facts. No physical speaker or human hearing is claimed. Both production services were new random loopback origins with independent data/HOME roots.

Cleanup passed: Electron and both services exited0; every peer reported zero sockets/handlers and stopped listening; Xvfb closed; private Pulse exited0 and reconnect was refused. No owned instance remained. No live3425 synthesis or external ASR request occurred.

## Other executed gates

- Full `pnpm check` passed through types, package tests, QA, lint, format and build. Relevant latest full-run totals were contracts328, service102, text-client260 and rootQA178 passed/4 expected skips. Final Main recovery changes additionally passed39 focused controller/connection checks, desktop types/lint and a fresh production build before d71f3948.
- Independent full-scope source review and targeted closure covered settings target/busy/CAS, source lifetimes, generated-versus-drained counters, actual player cleanup, current-target controls, lost refresh notifications and first-not-ready recovery. `appliedBinding` is a derived observation used to verify the actual selected Main baseline, not a second cache or authority.
- Actual headless **Core/Docker/held-ASR continuity passed**: [worker evidence](evidence/worker-901ed310.md). One TTS completion and cancellation preserve the same pending inference, ASR request and running container; final worker effect/artifact are exact. That independently frozen backend scope explicitly excludes desktop/renderer and later changed files.
- The standard Core gate passed all four cases with zero network calls. Controlled SSE fixture26 tests and live-proposal guard8 tests passed; guard tests are not live-model evidence.

## Standalone Web and one-shot live results

Standalone production Web run **c5852eaf** passed all3 checks with actual exit0: ordinary text round-trip, real fake-device getUserMedia/AudioWorklet capture to controlled ASR review without a new message, then edited explicit send once to the same Agent with the unrelated draft preserved. A real configured TTS provider stayed ready, while the page attempted zero speech endpoints and created/started no TTS buffer-source or media playback. ASR's own context/worklet is counted separately. [Web raw result](evidence/c5852eaf-web.json) records browser/service/peers/Pulse/Xvfb cleanup and unchanged hashes. Both peers' endpoints rejected connections after actual close. Parent opened the review/send screenshots. The prior be4d50e6 run passed the behavior assertions but exited1 because the QA incorrectly expected M5-only diagnostic fields on the M4 ASR fixture; it is not relabeled as a pass.

The user explicitly approved one live request: [live result](evidence/live-mimo-43147468.md). Ordinary `xiaomi/mimo-v2.5-tts` through local Magpie, preset `冰糖`, returned HTTP200/SSE and verified natural stop with119040 frames /238080 PCM bytes, **4.96 seconds** by the declared codec. Exactly1 native POST and1 audio GET were delegated, cleanup settled, no retry occurred, and the dedicated WAV was completed. The one-shot marker/authorization is consumed. This was generation/transport verification without a player; listening quality is not claimed. Parent's outer3848-file/dependency snapshot matched before/after, with absent optional dependencies recorded explicitly.

## Corrections retained in evidence

Earlier failed native runs remain honest failures. They exposed the Linux profile declaration dependency, the fact that its manifest is regenerated by the build script, a QA-only missing import, and insufficient configuration-baseline/locator preconditions. The generator is now authoritative and checked after build; Main preserves in-flight configuration notifications and exposes the actually applied binding. The earlier35fad705 checkpoint was only a partial old-build result and is not reused as d71f3948 coverage. Intermediate diagnostics were [retained privately with verified hashes](evidence-retention-c5852eaf.md), without deleting or rewriting their outcomes.

## Acceptance status and remaining work

| PRD item | Evidence / current state |
| --- | --- |
| S1 Source opt-in, formal event admission, order and no replay | Production default-off/auto/reconnect plus source/gated event-order and role checks; no claim of a production multi-say stress run |
| S2 Full long replies and bounded streaming | Production complete3-slice text and over2MiB audio; source tests cover long healthy clocks and parser/credit boundaries |
| S3 Stop, source/retarget and actual cleanup | Production scenarios6–10 plus gated late-work/failed-close regressions |
| S4 Core/work/ASR isolation | Headless actual Core/Docker/ASR probe, standard Core gate and current M4 voice regressions |
| S5 Controls, drafts and Web unchanged | Desktop controls, independent22 hook/draft regressions and standalone Web text/ASR with zero TTS passed |
| S6 Controlled production and live TTS | Native d71f3948 and the explicitly authorized live43147468 check passed within their separate scopes; live authorization consumed |
| S7 Documentation and Trellis handoff | Code-spec, operator guide and curated evidence are complete; approved work commits5e61f96/3287f42 and the archived child retain the handoff, with session journaling in the workspace |

Source/unit tests for reasoning/notice exclusion are not mislabeled as native model observations. Prior-version profile migration, physical output, Windows runtime, word-level hearing and an upstream live latency distribution have not been established by this suite. Original4120/data, DSH and unrelated profiles remain outside the test target. Stop/cancel receipts do not guarantee vendor computation or billing stopped.

# Shared voice input: implementation and acceptance

Current phase: the selected M4 scope is implemented and verified, including explicitly authorized real ASR. Full-scope review and final root/production checks passed. Await Phase3.4 work-commit confirmation, then archive/journal; no owned runtime remains running. Task remains `in_progress`, branch `feat/shared-voice-input`, after M3 journal `4d6ac41`. M3 work/archive/journal are complete. Roadmap goal was explicitly resumed after model-stream interruptions; latest parent revision is9. Do not claim inactive agents are running or that a partial gate is complete.

The canonical evidence/status record is [M4 acceptance](../../../qa/fixtures/companion-voice-input/acceptance.md). It distinguishes source tests, real controlled HTTP, production native capture and real-model inference. Maintain test results there rather than duplicating counts here.

## Decisions already settled

- All model roles initially use Magpie, including ASR/TTS. Independent own-identity `/v1/models?kind=all` discovery returned19 rows and the actual MiMo ASR/TTS refs. No gateway patch/restart or AstrBot identity/config dependency is needed.
- Preserve complete logical refs such as `xiaomi/mimo-v2.5-asr`; the native adapter maps to encoded vendor and bare wire model at the bounded native chat-completions route. `reasoning_content` is not a transcript. PCM remains outside control JSON/SSE.
- Explicit bounded utterance input, visible20s automatic finish behavior, default finish-and-send plus optional preview. One Agent, separate typed draft and voice preview, normal multiple-ID outbox, no audio cancel that stops unrelated Core/work.
- Main owns the console capture permission/ticket/lifetime; no Pet microphone or relay. Renderer acknowledges actual released resources, including late grants and old-frame cleanup-only ACKs. Desktop begin forwards rendered provider/revision/binding/mode via `VoiceBeginSelection`; Main only adds actual identity.
- TTS/full-duplex and other platforms are later increments, not rejected goals. Original4120/data remain outside QA.

Detailed reference research remains [voice entry](../11-06-unified-companion-architecture/research/voice-entry.md) and [voice UX](../11-06-unified-companion-architecture/research/voice-ux.md). The actual local AstrBot plugin3.0.0 and discovery patch were read, without user secrets/config/persona/screenshots or changes to that workspace. Exact source revisions and hashes are maintained in that research record.

## Current ownership and next gate

- Backend943be73a: service/runtime/Magpie/shared-voice complete and frozen; do not restart it without a concrete failure.
- Main0dfbbed8: fixed facade/permission/lifecycle/selection complete. Parent verified current desktop types and focused Main behavior.
- Earlier frontend2642/8de2 contexts are inactive. Parent closed normal-result early-clear, cancellation UI, console captured sender/native-retirement notification, and sampler finish-tail defects with regressions. No parallel writes to those files are active.
- DeepSeek2624edc6 completed and froze the actual retained-Demo thin adapter/shared worklet; removed the unused incompatible microphone-neutral entry and duplicate worklet implementation. Reported current desktop969 tests/types, neutral13 and related checks passed. Parent still owes final rebuild after all closing changes.
- DeepSeek757f9bf4 completed the saved-binding catalog picker and actual read/select/save wiring. Reviewer405bd741 then completed full-scope review and four consumer fixes (projection isolation, independent drafts/CAS, terminal errors, arming cancellation) plus bounded layout, all verified. Product writers are inactive.
- Parent added browser secure-context/API preflight before service ticket admission; three focused tests and component DOM23/23 passed. This does not claim an actual permission grant or hardware test.
- QA29a51596 completed frozen production evidence: the earlier full suite, then current-build native targeted and full-Chrome Web smoke. All actual reports, pre/post hashes and safe screenshots are indexed by acceptance, with scopes kept distinct. Every owned instance/job is closed/collected. Headless-shell limitation was resolved for testing by an isolated, verified full Chrome.
- Parent: package/build/lock coordination, Q3 Core/Docker continuity (passed), final quality/rebuild, final evidence/operator guide and Trellis closeout. Do not overwrite source during live native probes.

## Outstanding material

A pinned public three-second speech fixture was obtained through a mirror after direct Hugging Face networking failed, and matched original Git blob SHA1 `24a2bfc5c039f9d97db2cf1f2461699b582e0a90`. Local clip SHA256 is `17e7fba4b006f086d644468a94c937d0d8cff182d16e479887fefa913b2a9467`, under ignored `.companion-data/qa-private/companion-voice-input/public-speech-4v4u4zp5/`. Q6 was explicitly authorized by the user on2026-11-10 for this one three-second sample through Magpie/MiMo ASR, one upload and no Agent dispatch. Probe job `bash-be522bf51d234d40` has started. Do not rerun it if tool state is lost: inspect the private `live-mimo-3s-attempt.json` marker and its `reportPath` first. Result is now collected with exit0: one upload returned final/settled text“开放时间早上九点”in2655ms, with no Agent message/task; the isolated service is closed. The safe report is in the acceptance evidence. Do not run the probe again.

Next: confirm the concrete work-commit plan → commit code/spec and QA/operator/task records → archive this task and record its session → continue the authorized roadmap with Magpie TTS planning. Do not complete the broader roadmap goal at voice input alone, restart broad research, or reopen the Magpie routing decision.

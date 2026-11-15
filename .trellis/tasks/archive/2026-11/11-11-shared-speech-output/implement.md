# M5 implementation and verification

Implementation was explicitly approved on2026-11-11 after the final summary, with TTS required to use Magpie gateway model interfaces. Product code is now implemented; integrated verification is still in progress. [PRD](prd.md) owns acceptance, [design](design.md) records choices, and the [code-spec](../../../../spec/backend/shared-speech-output.md) points to actual declarations and executable contracts. Do not ask whether to start again.

## 1. Completed implementation slices

- [x] Establish real curated context and read applicable specs. Current implement/check manifests contain14 real entries each.
- [x] Declare browser-safe [speech contracts](../../../../../packages/contracts/src/companion-speech.ts), [desktop bridge/receipts](../../../../../packages/contracts/src/desktop-speech.ts) and [private runtime ports](../../../../../packages/companion-runtime/src/speech-output-types.ts). Limits and schemas live in source.
- [x] Add State `getMessage({id,eventSequence})` with actual event/message correspondence and read permission; mark it readonly in runtime. Speech admission separately requires assistant role; no DB migration or new canonical input.
- [x] Implement exact service-owned [text slices](../../../../../plugins/shared-speech/src/segments.ts). The canonical reply remains one FIFO item; slice concatenation equals the original text, without normalization or summary.
- [x] Implement ordinary [Magpie TTS provider](../../../../../plugins/tts-magpie/src/index.ts), incremental [PCM/SSE codec](../../../../../plugins/tts-magpie/src/stream.ts), private authority/credential binding and fixed native transport. Only configured Magpie routes are used.
- [x] Implement real service feature `pet.shared-speech`, single-consumer reserve/audio flow, known-ID cancel/status, bounded records and orphan/watchdog cleanup. Produced progress is independent from drain; actual whole cleanup releases the outer authority lifetime even with no subsequent client request.
- [x] Implement [Main controller](../../../../../apps/desktop/src/main/shared-speech-controller.ts), local task/media host, fixed preload and per-event consumption of the existing single SSE reader. Ordinary utterance failure preserves a healthy feed; connection/source/feed invalidation and explicit stop fence it.
- [x] Implement local optional `pet.speech-output`, explicit default-off ledger and startup/lifecycle integration. Production shared entry does not construct the legacy system-TTS controller. Quit waits for the actual Pet release before destroying its frame.
- [x] Implement [Pet stream player](../../../../../apps/desktop/src/renderer/speech-output/stream-playback.ts): bounded scheduled nodes, immediate short chunk-tail ACK, complete identity, real pending-resume/receipt/close joins and persistent failed-close eligibility across replacements.
- [x] Implement console configuration/Pet stop/status. Remote drafts bind captured companion target/provider/revision; local volume has its own first-edit revision and explicit rebase. Configuration progress does not cause remote polling. Local volume changes affect future replies; master sound off stops/refuses. Old speechEnabled is not automatic permission.

## 2. Reviewed regressions

- [x] Full-scope independent source review, covering State/contracts, backend authority/media, Main/preload, renderer/settings, startup/quit and QA boundaries.
- [x] Correct the settings test harness to model dependency equality, corresponding cleanup and isolated instances. Original green totals did not prove these boundaries.
- [x] Add regression cases for A/B equal revisions, disconnect during reads, obsolete-render actions, overlapping config/stop, real button busy state and dirty volume across external revisions.
- [x] Add producer-ahead failure counters and plan/attach/next-segment orphan authority cleanup regressions.
- [x] Add ordinary utterance failure followed by queued/new replies without an incidental refresh, and A-to-B arming/control-target regressions.
- [x] Add real gated player regressions for setup/receipt failure, stop initiating close before a held resume settles, late work and repeated starts after an earlier close failure.
- [x] Finish the targeted review closures, including notification coalescing, actual applied-binding projection and same-connection recovery.

## 3. Verification gates

- [x] Affected source packages have scoped types/tests/lint results. Exact executed scope is recorded only in [acceptance](../../../../../qa/fixtures/companion-speech-output/acceptance.md), not inferred from checklist completion.
- [x] Controlled service/native SSE/media/client round-trip, full canonical multi-segment delivery, cancellation, malformed/partial stream and source/CAS/revocation cases.
- [x] Headless actual Core/Docker/held-ASR continuity probe. The successful rerun preserved the same thinking request, ASR capture and background task through one TTS completion and one cancellation, with exact artifact bytes and complete cleanup. Backend/dependency/runner hashes were frozen; desktop/renderer were explicitly outside that probe's scope.
- [x] Full root `pnpm check` and diff gate passed. Later narrowly scoped Main fixes passed their regressions/types/lint and a fresh full build before the final frozen production run.
- [x] Production Electron/Main/preload/Pet/console run d71f3948 passed10 scenarios on verified private null output, including actual first PCM, audio beyond2MiB with bounded buffers, full3-slice text, stop/failure/disable/retarget/revocation and cleanup.
- [x] Standalone production Web c5852eaf passed3 text/ASR/explicit-send scenarios with ready TTS provider but zero Web speech requests/player activity. Source/unit versus production observation limits remain explicit.
- [x] User approved the exact one-shot live request; live43147468 passed with one native POST,119040 frames, verified stop and settled cleanup. Authorization and marker are consumed; no repeat is permitted.

No production/native instance may remain open when product/build files change. Controlled backend probes may freeze their own complete backend/dependency scope, but may not claim validation of a concurrently edited desktop surface. Unknown outcomes never authorize hidden re-POST, audio re-GET or fallback.

## 4. Documentation and closure

- [x] Write [operator guidance](../../../../../docs/39-shared-speech-output.md) with the actual loopback credential API, current UI scope and default-off behavior. There is no TTS Key web form or new environment injection to document.
- [x] Write the seven-section speech code-spec, link backend/frontend indexes and curate both task manifests. Keep API fields/limits in code and results in acceptance.
- [x] Finalize acceptance against actual source/build/live evidence; preserve intermediate diagnostics privately with a verified relocation manifest.
- [x] Present the concrete work-commit batch and receive the Phase3.4 one-shot approval.
- [x] Execute work commits5e61f96/3287f42 and archive only this child with rebased references. The separate workspace journal follows the archive commit; the parent roadmap and other unfinished tasks remain open.

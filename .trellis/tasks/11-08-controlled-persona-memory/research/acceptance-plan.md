# Persona/memory acceptance plan

Planning evidence only. Exact methods/DTOs come from the forthcoming implementation contract; this file does not define a competing API. No product code, instance or new model call was started by this plan. The parent owns final integration; GPT owns backend/state tests and DeepSeek UI tests.

## Existing facts to preserve

- [SQLite construction](../../../../plugins/state-sqlite/src/state.ts#L81) retains a DELETE-journal/EXCLUSIVE OS lock across commits. Migration tests must reuse that real writer boundary; no PID/lease-file substitute or parallel second writer.
- [Current remember](../../../../plugins/state-sqlite/src/state.ts#L518) fingerprints its payload, checks a prior command, and then requires a current fact row. Forget/version migration must not turn a known command into a new write or an internal error solely because its old fact disappeared.
- [Owner control](../../../../packages/companion-runtime/src/runtime.ts#L124) conflicts while input is queued, foreground is busy or a model check is active. Current-turn remember cannot acquire a control path that stops/waits for itself.
- [M1 actual natural input](../../../../qa/probes/companion-model-live.mjs#L164) was accepted with a stated preference and a natural key/value suggestion. Preserve it with a controlled model fixture; do not repeat paid inference to prove parsing or state ownership.
- M2 already verified production Main/preload, fixed service targets, native windows, source retirement and artifact publication. Extend the existing fixtures rather than build a fake bridge, alternate authority or new browser framework.

## Eight bounded acceptance cases

| Case | Primary evidence | Observable result |
| --- | --- | --- |
| A1 Persona save/application | Config/Harness controlled integration, real HTTP, one web/native UI path | Correct CAS saves only name/persona; id, unrelated configuration and workers remain. A next controlled inference consumes new canonical persona. Busy/conflict preserves drafts. Committed save with activation failure remains visibly saved/not-applied; no automatic model inference on save. |
| A2 Full active memory | Actual SQLite/HTTP/Harness projection | Existing bounds are enforced without silently clipping accepted values. Add and correction survive restart; forgotten fact is absent from canonical facts and recreated active projection, without claiming transcript erasure or model amnesia. |
| A3 ABA and stale mutations | Gated state/runtime tests | Capture old baseline, forget/re-add same key, release old UI/model write: conflict, no overwriting/restoration. Projection generation retirement also fences late writes. |
| A4 Durable replay | Actual SQLite command/events and dropped HTTP receipt | Repeat exact old remember/forget id after correction/deletion/restart: original receipt/current truth, no recreated row/new event. Changed-payload reuse conflicts. A failed precommit write can retry normally. |
| A5 Explicit request authority | Actual Harness handler with controlled responses | M1 natural prompt and an ordinary explicit no-key request work. Host supplies canonical input/generation/baseline/origin. Unrelated user text, quoted-only instruction, work-result input and invented nonverbatim fact value do not gain write authority. A quoted literal value under a real direct user request is not mistaken for a quoted instruction. Model semantic selection remains a stated limit, not a claimed proof. |
| A6 Work and cancellation | Existing actual Docker work plus owner mutation and controlled foreground | Work keeps same task/execution/artifact ids across persona/memory apply; no replay or loss of completion. Real drain failure does not activate a replacement. Current-turn remember completes without self-deadlock and preserves its committed fact if subsequent context refresh fails. |
| A7 Existing v1 data | Synthetic old-format SQLite, actual lock and crash/rollback checks | Preserve identity/epoch and all old rows/receipts; unknown legacy origin remains unknown. Backup precedes mutation and is verifiable. Failure before/within migration leaves a usable original/restore path; old writer rejects the new format. An already-open v1 writer blocks new exclusive admission rather than permitting concurrent mutation. |
| A8 Actual forms | Real web browser and production Electron with controlled service | Captured target and revision remain attached to edits/forget confirmation. External change preserves drafts, late old replies do not affect the new target, and own pending save does not flash a false external-change notice. Saved/application errors come from service facts. Focus/minimum layout and shared web/desktop data agree. |

## Migration fixture and rollback evidence

Create synthetic v1 fixtures from the known baseline schema/record formats before invoking the new provider. Do not create the supposed v1 fixture through an already-migrating new constructor. Include representative identity, message, fact, command, event, completed/nonterminal task and artifact records. Compare logical row content and identity before/after; only documented format metadata may differ. Keep backup hashes and exact version markers, but no original trial profile, credentials or account files.

Use a real second process/connection to demonstrate existing EXCLUSIVE-writer rejection. Injection of backup/transaction failures belongs in narrow tests around existing filesystem/SQLite calls; do not add a generic product fault-control API for QA. A backup/rollback procedure must not delete the only original or allow old code to write v2. Retained private test fixtures must stay ignored.

## UI and runtime evidence discipline

Use the existing Playwright/Chromium and private Electron/Xvfb setup. Actual DOM/React event order requires a real browser/window; pure-function tests and hook substitutes are supporting evidence, not DOM acceptance. Record run identity, runner hash before execution, production hashes and cleanup. Stop owned instances before product edits/builds. Native save/dialog tooling from M2 is not a new prerequisite for these forms unless the implemented feature uses it.

Preserve model connector and credentials during owner profile/memory application. Do not test this by printing a key: assert unchanged source/config/credential versions and controlled request counts. Show whether current reply generation is unchanged, refused as busy, retired or reapplied; do not conflate foreground state with independent task state.

## Final checks

Run affected state/runtime/service/Harness/protocol/UI regressions, actual cross-surface form tests and the complete root gate. Enable the existing explicit Docker image for required work/Core gates so default skips are not called real process evidence. No new live-model budget is needed. Windows-only device/compositor checks remain separately labeled. After tests, update one QA entry and the Trellis stage records, retaining only intentional safe evidence.

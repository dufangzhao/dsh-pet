# Parent integration review — 2026-11-08

Scope: source review at the first frontend handoff, before actual new-backend browser acceptance. Package tests passing do not by themselves prove form event/state transitions. No real provider call was made.

## Backend corrections with evidence

- Frozen capability `companion.model-connection@1` violated existing dot-segment CAPABILITY_ID_PATTERN. Real validateManifest rejected host/fixture and caused16 source-suite failures. Parent approved internal rename to `companion.model.connection@1`; no public DTO/API/plugin-ID change and no weakening of kernel validation. Backend owns consistent correction and rerun.
- Real aggregate snapshot55,101-byte state +22,050-byte model directory produced77,427 bytes, exceeding65,536. Parent approved only optional state snapshot byteBudget and reuse of existing projection trimming, preserving facts and omission flags. Backend reports actual bounded final envelope tests.
- Parent added .companion-data ignores to root ESLint/Prettier after observing private runtime/release files were in scope. Root-directory scanning now reports all-matched-files-ignored; Prettier and explicit root-config ESLint agree. A direct file lookup inside a nested worktree finds that worktree's own ESLint config, so it is not the outer scan check.

## Frontend corrections requested

Observed in the first model.tsx handoff (line numbers refer to that review state):

1. isDirty only considered nonsecret form fields; save button216 was disabled for key-only edits, while save101 always called nonsecret save. Split meaningful nonsecret/key dirtiness; key-only must call only credential CAS.
2. Connector235/baseUrl/auth changes89 retained keyInput. Clear a key bound to the old draft target on target change; never carry it to another connector/full URL/auth mode.
3. Input cleared only after successful nonsecret save121, not at dispatch; early failure116 retained it. Clear immediately when initiating the operation for all outcomes, with no automatic replay.
4. written.ok138 unconditionally claimed saved+applied; summary463 called desired=model/enabled=false a scripted foreground. Read actual applied/enabled/error and distinguish configuration from application.
5. seedKey effect69 replaced dirty drafts on external revision changes. Preserve drafts and bind expected revisions to their source baseline; do not silently submit an old draft with newly refreshed CAS values. Reconcile conflict explicitly before a fresh owner save.
6. Save/key controls did not account for foreground busy or active check. Reflect those facts without blocking an ordinary independent backend job.
7. checkLine438 considered stale only when both bindings were nonnull, allowing old verified display after unbind. Report verification only for the same actual binding.

Also requested: stable nonsecret intent handling after uncertain results, no late operation changing a reopened form, truthful first-time gateway-key setup when the current descriptor does not yet permit key entry, and real fixture-backed React/browser interaction tests. Frontend owns fixes/tests; no parent product edits in that range. Fixture UI tests remain separate from actual backend and real Magpie acceptance.

## Status

Backend implementing approved corrections and HTTP/source regressions. Frontend received the exact findings and must report corrected event behavior and meaningful regressions. Current trial remains stopped; original profile/token/release checkout preserved. Live provider acceptance still pending external configured target and explicit action.

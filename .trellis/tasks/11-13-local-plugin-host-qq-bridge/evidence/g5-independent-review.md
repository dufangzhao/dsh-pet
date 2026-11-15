# G5 / State4 independent review

2026-11-14. Read-only review of the current worktree on `feat/local-plugin-host-qq-bridge`, product HEAD `6897787`. Scope: execution binding/claim/task ownership, remote authority and native dispatch, opaque upload continuation, frozen sender target and terminal fact/cleanup reconciliation. Only this review document was written. No test, native probe, build, install, account, paid model or production operation was run.

## Result

**One P2 was identified and its minimal source fix has now been independently read-verified:** initial hold restoration could race a successful terminal fact report. Parent's patch orders report processing after initialization. No open finding remains from this scoped source review; the owner-run deferred-State regression is still separate execution evidence, not a test run by this reviewer. No execution replay, continuation retargeting or accepted-receipt erasure was confirmed in the inspected paths. This is not full product acceptance.

An initially reported P1 about migration/global memory quotas was **disproved and withdrawn**; the correction and baseline evidence are recorded below. It must not cause a quota/spec change.

## P2 — initialization can restore a hold after matching cleanup evidence removed it

Source snapshot: `apps/companion-service/src/qq-remote-delivery.ts`, SHA256 `8b0bc06c02480f9ad2d65f6f4fa852d211f1bb16ce19b29e018427c025e5586b`.

[initialize](../../../../apps/companion-service/src/qq-remote-delivery.ts#L150) reads a delivery asynchronously and adds holds from that snapshot at lines162–166. [report](../../../../apps/companion-service/src/qq-remote-delivery.ts#L548) does not await the shared initialization promise: it enriches the terminal State row, then deletes the matching hold at lines573–574. No ordering prevents an older initialization snapshot from adding the hold after that deletion.

Minimal controlled schedule:

1. Seed a terminal remote attempt with its original bound task and `cleanup: unknown`. Create a new `QQRemoteDelivery` and start `executionFor(account)`, which starts its initial State scan.
2. Let the scan's `getDelivery` obtain the old unknown snapshot, but defer delivery of that result to the initialization continuation.
3. Through the current authenticated same-boot reporting peer, complete a matching `report` with actual `cleanup: settled`. State now records the evidence, and `holds.delete` completes.
4. Resume the scan with the old snapshot. Initialization inserts its stale hold; `executionFor` reaches [held(account)](../../../../apps/companion-service/src/qq-remote-delivery.ts#L188) and returns unavailable despite the settled canonical evidence.

The source is unnecessarily blocked until the same evidence is reported again. This does not resend the old native operation, but it breaks recovery/new independent delivery after verified cleanup. This is an async-State-port interleaving identified from source; **the reviewer did not run this schedule**.

Source fix read-verified: [report now awaits the same initialize promise](../../../../apps/companion-service/src/qq-remote-delivery.ts#L558) before terminal enrichment/hold mutation. The initialization scan must therefore finish inserting its old holds before a settled fact removes the matching hold. The existing promise/map is reused, with no second registry or recovery ledger. Fixed source SHA256: `5cd5400706b94541dca25e55b53f4503ddb34507e1189fb7eb298842869c5cdc`. The owner-run focused regression should exercise the deferred State read above, preserve actual task/claim matching, and assert zero holds and a usable new source after the report completes; the original executionFor call may conservatively return unavailable while cleanup reporting is still pending. The old native effect count must remain unchanged. This reviewer did not execute that regression or claim it had passed.

## Withdrawn — migration memory quota allegation

The original allegation considered only the scoped precheck in `#mutateMemory` and incorrectly treated Alice17 + Bob16 private facts as a valid format3 root. That missed the post-mutation **global** check.

The current writer [checks management-wide memory before committing](../../../../plugins/state-sqlite/src/state.ts#L1000). Its [write transaction](../../../../plugins/state-sqlite/src/state.ts#L349) rolls back on failure. The same check already exists in baseline HEAD `6897787`: `git blame -L '/Global quotas/,+2' 6897787 -- plugins/state-sqlite/src/state.ts` identifies baseline line978, commit `f2aa4d1c`. The worktree diff confirms this mutation path was not changed by State4.

Thus the real old API cannot commit the33rd fact across audiences under the global32-fact quota. [memoryUsage(all)](../../../../apps/companion-service/src/migrate.ts#L118) does not reject a previously legal root on the basis alleged. A manually injected33-row database would not establish that regression. **P1 withdrawn; do not relax the global quota or alter the spec.**

## Concrete inspected coverage

- [State bind-once](../../../../plugins/state-sqlite/src/deliveries.ts#L373) matches frozen remote binding, source task owner, part/attempt and content hash. It admits first binding only for a live claimed attempt, accepts the identical existing task without rebinding, and refuses binding after terminal recovery. Existing absent-execution delivery fingerprints use the original public delivery body; an explicit remote target participates in its own immutable intent.
- [Terminal enrichment](../../../../plugins/state-sqlite/src/deliveries.ts#L452) requires the original bound task/binding/content. Receipt/correlation IDs merge without erasure and conflict on contradictory values; accepted outcome and recorded dispatch survive lower-information facts. Cleanup cannot regress from settled. Enrichment changes no phase, claims no new attempt and leaves optional voice preparation unchanged. The stopped [format3→4 schema upgrade](../../../../plugins/state-sqlite/src/schema.ts#L8) only adds nullable private execution metadata and changes the version, preserving old bodies/fingerprints.
- [Local execution](../../../../packages/local-host/src/qq-execution.ts#L293) checks the current authenticated session and captured source before creating the actual kernel task. Its authority request uses that TaskContext, and [wire media lookup](../../../../packages/local-host/src/qq-execution.ts#L275) verifies TaskSupervisor task-signal identity. Evicting a settled local observation does not remove State's original bind-once fence.
- [Fresh authority](../../../../packages/local-host/src/authority-check.ts#L30) returns a monotonic local deadline measured from request start, checks elapsed budget after the final local await, and does not cache authorization. [Operation scope](../../../../packages/local-host/src/qq-native/qq-operation.ts#L18) requires the actual active kernel task and identical task signal. Official HTTP/media and OneBot writes synchronously assert the deadline after their last local await, including the callback immediately before socket send. No forged unit signal was used as evidence here.
- [Opaque continuation](../../../../packages/local-host/src/qq-execution.ts#L342) retains the native object locally, matches binding/route/delivery/part/parent-upload/hash and requires a fresh following send claim. Redemption deletes the continuation once authorized; record/session fences and State's original task prevent replay. Retirement discards continuation usability while retaining observations. [inspect](../../../../packages/local-host/src/qq-execution.ts#L501) intentionally permits read-only same-boot/new-session facts for the original identity, but execution still requires the current session binding.
- [Server execution](../../../../apps/companion-service/src/qq-remote-delivery.ts#L247) rereads the exact claimed plan and bind-once task before returning permission. Direct result matching verifies operation/content/task/binding; reporting passes the original identity to terminal State enrichment. Unknown cleanup restores a source/account-scoped hold, rather than setting the sender's service-owned fatal drain latch. The finding above concerns ordering of restoration versus removal, not authorization to execute.
- [Sender preparation](../../../../apps/companion-service/src/qq-delivery.ts#L422) freezes remote execution selection; unavailable remote selection does not fall back to server-held QQ credentials. Existing deliveries return their recorded facts rather than choosing a replacement peer. Lost remote effects retain unknown cleanup; optional TTS checks the frozen source before synthesis. Same-attempt fact reporting does not reenter the sender controller.

Existing focused tests were read as supporting material, especially `execution.test.ts` and `qq-remote-delivery.test.mjs`; they were **not rerun**. No conclusion relies on their green count. Cross-boot/process-identity recovery is being implemented by its owner and is deliberately not reported here as another missing-feature defect. Raw custody, Windows packaging, GUI and the prior G0 wire review are outside this pass.

## Snapshot hashes

These hashes pin the source originally reviewed. The remote-delivery file's later barrier fix is separately pinned above; migration remained unchanged when the P1 hypothesis was withdrawn. Owners may subsequently revise the worktree.

| File | SHA256 |
| --- | --- |
| `apps/companion-service/src/qq-remote-delivery.ts` | `8b0bc06c02480f9ad2d65f6f4fa852d211f1bb16ce19b29e018427c025e5586b` |
| `apps/companion-service/src/qq-delivery.ts` | `11c9a163f6480f5c64ea709e5a57ecfc74e91a2ac24c8091eceaab4b5a8a8991` |
| `packages/local-host/src/authority-check.ts` | `85a2bfd56c665e7073d34b69704d5f5270151458ef2ca0f1f002de5a5573dc2c` |
| `packages/local-host/src/qq-execution.ts` | `9519521dc8d274468ad1e61f2aa4122b46777a2e84ecbdd40aa2966ff823585a` |
| `packages/local-host/src/qq-native/qq-operation.ts` | `5a4e1433b3d4c066cac8a22f8ad5f68153508bdd0c056be789a68119d6a4cc09` |
| `plugins/state-sqlite/src/deliveries.ts` | `b768c7caa1b8cec04d3178cacdd8f013ae67059e1420c4ab864cf89f3a0f4aa5` |
| `plugins/state-sqlite/src/schema.ts` | `c98aa555caf58d4a7f7a2a26bbd9c0b7c4bf6fe3184bfd3875eb447bddb65e69` |
| `plugins/state-sqlite/src/state.ts` | `c13501863264f4e87917ef0ac126d8c8dacb8e6efe884c3d31a92431e5e67f68` |
| `apps/companion-service/src/migrate.ts` | `d8c6d61b2d19984cdecda860572f1feeec96a925ac04af267cffca68061906f2` |

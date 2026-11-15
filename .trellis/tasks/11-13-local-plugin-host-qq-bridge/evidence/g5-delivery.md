# G5 remote native execution and sender evidence

2026-11-14, branch `feat/local-plugin-host-qq-bridge`. This is the single owner-run G5 implementation/evidence report. The separate [independent review](g5-independent-review.md) records the read-only reviewer findings. The final scoped matrix passed as recorded below; this is not whole-product acceptance.

## Implementation

- [Shared native adapter](../../../../packages/local-host/src/qq-delivery-transport.ts) is the moved implementation, with no service re-export shell. Runtime dependencies use public QQ package exports. [Shared types](../../../../packages/local-host/src/qq-delivery-types.ts) declare the closed execution, inspection and cleanup-recovery payloads once.
- [Sender](../../../../apps/companion-service/src/qq-delivery.ts) persists an explicit remote target or unavailable logical target. Only legacy absence or the explicit `service-local` selection calls the old native source. Remote unavailable never falls back. A remote unknown cleanup does not set the service-local fatal cleanup latch; optional voice still checks the captured source before synthesis.
- [Local execution owner](../../../../packages/local-host/src/qq-execution.ts) creates actual kernel tasks under the captured QQ owner, checks the actual owned OS process at entry, and uses the canonical fresh-check deadline at every native business boundary through the shared operation scope. Wire labels alone create no task authority. It retains actual results before an RPC response can be lost and keeps native upload objects only in bounded local continuations. Redemption binds the original session/source/route/part/hash/parent upload and consumes the continuation once.
- [Remote delivery owner](../../../../apps/companion-service/src/qq-remote-delivery.ts) uses the original private request check plus the actual State4 claim, frozen plan and source context. The original authenticated offer's process identity is committed with State's first task bind before positive authorization. It restores unresolved account-scoped holds from State and accepts same-attempt terminal evidence without replaying a command.
- Cleanup recovery is a separate closed `delivery.recover` inquiry. The local side runs only the read-only owned-process probe under `kernel.runManagement`, validates the module-private WeakMap proof and joins the real task/helper. The server reads the original persisted identity/task/process, sends a fresh challenge, checks the complete echo, and calls only State's transactional `settleDeliveryCleanup`. A new boot, ready source or plain JSON cleanup flag is not a proof. Ordinary report/inspect retains its original same-boot behavior.

## Completed executions

| Gate | Observed result |
| --- | --- |
| Legacy sender/native adapter after true extraction | 42/42 initially passed; later explicit unavailable/legacy checks brought the suite to44/44 at09:10. No production budget or assertion was lowered. |
| Explicit source selection | Four focused tests passed at09:57: explicit service-local available/unavailable both preserve absent execution metadata; remote unavailable preserves output without legacy fallback or voice; legacy absence remains compatible. The remaining tests were filtered, not failed/skipped acceptance. |
| Initial actual State4/native composition | Three cases passed at09:34 with eight equal before/after package fingerprints: lost acknowledgement/once-only effect/hold restoration/same-attempt enrichment/new input, credited image bytes/two-stage continuation, and denied authority/fabricated-stream refusal. |
| Native OneBot compound/file action and official later-denial smoke | Both passed in the10:05 smoke. The complete official6MiB case hit the test's default5s ceiling, then its later diagnosis identified the separate assertion problem below. |
| Complete6MiB official multipart | At17:02:34, the positive case finished in4.797s (runner5.65s), with prepare, two exact PUTs and finishes, commit and separately claimed publication. Eleven fresh checks cover three task admissions plus eight business requests. All bytes, native identities and private-reference assertions passed. The run had concurrent source changes, so it is diagnostic component evidence rather than the final stable-package gate. |
| P2 initialization/report race | At17:09:01, a real State4 read obtained the old unknown snapshot and was then deliberately held. Report could not enrich before initialization finished. After release, State cleanup settled, holds became0, a new native input succeeded and the old effect remained once. Focused1/1 passed. |
| Actual process-death recovery | At18:21:45, focused1/1 passed in2.723s (runner3.33s), exit0, eight before/after package fingerprints equal. Details below. |

The integration fixture uses real Host/State4/kernel/source-controller/native drivers, controlled TCP HTTP/WS and TaskMediaPeer bytes. Its State input/message seeds are explicit operator setup; they do not substitute for G3's participant/Core acceptance evidence. No RuntimeInputGrant is manufactured for these lower-level delivery tests.

## Actual process-death proof

[Recovery test and fixture](../../../../apps/companion-service/src/qq-remote-delivery.test.mjs) launch the [real local child](../../../../apps/companion-service/src/qq-remote-delivery.child-fixture.mjs). In the passing run:

1. Original child PID2999709 performed the native publication. Its OS-derived process stamp reached the server via authenticated `source.offer`; the first claimed task bind persisted that exact PID/start identity.
2. The bridge response was lost. State remained terminal/unknown with unknown cleanup and an exact hold. Reconnecting while the original child was still alive could not recover cleanup.
3. Original child closed its actual sources/tasks and exited code0. New child PID2999727 opened the same owned profile with a new boot. Boot/source readiness alone kept the hold.
4. A fabricated `{status:gone}` without the private WeakMap provenance was rejected. A wrong challenge following a genuine OS proof was also rejected. Neither changed the original State row.
5. Actual OS death proof allowed only cleanup to become settled. The complete delivery view matched the original after that cleanup change and the normal monotonic `updatedAt` metadata update; outcome, receipt, correlation, error, phase, preparation and original identity remained unchanged. Duplicate recovery did not alter the view.
6. The new child's execution count remained0 during recovery and the old native effect count remained1. A subsequent independent claimed input actually published, giving total2 with the old content still once.
7. Both children returned zero pending work/leases and exited0. The server had zero tasks, leases, RPC handlers and media streams. The resolved owned root `/tmp/remote-delivery-state4-0YbWTK` was removed after join.

Durable run files: [log](/tmp/pet-g5-recovery-jni9nl/run.log), [result](/tmp/pet-g5-recovery-jni9nl/result.json), [before](/tmp/pet-g5-recovery-jni9nl/before.json), [after](/tmp/pet-g5-recovery-jni9nl/after.json). These are external to package fingerprints.

| Package | Recovery-run SHA-256 |
| --- | --- |
| contracts | `ccb2e2f881f60f36dbe94c58b4cfbd24d4947415e3754841cc7eb037f07c0d99` |
| host-kernel | `501ed6e591fcb3370419e7eb64682fe11cab9c866e9a60e5042cdb38011d4d19` |
| companion-runtime | `6ba569184f0a3f2b412b2f0b4e3e534ff5f982976534394696fee15536a8982c` |
| local-host | `3700b2b4fa321e141df9e3796fb16f8eb7c76eb2bdb689ff7b7a0b21517b6e47` |
| qq-official | `ef5161ffb94ea400026a09983b95a0d8504cb5c2876ad9b0ce5b04bad35e4794` |
| qq-onebot | `d40fa31d5e3da4b07f1ac502933c9cc022fed64df1955bc899a5f2a0dc4756c2` |
| state-sqlite | `7304111a687690843aa45aeab18fcb8c12638becc0b13892df6ec67884fd64a7` |
| companion-service | `937f379ed6db549030dec9254a3d2a44a203c37719c495280f79881a30c01401` |

## Diagnosed failures, not passing evidence

The original complete-suite runs interrupted by runtime resets/SIGTERM yielded no final test count or after-hash. They are not counted as passes. Their isolated roots were recorded rather than deleted by a stale PID/prefix guess.

The bounded [first multipart trace](/tmp/pet-g5-diagnostic-EsitDw/run.log) proved that all native requests and State attempt writes had already returned accepted/settled before execution stopped at Vitest's generic deep comparison of two6MiB Buffers. It had not reached afterEach. Replacing only that assertion with byte length, native `Buffer.equals` and SHA-256 preserved exact byte equivalence; [the completed rerun](/tmp/pet-g5-diagnostic-Pizmk9/run.log) crossed that comparison in38ms and finished publication and every cleanup stage. This was a test assertion hang, not a demonstrated native cleanup hang.

The first process-restart fixture failed before second-child readiness. The revised operator setup reviews source trust before credential restoration can auto-apply a persisted enabled intent, checks every mutation's error and uses a bounded ready wait with safe phase diagnostics. A later failure was solely the fixture's assumption that State would not update `updatedAt`; reading the implemented cleanup transaction confirmed that metadata update. Both corrections were fixture-only; no business guard or State fact invariant was relaxed.

## Final matrix diagnosis and focused retest

The combined run at [final-d8Nmes](/tmp/pet-g5-final-d8Nmes/run.log) completed with 53 passed and 2 failed; its [source comparison](/tmp/pet-g5-final-d8Nmes/source-diff.json) shows all 362 files and eight package fingerprints unchanged. It is a failed run, not a passing matrix.

- The held-reader test reached its final new-input setup after confirming the matching accepted receipt, actual settled reader and zero holds. That setup incorrectly assumed the original local source remained ready. Its already observed response returned after cancellation; the existing official HTTP postflight path fences the source, which actually became `failed/stale-owner` with settled cleanup and a closed gateway. The test now asserts that state and the original effect count of one. The adjacent lost-ack test independently covers a new actual publication following matching cleanup without this source fence.
- The denied-check case timed out during fixture readiness, before any authority check. The readiness notification could arrive while `sources.view()` was pending and before the test captured its deferred notification. The fixture now captures the notification before reading the view, including the equivalent OneBot wait; no production timeout or authority was changed.

After these fixture corrections, the two formerly failing cases actually passed 2/2, with seven other cases filtered, exit 0. The held case checked active remote work and the exact hold during server close, refused premature reconciliation, then checked actual reader settlement, accepted receipt and released hold. The denied case recorded a real denied fresh check and no native publication. All cleanup stages completed. [Focused log](/tmp/pet-g5-two-bHwLmf/run.log), [before](/tmp/pet-g5-two-bHwLmf/before.json), [after](/tmp/pet-g5-two-bHwLmf/after.json), [comparison](/tmp/pet-g5-two-bHwLmf/source-diff.json): 362 files and eight package fingerprints unchanged.

## Final combined scoped matrix

The final single run passed **55/55 across three files**: 24 sender, 22 shared-adapter and nine remote-delivery cases. Both test and source comparison exited 0. [Full log](/tmp/pet-g5-matrix-SvAGS7/run.log), [result](/tmp/pet-g5-matrix-SvAGS7/result.json), [before](/tmp/pet-g5-matrix-SvAGS7/before.json), [after](/tmp/pet-g5-matrix-SvAGS7/after.json), [source comparison](/tmp/pet-g5-matrix-SvAGS7/source-diff.json): all 362 captured files and eight package fingerprints were unchanged.

All nine remote-case cleanup sequences reached their end. Both actual recovery children exited 0; server/local pending tasks, leases, RPC handlers and active media streams reached zero, and native handlers and sockets closed. Closed media peers retained terminal-reference markers in cases that transferred bytes; those are not active streams. The modified fixture also passed its individual ESLint and Prettier checks. Whole-workspace lint/type/format and broader integration remain separate. No GUI, Windows-device, live QQ, paid model, original4120 or broader product acceptance is claimed by this report.

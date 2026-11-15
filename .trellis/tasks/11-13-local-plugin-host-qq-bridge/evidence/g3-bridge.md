# G3 production bridge evidence

Status: G3 suite green 5/5 with real local source, native media bytes, notice custody and reconnect. Last checkpoint: 2026-11-15. This does not claim desktop GUI linkage, official inbound bridge, Windows runtime or paid model/account acceptance.

## Implemented on disk

- [Server bridge registry](../../../../apps/companion-service/src/qq-local-host.ts): ordinary bridge issuer context, owner Config CAS selection, authenticated peer/source binding, private real-task media mapping, projected ingress and delivery-manager hooks.
- [Daemon AgentLink](../../../../packages/local-host/src/qq-agent-link.ts): separate daemon connection and credential lifetime, ordinary source ownership, fixed source/input/material messages, actual source-task byte production and the existing execution owner for delivery.
- [Projection](../../../../packages/local-host/src/qq-input-projection.ts) and [canonical DTOs](../../../../packages/contracts/src/local-host-qq.ts): roleless bounded evidence, private locators retained locally, unchanged shared mapper identity helpers, handles excluded from canonical input evidence.
- [Ingress](../../../../apps/companion-service/src/qq-ingress.ts): projected input and legacy input converge on the same policy/private-grant/State/Core admission; proactive preparation receives the original server grant and scoped observation.
- [Service composition](../../../../apps/companion-service/src/service.ts), [HTTP server](../../../../apps/companion-service/src/server.ts) and [QQ management](../../../../apps/companion-service/src/qq-http.ts): explicit local/remote strategy, bridge ownership and host selection; remote selection does not reuse the old service platform-credential endpoint.
- Ordinary [server bridge plugin](../../../../plugins/local-host-bridge/plugin.json) and [local AgentLink plugin](../../../../plugins/local-agent-link/plugin.json) require actual factory-supplied private ports; their default exports do not fabricate readiness.

## Checks actually completed

| Check | Actual result | Limit |
| --- | --- | --- |
| Service TypeScript check | Exit 0 at the initial production wiring checkpoint | Not a native/effect proof; rerun after remaining edits |
| Existing QQ ingress suite | 6/6, exit 0; 12.36 seconds including startup | Covers real service/State/grant regressions, not the newly added remote path |
| Local-host TypeScript check after exact target receipt edit | Exit 0 | Runtime receipt races still need the new regression fixture |

The six retained ingress cases exercised capture before `createInput` awaits, sticky deny→restore, never-started owner/source loss without a preparing row, early media receipt with actual join, socket loss after byte handoff with retained policy grant, and proactive judgment/media under the same supervised task.

All background jobs from those checks were collected; the resumed checkpoint had no running jobs. No actual QQ account, paid model, SnowLuma installation or original4120 data was used.

## First approved remote run — 2026-11-14 17:31

The selected real-source/Core and exact-target-receipt cases ran under frozen source roots. The command exited 1: one passed, one failed, three unselected cases skipped, 16.32 seconds total. All ten before/after package fingerprints matched and every fixture cleanup completed. The job was collected.

The exact target/key receipt and no-op case passed. The real local source reached canonical State `input.completed`; its test then failed because the fixture expected `qq-private`, whereas the existing canonical audience is `person-private`. The reconnect assertions had not run, so that case is not a pass. Only that fixture assertion was corrected before requesting a new baseline/run. No production behavior, real account, or prior State/native attempt was retried.

The first-case-only rerun exited 1 after 13.15 seconds, again with matching ten-root fingerprints and complete cleanup. The corrected audience check passed, but the fixture then called `grantForWorkResult` with a QQ origin; that production API correctly rejected anything except `work-result`. The fixture was corrected to retain the **actual** `RuntimeInputTerminal.grant` by admission ID, verify the original origin/member role, and use its original signal/check. It detaches and clears that private map during cleanup. No production guard was relaxed, and the unexecuted reconnect assertions remain unpassed pending the next approved run.

## Real Core, native send and reconnect — passed at 17:47

The corrected first-case-only run exited 0: one selected case passed, four skipped, 14.51 seconds total. Its complete assertions ran: authenticated actual LocalPluginKernel/source/AgentLink → real Core and State completion; actual terminal grant with exact origin and member role; one native text send; retained original grant after bridge disconnect; same-daemon reconnect and duplicate native event without another model call or send; unchanged Agent through the original HTTP snapshot; no local State/Core plugin; captured process identity matching the actual OS/profile provider. Every cleanup joined and the job was collected.

All ten source roots matched before and after this run. Hashes:

```text
packages/local-host       59b9397e3c84998ff3e70b20b4c55c80da05fdde626f350fda071e8d31e992c2
packages/contracts        ccb2e2f881f60f36dbe94c58b4cfbd24d4947415e3754841cc7eb037f07c0d99
packages/host-kernel      501ed6e591fcb3370419e7eb64682fe11cab9c866e9a60e5042cdb38011d4d19
packages/companion-runtime 6ba569184f0a3f2b412b2f0b4e3e534ff5f982976534394696fee15536a8982c
packages/plugin-sdk       f88f9f246edbf414a61380578adf3e7869d79c0a49c491dfcd848b793b68ba57
plugins/qq-official        ef5161ffb94ea400026a09983b95a0d8504cb5c2876ad9b0ce5b04bad35e4794
plugins/qq-onebot          d40fa31d5e3da4b07f1ac502933c9cc022fed64df1955bc899a5f2a0dc4756c2
plugins/local-host-bridge  614345b7b38fb1ab0d3a558fd5a823a069116710cb7bed64dfd2300790145b2e
plugins/local-agent-link   24ea439be281bde5408ff94eebb79219d4fbc6663234114edee76abf561ca54b
apps/companion-service    4a92c09bb5f825b13cc006a3b977109ae9bea9af11c0ce3becd5c531d227f320
```

This is a controlled Node/OneBot production-path result with manual authenticated HTTP host selection. It does not claim the desktop GUI linkage, official incoming bridge, media, Windows runtime or paid model/account acceptance.

## Resolved: the two earlier failures were fixture polling, not product defects — 2026-11-15

Both 17:51 failures had one cause: `completed()` waited for `phase === 'completed'` with
`vi.waitFor` re-entering `runtime.state('getInput')` every 50ms. Every such call is a full
capability/task round trip that reaches `PermissionEngine.isTrusted`, and `isTrusted`
unconditionally re-hashes the whole plugin package through `packageFingerprint`. The polling
therefore generated a synchronous SHA-256 storm on the main thread — measured in one run as
56,768 `readFileSync` + 5,757 `readdirSync` calls (~2.15GB read) all inside `plugin-host.ts`,
with `monitorEventLoopDelay` max ~80-105ms and the main thread ~95% busy while a plain
`lstat` took 0ms and a separate process read the same files in 0.2ms. That is loop starvation
from the fixture's own polling, not slow filesystem, not a Config lock, not threadpool
contention (reproduced identically on an idle machine at load 1.28).

Fix is tests-only and changes no production byte: `completed()` now subscribes to the real
`runtime.onInputTerminal` for that exact admission id, sends the native event, awaits that one
event under the original 15s budget, detaches in `finally`, and reads committed State **once**.
The context-only notice case waits on the real AgentLink `onReceipt` admission result
(`state === 'observed' && inputId === null && eventKey === mapped.eventKey`) and then reads
`getObservation` once. A context-only notice carries `inputId: null` by design
(`qq-ingress.ts` reports `receipt(eventKey, 'observed', null)`), so it must be matched by event
key, not observation id. No generic waiter framework, no seeded State, no fabricated grant.

A superseded inference is recorded once so it is not re-opened: an earlier note claimed the
hash storm came from per-chunk `access.check()` during media transfer. That was wrong — the
byte case had zero chunks at the time. No `access.check()` amplification is claimed or fixed
here. The decision not to add a TTL/lease fingerprint cache stands: caching would relax the
confirmed package-change revocation semantics, and the actual cause was the fixture.

## G3 suite result — 5/5, 2026-11-15

```
✓ authenticates the actual local source and reaches real Core once across a bridge reconnect   4987ms
✓ moves real native file bytes through the task byteplane without exporting the private locator 11276ms
✓ loads a real context-only file notice through the scoped work producer and reuses server custody 14122ms
✓ returns its own target/key receipt and preserves the baseline for a Config no-op              1141ms
✓ rejects a wrong Agent bearer without hanging readiness or creating an input                  1162ms
Tests 5 passed (5)   Duration 33.98s
```

The byte case now asserts actual reader bytes (2,097,171), EOF, full-payload equality, matching
sha256 and exactly one `download_file_stream`. All ten source roots matched before and after
(`changed: []`), no `store-slow` events occurred, and every cleanup stage joined.

Static checks for the four owned files (`qq-local-host.test.ts`, `qq-local-host.ts`,
`qq-agent-link.ts`, `qq-input-projection.ts`): `tsc --noEmit` clean, `eslint` clean (0 problems),
`prettier --check` clean. Control-character guards were replaced with the existing contracts
idiom (`charCode >= 32 && !== 127`) rather than suppressing `no-control-regex`. Regression
suites: `local-host` 15/15, `companion-runtime/local-host-trust` 2/2.

Known unrelated failure: `apps/companion-service/src/model-controller.test.ts` "budgets real
SQLite history…" times out at 20s. That file is unmodified in this work and fails on the
committed baseline; it is not caused by and does not gate G3.

## Required completion evidence

- Actual local kernel, both native sources and AgentLink through the authenticated production registry to real State/Core; same Agent and no local State/Core.
- Wrong bearer/host/role metadata and wrong task/stream identities denied without native effects or extra model calls.
- Canonical duplicate identity across reconnect, exact source retirement and no automatic native resend.
- Actual material bytes, hash/budget enforcement and successful native-reader join; server processing after completed raw custody remains independent of the bridge socket.
- Closed historical file-observation selector with the original scoped server work preparation; explicit legacy opener and no remote-to-legacy fallback.
- Exact target Config commit receipt/key generation, unchanged-target no-op preserving the key, and late cancellation retaining committed facts.

Native tests are coordinated with the parent to keep source fingerprints stable. A source change during a proof window invalidates that window's evidence; it is not silently counted as a software failure or a pass.

# G1 State 4 persistence evidence

Executed 2026-11-14. This records the State/migration gate, not full G0, bridge integration, or whole-task acceptance.

## Implemented boundary

The canonical private API is [State types](../../../../plugins/state-sqlite/src/types.ts). [The writer](../../../../plugins/state-sqlite/src/deliveries.ts) adds immutable remote/unavailable execution targets, one-time local task binding, and terminal-only same-attempt fact enrichment. Shared source/task guards come from [contracts validation](../../../../packages/contracts/src/validation/index.ts); their metadata is not an authority grant.

- One nullable `qq_deliveries.execution_json` column; at most 16 private attempt entries and 16 KiB. Public delivery views/events omit private peer/task data. The existing 64 KiB control and 60 KiB State-result budgets remain unchanged.
- Absent execution retains the exact legacy `fingerprint(delivery)` and explicit service-local meaning. Remote/unavailable intent includes execution in its fingerprint; retries cannot change or remove the target. Unavailable targets are blocked and non-dispatchable.
- `bindDeliveryTask` binds an existing pending claim to its original binding, content hash and actual local task reference. The host must await that commit before returning its first positive fresh-check permission. A terminal report cannot invent the first task binding.
- `updateDelivery` and recovery retain positive dispatch evidence before sealing the public phase. Enrichment requires the original target/task and a terminal delivery/settled attempt. It preserves known acceptance, rejects conflicting non-null receipt/echo values, advances cleanup monotonically and never reopens sending, claims or optional voice. Cleanup may settle while the effect remains unknown.
- Existing conclusive failed/rejected/cancel-before outcomes are not rewritten as another conclusive outcome. Transport loss must be recorded as unknown when its effect is uncertain.

[The schema upgrade](../../../../plugins/state-sqlite/src/schema.ts) and [cold migration](../../../../apps/companion-service/src/migrate.ts) compose supported formats 1/2/3 to 4 under the existing exclusive writer lock and verified external full-root backup. The 3→4 step only adds the nullable column and version: no old body, ID, timestamp, scope, fingerprint or receipt rewrite; no recovery/IO replay. Normal open refuses older formats.

## Executed checks

From the State package:

```sh
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run
```

Typecheck passed. **67/67 tests across seven files passed**, including the retained 60-test suite and seven [execution regressions](../../../../plugins/state-sqlite/src/execution.test.ts). Coverage includes legacy hashes, private-read scope, immutable target/task identity, dispatch retention through restart, terminal receipt and cleanup-only reconciliation, no voice reopening, unavailable targets, duplicate idempotence and event-failure rollback. The [manifest test](../../../../plugins/state-sqlite/src/index.test.ts) verifies the new read/write method permissions.

From the service package:

```sh
node node_modules/vitest/vitest.mjs run src/migrate.test.ts src/migrate-v3.test.ts src/migrate-v4.test.ts
```

**5/5 synthetic migration tests across three files passed**. The independent [format-3 fixture](../../../../apps/companion-service/src/migrate-v4.test.ts) verifies backup bytes, unchanged legacy intent/claim data, no automatic replay, live-writer exclusion and rollback of the private column/version with a failed transaction. Scoped ESLint and Prettier checks passed for the owned State and migration files.

After those gates, the duplicate State `QQFileEvidence` interface was replaced by a type-only import/re-export of the identical [contracts definition](../../../../packages/contracts/src/companion-qq.ts). The existing State type export remains available. State typecheck passed again; the full tests were not unnecessarily repeated for that erased type-only change.

## Limits and handoff

All State/migration fixtures used isolated temporary SQLite roots. These tests do not establish real bridge task provenance, native permission freshness, physical remote cleanup or platform acceptance; the parent owns that integration and native evidence. No real QQ/SnowLuma connection, paid model, original4120 data, dependency installation or Git operation was performed. No bundle/root build was run; the parent owns artifact rebuild, runtime read-method integration and whole-workspace validation.

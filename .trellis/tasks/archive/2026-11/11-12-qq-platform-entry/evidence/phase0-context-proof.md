# Phase 0 — retained Cortico contexts and FIFO model permit

Executed 2026-11-13, Asia/Shanghai. **The scoped SDK/permit gate passed.** This does not complete Phase 0's other media/contract gates or the QQ runtime integration. Frozen result and source hashes: [phase0-context-proof.json](phase0-context-proof.json).

## Changes owned by this slice

- [model-permit.ts](../../../../../../plugins/harness-cortico/src/model-permit.ts): one FIFO native-model permit; `run(signal, operation)` parks before entering the operation. Queued cancellation removes only that waiter. An active caller's abort does not release the permit before the operation actually settles. Native values/errors retain identity. The caller remains responsible for joining any native/credential work before its operation promise settles.
- [permit tests](../../../../../../plugins/harness-cortico/tests/model-permit.test.mjs): FIFO order, active cancellation versus physical settlement, cancelled parked waiter/no borrow, already-aborted and grant/abort race, error identity and subsequent progress.
- [proof](../../../../../../qa/probes/companion-qq-context-proof.mjs) and [isolated fixture](../../../../../../qa/fixtures/companion-qq-context-proof/runtime.mjs): real Cortico Core, native Session/event files, TaskSupervisor and CredentialBroker. Provider responses, credential authorization and independent work bodies are synthetic and explicitly controlled.

No main Harness index, existing Harness facade or runtime wiring was edited. No public origin/material/QQ contract, model-connection source or existing data was edited by this slice. No commit/push, account login, QQ message, real model, Docker job, desktop device or HTTP service was used.

## Executed commands

All completed successfully as foreground commands; no background job remains.

```bash
node --import tsx --test plugins/harness-cortico/tests/model-permit.test.mjs
node qa/probes/companion-qq-context-proof.mjs
node node_modules/typescript/bin/tsc --noEmit -p plugins/harness-cortico/tsconfig.json
node node_modules/eslint/bin/eslint.js plugins/harness-cortico/src/model-permit.ts plugins/harness-cortico/tests/model-permit.test.mjs
node node_modules/prettier/bin/prettier.cjs --ignore-path /dev/null --check plugins/harness-cortico/src/model-permit.ts plugins/harness-cortico/tests/model-permit.test.mjs qa/fixtures/companion-qq-context-proof/runtime.mjs qa/probes/companion-qq-context-proof.mjs
```

Unit result: **4 tests, 4 passed, 0 failed/skipped**. Package typecheck, scoped source/test lint and all four files' formatting passed. No full workspace or native/UI acceptance was started; Parent owns those gates.

The final proof ran at `2026-11-12T20:59:25.268Z` (2026-11-13 04:59:25 Asia/Shanghai), on Node26.13.0. Its raw generated [report](../../../../../../../../../../tmp/companion-qq-context-proof-AV93AJ/report.json), [ordered trace](../../../../../../../../../../tmp/companion-qq-context-proof-AV93AJ/trace.json) and native context directories remain in that fresh temporary root. The checked-in task JSON preserves the result/source hashes; raw local files are not claimed to be permanent remote artifacts.

## Actual assertions and outcomes

| Gate | Evidence established |
| --- | --- |
| Two live isolated contexts | A and B have different dataDir, Core SessionLog, event store and WakeBus; actual model inputs and persisted native tails contain only their own private canary |
| One primary native dispatch | Entry order starts `A:1 → B:1 → A:2 → A:3`; maximum native concurrency is1 |
| Permit before credentials | B has already requested/parked while A holds the permit, but B has no credential lease or provider call; its real broker borrow starts only after grant |
| Retained native effects | A's second request still contains original native `A-work-1`/`A-work-2` calls and their actual TaskSupervisor task IDs in tool receipts |
| Multiple work starts | A starts3 separate supervised synthetic work tasks across its original live turn; no context reconstruction or one-task cap |
| Independent close | B's close remains pending behind its actual World disposer; A's active native signal stays un-aborted and A starts further work after B closes |
| Work lifetime | Accepted synthetic worker tasks remain physically pending after their input context closes, then settle only after their independent gates release |
| Cancelled parked input | D cancels while C owns the permit; D produces zero broker borrows and zero native calls and actually closes |
| Logical versus physical cancel | C's supervisor result cancels before its synthetic native promise returns; context close stays pending and the permit remains active until that native operation is explicitly released and the broker task joins |
| Complete cleanup |5/5 native calls settled;4 Worlds and4 contexts joined; stop failures0; task active/pending/retained counts0; credential pending uses/work0; leases0; permit active=false/waiting0 |
| Loader lifetime | One source-owned namespaced tsx registration; actual async unregister is awaited after context/native/task/broker cleanup and is the final trace event |
| External activity | Network guard count0; no live endpoint/account/model/provider/device used |

The proof does **not** establish participant authorization through PermissionKernel/PluginManager, canonical State admission/effect durability, aggregate product status, image resolution, media codec readiness, protocol transport, or end-to-end QQ behavior. Its fixed owner readiness and credential grants are test composition. Production integration must preserve and separately verify those existing authorities rather than copying fixture grants.

## Next smallest integration slice — handoff only

Wait for Parent before touching the main Harness/index/runtime. Once source contracts are handed off:

1. Keep public `Principal/Audience/InputOrigin/TaskOrigin` as metadata. Bind the live grant and context token privately in runtime/Harness ports; do not turn a public origin into authority.
2. Let the ordinary Harness source own one loader, one `ModelPermit`, and a bounded input-context map. Each context captures immutable input/scope/route, its own directory/native tail and real task/cancel/join handles. No per-person idle cache.
3. Place `permit.run` **outside** the authorized primary client's `respond` call so parking creates no model/credential task. Pass a projection-qualified session/cache identity. The native operation promise must still include actual source/broker settlement.
4. Replace singleton current projection/status acknowledgements with per-context records and aggregate busy/ready/application state. Context finish only signals outward; an outer owner retires it after the Core hook returns. Closing A must not clear B's grants/application or close the common primary connector.
5. Preserve full input/task origins and multiple work effects; do not reconstruct an effectful interrupted/crashed input automatically. Complete the production actor/audience and source-revocation assertions in the integration gate.

## Tooling observation

The first `pnpm exec prettier` invocation unexpectedly performed automatic workspace dependency synchronization before formatting (`40 projects`, `downloaded0`, `added0`). Other agents were concurrently adding QQ packages/contracts; a lockfile change was observed and reported to Parent, not reverted or attributed exclusively to this slice. Subsequent checks used the already installed Node tool entrypoints above to avoid further automatic synchronization. No dependency was intentionally added for this proof.

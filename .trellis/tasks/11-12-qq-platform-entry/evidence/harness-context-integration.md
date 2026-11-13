# Input-owned Harness implementation — package gate

Executed 2026-11-13, Asia/Shanghai. **25/25 package tests passed**, with package typecheck, scoped ESLint, Prettier check and scoped diff whitespace check passing. This is the ordinary Harness implementation gate after the separate [Phase0 SDK/permit proof](phase0-context-proof.md), not full runtime/State/QQ acceptance.

## Owned changes

- [Private declarations](../../../../plugins/harness-cortico/src/harness.d.mts): required `queueSignal(inputId)`, `inputRejected(inputId,contextId,error)`, `bindInput(input,contextId)`, `HarnessInputBinding`, per-input ports, `HarnessInputTerminal`, host-resolved native image parts and `bootstrapRetired`. `stopWork` now receives `HarnessOrigin`. Public origin is metadata; only the host binding/callbacks carry live authority.
- [Harness](../../../../plugins/harness-cortico/src/harness.mjs): default2/hard4 active input contexts plus a separate global16 ready bound; one source-owned loader and FIFO model permit; fresh independent directories/native tails; projection-qualified provider session/cache identity; scoped tool visibility/application/publication; terminal retirement outside Core hooks; actual callback/native/World join; final asynchronous loader unregister.
- [Ordinary plugin facade](../../../../plugins/harness-cortico/src/index.ts): exports new private types and preserves fixed kernel error codes, including capacity and binding refusal.
- [Package tests](../../../../plugins/harness-cortico/tests/harness.test.mjs): all fixtures now supply explicit host bindings; old multi-input merging expectations are replaced by isolated-context/FIFO expectations.

This slice did not edit runtime, State, public contracts or model-connections. Parent owns those integration changes. No commit/push, production service, real model, QQ account or original4120 data was used. The existing Responses transport test uses its own short-lived loopback fixture and synthetic key; it closes its connections/server.

## Exact host-facing lifecycle

1. Source initialization builds a real owner-only bootstrap and acknowledges its installed context through root ports. No external input uses those ports implicitly.
2. Queue admission first obtains `queueSignal(inputId)` from an already registered host input; it carries cancellation only, no role or active claim. Unknown IDs are refused by that private host port. `bindInput(input,contextId)` is called only after an actual context slot is available. Missing/refused/invalid binding causes no native request and no owner fallback.
3. A successful first binding retires the empty owner bootstrap and invokes `bootstrapRetired`; the scoped context then uses only its own `projectionApplied/projectionFailed` callbacks. The host supplies immutable origin/role, signal, private callbacks, resolved image parts and terminal persistence callback.
4. `accept` keeps `Promise<void>` and capability `value:null`: ready inputs return after bounded enqueue, immediately started inputs after event submission. Same live ID/payload shares admission; changed payload conflicts. Active contexts and ready records have separate limits. Durable duplicate/restart and per-audience4 policy remain State/runtime responsibilities; there is no idle completed-input cache.
5. The permit is acquired before invoking the authorized model client. A parked context keeps its original tail/receipts and can be cancelled without entering that client. Multiple work starts remain legal.
6. Natural terminal processing waits publications, then signals outer retirement. The terminal callback receives `inputId/contextId/status/cleanup/error` after the retirement result. Its acknowledgement must complete before a clean context slot is released.
7. `cleanup:'failed'` is not confirmed physical drain or permission to freeze a complete successful delivery batch. The context remains unavailable and replacement is blocked. Source close joins remaining tracked operations before unregister; it still reports the prior cleanup failure.
8. Never-bound ready cancellation or later binding refusal calls `inputRejected`, not owner `finishInputs` or a fabricated binding terminal. These captured bookkeeping callbacks are invoked even after source fencing/close. Pending acknowledgement still counts against retained capacity.
9. `stopForeground()` cancels current/ready inputs and, only after confirmed cleanup, installs a new owner bootstrap. It does not replan the cancelled input or stop accepted independent work. Source close also joins a pending binding/bootstrap read; cancelling a reset during close is not mislabeled as failed resource cleanup.

`HarnessResolvedImage` carries host-authorized `input_image` parts. They enter the isolated native `sessionHead`/request; the Harness does no URL download. The test establishes exact part forwarding, not image decoding or model visual understanding. Ordinary complete assistant text is forwarded intact to `publish`; the host must enforce the approved inline/full-text-material budget and representation. The prior silent8000-unit truncation is removed.

## Executed focused checks

```bash
node --import ./plugins/harness-cortico/tests/source-loader.mjs --test plugins/harness-cortico/tests/harness.test.mjs plugins/harness-cortico/tests/model-permit.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p plugins/harness-cortico/tsconfig.json
node node_modules/eslint/bin/eslint.js plugins/harness-cortico/src/harness.mjs plugins/harness-cortico/src/harness.d.mts plugins/harness-cortico/src/index.ts plugins/harness-cortico/tests/harness.test.mjs
node node_modules/prettier/bin/prettier.cjs --check plugins/harness-cortico/src/harness.mjs plugins/harness-cortico/src/harness.d.mts plugins/harness-cortico/src/index.ts plugins/harness-cortico/tests/harness.test.mjs
```

Final result:25 tests,25 passed,0 failed/cancelled/skipped; approximately2.1 seconds. Static checks and scoped `git diff --check` passed. All commands ran in the foreground; no background job remains. Tools used existing Node entrypoints, without another pnpm dependency synchronization.

Important coverage:

- Real owner scripted memory/work and late task-result flow retained under explicit owner bindings.
- B gets the next native permit while A retains the original function-call receipt; independent private canaries stay out of the other request and persisted tail.
- Member `remember` is absent; proactive `kind:user` with a host reply-only binding exposes only `say`; a forbidden returned tool call never starts work.
- Scoped application callbacks cannot call the root owner application port. B finishing does not report globally ready while A remains active.
- A starts3 work effects and `stopWork` receives A's origin; no one-task restriction or yield reconstruction.
- Cancelled parked B makes no native call; its active slot remains occupied until terminal acknowledgement. Four active contexts plus16 ready inputs are accepted; only four are initially bound, all20 later complete with at most four live bindings, and a17th ready entry is rejected.
- Cancelling a ready entry makes no binding/model call. A later bind refusal is persisted via `inputRejected`; neither case borrows root owner callbacks. Source close still reports never-bound cancellations after fencing.
- Private/public facts with the same key both survive into the native request with their audience labels; no key-only collapse.
- One input's generation failure does not cancel its sibling; the sibling's later real success restores ready unless cleanup is poisoned.
- Complete >8000-unit ordinary text reaches the host, and terminal publication waits an intentionally held host publish.
- Scoped memory commit survives failed context refresh with a failed application/processing result rather than a fabricated rollback or global applied claim.
- Existing noncooperative native provider case refuses reconstruction and late publication; stop/close retain cleanup failure. Actual pending binding/reset reads join before source disposal.

## Final checked source hashes

| File | SHA-256 |
| --- | --- |
| Harness implementation | `f2bd87c877f30430768c20194951ee31bf7972a391b75957ec521ae23bf8c898` |
| Private declarations | `129311441cae517e65ea4b01d5f70a0e486b7813d0caff05789a18c49da67b8a` |
| Ordinary plugin facade | `f5d65893e65b846f47fa6f2579075746b76afd93d34ae5eab778c0427c575555` |
| Harness tests | `b206107f01df2e22e5280241e95a1e3b5031c3f9ee787b4aad9db53ca3de2843` |

## Remaining integration scope

Parent must wire scoped State reads/grants, actor/task/material permission checks, application aggregation and terminal admission/delivery persistence; public metadata alone cannot provide these. Whole-service owner/M3/M4/M5 regressions, image resolution through the selected real model binding, text-document publication, protocol/media/QQ sending and UI acceptance were not run or claimed by this package gate.

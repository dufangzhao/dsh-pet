# Independent QQ participation judge — scoped implementation gate

2026-11-13, Asia/Shanghai. Final focused run: **24/24 tests passed** (5.75s). Service package typecheck, owned-file ESLint and Prettier checks passed. No production service, real model/account/QQ, original4120 data, commit or lockfile operation was used.

## Implementation and integration seam

- [qq-judge.ts](../../../../apps/companion-service/src/qq-judge.ts) owns participation-only Config/key/application lifetimes. It uses the existing `ModelConnections` with `purpose='qq-participation'`; it neither selects a foreground connection nor invokes `runtime.retireForeground`.
- [qq-judge-context.ts](../../../../apps/companion-service/src/qq-judge-context.ts) reads the exact current State observation, separately filtered group history, visible group/public facts and bounded material metadata. It strips private storage/remote-file locators. The current candidate stays present; `contextMessages=0` makes no history read. Count/age and the aggregate12KiB bound apply, with omission markers.
- [qq-judge-native.mjs](../../../../apps/companion-service/src/qq-judge-native.mjs) supplies `createQQJudgeNativeProvider(baseUrl,apiKey)`. It reuses native Responses body construction, parsing, `GenerationError` and token meters, but performs one bounded unary fetch with `redirect:'error'`. There is no retry and no diagnostic flag masquerading as production inference.
- [qq-judge-native.d.mts](../../../../apps/companion-service/src/qq-judge-native.d.mts) is the private factory declaration; [qq-judge.test.ts](../../../../apps/companion-service/src/qq-judge.test.ts) contains the controlled HTTP/real Host/State tests.

Parent wires the ordinary participation registration's `nativeProvider` to this factory and passes `judge.transport` through the existing ModelConnectionController participation callback. The controller constructor is `(host,runtime,connections,policyPorts)`; policy ports read/save only the shared QQ judge policy with CAS. Provider connection Config remains flat and independently owned.

The implemented public methods on this private service controller are `initialize/view/save/credential/judge/close`, plus `transport(owner,baseUrl)`. Types in the source are authoritative. `QQJudgmentContext` contains a durable attempt ID/event key, exact observation ID, group audience, captured policy revision, history count/age, a native reply reference, and a host `check()` callback. Public metadata is not an action grant. Both the controller and Parent ingress require native message/event basis; identityless notices do not spend judgment budget.

The two Config CAS operations retain separate facts. `save` returns the attempted `providerRef`, policy/config revisions, `policySaved/configSaved`, current view and error. View may be null only if readback itself fails; it never fabricates State usage. A partial commit is not described as rollback. Target/auth changes retire only the judge key, model-only changes retain the matching target key, and stale revisions/versions do not overwrite a later setting. Save and credential changes do not make a model request.

## Budget, decision and cleanup

The controller uses actual State `claimJudgment`, `finishJudgment` and `judgmentUsage`. There is no process-local budget substitute. One claim precedes native I/O; failed reserved attempts count. Repeated group/event identity produces no new request or positive permission. State enforces one claimed judgment, global30/hour and group60s minima. Actual token usage is recorded only when returned; missing usage stays null.

Requests have no tools and use a strict JSON schema for `{participate:boolean}`. The returned value must contain exactly that boolean field in one completed assistant message; free text, code fences, strings and extra keys are rejected. No canonical assistant reply is published. Native/model decision and current eligibility are distinct: a later withdrawal can return `decision:false` while retaining a historical true model decision in the settled attempt.

Signals cover caller cancellation, the configured operation deadline, source/config/key changes and controller disposal. Native/key work is joined before terminal bookkeeping and disposal; partial-CAS error paths also await cancelled judge operations. Final eligibility is checked after terminal persistence. Context/data reads and native billing remain separate from the eventual reply-only input; Parent retains final proactive `createInput` admission and actual outgoing delivery.

## Executed checks

From `apps/companion-service` using installed Node entrypoints:

```bash
node node_modules/vitest/vitest.mjs run src/qq-judge.test.ts --maxWorkers=1
node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node ../../node_modules/eslint/bin/eslint.js src/qq-judge.ts src/qq-judge-context.ts src/qq-judge-native.mjs src/qq-judge-native.d.mts src/qq-judge.test.ts
node ../../node_modules/prettier/bin/prettier.cjs --check src/qq-judge.ts src/qq-judge-context.ts src/qq-judge-native.mjs src/qq-judge-native.d.mts src/qq-judge.test.ts
```

Coverage includes real503 request count1 with generation-purpose attempt metadata; no hidden redirect; response byte cap; strict decision rejection; actual nullable usage; failed-attempt/event/group-budget persistence across State/provider restart; durable30-attempt global cap; real body cancellation/deadline/close with no pending native work; no primary key/binding cancellation; no inference on settings save; partial two-CAS truth; target/key retirement and stale-CAS rejection; no credential in Config/State files; scoped facts/media metadata; exact current candidate with zero history; both history bounds; no-basis refusal; and post-persistence scope withdrawal.

## Frozen source hashes

| Source | SHA-256 |
| --- | --- |
| Controller | `719bd256c797868be97cb47284e6238ed233dabccab1001c15fc7eb2a9609d62` |
| Context reader | `8735194529d6c63a0fcdf97fc7c988791fbe9e48d40d4f3d4028a0aab188f4d6` |
| Native one-attempt factory | `3aa4598aeb76cf5f41fb8b2887320c4981617c69b6a4b791400a919bfb3df941` |
| Factory declaration | `f63648ecbfef17f68ec3730d180f95d8af19fbb55b5b9cddfd8771ae40b5f50a` |
| Focused tests | `7ab15cc8e6c5ffda0a414d87d239836db3132f25884f66a6e461bcd35340f15e` |

Parent owns service/HTTP composition, loopback/operator key-write ingress, effective group/source eligibility and preflight, final reply-only admission, delivery and UI. These broader gates and real QQ/model behavior are not claimed by this slice. No background job remains.

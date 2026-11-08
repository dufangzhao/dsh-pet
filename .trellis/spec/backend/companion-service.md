# Continuous companion service contracts

## 1. Scope / trigger

Use this spec for `packages/companion-runtime`, `apps/companion-service`, and the state/execution/Harness/text-client plugins. Read [model connection contracts](model-connections.md) for replaceable model plugins, native authority and owner configuration/checks. The existing desktop profile remains independent; [project baseline](../shared/project-baseline.md) records unchanged kernel/SDK behavior and [the service guide](../../../docs/35-text-agent-foundation.md) covers operation.

## 2. Signatures

- `createCompanionService(options): Promise<CompanionService>` returns `{url,runtime,host,models,close()}` with an explicit data root/operator token; `models` follows the [model connection contract](model-connections.md).
- `CompanionPluginHost.create({dataDirectory,plugins})` mounts ordinary `PluginDefinition`s under existing `PluginManager`, `TaskSupervisor`, `PermissionKernel` and `ConfigService`.
- `runtime.message(command)`, `startTask(command, signal?)`, `stopTask(taskId,commandId)`, `remember(command)` return `CompanionCommandReceipt`.
- `runtime.state<M>(method: M, input: StateMethodInputs[M], signal?)` unwraps a **provider payload Result** separately from the host transport Result.
- `withSourceAuthority(host, sourcePluginId, permissions, operation, options?)` creates a tracked source-owner task, acquires leases, preserves private return/error objects, and awaits actual settlement.
- State capability `companion.state@1` / provider `sqlite`: `snapshot`, `events`, `acceptMessage`, `createTask`, `updateTask`, `appendMessage`, `rememberFact`, `getTask`, `getTaskByExecution`, `getArtifact`, `recover`, `recordCommand`, `getCommand`.
- Execution capability `execution.javascript@1` / provider `docker`: `execute(task,input)` and `reconcile(task,{after?,limit?})`.
- Harness capability `companion.harness@1`: `accept`, `status`, `stopForeground`. The Cortico factory binds product ports; its generic unbound default is deliberately unavailable.

## 3. Contracts

### Wire and identity

Browser-safe DTOs are maintained in [companion.ts](../../../packages/contracts/src/companion.ts). `/api/*` uses `Authorization: Bearer`; never put credentials in event or download URLs. GET snapshot, fetch SSE, JSON commands and authenticated artifact bytes are the reference transport.

A command ID identifies one submitted intent. Reuse it for an uncertain retry of the same payload; changed payload conflicts. Product task ID, durable execution ID, supervisor task ID and native Session ID are different identities. The frontend needs no Session selection.

`CompanionEvent.sequence` is a committed durable cursor. SSE `companion` frames carry events; `refresh` has no ID and only prompts a coalesced snapshot refresh. Snapshot/event reads are bounded and indicate omitted history/details. A stale epoch or future cursor is a conflict requiring a new snapshot.

### Storage

`FileConfigStore` remains the only configuration CAS owner. Storage identity is **only** `{pluginId,instanceId}`: do not pass an `OwnerRef` containing generation into exact storage-identity validation or source-trust lookups.

The state provider uses `node:sqlite`, `user_version=1`, and tables `identity`, `messages`, `tasks`, `facts`, `artifacts`, `commands`, `events`. DELETE journal + EXCLUSIVE locking + synchronous FULL establishes one writer. State, dedup receipt and event commit in the same synchronous transaction; no network/tool work runs inside it.

Task `execution_id` is unique. The runtime reserves its deterministic execution identity **before** SQL can expose the accepted task, so a stop racing the transaction can mark the pending admission. It writes running state before launching external execution. Every launched handle is captured and awaited even on error.

### Physical work and recovery

`TaskHandle.result` can resolve cancellation before work returns. Observe the provider's actual return inside its handler, then await `TaskHandle.settled` before publishing physical outcome. A logical cancellation alone cannot erase an already completed effect.

The execution provider persists protected `.records/<jobId>.json` outside container mounts: full owner token, execution/job/task IDs, exact container identity and mounts, request hash, outputs/config and terminal receipt. Reconcile pages use lexical job UUID cursors, default4/max8 records and 48KiB payload budget. Inspect every outstanding record before new admission. Cleanup requires exact full IDs, labels and mounts; never delete by name prefix.

A recovered `unknown` task may receive a verified exit code/logs/artifact **without becoming completed**. The state provider must accept same-status enrichment and remain idempotent. Completion requires real exitCode0; repeated reconciliation must not change event cursor or duplicate files/effects.

### Authority and lifetime

Provider `features.methodPermissions` covers every exposed state/execution/Harness method. Omitting it checks only the consumer and bypasses provider file/process policy. Source Harness ports use source leases rather than unrestricted core authority. Cortico consumes the selected model capability; the connection plugin owns its source/config-read and credential leases under its actual generation. Explicit owner checks use the companion-host consumer. Native private dispatch acquires both sides directly, preserving opaque values/errors and actual drain; a JSON describe lease is insufficient. Provisioning, callback/config fences and credential retirement are maintained once in [model connection contracts](model-connections.md).

An activating Harness can receive a read-only initial context only through the host's checked bootstrap grant (trusted source, declared capability, allowed policy epoch, same owner). Normal work requires an active source task. Old owner callbacks cannot update a replacement.

`manager.enable/disable` can return `ok:true` with `unready` or `pending_restart`. The host checks actual target state. Do not activate a replacement until cleanup is confirmed. Lifecycle commands converge on desired state even if an earlier receipt existed; accepted is not applied.

## 4. Validation & error matrix

| Condition | Required behavior |
| --- | --- |
| Missing/wrong token | HTTP401 / `auth-failed`, no state mutation |
| Foreign browser origin | HTTP403 / `permission-denied` |
| Reused command with changed payload | `conflict`, no repeated effect |
| Unsupported protocol/broken response DTO | Client rejects fixed error; no partial snapshot or fabricated empty facts |
| Wrong command ID in a receipt | Keep the local intent uncertain; do not confirm another submission |
| Provider/source deny, revoke, changed fingerprint | Explicit revoke aborts live leases; source fingerprints reject/fence at observed admission/event/return boundaries, without a filesystem watcher |
| Missing image/backend | `unavailable`; no pull and no host execution fallback |
| Invalid path/symlink/hardlink or artifact containment failure | Reject; no read/export outside assigned namespace |
| Unconfirmed cleanup | `unknown` / `pending_restart`; not clean cancellation |
| Service crash without terminal evidence | Recover uncertainty and verified evidence; never rerun old code |
| Projection/Harness unavailable after completed work | Keep committed work result; report projection failure separately |

Inputs and provider results respect the existing 64KiB JSON boundary. State defaults to 60KiB; final snapshot aggregation reserves its actual model/agent/plugin/Result envelope before passing optional `snapshot.byteBudget` to the same state projector (see [single-budget rules](model-connections.md)). Facts and omission markers remain authoritative. Declared artifact names accept the execution provider's 240-character path budget. Times are Unix milliseconds; monotonic supervisor deadlines are not persisted across processes.

## 5. Good / base / bad cases

- **Base:** unauthenticated client is rejected; authorized text input reaches real Core and an explicitly labeled scripted response is stored.
- **Good:** A starts real code, B is handled at the next inference step, only the requested task stops, and reconnect retrieves the same artifact.
- **Good:** SIGKILL leaves a running container; fresh service verifies/stops it and enriches the same unknown task with its partial file, without repeating an append.
- **Bad:** a read-only-looking snapshot uses a provider without method permissions, or a duplicate lifecycle receipt is treated as proof that a failed operation finished.

## 6. Required tests

- [Service recovery probes](../../../qa/probes/companion-service-recovery.test.mjs): commit/running-stop fences; failed persistence; same-ID retry; rejecting disposer; actual running/exited SIGKILL recovery; no cursor churn; real HTTP/Core next-step ordering with live Docker.
- [Service protocol probes](../../../qa/probes/companion-service.test.mjs): authentication, SSE, restart/facts, alternate Harness, view withdrawal and authenticated artifact download.
- [Source authority tests](../../../packages/companion-runtime/src/source-authority.test.ts) and [model transport tests](../../../apps/companion-service/src/model-client.test.ts): missing grants, revoke/fingerprint changes, actual socket cancellation/native partials/private options, no credential persistence.
- [State recovery test](../../../plugins/state-sqlite/src/recovery.test.ts): unknown-to-unknown enrichment and duplicate idempotence. State package tests also cover transaction rollback and real cross-process writer exclusion.
- Cloud plugin Docker tests verify actual process/files/resources/ownership and crash windows. Offline tests must explicitly skip Docker rather than silently fake it.
- Client tests cover damaged/unsupported DTOs, uncertain retry and actual stream-liveness cleanup. Ordinary JSON requests have a20s abort deadline. Any failed refresh keeps the last snapshot but transitions offline; a failed/ended stream also leaves live state before awaiting reconciliation. Any stream byte, including a heartbeat comment, renews the 45s watchdog; expiry aborts/cancels/releases the reader without polling, and explicit close does not report a timeout. Connected-browser checks cover keyboard, responsive layout, target stop, download and offline/reconnect truth.
- Run the complete root quality gate; Linux portability fixes must retain Windows/security assertions, not skip them.

## 7. Wrong vs correct

```ts
// Wrong: externally visible task exists, but no cancellation owner has been retained.
const accepted = await store.createTask(command);
await store.updateTask({ taskId: accepted.task.id, status: 'running' });
work.set(accepted.task.id, startDetachedWork());
```

```ts
// Ordering excerpt from CompanionRuntime; see runtime.ts for complete ownership/cleanup.
const pending = this.work.get(executionId) ?? admission();
this.work.set(executionId, pending);
pending.callers++;
const accepted = await this.state('createTask', { ...safe, executionId });
// Only a new accepted task enters executeTask; duplicates retain the existing execution.
```

```ts
// Wrong: ignores unknown-to-unknown evidence after crash recovery.
if (terminal(current) && !settled(next.status)) return current;
// Correct: prevent regression, but allow same-status verified enrichment.
if (terminal(current) && !settled(next.status) && next.status !== current.status) return current;
```

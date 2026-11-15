# Implementation handoff contract (text foundation v1)

The shared browser-safe types are `packages/contracts/src/companion.ts`, exported from `@pet/contracts`. The main implementation owns this contract. Client/service/storage workers must coordinate changes rather than duplicate types. This is the active implementation target, not a report that endpoints already exist.

## HTTP client protocol

All `/api/*` operations require `Authorization: Bearer <operator token>`. Keep the token in client memory, not URL/query strings. The reference UI is served by the same service and uses relative URLs. No Session ID is required from users.

- `GET /api/snapshot` → `Result<CompanionSnapshot>`.
- `GET /api/events?after=<cursor>&epoch=<epoch>` → authenticated SSE via fetch; `event: companion`, JSON `CompanionEvent`, SSE `id` is its sequence. Runtime events can also prompt a snapshot refresh. An epoch mismatch returns a conflict so the client refetches a snapshot. Stream data must not be interpreted as human instructions.
- `POST /api/messages` with `CompanionMessageCommand` → `Result<CompanionCommandReceipt>`.
- `POST /api/tasks` with `CompanionTaskCommand` → the same receipt; this direct execution route is useful to integration tests and optional clients, not required as a code editor in the reference UI.
- `POST /api/tasks/<id>/stop` with `{commandId}` → the same receipt. Receipt acceptance is not confirmed process exit; use the next task state.
- `POST /api/facts` with `CompanionFactCommand` → the same receipt.
- `GET /api/artifacts/<id>` → authenticated file bytes; the UI fetches a Blob and supplies a download link without putting a token in the URL.
- `GET /api/tasks/<id>` → `Result<CompanionTask>` for full retained logs/artifact metadata if the snapshot is bounded.
- Management-only: `POST /api/plugins/<id>` with `{commandId,enabled}` and `POST /api/harness` with `{commandId,harness}` (`cortico` or `fixture`). The ordinary text UI does not need these controls.

`Result` and `errorMessage` come from existing contracts. Command IDs are minted once per submitted intent and reused for an uncertain retry of the same payload. A changed payload must not silently reuse the same ID. After a committed event batch, the reference client may coalesce a snapshot refresh; do not poll while idle. Preserve last-confirmed history during disconnect, visibly mark current state unknown, and manually reconnect if needed. Do not fabricate local assistant replies or task completion.

The snapshot is a bounded recent projection; the backend remains the canonical record. Initial UI: connect/token entry, conversation/composer, compact task status with per-task stop, artifact links and truthful reconnect state. Display scripted/model mode accurately. No voice/Live2D placeholders or Session UI. Internal task/execution IDs in protocol/diagnostics are allowed.

## Plugin contribution

`pet.text-client` is an ordinary plugin. Its runtime registers a `panel` contribution with id `text-client`; manifest panel.entry points to `dist/index.html`, and entries.ui can point to `dist/client.js`. The service serves this contribution only while active. Assets stay within its declared built distribution. Its build script should emit self-contained index.html, client.js and CSS in dist (exact file names can be coordinated). Parent owns root scripts and lockfile.

`pet.cloud-exec` provides `execution.javascript@1`, provider `docker`, method `execute`. Its package exports request/result types; the runtime imports them only on the server. The method runs to actual completion under a supplied task; the service starts that call under an independent root TaskSupervisor task and returns admission first. Capture the provider's final payload inside the work closure and await physical settlement, because TaskSupervisor's logical cancellation can resolve before work ends.

## State-provider integration target

`pet.state-sqlite` should be an ordinary plugin providing `companion.state@1`, provider `sqlite`. It uses a host-supplied product-state directory, independent from the current view/Harness plugin. Export typed request/result helpers from its Node package. Parent will call the capability with normal owner/task/permission scope, not bypass the plugin manager.

Required methods (JSON input/output, Result payload; provider validates its operation boundary):

- `snapshot`: stable assistantId, epoch, cursor and bounded recent messages/tasks/facts. No model secret, absolute artifact path or private engine state.
- `events`: `{after,epoch,limit?}` → `CompanionEventPage`; cursor means the scanned boundary, hasMore is accurate. Event payloads can be bounded IDs/summaries rather than copying full logs.
- `acceptMessage`: `{commandId,text}` → receipt + committed message; deduplicate by command ID and payload fingerprint; a conflicting payload returns conflict.
- `createTask`: commandId/title/code + executionId (or generate executionId once in this transaction) → receipt + task. Persist task+event+dedup atomically; do not execute code here.
- `updateTask`: taskId and known status/result fields → actual updated task. Enforce terminal-state/cancellation reconciliation rules; late completed effects must not disappear.
- `appendMessage`: caller-supplied stable message id, role/text/inputId/taskId → deduplicated message/event.
- `rememberFact`: commandId/key/value → receipt + revisioned fact; explicit facts only, bounded aggregate storage for this foundation.
- `getTask`: `{id}` → task; `getArtifact`: `{id}` → artifact metadata plus a provider-relative location; no filesystem read in this method.
- `recover`: mark previously nonterminal work interrupted/unknown according to recorded state, without re-executing effects; return affected task IDs.
- `recordCommand` / `getCommand` for stop/harness/plugin controls if needed, using the same payload-conflict rule.

Workspace/artifact bytes stay in the execution provider's data root; state records retain provider identity and checked relative location. The host performs authorized reads and validates the path on use. Keep provider output under existing JSON budgets (64 KiB); return bounded pages rather than enlarging the shared kernel limit. Service snapshot may aggregate several bounded reads if required. State transactions and durable events are atomic; listener notifications occur after commit. Use one writable service instance per database, with an actual contention test. No ORM or second task scheduler.

Profile name/prompt remains in existing ConfigService/FileConfigStore ownership; state persists stable assistant identity, explicit facts, work/events and references to applied profile revisions. The state provider must not create a second writable persona configuration store. A clean new service profile is used; old desktop data is not imported.

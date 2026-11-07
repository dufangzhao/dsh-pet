# Text foundation design

Status: approved design, now implemented for the scoped [PRD](prd.md). The parent [architecture](../11-06-unified-companion-architecture/design.md) owns long-term boundaries. Exact delivered signatures and behavior are maintained in the [executable service spec](../../spec/backend/companion-service.md); actual verification is in [progress](progress.md) and the acceptance evidence.

## Composition and reuse

The implementation retains the TypeScript/pnpm workspace and existing plugin contract. It adds a Node service composition, a product runtime library and ordinary capability/view plugins:

| Area | Implemented role |
| --- | --- |
| Existing `packages/contracts` | Browser-safe command/event, logical-task, execution receipt, capability and artifact-reference shapes; reuse existing Result/owner/version conventions |
| Existing `packages/host-kernel` and `packages/plugin-sdk` | Reuse PluginManager, capability selection, permissions, configuration CAS and TaskSupervisor; add only narrowly required service/background-work ports |
| Added `packages/companion-runtime` | Agent/profile references, logical work and execution correlation, committed event/query access, input/background admission and Harness facade; no second ReAct loop or task supervisor |
| Added `apps/companion-service` | Headless Node composition, data/workspace roots, operator authentication, HTTP/SSE endpoints, startup/shutdown and approved static client contributions |
| Ordinary plugins | Reference text client, cloud execution environment, durable state provider and Harness/model integration; reuse/refactor existing Cortico/provider code where its contract fits |

Extract reusable composition from the desktop assembly rather than importing Electron Main into the service or copying all of DesktopHost. Keep the old desktop boot/profile working. The new service uses an explicit new data root and Agent identity; no automatic access to Electron userData, credential vault or Cortico history. This first delivery does not claim to inherit an existing desktop relationship history.

A reference web text client is the recommended first protocol consumer because it can exercise remote service access without making Electron a prerequisite. It is replaceable and not a commitment to the final product UI. Its static entry is supplied through a controlled plugin contribution; an arbitrary remote UI installer/store is not required.

## State and storage

Use one product-state provider for the new service's accepted interaction/work facts. The initial recommendation is a single SQLite database with a single service writer, storing logical tasks, execution attempts, command deduplication, durable events and artifact metadata. Commit state transitions and their corresponding events together; publish only committed events. Keep remote/model/tool execution outside transactions.

The new state plugin now uses `node:sqlite` on Node26.13.0. Real cross-process exclusive-writer, transaction rollback, recovery and built-service checks passed. The first slice stores one durable execution identity/outcome per logical task; no retry scheduler or ORM was introduced. This addition does not change the desktop's existing FileConfigStore authority.

Keep plugin configuration in its existing FileConfigStore/CAS owner. Persona text has one owner; events refer to its acknowledged revision instead of maintaining another writable copy. Store workspace/artifact bytes in separately scoped directories or a storage provider and expose stable, authorized references. A stored path is not permission to read arbitrary host files.

For this isolated new service, product records own accepted facts; Cortico Session/transcript state is an engine projection/archive with source identifiers. Do not independently mutate two stores as the source of the same user fact. Importing old desktop history later requires the parent design's controlled one-writer migration.

On service restart, restore committed identity/work/results. An execution left running becomes a reconciliation case: use supported external status/checkpoint evidence, otherwise report interrupted/unknown. Do not automatically rerun shell commands or claim an old process resumed. Stable identity and results are required; transparent live-process migration is not.

## Text command and event transport

Recommend HTTP JSON for commands/queries and server-to-client SSE for committed event notifications. This is the text control path, not the future PCM/video transport.

- Input/cancel/configuration mutations carry a client command identity and return explicit acceptance/conflict/error receipts. Repeating an accepted command must not launch another execution.
- Snapshot and event reads include a cursor and reset/epoch boundary. Reconnection fills gaps, deduplicates by event identity and preserves original timestamps; replay restores state, not tool effects or theatrical new-message animations.
- Input is addressed to the Agent/authorized scene, not a user-selected Session. Responses and work events retain logical-task/attempt/source/destination correlation.
- Authenticate commands, event reads and artifact access. Start with an operator-owned single-Agent deployment and scoped authorized clients; do not add account registration or tenancy administration.
- Prefer Authorization-bearing fetch streams for the reference client so credentials are not put in URLs. If cookie authentication is selected during implementation, explicitly define same-origin/CSRF handling. Remote deployment material needs a TLS/exposure configuration; no internet listener or paid deployment is started during planning.
- Bound text/progress/event payloads; expose longer logs and artifacts through authorized references. SSE transport alone is not proof of incremental model-token generation.

Exact route names and wire schemas are implementation contracts to publish with tests. Use existing JSON Schema/AJV conventions at trust boundaries; do not introduce a competing validation stack without a demonstrated need.

## Async work and Harness integration

Keep short tool execution direct. A long operation uses an explicit authorized background-admission port: record logical work and its execution, establish the supervised root work, then return its known accepted/queued/running state. Current nested SDK invoke inherits the parent signal and is capped at 30 seconds; it is not the long-job mechanism. Reuse TaskSupervisor to supervise independent work and distinguish logical result from actual drain.

The first real Harness is the current pinned Cortico integration if its required behavior passes a narrow compatibility probe. Give it a product-owned context/profile projection and a host-owned tool path. Ordinary tools stay within their task authority. Background completion is recorded as an attributed fact, then delivered through the driver's supported event ingress; it does not mutate a global `active.reply` for whichever input arrived last.

**First engineering gate:** establish Cortico 0.2.7's actual next-inference-step event-admission and cancellation path through the host boundary. The current adapter's onIdle/single-active behavior is not evidence of that guarantee. Inspect/probe the fixed upstream hooks; if insufficient, document a minimal adapter change or separately justified framework revision. Do not silently substitute whole-turn responsiveness for the PRD's step-boundary criterion. This gate preserves the chosen behavior rather than deferring it away.

Add a deterministic adapter with different capabilities for lifecycle/context/replacement tests. This is a contract test, not a claim of two production Harness integrations. The parent requires a second real Harness before broad compatibility is advertised.

A real model path can use a configured provider/gateway through the existing model boundary, preserving tools, usage, errors and compatible replay metadata. Magpie remains an optional provider adapter, not a required state owner. No automatic gateway installation, semantic-router chain or paid model call is part of the test gate. A scripted model remains explicitly labeled.

Cloud credentials cannot depend on Electron safeStorage. For the first service, recommend operator-provisioned model credentials via environment/secret mount through a host-authorized broker adapter. Verify the actual CredentialBroker integration; absence of a cipher must not silently create plaintext credential files. A browser key-management UI and multi-user vault are outside this slice.

## Execution environment

Provide a fixed, configured cloud-workspace execution backend as a plugin. It exposes the minimum file/process operations needed for real bounded tasks, captures bounded output/exit status and registers retained artifacts. Model/tool code must not block the shared plugin worker's event loop.

For arbitrary generated code, use an explicitly configured isolated execution backend (for example a nonprivileged fixed container environment), scoped to its job workspace with no service-state, credential or host-control-socket mounts. Select the actual backend and validate its availability before claiming containment. If unavailable, report the capability unavailable; do not silently downgrade to unrestricted host execution. A trusted deterministic local subprocess may verify lifecycle/file behavior in tests but is not evidence of sandbox isolation or cloud deployment.

The first proof needs no automatic dependency installation or new infrastructure purchase: use an approved existing environment and a dependency-free script over fixed input. Produce a real file, query its actual exit status and download its artifact after client disconnection. Retain uncertain outcomes and already committed files when cancellation races with completion.

## Minimal client experience

Recommended view: a conversation timeline, composer, compact connection/work summary, task-specific stop controls and artifact links. A small expandable status view is a routine presentation choice, not a full board or mandatory goal taxonomy. Configuration can initially be operator-side. No Session picker, voice placeholders, avatar, goal library or plugin marketplace is required.

A pending stop reads as requested until actual settlement. During disconnect, retain readable prior history but identify current state as unknown/last-confirmed; do not leave stale running indicators as current truth. On reconnect, reconcile missing events without duplicate tasks/results. The backend may return internal correlation IDs; the requirement concerns ordinary user burden, not banning technical fields from the protocol.

The UI remains one plugin consumer. Another client implementing the same capabilities can replace it without rewriting core business logic; genuinely new client capabilities may require a versioned extension rather than being treated as a protocol defect.

## Validation and rollout

Use the PRD acceptance matrix as the single outcome checklist. Start with deterministic fixtures through the actual service/client/task boundary, then verify one real Harness path and real file/process execution. Preserve separate claims for protocol tests, container isolation, live model behavior and real cloud deployment.

Run the new service in an isolated profile while the existing desktop remains available. Shared kernel changes require its relevant regressions and the full repository quality gate. Service/package build and deployment instructions must be added to that gate deliberately; the current root build targets only the desktop. Final delivery states exactly which model, execution and deployment paths were tested.

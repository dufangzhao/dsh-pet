# Cortico 0.2.7 admission and cancellation gate

Verified 2026-11-07 on Node 26.13.0. **The pinned Core supports next-inference-step admission without waiting for `onIdle`. No framework upgrade is needed for this seam. A round interrupt is not a whole-foreground stop.**

The executable [gate](../../../../qa/probes/companion-cortico-gate.mjs) passed against the workspace's installed `cortico@0.2.7`, using its real `Core`, injected scripted `ResponseClient`, controlled asynchronous tools, and fresh temporary native stores. No paid API, Electron profile, or existing desktop data was used. The dependency setup remained parent-owned; this change does not install packages or edit a lockfile.

## Evidence and limits

Source inspection used the detached checkout at `/tmp/dsh-pet-upstream-research.Rbevn6tV/Cortico-pinned`. Its Git worktree HEAD is `cb9ddbd685bcccba1f29905098648f46a79b3862`, manifest version `0.2.7`. Upstream references below use that exact commit; the earlier [upstream research](../../11-06-unified-companion-architecture/research/upstream-runtimes.md) supplies broader context. The child's product-state ownership decision supersedes that older report's provisional suggestion to make native Cortico history canonical.

Run from the repository root:

```sh
node --check qa/probes/companion-cortico-gate.mjs
node qa/probes/companion-cortico-gate.mjs
```

Optional `CORTICO_GATE_ROOT=/absolute/pinned/checkout` imports that checkout's `src/` directly. Its dependency graph must be available; the gate does not install anything or substitute a mock Core. The default loads the actual published package and rejects any manifest version other than `0.2.7`.

Observed first run: `status: passed`, all four checks below passed, `networkCalls: 0`. Native logs are retained at `/tmp/companion-cortico-gate-EnY4fN`; subsequent runs print their own fresh log directory.

| Executed check | Assertion through real Core |
| --- | --- |
| `next-step-and-independent-work` | Input B arrives while the first model request is unresolved. `flush` leaves that request un-aborted. A background-start tool returns its running receipt; the very next model request contains B and that receipt with **zero `onIdle` callbacks** and background completion still blocked. B is answered before the work completes. A later foreground model interruption leaves independent work alive; its eventual result enters as an attributed event. Private `meta` is absent from model input. |
| `preempt-and-stream-interrupt` | Preempt aborts an unexternalized model request. A provider that then resolves successfully cannot commit stale output, and late stream deltas are suppressed. Preempt after a visible delta does not abort; interrupt does. A native `GenerationError.partial` preserves the visible partial response before the next input. |
| `interruptible-tool-drain` | Interrupt signals `ctx.signal`, waits for the controlled handler to return its actual receipt, skips the second unstarted call while pairing its result, and **still starts another inference without a new event**. |
| `noninterruptible-tool-drain` | Interrupt leaves the running handler's signal un-aborted, waits for its actual return, skips the second call, and likewise continues inference. |

All fixtures stop the Core and verify that a retained `WorldHost` rejects ingress after lifecycle teardown. Ordering assertions use explicit deferred promises; the five-second timeout is a failure watchdog, not a claimed latency bound.

This is a **Core/adapter feasibility gate**, not completion of PRD A2/A3/A9. It does not test the new service's HTTP path, TaskSupervisor independent roots, durable event deduplication, provider credential transport, real model behavior, cloud execution, or replacement recovery. The background fixture is intentionally controlled work; it is not the PRD's required real file/code backend. Those integrated acceptance cases remain parent-owned.

## Exact native API and semantics

| Native surface | Meaning for the adapter |
| --- | --- |
| `new Core(loaded, {persona, worlds, llm?})` | Node composition with native stores and provider discovery even when `llm` is injected. Persona must declare exactly one session with both `persistent: true` and `receivesEvents: true`. |
| `World.start(host: WorldHost): Promise<void>` | Captures the lifecycle-bound ingress port. `World.stop(): Promise<void>` releases that World's resources. |
| `WorldHost.pushEvent(event, options?): Promise<EventEnvelope>` | Appends a native event, allocates a native cursor, queues it if deliverable, and returns the archived record. This is **not** a model-processing or response-completion receipt. Input omits `cursor`, `origin`, `contextDelivery`, and `blobs` from `EventEnvelope`, then optionally supplies `origin` and `BlobInput[]`. Supply `type`, ISO `ts`, `source`, and `text`; `meta` and `senderKey` are optional. |
| `PushOptions` | `{deliver?: boolean; trigger?: 'flush' \| 'debounce' \| 'piggyback' \| 'preempt' \| 'interrupt'}`. `deliver:false` archives without delivery. External default is debounce; use explicit `flush` for next-step eligibility. |
| `EventEnvelope.meta` | Producer-private data, **not rendered into the model context**. Include model-needed attribution in bounded `text` as well as retaining machine correlation in `meta`. Native cursor/run are projection identities, not logical task IDs. |
| `SessionDecl.eventDelivery` | `'tool'` by default, using a reserved external-event call/result frame; `'user'` renders external text in a user message. Both use the same queue/round boundary. The gate explicitly selects `'user'`. |
| `World.onEventsSettled(events, outcome)` | `'delivered'` means appended to the main session; `'discarded'` means cleared from the queue. It is not proof of an answer or successful external effect. |
| `ResponseClient.respond(request, options?): Promise<Generation>` | Request uses native Open Responses shapes. Options include `signal`, `onEvent`, `context`, `nativeSpec`, `role`, `sessionId`, and optional provider metadata. Forward cancellation throughout the actual transport. |
| `Generation` | `{response, origin, attempts}`. Successful Core processing reads the last attempt's `meters`, so preserve a nonempty actual attempt list. Unknown usage remains nullable via `unknownMeters()`, not fabricated zero usage. |
| `GenerationError` | Constructor `(message, attempts, partial, origin, status = 0, body = '', options?)`. Preserve this type and its partial response/attempts across the adapter. An ordinary error does not carry externalized partial response history. |
| `SessionDecl.outputTap` | `{onEvent, externalizes?, onRoundEnd?, onAbort?}`. **0.2.7 supplies `GenerateOptions.onEvent` only when this tap exists.** `onRoundEnd` runs after model output is appended, before ordinary tools execute; it is not a safe tool-drain callback. |
| `ToolDef.handler(args, ctx)` | Returns `Promise<string \| {text: string; blobs?: BlobInput[]; failed?: true}>`. `ctx` contains `role`, logger, optional `callId`, optional process-local monotonic `round`, `signal`, and optional `queueExternalEvents`. |
| Tool behavior flags | `barrierAfter` skips later same-response calls (it does not defer/replay them); `endsTurn` ends this wake after tools and defers waiting inputs to another batch; `interruptible` combines the round interrupt with the shutdown signal. Long-start receipt tools should omit `endsTurn`; consider `barrierAfter` when subsequent same-response actions must first inspect acceptance. |
| `core.loop.interruptCurrentRound(): boolean` | Boolean means an active model/tools round was signalled, not that it settled. Model cancellation retains externalized output where native partial evidence is supplied. Tools are awaited; interruptible handlers must cooperate. Unstarted calls are skipped. |
| `core.loop.abortCurrentRound(): boolean` | Preempt only cancels a model phase before externalization. It cannot stop already visible output or a running tool. |
| `core.start(): Promise<void>` / `core.stop(): Promise<WorldStopFailure[]>` | Start launches the loop; it does not await an inference. Stop is terminal teardown, with a one-second main-loop drain deadline, sealing of late native writes, and World stop/lease invalidation. Nonempty failures mean cleanup was not fully confirmed. Create a fresh Core to restart. |

Source: [Core construction and ingress][core], [native types][types], [generation types][generation], [WakeBus][bus], [round loop][loop]. JSON Schema describes tool parameters; Core's argument parser only parses JSON. The host must still use the project's existing schema/AJV validation and authority checks at its tool boundary.

## Actual admission boundary

[The loop][loop] performs this order:

1. A ready event batch enters the native session.
2. `llm.respond` receives a snapshot of the current context.
3. Completed tool calls run and Core awaits their handlers. With an OutputTap, complete streamed tool items can execute eagerly; the handler is still awaited. Partial arguments are not executed.
4. The tool results are appended.
5. `bus.takeIfReady()` takes newly eligible events and `deliverBatch()` appends them **before the next `llm.respond`** (lines 1432–1445).

`flush` schedules admission; it does not interrupt an in-flight request. A non-ending tool chain can consume the input in the same batch. Natural assistant completion, `endsTurn`, and the hard round cap instead return to the outer queue, which starts the next batch. Operator pause/delivery gates can hold events. The guarantee is a supported safe boundary, not instantaneous hidden-state injection.

`onIdle` runs only after the round loop returns and no immediate event remains (lines 1066–1068). Waiting on it before admitting B would discard the useful native capability. `onEventsSettled` and `onRunPhase` can report delivery/phase, but are observation callbacks, not new queue owners.

## Minimal implementable adapter seam

Keep these methods in the parent-owned Harness facade; these are **proposed adapter methods**, not claimed Cortico exports:

| Method / port | Minimal responsibility |
| --- | --- |
| `start(projection, ports)` | Construct a new Core with isolated projection paths, one authorized scene, product-owned identity/profile/context, the World, a tap if needed, and a signal-preserving ResponseClient. Never import old desktop data implicitly. |
| `accept(committedEvent)` | Project a validated, committed product input/result through `pushEvent(...,{trigger:'flush'})` immediately, including while inference is active. Return a projection receipt `{driverGeneration, nativeCursor}`. Product acceptance/deduplication is already committed by the parent. |
| `stopForeground(foregroundId)` | Record the product stop request, fence that foreground's further model/tool/output admission, then interrupt the current native round and observe actual settlement. This method does not stop independent work. |
| `close()` | Reject further adapter ingress, unsubscribe external listeners, await `core.stop()`, report drain failures, and retire the projection generation. Backend work is owned elsewhere. |
| `ports.startWork(request, provenance)` | Host validates scope/idempotency, commits logical work/execution and establishes its independent supervised root, then returns its accepted/queued/running receipt. The Cortico tool returns that receipt as bounded text immediately. Do not await background completion or pass foreground `ctx.signal` as the job lifetime. |
| `ports.publishOutput(output, provenance)` | Commit/output under immutable generation, request, destination, and related-product-event identifiers. Do not write to whichever mutable `active.reply` happens to exist when a late callback runs. |

At each ResponseClient entry, snapshot the already-delivered product event IDs and authorized scene into a new request context. Streaming callbacks close over that immutable context. Keep it until the current tools settle; new input **acceptance** must not overwrite it. Tool `ctx.callId` identifies the model call within that projection, while logical task IDs, attempt IDs, authority, destination, and deduplication remain product-owned. When several inputs share a batch, retain the contributing event set rather than pretending the latest input owns every output. Native `ctx.round` is process-local and is not a product execution identity.

When independent work completes, the host first commits the attributed result, then projects one `companion.work-result` event containing product event/task/attempt/destination IDs. Use the same event ingress as normal input. Cortico `pushEvent` does not deduplicate producer event IDs; the product delivery ledger must handle duplicate or late results and reconnect/reconstruction. A Core receipt is not an atomic commit across the product database and native JSONL files.

## Stop and lifecycle implications

**Calling only `interruptCurrentRound()` is insufficient for product stop.** In the tool phase, after signalling/skipping calls and recording receipts, the loop continues to another model request even with no new input. Both tool checks reproduce this. An adapter cancellation fence must refuse model continuation and tool/output admission for the canceled foreground until a fresh authorized input creates a new allowed request context. Refusing transport admission must end the canceled continuation, not trigger provider retry. Preserve truthful already-completed tool receipts and partial output.

Alternatively, at an explicitly supported replacement boundary, terminally stop the Core, inspect drain failures, and construct a new projection from committed product facts. Native stop cannot kill a noncooperative external process; backend termination still belongs to TaskSupervisor/execution-provider policy. Do not treat a one-second Core drain timeout as confirmed termination.

`preempt` and `interrupt` are distinct controls: preempt may reduce wasted unexternalized generation; interrupt cuts visible generation and cooperatively signals interruptible tools. Neither retracts presented output or completed external effects. A generic `AbortError` from a transport cannot substitute for a native `GenerationError.partial` if the adapter must preserve already-presented text in context.

A long-start tool must perform only bounded admission. If it waits for work completion, native next-step admission waits behind it. Returning early while secretly retaining the foreground task/signal is also insufficient: stop/disposal would still own that work. Keep only the result subscription in the frontend and let lifecycle-bound host ownership manage background drain/recovery.

The existing desktop adapter's single-active guard, `onIdle` resolution and entry-only signal check cannot be reused unchanged for this facade. Keep that desktop path/data intact; build the additive service driver against the contracts above and verify its real host boundary separately.

## Implemented service adapter follow-up

The parent expanded this worker's scope to implement [the additive service Harness](../../../../plugins/harness-cortico/README.md). Its [public declaration](../../../../plugins/harness-cortico/src/harness.d.mts) is the current integration contract; the proposal above records the reasoning, not a second API owner. The implemented facade is `createCorticoHarness(options, ports)` → `accept(input)`, `stopForeground()`, `close()`. `accept` returns after queue ingress and deliberately does not expose native cursor/session identity as product state. `createCorticoPlugin` binds it to the ordinary PluginManager lifecycle and `companion.harness@1` provider `cortico`.

The implementation chooses generation fencing plus terminal Core drain/reconstruction, not round interruption alone. Product ports own work, facts and deduplicated output. Tool arguments are actually AJV-validated. Stable effect IDs include product input identity and normalized operation arguments, so native call ID changes do not create a new logical effect. `say` validates the input it answers; result replies inherit task identity. Complete native assistant text without tool calls is committed only after Core accepts the response, retaining the contributing input set.

The [integration suite](../../../../plugins/harness-cortico/tests/harness.test.mjs) verifies real-Core scripted workflows, next-step admission with independent work, cancellation while admission is pending, truthful noncooperative drain failure, source/parameter checks and ordinary plugin cleanup. It also injects the real native ResponsesProvider against a loopback HTTP/SSE fixture, proving a successful response, a 400 error, socket cancellation, and no fixture secret in native projection files. These are executable adapter/provider results, not a live-model or cloud-deployment claim. Parent service/storage/execution acceptance remains separate.

The narrow public client declaration imports native Open Responses wire types without importing the full upstream `generation.ts` graph: that graph fails this repository's stricter index-signature/optional-property rules. No compiler rule was weakened. Native runtime options, response, origin, attempts and GenerationError remain intact; callbacks/signals/context are never JSON-serialized. The parent binds authorization and credentials in its transport shim. Model mode requires both a client and a configured model; scripted mode labels every visible reply.

[core]: https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/src/core/core.ts
[types]: https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/src/core/types.ts
[generation]: https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/src/core/generation.ts
[bus]: https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/src/core/bus.ts
[loop]: https://github.com/Pal-AI-Lab/Cortico/blob/cb9ddbd685bcccba1f29905098648f46a79b3862/src/core/loop.ts

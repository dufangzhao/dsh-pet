# Cortico service Harness

This package runs the pinned Cortico 0.2.7 Core as a disposable projection of one service-owned assistant. The service owns facts, accepted inputs, tasks, execution attempts, output deduplication, and artifacts. Independent work never inherits the foreground's AbortSignal.

## Service composition

Use `createCorticoPlugin(options, ports)` with the ordinary PluginManager lifecycle. The plugin declares provider `cortico`, capability `companion.harness@1`, and uses the granted `PluginContext.dataDirectory`. The service passes the returned `PluginDefinition` through its normal composition; no additional manager is needed. The generic default export reports unavailable until the service binds authorized ports. It does not invent state or execute a model without those ports.

The provider methods are:

- `accept(task, {id,text,kind,taskId?})`: validates an input and returns a normal `{ok,value}` receipt after native queue admission. It does not wait for inference or `onIdle`.
- `stopForeground(task, null)`: fences the old projection, awaits actual Core/owned-operation drain, and reconstructs from current canonical context. Unconfirmed drain returns an unavailable error and prevents reconstruction.
- `status()`: returns the current availability and the configured `scripted`/`model` mode.

The host may alternatively use `createCorticoHarness(options, ports)` within its own ordinary plugin activation/disposal. That typed facade has `accept`, `stopForeground`, and `close`. Public types and port signatures are in [the declaration](src/harness.d.mts).

`options` contains `dataDirectory` (only for the direct facade), `name`, `persona`, `mode`, optional `model`/`baseUrl`, and optional injected `client`. Persona text is supplied from the existing profile owner; this plugin does not create another writable profile. Each creation/reconstruction uses a fresh directory under `projections/`; old native stores are retained as diagnostic archives and are not automatically replayed. The host manages retention. Existing desktop data is never discovered or imported.

`ports.context()` returns canonical messages/facts/tasks. Context projected into the model is bounded: recent messages, explicit facts, and task identity/status/artifact summaries, with long bodies truncated. It refreshes on event delivery; complete retained data remains available through the service. `publish`, `startWork`, `stopWork`, and `rememberFact` operate on the service's accepted records. `status` reports actual runtime availability.

## Attribution and effect receipts

An input has a stable product `id`, `kind: 'user' | 'work-result'`, text, and optional task ID. Work results require a task ID. Their IDs appear in bounded model-visible JSON and in native event metadata; metadata alone is not visible to Cortico's model.

The five tools are `say`, `start_work`, `stop_work`, `remember`, and `list_work`. All parameters are checked by AJV with the same JSON Schemas sent to the model. Unknown fields, foreign input IDs, malformed values, oversized tool payloads, and unsafe relative file paths are rejected before host ports. `say` selects an input from the current model request; a result reply inherits that input's task ID. Natural assistant text without tool calls is committed after Core accepts the response and retains all contributing input IDs.

`start_work`, `stop_work`, and `remember` require a currently delivered user input; a backend result event cannot authorize those mutations. `start_work` and `remember` supply an `origin.id` derived deterministically from the input ID, operation, and normalized arguments. The host must use that ID as its idempotency key: a new native call ID after reconstruction must not create another accepted effect. `origin.callId` is diagnostic only. A tool's admission receipt does not claim work completion, and a stop receipt does not claim process termination. Core tools return promptly after bounded admission and do not use `endsTurn` for long work.

Outputs also have stable content/input-derived IDs for the host's commit/dedup boundary. The caller deduplicates committed ingress before delivery. Projection logs and in-memory correlation are not a substitute for the product event ledger.

## Scripted and model modes

Scripted mode still uses the real Core and real tool handlers, but its ResponseClient is deterministic. Every visible reply is labeled `离线脚本演示：`. It supports ordinary short acknowledgments, `记住 语言: 中文` / `remember language: Chinese`, preference queries, `创建文件任务` / `start demo file`, task queries, and `stop <task-id>` / `停止任务`. The file demonstration submits a bounded JavaScript request that writes `result.txt`; the parent execution provider performs and supervises it. There is no timer pretending to execute a cloud task.

Model mode requires an injected `ResponseClient` and a configured `model`; either missing value is an error, never a scripted fallback. The facade reuses native Open Responses Request/Response/StreamEvent types. Provider attempt/context details remain opaque in its narrow public declaration to avoid forcing upstream source through the application's stricter TypeScript configuration. At runtime the complete native options and Generation pass through unchanged, with a combined cancellation signal. Do not JSON-clone options: it would lose signals, callbacks, provider context, and signatures.

The host can use Cortico's real `ResponsesProvider` from `cortico/providers/openai-responses-compat/native.ts`, constructed in its authorized JavaScript transport shim with `{baseUrl, apiKey}`. The host obtains the key through its own secret broker and wraps the provider under its permission/task scope. Native `GenerationError`, including attempts and partial response, must remain intact. No credential belongs in this plugin's options/configuration, native event text, or history. The base URL rejects embedded credentials, query strings, and fragments.

The adapter presents complete text replies. It forwards native stream events into Core for protocol/tool handling but does not advertise token streaming to the text client.

## Cancellation and cleanup

A native round interrupt can continue inference after tools finish. Therefore this adapter fences the entire old generation before terminal Core stop. New model calls, tools, and output submissions from that generation are denied; already-admitted host effects remain canonical. The stop awaits native drain and checks tracked provider/tool/publication operations. It reconstructs only after confirmed settlement. A noncooperative provider leaves the facade unavailable, rejects further ingress, and requires lifecycle replacement; no successful stop or replacement is fabricated.

Stopping the foreground never invokes `stopWork`. Independent backend work and its eventual result remain service-owned. Disposing the Harness closes its Core/loader and rejects late ingress. Removing a view has no connection to this lifecycle.

## Verification

With workspace dependencies linked:

```sh
pnpm --filter @pet/harness-cortico typecheck
pnpm --filter @pet/harness-cortico test
pnpm --filter @pet/harness-cortico build
```

The test loader also resolves real existing workspace modules before a newly added package is linked; it does not mock Core, install dependencies, or replace the provider implementation. Integration tests cover scripted facts/work/result flow, next-step admission, cancellation during tool admission, stable effect attribution across reconstruction, malformed tools, noncooperative drain failure, and ordinary plugin disposal.

The model-path test uses the real native ResponsesProvider against a loopback HTTP/SSE fixture. It verifies model/options, a successful response, a 400 error, socket cancellation, and absence of a fixture secret in all native projection files. The expected 400 diagnostic appears in test output. No paid API or real external account is used. Actual cloud process execution, host permission/secret-broker wiring, SQLite persistence, and service HTTP acceptance are integration responsibilities outside this package's tests.

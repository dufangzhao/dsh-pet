# Current runtime evidence and replaceable companion boundary

Research date: 2026-11-06. Repository baseline: `500aeba`. Status: proposal and source review only; no implementation approval. This report incorporates the added multi-model requirement (R8) and reopening of the DSH-versus-standalone decision (R9) in the [task PRD](../prd.md#L9-L25).

## 1. Assessment

The project already has a useful separation between trusted host authority, ordinary plugins, model providers, and native presentation. Its strongest reusable assets are owner-generation checks, task cancellation and physical-work tracking, explicit capability selection, bounded binary streams, configuration CAS, credential leases, and an independently stored persona profile. Replacing these with a generic new orchestration framework would discard working mechanisms without solving the companion problem.

However, a replaceable capability name does not yet make the assistant architecture replaceable. The current application assumes one specific Cortico plugin, one `everyday` session, one `pet.desktop` event source, one active conversational turn, and desktop-only output routing. Cortico owns the interaction archive and engine session under its own plugin data directory. Even the model-provider implementation imports Cortico transport classes. A framework replacement therefore requires a state transition and several bounded adapters, not merely a different `respond` implementation.

The current voice path is utterance-based ASR → complete model/tool response → complete TTS synthesis → buffered playback. Some layers stream bytes or ASR hypotheses, but the integrated path is not end-to-end streaming speech and does not implement a full-duplex conversational policy. Multi-platform identity, memory visibility, attention, and output receipts are more immediate architecture gaps than selecting a more elaborate agent engine.

The credible extension promise is: **switch engines at a controlled idle/drained boundary, preserve product-owned identity and interaction facts, rebuild engine context, and explicitly account for incompatible engine state.** Live transfer of an active tool call, opaque model reasoning, partial audio, and authorization state is not a reasonable default compatibility promise.

DSH can be the primary runtime if the user accepts it as a required dependency and its verified public lifecycle/task interfaces meet the product needs. The previous standalone ADR is historical/current implementation evidence, not a veto. A DSH-centered design must actually select DSH as the host authority; wrapping the complete existing host inside a DSH plugin leaves two competing task/permission/lifecycle systems. An independently hosted product runtime is the alternative when independent distribution and availability are requirements. Keeping Electron as the whole host is the lowest-change local prototype route.

## 2. Evidence scope and current decisions

This review read the repository instructions, terminology, task PRD, source-backed baseline, application contract guide, relevant accepted ADRs, and the implementation paths cited below. It did not run installations, live services, model calls, full tests, or runtime performance experiments. Existing probes were read as descriptions of test coverage, not rerun or treated as proof of this environment.

There is no installed Cortico source tree at the expected plugin dependency location in this workspace. Accordingly, claims here about current behavior follow the checked-in adapter and its callers. This review does not independently verify Cortico's internal append atomicity, compression behavior, event-bus ordering, or loop interruption implementation. The version is explicitly pinned to `0.2.7` in [agent package:10–14](../../../../plugins/agent-cortico/package.json#L10-L14). Older upstream research is available in [the archived Cortico review](../../archive/2026-10/10-28-plugin-settings-redesign/research/cortico-reuse.md), but its proposed receipt/streaming behavior is not substituted for current implementation evidence.

The baseline decisions are compatible with incremental change:

- [ADR-0004:7–18](../../../../docs/adr/0004-capability-centered-host.md#L7-L18) treats the agent as a replaceable capability and explicitly leaves routing, media, cancellation, and permissions to the product.
- [ADR-0010:7–21](../../../../docs/adr/0010-unified-plugin-model.md#L7-L21) establishes one plugin model, explicit provider selection, and no automatic DSH-plugin compatibility.
- [ADR-0014:9–15](../../../../docs/adr/0014-cortico-agent-runtime.md#L9-L15) makes Cortico the current single loop/session/event owner, while the host owns config, credentials, permissions, installation, and lifecycle.
- [ADR-0002:7–19](../../../../docs/adr/0002-standalone-with-optional-dsh.md#L7-L19) records the earlier independent-product decision. R9 explicitly reopens it.
- [ADR-0012:11–24](../../../../docs/adr/0012-dsh-style-trust-and-permissions.md#L11-L24) treats installed plugins as trusted local programs. Process separation is not a hostile-code sandbox.
- [ADR-0013:10–19](../../../../docs/adr/0013-voice-chat-first-loop.md#L10-L19) selects voice chat first. Its desired “streaming reply” is not evidence that the current integrated path streams incrementally.

These decisions may be revised deliberately. Until an actual cutover is implemented, existing state and authority must remain readable and truthful.

## 3. What currently runs and who owns state

The actual launch path is Electron Main → `DesktopHost` → one remote plugin worker → owner-scoped Cordis activations → the Cortico agent plugin. Cordis here scopes ordinary plugin activation and cleanup; Cortico performs the agent loop. They solve different problems.

[DesktopHost:89–117](../../../../apps/desktop/src/main/desktop-host.ts#L89-L117) creates configuration, plugin-data and vault roots, approvals, permissions, and the optional encrypted credential broker. [DesktopHost:169–212](../../../../apps/desktop/src/main/desktop-host.ts#L169-L212) constructs the configuration service, plugin manager, and task supervisor. [RemoteRuntimeDriver:63–102](../../../../packages/host-kernel/src/runtime/remote-runtime.ts#L63-L102) launches one child with control, media, and sensitive-data channels; its session set covers multiple plugin owners. This is not one isolated OS process per plugin. [CordisRuntimeDriver:19–107](../../../../packages/host-kernel/src/runtime/cordis-driver.ts#L19-L107) supplies scoped context and owned cleanup within that worker.

| State or decision | Current authoritative owner | Implication for replacement |
| --- | --- | --- |
| Persona name, address, style, full prompt, appearance, speech selection | `pet.profile/default`, persisted by host `ConfigService`/`FileConfigStore`; [profile plugin:13–46](../../../../plugins/profile/src/index.ts#L13-L46), [application preferences:21–61](../../../../packages/contracts/src/application.ts#L21-L61) | Identity configuration already survives replacing the agent plugin. Do not copy it into a competing engine-owned settings file. |
| Saved versus acknowledged prompt revision | Saved profile is canonical; Cortico adapter retains `current`, `pending`, `builtProfile`, and prompt state; [agent:80–142](../../../../plugins/agent-cortico/src/agent.mjs#L80-L142) | Preserve the saved/applied distinction in any engine adapter. A successful save does not prove generation used the new prompt. |
| Conversation context and native engine records | One injected Cortico Persona declares persistent `everyday`; Core gets `rootDir`, `memoryDir`, `dataDir`; [agent:234–272](../../../../plugins/agent-cortico/src/agent.mjs#L234-L272), [agent:320–332](../../../../plugins/agent-cortico/src/agent.mjs#L320-L332) | Engine context and durable interaction storage currently have the same implementation owner. A new engine cannot automatically discover or interpret them. |
| Product interaction history | `core.store`, queried only for `source: pet.desktop`; [agent:435–479](../../../../plugins/agent-cortico/src/agent.mjs#L435-L479) | Both desktop views project the same current history. This is the correct present authority, but not an engine-independent identity/history service. |
| Semantic long-term memory | No semantic-memory/retrieval implementation is supplied by the current Persona; it supplies a directory and stub attachment store; [agent:234–258](../../../../plugins/agent-cortico/src/agent.mjs#L234-L258) | A directory named `memory` and persistent session do not establish a structured, scoped, queryable long-term memory system. Do not claim that capability already exists. |
| Legacy chat records | Read-only import input; `DemoController` now reads Core history into memory; [demo:588–625](../../../../apps/desktop/src/main/demo-controller.ts#L588-L625) | Keep the single writer. The recent-message array is a UI projection, not another persistent chat store. |
| Plugin identity, enable state, provider registration, generation | `PluginManager`; [manager:253–289](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L253-L289), [manager:375–442](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L375-L442) | `OwnerRef` identifies runtime authority, not the stable human relationship or assistant identity. |
| Task state and cancellation | In-memory `TaskSupervisor` records; [supervisor:82–107](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L82-L107), [supervisor:148–188](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L148-L188) | Reusable execution authority; not a persisted background-job journal or conversation memory. |
| One active desktop input intent, capture and projected partial text | `DemoController`; [demo:49–99](../../../../apps/desktop/src/main/demo-controller.ts#L49-L99) | This is currently a desktop interaction coordinator with single-intent semantics, not a platform-neutral event ingress. |
| Speech queue and playback status | `SpeechOutputController` plus the sole pet renderer playback owner; [speech:65–117](../../../../apps/desktop/src/main/speech-output-controller.ts#L65-L117), [playback:26–33](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L26-L33) | Receipt identities exist, but playback outcomes are transient and not fed back into Core history/context. |
| First-run flow and deliberate disabled plugin markers | `host.application-state` in a separate host settings record; [application:34–114](../../../../apps/desktop/src/main/application-controller.ts#L34-L114) | This is application setup/lifecycle state, not another conversation. Preserve or deliberately migrate it during a host move. |
| Credentials and approvals | Host broker and permission service; [host port:69–105](../../../../packages/host-kernel/src/runtime/host-services.ts#L69-L105) | Engine or gateway replacement must not acquire a second secret vault or self-approval path by accident. |

Storage is bound to stable plugin ID plus instance ID. [PluginDataDirectories:14–40](../../../../packages/host-kernel/src/config/data-directories.ts#L14-L40) hashes both into the directory path; runtime generation is not part of that storage identity. Consequently, changing the engine plugin ID changes its allocated data location. Keeping the old ID or pointing a new engine at the old directory would not itself make Core's state format portable.

The profile is a singleton containing a single `userName`; there is no platform account-to-person mapping or audience-scoped relationship state in [the profile contract](../../../../packages/contracts/src/application.ts#L21-L40). Sharing a persona across QQ, a livestream, and the desktop is not equivalent to treating every participant as that one user.

## 4. Strengths worth preserving, and their precise limits

**Explicit provider selection and generation fencing.** [CapabilityRegistry:96–164](../../../../packages/host-kernel/src/runtime/capability-registry.ts#L96-L164) selects by consumer/capability, binds a concrete provider generation, and rejects stale bound invocations. [TaskSupervisor:403–423](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L403-L423) captures the binding before running the call and links the provider signal. This is a sound basis for bounded replacement: new calls can choose a new provider; an existing call does not silently migrate.

The binding guarantee applies to **each capability invocation**, not necessarily an entire multi-round conversation. Every Core `respond` calls `ctx.host.capabilities.invoke` again ([agent:310–317](../../../../plugins/agent-cortico/src/agent.mjs#L310-L317)). The provider reads its selected model from config per request ([LLM provider:16–29](../../../../plugins/llm-provider/src/index.ts#L16-L29)). Model setup can change the selection for the agent consumer ([model connection:87–104](../../../../apps/desktop/src/main/model-connection-controller.ts#L87-L104)). Whole-turn model/config pinning requires an explicit policy; current task binding is not proof of it.

**Honest lifecycle and resource completion.** Stop unregisters capabilities/contributions, aborts the owner, and reports `pending_restart` when cleanup fails ([manager:431–442](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L431-L442), [manager:537–558](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L537-L558)). Task `result` and physical `settled` are distinct; cancellation can return a terminal result while work remains pending ([supervisor:189–253](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L189-L253), [supervisor:256–290](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L256-L290)). Remote invocations request `waitForWork: true` ([remote runtime:478–499](../../../../packages/host-kernel/src/runtime/remote-runtime.ts#L478-L499)). A future engine switch must wait for actual drain/cleanup, not merely a cancelled result.

**Configuration and secret authority.** Profile changes use expected revisions and the existing owner-bound save route ([profile:20–46](../../../../plugins/profile/src/index.ts#L20-L46), [host port:123–152](../../../../packages/host-kernel/src/runtime/host-services.ts#L123-L152)). The file store uses exclusive lock plus atomic rename and documents the commit fence: late cancellation cannot undo a committed effect ([file store:103–159](../../../../packages/host-kernel/src/config/file-store.ts#L103-L159)). That distinction must also apply to sent platform messages and accepted remote generation jobs.

**Transport backpressure without presentation claims.** Media has exact owner/task/stream/sequence identity and fixed buffering limits ([media contract:14–35](../../../../packages/contracts/src/media.ts#L14-L35)). A reader returns credit when it consumes a frame, before any renderer or audio hardware acknowledgment ([media peer:175–192](../../../../packages/host-kernel/src/tasks/media-peer.ts#L175-L192)). Writer `end` drains transport credits ([media peer:234–269](../../../../packages/host-kernel/src/tasks/media-peer.ts#L234-L269)). This is a useful transport foundation, not proof that output was displayed or heard.

**Saved and applied prompt are separated.** The adapter advances `current` only after prefix reload resolves and blocks a turn after reload failure ([agent:128–142](../../../../plugins/agent-cortico/src/agent.mjs#L128-L142), [agent:506–508](../../../../plugins/agent-cortico/src/agent.mjs#L506-L508)). A focused mocked-Core regression exists ([prefix test:31–66](../../../../plugins/agent-cortico/src/prefix-reload.test.mjs#L31-L66)). It tests adapter bookkeeping, not every upstream reload scheduling behavior.

These strengths do not amount to security isolation of arbitrary plugin code. The worker contains ordinary Node code and plugin implementations perform direct filesystem/network work. Keep the accepted trusted-plugin model explicit; do not market capability declarations as an OS sandbox.

## 5. Actual Cortico coupling and engine replacement cost

The plugin's top-level TypeScript wrapper is tiny ([agent entry:1–3](../../../../plugins/agent-cortico/src/index.ts#L1-L3)), but its implementation is not an abstract engine port:

1. It imports Core/config through `tsx`, builds provider metadata, starts/stops Core, reloads its prefix, interrupts its round, pauses its bus, pushes World events, and reads its event store ([agent:61–79](../../../../plugins/agent-cortico/src/agent.mjs#L61-L79), [agent:320–408](../../../../plugins/agent-cortico/src/agent.mjs#L320-L408), [agent:525–545](../../../../plugins/agent-cortico/src/agent.mjs#L525-L545)). These are legitimate adapter details; keep them there.
2. The current capability mixes engine execution, profile application, history, migration, interaction archive, destructive clear, and run control in one method table ([agent:345–556](../../../../plugins/agent-cortico/src/agent.mjs#L345-L556)). These product semantics need explicit schemas before a different engine can claim compatibility. The general SDK accepts string method names and JSON, without a typed `agent.conversation` contract ([SDK:91–102](../../../../packages/plugin-sdk/src/index.ts#L91-L102), [runtime types:16–25](../../../../packages/host-kernel/src/runtime/types.ts#L16-L25)).
3. Application code hardcodes `pet.agent-cortico/default`: the public constant ([application contract:11–19](../../../../packages/contracts/src/application.ts#L11-L19)), startup bindings ([admission:25–57](../../../../apps/desktop/src/main/application-admission.ts#L25-L57)), management/history calls ([application:155–216](../../../../apps/desktop/src/main/application-controller.ts#L155-L216)), text/media dispatch ([demo:521–565](../../../../apps/desktop/src/main/demo-controller.ts#L521-L565)), and model selection ([model connection:100–104](../../../../apps/desktop/src/main/model-connection-controller.ts#L100-L104)). A provider selector must replace these product assumptions; callers should not impersonate whichever engine owner happens to be installed.
4. `llm.responses@1` carries the complete response/origin/attempts structure, rather than text-only output ([agent:14–58](../../../../plugins/agent-cortico/src/agent.mjs#L14-L58), [agent:294–317](../../../../plugins/agent-cortico/src/agent.mjs#L294-L317)). This preserves useful tools/usage/reasoning data. However, [responses adapter:44–58](../../../../plugins/llm-provider/src/responses.mjs#L44-L58) imports Cortico `OpenAIHttpClient` and `ResponsesProvider`, then subclasses them. Replacing the agent alone can retain that dependency intentionally; claiming complete removal of Cortico requires addressing it too.
5. Native reasoning replay carries compatibility-domain metadata and opaque content ([responses:76–91](../../../../plugins/llm-provider/src/responses.mjs#L76-L91), [responses:177–213](../../../../plugins/llm-provider/src/responses.mjs#L177-L213)). Such state should remain engine/provider-specific. Exporting user-visible interaction facts is realistic; converting every provider's hidden reasoning to another framework is not.
6. UI public page manifests are also Cortico-shaped, but they are already a separate projection ([application contract:185–197](../../../../packages/contracts/src/application.ts#L185-L197)). A reasoning-engine change need not simultaneously rewrite the UI manifest protocol. Pinning a useful public data shape does not require retaining its entire engine.

The initial stable boundary should be small: owned inbound events, selected context/profile revision, a run lifecycle with cancellation, correlated output/receipts, and idle-time state import/export. Do not design a universal planner graph, universal reasoning trace, or new plugin loader to obtain that boundary.

## 6. History, context, memory, and output truth

### What is actually recorded

User text reaches `WorldHost.pushEvent` as `pet.message`, with text and mode/via, and trigger `flush` ([agent:534–545](../../../../plugins/agent-cortico/src/agent.mjs#L534-L545)). `DemoController.sendText` returns after scheduling `runTurn`, before that append is acknowledged ([demo:838–846](../../../../apps/desktop/src/main/demo-controller.ts#L838-L846)). A successful UI submission is therefore admission to local work, not a durable ingress receipt.

`pet_say` writes one complete JSON reply packet to task media, then archives `pet.speech`, then sets `turn.reply` ([agent:155–179](../../../../plugins/agent-cortico/src/agent.mjs#L155-L179)). There is no renderer receipt in that path. The event means the reply reached the host transport/recording path; it does not prove visible presentation or audio delivery. A failure after the media write but before the archive can also leave observable output without the corresponding history fact; those operations are not one transaction in this adapter.

Touch, expression, guide and update events use the helper with `deliver:false` ([agent:143–154](../../../../plugins/agent-cortico/src/agent.mjs#L143-L154), [agent:409–433](../../../../plugins/agent-cortico/src/agent.mjs#L409-L433)). They are in the shared interaction record, but this adapter does not feed those events into the active session or implement a retrieval tool for them. **A common archive does not mean every archived interaction is in the model's current context.**

There is a good limited precedent for truthful expression receipts: the renderer's blush timeline waits two frames, checks visibility, and invalidates older callbacks ([expression:45–65](../../../../apps/desktop/src/renderer/pet/expression.ts#L45-L65)). This is a presentation acknowledgment approximation, not emotional reasoning or a rich expression protocol. The agent exposes only `pet_say` and `configure_pet`; no model-driven emotion/action output contract is registered ([agent:155–224](../../../../plugins/agent-cortico/src/agent.mjs#L155-L224)).

The history projection returns cursor-derived IDs, time, kind, text, limited `via`/`mode`, and optional reaction ([agent:460–478](../../../../plugins/agent-cortico/src/agent.mjs#L460-L478)). It has no actor, audience, platform message ID, conversation scope, parent run, tool call, receipt status, or asset reference. The declared `via` is only bubble/console/voice ([interaction contract:155–165](../../../../packages/contracts/src/application.ts#L155-L165)). `clear` stops Core, deletes both `data` and `memory`, reconstructs it, and resets the cursor ([agent:382–395](../../../../plugins/agent-cortico/src/agent.mjs#L382-L395)). A future cross-platform cursor must distinguish a reset/epoch from ordinary continuation.

### Received, generated, delivered, played must not collapse

A minimal product record should distinguish these facts, using correlated IDs rather than duplicated chat messages:

| Fact | Current evidence | Minimum additional semantic |
| --- | --- | --- |
| Input received/admitted | UI accepts scheduling; final text later becomes `pet.message` | Stable inbound ID and transport/source ID; acknowledge after the chosen durable append boundary. Deduplicate reconnect delivery. |
| ASR hypothesis / committed transcript | Partial text is transient; only final transcript reaches Core | Preserve transient/committed distinction. Add segment/revision identity only when continuous speech requires it. |
| Output generated | Native Generation and `pet_say` tool flow | Stable run/response/output ID and revision; do not label unpresented generation “heard.” |
| Output delivered/presented | `pet.speech` after media write; limited separate expression receipt | Surface-specific delivery outcome tied to that output, including rejection/disconnection. |
| Audio started/completed/interrupted | `SpeechOutputPlaybackReceipt` has started/ended/failed only; [speech contract:98–117](../../../../packages/contracts/src/speech-output.ts#L98-L117) | Persist relevant receipt and interruption reason; for partial speech, consumed sample/time boundary or aligned segment IDs. No claim that hardware playback proves human comprehension. |
| Tool or job effect committed | Task completion and domain-specific result | Separate effect status from cancellation request. Already-sent messages or accepted remote jobs may survive a local abort. |

[Speech controller:538–574](../../../../apps/desktop/src/main/speech-output-controller.ts#L538-L574) updates only in-memory playback flags and cancels its tasks. [Renderer playback:137–175](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L137-L175) reports audio start/end but deliberately disables `onended` when stopping; it reports no consumed offset or interruption receipt. Neither path writes Core history. Consequently, the model can retain the full reply as completed even if the user heard none or only part of it.

This does not require storing every PCM frame or deleting text when playback is interrupted. Keep the generated text and append a compact correlated delivery fact. Context assembly can then say which portion was played or whether that is unknown. Text visibility and audio playback are separate dimensions.

### Can Core remain the identity authority after replacement?

For the current implementation, preserve Core as the one interaction-history writer. Replacing only a model provider does not require moving history. Retaining Core and replacing a compatible provider/Persona/World is a limited integration change, not a replacement of the entire agent architecture.

If the whole agent architecture is replaced, **Core cannot remain the universal authority without intentionally retaining a Cortico dependency as a storage/service component**. The present adapter needs a running Core and World host to append and query. Keeping its loop plus a new independent engine would create conflicting orchestration. Extracting or retaining just a well-supported storage role might be possible, but no such independent product-owned contract exists here and its semantics would need direct upstream verification.

The practical migration is facade first, single-writer cutover later:

1. Introduce a product interaction-history/identity facade whose first implementation delegates all reads/writes to current Core. Preserve existing cursor/history behavior and the canonical profile. No second writable store.
2. Formalize only the portable product facts and scope fields. Treat engine sessions, compressed context, opaque reasoning and scratch state as implementation-specific projections/checkpoints. A history projection alone is not a lossless export of all engine knowledge.
3. When replacement is actually selected and approved, quiesce ingress, drain/cancel work by policy, export facts and explicitly chosen durable memories, validate counts/IDs/order, import into the selected new authority, and switch the single writer once. Retain the old archive read-only for recovery; do not dual-write two authoritative chat stores.
4. Rebuild the new engine session from allowed profile/context facts. Record conversion omissions rather than inventing equivalent hidden state. Rollback before new writes can simply revert the selection; rollback after new writes requires reconciling those writes, not replaying effects.

That separates business continuity from framework internals without prematurely replacing the current storage.

## 7. Concurrency, attention, lifecycle, and the QQ-video interruption scenario

### Present concurrency semantics

`DemoController.begin` always calls `cancelCurrent`; cancellation aborts the whole intent and every tracked task ([demo:449–499](../../../../apps/desktop/src/main/demo-controller.ts#L449-L499)). This is global to the one controller, not scoped by platform or conversational lane. Text or a new recording therefore replaces existing desktop work.

The agent has a single global `active`. `turn` rejects if it is already active, routes all tool replies through it, and resolves it from Persona `onIdle` ([agent:85–89](../../../../plugins/agent-cortico/src/agent.mjs#L85-L89), [agent:168–179](../../../../plugins/agent-cortico/src/agent.mjs#L168-L179), [agent:259–270](../../../../plugins/agent-cortico/src/agent.mjs#L259-L270)). All accepted messages enter the same `everyday` session and source.

There is also a source-level admission race to validate: the `closed || active` guard is at [agent:481–483](../../../../plugins/agent-cortico/src/agent.mjs#L481-L483), but several awaits occur before `active = turn` at [agent:492–524](../../../../plugins/agent-cortico/src/agent.mjs#L492-L524). Distinct concurrent plugin calls can pass the initial guard before either reserves the slot. No claim is made that a failure was reproduced; the code does not implement an atomic reservation or explicit serial queue. Attaching multiple platform producers would expose this assumption.

Cancellation clears `active`, calls `interruptCurrentRound`, and resolves a cancelled turn ([agent:525–553](../../../../plugins/agent-cortico/src/agent.mjs#L525-L553)). The Core client's own `options.signal` is checked before invocation but is not forwarded as a separate ongoing cancellation source to the host capability call ([agent:274–277](../../../../plugins/agent-cortico/src/agent.mjs#L274-L277), [agent:310–317](../../../../plugins/agent-cortico/src/agent.mjs#L310-L317)). Host-task cancellation is well connected; arbitrary engine-only preemption during a request needs an explicit signal bridge and verification.

Pause currently calls `core.bus.setPaused` ([agent:398–403](../../../../plugins/agent-cortico/src/agent.mjs#L398-L403)). The desktop gates new send/record on paused state ([demo:246–274](../../../../apps/desktop/src/main/demo-controller.ts#L246-L274)); the application additionally ends active capture/preparation through `onConsoleClosed` ([application:220–231](../../../../apps/desktop/src/main/application-controller.ts#L220-L231), [demo:993–998](../../../../apps/desktop/src/main/demo-controller.ts#L993-L998)). This is not a promise that every current model/tool/playback operation is cancelled, or that every external capability caller observes the same pause gate.

### Can a QQ video job continue while the desktop user interrupts speech?

The existing execution substrate can express separate live tasks, but the current product path does not implement this scenario.

- `TaskSupervisor.run` accepts independent tasks and independent parent signals, retaining a bounded set of records ([supervisor:115–188](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L115-L188)). A host-created video task and a separate playback task can run concurrently.
- `SpeechOutputController.stop` cancels only its current synthesis/playback and queue ([speech:562–588](../../../../apps/desktop/src/main/speech-output-controller.ts#L562-L588)). It need not cancel an unrelated video task. Conversely, starting capture does not currently call this stop path, so automatic barge-in still needs explicit wiring.
- An ordinary plugin child invocation must reference an active parent task. The host binds its signal to both parent and RPC and limits it to 30 seconds ([host port:154–187](../../../../packages/host-kernel/src/runtime/host-services.ts#L154-L187)). The worker also imposes at most 30 seconds on nested host calls ([worker services:27–41](../../../../packages/host-kernel/src/runtime/worker-services.ts#L27-L41)). Thus a video operation invoked as a child of the active conversational turn is cancelled when that turn is cancelled; it is not an independently continuing job.
- This 30-second limit is not universal: host-origin `runtime.invoke` supports no deadline for owner-bound long-lived work, and the transport waits for physical completion ([remote runtime:478–497](../../../../packages/host-kernel/src/runtime/remote-runtime.ts#L478-L497)); the talk-key listener uses it ([voice input:207–215](../../../../apps/desktop/src/main/voice-input-controller.ts#L207-L215)). Do not fix long work by globally removing every RPC limit.
- Task records are in memory and host shutdown cancels them ([supervisor:367–371](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L367-L371)). “Continues after an interruption” and “recovers after process restart” are separate requirements.

The minimal future arrangement reuses the selected host's existing task system: an explicit authorized “start background work” operation creates an independently owned root task, records its origin/audience/output destination and cancellation scope, and immediately returns its stable work ID. A normal tool invocation must not silently detach itself from its parent. The foreground turn can then finish while the root task continues. On completion, inject a correlated result event for the main interaction agent to decide how/where to announce it; do not mutate global `active.reply`, and do not let the generation model independently speak as a second persona.

If the external service has already accepted a remote job, local cancellation must distinguish “stopped waiting,” “requested remote cancellation,” and “remote cancellation confirmed.” Add minimal persisted work/remote-job metadata only if reconnect/restart recovery is a confirmed requirement. This is domain state associated with the existing task system, not a second scheduler or task manager.

### Which state must serialize?

| Operation | Required ordering | Work that may run concurrently |
| --- | --- | --- |
| Profile/identity updates | Existing CAS revision commits; engine prefix application acknowledged at its safe boundary | Reads and proposals against a known revision |
| Canonical interaction append / reset / migration | One authoritative ordering and writer; reset/cutover is exclusive | ASR/media IO, inference, downloads; do not hold a journal lock over remote calls |
| Mutable engine session | Serialize mutation of a specific session/context projection | Different permitted sessions/lanes, independent classifier or worker inference with immutable snapshots |
| Foreground attention and output destination | One explicit decision about the current speaker/interrupt target; serialize ownership of a given audio device | Background jobs and silent work, other platform delivery where policy permits |
| Tool/business effects on the same resource | Resource-specific commit/CAS rules; cancellation cannot roll back an already committed effect | Independent resources/tasks |
| Model/gateway provider selection | Bind provider/config or role policy at a documented call/run boundary | Calls through already captured bindings |
| Derived memory updates | Versioned/provenance-aware commits against canonical facts; visibility enforced before retrieval | Extraction/ranking/embedding computations; these do not own the journal |

One recognizable assistant does not require one globally blocking LLM call. Start with one foreground interaction lane and independent approved background work. Add simultaneous conversational lanes only when QQ/public-room semantics are decided. Do not globally merge every public message and private desktop thought into one prompt.

## 8. Full-duplex gap analysis

The actual current pipeline is:

`manual talk gesture -> bounded 16 kHz capture -> ASR completion -> Core turn -> complete pet_say text -> TTS completion -> buffered renderer playback`

Evidence by stage:

1. Capture uses a ticket with 16 kHz, 1600-sample chunks and a bounded sample count ([demo:695–700](../../../../apps/desktop/src/main/demo-controller.ts#L695-L700)). Audio frames have ordered acknowledgments and bounded pending work ([microphone:140–158](../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L140-L158)). This is useful stream infrastructure.
2. Local ASR can emit hypotheses while consuming frames ([ASR local:63–79](../../../../plugins/asr-local/src/index.ts#L63-L79)). Cloud ASR collects all samples before transcription ([ASR cloud:28–55](../../../../plugins/asr-cloud/src/index.ts#L28-L55)). The voice orchestration explicitly waits for the completed transcript before calling Core ([voice chat:29–59](../../../../plugins/voice-chat/src/index.ts#L29-L59)).
3. The Core proxy returns one complete Generation from `llm.responses` ([agent:310–317](../../../../plugins/agent-cortico/src/agent.mjs#L310-L317)). The provider adapter only supplies a no-op `onEvent` for the browser protocol and returns the final JSON result ([responses:177–213](../../../../plugins/llm-provider/src/responses.mjs#L177-L213)). It does not forward generated deltas to the desktop.
4. `pet_say` emits the full text once ([agent:168–177](../../../../plugins/agent-cortico/src/agent.mjs#L168-L177)). The older standalone chat provider does stream scripted chunks ([chat:20–35](../../../../plugins/chat/src/index.ts#L20-L35)); the current desktop text path selects the Cortico conversation instead ([demo:521–545](../../../../apps/desktop/src/main/demo-controller.ts#L521-L545)). Old streaming code is not evidence of integrated streaming.
5. TTS is started only after `runTurn` completes and Core history is reread ([demo:890–898](../../../../apps/desktop/src/main/demo-controller.ts#L890-L898), [Main:257–259](../../../../apps/desktop/src/main/index.ts#L257-L259)). The system provider synthesizes the whole PCM before opening output ([system TTS:10–31](../../../../plugins/system-tts/src/index.ts#L10-L31)).
6. Main collects all chunks, awaits synthesis result and read completion, validates final frames, then calls playback ([speech:337–365](../../../../apps/desktop/src/main/speech-output-controller.ts#L337-L365), [speech:416–446](../../../../apps/desktop/src/main/speech-output-controller.ts#L416-L446)). The renderer buffers again until `end`, constructs a complete AudioBuffer, and starts it ([playback:80–145](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L80-L145)). Current total synthesized-audio budget reuses the media buffering constant; changing only the provider to emit chunks will not make this consumer play incrementally.

Additional gaps are continuous VAD/end-of-turn policy, echo/reference-audio handling, overlapping input/output scheduling, partial ASR correction, segment-aligned text/audio/expression, priority/barge-in semantics, and playout receipts feeding the next context. The microphone request specifies channels/device, not a product-controlled echo-cancellation or full-duplex pipeline ([microphone:207–235](../../../../apps/desktop/src/renderer/console/demo/microphone.ts#L207-L235)); browser defaults may exist, but have not been measured here.

Keep three claims separate:

- System-level asynchronous presence: accept events while background jobs progress; attainable with existing host primitives plus explicit attention/work policy.
- Streaming speech with interruption: incremental text/audio, overlap, immediate playout stop, and truthful partial-delivery context; requires changes across provider, agent output, speech controller, renderer, and records.
- Native model-level audio/video duplex: provider/session support for continuous modalities and turn control; cannot be synthesized by renaming a unary Responses adapter.

Use feature negotiation and graceful capability limits. Do not require every engine or provider to support the most demanding mode, and do not claim measured latency from the 50 ms Core batching configuration ([agent:78](../../../../plugins/agent-cortico/src/agent.mjs#L78)).

## 9. Multi-model roles and gateway boundary (R8)

Multiple providers can be registered today, and independent capability calls can run concurrently. The current main agent nevertheless has one selected `llm.responses@1` provider per consumer, and the model plugin selects one configured model for each endpoint ([registry:96–140](../../../../packages/host-kernel/src/runtime/capability-registry.ts#L96-L140), [LLM provider:15–29](../../../../plugins/llm-provider/src/index.ts#L15-L29), [LLM provider:138–147](../../../../plugins/llm-provider/src/index.ts#L138-L147)). There is no first-class judgment/interaction/deep-reasoning/image/video role registry, role-specific cancellation policy, or completion-to-main-agent workflow in the current adapter.

A gateway such as the separately investigated Magpie can sit behind model capability providers to normalize credentials, endpoints, streaming, usage, and model selection to the extent its actual interfaces support them. It should not silently own identity, user-visible history, audience permissions, attention, or agent-session scheduling. Gateway routing answers “which model handles this operation”; the companion runtime answers “what information may it see, which task owns the result, and who may express it where.”

Recommended minimal role split:

- A fast classifier emits a bounded decision/proposal, with a deterministic fallback for ordinary known cases. It does not grant permission or create another personality/history.
- The interaction engine remains the user-facing coordinator, consuming the approved profile/context and explicit worker results.
- Deep reasoning and media generation use supervised independent work when requested. Their results carry provenance, audience, work ID, and artifacts; the main interaction agent decides presentation.
- Expression decisions can be deterministic or model-assisted. Their output is a bounded presentation intent; rendering acknowledgment remains separate from the proposal.

Do not force all modalities into `llm.responses@1` or send large assets as base64 in JSON. Generic JSON payloads are capped at 64 KiB ([JSON contract:21–28](../../../../packages/contracts/src/json.ts#L21-L28)); media frames are generic binary transport with bounded buffering, not an image/video asset registry ([media contract:14–35](../../../../packages/contracts/src/media.ts#L14-L35)). The agent's attachment store is explicitly unconfigured ([agent:234–241](../../../../plugins/agent-cortico/src/agent.mjs#L234-L241)). Images/video therefore need a minimal owned artifact/reference contract and, where the service is asynchronous, accepted/status/result/cancel semantics. Artifact access must preserve source/audience permissions and retention; a file path or arbitrary URL is not sufficient authority.

For the first implementation, define only the roles and modality operations actually selected for the acceptance slice. A universal model taxonomy and second task orchestration engine would be premature. Preserve full usage/attempt records and opaque provider state where supported; do not flatten everything to text just to make adapters look interchangeable.

## 10. Minimal stable contracts, without a new framework

These are responsibilities to formalize within the selected host/plugin model, not a request to create six managers or services immediately.

| Boundary | Minimum stable data/behavior | What remains replaceable/private |
| --- | --- | --- |
| Identity/profile | Stable assistant identity, canonical profile revision, explicit account/person mapping when multi-user access arrives; saved/applied acknowledgment | Prompt assembly strategy, engine prefix representation; existing profile CAS remains the initial authority |
| Ingress and context scope | Inbound/source message ID, actor, platform/destination, conversation scope, audience/visibility, causation, committed content/asset references | Platform SDK/API shape, ASR hypothesis stream, transport reconnect details |
| Engine run | Accept committed input plus selected context/profile; observable run ID/status/output; cancel and actual drained acknowledgment; supported features; quiescent export/import | Cortico Persona/World, alternate planner/agent structure, hidden reasoning, compression/checkpoints |
| Canonical record and memory query | Ordered product facts, reset epoch, correlated delivery/effect receipts, scoped history reads; memory selection cites source facts | Engine transcript as a derived projection; retrieval/index implementation; embeddings and scratch files |
| Expression/output | Output ID, target surface, text/audio/expression segments when used; actual presentation/playback receipt; cancellation target | Native rendering, TTS implementation, avatar model, transport/audio codec choices |
| Supervised work and model calls | Existing owner/task/generation/permission/credential contract; role-specific immutable input; explicit background-work ownership and artifact/result receipt | Gateway/vendor choice, model internals, local/remote computation |

The existing `agent.conversation@1` can remain a compatibility facade while these semantics become explicit. Separate portable business facts from engine state conceptually before splitting packages. Introduce a new capability version only when the behavior actually changes incompatibly; do not create an entirely parallel SDK.

A platform plugin should map ingress/egress and account bindings. A model/gateway plugin should map model requests/events. An engine plugin should map orchestration and engine sessions. Existing native functions stay host-authorized capabilities. These boundaries make adapter work bounded without claiming identical engine behavior.

## 11. Local versus headless topology, including DSH as the main runtime (R9)

Host ownership and visible entry point are separate choices. A DSH page can be a surface of an independent runtime, and an Electron pet can be a native surface of DSH. Neither fact alone identifies the canonical assistant or task owner.

| Route | Canonical runtime and surfaces | Advantages | Actual migration cost / boundary |
| --- | --- | --- | --- |
| A. DSH runtime + DSH plugin UI + Electron pet client | DSH-hosted companion plugin owns the product interaction domain; DSH supplies the selected runtime task/permission/plugin lifecycle authority. Electron owns local window/audio/device execution. | Reuses a user-accepted host and its ecosystem; can make DSH the primary work/management entry. No need to maintain an independent general-purpose plugin host if its public APIs suffice. | Adapt current product capabilities and state into DSH's actual public services. Retire or reduce overlapping `PluginManager`/`TaskSupervisor`/permission/credential management in the central runtime. Define authenticated native bridge, cancellation, media and reconnect semantics; existing Electron IPC is not that bridge. Native OS permission and presentation receipts remain local. DSH framework availability/version and restart semantics become product dependencies. |
| B. Independent headless-capable runtime + Electron/DSH surfaces | Extract reusable product runtime from Electron composition; retain one product-owned kernel and identity/history authority. DSH is an optional surface/tool adapter. | Independent product distribution, explicit engine/plugin contracts, and freedom to deploy the same authority locally or on another machine. Most current kernel mechanisms remain useful. | Build a real headless composition root, supported remote surface protocol, approval delivery, credential backend, service supervision, and reconnect behavior. Existing host is reusable Node code, but these deployment/transport contracts do not yet exist. Maintaining the kernel remains this project's responsibility. |
| C. Current Electron as full host | Current Main, worker, Core, and native UI; platform connectors run while that application runs. | Lowest migration risk for a desktop-first, local voice/identity proof. Preserves existing source-backed behavior and acceptance setup. | Application quit or PC outage ends the runtime. It remains desktop-centric, has the current single-intent behavior, and must later extract hosting/transport if 24/7 platforms become required. |

Evidence for the current hosting dependency: Electron `whenReady` creates the host and injects `safeStorage`, native paths, media routers, and UI notifications ([Main:183–248](../../../../apps/desktop/src/main/index.ts#L183-L248)). Only the pet renderer receives audio ([Main:287–290](../../../../apps/desktop/src/main/index.ts#L287-L290)); a hidden settings window owns capture ([Main:592–603](../../../../apps/desktop/src/main/index.ts#L592-L603)). All windows closed quits the app ([Main:625–631](../../../../apps/desktop/src/main/index.ts#L625-L631)). The current trusted bridge requires an exact `file:` main-frame URL ([IPC source:24–30](../../../../apps/desktop/src/main/ipc-request.ts#L24-L30)); it cannot simply be exposed as a network endpoint. `DesktopHost` also hardcodes `win32-x64` admission ([DesktopHost:173–179](../../../../apps/desktop/src/main/desktop-host.ts#L173-L179)). A headless Linux daemon is therefore plausible refactoring work, not an already supported launch mode.

A critical trap in A is putting the entire present `DesktopHost` inside a DSH plugin and declaring DSH “the runtime.” DSH would cancel/disable its plugin while a nested manager retained plugin states, task roots, independent permission dialogs and credentials. The team would have to reconcile both authorities on every restart, approval, cancellation, and source trust change. If DSH is selected as primary, use one clear authority for each resource and translate product behavior into that host. A temporary migration bridge is acceptable if its ownership and retirement are explicit; a permanent nested host is not automatically simpler than B.

Conversely, in B, calling DSH as an external tool backend does not make DSH's permissions identical to local native permission. Each actual resource owner must enforce its own boundary. A host-authorized delegated action can have a local device execution receipt without creating a second companion identity or competing scheduler.

Availability is orthogonal to the A/B label: a DSH instance or independent daemon on the same sleeping PC still cannot serve QQ while the PC is offline. A separately hosted authority is needed for that requirement. The native client may disconnect while server-side work continues; desktop effects must wait, fail, or expire according to an explicit policy. Start with one active authority, not an offline dual-writer synchronization system. An independently usable offline pet plus cloud continuity would require a separate product decision about conflict/merge behavior.

Conditional recommendation:

- Choose **A** if DSH is acceptable as a required runtime, users primarily work through DSH, and the separately verified DSH public contracts support the needed supervision, records, events, and native bridge. Existing investment in the custom kernel is not by itself a reason to reject this route.
- Choose **B** if independent installation/distribution or operating without DSH is a product requirement, or if DSH's public contracts cannot represent the essential companion lifecycle without extensive internal coupling.
- Use **C** for the next local proof when host ownership is still undecided; avoid expanding its desktop controllers into permanent platform routers.

The highest-value decision is whether DSH may become the required canonical runtime. Couple that with the availability requirement: must the assistant operate when the desktop app/PC is off? Neither “one shared persona” nor “a DSH UI” resolves those questions automatically.

## 12. Staged migration and smallest meaningful proofs

These are proposed future gates, not work performed in this research.

**Stage 0 — Choose the acceptance slice and authority.** Decide A/B/C, required availability, first two surfaces, public/private memory visibility, and the first interruption behavior. A good narrow slice is one desktop conversation plus one simulated remote source, one independent background work item, and truthful interruption receipts. Do not simultaneously require full native audiovisual duplex, all platforms, arbitrary engine swaps, and durable distributed jobs.

**Stage 1 — Make the existing boundary explicit while preserving current authority.** Keep current profile CAS, task/permission/credential ownership, and Core as the sole interaction writer. Introduce the selected engine/provider reference instead of scattered hardcoded IDs. Put existing history/control calls behind a product facade backed by Core. Give new inbound/output/work items stable correlation and scope, reserve conversational admission before awaits, and describe engine capabilities. Keep existing fixed preload boundaries; add remote transport only for the chosen route. In route A, first specify which existing authority maps to which actual DSH service before moving state.

**Stage 2 — Prove attention and background-work semantics using the current engine.** Add the explicit independent-work path through the existing selected supervisor, and connect speech interruption to the correct foreground output. Preserve task scope and owner revocation. Complete results reenter as scoped facts, not independent personalities. Establish the output bookkeeping needed for truthful context. This stage need not replace the engine or storage.

**Stage 3 — Make the real speech path incremental.** Forward verified model output events, segment speakable text, use a provider/consumer contract that supports incremental synthesis/playout, and record played/interrupted segments. Continuous capture/VAD and echo handling follow as their own device acceptance gate. Preserve a simpler supported utterance mode. Native model duplex is a separate provider/session experiment with declared features, not a compatibility assumption.

**Stage 4 — Prove one alternate engine at a safe boundary.** Use a second minimal scripted engine to demonstrate admission, profile revision, output correlation, cancellation/drain, tool permissions and scoped history consumption. First run it behind the facade with read-only imported context or an isolated test record. If removing Core is required, perform the single-writer history/memory cutover described above. Do not permit two production engines to append independently to the same conversation while calling that a migration.

**Stage 5 — Add the selected gateway and one actual extra platform.** Map model roles and multimodal jobs only as their verified protocols allow. Add account linking, replay deduplication and audience enforcement before real cross-platform sharing. Move to an independently available host if required. Native credentials/device authority stay at their actual execution boundary.

### Minimal proof matrix

| Experiment | What it must prove | Failure it should expose |
| --- | --- | --- |
| Two simultaneous turn admissions with delayed profile/media opens | Exactly one accepted foreground slot or a documented queue; stable request IDs; no overwritten `active` | The current pre-await guard race and output attributed to the wrong request |
| QQ fixture requests video; desktop fixture starts speaking and interrupts playback | An explicitly independent supervised video task continues; only the targeted speech/foreground task stops; completion routes back to the authorized QQ scope once | Accidental parent cancellation of background work, global stop misuse, leaked result to the public room |
| Same scenario with owner disable and host shutdown | Owner revocation cancels its work; physical drain or honest cleanup failure; no late new-generation effects | “Cancelled result” incorrectly treated as completed cleanup; unowned detached promises |
| Interrupted PCM fixture with generated text longer than playout | Generated text is retained; a correlated played/interrupted boundary reaches context; unknown remains unknown | Full generated text mislabeled as heard; stale playback receipt accepted |
| Profile CAS and engine switch while a tool effect commits | Old revision stays acknowledged until reload; switch waits for drain; committed effect survives cancellation truthfully | Prompt silently changed mid-run; duplicate effect on restart/replay |
| History-facade export/import into a minimal alternate engine | Stable fact IDs/order/scopes and explicit clear epoch; exactly one writer after cutover; no effect replay | Lossy UI projection mistaken for full engine export; two writable chat authorities |
| Private desktop fact plus public Bilibili fixture query | Audience policy filters retrieval and generated output; public events cannot approve private tools | Shared history accidentally means unrestricted shared context |
| Long remote-work fixture / restart only if required | Accepted remote job ID, explicit local/remote cancellation outcome, and reconciliation without reissuing the effect | A 30-second RPC mistaken for durable work, or duplicate video generation on reconnect |

Use local deterministic providers, delayed fake IO and fixed audio artifacts for these proofs. Measure first-output and interruption behavior only when the actual path exists; prior native tests and planned fixture results are not current latency evidence. The existing [Cortico plugin probe:48–71](../../../../qa/probes/cortico-plugin-host.ts#L48-L71) usefully covers profile/media/history and generation restart, but it does not establish simultaneous multi-platform turns, durable background jobs, or full-duplex behavior.

The main implementation risk is not a missing class hierarchy. It is allowing multiple systems to claim the same mutable identity, conversation, task, or delivery outcome. A thin facade, explicit scopes and receipts, one chosen host authority, and one controlled engine-state migration are the smallest credible route to the requested persistent companion.

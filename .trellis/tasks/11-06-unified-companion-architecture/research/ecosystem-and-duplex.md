# Ecosystem, duplex semantics and DSH hosting evidence

Research date: 2026-11-06 (Asia/Hong_Kong). This is source/documentation inspection, not a working integration or latency benchmark. Recommendations remain proposals under [the PRD](../prd.md).

## 1. Three meanings of full duplex

| Layer | Observable behavior | What does not prove it |
| --- | --- | --- |
| System concurrency | Continue receiving user input while reasoning, tools or media jobs run; return results through the owning conversation | Multiple agents alone do not provide simultaneous audio understanding/output |
| Streaming voice with interruption | Capture and play concurrently; stop playback on interruption; retain the actual played prefix and accept corrections | SSE text, a streaming ASR transcript, or a cancel button alone |
| Native conversational audiovisual duplex | A model consumes ongoing audio/video while deciding speech, silence, backchannels and asynchronous actions | A conventional ASR → complete text response → TTS chain |

A useful product can progressively implement these layers, but should name which behavior it actually supports. No architecture adapter can manufacture a missing model capability.

## 2. Higgs: published claims versus documented integration

Primary sources:

- [Higgs Realtime Duplex announcement, 2026-11-05](https://www.boson.ai/blog/higgs-realtime-duplex).
- [Realtime overview](https://docs.boson.ai/models/higgs-realtime/overview.md).
- [Connections and sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions.md).
- [Turn detection and interruptions](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md).
- [Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md).

The announcement describes a 45B MoE front model trained on about two trillion tokens, continuous audio/video input and speech/face output in **160 ms chunks**, and asynchronous reasoning/tools/backend-model delegation. These are vendor descriptions. **160 ms is a processing chunk size, not a measured end-to-end response latency for this project.**

Public documentation exposes `wss://api.boson.ai/v1/realtime`, a session model named `higgs-realtime`, and optional transcription model `higgs-stt-3.1`. Its overview explicitly says WebRTC support is in progress. Session output is exactly audio or text, and documented turn detection uses server VAD, semantic VAD, or manual commit.

The custom function-tool flow completes a function-call item, the client executes it, supplies a matching result, then requests continuation. The separately documented server-side web-search tool can finish asynchronously and merge its result into a later reply. Do not generalize the web-search special behavior to all tools or to all backend models without testing.

The announcement's [Try it section](https://www.boson.ai/blog/higgs-realtime-duplex#try-it) explicitly states: “An API for Higgs Realtime Duplex is coming soon; join the API waitlist to hear when it launches.” It then identifies the existing Higgs Realtime model as available today. The upstream reviewer extracted the complete article body, and the coordinator independently read this ending. Thus the new Duplex API is **announced / waitlist**, while the documented Realtime API is **available**; they must not be conflated. Open weights for the new Duplex model were not established by this research.

The interruption guide is particularly useful: the server estimates the cut point, but the client must stop its player and send `conversation.item.truncate` with `audio_end_ms` equal to the audio actually played. This directly motivates a product distinction between **generated**, **delivered/displayed**, and **played** output. An unplayed sentence must not become a fact the assistant assumes the user heard.

## 3. AstrBot: useful boundaries beyond a bot persona prompt

Read-only source snapshot: [`86c24e846c0de78830f6a0bc402049edb0f0c671`](https://github.com/AstrBotDevs/AstrBot/tree/86c24e846c0de78830f6a0bc402049edb0f0c671), commit date 2026-11-05. Checked in a temporary sparse checkout; no upstream code executed. GitHub repository metadata reports AGPL-3.0; this research recommends concepts, not copying its implementation into the MIT project.

Source-backed findings:

- [MessageSession](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/platform/message_session.py#L7) identifies a platform instance + message type + session ID. The `platform_name` field actually carries the platform instance ID. [Custom rules](https://docs.astrbot.app/use/custom-rules.html) bind overrides to this UMO, not a display name.
- [ConversationManager](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/conversation_mgr.py#L92) maps a UMO to a selected conversation; conversation IDs, personas and platform IDs are stored explicitly. This is not automatic cross-platform human identity resolution or one global context.
- [PersonaManager](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/persona_mgr.py#L123) resolves forced session rules, conversation selection and configured defaults. [Persona application](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/astr_main_agent/persona.py#L32) supplies prompt, initial dialogue, tools and skills. Useful composition, but not a complete emotional/episodic-memory architecture.
- [Internal processing](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/pipeline/process_stage/method/agent_sub_stages/internal.py#L184) acquires a per-UMO session lock and rechecks relevant state after waiting. Borrow the explicit ownership/serialization concept, not a single lock across every platform.
- [Platform adapter guide](https://docs.astrbot.app/dev/plugin-platform-adapter.html) defines receive/normalize/send behavior, rich message components and media cleanup. Bilibili private messages are an example of an adapter target, not evidence that all Bilibili surfaces have a built-in official adapter.
- [Agent runners](https://docs.astrbot.app/providers/agent-runners.html) are replaceable and include external runners. It would be inaccurate to describe AstrBot as entirely unextensible or fixed to one agent loop. The question is whether its particular contracts fit this product's real-time embodied interaction.
- [KnowledgeBaseManager](https://github.com/AstrBotDevs/AstrBot/blob/86c24e846c0de78830f6a0bc402049edb0f0c671/astrbot/core/knowledge_base/kb_mgr.py#L24) separates embeddings, retrieval and ranking. [Knowledge-base docs](https://docs.astrbot.app/use/knowledge-base.html) distinguish dialogue, embedding and reranking models; indexes must be rebuilt when embedding compatibility changes. RAG documents are not automatically durable relationship memories or model training.

For this project: reuse the ideas of explicit platform origin, rich message parts, per-context settings, replaceable runners and retrieval services. Add a product-owned identity mapping and scoped shared memory deliberately. Do not merge all group/private transcripts into one model input merely to achieve a common persona.

## 4. Pi: inspectable routing and extension composition

Read-only snapshot: [`7fd1ee05012259ab43882645117e2c9b40be75cd`](https://github.com/badlogic/pi-mono/tree/7fd1ee05012259ab43882645117e2c9b40be75cd), commit date 2026-11-06. Primary sources:

- [Extensions](https://github.com/badlogic/pi-mono/blob/7fd1ee05012259ab43882645117e2c9b40be75cd/packages/coding-agent/docs/extensions.md).
- [Virtual models](https://github.com/badlogic/pi-mono/blob/7fd1ee05012259ab43882645117e2c9b40be75cd/packages/coding-agent/docs/virtual-models.md).
- [Jev router example](https://github.com/badlogic/pi-mono/blob/7fd1ee05012259ab43882645117e2c9b40be75cd/packages/coding-agent/examples/extensions/jev-router.ts).

Pi exposes lifecycle interception, context/compaction, custom tools/commands/UI, providers, MCP registration and persisted extension entries. Its extension docs explicitly say extensions share the process's system privileges; extension freedom does not itself imply isolation.

Virtual models keep a stable user selection separate from each request's physical model and thinking level. The route sees user/continuation/retry/direct reasons, previous/failed routes, branch-persisted router state and an abort signal. The docs warn that classifier calls add pre-first-token latency; keeping a model during tool continuations preserves prompt-cache and signature compatibility.

The official Jev example looks up `typesafe/jev-latest`, uses `classify` to score the complexity of the initial software-engineering request, and then makes one planned switch after the first successful edit/write. It is a concrete reference for the user's illustrative idea. It is **not** evidence that Jev is an audiovisual turn detector, an emotion model, or a validated desktop-motion policy. The user's intended exact Jev model/provider remains unconfirmed.

For this product, a useful routing extension should record why a route was chosen and what actually handled the request. Immediate drag/touch/playback-stop behavior should not wait for this route. Avoid stacking a product classifier and a gateway intent classifier for every event.

## 5. DSH plugin hosting is a real option

Inspected the running DSH `0.2.2-rc.1` through read-only Cordis Inspect on 2026-11-06. The package version is from the installed CLI manifest, not inferred from this project's dependencies. No profile configuration was changed and no plugin was installed.

Verified public contracts:

| Inspect provider / service | Relevant observed contract | Implication |
| --- | --- | --- |
| Host Service / `agents` | `create`, `resume`, owner-bound handles and an effect-scoped `setFactory`; duplicate factory rejected | Plugins can own persistent/resumed agents. A custom driver is possible, but replacing the default factory is an architectural change, not a UI toggle |
| Host Service / `agentPresets` | scoped composition, retained revisions, `mount`, `composeFrom`, blank-agent `recompose` | Strong modular composition; no promise of arbitrary live state migration mid-session |
| Host Service / `llm` | provider adapters, `prepareCall`, `stream`, registration-bound routing, standard replay state | Useful model boundary; inspected stream variants are text/reasoning/tool/usage/finish, with text/image input metadata |
| Client Slots / live tree | `settings.section`, `sidebar.panellist`, `shell.overlay`, `conversation.view` | A character settings page, panel or in-page companion can be an installed UI plugin |
| Host service directory | tools, subagents, storage, sessions, credentials, approval, connections and webserver | Existing infrastructure should be evaluated before recreating it in a DSH-hosted product |

The inspected `llm` contract is not itself a continuous microphone/camera/speaker contract. A DSH-based solution still needs dedicated realtime media services/adapters and playback acknowledgments. A browser overlay remains inside the browser; native transparent always-on-top desktop windows/global input require a native client or another explicitly supported native capability. Keeping a thin Electron pet does **not** force Electron to own the assistant's agent loop.

Installed [agent-loop documentation](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/README.md) explicitly recommends a custom Agent when call-model/run-tools/repeat is insufficient. It also documents stable `sessionId` for resume-or-create, and programmatic setup for per-agent persona/tool scoping. Therefore attaching a persona to whichever coding session happens to be open is not a sound identity design.

The inspected [plugin practices](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md) favor scoped effects, replayable session facts, explicit storage contracts and incremental projections. They also restrict arbitrary custom session event types. Any companion memory/experience store must use an allowed storage contract; do not append invented DSH log records or create two competing writers for the same fact.

These findings establish feasibility and boundaries, not a completed DSH integration. Host selection remains the next product decision.

## DSH follow-up: other frameworks and cross-session coordination

On 2026-11-06 the user asked whether DSH supports other agent frameworks, and clarified that future architectures need cross-session operation rather than making one Session the product center. Additional read-only inspection of DSH 0.2.2-rc.1 established:

1. The installed [Agent package README](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/README.md#L92) explicitly separates the Agent handle/registry from construction and driving to keep the driver swappable. The [default driver README](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/README.md#L12) recommends a custom Agent when the standard model/tool loop is insufficient.
2. Live `agents.setFactory(factory)` rejects an already-registered factory. The inspected create/resume options carry identity, model route and setup, not a framework selector. Multiple frameworks cannot simply each register as the default factory in the same registry. A dispatcher factory, separately scoped composition or plugin-owned service is candidate integration work, not a verified turnkey feature.
3. The installed [runtime Agent contract](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts#L163) requires `session`, `model`, `inbox`, `status`, `ctx`, cancellation, idle/maintenance and input controls. The compact Inspect output showing only `Agent.id` omits these merged declarations; it is **not** the full implementation contract. The [default implementation declaration](/home/kingBZ/.nvm/versions/node/v26.13.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/types/agent.d.ts#L20) implements these requirements.
4. Live `subagents.registerProvider` supports named providers with start/result/dispose and declared capabilities. External execution does not automatically inherit local continuable-child messaging, persistent resume or audio streaming. In contrast, a plugin-owned host service can implement its own framework protocol, at the cost of explicit lifecycle/control/UI integration.
5. Live `storageDomain.open` accepts a named domain with versioned schemas, tables and optional global data; the caller closes its handle. It is not keyed to an Agent Session. This enables a host-owned companion state store, but is not a ready-made semantic memory or cross-domain transaction engine.
6. Live `agent/assistant-stream` is an emit event with ordered attempt start/chunk/end, and its committed end points to a durable Session event. Replacing the driver while preserving native presentation/replay means respecting this observable contract. A native realtime audio service still needs its own media protocol.

The [Superagent source analysis](upstream-runtimes.md#verified-processing-chain) shows a separate transactional domain store and worker sessions attached to Tickets. Thus **using Sessions as execution records is compatible with a cross-session product coordinator**. Choosing DSH does not force the long-lived companion to be the current chat Session. Conversely, exposing a foreign framework as a tool does not mean that it has replaced DSH's native session/agent semantics.

The recommended candidate is a host-scoped companion domain and coordinator, with replaceable execution adapters beneath it. A deeply different, continuous runtime may initially integrate as a plugin-owned service and custom page, while DSH native Agents remain useful task workers. Whether native Session UI, tools, recovery and future checkpoint portability are preserved depends on the adapter depth. No framework adapter or proof was implemented in this follow-up.

## 6. Synthesis constraints for the candidate design

1. Treat the main interaction agent as a role with one identity and controlled output ownership, not necessarily one model process or one unlimited transcript.
2. Keep personality, relationship facts, episodic memories, ongoing tasks and source documents distinguishable. Give each fact a source and visibility context before cross-platform retrieval.
3. Let independent tasks and separate platform conversations progress concurrently, while serializing conflicting durable changes and speech on the same output device.
4. Keep the minimal stable boundary semantic: input events, context projection, task initiation/result, output commitment, interruption and export/import. Provider-private caches/checkpoints remain opaque and non-portable unless explicitly supported.
5. Choose one task/permission/plugin lifecycle authority in a deployment: DSH when hosted there, or the standalone kernel. Do not operate both as overlapping masters.
6. Classifier routing and Magpie can be valuable, but must preserve capabilities and stream identity. Detailed gateway evidence belongs to [the Magpie report](magpie-routing.md).

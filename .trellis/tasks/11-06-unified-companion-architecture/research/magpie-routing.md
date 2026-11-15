# Magpie and multimodel routing for a unified companion

Research date: 2026-11-06. Status: proposal and source inspection only; no implementation decision or measured performance result.

**Recommendation: adopt Magpie, if desired, as a replaceable provider adapter and optional external gateway. Do not make it the identity, memory, interaction scheduler, or mandatory transport of the companion.** The inspected version is substantially more capable than a chat-only proxy: it implements intent/effort classification, a dedicated System One decision endpoint, Chat and Responses streaming, Responses WebSocket sessions, file transcription, streamed speech synthesis, image generation/editing, asynchronous video creation/polling/download, and generation tools over MCP. That breadth makes it a credible integration candidate. It does not establish a native realtime audio/video session contract or a portable cancellation and persistence contract for every modality.

This boundary works whether the primary host becomes a DSH plugin or a standalone Electron application. The user has reopened that host decision; the existing standalone ADR is historical context, not a constraint on this recommendation. In either host, the product must own which conversation may speak, which memories a surface may see, what was actually heard, and how long-running work returns to the conversation.

## Evidence scope and reproducibility

Magpie was inspected at commit **[`12a9970d6ed9dca2943de519f9339923a56d3960`](https://github.com/yetone/magpie/commit/12a9970d6ed9dca2943de519f9339923a56d3960)**, whose GitHub commit metadata records 2026-11-06T14:36:23Z. Source URLs below are pinned to that commit. A full shallow clone was stopped because it was slowly transferring unrelated assets; the GitHub tree and selected source files were then fetched into a unique temporary research directory using the contents API. No Magpie code, dependency installation, build, test, service, account login, or inference request was executed.

The inspection covers the actual gateway route registration, provider/group definitions and routing strategies, intent and decision calls, Chat/Responses codecs, Responses sockets, HTTP cancellation paths, audio handlers, image handlers/MCP jobs, video handlers, native passthrough, and response-state/reasoning carry. It is a targeted inspection, not a security audit or proof about all plugins and every upstream provider.

Primary documentation read: the pinned [README][M1] and [integration guide][M2], plus the live [intent-routing guide][D1] and [integration page][D2]. The live intent guide is older than the inspected implementation in important details. In particular, its claims that the classifier receives only the latest message, cannot itself be a group, and always falls back to no intent after a failure do **not** describe all behavior at the inspected commit. Source wins where they differ.

Local inspection was deliberately narrow: [provider registration](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/index.ts#L13), [Cortico compatibility adapter](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/responses.mjs#L25), [native protocol conversion](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/native-protocols.mjs#L1), and [endpoint contracts](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/packages/contracts/src/model-services.ts#L1). The broader local-runtime and DSH audits belong to the coordinator's research.

## What the pinned Magpie implementation actually exposes

“Implemented” below means the route and handling logic were found in source. It does not mean every model behind that route supports the operation, that all vendor options survive conversion, or that the route passed a live integration test.

| Capability | Source finding | Consequence for this companion |
| --- | --- | --- |
| Chat Completions | `POST /v1/chat/completions` and an unprefixed alias are registered. The Chat codec handles text, reasoning, tools and streaming chunks. [Routes][M3], [Chat codec][M5] | Suitable candidate for ordinary dialogue, classification with chat models, and backend reasoning. Select and verify model capabilities separately. |
| Responses over HTTP/SSE | `POST /v1/responses` is registered. The codec handles text/reasoning deltas, tool argument deltas, completed/incomplete/failed responses, and sealed reasoning items. [Routes][M3], [Responses codec][M6] | More than superficial endpoint naming, but not evidence of the entire OpenAI Responses API resource lifecycle. Generic response retrieval/deletion/background cancellation routes were not found in the inspected route registration. |
| Responses WebSocket | `GET /v1/responses` upgrades through `serveResponsesSocket`. Each `response.create` is served through the regular POST path; the socket holds recent input/output for continuation. [Entry][M4], [Socket implementation][M7] | **Present.** Do not report “no WebSocket.” This is a Responses text-event bridge, not evidence of Realtime audio. The older 426 error string is a fallback when the socket entry context is unavailable, not the normal feature verdict. |
| Native realtime audio/video WebSocket | No `/v1/realtime`, audio-buffer event handler, realtime session/call route, or equivalent native audio session was found in the registered gateway routes and inspected handlers. The Responses socket accepts text frames and primarily `response.create` / `response.interrupt`. [Routes][M3], [Socket dispatch][M8] | Use a dedicated realtime-provider adapter unless a separate implementation is verified. Absence here is “not found in inspected surfaces,” not proof that no Magpie plugin could add it. |
| WebRTC / SIP | No SDP negotiation, peer connection, realtime ephemeral-credential/session flow, or SIP session implementation was found in those surfaces. Native HTTP passthrough strips upgrade and `Sec-*` headers. [Native headers][M12] | Do not promise that changing a base URL makes a WebRTC voice model work. A provider-specific HTTP signaling request might be passed through, but that would not make Magpie a media-session engine. |
| TTS | `POST /v1/audio/speech` is registered. The speech body forwards provider-supported fields; `copyAnswer` flushes incoming audio or SSE rather than collecting the whole answer. Usage can be read from the final SSE event. [Speech][M9], [Retrieval dispatch][M11] | **Present**, with OpenAI-shaped upstream speech API requirements. Chunked audio output is useful for a composed ASR–LLM–TTS pipeline. Voice identity, timings, alignment, playback acknowledgments and interruption still need a product/provider contract. |
| ASR / audio translation | `POST /v1/audio/transcriptions` and `/v1/audio/translations` accept multipart forms. File data is retained while model/prompt may be rewritten. The handler uses the nonstreamed retrieval response path, which reads the response body before returning it. [Transcription][M10], [Retrieval dispatch][M11] | **Present as file/request transcription**, not demonstrated continuous microphone ASR or incremental transcript events. Even a vendor response whose content type is SSE does not become low-latency live ASR through this buffered path. |
| Image generation/editing | `/v1/images/generations` and `/v1/images/edits` are registered. The drawing handler selects a provider, can try group members, and returns an assembled JSON result with actual provider/model, image URLs/base64, revised prompt and usage. [Drawing handler][M14] | **Present.** Do not assume partial-image streaming from the standard image handler; its inspected successful return assembles JSON. Support for a vendor's advanced fields remains provider-specific. |
| Video jobs | `POST /v1/videos`, `GET /v1/videos/{id}`, and `GET /v1/videos/{id}/content` are registered. Implemented branches include a provider's OpenAI-shaped video API, another Magpie, Ark/Seedance, MiniMax H3 and Grok. IDs retain provider/vendor identity and, in relevant branches, the originating key/account. Polling and binary content download are separate. [Video implementation][M15] | **Present as asynchronous jobs**, not just a README claim or an MCP-only feature. Once accepted, poll the same job on its original provider/account; changing the chat model should not restart generation. |
| Video cancellation / deletion | No normalized `DELETE /v1/videos/{id}` or generic video-cancel route was found in the registration. The native route explicitly allows Ark task GET/DELETE, and general native HTTP allows DELETE. [Routes][M3], [Native routing][M13] | A vendor-specific cancel/delete path can be reachable. Whether DELETE cancels pending generation, deletes a completed asset, or does both must be established from that provider's contract. Closing the create/poll HTTP connection does not establish cancellation of an accepted remote job. |
| Media MCP | `generate_image`, `generate_video`, and `generation_result` are real tools. Images may become in-memory jobs; video results poll the video API. Pending work returns an ID instead of requiring another create call. [MCP tools/jobs][M16] | Useful external tool integration. Its temporary storage is not the product's durable artifact store. |
| Dedicated judgment/classification | `POST /v1/systemone` has a real handler, model/key restrictions and routing/failover. Provider definitions explicitly support decision APIs, including TypeSafe/Jev and other named backends. [System One handler][M19], [Decision provider][M20] | A decision model need not pretend to implement Chat Completions. A product-side classifier can use this explicit operation, avoiding a second hidden semantic classification pass. |
| Stream metadata / tool calling | The internal event representation carries text, reasoning, tool start/argument fragments, stop, usage, errors, images and sealed/signature data; usage also tracks served model, upstream provider when reported, request/response IDs and service tier. Chat and Responses codecs implement conversions. A separate route-event SSE feed exposes attempt/fallback/first-content/completion metadata. [Event representation][M21], [Codecs][M5], [Route events][M22] | Preserve structured event semantics and provenance. Do not flatten every event to text or treat reasoning as a pet's visible emotion. Conversion is not a guarantee that arbitrary vendor extensions survive unchanged. |

The [integration guide][M2] explicitly tells applications to add Magpie alongside their own providers. Its catalog distinguishes chat from image/video models; a model appearing in a catalog is not by itself a complete capability declaration for duplex, timing, structured output, cancellation or durable jobs.

## Three routing responsibilities, with an explicit owner

There are three distinct decisions even if they share configuration UI:

1. **Product semantic routing:** which work is needed, for which user/conversation/surface, with which memory view and output authority? Examples: interrupt current speech; answer a casual question; schedule deep analysis; choose a permitted pet gesture; generate a video; publish a completed result to the correct conversation. This belongs to the companion runtime.
2. **Model-role selection:** choose an eligible model or model pool for that work, respecting modality, tools, schema fidelity, context, privacy and a deadline. A deterministic policy or optional small decision model can do this. The product owns the policy, even if Magpie executes the classifier call.
3. **Gateway/provider routing:** resolve a concrete model, choose an account/key, apply compatible fallback/load distribution, translate wire formats, record usage and observe transport failures. Magpie is useful here.

Magpie already overlaps responsibility 2: it has real semantic intent/effort routing, not merely infrastructure fallback. Its [group definition][M17] includes rules, classifier, effort, affinity, weights, first-content timeout and patience. Its [provider routing][M18] and [strategy implementation][M23] include ordered, rotating, usage/quota, expiry, weighted, speed and price decisions. “Smart” primarily orders usable quota/accounts; it is not a claim that the gateway understands the companion's relationships or public/private memory policy.

The application should therefore choose one semantic owner per decision. If the companion selects `role=backend_reasoning` and a specific compatible pool, do not then have an unrelated gateway intent router reinterpret that task as small talk. Two serial routers add a round trip, make failures harder to explain, and can disagree. A legitimate alternative is to delegate one well-defined role-selection decision to Magpie's System One or group router, record its result, and keep downstream groups focused on eligible provider alternatives.

An intent rule preferring a model is also not a hard capability constraint: other group members can remain fallbacks. A realtime role must not fall back silently to a text-only model; a structured action role must not accept unvalidated prose; a private task must not fall back outside its allowed providers. Build eligible pools from explicit requirements before asking the gateway to order them. The [native endpoint intersection][M24] is helpful evidence of protocol compatibility, but it is not a substitute for those product requirements.

## What the current intent/Jev code establishes

At the pinned commit:

- [Rule evaluation][M25] decides at a new user turn and retains the decision through tool continuations. It can reconsider when the context has grown to 95% of a known limit and a rule selects a larger model. Rule preference and account affinity are separate concerns.
- [Classifier implementation][M26] sends up to 4,000 runes of the latest user text, plus up to approximately 1,000 runes each of the preceding user message and assistant text reply. It can include the previous intent/effort. This is bounded conversational context, not the complete memory, system prompt, tool results, or audiovisual state.
- Chat classifiers answer a numbered choice using a nonstreaming call; intent and effort can be requested concurrently as separate chat calls. Results are cached for ten minutes; failed classifiers can rest for thirty seconds. Nested groups share one classifier wait budget. These are implementation settings, not observed latency numbers.
- On a classifier failure, the rule code may retain the previous intent when it remains eligible. Therefore, the application must not use this router as an authorization gate or infer that a failure always means the group's default model.
- [Decision requests][M27] use structured `state` and typed `questions` for intent and effort. The [public System One handler][M19] routes such requests independently. A decision-only model is distinguished from conversation models in the [provider code][M20].

The user supplied the illustrative spelling `jev` without a provider/version. The primary sources now identify **a plausible referent**, TypeSafe's Jev/System One integration; the code names `jev-latest`. That does not establish that this is the exact product/version the user intended, that it is available on their account, or that its latency, accuracy, emotional judgment, Chinese-language behavior or modality support meets this product's needs. The report does not assign it an unsupported parameter size or benchmark.

The coordinator also located Pi's pinned [virtual-model documentation][P1], which explicitly names `ctx.modelRegistry.classify()` and a Jev router example. Its continuation advice keeps previous model/thinking settings to preserve caches/signatures. This corroborates the distinction between model choice and the conversation loop; it is not a recommendation to insert both Pi and Magpie classification in series.

## Model roles that preserve one personality

One personality is a product contract and a shared, access-controlled history. It does not require one physical model, nor does sharing a model guarantee one personality.

| Role | Proposed input/output responsibility | Appropriate routing boundary |
| --- | --- | --- |
| Primary realtime interaction | Maintain a responsive conversation, acknowledge the user, request work, speak within the active output scope; ingest audio/vision only when the provider explicitly supports it | A session-oriented realtime adapter for native speech; alternatively a composed ASR–LLM–TTS pipeline. Keep the active voice/session stable during an utterance. |
| Fast judgment/classification | Choose from a small bounded set: continue/interrupt, foreground/backend work, allowed skill/model class, effort; return a structured decision | Deterministic fast path first; optional decision model on ambiguous work. Magpie System One or a verified chat classifier can supply the inference. |
| Pet expression/action decisions | Produce a constrained expression/gesture suggestion with target, duration, intensity and utterance association | Local rules for immediate feedback; optional classifier/model for richer choices. The renderer applies an allowlist and expires stale suggestions. This role does not speak independently or execute arbitrary desktop actions. |
| Backend reasoning | Analyze, plan, retrieve and run authorized tools, then return an answer/artifact/proposal with provenance | Ordinary streamed inference through Magpie or a direct provider. Work belongs to a cancellable/resumable product job and is independent of the foreground speaker. |
| Image/video generation | Submit generation, track the accepted job, collect output and report status | Media adapter exposing job identity and artifacts. Magpie's APIs/MCP are candidates; direct vendor operations remain available where semantics or features differ. |

The primary interaction agent owns what is said to the user; worker models return results to it. Workers should receive a bounded context snapshot containing the relevant persona version, conversation facts, task intent and allowed memory view. They should not independently mutate a universal transcript or invent relationship facts. Durable memory should record accepted observations, commitments and outcomes with provenance, not speculative drafts or private model reasoning.

Cross-platform shared memory does not mean sharing every raw message with every surface. A Bilibili/public interaction and a private desktop conversation need explicit visibility and attention policy. That product decision remains open and should not be hidden in a gateway fallback list.

## When a tiny router saves time, and when it adds time

A smaller model is not automatically a faster critical path. Network establishment, queueing, prompt processing, output format, cache loss and provider load can dominate model size. A local router may avoid a network trip but contend with local ASR, rendering or a realtime model. No performance was measured in this research.

For a serial router, let `R` be the router's end-to-end duration, `D` the downstream route it chooses, and `B` the baseline route without the router. For the same output/quality target:

`time_with_router = R + time(D)`

Routing reduces end-to-end delay only when the avoided downstream work exceeds `R` plus any misclassification recovery and cache/setup penalties. If a fraction `p` of requests can take a faster route, a simplified average condition is:

`p × (time(strong_route) − time(fast_route)) > R + expected_recovery_and_switch_cost`

These are decision models, not benchmark estimates. First-audible-response, first-useful-token and total task completion are separate metrics. A router can reduce cost while increasing time to the first useful response. It can improve median time while making timeout-tail behavior worse.

A practical policy starts with the cheapest reliable decisions:

- An explicit stop/cancel, microphone start/end, output lease loss, known tool continuation, selected image/video command, or button action should not wait for an LLM classifier.
- Use already-known session/turn state, message modality, task type and resource requirements to remove impossible routes. A platform event or a user's explicit media-generation request often already supplies the routing label.
- Ask a small model only when its answer can change the execution plan enough to matter. Keep the choices distinct, output bounded, and apply a deadline derived from the role. The Magpie guide's default classifier timeout is a transport ceiling, not an acceptable realtime response target.
- If the primary interaction model is already generating a response and can request a backend job naturally, an additional synchronous classifier may be redundant. Conversely, a cheap router can be valuable for a large volume of clearly separable background requests.
- Avoid classifying every audio packet, frame, animation tick, or tool continuation. Emotion/action updates can be event-driven and rate-limited by product timing, not token cadence.

Speculation can overlap a classifier with reversible preparation: retrieve a bounded local memory view, prepare a prompt, warm an authorized connection, or draft a response. The best-case wait becomes closer to the maximum of independent work durations instead of their sum. But speculative network inference spends resources even if discarded. It must not cause two spoken replies, duplicate tool execution, duplicate media creation, public posting or memory commits. A result only becomes externally visible after the owning turn accepts it.

One observed cancellation nuance deserves a specific experiment: the chat classifier in [the inspected implementation][M26] constructs its own timeout from `context.Background()`, and in-flight identical classifications are shared. Thus cancellation of the parent request should not be assumed to immediately cancel all router work. This is another reason to keep stop/barge-in out of the classifier path.

## Full duplex and one speaker ownership

Keep three meanings separate:

1. **Concurrent system operation:** the assistant can receive another message while a backend job runs.
2. **Composed voice interaction:** ASR, text generation and TTS stream in stages and playback can be interrupted.
3. **Native model-level duplex:** a provider session receives and emits audio, and possibly vision, under its own turn-detection and interruption protocol.

Magpie supports components useful for the first two; the inspected surfaces do not establish the third. A Responses WebSocket does not change that. As an external primary example, [Azure's realtime guide][R1] documents distinct WebRTC/WebSocket/SIP audio-session transports, audio buffers, VAD and audio/transcript events. Its marketing/timing examples are not adopted as performance evidence here.

The product needs one **output owner for each utterance and output scope**. This need not impose a global mutex on all unrelated private/public conversations; the scope and attention policy require a product decision. Within an output scope, a foreground interaction agent, a deep-reasoning worker, a TTS completion and a pet-action model must not each independently decide to speak.

A useful runtime envelope includes conversation/surface identity, turn or utterance ID, generation epoch, actual model/provider identity, event sequence, and task/job IDs. The output controller accepts only events belonging to the current owner and epoch. On barge-in it can stop local playback immediately, revoke the old epoch, request provider cancellation, and reject late audio/text/actions. The system records which text/audio was actually delivered or heard; “generated” is not “heard.” Provider-specific truncation of unplayed audio/history may be required. Generic HTTP abort does not supply that state repair.

A pet expression model can suggest an emotion, but lip movement and exact gesture timing should follow the playback timeline or provider alignment data, not the arrival of prose from a reasoning stream. Slow expression suggestions should expire, not animate after the conversation has moved on.

## Cancellation, jobs and generated artifacts

The inspected source supports several different lifetimes, which must not be collapsed into one `cancel()` promise:

| Operation | What source establishes | What the product must still establish |
| --- | --- | --- |
| Ordinary HTTP inference | Upstream requests use contexts; the main attempt loop detects a departed caller and stops selecting further providers. [Forwarding/caller cancellation][M28] | Whether the vendor stops computation/billing immediately, and how already-emitted text/tools are handled. |
| Responses socket | Disconnect ends the in-flight context. A matching `response.interrupt` stops a turn and emits interrupt acceptance plus an incomplete response. [Socket dispatch][M8] | This is not the native Realtime `response.cancel`/audio-history contract. Test the exact client dialect; closing a socket is a stronger action than interrupting a turn. |
| Standard TTS/image HTTP | TTS uses request-derived context and streaming body close; image generation uses a request-derived drawing timeout. [Retrieval][M11], [Drawing][M14] | Local buffered audio must still be discarded; remote compute cancellation remains provider-dependent. |
| Image MCP job | Generation deliberately uses `context.WithoutCancel` and its own time limit. Jobs/files are held in memory; image URLs expire, and restart loses that store. [MCP jobs][M16] | Ending the tool call does not cancel generation. No generation-cancel tool was found in the inspected tool list. Persist required outputs in a product-owned artifact store. |
| Accepted video job | Create, status poll and content download are separate requests; stopping a poll leaves the remote job running. [Video][M15], [MCP polling][M16] | Model/vendor-specific cancel versus delete, status reconciliation after network loss, retention and eventual download. |

A product job should minimally distinguish submitted/accepted/running/completed/failed from cancellation requested, cancellation confirmed, and acceptance unknown. It should retain the logical job ID, provider handle, originating account binding, request identity, originating conversation, visibility scope and actual model. Do not silently move an accepted remote job to another provider: that creates another job. A failed create request whose acceptance is unknown also must not automatically be interpreted as safe to retry; use a vendor idempotency/status facility where one exists, or represent the uncertainty explicitly.

A generated image/video is an **artifact**, not a normal assistant text message and not merely an expiring URL. Once collected, retain a stable artifact ID, MIME type, size/hash, relevant duration/dimensions, provenance, origin task/conversation, creation state, visibility and storage/retention policy. Link an announcement in the conversation to that artifact. Keep provider download handles/credentials out of public messages. Magpie's MCP image links can be opened by whoever holds the temporary URL; its video download path may require authorization. Those are transport/access details to resolve before cross-platform publication.

Long generation and deep reasoning should report progress through product job events and return a concise result to the foreground owner. Cancelling one foreground utterance need not cancel an explicitly requested long-running task; the user-facing meaning of “stop talking” versus “cancel the task” should be separate.

## Switching models and provider-private state

Portable state should be the companion's persona configuration, allowed memory, user/assistant messages, tool invocations and results, artifacts, task state and delivery acknowledgments. Provider response IDs, encrypted reasoning, thought signatures, prompt/KV caches, voice sessions and audio buffers are not interchangeable portable memory.

Magpie itself demonstrates this distinction:

- [Previous-response handling][M29] reconstructs input/output for compatible continuation, retains it in a bounded in-memory store, and binds vendor-owned continuation IDs to the provider/key that created them. This is useful protocol state, not a durable shared memory service.
- [Responses sockets][M7] retain a small recent window for the life of the connection, and ask clients to resend full context when the referenced response is unavailable.
- [Reasoning carry][M30] preserves opaque reasoning through tool-call IDs in some conversions, but explicitly handles one provider rejecting another provider's sealed content by retrying without the rejected material. Successful replay of public text/tool facts is not transfer of hidden internal reasoning.
- [Group native-endpoint intersection][M24] acknowledges that some routes are translated and others can pass through. A normalized API does not erase the distinction.

Prefer a safe transition at a new turn, a completed tool boundary, or a controlled session restart. Finish/cancel outstanding tool calls and account for partial audio before changing the foreground model. Rehydrate the new session from accepted public state and authorized memory, then expect a cold start and possible behavioral differences. Mid-turn failover can be necessary, but it is a recovery operation that must preserve tool-result identity and suppress duplicate side effects, not a promise of seamless personality or acoustic continuity.

For native realtime, a provider/model/voice change may require a new session; replayable text is not a replacement for acoustic context. Check the concrete provider's session-update and resumption rules instead of assuming all properties can be hot-swapped.

## Fit with the project's current provider integration

The local plugin already provides a useful boundary: [its registration](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/index.ts#L31) receives a request through a task, obtains a secret under an abort signal, calls the adapter and maps cancellation/errors. It also carries origin metadata with instance/module/model/compatibility domain.

There are nevertheless concrete gaps before “choose Magpie” can mean a complete companion backend:

- [Endpoint contracts](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/packages/contracts/src/model-services.ts#L1) enumerate fixed service endpoints and five protocols (`chat`, `responses`, `anthropic`, `gemini`, `browser`). This is not currently an arbitrary gateway URL plus capability registry. The controlled network-target boundary should be preserved when adding a user-configured gateway.
- [The common adapter](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/responses.mjs#L44) imports Cortico provider internals, awaits `client.respond`, and serializes the complete result. The browser path gives `onEvent` an empty callback. This inspected common path does not expose a general realtime media/event stream to its caller. A separate older [DeepSeek path](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/index.ts#L178) streams text into media output; that does not establish the missing general protocol.
- [Origin compatibility handling](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/responses.mjs#L76) and [Gemini tool-signature conversion](/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/llm-provider/src/native-protocols.mjs#L161) already recognize that private replay data needs care. A gateway alias that changes actual provider/account/model must not be treated as a constant private-state compatibility domain merely because its base URL and group ID remain constant. Record resolved provenance or deliberately keep such opaque state inside the verified adapter/gateway boundary.

The coordinator's separate DSH inspection reports a current text/reasoning/tool-oriented LLM stream and text/image input modalities, without a realtime audio/video contract. That is an integration limitation to reconcile in the main design, not a finding independently established by this report's local plugin inspection. Neither host obtains a duplex contract merely by pointing existing LLM calls at Magpie.

Keep the future interface small and capability-specific: streamed inference, realtime sessions, decision inference, transcription/speech where needed, and generated-media jobs. These can be operations supplied by existing plugins; they do not require a new plugin kernel or a second agent framework. Persona/memory and interaction/output ownership remain above them. Magpie may implement several operations behind one configured adapter without becoming mandatory for all of them.

Direct provider adapters are justified where a required native realtime session is unavailable through Magpie, where provider-specific alignment/voice/vision features cannot survive normalization, where a job needs cancellation/idempotency/resumption semantics not exposed by the generic route, or where retaining an existing provider route improves compatibility. The native HTTP escape hatch can cover some vendor operations, with its API-key and gateway-key restrictions; it does not remove vendor semantics or implement a full media session.

## Smallest useful validation experiments

These are proposed follow-up experiments, not work executed in this research. Start with offline fixtures; any installation, service execution or paid inference belongs to a separately authorized validation phase.

1. **One protocol-conformance slice.** With one representative Chat/Responses backend and one translation path, replay fixtures for text + two tool calls, fragmented JSON arguments, reasoning, usage, error and truncated stream. Verify ordering, terminal status, actual model/request identity and cancellation. Acceptance: no false success, no duplicate executable tool result, no lost cancellation signal. This tests the adapter boundary before choosing a host.
2. **One interrupt trace.** Simulate speech playback while backend tokens and expression decisions arrive; interrupt, then deliver late chunks. Acceptance: local playback stops at the chosen product target, no revoked epoch speaks/animates, and the conversation records only what was delivered. Separately probe the exact native provider's audio truncation/cancellation contract when authorized. Do not substitute a Responses WebSocket test for this.
3. **One routing comparison.** Use a small representative corpus including Chinese follow-ups, greetings, long reasoning, explicit image/video requests, ambiguous commands and stop/continue. Compare deterministic-only, one decision model, and an already-running primary model choosing work. Record routing errors, p50/p95 first-useful-response and completion time, timeout behavior, extra calls/cost and cache effects. The go/no-go criterion is a benefit on the product's workload, not model size or a vendor demonstration. Ensure only one semantic classifier is active per decision.
4. **One media lifecycle.** Use recorded create/pending/completed/failed/cancelled responses and a create-timeout-after-acceptance case. Restart the adapter, change the chat model, and expire the original asset URL. Acceptance: the same accepted job is tracked, generation is not duplicated, cancellation is not confused with deletion, and the final artifact remains available from product storage. Include Magpie MCP's detached-image-job behavior explicitly.
5. **One model-switch boundary.** Replay a completed tool call and result through a new provider; include a provider-private signature and a stale `previous_response_id`. Acceptance: portable facts survive, incompatible opaque state is isolated, recovery is explicit, and no tool runs twice. Then run one authorized small provider experiment if the fixtures cannot resolve a real compatibility question.

The first three decisions needed from the main design are the initial interaction slice, an explicit target for interruption/first useful response, and the cross-surface attention/privacy policy. Choosing DSH versus Electron affects packaging and existing services; it does not resolve these semantic contracts.

## Unsupported assumptions to avoid

- Magpie is chat-only, lacks ASR/TTS, has no WebSocket, or has no video jobs: **contradicted by the inspected source**.
- Responses WebSocket equals native realtime voice/WebRTC: **not established**.
- The generic gateway exposes every operation of every provider: **not established**; native passthrough has explicit restrictions.
- A group's preferred model guarantees every fallback has equivalent modality, privacy, tool or structured-output behavior: **not established**.
- `jev` is a confirmed exact model/version, or any tiny router is automatically fast enough: **not established**.
- HTTP abort, socket interruption, stopping an MCP wait, cancelling remote generation and deleting an artifact are the same operation: **contradicted by the inspected lifetimes**.
- A shared model or gateway cache is the companion's shared memory/personality: **an architectural category error**.
- Changing providers preserves hidden reasoning, prompt cache, voice identity or live audio state: **not established**, with explicit counterexamples in state/reasoning compatibility code.

## Primary source index

All Magpie code links below are pinned to the inspected commit. Line anchors identify the relevant inspected surfaces; adjacent code was read where necessary.

[M1]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/README.md#L98
[M2]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/docs/integrating.md#L14
[M3]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/gateway.go#L1012
[M4]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/gateway.go#L1074
[M5]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/chat.go#L1603
[M6]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/responses.go#L1873
[M7]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/responses_ws.go#L23
[M8]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/responses_ws.go#L238
[M9]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/speech.go#L14
[M10]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/transcribe.go#L18
[M11]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/embeddings.go#L266
[M12]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/native.go#L291
[M13]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/native.go#L3
[M14]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/draw.go#L740
[M15]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/video.go#L1213
[M16]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/image_mcp.go#L69
[M17]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/provider/group.go#L168
[M18]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/provider/routing.go#L24
[M19]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/decide.go#L565
[M20]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/provider/decide.go#L3
[M21]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/ir.go#L395
[M22]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/route_events.go#L17
[M23]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/routes/strategies.go#L114
[M24]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/provider/native_endpoints.go#L46
[M25]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/rules.go#L263
[M26]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/classify.go#L264
[M27]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/decide.go#L124
[M28]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/gateway.go#L3991
[M29]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/prev_response.go#L21
[M30]: https://github.com/yetone/magpie/blob/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/reasoning_carry.go#L161
[P1]: https://github.com/badlogic/pi-mono/blob/7fd1ee05012259ab43882645117e2c9b40be75cd/packages/coding-agent/docs/virtual-models.md#L65
[D1]: https://usemagpie.ai/docs/intent
[D2]: https://usemagpie.ai/docs/integrate
[R1]: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets

# Unified companion runtime architecture discovery

Status: **Planning / research and discussion only**. Created 2026-11-06 (Asia/Hong_Kong). No product-code implementation is authorized by this task yet.

## Goal

Develop one persistent assistant identity that can interact through a desktop pet, DSH, QQ, Bilibili and future platform plugins, with coherent personality, shared memory and context, and responsive full-duplex interaction. First establish the product boundary, inspect current and upstream implementations, and discuss a technically credible migration path with the user.

## Confirmed user requirements

- R1: One recognizable personality and continuing user relationship across platforms; one main interaction agent coordinates communication.
- R2: Shared context and memory across surfaces. Exact public/private visibility and concurrency behavior still need product decisions.
- R3: Highly responsive full-duplex interaction with expressive emotion and a sense of ongoing presence.
- R4: Broad modularity, including replaceable agent architecture, memory, persona, model, voice, tools and platform integrations. Cortico is the current framework; adopting another architecture should require bounded adapter/plugin work.
- R5: Desktop pet plus agent is the proposed starting point; QQ, DSH and Bilibili are named future surfaces. The initial deliverable and platform order remain open. Independent, cloud-capable service deployment is now selected in R14.
- R6: Research first and discuss deeply before implementation. Maintain requirements, evidence, decisions, plans and handoffs in Trellis.
- R7: GPT leads backend and architecture; DeepSeek leads frontend and design. Use capable model-routed collaborators and applicable Magpie skills/tools; do not reduce necessary research or design work merely to save tokens.
- R8 (user addition, 2026-11-06): Compose different models for different scenarios: main interaction, fast classification/routing, desktop expression/action decisions, deep reasoning and image/video generation. The user's `jev` example is illustrative; research located Pi's official `typesafe/jev-latest` classifier router example, but the user's exact intended model/version and its fitness for pet-action decisions remain unconfirmed. Investigate Magpie (`https://github.com/yetone/magpie`) as a unified model gateway, including actual protocol, modality, streaming, cancellation and asynchronous job support. Gateway selection and routing policy remain proposals.
- R9 (user clarification, 2026-11-06): Existing documents may be updated and must not constrain new needs when outdated. Reconsider DSH hosting against an independent runtime, separating ownership from visible entry points. This comparison is now resolved by R11; its source research remains useful for optional DSH integration.
- R10 (user clarification, 2026-11-06, follow-up): Cross-session capability is a core requirement. The long-lived companion, memories and ongoing work must not be identified with a single chat Session. Execution logs and framework-specific contexts may remain internal; autonomous behavior and forgetting semantics are separate decisions.
- R11 (user decision, 2026-11-07): Independently maintain the product engine/runtime to support modular integration of multiple Agent Harnesses. DSH is an optional adapter/integration, not the required host. Preserve useful existing kernel mechanisms rather than reimplementing every framework. The accepted ownership decision is [ADR-0015](../../../docs/adr/0015-independent-continuous-agent-runtime.md).
- R12 (user decision, 2026-11-07): Users face one continuously existing Agent while multiple internal Workers can operate concurrently. The system chooses, creates and manages execution Sessions; users must not manually manage Sessions or know where a task executes. Routine interaction is about intent, ongoing work and results. This does not require hiding useful task status or optional developer diagnostics.
- R13 (user decision, 2026-11-07): Keep the kernel minimal. Task boards, voice input/output, Live2D/avatar/outfit functionality and other features must be independently removable, replaceable and extensible through the plugin system. Concrete memory/context/routing implementations and Harnesses also remain modular; stable ownership and integration rules must not be confused with hardcoding their implementations. See [ADR-0016](../../../docs/adr/0016-cloud-service-and-pluggable-features.md).
- R14 (user decision, 2026-11-07): Support independent service deployment in the cloud, with local clients and/or platform plugins providing interaction. Core operation must not depend on an Electron window or the owner's local PC. Cloud-eligible work can continue while a local client is off; operations requiring an unavailable device cannot be claimed as executed. This does not select a cloud vendor, public multi-tenant SaaS or offline dual-primary operation.
- R15 (user acceptance, 2026-11-07): The discussed continuity criterion is accepted: at supported Harness/Session replacement boundaries, preserve character identity, logical work, authorized facts and committed effects without duplicating actions. Acceptance of this criterion is not a claim that a test passed or approval to implement the whole roadmap.
- R16 (user emphasis and execution requirement, 2026-11-07): Event-driven asynchronous execution should decouple foreground conversation from long tools. Starting long work returns a prompt, trackable acceptance/start receipt; completion is delivered as a new event, and a permitted stop operation can cancel long work. New input can be handled at the next supported inference-step boundary. In this product, results address the continuing Agent and logical task; internal Session routing belongs to the system. Short bounded tools may still return directly. Concrete API names and native audio-duplex behavior are separate contracts.
- R17 (user architecture question, 2026-11-07): Evaluate separating cloud computation, persistent database/state and local execution through a lightweight daemon. This is a candidate decomposition under R14, not a selection of a database/container platform or a promise that all work survives loss of the local environment. Product state must outlive compute instances; local credential/device/effect metadata may still be necessary. Multi-device and online-environment routing need explicit availability semantics.
- R18 (user decision, 2026-11-07): Include a basic cloud execution environment in the first usable version, rather than limiting the cloud to coordination and inference. Cloud Workers may use configured tools and available/authorized materials to process files, run code and produce artifacts while the local PC is off. The local daemon supplies complementary native/private-device capabilities. This does not authorize automatic private-file synchronization or any live cloud deployment.
- R19 (user decision, 2026-11-07): Build the first foundation around text interaction and the core architecture; develop voice input later as a plugin. The first scoped deliverable is planned in [the text-foundation child task](../archive/2026-11/11-07-text-agent-foundation/prd.md). Native voice input, real audio-duplex acceptance and speech UI are not prerequisites for this foundation; future streaming/cancellation/media seams must not be blocked by the text implementation.

- R20 (user authorization, 2026-11-08): After previewing the foundation, restore the host service and continue in order: useful model-backed text, shared desktop/web entry, controllable persona/memory, then voice and individual platforms. Keep Trellis records for every stage. The current implementation child is [model-backed text](../11-08-companion-model-text-loop/prd.md); this does not authorize arbitrary external-account access or publication.
- R21 (user decision, 2026-11-08): Default model configuration/connection is supplied by a builtin Magpie connection plugin. Users may implement another connection plugin to replace Magpie. This selection does not move Agent identity/memory/Harness ownership into the gateway or authorize automatic reuse of DSH credentials.

## Existing evidence and constraints

- Repository baseline: `500aeba`, initially clean working tree. Actual stack is Electron/React/TypeScript, pnpm workspace, project-owned plugin kernel and Cortico 0.2.7.
- The current implementation is an Electron application with Cortico-owned agent/session/event flow. ADR-0002 and ADR-0014 remain historical/current-code evidence; [ADR-0015](../../../docs/adr/0015-independent-continuous-agent-runtime.md) now governs the target ownership and Session-free user model. Existing data remains under its current single writer until an approved migration.
- Existing project conventions require one plugin model and clear authority at host / preload / renderer boundaries. See `.trellis/spec/shared/project-baseline.md` and `.trellis/spec/shared/plugin-application-contracts.md`.
- Existing tasks remain independent: `00-bootstrap-guidelines` and `11-01-minimal-settings-migration`. This discovery does not approve or complete their work.
- Environment has Python 3 and project Trellis scripts; no `python` alias or global `trellis` executable. Use native session subagents and task-local research artifacts; do not claim a Trellis channel or conversation-memory query ran.

## This discovery scope

- Inspect current implementation and prior recorded decisions.
- Research Higgs Realtime Duplex, DSH Superagent, AstrBot, Coopanion, Cortico and relevant DSH / Pi extension contracts using primary sources.
- Distinguish system-level asynchronous interaction, streaming speech with interruption, and native model-level audiovisual duplex.
- Compare viable product entry points and replaceable framework boundaries; identify what is already possible, what is coupled and what needs validation.
- Preserve recommendations as proposals until the user confirms the relevant product decisions.

## Acceptance criteria for this discussion round

- [x] A1: Current architecture findings have concrete source anchors, including existing strengths and framework coupling.
- [x] A2: Reference findings cite primary URLs and distinguish documented implementation from product claims or future directions.
- [x] A3: GPT architecture and DeepSeek interaction/design findings are reconciled, including disagreements and limitations; corrections and the host-choice trade-off are recorded in the research handoff.
- [x] A4: Recommendations address product entry, Cortico migration/replacement, duplex interaction, extensibility and Magpie/multi-model role selection.
- [x] A5: Trellis contains research, requirements, design and staged planning; accepted product/architecture decisions are distinguished from unapproved implementation detail.
- [x] A6: The initial handoff presented the host dependency trade-off. The user resolved it on 2026-11-07 through R11/R12; it is no longer an open decision.

Research-round criteria are complete; this does **not** close planning or approve implementation. Continue with the open product decisions below.

## Out of scope for this round

Product-code edits, dependency upgrades, starting/replacing application servers, installing plugins, platform-account login, live posting/messaging, paid inference experiments and declaring measured realtime performance.

## Product acceptance anchors for the selected direction

These are requirements for later implementation validation, not passed tests or a complete first-release scope. The user explicitly accepted the continuity principle in P3; the other anchors map the confirmed product direction and proposed technical verification:

- P1 (R1/R10/R12): The user starts work, changes topic and returns through another authorized surface without creating/selecting a Session or encountering a new character identity.
- P2 (R4/R11/R12): At least two internal Workers can advance independent work while the main interaction remains responsive; outputs retain the correct logical task and audience.
- P3 (R10/R12): Rebuilding an execution Session or changing a compatible adapter at a supported boundary does not change the logical task identity, lose accepted facts or repeat an already committed action.
- P4 (R12): Users can inspect progress, identify what is waiting, stop the intended task and retrieve results in task language. No routine control requires a Worker/Session ID, context-window management or locating a hidden execution conversation.
- P5 (R4/R11): Demonstrate a second real Harness before declaring broad Harness compatibility. A fixture can prove contract behavior first but is not that interoperability proof.
- P6 (R13): The core service starts and remains manageable without a desktop/Live2D, task-board or speech plugin. Removing a view preserves work/data; disabling a voice/avatar provider releases its owned resources without cancelling unrelated work. Missing essential providers produce an honest unavailable state, not a new identity or hidden replacement.
- P7 (R14): A separately running service and authenticated client exchange work through the client protocol. Disconnecting/removing the client does not terminate cloud-eligible work. Device-bound work reflects the actual device's availability. Reconnection restores the same identity/task facts without replaying old audio or committed device effects.
- P8 (R16): A long operation returns a trackable receipt before completion; the foreground processes a new input at its next supported step; completion arrives once as an attributed event for the right Agent/task. Stop reports the real outcome across admission/running/completion races. Short bounded tools retain a direct-result path.
- P9 (R17, proposed deployment proof): Before claiming replaceable/stateless compute, restart a compute instance while retaining its state provider and verify restored identity/task/delivery records. For in-flight work, report supported resume or an honest failed/unknown outcome without blindly repeating effects. This does not claim arbitrary process resumption.
- P10 (R18): A bounded file-processing or code task runs in the configured cloud execution environment, completes while the local client is disconnected and retains a retrievable artifact under the same logical task. A task that actually requires an offline local device must not be reported as successfully executed there.

## Open product decisions

1. Later-slice platform/voice priority: R19 closes the first-slice choice as text-first foundation, scoped in the child task. Which real external platform and voice capability follows remains open; QQ official/OneBot and Bilibili live chat/private messages/comments are distinct adapter scopes.
2. Unavailable execution environments: when a task requires an offline device, should it wait, ask for another environment, or fail? Automatic workload/data migration and an autonomous offline client are not selected. Detailed service-restart and in-flight recovery guarantees also remain to be scoped.
3. Public/private memory visibility and how simultaneous platform conversations share attention and ongoing tasks.
4. Desired autonomy and interruption behavior; continuing an assigned goal is distinct from initiating new work without a new user message. Async start/result events do not settle proactive notification policy.
5. Voice/model deployment constraints, target latency and supported fallback capabilities; do not depend on waitlisted Higgs Duplex access.
6. Extensibility details: minimum supported checkpoint/migration behavior per Harness, state-provider replacement and any beyond-safe-boundary hot switching. The continuity acceptance principle itself is approved.

Independent ownership, cloud-capable service deployment and feature modularity are closed decisions under ADR-0015/0016. These remaining items are discussion decisions, not defaults or an implementation approval request.

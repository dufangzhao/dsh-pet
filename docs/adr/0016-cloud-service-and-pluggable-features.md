---
status: accepted
date: 2026-11-07
source: User selected cloud-deployable independent core service, local/plugin-based interaction, and independently replaceable feature modules including task boards, voice input/output and Live2D outfits; accepted the discussed continuity criterion.
---

# Deploy an independent service with a minimal kernel and pluggable features

The independent runtime selected in [ADR-0015](0015-independent-continuous-agent-runtime.md) must support service deployment without a desktop window, display server or local microphone/speaker. Users may host the service in the cloud and interact through local clients or platform plugins. A local service deployment remains possible; cloud capability does not imply a managed multi-tenant SaaS product or authorization to deploy infrastructure now.

The user additionally selected a **basic cloud execution environment in the first usable version**. Cloud Workers can use its configured tools and available/authorized materials for file processing, code execution and generated artifacts while the local PC is off. The local daemon complements this environment with native/private-device capabilities. This does not imply automatic upload of local files or execution of local-only programs in the cloud.

Task boards, conversation surfaces, speech input/output, ASR/TTS, Live2D/avatar/outfit systems, platform connectors, model gateways and Agent Harness adapters are independently managed extensions. Persona/context/memory implementations and scheduling/attention policies also remain replaceable. A usable default distribution composes plugins; default installation does not make a feature part of an irremovable kernel.

The kernel stabilizes ownership, identity/task correlation, lifecycle, versioned capability access, authorization, tracked execution/cancellation and state-commit/transport boundaries. It need not hardcode a memory database, retrieval algorithm, planner, dashboard, voice pipeline or avatar renderer. Product-owned durable facts remain authoritative through declared storage/state providers; replacing an implementation must preserve or explicitly migrate those facts. Missing an essential provider is an unavailable capability to diagnose, not permission to fabricate continuity.

## Consequences

- Extend the [one-plugin-model decision](0010-unified-plugin-model.md) across service-side, client-side and coordinated extension parts. Placement describes where code executes, not a second plugin hierarchy. Exact manifest fields and transport are still design work.
- The service owns the canonical product state; clients provide interaction and granted device capabilities. Removing a board removes a view, not the tasks. Stopping an avatar or speech plugin releases its own resources without implicitly destroying the Agent or unrelated work.
- Cloud-compatible work can continue when a desktop client disconnects. Work requiring that client's device becomes unavailable/waiting or fails according to its declared behavior. A disconnected client must not silently become a second writer of global identity, memory and task state.
- Pairing/authentication, scoped capabilities and real execution/playback receipts are part of the client-service boundary. Local device controls must still be able to stop locally; a remote cancellation request is not proof that a disconnected device received it. Reconnection restores the same identity/work and reconciles receipts without replaying already committed effects.
- Pluggable does not mean lossless hot replacement at any moment. Presentation withdrawal, execution cancellation/drain and state-provider migration have different lifecycles. The user-approved continuity criterion applies at supported boundaries: preserve character identity, logical tasks, authorized facts and committed effects without duplicate actions.
- Control/state events and continuous media/assets require appropriate separate handling. The user's subsequent asynchronous ReAct example makes long-work admission and result events part of the design: return a trackable receipt promptly, process new foreground input at a supported step boundary, and deliver completion to the continuing Agent/logical task. Short bounded tools may return directly; exact API names and cancellation details remain design work.
- Separating replaceable cloud compute, persistent state and local/cloud execution environments is the candidate decomposition. A thin local daemon has no second product-state authority, but may retain necessary device/credential/effect metadata. This does not select a database, container orchestrator or automatic migration of private local workloads.
- The user selected **text interaction for the first foundation**, with voice input developed later as a plugin. Its scope and validation are owned by [the text-foundation task](../../.trellis/tasks/archive/2026-11/11-07-text-agent-foundation/prd.md); future media capability must not require redesigning basic event/cancellation ownership.
- Specific wire protocols, cloud platform, database, client shell and later autonomous/multimodal behavior remain implementation or subsequent planning decisions.

This extends the accepted direction without claiming the current Electron/Cortico implementation already supports it. The [PRD](../../.trellis/tasks/11-06-unified-companion-architecture/prd.md), [design](../../.trellis/tasks/11-06-unified-companion-architecture/design.md) and [execution plan](../../.trellis/tasks/11-06-unified-companion-architecture/implement.md) own detailed requirements and proposed validation. No product implementation or live deployment is authorized by this record alone.

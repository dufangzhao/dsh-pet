# Text-first continuous Agent foundation

Status: **Implementation in progress.** The user explicitly approved this scope and said “开始实现” on 2026-11-07. This document scopes the first delivery, not the complete future product. Actual verification and remaining work are tracked in [progress](progress.md).

## Goal

Prove that one continuing Agent can serve a replaceable text client while supervised work runs in an independent service environment. Users can assign work, continue talking, stop the intended task and retrieve results after reconnecting, without managing Sessions. Establish reusable plugin, execution and durable-state boundaries before adding voice input.

## Basis and evidence

- The parent [requirements](../11-06-unified-companion-architecture/prd.md), especially R11–R19, own the long-term vision. [ADR-0015](../../../docs/adr/0015-independent-continuous-agent-runtime.md) selects independent ownership and internal Sessions; [ADR-0016](../../../docs/adr/0016-cloud-service-and-pluggable-features.md) selects service deployment, feature plugins and first-version cloud execution.
- Existing strengths and coupling are source-backed in [the runtime report](../11-06-unified-companion-architecture/research/current-runtime.md). Reuse the plugin/kernel/task/configuration mechanisms; do not infer that the current Electron composition already runs headlessly.
- The actual stack and authority conventions are in [the project baseline](../../spec/shared/project-baseline.md). Existing generic database templates do not establish a current database implementation.

## First-delivery requirements

| ID | Required outcome | Parent mapping |
| --- | --- | --- |
| F1 | A service runs independently of Electron, a visible window and media devices. Its operator can configure it and an authenticated text client can connect to the same Agent. The first delivery demonstrates one operator-owned Agent and authorized clients; it does not introduce a public multi-tenant product. | R11/R12/R14/R19 |
| F2 | Capabilities, lifecycle, resource ownership, cancellation and versioned state boundaries are explicit. The reference text entry, execution backend and Harness integration use these boundaries; removing a view does not remove the Agent or task data. | R4/R13 |
| F3 | The Agent maintains a stable identity/profile and a bounded set of explicitly supplied facts/preferences across connections and supported restarts. Working context is assembled for the current execution rather than exposing Session management to users. | R1/R2/R10/R12 |
| F4 | Long work is registered independently and returns a trackable receipt before completion. The foreground accepts further input at its supported step boundary while background work progresses. Short bounded tools may return directly. | R16 |
| F5 | At least two supervised work paths can coexist. Progress/results retain task, execution and destination identity. Stopping one task does not stop unrelated work, and a stop request is distinguished from confirmed termination or an already completed effect. | R12/R15/R16 |
| F6 | A basic cloud execution environment performs an actual bounded file/code task using its configured tools and workspace materials and retains a retrievable artifact. The local client may disconnect while that work completes. Local-only resources are not implicitly uploaded or available. | R18 |
| F7 | Durable state survives replacement/restart of service compute as specified: restore identity, accepted work, recorded outcomes and artifacts. In-flight work is reconciled as resumable where supported, failed or unknown; do not blindly repeat uncertain effects. | R14/R15/R17 |
| F8 | One real Harness integration and a capability-different deterministic test adapter demonstrate the execution boundary. Reconstruct/switch at a supported safe boundary without changing logical task identity or losing accepted facts. This fixture proof does not establish universal compatibility or replace the later second-real-Harness gate. | R4/R15 |
| F9 | A minimal replaceable text client exposes conversation, meaningful work status, task-specific stop and artifact access. Disconnected/last-known state is truthful. Ordinary UI requires no Session/Worker IDs, model context management or full task board. Technical identifiers may still exist in protocols and diagnostics. | R12/R13/R19 |
| F10 | Configuration supports a real model path through the selected adapter without making a gateway the identity owner. Deterministic test/demo providers are visibly labeled. Model/provider presence or a saved key is not proof of a successful model call. | R4/R8 |

## Scope boundaries

This is a private text foundation and engineering validation slice. It includes core management, necessary authentication, basic explicit facts, tracked tasks, one execution environment and a minimal text entry. It does not decide the final desktop/management design or all future product policies.

Deferred from this child:

- New voice-input/output plugins, microphone/device acceptance, native audiovisual duplex, latency targets for real speech and Live2D/avatar work.
- Full task-board/goal-library UI, complex appearance/settings redesign, and integration of every existing desktop feature into the new service.
- Real QQ/Bilibili/public-room integration and the full public/private multi-user memory policy. Protocol context boundaries must remain explicit, and unauthorized cross-scope access must be rejected, but no production public-channel behavior is implied.
- Automatic semantic memory extraction/vector knowledge base, autonomous initiation of new goals, proactive notification defaults and automatic private-file synchronization.
- Arbitrary graph scheduling, transparent migration of live tool processes, provider-private reasoning/KV state, or a claim that all Harnesses are compatible.
- Live paid cloud deployment, real external posting/account login and required paid model calls in automated verification. Produce runnable deployment material and distinguish local service-process proof from a live cloud rollout.

Use isolated service data/workspaces during development and acceptance. Preserve existing desktop data and operation; any migration of the existing Cortico history is a separate reviewed step, not an implicit effect of this task.

## Acceptance criteria

| ID | Observable proof | Requirements |
| --- | --- | --- |
| A1 | Start the service without Electron/audio/avatar dependencies; connect an authorized text client, reject an unauthorized client, and interact with one stable Agent without creating a Session. | F1/F2/F9 |
| A2 | Start a deliberately slow operation and observe its accepted/running receipt before completion. Submit input B during it; at the next supported inference step, B is processed and answered without waiting for the slow work. Verify ordering with controlled fixtures rather than a marketing latency number. | F4/F5 |
| A3 | Run independent work concurrently, stop one target and observe its real settled outcome while unrelated work remains live. Include completion/cancellation races and late or duplicate result delivery. No effect or visible result is duplicated. | F4/F5 |
| A4 | A real file/code operation in the service execution environment produces an artifact after client disconnection. Reconnect, retrieve the same task and artifact, and avoid replaying completed commands. A timer-only mock is insufficient for this criterion. | F6/F7/F9 |
| A5 | Restart compute with the same durable storage: identity, explicit preference, accepted task records, completed outputs and artifact references remain. In-flight cases show verified resume/failure/unknown instead of invented success or automatic duplicate execution. | F3/F7 |
| A6 | Withdraw/re-enable a text view or execution provider through its supported lifecycle; preserve product data, release owned resources and expose truthful unavailable/draining state. Unrelated tasks are not removed. | F2/F5 |
| A7 | Use a real Harness path plus a distinct deterministic adapter and reconstruct an internal execution Session at a safe boundary; preserve logical work/profile/facts and do not replay a committed effect. Record exactly which operations each adapter supports. | F3/F8 |
| A8 | In the actual text UI, assign/inspect/stop work and open an artifact; disconnect/reconnect and distinguish last-known from current state. No ordinary workflow requires Session/Worker selection. Internal wire metadata is not prohibited. | F9 |
| A9 | Exercise the real adapter transport with a controlled model-protocol fixture, including error and cancellation. Document any untested live provider/account behavior; an offline scripted reply remains labeled. | F10 |

## Planning decisions and readiness

The text-first priority, independent/cloud-capable service, cloud execution environment and continuity principle are approved. Implementation and executable verification are tracked in the sibling progress/evidence files. Later product questions remain in the parent and do not reopen settled first-phase decisions.

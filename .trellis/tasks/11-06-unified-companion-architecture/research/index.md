# Research handoff

Research date: 2026-11-06; decision update: 2026-11-07. Task remains **planning**. [ADR-0015](../../../../docs/adr/0015-independent-continuous-agent-runtime.md) accepts the independent runtime and continuous Agent / internal Session model; [ADR-0016](../../../../docs/adr/0016-cloud-service-and-pluggable-features.md) adds cloud-capable service deployment and feature plugins. Requirements and remaining decisions are in [the PRD](../prd.md); technical proposals are in [the design](../design.md) and [the staged plan](../implement.md). No product code or dependency was changed.

## Read in this order

| Report | Reviewer / role | Evidence boundary |
| --- | --- | --- |
| [Current runtime](current-runtime.md) | GPT-6-Astra / backend architecture | Local source at baseline `500aeba`; no runtime tests or installed Cortico internals assumed |
| [Upstream runtimes](upstream-runtimes.md) | GPT-6-Astra / framework research | Cortico pin and current head; actual Superagent bundle; Higgs announcement access status |
| [Ecosystem and duplex](ecosystem-and-duplex.md) | Main GPT / integration review | AstrBot/Pi primary code; official Realtime docs; live read-only DSH Services and Slots |
| [Interaction design](interaction-design.md) | DeepSeek-v4.1-flash max / product and frontend | Existing UI/control source and Coopanion comparison; source evaluation, not a rendered UX/device test |
| [Magpie and routing](magpie-routing.md) | GPT-6-Astra / gateway research | Fixed upstream source and current official documentation; no paid endpoint calls |

## Important reconciliations

- The 2026-11-06 research reopened the historical standalone/Cortico decisions and found both DSH hosting and independent hosting technically plausible. On 2026-11-07 the user selected independent ownership for modular Harness integration; the decision is now ADR-0015, and the old ADRs are marked superseded for target ownership while retaining current-code evidence.
- The earlier review trade-off remains informative: the design reviewer favored standalone UX; backend review valued DSH infrastructure reuse where its dependency was acceptable. The coordinator's former conditional DSH-first suggestion is superseded by the user's choice, not an outstanding recommendation.
- Cortico has streaming/interruption hooks. The **local adapter chain discards or buffers their benefits**. Neither “Cortico has no streaming” nor “upgrade it and duplex works” is supported.
- Superagent implements DSH-backed work orchestration. Its public prototype must not be equated to all claims about an internal/conceptual super-agent or to a native audio engine.
- Higgs Realtime Duplex's own announcement says API coming soon / waitlist. The existing Higgs Realtime API is available; 160 ms is the new model's stated chunk size, not this project's measured latency.
- Magpie supports semantic intent routing, a dedicated System One/Jev decision API and media endpoints/tools as well as chat protocols. Do not describe it as fallback-only or text-only. Its Responses WebSocket support is not proof of a realtime audiovisual session API. The pinned source is newer than the live intent guide in context and fallback behavior; use the source-backed gateway report for those details.
- The interaction review initially inferred that DSH hosting requires a paid/model-key setup or embedding because the `desktop` profile name is reserved. The coordinator rejected those inferences: a normal custom DSH host profile and optional native client are viable, and a plugin may implement local onboarding/offline fixtures. This does not prove a completed native-media bridge. Missing explicit browser echo-cancellation constraints likewise do not prove echo cancellation is disabled; acoustic behavior requires device validation.
- Pi contains an actual Jev classifier routing example. That substantiates the model-routing idea, not suitability for every pet motion or acoustic turn-taking decision.
- Shared records are not the same as shared model context. The current pet archives some events without delivering them to the active model, and a memory directory is not a semantic memory implementation.
- The visible main agent is an interaction role. Backends may run concurrently while persona, audience and output ownership remain coherent. One persona does not require a globally blocking context or unrestricted sharing of private/public transcripts.

## Latest decision: independent runtime, continuous Agent, internal Sessions

R10 establishes cross-session continuity. R11/R12 (2026-11-07) now select independent product ownership and one user-facing Agent with multiple internal Workers. [The design](../design.md#continuous-identity-work-and-internal-execution) separates the Agent, logical tasks, Workers, Harnesses, execution Sessions and interaction scenes. DSH's verified contracts remain relevant to an optional adapter, not the selected primary host.

A focused GPT/DeepSeek review agrees that hiding Sessions must preserve task-level progress and control. The coordinator retained scope-aware reference resolution and per-output ownership as design proposals. It did **not** adopt unrequested defaults for automatic memory capture, retries, public posting, priority, notification timing, goal-list navigation or a ban on advanced model controls; these require their own product decisions. Worker does not necessarily mean an OS process, and a logical task must not be a renamed Session.

## Latest additions: feature plugins, cloud service and asynchronous events

R13/R14 select a minimal kernel with independently replaceable feature modules and a cloud-capable standalone service. Task-board UI, speech input/output, Live2D/avatar/outfit modules and interaction clients do not own canonical tasks or identity. R15 accepts the discussed continuity criterion at supported Harness/Session replacement boundaries; this is not test completion or implementation approval.

R16 adds the user's asynchronous ReAct timeline: long work returns a trackable receipt, foreground input can proceed at the next supported inference step, and attributed completion/stop outcomes re-enter as events for the Agent/logical task. The screenshot's exact `start`/`Started`/`stop` naming and DSH default-enable caption are reference material, not independently verified current API contracts. Cortico bus behavior and the local synchronous/parent-cancel limitations are already source-backed in the runtime reports.

R17 asks about cloud computation, database state and a thin local daemon. R18 subsequently selects a basic cloud execution environment in the first usable version; cloud work is not restricted to inference/coordination. The environment uses configured tools and available/authorized materials, while local native/private-device capabilities remain complementary. The design separates service compute, durable product state, execution environments and clients. A thin daemon has no second canonical Agent store, but may need device grants/credentials and effect receipts. Database/container products, automatic workload/data relocation and zero-local-metadata operation were not selected.

The focused review retained kernel ownership/commit/lifecycle contracts, replaceable memory/policy implementations and distinct service/connection/device/work states. It rejected making a particular memory implementation, text channel or proactive notification feature irremovable. No active notification channel does not mean the Agent is stateless. During a disconnection the client may know only its last confirmed snapshot; neither cloud success nor cloud failure should be invented. Canonical service records and actual local effects have different evidence sources, and uncertain effects must not be blindly retried.

## Current scoped work: text-first foundation

R19 selects text interaction first, with voice input developed later as a plugin. The first deliverable now has [a child PRD](../../11-07-text-agent-foundation/prd.md); the parent retains the long-term requirements and source evidence. Focus the child on the service/plugin/state/async-work/cloud-execution/text-client path. Do not reopen text versus voice priority, require a full task board or Live2D, or expand this first proof into all named external platforms. The user approved implementation on 2026-11-07. The child now has a working service and executable acceptance evidence; see its progress/acceptance records.

## Resume instructions

1. Read ADR-0015, the PRD and design; distinguish the accepted direction from unapproved implementation detail.
2. Do not re-ask the DSH-required versus independent-host question. Plan the independent runtime and bounded Harness adapters, keeping ordinary Session/Worker management internal.
3. Do not re-ask whether the core may be cloud deployed, whether features are plugins, whether cloud execution is included, or whether the first slice is text: R13/R14/R18/R19 settle those. The private text-foundation child defers public-platform, advanced memory, native voice and autonomous-goal policy to later slices.
4. Use the existing 11-07-text-agent-foundation child and its implementation/acceptance records; do not repeat scope approval or create a duplicate task. The child is implemented and in final handoff, while this parent remains the long-term roadmap.
5. Preserve one authoritative writer for each durable state during any migration; do not use temporary framework adapters as an excuse for duplicated identity/history/task owners.

## Environment and verification notes

- Used native model-routed DSH subagents with messages for follow-up review. No global `trellis` executable is installed; Trellis channel and `trellis mem` were not run. Existing task documents and journals supplied historical context.
- Project scripts run with `python3`. Planning pointer uses `TRELLIS_CONTEXT_ID=dsh-pet-architecture-20261106`; other sessions may need to select/load this task through their normal Trellis mechanism without starting implementation.
- Source snapshots were read from temporary directories; public commit URLs in the reports are the durable references. No third-party setup scripts were followed.
- Documentation validation does not establish runtime, native media, acoustic, public-account or measured model performance. Those are proposed future experiments in the plan.

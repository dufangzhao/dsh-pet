---
status: accepted
date: 2026-11-07
source: User selected an independently maintained engine with modular Agent Harness integrations, one continuous user-facing Agent, parallel internal Workers, and no user-managed Sessions.
---

# Independently own the continuous Agent runtime; keep Sessions internal

The product maintains its own runtime so different Agent Harnesses can be integrated without making any one of them the owner of the product's identity or lifecycle. Users interact with one continuing Agent across surfaces; the system may run multiple Workers and execution Sessions internally. Users describe goals, refer to ongoing work and receive results without creating, choosing or repairing Sessions. A task's execution placement is the system's responsibility.

This selects the independent-runtime route discussed in [the Trellis task](../../.trellis/tasks/11-06-unified-companion-architecture/prd.md). DSH can provide an optional integration surface, tools or execution backend through an adapter; it is not the required product host. Cortico remains the current implementation and a candidate initial adapter. Its current ownership of conversation/history is migration work, not a permanent product boundary. This decision supersedes [ADR-0002](0002-standalone-with-optional-dsh.md) as the overall product topology and [ADR-0014](0014-cortico-agent-runtime.md) as the long-term ownership model; both remain records of existing implementation.

## Consequences

- The product owns persistent companion identity, accepted memory, logical work and cross-surface coordination. Workers perform bounded or continuing execution through the harness selected for that work; an execution Session is internal context/checkpoint/log state, not the user's task or the Agent's identity.
- Goals, ongoing work, results and necessary choices are user-facing concepts. Hiding Sessions does not hide task status, cancellation, failures or relevant context choices. Topics or activity views must not merely rename a Session list and preserve its manual lifecycle burden.
- One logical task may use multiple Workers or execution Sessions. Worker/session replacement must not create another character or duplicate an already committed action. Single-authority ownership applies to each durable fact, not to the number of concurrent Workers.
- Independent ownership does not mean rewriting every harness or creating a new plugin/task framework. Reuse the existing kernel's useful mechanisms, keep stable integration contracts small, and make harness-specific features explicit. Framework contexts, private checkpoints and native media protocols need not be forced into a lowest-common-denominator interface.
- A continuous product identity does not imply an always-running model request, an unlimited transcript or autonomous initiation of new goals. The later [ADR-0016](0016-cloud-service-and-pluggable-features.md) selects cloud-capable independent service deployment and feature plugins. First-release scope, autonomy, memory visibility and detailed recovery guarantees still require planning.

This is an accepted architectural direction, **not approval to implement the full design or migrate current data**. Technical detail and the execution plan remain in [the task design](../../.trellis/tasks/11-06-unified-companion-architecture/design.md) and [staged plan](../../.trellis/tasks/11-06-unified-companion-architecture/implement.md).

# Staged execution proposal and handoff

Status: **Planning only.** Independent product ownership and the continuous Agent / internal Session model are accepted in [ADR-0015](../../../docs/adr/0015-independent-continuous-agent-runtime.md). Cloud-capable service deployment and feature plugins are accepted in [ADR-0016](../../../docs/adr/0016-cloud-service-and-pluggable-features.md). The user also selected event-driven long-work execution and accepted the continuity principle. The first slice, device-offline behavior, memory-sharing policy, autonomy and latency criteria still require planning. This roadmap does not authorize `task.py start`, product-code implementation or live deployment.

## Phase 0 — research and convergence (current)

- [x] Capture the user's original request and subsequent Magpie / host-choice clarifications.
- [x] Inspect the current repository, accepted historical decisions and real DSH extension contracts.
- [x] Delegate backend/runtime and upstream analysis to GPT; interaction/design analysis to DeepSeek; gateway analysis to GPT.
- [x] Record candidate architecture and migration boundaries during discovery.
- [x] Reconcile researcher reports, verify important source claims and preserve the host trade-off as historical research.
- [x] Record the user's 2026-11-07 decision: independent engine, modular Harnesses, one continuous Agent, concurrent Workers and Sessions managed internally. ADR-0015 is accepted.
- [x] Record the user's cloud-service and independently pluggable feature decisions, continuity acceptance, asynchronous long-work/event requirement and compute/state/execution-environment separation question.
- [x] Include a basic cloud execution environment in the first usable version (R18), with actual file/code work and artifacts rather than cloud-only inference/coordination.
- [x] Select text interaction for the first foundation and defer voice input to a later plugin (R19); create [the implementation-planning child](../11-07-text-agent-foundation/prd.md).
- [ ] Resolve only the product decisions needed for each later slice: external-platform/memory visibility, autonomous behavior, unavailable-device policies and actual realtime criteria. Do not block the private text foundation on unrelated voice/public-platform decisions.
- [ ] Rewrite the final PRD losslessly, update design/plan, present the final implementation summary and obtain a subsequent explicit implementation decision.

No child implementation tasks are created until the first slice is selected. The existing UI migration/spec-bootstrap tasks remain independent.

## Phase 1 — prove the service, plugin and asynchronous execution boundaries

Create a child task for a concrete vertical slice after planning approval. Do not make a live paid cloud deployment merely to validate the boundary; separate service/client processes on the available machine can establish protocol behavior first.

- Build a headless composition from useful existing kernel services; isolate Electron/Windows device admission and credential dependencies behind declared providers. The server boots with no UI/audio/Live2D plugin. Define the authenticated client/capability boundary before exposing a remote listener.
- Provide one replaceable interaction client and a basic cloud execution-environment plugin with a scoped workspace, configured file/code tools and durable artifact references. This first-version requirement is selected in R18. Local execution/media adapters complement it; the client holds no second canonical Agent/mission store, and task boards/avatars remain optional views.
- Prove actual cloud-environment work with a bounded file-processing or code task that completes and retains its artifact after the local client disconnects. A timer-only fixture is not enough for this execution capability; using a local separate process for the protocol test is not evidence of an actual cloud deployment.
- Separate logical work, Worker attempts, harness-owned Sessions and execution-environment identity. Adapt Cortico where useful and retain the current single history writer until a controlled migration is required.
- Reuse TaskSupervisor for a foreground interaction and an explicit slow background task. Preserve a short direct-result tool. Long work returns an acceptance/start receipt promptly, foreground input B is admitted at the next supported inference step, and completion returns as a correlated event without model busy-polling.
- Validate stop during admission/running/completion, plugin withdrawal, actual execution drain, duplicate/late events and audience routing. A local playback-stop fixture does not assert remote cancellation.
- Disconnect the local client while cloud-eligible work continues; unavailable-device work reports the actual limitation. Reconnect and recover the same identity/task/result view without redoing effects or replaying stale audio. Swap a view/provider at its supported lifecycle boundary and preserve data.
- Keep durable state outside disposable compute. A restart proof must restore accepted facts and classify each in-flight operation as safely resumable, failed or unknown. It must not claim that every external process resumed or blindly resubmit an uncertain effect.
- Rebuild an execution Session or change a compatible test adapter at a safe boundary, preserving task identity, persona revision, authorized facts and committed effects. A second real Harness remains required before broad compatibility is claimed.

Exit evidence: one continuous Agent, parallel useful work, no Session management, truthful module/connection/device states, independent frontend responsiveness, and a result delivered to its correct task/destination once. Scope the actual native voice/full-duplex and real cross-network performance tests separately; fixtures prove control semantics rather than those performance claims.

## Phase 2 — streaming interaction and output commitment

- Propagate streaming and cancellation through the selected engine → host capability → model/voice adapter boundaries.
- Keep receive and output loops independent. Use dedicated realtime session support when available; retain a truthful cascaded path for other providers.
- Track generated text/audio, presented output and actual playback progress. Discard stale output by identity rather than by whichever session is currently active.
- Design listening, speaking, thinking and background-work UI as concurrent facts; preserve current keyboard/focus/recording ownership.
- Compare no-router, deterministic routing and classifier-assisted routing before selecting a default.

Exit evidence: measured first useful output, interruption-to-silence, meaningful continuation after a correction, and p50/p95 under representative load. Numeric targets and hardware/provider profiles must be selected in the child PRD; no marketing benchmark substitutes for this run.

## Phase 3 — cross-surface identity and memory

- Choose one external platform for the initial adapter; clarify QQ transport or the exact Bilibili surface before implementation.
- Persist explicit owner/account bindings, origin/audience and task correlation.
- Separate stable persona, eligible memories, knowledge sources and engine working context.
- Introduce retrieval/indexing only for confirmed memory behavior; preserve provenance and user correction/deletion semantics.

Exit evidence: a preference learned through one authorized surface is used through the other; private anecdotes do not leak into an unrelated public reply; concurrent inputs and restarts preserve coherent commitments and routing.

## Phase 4 — model gateway and generated media

- Add Magpie as a provider adapter using verified protocol/capability metadata; keep other supported providers usable.
- Select one owner for semantic model routing to avoid duplicated product-side and gateway-side classifiers.
- Integrate one image or video workflow through tracked jobs and artifact references; do not force long work into a 30-second nested tool call or a full-buffer speech response.
- Distinguish stopping local waiting, confirmed provider cancellation and eventual completion. Report unsupported cancellation explicitly.

Exit evidence: actual routed model/role is inspectable, streaming survives the gateway, a slow media job does not block conversation, and its result returns to the right audience. Confirm live-model costs/account access separately when an experiment is ready.

## Phase 5 — replacement and further expansion

- Verify a second real interaction/execution driver, not just a mock provider, using the agreed portability contract.
- Where required, perform a controlled one-writer history migration with backup and rollback; engine-private caches are not portable facts.
- Expand platform, memory, voice and avatar plugins according to validated demand. Do not prebuild an ecosystem around untested interfaces.

Exit evidence: the same acceptance scenarios pass after the replacement; platform adapters and persona data do not need engine-specific rewrites. Unsupported native capabilities remain honestly declared.

## Development collaboration

| Responsibility | Route used in this discovery | Future work assignment |
| --- | --- | --- |
| Coordination, contracts and backend | GPT-6-Astra, Magpie Responses | Main architecture/implementation/integration owner |
| Runtime and upstream reviews | GPT-6-Astra, xhigh | Narrow source-backed reviews and implementation packages |
| Interaction/frontend/design | DeepSeek-v4.1-flash, max | Interaction specification and frontend work after approval; explicitly do not save tokens at the cost of needed analysis |
| Gateway/model routing | GPT-6-Astra, xhigh | Adapter/protocol work and capability verification |

These are development-team assignments, not a fixed product inference configuration. Re-inspect available models at future dispatch time. Use relevant skills/MCP tools where they provide the required capability; do not install unrelated tools merely to claim usage. Native subagent messaging is used in this environment because the global Trellis channel CLI is unavailable. Research artifacts provide the durable handoff.

## Validation commands and limits

For this documentation-only round:

```sh
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/11-06-unified-companion-architecture
TRELLIS_CONTEXT_ID=dsh-pet-architecture-20261106 python3 .trellis/scripts/get_context.py
```

Also validate JSON/JSONL syntax and local links in new/edited documents. These checks do not validate the proposed architecture at runtime. No dependency installation or product test suite is needed for a research-only diff.

For approved implementation, first load the actual relevant Trellis specs, then select focused contract/integration tests. The current full project gate is `pnpm check`. A native Electron or DSH bridge change additionally needs real surface/device acceptance appropriate to that change; static rendering or a standalone replacement server is not evidence that the existing application works.

## Files and rollback attention

Current risk areas for later work: the agent adapter and provider result contract, application hard-coded provider selection, host task cancellation, speech buffering/playback ownership, and canonical history storage. Their exact anchors belong to [the local report](research/current-runtime.md).

Do not alter the current `.trellis/spec/` to pretend draft contracts are already executable. Historical ADRs now link to this discovery. Final selected hard-to-reverse decisions should update or supersede those ADRs once, with this task retaining the research evidence.

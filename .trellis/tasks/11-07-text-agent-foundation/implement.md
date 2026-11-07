# Text foundation execution plan

Status: **Implementation in progress.** The user approved the scoped summary and started this child on 2026-11-07. The parent remains the roadmap; this child does not include deferred voice/platform/UI work. See [progress](progress.md) for current implementation and verification evidence.

## Readiness and first engineering checks

- [x] User selected text first, a minimal extensible foundation and later voice-input development.
- [x] User selected independent service hosting, a first-version cloud execution environment and continuity at supported replacement boundaries.
- [x] Source-backed runtime/upstream research and focused GPT/DeepSeek review inform this child.
- [x] Current Node v26.13.0 exposes node:sqlite DatabaseSync/prepare. Docker CLI and server both report 27.0.3; the server version was confirmed by a read-only query on resume. These facts do not prove image availability, execution isolation, database correctness or deployment compatibility.
- [x] PRD/design/implementation plan and both real context manifests are complete for the scoped final review; parent text-first and cloud-execution decisions are synchronized.
- [x] User approved the scoped PRD/design/plan and explicitly authorized implementation.
- [x] First engineering gates verified pinned Cortico next-step admission/cancellation, actual SQLite single-writer behavior and Docker execution. Integrated failure/recovery and full quality gates remain tracked separately in progress.

## Work packages

| Order | Work package | Owner | Completion evidence |
| --- | --- | --- | --- |
| 1 | Executable contracts and narrow feasibility probes | GPT backend/architecture | Command/event/task/attempt/receipt boundaries, explicit background admission versus normal child invoke, fixed-version Cortico safe-point evidence, selected state/execution backend constraints |
| 2 | Headless composition and persistent product state | GPT backend/architecture | Service starts without Electron/media; isolated data root; one writer; state+event transaction behavior; authenticated snapshot/command/event/artifact boundary; honest recovery |
| 3 | Harness integration and cloud execution plugin | GPT backend/architecture | Real Cortico integration, deterministic contrast adapter, short direct tool, long independent task receipt/result, actual workspace file/process execution, cancellation/drain and artifact persistence |
| 4 | Reference text-client plugin | DeepSeek frontend/design | Real protocol-connected conversation, compact task status, target stop and artifact links; no Session UI; missing capability and disconnect/reconnect behavior; controlled static contribution |
| 5 | Integrated acceptance and deployment handoff | GPT integration, DeepSeek UI review | PRD A1–A9 evidence, shared-kernel regressions, actual browser interaction, runnable service/deployment documentation and clear live-model/cloud limits |

Work packages 3 and 4 can proceed in parallel only after their shared contracts are concrete. Give each agent nonoverlapping file ownership and source-backed context. Keep review findings separate from implementation evidence.

## Package/file scope

Reuse the existing contracts, host-kernel and plugin-sdk. Proposed additions are `packages/companion-runtime`, `apps/companion-service`, a cloud-execution provider and a reference text-client contribution. Exact package names may be consolidated if that keeps the implementation clearer; do not create a package for every conceptual box.

Likely sensitive existing seams are the desktop host composition, capability/task host ports, Cortico client/tool adapter and model-provider transport. Avoid broad unrelated refactors. Preserve the old desktop's profile/data/history and startup path; new service acceptance uses a separate root. No automatic history migration or credential copying.

## Targeted checks

Use existing package test scripts for affected shared packages, for example:

```sh
pnpm --filter @pet/contracts typecheck
pnpm --filter @pet/host-kernel typecheck
pnpm --filter @pet/host-kernel test
pnpm --filter @pet/plugin-sdk typecheck
pnpm --filter @pet/plugin-sdk test
```

Add conventional typecheck/test/build scripts for the new packages and include the service/client in the relevant root quality gate. The current `pnpm build` targets only the desktop, so it cannot by itself prove a new service build.

The required meaningful integration scenarios are owned by [PRD A1–A9](prd.md#acceptance-criteria), not duplicated here. Run them across actual service/client/task boundaries. Use controlled model fixtures for deterministic ordering/error/cancel cases, actual file/process work for execution, and actual container/backend checks before claiming containment. Browser UI acceptance must exercise the connected UI, not only render HTML.

Before delivery, run `pnpm check` plus the new service/client integration and execution-backend checks appropriate to the implemented scope. If the environment prevents a required check, state the exact missing dependency/evidence rather than invent a pass. No paid inference or cloud deployment is required in automated tests.

## Deliverables

- A runnable independent service with documented configuration, operator authentication, data/workspace roots and lifecycle.
- Versioned, documented plugin/Harness/client contracts backed by behavior tests.
- A first state provider and supervised cloud-execution plugin, with correct task/effect/receipt semantics.
- A replaceable text-client plugin that demonstrates the real service path.
- A real Harness integration plus a distinct deterministic contract-test adapter; no unsupported universal compatibility claim.
- Test reports and deployment instructions showing local verification, actual backend validation and any untested live provider/cloud paths separately.

## Deferred follow-ups

Voice input/output and acoustic acceptance, Live2D, full task board/settings redesign, real QQ/Bilibili integrations, advanced semantic memory, proactive goals and multiple real Harness implementations remain later tasks. Text-first must preserve their integration boundaries without creating fake buttons, placeholder services or blanket capability promises.

## Rollback and handoff

New service work is additive and uses isolated state. Shared-kernel behavior changes require focused regression evidence and ordinary review. Roll back an unaccepted service change by disabling its composition and returning to the previous code; do not delete or reinterpret old desktop data. Any future state-format migration gets an explicit version/backup/import plan before use.

Record actual contracts in Trellis specs after implementation proves them. Planning documents and reference tests are not evidence that the new runtime already exists.

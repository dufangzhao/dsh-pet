# Approved local commit batch

User confirmation received on2026-11-08: execute the three local work commits, then archive this child and record the Trellis session. No push; the architecture parent remains planning.

Prepared for the parent implementation agent. This is a reviewable plan only: no staging, commits, task completion, moves, archive, push, dependency installation or test reruns were performed for this handoff. Only this new plan file is written.

## Approval and evidence boundary

[Workflow Phase 3.4](../../workflow.md#34-commit-changes-required--once) requires the AI to draft a concrete batched plan and then **“Present the plan once, ask for one-shot confirmation.”** The same phase says **“On confirmation: run `git add <files>` + `git commit -m "<msg>"` for each batch in order. Do not amend. Do not push.”** Implementation authorization does not replace this explicit Git confirmation. The parent will request approval once the final evidence is ready; this delegated handoff neither asks the user nor executes the batch.

Implementation and final `pnpm check` are PASS (exit0). The delivered human-readable scripted-copy version passed all22 actual browser checks; final screenshots/report have been collected and reviewed. Acceptance, progress, task notes and stale pre-implementation handoff wording are synchronized. The architecture parent remains `planning`; its long-term deferred scope is not being completed or archived.

Recent history uses concise English conventional subjects, including `feat(plugins): simplify management cards and settings navigation`, `docs(readme): link the public repository`, `chore(task): archive 11-04-plugin-list-cleanup`, and `chore: record journal`. The subjects below follow that style. All planned commits are local-only; no push or amend.

## Inspected inventory

`git status --porcelain=v1 --untracked-files=all` initially contained **159 exact paths: 20 tracked modifications and 139 untracked files**. `git diff --cached --name-status` was empty. After adding this plan, the expected inventory is **160 paths: 20 tracked modifications and 140 untracked files**, subject to the parent's concurrent final evidence updates. No index state is changed by this plan.

All initially dirty paths are recognized through the explicit handoff, task scopes/context manifests, tracked diffs and recorded implementation/research evidence. No genuinely unrecognized dirty files were found. Recognition does not claim this delegated agent authored the earlier changes.

| Order | Proposed subject | Exact paths |
| --- | --- | ---: |
| 1 | `docs(architecture): define the independent companion runtime` | 19 |
| 2 | `feat(companion): add the text-first agent foundation` | 135 |
| 3 | `test: make desktop and ASR path fixtures portable` | 4 |
| Later session bookkeeping | `chore: record journal` | 2 currently dirty paths |
| Total before future archive changes | | 160 |

The three work commits cover **158 paths**. The remaining **2 paths** are existing workspace journal changes reserved for subsequent session bookkeeping. Future archive moves/link maintenance are separate changes, not silently included in this batch. Counts describe paths, not Git rename/add/delete records or lines changed.

The fenced lists below are exact repository-relative staging manifests, one file per line. They contain no directory-only entries or wildcards. Before any approved execution, the parent should compare the fresh full status with these lists and preserve any staged work that appeared since inspection; do not use a blanket add/reset to absorb concurrent work.

## 1. `docs(architecture): define the independent companion runtime`

Purpose: preserve the earlier approved independent-runtime research, product terminology, accepted ADRs and historical-architecture clarifications. Include the complete parent task research/planning/context package. The architecture parent remains **planning**, with its child relationship intact; this commit neither completes nor archives it. References to the child become available in the following feature commit.

Exact file list — 19 paths:

```text
CONTEXT.md
docs/05-architecture-overview.md
docs/adr/0002-standalone-with-optional-dsh.md
docs/adr/0010-unified-plugin-model.md
docs/adr/0014-cortico-agent-runtime.md
docs/adr/0015-independent-continuous-agent-runtime.md
docs/adr/0016-cloud-service-and-pluggable-features.md
.trellis/tasks/11-06-unified-companion-architecture/check.jsonl
.trellis/tasks/11-06-unified-companion-architecture/design.md
.trellis/tasks/11-06-unified-companion-architecture/implement.jsonl
.trellis/tasks/11-06-unified-companion-architecture/implement.md
.trellis/tasks/11-06-unified-companion-architecture/prd.md
.trellis/tasks/11-06-unified-companion-architecture/research/current-runtime.md
.trellis/tasks/11-06-unified-companion-architecture/research/ecosystem-and-duplex.md
.trellis/tasks/11-06-unified-companion-architecture/research/index.md
.trellis/tasks/11-06-unified-companion-architecture/research/interaction-design.md
.trellis/tasks/11-06-unified-companion-architecture/research/magpie-routing.md
.trellis/tasks/11-06-unified-companion-architecture/research/upstream-runtimes.md
.trellis/tasks/11-06-unified-companion-architecture/task.json
```

## 2. `feat(companion): add the text-first agent foundation`

Purpose: add browser-safe contracts, a headless service/runtime composed with the existing kernel and SDK, source authority/scopes, SQLite state, Docker execution/recovery, real Cortico plus the deterministic adapter, and the replaceable text-client plugin. Include package/build integration, executable specs, deployment/usage docs, tests, QA probes and final browser evidence as one coherent implemented foundation.

The root [README](../../../README.md) and [docs index](../../../docs/README.md) now describe the implemented service, so both belong here. There are no dirty existing host-kernel/plugin-sdk implementation paths: this commit composes their existing APIs rather than claiming unrelated SDK/kernel changes.

All **16 child task files**, including this plan, are recognized work and included here while still at their active paths: requirements/design/execution documents, implementation contract, curated JSONL context, progress, task metadata, and all seven research/evidence reports. The portability report belongs to this task evidence package; the four actual existing fixture edits remain isolated in commit 3. Archiving these task documents is a later bookkeeping commit, not grounds to omit their content now. The text-client's own research and verification reports are also included as scoped implementation evidence; their historical results should remain clearly distinguishable from final integrated acceptance.

Generated desktop admission metadata belongs here: inspection verified the sole changed admission entry is `dist/asr-worker.cjs`, with **69,822 → 69,995 bytes (+173)** and its SHA-256 changed from `e7665157b15a1709a4eb0919d7b8ed37ad8294515bc7738f366637c8a3362a02` to `742cd695f6d77626ad681a718b780f6384f20443195ae0911518a22c5f7156c2`. The parent reviewed the additive empty `init_companion` export module responsible for that generated CJS delta. Include this reproducible build metadata with the contracts/feature; it is not part of the portable-fixture commit.

Exact file list — 135 paths:

```text
.gitignore
.trellis/spec/backend/index.md
.trellis/spec/backend/companion-service.md
.trellis/spec/shared/project-baseline.md
.trellis/tasks/11-07-text-agent-foundation/check.jsonl
.trellis/tasks/11-07-text-agent-foundation/commit-plan.md
.trellis/tasks/11-07-text-agent-foundation/design.md
.trellis/tasks/11-07-text-agent-foundation/implement.jsonl
.trellis/tasks/11-07-text-agent-foundation/implement.md
.trellis/tasks/11-07-text-agent-foundation/implementation-contract.md
.trellis/tasks/11-07-text-agent-foundation/prd.md
.trellis/tasks/11-07-text-agent-foundation/progress.md
.trellis/tasks/11-07-text-agent-foundation/research/browser-acceptance.md
.trellis/tasks/11-07-text-agent-foundation/research/cloud-exec.md
.trellis/tasks/11-07-text-agent-foundation/research/cortico-gate.md
.trellis/tasks/11-07-text-agent-foundation/research/desktop-portability.md
.trellis/tasks/11-07-text-agent-foundation/research/service-recovery-tests.md
.trellis/tasks/11-07-text-agent-foundation/research/source-authority.md
.trellis/tasks/11-07-text-agent-foundation/research/state-sqlite.md
.trellis/tasks/11-07-text-agent-foundation/task.json
README.md
apps/companion-service/build.mjs
apps/companion-service/package.json
apps/companion-service/src/main.ts
apps/companion-service/src/model-client.test.ts
apps/companion-service/src/model-client.ts
apps/companion-service/src/native-provider.d.mts
apps/companion-service/src/native-provider.mjs
apps/companion-service/src/server.ts
apps/companion-service/src/service.ts
apps/companion-service/tsconfig.json
apps/desktop/src/main/builtin-admission.json
docs/README.md
docs/35-text-agent-foundation.md
docs/deploy/companion.Caddyfile.example
docs/deploy/companion.service.example
package.json
packages/companion-runtime/package.json
packages/companion-runtime/src/core-plugin.ts
packages/companion-runtime/src/fixture-harness.ts
packages/companion-runtime/src/index.ts
packages/companion-runtime/src/json.ts
packages/companion-runtime/src/plugin-host.ts
packages/companion-runtime/src/runtime.ts
packages/companion-runtime/src/source-authority.test.ts
packages/companion-runtime/src/source-authority.ts
packages/companion-runtime/tsconfig.json
packages/contracts/src/companion.ts
packages/contracts/src/index.ts
plugins/cloud-exec/build.mjs
plugins/cloud-exec/package.json
plugins/cloud-exec/plugin.json
plugins/cloud-exec/src/boundary.ts
plugins/cloud-exec/src/docker.ts
plugins/cloud-exec/src/executor.ts
plugins/cloud-exec/src/index.ts
plugins/cloud-exec/src/records.ts
plugins/cloud-exec/src/types.ts
plugins/cloud-exec/src/workspace.ts
plugins/cloud-exec/tests/boundary.test.mjs
plugins/cloud-exec/tests/docker.test.mjs
plugins/cloud-exec/tests/fixtures.mjs
plugins/cloud-exec/tests/source-loader.mjs
plugins/cloud-exec/tsconfig.json
plugins/harness-cortico/README.md
plugins/harness-cortico/build.mjs
plugins/harness-cortico/package.json
plugins/harness-cortico/plugin.json
plugins/harness-cortico/src/boundary.mjs
plugins/harness-cortico/src/harness.d.mts
plugins/harness-cortico/src/harness.mjs
plugins/harness-cortico/src/index.ts
plugins/harness-cortico/src/scripted.mjs
plugins/harness-cortico/tests/harness.test.mjs
plugins/harness-cortico/tests/source-loader.mjs
plugins/harness-cortico/tsconfig.json
plugins/state-sqlite/build.mjs
plugins/state-sqlite/package.json
plugins/state-sqlite/plugin.json
plugins/state-sqlite/src/index.test.ts
plugins/state-sqlite/src/index.ts
plugins/state-sqlite/src/recovery.test.ts
plugins/state-sqlite/src/state.test.ts
plugins/state-sqlite/src/state.ts
plugins/state-sqlite/src/types.ts
plugins/state-sqlite/src/validation.ts
plugins/state-sqlite/tsconfig.json
plugins/text-client/build.mjs
plugins/text-client/package.json
plugins/text-client/plugin.json
plugins/text-client/research/text-client.md
plugins/text-client/research/verification.md
plugins/text-client/src/assets.d.ts
plugins/text-client/src/client/app.tsx
plugins/text-client/src/client/chat.tsx
plugins/text-client/src/client/client.ts
plugins/text-client/src/client/connect.tsx
plugins/text-client/src/client/format.ts
plugins/text-client/src/client/guards.ts
plugins/text-client/src/client/hooks.ts
plugins/text-client/src/client/index.html
plugins/text-client/src/client/main.tsx
plugins/text-client/src/client/protocol.ts
plugins/text-client/src/client/sse.ts
plugins/text-client/src/client/state.ts
plugins/text-client/src/client/status.tsx
plugins/text-client/src/client/styles.css
plugins/text-client/src/client/tasks.tsx
plugins/text-client/src/index.ts
plugins/text-client/tests/client.test.mjs
plugins/text-client/tests/fixture-server.mjs
plugins/text-client/tests/fixtures.mjs
plugins/text-client/tests/guards.test.mjs
plugins/text-client/tests/integration.test.mjs
plugins/text-client/tests/render.test.mjs
plugins/text-client/tests/source-loader.mjs
plugins/text-client/tests/sse.test.mjs
plugins/text-client/tests/state.test.mjs
plugins/text-client/tsconfig.json
pnpm-lock.yaml
qa/companion-acceptance.md
qa/fixtures/companion-service/browser-preview.mjs
qa/fixtures/companion-service/controlled-client.mjs
qa/fixtures/companion-service/helpers.mjs
qa/fixtures/companion-service/service-process.mjs
qa/probes/companion-browser-acceptance.mjs
qa/probes/companion-cortico-gate.mjs
qa/probes/companion-service-lifecycle.test.mjs
qa/probes/companion-service-recovery.test.mjs
qa/probes/companion-service-smoke.mjs
qa/probes/companion-service.test.mjs
qa/screenshots/companion/01-desktop-connected.png
qa/screenshots/companion/02-offline-last-confirmed.png
qa/screenshots/companion/03-narrow-390.png
qa/screenshots/companion/acceptance-report.json
```

## 3. `test: make desktop and ASR path fixtures portable`

Purpose: isolate existing-test portability fixes from new service behavior. The three desktop tests use native `path.resolve` for virtual installation directories; the ASR QA test uses a native absolute root and outside-root candidate. Production validation and the desktop/ASR implementations are unchanged; preserve explicit hostile Windows-path assertions and existing boundary/error assertions. The recorded full-workspace PASS applies to the complete reviewed batch, including these fixes, rather than promising every intermediate commit passes independently on Linux.

Exact file list — 4 paths:

```text
apps/desktop/src/main/console-config-request.test.ts
apps/desktop/src/main/console-plugin-request.test.ts
apps/desktop/src/main/console-snapshot.test.ts
qa/probes/asr-download.test.mjs
```

## Subsequent bookkeeping — after the approved work commits

Follow workflow ordering: **all work commits first → child archive commit → journal/session commit**. Do not interleave or silently fold workspace journals and archive lifecycle changes into the feature or architecture commits. The [finish-work instructions](../../../.agents/skills/trellis-finish-work/SKILL.md) place task archive and journal work after Phase 3.4. This handoff performs none of those actions.

### Later archive: `chore(task): archive 11-07-text-agent-foundation`

Only after the parent has final evidence, the work batch is committed, and the child is ready for wrap-up: archive the child using the workflow's task command. Do not complete/archive/start the architecture parent, which still owns an unfinished roadmap. The destination month is selected at the actual archive time; the following exact mappings use `2026-11` for the currently expected archive month.

Planned task-document moves — 16 files, not performed:

```text
.trellis/tasks/11-07-text-agent-foundation/check.jsonl -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/check.jsonl
.trellis/tasks/11-07-text-agent-foundation/commit-plan.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/commit-plan.md
.trellis/tasks/11-07-text-agent-foundation/design.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/design.md
.trellis/tasks/11-07-text-agent-foundation/implement.jsonl -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/implement.jsonl
.trellis/tasks/11-07-text-agent-foundation/implement.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/implement.md
.trellis/tasks/11-07-text-agent-foundation/implementation-contract.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/implementation-contract.md
.trellis/tasks/11-07-text-agent-foundation/prd.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/prd.md
.trellis/tasks/11-07-text-agent-foundation/progress.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/progress.md
.trellis/tasks/11-07-text-agent-foundation/research/browser-acceptance.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/browser-acceptance.md
.trellis/tasks/11-07-text-agent-foundation/research/cloud-exec.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/cloud-exec.md
.trellis/tasks/11-07-text-agent-foundation/research/cortico-gate.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/cortico-gate.md
.trellis/tasks/11-07-text-agent-foundation/research/desktop-portability.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/desktop-portability.md
.trellis/tasks/11-07-text-agent-foundation/research/service-recovery-tests.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/service-recovery-tests.md
.trellis/tasks/11-07-text-agent-foundation/research/source-authority.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/source-authority.md
.trellis/tasks/11-07-text-agent-foundation/research/state-sqlite.md -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/state-sqlite.md
.trellis/tasks/11-07-text-agent-foundation/task.json -> .trellis/tasks/archive/2026-11/11-07-text-agent-foundation/task.json
```

Archive may require maintaining moved task-document links, relative paths within moved documents, the child's `relatedFiles`, and the parent/child references without changing the parent's planning status. Known external backlink/content-maintenance candidates are listed exactly below; these are **future archive review targets**, not extra current work-commit assignments:

```text
.trellis/tasks/11-06-unified-companion-architecture/prd.md
.trellis/tasks/11-06-unified-companion-architecture/implement.md
.trellis/tasks/11-06-unified-companion-architecture/research/index.md
.trellis/tasks/11-06-unified-companion-architecture/task.json
docs/adr/0016-cloud-service-and-pluggable-features.md
qa/companion-acceptance.md
```

Inspect the actual move/script result before accepting the archive commit. Include required link repairs in that archive commit where the workflow permits, or a clearly named following `chore(task): fix archived text foundation links` commit; never amend a prior commit or leave broken links silently. Existing journals must remain reserved for the session commit. Historical commands and the old-path staging manifests in this plan document the pre-archive state; distinguish those from live links when maintaining the archived copy.

### Later session: `chore: record journal`

Preserve the existing architecture-discovery Session 21 entry and index changes. They are recognized earlier-session bookkeeping, not feature code. After work/archive commits, record this implementation session with the actual work-commit hashes using the workflow's session tooling; its session commit can capture the pre-existing journal changes and the new entry together. Do not report the architecture parent completed. No journal rotation is currently indicated by the inspected file length; if the tooling creates a new file, review and name it explicitly at that time.

Exact currently dirty journal paths reserved for this later commit — 2 paths:

```text
.trellis/workspace/kingBZ/index.md
.trellis/workspace/kingBZ/journal-1.md
```

## Unrecognized dirty files

**None found in the inspected 159-path inventory.** This plan is the only newly created path for this delegated handoff. If the parent's final browser/evidence pass introduces a different path, classify and explicitly add it to the reviewable plan before requesting one-shot approval. Preserve staged state and keep the entire sequence local-only, with no push.

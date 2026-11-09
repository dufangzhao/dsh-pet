# Controlled persona and explicit persistent memory

Status: implementation and selected-scope acceptance complete; ready for local commits and Trellis archival. M1 real-model text and M2 shared desktop/web are completed and archived. The user explicitly approved continuing after M2 local commits. This child follows [R20](../11-06-unified-companion-architecture/prd.md#L31); it does not reopen deployment, account access or voice scope.

## Goal

The owner can view and change the continuing service Agent's name/persona and explicitly supplied active memories from web or desktop. The Agent keeps its identity, canonical history, independent work and results. Changes have truthful saved/applied outcomes, conflicts preserve drafts, and forgetting cannot be undone by stale or duplicate operations.

## Confirmed foundations

[Source-backed research](../11-06-unified-companion-architecture/research/controlled-persona-memory.md) locates existing core Config, SQLite facts/commands/events, Harness projection and client seams. Persona is configuration, active facts are memory, retained history is evidence, and Cortico context is disposable. Reuse these owners instead of adding another state or memory system. [M2 contracts](../../spec/backend/desktop-companion.md) and [shared UI rules](../../spec/frontend/shared-desktop-entry.md) remain valid.

“Forget” in this child removes an active fact and its application to the current canonical context. It does not erase transcripts, logs or backups; explain this at the action. Do not claim total erasure or infer successful forgetting from one model answer.

## Requirements

- P1 **Canonical persona editing.** Add authenticated owner CAS editing of existing service name/persona only. Preserve Agent id, model/connector/Harness selection, unrelated Config, local presentation and work. Report persisted profile revision separately from actual application/error. Launch environment overrides must be visible/documented, never silently edited to make tests pass.
- P2 **Active memory management.** Both clients show the complete bounded active fact set and allow explicit add, correction and forget. Keep existing32-fact/8KiB aggregate and key/value limits visible. Do not silently truncate an accepted fact, evict legacy data to fit metadata, or add pagination/vector storage without need.
- P3 **Revisioned, idempotent effects.** Owner changes and model-origin write paths capture and enforce canonical memory baselines. Upsert/forget, provenance, mutation revision, command receipt and event commit atomically in existing state. Old delete/recreate baselines must conflict; duplicate pre-forget commands never recreate a deleted row or fabricate a new receipt. Changed payload with reused id conflicts.
- P4 **Truthful provenance and explicit authority.** Derive source/owner/input identity in the host. Expose origin and revisions sufficiently to review facts; unknown legacy origin stays unknown. A caller cannot promote itself to owner. Work-result events, quoted data and unrelated or inferred private traits must not become independent write authority. No new model persona/forget tool is required for this MVP.
- P5 **Preserve accepted conversation behavior.** M1's demonstrated explicit natural request must remain usable: the [live gate](../../../qa/probes/companion-model-live.mjs#L164) asks the Agent to remember a stated preference and supplies a key/value naturally. Do not silently downgrade all model-backed explicit memory to a rigid command-only syntax. Resolve the exact write-admission rule against existing behavior before implementation; model self-assertion is not an authority proof. Nonexplicit suggestions may remain nonpersistent drafts. No paid inference is required for these regressions.
- P6 **Apply without a second Agent.** Use current control/lifecycle mechanisms to retire and really drain/recreate the selected foreground projection at the documented owner-change boundary. Preserve independent workers, state and healthy model connector/credentials. A current-turn remember action cannot stop its own Core or deadlock on its own control lock. After a committed write, context-refresh failure must preserve saved facts and receipt, with application failure visible. Retained history is not authoritative memory.
- P7 **Safe existing data.** If a data-format/version fence is needed, migrate only through a documented idle/closed single-writer transaction with recoverable backup. Preserve id/epoch, history, facts, receipts, tasks and artifacts. Old writers must reject incompatible new data. No real trial data or credentials are opened/migrated during development; prove behavior on synthetic existing-format fixtures.
- P8 **Two surfaces, one contract.** Web and desktop use the same fixed profile/memory service contracts and shared guards; Main remains the sole desktop snapshot/SSE owner and renderer stays network-free. Forms keep captured target and CAS baselines, pending/saved/applied distinctions, late-result fences and clear conflict recovery. Reuse current UI primitives/forms; preserve the transparent pet and existing client functionality. Do not import private credentials or add key ingress.

## Acceptance

- [x] C1 Actual web and desktop observe the same id/profile/facts. Owner persona edit survives service restart with truthful saved/applied state; a controlled next model request uses new persona without a model call on save itself.
- [x] C2 Add/correct/forget survive restart and supported Harness replacement. Complete accepted values reach active context, while removed values are not reintroduced as canonical facts; history remains explicitly retained.
- [x] C3 Old UI/model baselines, delete/recreate and late receipts cannot overwrite/resurrect state. Lost receipt retry returns actual prior effect/current view without duplicate events or fabricated row restoration.
- [x] C4 Owner and current-turn memory writes have host-derived provenance. Existing explicit natural remember behavior passes a controlled model fixture; unrelated/quoted/work-result/inferred-memory attempts are rejected or remain drafts.
- [x] C5 Existing work completes during persona/memory changes with identical task/artifact ids and no replay. Foreground/context teardown failures preserve true state and block unsafe replacement; connector/key ownership remains unchanged.
- [x] C6 Synthetic v1 upgrade, crash/rollback boundary and incompatible-old-writer rejection preserve old durable data. No old trial profile, account or key is read or changed.
- [x] C7 Real web/Electron forms preserve drafts on conflict/retarget, show saved versus applied errors, and require deliberate forgetting. Minimum layout, focus and shared-target behavior remain usable; no fake bridge/DOM pass.
- [x] C8 Focused state/HTTP/Harness/renderer and affected native gates, final workspace checks and Trellis records pass. Evidence distinguishes controlled peers, actual native calls and unverified platform-specific devices.

## Out of scope

Semantic/vector search, inferred autonomous memory, transcript/log/backup erasure, background private-file ingestion, public multiuser ACLs, another database/state scheduler, real-model retesting budgets, voice/platform adapters, public deployment and reopening original4120. The original service/data stay preserved.

## Reviewed plan and execution

The [design](design.md), [exact contract](implementation-contract.md) and [execution plan](implement.md) resolve public/private DTOs, source authority, application evidence, transactional memory CAS/version migration and separate current-turn/owner-control paths. Natural admission uses a bounded direct unquoted cue plus a host-located verbatim value in the canonical current user input; model semantic selection is explicitly model-dependent, not owner-confirmed. The M1 natural case and a no-key direct request remain positive gates. No paid classifier, model-computed Unicode offsets, new confirmation framework or cross-store persona command saga is added.

Existing EXCLUSIVE writer locking protects the explicit offline migration; normal startup does not silently upgrade v1. Active forgetting retains history/logs/backups. These are the selected narrow scope and disclosed limits, not unresolved product decisions. The user's ordered continuation and repeated explicit continuation cover this child. Parent reviewed artifacts before activation. GPT owns backend/shared contracts/state/Harness; DeepSeek owns web+desktop UI after actual-type handoff; parent coordinates QA/migration evidence and stage records.

Final evidence: the [single QA report](../../../qa/fixtures/companion-persona-memory/acceptance.md) maps each scenario to these criteria and preserves actual layer/build limits. All owned instances are closed; original4120 and original data remain untouched.

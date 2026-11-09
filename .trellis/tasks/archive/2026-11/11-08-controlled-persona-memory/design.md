# Controlled persona and memory: design

Planning design, 2026-11-09; product code and task activation remain with the parent. [PRD](prd.md) owns requirements, [implementation-contract](implementation-contract.md) is the sole exact type/API/port/limit definition, and [implement](implement.md) owns execution/file boundaries. Source research is [backend](../../../11-06-unified-companion-architecture/research/controlled-persona-memory.md) and [actual UI consumers](research/persona-memory-ux.md); [QA plan](research/acceptance-plan.md) owns the eight acceptance scenarios.

## Decision

Use the existing core Config for name/persona and the existing SQLite provider for active facts. One continuing Agent and the same independent work/history survive changes. The service owns saved truth; foreground application is a separate acknowledged fact. Main remains the only desktop snapshot/SSE owner. No memory database, vector store, semantic classifier, generic approval/parser framework or new client authority.

“Forget” removes an active fact, not transcripts/logs/backups. Retained historical language is not an instruction to save again. Current key/value and quota behavior remains visible; accepted active values must reach the model in full, without the adapter's present fact clipping.

## Persona path

[Config already contains both fields](../../../../../packages/companion-runtime/src/core-plugin.ts#L45), and [profile reads](../../../../../apps/companion-service/src/server.ts#L318) already expose its revision. Add a fixed owner CAS write and an application view. Reuse ConfigService read/save/readback; do not add commandId or copy profile intent into SQLite merely to simulate atomicity across stores.

The [current service factory](../../../../../apps/companion-service/src/service.ts#L224) reads persona only when activating the Harness; the adapter captures options. Therefore a prefix-only/internal stopForeground reset cannot apply newly saved persona options. Owner-form edits enter the existing [idle control](../../../../../packages/companion-runtime/src/runtime.ts#L124), really retire/drain the selected foreground, save through the canonical CAS owner, then activate from fresh canonical Config.

Busy/queued/checking returns conflict with the draft intact; no automatic cancellation or hidden pending queue. Preserve model connector and healthy credentials, execution/state providers, task handles and worker effects. A known save followed by activation/readback failure stays saved and is shown not applied/unavailable. A network-uncertain save is resolved by current readback and captured CAS, not by inventing a historical receipt or restoring an older revision.

Application metadata is volatile evidence of the active consuming adapter, not another Config authority. Native private acknowledgements are owner/generation-bound and reflect actual installed contents/context. A ready status or a copied saved revision alone proves nothing. Launch overrides stay visible as operator process policy; the implementation must not modify a deployment/profile file to make restart tests pass.

## Active memory and durable effects

Extend existing facts/identity/commands/events, not storage ownership. State mutation plus its memory counter, provenance, receipt and event commit together in the current synchronous transaction. The dedicated memory read is bounded; normal clients derive the same view from existing snapshot facts plus management metadata, avoiding two canonical arrays.

Owner forms use the same idle/drain/rebuild boundary as persona. Inference-turn remember is different: it writes using its captured admission, then installs fresh canonical context in that same current generation. It must never acquire an idle control that waits for or stops itself. A failure to refresh after commit does not undo the fact or receipt; it exposes application failure and fences unsafe continued generation.

A required fact-set baseline closes deletion/recreation ABA and avoids invalidating forms for unrelated chat/task events. The row baseline additionally protects the exact displayed fact/forget confirmation. Counter changes only on a new accepted memory effect. An unchanged command replay returns its actual prior receipt plus current view, never recreating a missing row; changing payload under the same id conflicts.

Legacy receipts cannot be rehashed with newly added fields and treated as unknown. Recognize exact legacy retry payloads only for readonly fingerprint lookup. No existing record means no write authority. A legacy duplicate can acknowledge the real prior effect while its old fact is absent; unknown historical fact-set revision stays unknown. This branch is bounded ledger replay, not support for fresh blind legacy writes.

## Natural request authority and its limits

The previous research's rigid grammar was provisional and is superseded. [M1 accepted a natural request](../../../../../qa/probes/companion-model-live.mjs#L164) with a preference and optional label suggestion, rather than a whole-message key command. Preserve that exact case and ordinary direct requests without a key, using the parent's bounded top-level cue approach.

Comparison: current adapter checks a current kind=user input but permits arbitrary key/value; a strict command parser would break accepted conversation behavior. The selected middle boundary binds a canonical accepted user message, direct unquoted cue, captured baseline and actual source generation, then locates the tool value verbatim in that message. The model supplies no owner/explicit flag or Unicode offsets.

This proves identity, correlation, literal supplied value, version and effect admission. It does not prove all natural-language semantics: which fact and label were intended, or whether a selection stripped a qualification, still depends on model understanding and instructions. Provenance therefore distinguishes owner form from user-input-mediated-by-assistant and unknown legacy data. Model-generated or unrelated values cannot become owner-confirmed facts by claiming to be explicit.

A small finite cue boundary is sufficient for the preserved case; do not hardcode it, build a grammar for all Chinese/English or call another paid classifier. Quoted examples and work results have no independent authority; quoted literal values under a real direct request remain valid. Nonexplicit suggestions remain drafts. The exact cue, scalar and identity rules are defined once in the contract, with explicit adversarial/positive controlled fixtures.

Central runtime admissions are temporary permission metadata for existing current messages, not a history database or scheduler. Their lifetime follows input completion/source retirement; their revision never silently advances to a later memory view. The existing current-round/eligible checks remain an independent constraint. All normal writes—including old runtime seeds and alternate adapter ports—must converge on the same central mutation policy.

## Context and ongoing work

[The existing adapter](../../../../../plugins/harness-cortico/src/harness.mjs#L343) fences generations and uses fresh private projection directories. Keep that mechanism. Canonical facts remain authoritative; history is labeled historical and cannot authorize tool effects. Owner correction/forget reconstructs the private foreground tail, while current-turn remember refreshes it at a safe tool return boundary.

Independent work is not a foreground Session. [Runtime result handling](../../../../../packages/companion-runtime/src/runtime.ts#L567) still commits outcome/notice while Harness delivery is quiesced; new context/clients can observe those facts. Do not rerun code or duplicate an announcement to recover a UI. Actual reply delivery versus durable task completion remains distinct in evidence.

## Data-format rollout and rollback

No table/column addition is necessary; persistent memory metadata fits existing JSON bodies. A new data-format fence is necessary because the old writer would ignore it. The new startup must not silently mutate an arbitrary v1 root. One explicit offline migration uses the real existing SQLite exclusive writer lock—no PID/lease substitute.

While that lock is held, backup the whole protected root before any version/data mutation. Perform only documented format changes in one transaction, retaining original id/epoch, facts/receipts/history/tasks/artifacts. Do not relabel nonterminal rows as complete or start/kill/reconcile their workers during migration. Operator maintenance shutdown/drain is a real precondition; a row label is not physical-process evidence.

Use only synthetic v1 fixtures, constructed independently of the new provider. Interrupted backup/upgrade must preserve a usable original/restore path; the old writer must reject the new format. Downgrade restores a stopped full-root backup checkpoint rather than letting old code write upgraded data or pretending post-backup changes were retained. Actual trial data/keys and the stopped original service remain outside development.

## Consumer decisions and handoff

The four [UX questions](research/persona-memory-ux.md#L90) are resolved in the contract:

- snapshot keeps its existing facts array plus a separate memory management/status object; GET memory is deliberate read/recovery, not a parallel global owner;
- origin is an additive fact field, normalized unknown for legacy records;
- profile reads and save results include service-reported saved/application facts; only a real consuming adapter can acknowledge applied state;
- forget carries both rendered row and set baselines plus its command id, so concurrent correction conflicts.

Desktop service identity/memory stay on its existing persona page; local presentation remains separate below. Web adds a compact section/dialog without a new route/shell/window. Forms retain captured target and baselines, fence late results, and distinguish pending/saved/application error. Preserve transparent pet CSS and unmounted legacy material; no broad renderer cleanup or compatibility DTO shim.

GPT publishes real types/protocol/private seams first and owns all state/Harness/authority changes. DeepSeek then owns desktop/web UI and frontend tests against those declarations. Parent owns migration/native/root integration and Trellis bookkeeping. The plan fixes file ownership and references the single QA plan rather than duplicating an acceptance catalog.

## Remaining decisions

No new product choice blocks implementation: the parent accepted bounded no-confirm natural admission with honest model-dependent semantics, and the PRD already defines active forgetting versus erasure. Exact methods, revisions, roles, errors and budgets are frozen in the contract. A future request for absolute semantic intent proof or transcript/backup erasure would change that scope; it is not silently implemented or required here.

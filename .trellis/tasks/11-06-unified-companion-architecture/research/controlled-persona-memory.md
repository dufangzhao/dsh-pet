# Controlled persona and explicit memory: next-stage research

Read-only research, 2026-11-08. Product/dist remain frozen; this report creates no task and changes no implementation. Stage order is already authorized by [R20](../prd.md#L31); M2 native closure remains the parent's responsibility.

## Recommended MVP

Let the authenticated private owner view/edit the service name and persona, and view/add/correct/forget explicitly supplied facts from web and desktop. Keep one Agent id, canonical history, existing workers and their artifacts. Use the existing ConfigService, SQLite state plugin and Harness lifecycle; no memory database, vector platform, automatic extraction, file crawl or new framework.

Terminology follows [CONTEXT](../../../../CONTEXT.md#L115) and [ADR-0015](../../../../docs/adr/0015-independent-continuous-agent-runtime.md#L15) / [ADR-0016](../../../../docs/adr/0016-cloud-service-and-pluggable-features.md#L19): persona is configuration; active facts are accepted memory; history is retained evidence; Cortico context is a disposable projection. A model tool is a delivery mechanism, not an independent authority to infer/store preferences.

Default “forget” means remove a fact from active memory/application, not erase all transcripts, private logs or backups. Show that distinction at the action; preserve history as required. Do not claim semantic amnesia merely because a model omits an old value in one answer.

## Actual sources and gaps

| Area | Current source-backed behavior | Smallest needed extension |
| --- | --- | --- |
| Canonical persona | [core Config](../../../../packages/companion-runtime/src/core-plugin.ts#L45) owns name/persona; [runtime.profile](../../../../packages/companion-runtime/src/runtime.ts#L208) returns its Config revision. Name≤80/persona≤16384 code points; [Config value budget](../../../../packages/host-kernel/src/config/schema.ts#L11) is48KiB. | Owner-only CAS patch of these two fields, preserving mode/model/Harness/disabled fields. No new persona store/schema. |
| Persona application | [service factory](../../../../apps/companion-service/src/service.ts#L224) reads profile at Harness activation; [Harness options](../../../../plugins/harness-cortico/src/harness.mjs#L57) are captured, and systemSegments closes over them. | Recreate the selected foreground Harness from the new profile; stopForeground alone rebuilds with the old captured options. |
| Existing reads | [GET profile/snapshot](../../../../apps/companion-service/src/server.ts#L308) expose saved identity/revision; [profile DTO](../../../../packages/contracts/src/companion-profile.ts) is read-only. | Add mutation plus saved/applied/error facts; saved Config revision currently does not prove applied persona. |
| Facts | [fact DTO](../../../../packages/contracts/src/companion.ts#L53) has key/value/revision/time only. [SQLite v1](../../../../plugins/state-sqlite/src/state.ts#L91) stores facts as key+JSON body and has commands/events/identity already. | Required memory-set CAS, explicit forget, host-derived provenance; retain the same state provider/tables. |
| Fact writes | [rememberFact](../../../../plugins/state-sqlite/src/state.ts#L518) supports optional expectedRevision and atomic fact/receipt/event; omitting it is blind upsert. [public DTO](../../../../packages/contracts/src/companion.ts#L139) omits that field; HTTP passes through to state. | Make new-write baselines explicit and required. Do not preserve blind-write fallback as “compatibility.” |
| Current limits | [state types](../../../../plugins/state-sqlite/src/types.ts#L117):32 facts and8KiB aggregate, complete in snapshots; [validation](../../../../plugins/state-sqlite/src/validation.ts#L172): key128/value2048 UTF-16 units. | Keep limits visible; no pagination/search engine needed. Existing facts must not disappear merely to fit a projection. |
| Model write authority | [instructions](../../../../plugins/harness-cortico/src/harness.mjs#L8) require explicit facts, but the remember handler checks only current kind=user and forwards caller key/value. [runtime port](../../../../packages/companion-runtime/src/runtime.ts#L704) supplies no CAS or intent proof. | Enforce current explicit user intent centrally; a prompt rule/current user input alone does not prove permission to remember arbitrary inferred content. |
| Existing surfaces | [desktop persona page](../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L35) reads persona on demand and edits only local presentation. [web App](../../../../plugins/text-client/src/client/app.tsx#L43) offers model/tasks, not a memory manager. | Add one compact persona/memory surface to both clients, using the same service APIs and target fences. |

## Minimal implementation slices

1. **Persona read/edit/apply.** Extend the existing GET profile view and add a fixed owner POST profile command: commandId, expectedProfileRevision, name/persona. Reuse ConfigService CAS, current validators and the existing service control boundary. Preserve Agent id and unrelated Config fields; expose saved revision separately from actual applied revision/error.
2. **Explicit memory management.** Add a small authenticated memory read view containing active facts and memoryRevision; add fixed upsert/forget commands with commandId and captured expectedMemoryRevision. Each mutation returns its real receipt/current view. Editing a value is enough; renaming keys can remain explicit add+forget rather than a second atomic batch API.
3. **Safe projection application.** At an idle supported foreground boundary, fence/retire and actually drain the selected Harness, commit the requested owner mutation, then activate from canonical profile/facts. Reuse [withModelControl](../../../../packages/companion-runtime/src/runtime.ts#L124), retireForeground and activateForeground; do not retire the model connector/key, state provider or independent workers.
4. **Two clients, one form baseline.** Add owner forms/explicit forget action to web and desktop. Keep unsaved drafts/CAS baseline on external changes, mark stale content and offer deliberate re-read. Command responses stay local to their operation; the shared snapshot/read owner supplies global state. No automatic model test/inference on save, refresh or reconnect.

The idle retirement path above is for owner-form mutations. A verified current-turn remember tool must **not** enter withModelControl or stop its own Core: commit through the same revisioned state mutation, then guard and refresh that generation's canonical context before the next model round. If that refresh fails after commit, preserve the real saved receipt/state and report foreground application failure; do not claim the fact was never saved.

Busy inference/pending input/model check yields a clear conflict for owner forms with the draft retained; no hidden queue or implicit interruption is needed for this MVP. Ongoing independent work is allowed: [startTask](../../../../packages/companion-runtime/src/runtime.ts#L423) is not blocked by Harness-only quiescing. [Work completion](../../../../packages/companion-runtime/src/runtime.ts#L567) still commits canonical outcome/notice while foreground delivery is gated, so the rebuilt context can see it without rerunning work.

## Revision, origin and receipts

Use two existing responsibilities: global core Config revision for persona, and one persistent **memoryRevision** for the active fact set. Do not use Main-local projection revision or a model Session as either baseline. Model connection changes already share core Config revision, so a conflicting model save is a legitimate profile CAS conflict.

For facts, keep the useful per-key revision/time, but require a captured fact-set revision for every new write. Increment memoryRevision only on fact mutation, not on chat/task events, so unrelated workers do not make every form stale. A single scalar can live in the existing identity JSON body; initialization/migration must preserve assistantId and epoch.

Agent name/persona continue to come from Config; a fact named “agent.name” cannot mutate identity/config or grant tool permissions. Conflicting remembered user facts need explicit correction rather than inferred merging.

Provenance is host-derived: `owner-form` for authenticated settings actions, `explicit-user-input` plus canonical inputId for verified “remember” intent, and `legacy-unknown` for old rows. Owner and conversation user here are the same authorized private human, not new accounts. The model may propose wording; “model” is not evidence that an inferred/private preference was authorized. Never accept actor/owner/plugin authority from a model- or browser-supplied string.

Persist current provenance with the fact body; add operation/revision/origin references to fact events without copying full forgotten values into new audit events. Do not infer historical authorship from existing hashes or call old rows owner-confirmed. Existing command fingerprints/receipts and history remain retained evidence, not active fact authority.

SQLite mutations can commit fact change/deletion, memoryRevision, command receipt and event in the same [existing transaction](../../../../plugins/state-sqlite/src/state.ts#L188). Same commandId/same payload is duplicate; changed payload conflicts. Duplicate old writes after forget must return their receipt/current state without recreating the row; current code instead errors when the remembered row is absent.

Profile Config CAS and SQLite command ledger are separate commits. Reuse the [model-control precedent](../../../../apps/companion-service/src/model-controller.ts#L394), not a distributed transaction framework: a receipt acknowledges intent, saved Config is its own fact, and applied persona is reported only after successful foreground activation. Post-CAS ledger/reload failure must retain the saved profile/revision with an application error. Retry of an older command must never restore old fields over a later revision.

## Delete/correction proof: no speculative tombstone layer

Three actual resurrection risks require explicit treatment:

- **ABA:** v1 fact revision is `(previous?.revision ?? 0)+1`. Delete key at rev1, recreate it at rev1, then an old UI update expecting rev1 can pass. Required global memoryRevision prevents that stale edit even when the row is physically removed; per-key tombstones are not necessary if all write paths obey this counter.
- **Old command:** [duplicate lookup](../../../../plugins/state-sqlite/src/state.ts#L523) precedes CAS, but assumes a current row exists. Preserve the command's accepted identity while allowing current fact=null/current view; do not replay the old value. No command-ledger pruning is needed here.
- **Old model projection/callback:** refresh from canonical facts and fence retired generations; an old captured memory revision/intent cannot write after correction/forget. A newer user explicitly adding the key again is a new authorized action, not resurrection.

The implementation must close every blind-upsert path, including HTTP, Harness and alternate adapter ports. Otherwise a memoryRevision column alone proves nothing. If the child chooses per-key-only CAS instead, it must preserve a durable high-water mark/tombstone to avoid ABA; that is an alternative, not another mandatory store in this recommendation.

The current adapter already [fences/drains/rebuilds generations](../../../../plugins/harness-cortico/src/harness.mjs#L343). Each build gets a fresh UUID projection directory, so it does not restore an old Core directory as canonical memory. On delivery it rereads product context; [upstream sessionHead](../../../../node_modules/cortico/src/core/loop.ts#L527) is synthesized for outbound requests, not a new primary store.

However, [reloadSystemPrefix](../../../../node_modules/cortico/src/core/loop.ts#L1756) explicitly retains prior user/assistant/tool tail. Rebuilding the foreground clears that stale private tail and reads canonical state. Retained product history can still mention a past preference: label it historical/non-authoritative and never use it as a new remember command. “Forgot active fact” does not mean deletion from history/backups or an assurance the model cannot recount past text.

Also remove silent fact-value truncation when assembling authoritative active memory: current [projectedContext](../../../../plugins/harness-cortico/src/harness.mjs#L32) slices values to512 units even though state accepts2048. The bounded8KiB active set can be supplied completely; if a future provider cannot fit it, report limits explicitly rather than claim the clipped value is the saved fact.

## Model-facing tools and explicit intent

Default: retain the current `remember(inputId,key,value)` name/shape, but bind it to a host-verified current memory intent and captured memoryRevision; owner forms use direct commands. Do not add model tools for arbitrary persona edits or destructive forgetting in this slice.

Reuse the [existing scripted explicit grammar](../../../../plugins/harness-cortico/src/scripted.mjs#L86) as a single ingress rule: `记住 key: value` / `remember key: value`, plus the existing literal free-form “记住 …” mapping to `explicit-preference`. Record the actual supplied value; do not allow the model to invent another key/value under an unrelated current input. Other natural-language suggestions can be shown as editable drafts, becoming facts only when the owner saves them.

Capture intent/baseline against the canonical admitted user message, not by rereading a newer fact revision when a delayed tool executes. Pass a trusted optional memory-intent reference through Harness input/ports, validate matching input/key/value server-side, and derive one stable effect id for that user intent. Work-result events/quoted history/old Session content never authorize memory writes; duplicate tool calls cannot apply the intent twice.

`agent-experience` and `domain-modeling` were loaded for this research; glossary/ADRs were read but not modified. The child should reuse them when changing tool descriptions, input schemas and context policy: describe explicit-save behavior once, put bounds on parameters, return bounded receipts/current revision, and measure prompt-token change. Update [boundary schemas](../../../../plugins/harness-cortico/src/boundary.mjs#L50), trusted Harness types/ports, scripted peer and instruction tests together; no caller-supplied source/permission field should be added to the model tool.

## API/data-format changes actually needed

- Keep GET profile and snapshot; add owner profile mutation and fixed memory read/upsert/forget routes under existing bearer/origin/no-store admission. Extend shared DTOs, protocol guards and frozen desktop methods; no renderer networking or generic RPC.
- Snapshot already contains all active facts, but needs memoryRevision/provenance metadata (or the dedicated memory view on older peers). An absent revision on an old service is unsupported editing, not an invented zero/CAS fallback. GET memory can remain a bounded complete view of the existing8KiB fact set with explicit metadata headroom; retain the existing64KiB wire/80KiB Main aggregate ceilings. No new search/pagination API is needed.
- State adds forget plus required memory CAS/origin plumbing. New methods need the existing manifest method-permission declarations; use the same ordinary state plugin capability/lifecycle, not a second memory service.
- No table/column addition is intrinsically required: identity/facts/commands/events already store extensible JSON. A transactional **v1→v2 data-format migration/version fence is justified**, because an old v1 writer ignores the new counter/provenance and can reintroduce blind writes. Initialize the counter, represent missing legacy origin as unknown, and preserve every original fact value/revision/time and identity/work/history record. Legacy rows can project an unknown default without bulk rewriting them; added metadata must not silently evict a previously valid near-quota fact set.
- Do not edit an open SQLite file externally or erase private projection/history directories to “fix” memory. Cold backup the whole existing service data root before migration at a maintenance boundary with no active work; do not cancel jobs just to manufacture a clean upgrade. Daily profile/memory edits do not restart the service. Old code must refuse the newer format. Downgrade uses stopped-service backup restore, not running the old writer against upgraded state.
- Name/persona Config schema already suffices. Explicit [COMPANION_NAME/PERSONA launch overrides](../../../../apps/companion-service/src/main.ts#L33) currently overwrite saved values at boot; keep them only as clearly declared operator overrides and remove stale launch values for UI-edit/restart acceptance. Do not silently change deployment/profile files during this child.

## Minimum acceptance and ownership split

| Controlled scenario | Required assertion |
| --- | --- |
| Web edits persona, desktop has stale draft | Same agentId; updated saved/applied revision on both, stale CAS conflicts without losing draft; local appearance/persona archives untouched. |
| Save succeeds, activation/ledger step fails | GET profile retains saved values/revision; UI says saved but unavailable/not applied; retry cannot roll back a newer edit. |
| Explicit fact create/correct/forget + restart/reconnect | Both surfaces agree on full active set, provenance and memoryRevision; no new identity or historical-work mutation. |
| Delete/recreate + delayed old UI/model write | Old memoryRevision conflicts; captured old context/tool cannot recreate the forgotten value; fresh explicit re-add can succeed. |
| Duplicate pre-forget command + dropped receipt | Duplicate receipt/current view, no row resurrection or fabricated new receipt; changed payload conflicts. |
| “Hello”, quoted “remember …”, work-result, inferred private trait | No new canonical fact. Exact current explicit intent succeeds; unsupported/free suggestions require owner save. |
| Worker completes while profile/memory changes | Task/result/artifact ids and canonical notice survive; no replayed execution or lost result; actual foreground drain failure blocks replacement. |
| Existing v1 fixture + migration/rollback boundary | Original identity/facts/history/receipts preserved, legacy origin unknown, old writer rejects v2; backup restore is reproducible. |

Use a controlled Responses peer to inspect actual prompt/persona/active facts, delay tool calls and force lifecycle/persistence failures; no live model call is necessary. Retain existing SQLite/recovery/Core tests, then serial web/desktop integration on the actual supported platform. Inspect labeled active facts rather than claiming a total-erasure pass from an entire prompt containing retained historical text.

**GPT backend exclusively:** contracts/profile-memory DTOs; service routes/controller; runtime control/ports; state types/validation/mutation/migration/manifest/tests; Harness boundary/instructions/context/scripted/types/tests; protocol exports; desktop Main/preload declarations/commands. Freeze real types first, then frontend handoff.
**DeepSeek frontend exclusively:** desktop persona/memory form and shared hooks, web persona/memory components/App integration/scoped styles/front tests; preserve form baselines, target-generation fences and local preference separation. Coordinate text-client shared export/build files with GPT; no concurrent parser/schema edits.
**Parent:** child planning/curated context, QA fixtures/native/root gates, docs/spec/evidence/commits/archive after M2 closure. This report authorizes no execution or reopening of the original4120 service.

Only potentially user-owned scope distinction: if “forget” must erase transcripts/logs/backups as well, that requires an explicit separate erasure policy and retention scope. The MVP above defaults to visible active-fact removal and preserved history; no new approval question blocks preparing this already authorized next child. Public/private multi-platform visibility remains a later platform decision, not a reason to add multiuser ACL machinery here.

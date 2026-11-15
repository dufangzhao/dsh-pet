# Controlled persona and active memory contracts

## 1. Scope / trigger

Use when changing persona saves, fact management, natural remember admission, canonical context application or SQLite format upgrades.
The service owns one Agent identity, core Config, accepted memory, history and work. Clients hold projections/forms; the Harness holds disposable context.
Read [service contracts](companion-service.md), [model authority](model-connections.md) and [desktop boundary](desktop-companion.md) for unchanged ownership/lifecycle rules.
“Forget” removes an active fact/application, not transcripts, logs or backups. Do not claim semantic amnesia from one answer.
Reuse the existing providers, control boundary and SQL ledger; no second memory database, generic parser/approval system or profile transaction saga.

## 2. Signatures

Canonical declarations belong in source; this spec does not reproduce the task's DTO catalog.

| Boundary | Actual signature / source |
| --- | --- |
| Public persona | [companion-profile.ts](../../../packages/contracts/src/companion-profile.ts): `CompanionProfileSaveCommand`, `CompanionProfileView.management` |
| Public memory/application/origin | [companion-memory.ts](../../../packages/contracts/src/companion-memory.ts): status/view/upsert/forget/mutation result and constants |
| Runtime owner methods | [runtime.ts](../../../packages/companion-runtime/src/runtime.ts): `profileView()`, `savePersona(input)`, `memoryView()`, `upsertFact(input)`, `forgetFact(input)` |
| Internal state | [types.ts](../../../plugins/state-sqlite/src/types.ts): `memorySnapshot`, revisioned `rememberFact`, `forgetFact`; actual [writer](../../../plugins/state-sqlite/src/state.ts) |
| Native context/lifetime | [harness.d.mts](../../../plugins/harness-cortico/src/harness.d.mts): `HarnessProductContext`, `HarnessProfileBinding`, `projectionApplied`, `projectionFailed`, `finishInputs` |
| Explicit offline upgrade | [migrate.ts](../../../apps/companion-service/src/migrate.ts#L36): `migrateCompanionData({dataDirectory,backupDirectory})` returns version/id/epoch/revision/backup report |
| Native/browser transport | [fixed bridge](../../../packages/contracts/src/desktop-companion.ts), [HTTP helpers](../../../plugins/text-client/src/client/protocol.ts), [closed Main dispatcher](../../../apps/desktop/src/main/companion-client-request.ts) |

[HTTP routes](../../../apps/companion-service/src/server.ts) retain bearer/origin/no-store admission and bounded Result envelopes:

| Route | Body / success |
| --- | --- |
| GET /api/profile | `Result<CompanionProfileView>` with actual saved revision/management |
| POST /api/profile | Profile save command;200 profile view, no commandId/SQL receipt |
| GET /api/memory | `Result<CompanionMemoryView>` |
| POST /api/facts | Closed upsert command;200 mutation result; narrowly recognized old retry is readonly |
| POST /api/facts/forget | Closed forget command;200 mutation result |

## 3. Contracts

**Saved, applied and deliberate disable**

- Persona save patches only name/persona into the current Config CAS record, preserving id, model/Harness selection and unrelated fields.
- Profile revision is the whole core Config revision; it is neither memory revision nor Main projection/endpoint Config revision.
- Validate and enter existing idle control. Busy/queued/checking conflicts; a form save does not cancel the current turn.
- [ownerForeground](../../../packages/companion-runtime/src/runtime.ts) captures actual active + desired state and the existing disabled ledger. Only a previously active/wanted source is retired/recreated.
- Disabled Harness data can be saved with applied=null/not-ready; editing data is not an enable request. Keep healthy connector/key, state provider and workers alive.
- [savePersona](../../../packages/companion-runtime/src/runtime.ts) captures actual saved fields/revision before fallible application/readback. Precommit failure preserves Config; postcommit failure keeps saved truth and reports application error.
- Network-uncertain profile save uses readback/captured CAS; matching current contents do not manufacture a historical receipt.
- [harnessPorts(source,profile)](../../../packages/companion-runtime/src/runtime.ts) requires the real factory descriptor. Wrappers must forward both arguments; never guess a missing binding.
- Private applied acknowledgements follow actual Core start/context installation, checked source generation and issued memory revision. Ready alone or copied saved revision is insufficient.
- Bootstrap acknowledgement may be retained while activating; only an actually active consuming owner exposes application. Matching captured persona contents can acknowledge the current Config revision; unsupported adapters cannot claim consumption.
- Launch `COMPANION_NAME`/`COMPANION_PERSONA` overrides remain visible through management flags and can overwrite saved values on restart; do not edit deployment files silently.

**Facts, versions and replay**

- Snapshot keeps one scope-filtered `facts` array plus optional `memory` status; protected GET memory is deliberate management/read recovery, not a model input grant. Format3 row identity is `(audience,key)`, so owner/public same-key rows are valid. Optional command `audience` selects an explicit protected management scope; missing legacy scope remains owner-private without inserting a new field into the original command fingerprint. Command views are form-local, not global snapshot replacements.
- Memory-set revision changes only on a successful new fact effect. New upserts use the next set revision as row revision; create expects row0, correction/forget the displayed positive row revision.
- Both captured set and row baselines are required. A stale forget confirmation cannot remove a newly corrected/recreated row; no automatic rebase of an unknown intent.
- [The SQL transaction](../../../plugins/state-sqlite/src/state.ts) checks duplicate fingerprint before CAS, then changes row/counter/receipt/event atomically. Quota/CAS failures roll back all of them.
- New command bodies store `{receipt,committedRevision}`; generic reads unwrap these and retain old flat receipt support. Reserved mutation kinds cannot be minted by recordCommand alone.
- A duplicate returns its actual original receipt/commit revision plus current view, even when its old row is absent. Changed operation/payload/origin under the id conflicts; no resurrection/new event.
- Exact pre-v2 `{commandId,key,value,expectedRevision?}` retries use their original `kind:fact` fingerprint, without adding new fields first. Known returns duplicate/current truth with committedRevision=null; unknown cannot become a new blind write.
- Origin is host-derived owner-form/user-input or projected legacy-unknown. Store canonical input/evidence references, not a model's owner/explicit assertion; fact events store key/operation/revisions, not copied values.
- Required set CAS and monotonic revision close delete/recreate ABA without tombstone storage. Full history and existing work/receipt identities remain retained.

**Current user admission and projection**

- [message](../../../packages/companion-runtime/src/runtime.ts) checks interaction availability before and after the awaited exact original message ledger lookup, ahead of new admission capacity. Same known intent needs no slot/event; changed payload conflicts, new full-capacity intent fails quota.
- [memoryCue](../../../packages/companion-runtime/src/persona-memory.ts) recognizes finite top-level Chinese 请记住/记住/请记下/记下 or English please remember/remember, with its documented whitespace/word boundary.
- This admits the actual natural M1 request and no-key requests, not a whole-message key command. Quoted-only instructions, negative prefixes, unrelated input and work-result kind gain no independent authority; quoted values under a direct request remain valid.
- Private ephemeral memory-evidence admissions bind canonical current text, source owner/generation, captured set/row baseline and cue position alongside the durable input admission. [M6](qq-platform-entry.md#admission-context-and-physical-work) also checks captured owner/admin role; current material/quoted-note metadata is not authored cue text. Host finds the candidate value verbatim after the cue and records UTF-16 evidence offsets; models compute no offsets.
- Host proves correlation, literal supplied span, version/authority and effect admission. Choosing semantic scope/key/qualification still depends on the model; substring grounding does not prove complete natural-language intent.
- The model tool remains inputId/key/value, with no owner/explicit flag. Nonverbatim values fail; key is a mechanism label and is not owner-confirmed authorship.
- Current-turn remember commits through the same writer without acquiring idle control or stopping itself, then [refreshes canonical context](../../../plugins/harness-cortico/src/harness.mjs) before the next inference.
- Refresh failure preserves the committed fact/receipt and reports failure for the latest canonical memory revision, including when the read failed before issuing that revision to the context. Successful application still requires the exact issued read/ack. A retired generation cannot publish a replacement's acknowledgement/reply.
- eligible IDs enter only on delivered events; onTurnEnded passes those IDs to finishInputs. Release only the supplied owner's IDs, preserving queued/undelivered admissions. Retirement clears the old owner's remainder.
- Owner correction/forget uses actual drain/reconstruction. A bound input installs complete values only for its visible audience plus public facts; a management view/global memory revision does not authorize other private facts. Historical transcript and private tails are never replayed as new effects.

**Format and bounds**

- Fresh/current stores use user_version3; normal opening of1/2 is not-ready and unknown versions conflict. [Canonical M6 migration/scope contracts](qq-platform-entry.md#canonical-identity-visibility-and-migration) extend the cold path; no automatic trial-root migration.
- [openStateDatabase](../../../plugins/state-sqlite/src/database.ts) is the shared DELETE-journal/EXCLUSIVE/synchronous FULL/BEGIN EXCLUSIVE writer boundary, retained across commits. No PID/lease substitute.
- Offline migration validates the real old table/column shape, foreign keys and fact bounds while holding that lock. Caller must stop/drain physical service/work; task status labels do not prove that.
- Create a new protected external nonoverlapping full-root backup; preserve symlinks verbatim, verify file hashes/entries and unchanged source inventory before any database/version mutation.
- The cold transaction initializes the v1 memory counter when necessary, then performs the format2→3 scope upgrade. It preserves id/epoch, command fingerprints and original receipts/task/execution/artifact identities; old rows gain owner-private legacy provenance without relabeling physical task outcomes or launching/reconciling work.
- Closing an uncommitted failed upgrade rolls it back. Failed backup is not a verified restore point; an older writer refuses format3. Downgrade uses stopped full-root checkpoint restore, not an old writer on upgraded data.
- [Constants](../../../packages/contracts/src/companion-memory.ts):32 facts/32 live memory admissions; key128/value2048 UTF-16 units. Legacy four-field data has8192 UTF-8 bytes; origin has separate8192-byte headroom, preventing metadata-driven eviction.
- Name/persona keep80/16384 code points plus48KiB Config; wire64KiB, state60KiB allocation and Main80KiB remain separate. Reserve management metadata before the single state projector; never clip accepted facts.
- [Guards](../../../plugins/text-client/src/client/guards.ts) validate usage against actual facts, unique `(audience,key)` identities, revision ordering and canonical agent/input ID grammar. Missing management means readonly; malformed present metadata is not absence or invented revision0.

## 4. Validation & error matrix

| Boundary / condition | Actual required outcome |
| --- | --- |
| HTTP token/origin/closed request | auth-failed401 / permission-denied403 / invalid-input400; no mutation |
| Stale profile/set/row, busy owner control, changed id payload | conflict409; preserve draft/canonical data |
| Known message while all memory slots used | Real duplicate, unchanged capacity/events; only a new input gets quota-exceeded413 |
| Host remember without admitted current user/source or nonverbatim value | KernelFault permission-denied; no SQL effect |
| Cortico wrong current input/work-result/schema | Native TypeError/tool-error before host dispatch; do not claim a fixed permission-denied receipt |
| Owner mutation committed, later apply/readback fails | HTTP200 retains saved fields/receipt with application error; precommit not-ready/unavailable is503 |
| Disabled source edited / actual drain unconfirmed | Save without enable / no replacement or new mutation after failed drain |
| Valid legacy duplicate / unknown legacy body | Prior receipt/current view with null commit revision / refusal, never blind write |
| Unsafe backup target, open writer, bad format or interrupted upgrade | Refuse/rollback with original preserved; no version-first upgrade |
| Bad identity, usage, application counter or malformed present metadata | Client unavailable/uncertain; no partial or empty-success projection |

Fixed KernelError/HTTP mapping applies to public/runtime/state boundaries; native tool prevalidation retains its real exception layer. Reuse existing error types rather than invent a wrapper merely to equalize these layers.

## 5. Good / base / bad cases

- **Base:** connected clients read canonical identity/facts; inactive Harness management is not a request to enable it.
- **Good:** Config save fails before commit and original application restores; later readback failure retains actual new saved fields/revision.
- **Good:** forget/recreate races an old draft or old model call; captured baselines/source fences reject it and the old receipt cannot recreate data.
- **Good:** actual direct natural request supplies a quoted literal preference; host evidence points at that literal, not a model-asserted authority flag.
- **Bad:** use saved revision as applied, acquire idle control inside remember, clear all owner admissions on every turn, or charge new origin against legacy data quota.

## 6. Tests required

- [Service persona/memory tests](../../../apps/companion-service/src/persona-memory.test.ts): real Config/Harness/HTTP, unchanged Agent/connector, complete long value, deliberate disable, Config precommit failure, postcommit activation/readback failure and zero settings inference.
- The same tests drive exact M1/no-key/quoted-literal positives, unrelated/quoted/negative/invented negatives, direct host permission refusal, delivered-A/queued-B lifetime and postcommit context failure with retained saved fact.
- Its full-capacity test holds a native round and fills all admissions: exact retry duplicates, changed retry conflicts, new intent quotas; messages/cursor remain unchanged.
- [State tests](../../../plugins/state-sqlite/src/state.test.ts) assert atomic quotas/CAS, delete/recreate ABA, old receipt with missing row, no repeated event and snapshot facts retained under byte budget.
- [Migration unit](../../../apps/companion-service/src/migrate.test.ts) builds v1 independently, exercises the real lock, verifies backup bytes/version/id and legacy replay after deletion; this is not complete production migration acceptance.
- [Protocol tests](../../../plugins/text-client/tests/management.test.mjs) validate metadata/receipts/foreign identity and otherwise-valid invalid IDs; UUID/unavailable sentinel positives stay valid. [Main tests](../../../apps/desktop/src/main/companion-client-controller.test.ts) enforce frozen facade/current frame and console-only form writes.
- [Harness tests](../../../plugins/harness-cortico/tests/harness.test.mjs) retain real Core/effect/cancellation/native-error behavior. Pure UI/form tests and component DOM checks do not establish service/Main E2E.

Historical M1 controlled regressions do not establish current M6 completion, paid-model behavior or all-language semantics. Current scoped migration/context/media/platform results and remaining gates live in [M6 progress/evidence](../../tasks/archive/2026-11/11-12-qq-platform-entry/progress.md); production and real-platform acceptance are separate.

## 7. Wrong vs correct

```ts
// Wrong: a known persisted message can be rejected before its ledger lookup.
if (admissions.size + reservations >= limit) throw quota;
// Correct: interaction/source availability remains required, then only a new intent reserves.
const known = await state('getCommand', { commandId, kind: 'message', payload: originalCommand });
if (known) return known;
// New-intent capacity/reservation follows; acceptMessage still owns atomic dedup.
```

```ts
// Wrong: drops the real profile binding and breaks actual application on replacement.
const wrap = (original) => (source) => original(source);
// Correct: preserve the actual native port contract, including in QA gates.
const wrap = (original) => (source, profile) => original(source, profile);
```

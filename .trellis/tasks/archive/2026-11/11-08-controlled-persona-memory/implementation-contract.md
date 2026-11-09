# M3 persona/memory: exact implementation contract

Planning contract, 2026-11-09. No implementation/task activation is performed by this document. This is the sole task-local definition of new DTOs, limits, operations, authority and lifecycle. [Design](design.md) explains choices; [plan](implement.md) assigns work/checks; [PRD](prd.md) owns outcomes. The provisional command-only recommendation in [earlier research](../../../11-06-unified-companion-architecture/research/controlled-persona-memory.md#L69) is superseded by §4 below and P5.

## 1. Owners and canonical declarations

Extend `packages/contracts/src/companion-profile.ts` and add `companion-memory.ts`; export browser-safe types/constants from the existing root. Keep `CompanionSnapshot.facts` as the single fact-array projection. Do not introduce another client store or duplicate facts into snapshot.memory. State/provider DTOs remain in `plugins/state-sqlite/src/types.ts`; native ports stay host-only. [Current Config](../../../../../packages/companion-runtime/src/core-plugin.ts#L45), [state](../../../../../plugins/state-sqlite/src/state.ts#L91), [Harness types](../../../../../plugins/harness-cortico/src/harness.d.mts) and [desktop contracts](../../../../../packages/contracts/src/desktop-companion.ts) are the extension seams.

The owner is the existing bearer-authenticated private human. Web/desktop transport is not a new principal. The selected Harness is a mechanism for interpreting current user input, never an owner credential. Model persona/forget tools, public accounts and multiuser ACLs are outside this child.

## 2. Public DTOs, counters and limits

```ts
interface CompanionApplication {
  readonly appliedRevision: number | null;
  readonly error: KernelError | null;
}
// Extend existing CompanionProfileView, retaining agentId/name/persona/revision.
interface CompanionProfileManagement {
  readonly application: CompanionApplication;
  readonly launchOverrides: { readonly name: boolean; readonly persona: boolean };
}
interface CompanionProfileSaveCommand {
  readonly expectedProfileRevision: number;
  readonly name: string;
  readonly persona: string;
}
type CompanionFactOrigin =
  | { readonly kind: 'legacy-unknown' }
  | { readonly kind: 'owner-form' }
  | { readonly kind: 'user-input'; readonly inputId: string;
      readonly evidence: { readonly start: number; readonly end: number } };
interface CompanionMemoryStatus {
  readonly revision: number;
  readonly application: CompanionApplication;
  readonly usage: { readonly count: number; readonly dataBytes: number; readonly originBytes: number };
}
interface CompanionMemoryView extends CompanionMemoryStatus {
  readonly agentId: string;
  readonly facts: readonly CompanionFact[];
}
interface CompanionMemoryUpsertCommand {
  readonly commandId: string;
  readonly expectedMemoryRevision: number;
  readonly expectedFactRevision: number;
  readonly key: string;
  readonly value: string;
}
interface CompanionMemoryForgetCommand {
  readonly commandId: string;
  readonly expectedMemoryRevision: number;
  readonly expectedFactRevision: number;
  readonly key: string;
}
interface CompanionMemoryMutationResult {
  readonly receipt: CompanionCommandReceipt;
  readonly committedRevision: number | null;
  readonly view: CompanionMemoryView;
}
```

`CompanionProfileView.management?` has the exact CompanionProfileManagement shape. `CompanionFact.origin?` uses the origin union. `CompanionSnapshot.memory?` uses CompanionMemoryStatus; `CompanionAgentView.profileApplication?` uses CompanionApplication. M3 service outputs all these management fields and normalized origin on every active fact. Older peer absence means readonly/unsupported editing, never invented revision0/applied state. A malformed present field invalidates the received view/snapshot. A missing persisted legacy origin projects legacy-unknown without rewriting its value.

`CompanionProfileView.revision` / snapshot.agent.profileRevision is the existing **whole core Config revision**. Main state.revision is only local projection order; configRevision is endpoint Config. MemoryStatus.revision is the durable active-fact-set counter. Fact.revision identifies that row's last mutation. All revisions are nonnegative safe integers, except existing/live fact revision and saved profile revision are positive. Memory create uses expectedFactRevision0; correction and forget require the displayed positive row revision plus displayed memory revision. No automatic baseline advancement or counter substitution.

Canonical constants in companion-memory.ts: max facts32; key128/value2048 UTF-16 code units; data8192 UTF-8 bytes; origin metadata8192 UTF-8 bytes; live admitted memory inputs32. Data bytes are JSON.stringify of active facts projected to the legacy four fields key/value/revision/updatedAt, preserving v1 near-quota data. Origin bytes are JSON.stringify of facts.map(origin). These limits are distinct; no eviction/truncation to fit added metadata. Full active fact values go to the Harness, replacing the current512-unit fact clipping.

Profile name/persona retain existing80/16384 **code point** limits and48KiB Config value budget. All HTTP Result envelopes remain≤64KiB, state transport remains within its existing60KiB allocation, direct desktop aggregate remains≤80KiB. Snapshot aggregator reserves actual management/Result metadata before its one state projection; never double-trim fixed facts. Ordinary deadlines, target identity grammar and no-credential-echo rules remain the existing M2 contracts.

Key is case-sensitive, trimmed, nonempty; value is preserved exactly and must contain nonwhitespace text. Evidence and all string lengths use UTF-16 offsets/units where specified. Reject invalid bounds before mutation; no implicit delete from an empty value. All request objects are closed and reject extra origin/owner/explicit/application fields.

## 3. Fixed HTTP/client operations and result semantics

| Route | Request | Success value |
| --- | --- | --- |
| GET /api/profile | none | Existing Result<CompanionProfileView>, now with management |
| POST /api/profile | CompanionProfileSaveCommand | 200 Result<CompanionProfileView>; no commandId/SQL profile saga |
| GET /api/memory | none | 200 Result<CompanionMemoryView> |
| POST /api/facts | CompanionMemoryUpsertCommand | 200 Result<CompanionMemoryMutationResult> |
| POST /api/facts/forget | CompanionMemoryForgetCommand | 200 Result<CompanionMemoryMutationResult> |

Runtime entrypoints are `profileView()`, `savePersona(command)`, `memoryView()`, `upsertFact(command)` and `forgetFact(command)`, returning the respective values above; existing raw `profile()` remains an internal Config view and its private Config patch helper stays separate. HTTP owner routes call these fixed owner entrypoints after bearer admission. Old runtime.remember/old internal seeds must not remain a new blind-write path; move current callers to captured-baseline upsert, retaining only declared readonly known-legacy retry handling.

Existing bearer/origin/JSON/no-store admission applies. Profile route is dispatched before the generic commandId requirement. No write launches inference. Profile CAS has no manufactured durable intent receipt: uncertain network outcome is resolved by GET/readback, and retry retains the captured expectedProfileRevision. Matching current values prove current saved state, not which unknown request committed. A later revision never gets overwritten by retrying an older baseline.

M3 rejects a new fact write lacking either baseline; no blind legacy-write fallback. A narrowly recognized v1 retry shape is `{commandId,key,value,expectedRevision?}` with exactly its original optional-field presence. It performs only the existing `getCommand({commandId,kind:'fact',payload:originalBody})` fingerprint lookup. If known, return the actual duplicate receipt plus current memory view and committedRevision=null (v1 has no fact-set commit revision), even when the fact row is gone. If unknown or changed, reject without writing; do not reinterpret it as a new upsert. This read-only branch on POST /api/facts/state retry preserves old ledger truth, not a fake fact/authority compatibility layer. Never add new CAS/origin fields before calculating that legacy digest. Current M3 mutations fingerprint their closed command plus stable host-derived origin and return a positive committedRevision; null is legal only for an actual known legacy duplicate.

Only pre-commit validation/CAS/control/admission errors are Result failures. A known committed profile/memory change followed by application/readback failure must return its actual saved facts/receipt and application.error, with appliedRevision=null or the genuinely older active revision. Capture the committed view/result before fallible context work; do not lose it to a second provider read. If transport cancellation prevents observing the commit, outcome is uncertain and the durable SQL receipt remains queryable by the same intent; never claim rollback/no save.

Fixed error/status mapping: invalid-input400; auth-failed401; permission-denied403; conflict409 (stale counters/busy boundary/changed command payload); quota-exceeded413; not-ready/unavailable503. Malformed/mismatched response is existing fixed unavailable/uncertain. A conflict does not consume a new memory command or append an event. Application failure after a known commit is HTTP200 with truthful application.error, not an unsaved503 fiction.

Add shared protocol helpers `saveProfile`, `getMemory`, `upsertFact`, `forgetFact`, with operation AbortSignal and existing guarded Result handling. Profile reply agentId and memory reply agentId must match the captured service; memory receipt.commandId must match the submitted id. A nonnull committedRevision must be positive and≤view.revision; null requires a duplicate receipt from the declared read-only legacy lookup. Command views are form-local; only existing snapshot/SSE reconciliation owns global state. Schedule one refresh after known/uncertain mutation outcomes, never automatic mutation retry.

Extend CompanionClient with those four operations plus readProfile; readonly model UI remains unchanged. Extend frozen DesktopCompanionBridge with readMemory(target), saveProfile(target & {command}), upsertFact(target & {command}), forgetFact(target & {command}); result types match HTTP values. Add exact companion:desktop:v1:<method> channels through the existing closed dispatcher. Reads can be pet/console; these owner form writes are console-only. Pet natural remember continues through existing sendMessage. No renderer network, generic RPC, credential ingress or independent desktop memory authority.

## 4. Natural remember admission: deterministic boundary and semantic limit

Preserve [the exact M1 natural request](../../../../../qa/probes/companion-model-live.mjs#L164), and ordinary no-key requests. Keep the model-facing `remember(inputId,key,value)` shape; no explicit:true, authority label or model-computed offsets. Align bounds with §2, with actual UTF-16 validation after the schema. Key is a mechanism label; the owner need not type one.

The central runtime—not each Harness prompt—creates an admission from the **canonical accepted user message**. A trimmed top-level input is eligible when it begins with Chinese `请记住` / `记住` / `请记下` / `记下`, or case-insensitive English `please remember` / `remember` followed by a word boundary. Ignore whitespace between Chinese 请 and the verb and between English words. Require remaining nonwhitespace content. This is a bounded direct-request boundary, not whole-command key syntax or a general language parser. Quoted/code-fenced examples, reported history, negative prefixes (“不要记住”, “don't remember”), unrelated input and work-result kind do not acquire this admission. Do not hardcode the M1 sentence.

For an admitted message, host locates the candidate **value verbatim** after that direct cue using string search, chooses its first exact occurrence and records start/end. No paraphrase, inferred diagnosis/private attribute or invented value passes grounding. Preserve all qualification present in the selected value; instructions prohibit changing meaning by stripping negation/uncertainty. There is no public API promoting a failed candidate to owner. Owner-form edits are the fully deterministic alternative, without a new confirmation on normal conversational requests.

What the host proves: authenticated current user message, actual eligible direct cue, canonical inputId, captured memory/row baselines, exact supplied value span, selected source generation/current request, quotas and idempotent mutation. What remains model-dependent: choosing the fact/key within ordinary language, interpreting scope/qualification and producing the acknowledgement. Literal grounding does **not** prove arbitrary human semantics. Provenance says user-input mediated by the assistant, never owner-form/owner-confirmed merely because the model calls it explicit. Known negative fixtures are enforced; this is not a zero-semantic-error claim. The parent-approved no-confirm natural behavior selects this bounded tradeoff; no unresolved product choice blocks the child.

Runtime keeps only bounded ephemeral admissions for eligible current messages: inputId, exact text, memoryRevision, row revision map, selected Harness owner and eligible cue end. Reserve a slot before accepting an eligible new message; release it on admission failure/duplicate and on source retirement. No admission is created for duplicate accepted messages or synthetic work-result inputs. Admission is not another history/memory store.

The current round's existing inputId/eligible checks remain. Host remember port additionally resolves that admission, requires its exact owner generation and inputId, normalizes/validates key/value and derives stable commandId `memory-` + SHA256(inputId,key,value). It stamps user-input origin/evidence and **captured** expectedMemoryRevision/expectedFactRevision; it never substitutes the newer current baseline at execution time. Repeated identical calls return their actual SQL duplicate receipt; changed/late intent cannot overwrite after correction or forget. Multiple fresh candidates from a stale shared baseline can conflict; do not secretly rebase them.

`finishInputs(inputIds)` is a synchronous source-bound private callback from the adapter's existing onTurnEnded before eligible.clear. It removes only admissions owned by that source; retirement clears that owner's remaining admissions before drain. No expiry timer, proposal database, paid classifier or new session/scheduler framework. Nonexplicit suggestions remain ordinary text/editable drafts until owner save.

## 5. Private projection ports and apply lifecycle

Extend the native Harness context with memoryRevision. Extend native ports with:

```ts
interface HarnessProductContext extends Pick<CompanionSnapshot, 'messages' | 'facts' | 'tasks'> {
  readonly memoryRevision: number;
}
interface HarnessProfileBinding { readonly name: string; readonly persona: string; readonly revision: number }
interface HarnessProjectionApplied {
  readonly profileRevision: number | null;
  readonly memoryRevision: number;
}
// CorticoHarnessPorts.context now returns Promise<HarnessProductContext>.
// Added ports are host-bound and absent from model tools:
projectionApplied(value: HarnessProjectionApplied): void;
projectionFailed(value: { readonly memoryRevision: number; readonly error: KernelError }): void;
finishInputs(inputIds: readonly string[]): void;
// rememberFact keeps key/value/origin inputs but returns CompanionMemoryMutationResult.
```

`runtime.harnessPorts(source, profile: HarnessProfileBinding)` binds the trusted descriptor read by the service factory when activating the selected adapter. Private CorticoHarnessOptions adds optional profileRevision:number; the managed service always supplies its positive revision, while standalone tests without it acknowledge profileRevision=null rather than claiming application. This is not a model parameter. The adapter calls projectionApplied only after actual Core start/context installation, and after a successful current-turn canonical context refresh. Host validates selected source/current owner and a revision it actually issued, rejects older memory acknowledgements after a newer mutation, and fences all callbacks after retirement. During activation, reuse the existing checked bootstrap grant used by context(): an issued acknowledgement may be retained for that still-current activating owner, but its application view becomes acknowledged only when PluginManager actually marks that owner active. Do not require active before Core.start can report its actual bootstrap context, or falsely publish applied for a later failed activation. A ready status alone does not prove persona/memory application.

Track application acknowledgements as volatile runtime metadata; SQLite/Config remain the saved authorities. Profile appliedRevision is acknowledged only for the current active adapter's captured name/persona matching current saved contents. Because Config revision also covers model selection, matching applied contents may acknowledge the current saved revision without pretending a rebuild occurred. If no active consuming adapter or contents mismatch, use null plus a fixed application error. An adapter that does not consume persona cannot claim persona applied; the deterministic Harness may acknowledge memory reads separately.

For owner-form profile/memory mutation: prevalidate/CAS-read at the existing idle control boundary, fence/retire and actually drain only the selected foreground Harness, commit Config or SQL mutation, then activate through the existing service factory using canonical state. Do not call model-controller retire(), disable the healthy connector, erase its key, stop state/execution providers or mutate existing worker handles. A precommit conflict may reactivate unchanged canonical state; a committed failure retains saved facts. Unconfirmed drain blocks replacement and prevents a new mutation; no fallback Core.

Current-turn remember uses the same SQL mutation with its admission, **without acquiring idle control or stopping itself**. After receipt, guard generation, reread canonical context, install complete active facts and acknowledge projectionApplied before the next inference step. On refresh failure preserve the committed receipt and call projectionFailed for that revision; return a bounded tool result {receipt,committedRevision,applicationError}, not a fabricated failure to save. Retired generations may not publish replies or mark a replacement applied. Scripted receipt text must distinguish duplicate/historical/current state rather than always saying “preference saved.”

Independent worker outcomes/notice records still commit while foreground quiesces. Reconstruction sees durable context; no worker code/effect is rerun to recreate an announcement. Old product history remains historical data, not active facts or a new memory instruction. Use fresh existing projection directories; prefix-only reload retains stale tail and is insufficient for owner correction/forget. No deletion of logs/projections/backups is implied.

## 6. SQLite v2, atomic memory effects and rollback

Host-only migration API: `migrateCompanionData(options: { dataDirectory: string; backupDirectory: string }): Promise<{ fromVersion: 1; toVersion: 2; agentId: string; epoch: string; memoryRevision: number; backupDirectory: string }>` in the service migration module. Report a verified successful backup/upgrade only; backup hashes are computed by QA from its fixture, not a new product backup manifest/store.

Fresh stores create user_version2. Normal startup opens2, rejects1 with not-ready/migration-required and unknown versions with conflict. No silent migration of an arbitrary data root. Provide one explicit **offline** service migration entry `migrateCompanionData({dataDirectory,backupDirectory})`, not an HTTP operation. Parent QA runs it only on synthetic v1 fixtures; the real trial root is never read.

Migration reuses the actual `DELETE` journal + `locking_mode=EXCLUSIVE` + `BEGIN EXCLUSIVE` single-writer boundary, retained across commits in the existing provider; no lease/PID detector or second writer. Normal SqliteState construction remains synchronous and does not silently upgrade1. The explicit offline service utility can hold that real DatabaseSync lock while asynchronously creating/verifying the external nonoverlapping protected backup. Before any database/version mutation, backup the complete root; copy failure leaves v1 unchanged. One transaction then initializes identity.body.memoryRevision to max existing fact revision (or0), validates legacy rows/quotas, sets user_version2 and commits. Nonterminal task rows are preserved, not rejected or relabeled just to obtain a clean upgrade; physical service/work shutdown is an operator maintenance precondition, not something inferred from a task label. Migration starts/stops/reconciles no worker. Normal recovery after later startup retains its existing honest reconciliation behavior. Preserve assistantId/epoch and every original table row/value/revision/time/receipt/task/artifact; legacy origin is a read projection default, not a bulk value rewrite. Crash before commit rolls back the entire upgrade. Old v1 code already refuses version2.

No new database/table/column is needed. New facts persist origin in their JSON body; memoryRevision is in identity JSON. Do not charge added origin to the old8KiB data quota or evict valid old data. Restore/downgrade requires stopped service and the complete backup, explicitly returning to that checkpoint; never run an old writer against2 or merge discarded post-backup work silently. Normal daily edits do not restart the service. Existing launch name/persona overrides remain explicit process flags, visible through management.launchOverrides; do not edit deployment files to hide them. Restart persistence tests omit overrides unless testing their documented precedence.

Extend state types/validation/manifest together: snapshot includes memoryRevision; add memorySnapshot, forgetFact; rememberFact becomes revisioned upsert. Internal origin is supplied only by the central host path, never copied from model/browser body. Reject every new missing-CAS path, including direct legacy runtime.remember call sites and alternate adapter ports. Existing generic getCommand remains readonly; no ledger pruning.

Within one existing synchronous write transaction: lookup exact command fingerprint first; duplicate returns actual stored receipt/committedRevision plus **current** memory view without applying anything, even if row is now absent. Otherwise check expectedMemoryRevision and expectedFactRevision (0 iff absent), apply upsert or delete, increment memoryRevision, assign upsert fact.revision=new memoryRevision, store durable receipt+committedRevision in that command row, append fact event and commit. New memory command bodies are `{receipt: CompanionCommandReceipt, committedRevision:number}`; generic receipt reads unwrap them while preserving old flat command bodies. Reserve `memory.upsert` / `memory.forget` in recordCommand so only the actual transactional mutation can create these receipts. Changed payload/operation/origin under an existing commandId conflicts. Quota/CAS failure rolls back row/counter/receipt/event. Fact events contain key, operation and revisions/origin references, not copied values.

MemoryRevision only changes for a successful new memory effect; neither chat/task traffic nor duplicate/no-op retries advance it. A successful new explicit upsert may advance even when value equals the old value because it is a new accepted provenance-bearing intent; do not invent a second optimization rule. Forget requires an existing matching row; a new missing-row forget conflicts, while duplicate previously committed forget succeeds from the ledger. The counter plus mandatory CAS prevents delete/recreate ABA, so no tombstone table/key-retention layer is required.

## 7. Forms and executable error cases

All actual UI counters come from §2, not renderer aliases. Normal memory UI derives its complete view from snapshot.facts+snapshot.memory and agent.id; GET memory is deliberate form read/recovery. Mutation responses advance only that operation's form baseline and never global state. Ignore a response below a newer same-target snapshot revision; retarget clears old view/authority, while same-target external changes preserve dirty text and require deliberate re-read/rebase.

Profile fields show saved revision and acknowledged applied revision/error. Memory rows show normalized origin, row revision and shared memory revision. Forget confirm captures key, expectedFactRevision and expectedMemoryRevision from its rendered row; it cannot dispatch against a newer row or target. Explain “remove from active memory; history/logs remain.” No new navigation/window/library or pet-wide page CSS.

Fixed KernelError codes here describe public/runtime/state boundaries; Cortico current-round/work-result/schema prevalidation may retain native TypeError, reported as an actual tool error with no write, without claiming permission-denied. Required host admission failures: missing admitted current user/source, unrelated/quoted input→permission-denied/no write; non-verbatim value→permission-denied/no write; over-limit/empty/bad shape→invalid-input or quota-exceeded; stale row/set/profile/changed command→conflict; source retired→stale-owner/cancelled with no replacement publication; unsupported old peer→readonly/unavailable, not guessed counters. Semantic language outside the bounded admission remains a draft/owner-form path, not silently saved.

The exact M1 request and at least one “请记住我喜欢乌龙茶，以后提醒我时用这个偏好。” no-key request must pass a controlled native Responses fixture. The fixture tests transport/context/tool mechanics, not a claim of proving all language meaning or reusing live credentials. Add adversarial literal/quoted/negated/unrelated/invented-value fixtures and a source-forged owner/explicit field rejection; no new model call on settings operations.

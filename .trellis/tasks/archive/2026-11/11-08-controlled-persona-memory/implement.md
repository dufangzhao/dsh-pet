# M3 persona/memory: implementation plan

Implementation and selected-scope acceptance completed, 2026-11-09; local commit/archive bookkeeping remains. [PRD](prd.md) owns requirements; [design](design.md) owns choices; [implementation-contract](implementation-contract.md) uniquely owns exact DTO/API/ports/authority/limits. [The parent QA plan](research/acceptance-plan.md) is the single eight-case acceptance catalog. Parent reviewed and activated the authorized child after the planning gates; final execution evidence is recorded in progress and the QA report.

## File ownership

| Owner | Exclusive implementation files | Boundary |
| --- | --- | --- |
| GPT backend/shared | `packages/contracts/src/companion-profile.ts`, new `companion-memory.ts`, affected `companion.ts`, `desktop-companion.ts`, root exports/tests; desktop renderer bridge declaration only | Publish actual browser-safe declarations first. Do not mix local projection, profile, memory and row revisions. |
| GPT backend/shared | `packages/companion-runtime/src/**` required for central admissions/control/application; `apps/companion-service/src/**` profile/memory routing and explicit migration utility/tests | One canonical controller/state path; no profile saga, new memory service or automatic trial-root migration. |
| GPT backend/state | `plugins/state-sqlite/src/**`, its manifest and migration/state tests | Preserve existing lock/transaction ownership and durable replay; update types/validator/provider declarations together. |
| GPT backend/Harness | `plugins/harness-cortico/src/**`, related tests and necessary deterministic adapter support | Current-turn remember must not stop/wait for itself; retain M1 natural input and full accepted fact values. |
| GPT backend/client transport | `plugins/text-client/src/client/{client,protocol,guards,state}.ts`, non-React exports, required package/build exports and transport tests; `apps/desktop/src/main/**`, `src/preload/**`, bridge `.d.ts` | Shared wire guards/target admission belong to one writer. No renderer HTTP or credential route. |
| DeepSeek frontend | desktop `renderer/console/pages/persona.tsx`, necessary `renderer/shared/**` hooks/state/UI and frontend tests; new web persona/memory components/pure form module/scoped CSS plus `App` integration/frontend tests | Existing surface/primitives; no new routes, broad deletions or backend/schema/parser changes. No shared transport edits. |
| Parent integration | `qa/probes/**`, synthetic migration/HTTP/Docker/browser/native fixtures, root/native tooling; task progress/context/evidence/spec/guide/commits/archive | Use actual production paths and current declarations. Coordinate build/export or old QA seed changes with GPT; do not handedit generated artifacts concurrently. |

Any text-client root stylesheet/package/build or renderer-wide consumer change outside the named scope is coordinated with parent before editing. Never restore old bridge/DTO writers just to make tests compile; adapt fixture callers to real new baselines. Preserve existing design/preview/theme/notice assets and unrelated tests.

## Phase A — executable contract and frontend handoff (GPT, serial first)

- [x] Implement exact shared profile/memory/status/origin/mutation DTOs and bridge declarations from the contract, with optional old-peer read support and explicit unsupported editing. Keep snapshot facts single-owned.
- [x] Implement shared guard/protocol signatures and fixed Main/preload arity/role/target paths returning honest current/unsupported/unconnected facts. Add profile/memory read seams and constants without manufacturing application acknowledgements.
- [x] Establish runtime owner methods and private context/finish-input ports, ensuring types distinguish current-turn versus owner idle paths. Move old blind seed call sites to explicit captured-baseline setup or declared known-legacy lookup; coordinate parent QA fixtures.
- [x] Run focused contract/transport/desktop types and meaningful boundary tests. Send parent/DeepSeek exact exported files/symbols, initial view fixture, unsupported-peer behavior, counter meanings, mutation/forget baselines and saved/applied response semantics. Freeze actual declarations before frontend starts production changes.

Exit: frontend can import and typecheck real exports; an honest unavailable seam is acceptable during backend completion, a fake success/projection is not. Subsequent breaking changes require coordinated handoff, not independent frontend aliases.

## Phase B — state, authority and control (GPT)

- [x] Implement explicit v1→v2 migration with actual exclusive SQLite admission, full backup before mutation and transactional metadata/version change. Validate synthetic old rows without rewriting/evicting them. Default constructor refuses unapproved v1 upgrade; no new PID/lease detector or migration HTTP endpoint.
- [x] Implement memory view/upsert/forget under the existing transaction and durable command ledger, including set/row CAS, source-derived origin, exact quotas and actual original committed revision. Fix known replay when a row was corrected/forgotten; preserve original v1 fingerprint lookup and unknown legacy commit revision honestly.
- [x] Implement persona Config CAS/readback and profile saved/application view with current launch override flags. Use the existing idle control and actual selected-Harness drain/recreation, leaving healthy connector/key, state and workers alive. Do not add profile commandId bookkeeping across stores.
- [x] Implement bounded canonical current-user admission and verbatim value grounding exactly as the contract. No model owner/explicit flag, model Unicode offsets, paid classifier or command-only regression. Capture baselines before delivery, not when a delayed tool executes.
- [x] Implement current-turn remember on that admission, then current-generation canonical context refresh/application acknowledgement. Preserve committed fact/receipt on refresh failure; never call idle control/stopForeground from its own tool. Remove full-fact clipping and retain historical-data/effect-replay guards.
- [x] Implement owner-memory idle apply, pending/saved/application errors and actual finish/retire admission cleanup. Guard callbacks by captured owner/generation/revision; no replacement activation after unknown drain.
- [x] Extend HTTP, protocol/client and Main fixed operations with one set of guards. Commands remain form-local, global state remains snapshot/SSE-owned. Retain M2 auth/target/secret and byte-boundary behavior.

Run focused regressions while changing each real boundary. Do not create test-only fault switches in product APIs; use narrow I/O/provider gates and existing injection seams. Report concrete failures/fixes, not a stream of source-only success claims.

## Phase C — web and desktop UI (DeepSeek, after Phase A; parallel with B)

- [x] Add editable service name/persona and separate active-memory card on existing desktop persona surface; preserve local presentation below. Web reuses its existing Side/Dialog pattern, without another router/window.
- [x] Derive the memory view from snapshot facts/status, using explicit GET only for form read/recovery. Read origin/application metadata as declared; unknown legacy origin or unsupported status is not guessed.
- [x] Implement captured profile/set/row baselines, own-pending suppression of false externality, deliberate re-read/rebase and same-intent retry. Preserve dirty text on conflict/external change; advance a form baseline from its own actual result only when target/form generation is still current.
- [x] Forget confirmation retains rendered key/row/set/target, explains active removal/history retention and cannot delete a newly corrected row. Empty draft value is not deletion.
- [x] Show saved/applied/error as distinct service facts. Profile uncertain transport uses readback/captured CAS; memory unknown outcome reuses its original commandId, never a fresh automatic mutation.
- [x] Add pure form and rendered consumer regressions, including quoted literal values, limits/counters, late target responses and collapsed/minimum layout. Preserve transparent pet and existing source functionality; no unused-material deletion to reduce test surface.

## Phase D — integration and single QA catalog (parent coordinates)

- [x] Reconcile ownership, actual source interfaces and any changed old seed fixtures. Run whole desktop/service/state/runtime/Harness/client types and affected tests/lint/format, then the complete root gate after sources stabilize.
- [x] Execute [A1–A8](research/acceptance-plan.md#L13) using the actual Config/state/Harness/HTTP paths and controlled Responses peer. The catalog is authoritative; do not create a second competing scenario list here.
- [x] Include the **verbatim M1 natural request** and a no-key natural request as positive tests, then quoted-only/negative/work-result/unrelated/invented-value/forged-authority negatives. Verify exact active facts/prompt data rather than claiming all-language semantic proof or total amnesia.
- [x] For migration, create v1 fixtures from baseline schema/rows before the new provider is involved, including nonterminal records. Compare original rows and identity/epoch, backup hashes, rollback boundary and real concurrent-writer refusal. Never migrate original trial data or cancel jobs to make a fixture appear idle.
- [x] For ongoing work, use the existing prepared Docker environment and controlled foreground. Assert same logical/execution/artifact ids and no replay; source/credential versions remain unchanged without printing keys. Missing device/Docker evidence stays explicitly not-run, never a synthetic pass.
- [x] Actual web/Electron form paths drive real DOM/React events through production Main/preload and shared service. Verify conflict/retarget/pending/save/apply/forget focus and minimum layout; no fake bridge/hook acceptance or new DOM framework dependency.

Relevant existing commands are the root `pnpm check`, package-focused tests, `pnpm test:companion:core` and the prepared-image service/Docker gates. Choose affected focused commands from the actual scripts; do not install or invoke a live model merely to check this plan. Parent owns private browser/Electron tools and serial native execution. Stop all owned instances before editing fingerprinted sources/builds.

## Progress, freeze and exit

Parent keeps the one task progress/evidence log and curated manifests. Workers send actual file/command/exit/assertion evidence and concrete open limits; they do not maintain competing journals or change task metadata. Natural-input semantic dependence and active-forget/history-retention are explicit accepted limits, not hidden failures or new product permission questions.

GPT sends a backend source-freeze handoff after focused types/tests/lint: exact public/private changes, migration safety, legacy replay behavior, application acknowledgements, controlled intent positives/negatives and any unverified platform behavior. DeepSeek sends its own renderer freeze with consumer/CAS/real DOM needs. Parent performs final root/native QA, updates the source-backed specs/operator guide once, and closes/commits/archives only after actual acceptance.

No stage write/rollback deletes the original service data root, imports old desktop history/persona/keys, restarts original4120 or alters account/deployment configuration. Rollback requires stopped service and a verified full-root backup checkpoint; failed application never becomes an excuse to discard saved canonical facts or start a fallback Agent.

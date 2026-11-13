# QQ platform entry implementation plan — approved2026-11-13

The user approved the final summary and `task.py start` activated this task. Execute the ordered gates below. Product scope is [PRD Q1–16](prd.md); mechanics belong in [design](design.md) and then canonical source declarations. Do not start by wiring a socket to the current unrestricted `/api/messages` endpoint.

## 0. Confirm contracts and prove critical runtime seams

- Declare proposed principal/audience/source-account/route/origin/grant, media references, input processing and delivery facts once in browser-safe contracts; keep runtime handles/leases/clients private.
- Define ordinary-source IDs/permissions/config schemas and the narrow source-bound ports. Confirm active-source registration timing and provider method permissions; generic SDK network remains unavailable.
- Pin the two registered model-purpose source bindings and real media resolver integration without changing the foreground selection.
- Prove with controlled/gated tests:2 isolated input contexts, one primary-model permit, cancelled parked input waking without a model borrow, actual stop/world/native join, stable multi-work effects and aggregate projection/application state. Do not use unjoined forks or destroy/replan an effectful input.
- Build/review the fixed codec image/artifact manifest: pinned FFmpeg and silk-wasm3.7.1, no network, read-only runtime/input, bounded output and real resource limits. Test actual encode/decode, malformed formats,120s coverage boundaries and cancellation/process exit before claiming codec availability.
- Resolve any blocking technical contradiction here. No stubs, guessed fallback, arbitrary host execution or removal of selected media to pass a gate.

## 1. Canonical provenance, policy and offline format migration

- Extend the existing State types/validation/SQL writer with immutable source/actor/audience/full-origin metadata, bounded input admissions, media refs, task origin and delivery part/attempt facts.
- Keep old `inputId` meanings/fingerprints/receipts intact; add explicit relationships rather than silently reinterpreting old IDs.
- Centralize owner-managed policies in existing Config/CAS. Persist only canonical resolved/audit facts in State; do not duplicate editable policy/history.
- Add explicit format2→3 stopped full-root backup/migration. Preserve all existing IDs/timestamps/commands/work/artifacts, classify old data owner-private and never create historical QQ sends.
- Verify transaction atomicity, duplicate/changed-payload behavior, limits, restart states and rollback refusal. Use synthetic copies only; original4120 data stays untouched.

## 2. Participant authority, context dispatch and task/material access

- Add host-derived per-input grants and fresh checks at effect/read boundaries. Externally supplied role/route/ID fields cannot grant authority.
- Implement bounded active-input contexts and the FIFO model permit under the existing Harness/runtime; retain each live context's native tool receipts until terminal/actual retirement. No idle Core cache per user/group and no artificial one-task-per-input limit.
- Filter private/group/public context before limiting and resolving media. Label historical observations separately from the actionable input; no hidden old native tails in another scope.
- Preserve complete output origins; persist task initiating principal/audience/logical route. Separate source disconnect from accepted work lifetime and participant privilege revocation.
- Enforce member own-work plus current-audience access, owner/admin-only long-term facts, and material export ACL. Guessing an ID or quoting an administrator never authorizes an action.
- Update operator desktop/Web projection, Pet bubble/caption and automatic-speech eligibility. Main gates before FIFO, service gates before synthesis; only the correct owner-private surface auto-plays by existing opt-in.
- Gate regressions: cross-person/group canaries, admin→member ordering, guessed task/artifact, public/privately revoked facts, multiple legitimate work effects, pending context cancellation and owner-flow/M4/M5 preservation.

## 3. Ordinary QQ sources and captured transport lifetime

- Add both official QQ WSS and OneBot v11 modules under actual PluginManager/config/task/credential ownership.
- Official: current endpoints, token lifetime, Hello/Identify/READY, event/intents, heartbeats/Resume, account-bound source generations and documented non-retryable conditions.
- OneBot: declared authenticated mode/account/channel semantics, bounded envelopes, echo correlation, rejection/async/unknown states and explicit SnowLuma media compatibility operations. Do not copy DSH bridge runtime/SDK patching or QQ client login.
- Validate stable external event provenance/dedup and own/machine-origin exclusion before canonical/participation admission. No fuzzy cross-protocol group/person/message matching.
- Implement source/key/config/connection retirement and actual close/drain; old callbacks cannot adopt a new target. Keep accepted Core/work independent.
- Tests use real controlled loopback sockets and synthetic credentials; no real account sessions or QQ messages.

## 4. Owned media import, model input and worker files

- Stage authenticated, audience-bound media with exact size/MIME/hash and private references; no binary/base64 in canonical public JSON/SSE.
- Official and selected OneBot media paths use fixed source operations. A remote gateway path is never interpreted as this host's path. URL/signature/ref lifetime and current material authority are rechecked at use.
- Images reach the actual compatible native model through the captured scoped resolver; unavailable model media support is a real state.
- Voice uses actual decode/resample, complete bounded PCM spans and ASR result composition; incomplete spans are not submitted as a completed command. Preserve the existing20s device-capture contract.
- Files enter only the authorized worker input namespace; they are not automatically executed. Output download/export requires ownership and audience, not a management bearer handed to QQ.
- Optional speech consumes the real M5 stream through an authorized QQ export consumer, performs actual Tencent-compatible encoding and controlled upload/send. Mandatory text is unaffected by optional voice failure.
- Exercise every selected media type in official-private, official-group, OneBot-private and OneBot-group profiles, including malformed/expired/oversize/private-ref/cancel cases. Unknown installed-version behavior remains explicit until verified.

## 5. Ordered complete delivery and participation policies

- Persist canonical output groups and freeze the complete text/required-media/optional-voice plan before external sends. Remove silent8000-unit clipping; preserve larger bounded text as an explicit full-text material, not a fake complete preview.
- Use the design's bounded inline/file representation, stable per-part identifiers/reference/sequence allocation and conservative passive eligibility. Record upload effects, send attempts, accepted/failed/unknown and partial groups distinctly.
- Mandatory text must be conclusively accepted before optional voice begins. Stop unattempted parts after text rejection/unknown; never replay confirmed/unknown parts or fall back to another protocol/account.
- Route delayed work replies only through their original logical audience and freshly valid source/participant eligibility. Source disable cancels outgoing eligibility without cancelling accepted work; network recovery does not become historical global-message replay.
- Implement bounded recent group observations, literal wake words/@ and configurable proactive rules. The positive judge decision admits reply-only authority, not the previous sender's privilege.
- Add independently bound tool-free Magpie participation calls with durable attempt IDs/budget reservations, cancellation and actual usage reporting. Judge config changes never retire the primary model. No SDK hidden retry or mode fallback.
- Verify unknown after dispatch/crash, partial mixed batches, multiple say outputs, callbacks across account/config replacement, proactive self-loop suppression and rule/judge failure isolation.

## 6. Service Web management and desktop status

- Implement narrow owner-only read/save/credential/catalog/check/status/delivery-recovery boundaries with captured CAS and actual writable status. Settings saves make no inference or test send.
- Follow [UI plan](research/ui-plan.md): one QQ management entry, two protocol cards, people/groups, global/per-group policy, independent judge model/budget, media and additive voice, scoped fact management and concise delivery diagnostics.
- Use existing ui-kit/DOM forms and dirty/owner/version behavior. Lists are bounded/paged, no duplicate settings store or new styling framework. No ordinary QQ member management access.
- Desktop consumes bounded remote status and opens the exact service Web origin without secrets in URLs; no second remote QQ editor.
- DeepSeek owns frontend implementation/design; GPT owns contracts/backend/integration and verifies the actual cross-layer state semantics.

## 7. Whole-scope verification

- Curated source/scoped tests, root `pnpm check`, generated source admission, migration and existing owner/M4/M5 regressions.
- Use [protocol matrix](research/protocol-test-plan.md) for static/controlled/production/real-platform separation. Parent freezes relevant source/build/dependencies and owns long-running verification jobs; collect all jobs and close every owned instance before edits.
- Real Web and desktop-status DOM checks include CAS/target switch, denied credentials, policy/source revocation, controls and truthful saved/applied/accepted/unknown views.
- Independent review must close real findings and confirm Q1–16/A1–12 coverage. Do not replace permissions with prompts or claim tests that only inspect metadata prove actual I/O/media release.
- Only after controlled gates, request exact real-model/platform authorization with account/version/recipient/material/count/budget specified. M5 live permission is consumed. An unavailable account or unknown gateway extension leaves that cell pending, not a fabricated pass.

## 8. Evidence, specification and handoff

- Maintain one acceptance record with versioned source/fixture/production/live scope and explicit limits; keep raw diagnostic bytes and outcomes immutable.
- Update affected executable specs and operator guide with actual contracts/defaults/credential procedure/source recovery; no copied schema catalog or generic template tree.
- Prepare concrete work commits, obtain the workflow's one-shot approval, commit without amend/push, then archive only this child with rebased links and journal the work hashes.

## Traceability

| Requirement | Main phases / evidence |
| --- | --- |
| Q1–2 | 0,3,6,7: both ordinary sources and actual lifecycle |
| Q3, Q7–9 | 1,2,5,7: provenance, policy, context and work/material ACL |
| Q4, Q16 | 1,4,5,7: complete text, ordered parts, independent voice and honest receipt |
| Q5–6, Q13 | 0,3,7,8: fixed references, isolated tests, explicit real authorization |
| Q10–11 | 0,2,5,6,7: bounded observation, rules/judge and separate purpose |
| Q12 | 0,4,5,7: all four media across all selected protocol/audience profiles |
| Q14–15 | 1,2,6,7: Web management, desktop status and admin-only facts |

The user approved this plan and task activation on 2026-11-13. Implemented slices and their actual verification scope are recorded in [progress.md](progress.md) and linked evidence; unfinished composition and whole-product gates remain explicit. Live account/message/paid-model trials still require their separate exact authorization.

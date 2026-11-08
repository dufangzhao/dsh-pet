# Model-backed text companion — implementation plan

Status: approved product direction, prepared for execution on 2026-11-08. This document schedules work; it does not claim implementation or validation. Exact names/types/API are frozen in [implementation-contract.md](implementation-contract.md), rationale in [design.md](design.md), requirements in [prd.md](prd.md). This documentation assignment changes no product files. Parent owns task activation/context records and subsequent dispatch; no new start-permission question is needed.

## Non-overlapping ownership

One GPT backend implementer owns the complete native/Config/auth/lifecycle/HTTP integration, including backend tests. DeepSeek owns the text-client UI and its frontend tests. Splitting the native path among more backend workers would share too many authority/lifecycle files; do not do it. Parent owns final integration, evidence/spec/journal updates and any later explicit commit or trial restart. Neither implementer edits the other's paths; contract changes return to parent before coding against a different shape.

| Owner | Exclusive source/output range | Required result |
| --- | --- | --- |
| GPT backend | [contracts](../../../packages/contracts/src/companion.ts) plus new `packages/contracts/src/companion-model.ts`, shared exports and focused contract tests | Freeze/export the canonical browser DTO/commands and additive snapshot member; no frontend-owned duplicate types. |
| GPT backend | [companion-runtime](../../../packages/companion-runtime/src/index.ts), especially plugin-host/core-plugin/runtime/source-authority and new `model-connections.ts` / `fixture-model.ts` with focused tests | Ordinary connector registration/native binding, both source leases, profile selection, same-Harness safe reload, independent-work preservation, fixture replacement. No new lower-level kernel/TaskManager. |
| GPT backend | [companion-service](../../../apps/companion-service/src/service.ts), model-client/server/main; a scoped internal model controller and service/model tests | Current-binding config/key/check control, private key CAS, native Magpie reuse, HTTP and initial unconfigured view. Secrets remain outside commands/Config/DTOs. |
| GPT backend | New `plugins/model-connection-magpie/` manifest/package/factory/build/tests; [Cortico declaration/adapter](../../../plugins/harness-cortico/src/index.ts) and manifest only where native options/consumption/credential removal require it | Default ordinary Magpie adapter, typed native facade reuse, host-only ports, lifecycle disposer; no gateway binary/process. Runtime package exports the alternative ordinary connection fixture. |
| GPT backend | Root workspace/package/lock/build wiring only as necessary for the new ordinary local package; backend probes under [qa/probes](../../../qa/probes/companion-service.test.mjs) | One implementer owns shared wiring. Reuse installed versions; no new external dependency, install script or runtime service startup is assumed. |
| DeepSeek frontend | [text-client client source](../../../plugins/text-client/src/client/app.tsx), guards/protocol/state/chat/styles and a compact settings component; frontend-only tests/research/screenshot evidence in its existing package area | One settings flow consuming shared DTOs: save/apply, dedicated gateway key input, explicit check, truthful modes/binding/status, offline/conflict/reconnect, keyboard/mobile. No host-kernel/fs/native imports or server/source edits. |
| Parent integration | Task docs/context, [service guide](../../../docs/35-text-agent-foundation.md), [QA overview](../../../qa/companion-acceptance.md), executable Trellis spec/journal and final collection | Merge ownership boundaries, validate actual results, record completed stages; preserve pending real-provider evidence. |

Existing host-kernel/plugin-sdk behavior is reused. If a necessary lower-level correction is discovered, backend reports the concrete evidence and parent adjusts scope before another worker edits it. Do not change desktop/llm-provider product behavior or fingerprinted stable-runtime files for this feature.

## Contract freeze and execution order

### Stage 0 — preserve runtime and freeze the shared contract

- [x] Parent confirmed original trial is stopped, port4120 is unbound, original data/token retained, and stable29c4ade worktree prepared; development/tests use separate profiles.
- [x] Backend and parent read the current PRD/design/contract/research and actual specs. Parent validated six real entries in each context manifest and started the task under the user's approved continuation and default-Magpie decision.
- [x] Backend landed companion-model DTO/commands/exports, optional snapshot.model, model-connection-types, native diagnostic/opaque options and initial model-view with serialized fixture. Four affected typechecks and runtime11 tests passed; no API or live connection success is implied.
- [x] Parent reviewed the frozen shapes, accepted the narrow server-ingress refinement of credential.writable, and dispatched DeepSeek frontend against the actual shared types. Breaking changes must be coordinated; no parallel DTO copies.
- [ ] Parent records Stage 0 actual files/checks in the task progress/journal. Do not call stub data a real connection.

### Stage 1 — native connector and authority (GPT)

- [x] Implement the one activation-owned native binding map, exact owner/provider/Config identity, private factory ports and ordinary metadata provider selection. Reuse current ResponseClient and native authorized transport; no JSON roundtrip for native values/errors.
- [x] Implement Magpie plugin Config/manifest/factory/disposers. Default `http://127.0.0.1:3425/v1`, empty model and local client label; enforce loopback-only local-client-id and HTTPS remote gateway-key boundaries. No gateway process/catalog/agent-config/account discovery.
- [x] Implement the smallest ordinary connection fixture under the same registration/ports, clearly synthetic and distinct from the existing Harness fixture. No extra npm package or framework is needed for this fixture.
- [x] Add consumer capability leases for Core replies/owner checks, connector config-read source leases (including fixture), connector credential lease and all abort/settlement propagation. Move Cortico credential authority to the connector. Retain original native errors/partial/attempts/options and existing secret redactor behavior.
- [x] Prove missing grants, either source denied/revoked/changed, stale bound handle, native callback/value/error identity and actual socket/source/broker drain with controlled local fixtures.
- [x] Parent records Stage 1 evidence; only describe what passed. Source packages remain isolated from retained runtime.

### Stage 2 — configuration, safe application and real check (GPT)

- [x] Add compatible optional host selector/mode and separate connector Config. Preserve existing name/persona/Harness/disabled state and schema-version-1 records. Apply only explicit environment overrides through existing CAS.
- [x] Add private credential slots bound to connector + complete normalized base URL/auth mode. Use a process generation plus slot generation in every opaque version; stale versions after restart must conflict. Support no-secret local-client-id and fixture honestly; remote key is independently supplied via environment or memory only.
- [x] Implement exact HTTP/view contract and current saved/applied/enabled/check state. Save/apply and key submission do no inference. There is no candidate/draft/probe-on-save service or generic Admin CRUD.
- [x] Extend the existing runtime control boundary for apply/select/check and serialize with plugin/Harness controls. Retire Core, unbind/disable/drain old connector/broker, then enable new connector and rebuild the same Core from canonical state. Same-connector settings changes must actually reload. Unconfirmed cleanup/pending_restart blocks replacement.
- [x] Cover outcome delivery while quiescing: preserve committed notice/result; suppress obsolete optional delivery and read canonical state in the replacement. Do not stop state/execution or cancel unrelated jobs.
- [x] Implement nonsecret intent dedup/current-state convergence across separate profile/plugin CAS records. Never persist secret request bodies/hashes; private key endpoint uses version CAS only.
- [x] Add explicit 202 test admission through the existing source task: exact applied binding, 15s diagnostic SSE, 256 output-token cap, no history/tools, real completed nonempty output required. Duplicate admitted command never resends after timeout/restart. Actual drain controls final settlement.
- [x] Add fixed error classification/status projection, version/binding/authority invalidation and late-check fencing. Native errors remain opaque internally; malformed/partial provider outcomes cannot become ready or scripted.
- [x] Parent records Stage 2 actual behavior and test results; real Magpie/upstream validation remains pending without owner-supplied target/action.

### Stage 3 — frontend (DeepSeek; may overlap backend after Stage 0 freeze)

- [x] Read the frozen shared DTOs/contract. Extend strict guards/protocol/client state using those types, including absent feature handling and rejection of malformed present views. Backend remains sole contract owner.
- [x] Build compact connection settings within the existing private text client. Use one canonical nonsecret view; fixed Responses fields are base URL/model/auth mode plus explicit service mode/connection choice. Non-form custom connector metadata is shown honestly, without generic plugin configuration rendering.
- [x] Implement one “保存并应用” UI action; it can issue sequential nonsecret save and private credential CAS for typed remote keys. Key-only edit avoids an unnecessary save/reload. Clear key input after dispatch; no global reducer/pending intent/browser storage retention. Explicit key removal is distinct from an empty field.
- [x] Implement separate “测试连接” action on confirmed saved/applied settings only. It does not save edits or enable model mode; no automatic inference on mount/save/reconnect/retry. Show check progress/results, required/available auth, actual enabled state and synthetic evidence label separately.
- [x] Handle conflict by refresh without overwriting edits; handle uncertain save/key/check by reading current authoritative state. Never auto-resubmit a possibly paid check or private key. An old duplicate test with no result is unknown, not validating/verified.
- [x] Preserve existing transcript/tasks/targeted stop/download and offline/heartbeat behavior. Keep basic field focus/keyboard support and 390px readability; do not add a task board, model catalogue, sidebar platform placeholders or execution Session selection.
- [x] Run focused client tests and connected-browser checks against the actual new API with fixture/loopback data. Do not use a mock page as product acceptance. Parent records Stage 3 frontend evidence and limitations.

### Stage 4 — integration, full gates and actual acceptance (parent + GPT/DeepSeek scopes)

- [x] Verify backend and frontend use identical exported types, nullability, route envelopes, status/error meanings and refresh behavior. No shadow frontend DTO or one-off Magpie path in Core.
- [x] Exercise real HTTP/SQLite/Core/Docker work with the new connector selection. Chat B must be handled at the next inference step while independent work runs. Stop only selected task; swap connection fixture ↔ Magpie loopback adapter at idle foreground and retain identity/facts/work/receipt/artifact bytes.
- [x] Verify key-only/endpoint-path/connector/auth changes, restart with old form version, source trust/revoke, failed disposer, old callbacks and completion-during-switch all retain authoritative outcomes.
- [x] Run applicable full root gate after integration; fix actual regressions within ownership. Collect all jobs/evidence. No broad repeated test runs once gates pass unless changes/failures justify them.
- [ ] When owner supplies real Magpie endpoint/model/auth and explicitly requests a bounded test/use, execute the practical live scenario below. Otherwise record it **pending**, with no placeholder pass or additional secret-discovery step.
- [ ] Parent updates service guide/QA/spec/task records after the verified stage. Any commit, archive, public exposure or trial restart follows actual existing authorization; this plan does not itself request/start them.

## Validation and acceptance

Use isolated temporary data and loopback protocol fixtures in automated tests. No automatic paid inference, Magpie installation, real account login or image pull belongs in a package/root gate. An actual existing Docker image is explicit test input. Source changes/builds must never run beneath a live fingerprinted runtime.

Recommended focused commands (run by implementers later, not executed by this document assignment):

```sh
pnpm --filter @pet/contracts test
pnpm --filter @pet/companion-runtime test
pnpm --filter @pet/companion-service test
pnpm --filter @pet/model-connection-magpie test
pnpm --filter @pet/harness-cortico test
pnpm --filter @pet/text-client test
pnpm test:companion:core
# Set PET_CLOUD_EXEC_IMAGE to an explicitly prepared existing image first.
pnpm test:companion
pnpm check
```

| PRD / risk | Minimum acceptance evidence |
| --- | --- |
| A1 configuration truth | Initial default Magpie unconfigured; saved complete settings configured; explicit check validates then settles verified/failed for exact binding; key presence/Core ready do not verify; synthetic fixture success explicitly synthetic. Save/select/read makes zero inference requests. |
| A2 usefulness | Through model start_work (not direct API substitution), produce exact downloadable Markdown/CSV bytes with exit0 from the existing real executor; correlate original task/execution/receipt. |
| A3 continuity | Chat during independent work; selected stop leaves other task running; same-Cortico connector replacement keeps identity/facts/work/artifacts; result completing during switch commits once; reconnect/restart returns same bytes without replay. |
| A4 failures/authority | Wrong key/endpoint/model, malformed/incomplete native output, reflected key, stalled stream, either source deny/revoke/fingerprint and unconfirmed disposer yield fixed truthful states; native partial/private options retained internally; actual socket/lease/broker/work settlement asserted. |
| A5 restart/secrets | Nonsecret config/profile stable, no key canary anywhere persisted/exposed, process+slot credential version rejects old form after restart; full endpoint path/connector change never inherits key; missing key and pending live evidence explicit. |
| A6 quality/browser | Existing unit/core/HTTP/recovery/Docker/browser gates plus complete pnpm check; real UI save/test/synthetic labels/conflict/key clearing/reconnect/mobile/keyboard checked. Fixture/loopback/network/real-provider evidence are distinct. |

Practical live script when authorized: save explicit “brief, concrete replies” preference; chat; ask the selected real Magpie model to create `summary.md` and `items.csv` for three generated/owner-supplied expenses with a known total. Confirm actual model tool admission, exit0 and exact authenticated bytes. Continue a short chat while bounded work runs. Start a second bounded job, stop only one, and replace the connection at an idle foreground boundary without losing the other work or Agent identity. Prefer a concrete provider/model and record known Magpie route policy: native diagnostic disables client retries, not gateway-internal classification/account fallback. Cap approved rounds/output/task duration; do not silently add catalog/discovery or retries.

## Records and rollback

After each stage, parent records actual changed scope, executed command/result, evidence paths, remaining limitations and next step in Trellis. Planning checkboxes are not evidence of a pass. Full live acceptance without configured/authorized real gateway remains pending and must not be represented by a fixture check.

On application failure retain committed desired Config plus fixed error and applied/enabled truth. Restore operation only after actual cleanup, by correcting/selecting an explicit binding through the same path. No auto-return to Magpie/scripts, concurrent replacement after pending_restart, profile deletion, work replay or rewrite of completed outcomes. Retain the original stopped trial profile/token and stable worktree for any separately authorized future run.

# Shared desktop Agent entry: execution plan

Status: completed portable implementation and selected Linux acceptance, 2026-11-08; Windows device execution remains separately unverified. Read [PRD](prd.md), [design](design.md) and the sole exact [implementation contract](implementation-contract.md). No task activation, product change, provisioning, build or service launch is performed by writing this plan. Parent activates the child after artifact review; the existing authorization does not need another user confirmation.

## Ownership and handoff

One GPT backend implementer owns the entire cross-layer backend and shared-type change. DeepSeek begins production frontend only after GPT publishes the contract declarations and adapter semantics. Parent owns QA/provisioning/integration logs. No overlapping product edits by two workers.

| Owner | Exclusive files/directories for this child | Boundary |
| --- | --- | --- |
| GPT backend | `packages/contracts/src/desktop-companion.ts`, `companion-profile.ts`, necessary exports and contract/guard tests; all `apps/desktop/src/main/**`, `src/preload/**`; renderer bridge declarations only; `plugins/companion-client/**`; shared-startup admission/source configuration hooks; `apps/desktop/scripts/builtin-admission.ts` | Publish real types/bridge signatures first. No renderer TSX/CSS ownership. Source plugin follows the current ordinary build/admission pipeline. |
| GPT backend | `apps/companion-service/src/server.ts` and necessary profile-read support/tests; narrow profile projection support in `packages/companion-runtime` if needed; `plugins/text-client/package.json`, `build.mjs`, protocol/model-ui export modules, `src/client/protocol.ts`, `guards.ts`, `sse.ts`, `state.ts`; props-only `model.tsx`, its Web `app.tsx` caller, model CSS extraction from `styles.css` into scoped `model.css`, and corresponding tests | Sole writer for wire exports/signals/guards and controlled ModelDialog handoff. No duplicated desktop form; preserve browser behavior and≤64KiB service boundary. Broader text-client/UI-kit component/style edits require parent coordination. No model-client/connector redesign. |
| DeepSeek frontend | `apps/desktop/src/renderer/console/**`, `renderer/pet/**`, new shared client hooks/views/CSS and frontend tests; existing pure UI components only where input adaptation requires it | Keep shells/components, no host/IPC/contracts/product manifest edits. Bridge `.d.ts` belongs to GPT. Do not edit text-client protocol/state files; request additions from GPT. No plugin/backend/test-tool provisioning. |
| Parent | `qa/probes/companion-desktop-*`, controlled fixture/runner support, root test scripts and `apps/desktop/build.mjs` when required; private QA tooling; task progress/evidence/spec/docs/commit/archive | Coordinate build/admission changes with GPT before edits. Native tests reuse production code, never a second fake bridge. Generated admission/build artifacts are regenerated after sources settle, not hand-edited concurrently. |

Frontend changes to generic renderer files used by old controllers must preserve their existing callable component contracts where practical; introduce narrowly named shared roots/hooks instead of running obsolete hooks in the shared UI. Parent and GPT explicitly agree any unavoidable ownership exception before writing that file; no need to ask the user for routine implementation choices.

## Phase A — declarations and executable seam (GPT, serial before frontend)

- [x] Implement the browser-safe exact declarations/IPC constants and renderer global bridge declarations from implementation-contract. Validate method/role/arity/ID/text bounds; do not add a generic remote-call method.
- [x] Add the bounded read-only profile route and guard, source-owned ordinary client manifest/runtime/config, and non-React text-client protocol export. Extend optional AbortSignals and redirect refusal without changing existing browser behavior. Preserve actual validation units: message≤8000 UTF-16 code units; canonical name/persona≤80/16384 Unicode code points plus UTF-8 envelope budget. Add meaningful wire/profile/source boundary tests using supplementary characters.
- [x] Publish controlled `@pet/text-client/model-ui` and separate `model.css` exports. Adapt existing ModelDialog props only to view/live/agentStatus/ModelTransport; update Web caller/tests and scoped CSS extraction without rewriting the form machine. Dialog has no className prop: use the documented wrapper, no ui-kit edits. Prove the native credential adapter returns permission-denied without Main/HTTP I/O. Hand this exact export/props/CSS boundary to DeepSeek; the transparent pet must not import its UI-kit-bearing dependency graph.
- [x] Implement a minimal controller and frozen preload facade returning honest unconfigured/offline state, including Main-local projection revision/connectionId. Establish the host-private source/token/chooser ports. No local Core needed to exercise this seam.
- [x] Run affected contract/backend/protocol checks. Send DeepSeek a handoff naming actual exported symbols/files, method result semantics, role restrictions, target-generation rules, local-presentation fields, and which implementation statuses are still pending. Freeze declarations; changes after this handoff go through GPT and a coordinated frontend update.

Exit: frontend can typecheck against actual declarations and invoke a real Main stub/controller boundary; no speculative frontend-owned DTOs. This is an implementation handoff, not a claim that native acceptance passed.

## Phase B — independent implementation (GPT backend and DeepSeek UI in parallel)

GPT:

- [x] Finish single Main connection, authenticated snapshot/SSE, bounded pending intents, exact receipt matching, profile/task-detail/model reads/commands, fixed artifact route and native save pipeline. All responses pass existing shared guards before publication.
- [x] Implement source/config/credential/connection fencing, observed Config save retirement and actual I/O/supervisor drain. Cover same-target reconnect versus fresh-token connect, stale CAS preserving healthy auth, partial committed selection, hung/ended streams and stale chooser/download results.
- [x] Replace normal startup with shared composition. Preserve actual local display/theme/speech mechanisms; add allowlisted local presentation CAS. Block legacy roles through startup, generic enable/restore/dependency/guide/page/runtime config paths, not only UI. No old history/vault read/import, model/OAuth or voice restore.
- [x] Provide the actual Linux-compatible new-client composition seam without spoofing Windows/platforms. Keep core compatibility unchanged and unchanged native packages unavailable. Parent can build a narrow native QA entry from the production controller/bridge/views.

DeepSeek, after Phase A:

- [x] Replace shared-root mounting of old useApplication/useDemo/useModelConnection with one service-state hook and the fixed local-presentation hook. Dispose subscriptions and reject late generation/form responses.
- [x] Integrate connection form, canonical identity/mode/unavailable state, chat/draft/uncertain retry, recent task/stop/download controls and read-only persona details into existing shells/pet components. Service model settings consume GPT's controlled ModelDialog export with exact ModelTransport props and scoped stylesheet, mounted only in console; never copy the existing form. Key input/import is absent, any required credential adapter explicitly denies without I/O, and save/test remain explicit.
- [x] Keep supported local appearance/audio controls and actual dialogs. Hide unsupported pause/clear/history-pagination/voice-input/legacy guide affordances with concise explanation where needed; no fake backend success or replayed speech/reaction.
- [x] Add focused frontend regressions for draft retention, stale target rejection, disconnected task truth, role-specific controls, keyboard/focus and minimum-width layout. Notify GPT of necessary contract additions rather than editing shared wire/types.

Both report completed files, focused command outcomes and remaining constraints to parent; do not claim another worker's test results as their own.

## Phase C — joint integration and quality (parent coordinates)

- [x] Integrate source admission/build exports and actual shared default launch. Check no accidental parent/archived-task edits and no generated artifacts staged from unfinished builds. Run focused GPT/frontend suites once against the integrated state.
- [x] Audit all old bridge exposures, Main handlers and automatic startup/restore paths using source searches. Test that generic management and page commands cannot bypass the shared admission policy. Verify no token in profile/vault/history/state/events/errors/download names/logs/reports.
- [x] Run `pnpm check` from root. It covers typecheck, packages, QA tests, lint/format and builds. Correct actual failures; do not skip Windows/security assertions merely to turn Linux gates green. Record command/exit/report paths and distinguish unit fixtures from real Electron.
- [x] Run existing controlled service/Core/Docker regressions affected by shared protocol/profile changes: `pnpm test:companion:core`; `PET_CLOUD_EXEC_IMAGE=<prepared image> pnpm test:companion` when the prepared Docker environment is available. No model gateway call is needed; no automatic image pull/host4120 restart.

## Phase D — real native and cross-surface acceptance (parent, serial)

- [x] Provision only private explicitly chosen Electron45/Xvfb/shared-library tooling; no package-entry auto-download, system package replacement or original service/profile modification. Preflight actual platform/arch/binary/display; fail visibly if unavailable.
- [x] Implement `qa/probes/companion-desktop-native.mjs` and the minimal QA Main entry using production controllers/request validators/preload/shared views and the real new client's declared Linux platform. The QA host uses actual kernel/task/config/source/credential mechanisms. Fixed local presentation props are explicitly QA-only; do not pretend legacy Windows plugin activation.
- [x] Start a temporary service with isolated durable data, loopback ephemeral port and controlled model/scripted text. Open its real browser client and actual Linux Electron pet+console; drive actual DOM actions. Supply token through the console, never argv/report. Download through native chooser; if an automated destination seam is needed for byte transport checks, label it and retain separate actual chooser evidence.
- [ ] Repeat only affected existing serial Windows tests on a real Windows runner when available: shared startup, real profile/page/avatar/audio admission, old data preservation, denied legacy reenable and supported local behavior. Existing legacy-Core probes remain historical/controlled legacy regressions; do not force them to assert a Core in shared default startup. Windows device/OS behavior absent from the runner remains explicitly pending, never inferred from Linux screenshots.

Actual commands and private Linux tooling requirements are maintained in the [QA entry](../../../../../qa/companion-desktop-acceptance.md); the following was the original planned runner shape, not a claim of a one-shot full pass:

```sh
COMPANION_ELECTRON=/absolute/provisioned/electron \
  xvfb-run -a -s '-screen 0 1440x1000x24' \
  node qa/probes/companion-desktop-native.mjs
```

Runner forwards the explicit display/library/font environment and clears ELECTRON_RUN_AS_NODE for Main. It records actual Electron45/process.platform, two visible loaded file windows, security preferences, source states, build hashes, command/task/message/artifact correlation, byte hashes and clean shutdown. The controlled `--no-sandbox` QA exception is recorded and never described as OS-sandbox validation. A browser-only pass or mocked global bridge is not native Main/preload acceptance.

## Nine measurable acceptance cases

| Case | Required observable result | Gate / PRD |
| --- | --- | --- |
| A1 Shared identity/input | Real browser plus Electron pet/console display same agentId/name/profile revision and message/task/artifact IDs. One pet intent appears once everywhere; console/web input also reaches desktop. No Session selection/local Core. | HTTP + native, D1 |
| A2 Client-independent task | Two real service tasks; quit/disconnect desktop while one continues. Browser sees completion; new desktop process explicitly reauthenticates and obtains exact final artifact bytes. No task restart/duplicate effect. | Controlled Docker + native, D2 |
| A3 Stop scopes | Stop selected task while other work completes; foreground stop does not cancel background work; immediate local playback stop remains separate. Requested versus terminal/raced outcome is truthful. | Source/backend + supported native, D4 |
| A4 Honest failure/reconciliation | Bad auth/protocol/DTO, dead/hung SSE or failed snapshot immediately leaves live state and retains confirmed data/time/draft. Same-ID retry after dropped receipt admits once. Omission labels remain; no local fallback. | Socket/protocol + UI, D3 |
| A5 Retirement/drain | CAS conflict keeps old healthy binding; committed endpoint/token change, source disable/revoke or config save fences old read/send/profile/model/chooser/download callbacks. Actual I/O settles; no publication starts after the retirement fence or clears a new target's draft. Already-entered file commits preserve their real old-operation outcome before replacement. | Source/socket/files + native, D3/D6 |
| A6 Credential/endpoint boundary | Explicit named LAN HTTP and HTTPS/loopback root accepted, non-root/credential/query/fragment/redirect refused. Token never persists/leaks/auto-transfers, pet cannot manage auth, source deny is honored. Native bridge cannot relay service Key/admin/arbitrary URL operations. | Boundary/leak tests + native, D6 |
| A7 Legacy data/admission | Isolated existing profile/history/vault/persona values are byte/value preserved without import. Shared default has no legacy activation/restore; generic enable/restore/dependency/page/runtime config attempts cannot bypass policy. Local preference CAS never changes persona or emits chat. | Backend fixtures + real Windows integration where available, D5 |
| A8 Local presentation and honest platforms | Actual supported local appearance/window/theme/audio controls still work. Linux new-client test uses real linux-x64 declaration/production code; unchanged Windows packages are rejected, not force-enabled. No Win32 key/TTS/click-through claim from Linux. | Local tests + Linux native + labeled Windows scope, D5/D7 |
| A9 Native usability/restart | Two actual windows, console880×600, keyboard/IME/dialog focus, reachable task/download/model/profile controls; reused ModelDialog keeps its footer/scroll/closed/focus behavior, unrelated dialogs remain unchanged, and actual pet html/body backgrounds stay transparent with no model UI/page-CSS import. Desktop process restart restores only nonsecret target/local settings, zero model probe and no catch-up speech/device effects; removable client leaves service state/work. | Serial native/report + full root gate, D7 |

A7's portable backend preservation assertions and Linux text entry can pass without a Windows device; any absent Windows-specific execution must be listed once in evidence. Parent evaluates D5/D7 against the PRD's explicit platform scope and does not relabel pending device behavior as passed. No additional product approval is required to implement/test the selected text composition.

## Progress, evidence and finish

Parent maintains one `progress.md` in this task with phase, owner, changed files, commands/exit codes, build identity, evidence paths and concrete open limits. Implementation workers send concise handoffs; they do not create competing logs. Put native/protocol results under task `research/` plus intentional QA artifacts, redacting all secrets. Preserve the existing source research by reference instead of copying it into each document.

After integration, perform the final source/authority/file-ownership review, update source-backed specs and operator guide with actual behavior, then commit/archive/journal through normal Trellis finish. Never mark a test passed from source inspection. Original host4120 remains stopped unless the user later explicitly resumes it. Rollback uses the prior committed application and preserved data; do not delete profiles, rerun old tasks, auto-import histories or start a second Agent to recover availability.

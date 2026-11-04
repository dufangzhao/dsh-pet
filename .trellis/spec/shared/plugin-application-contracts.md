# Executable desktop application contracts

## Scope / trigger

Use for changes to plugin activation, ordinary page contributions, application IPC, Cortico, shared profile or native input. Current product behavior is in docs/34-plugin-pet-guide.md; this spec records boundary mechanics and regressions, not another product roadmap.

## Signatures

- PluginRuntimeContext / PluginContext: optional readonly dataDirectory:string, allocated by DesktopHost with PluginDataDirectories.get({pluginId,instanceId}) only for declared files/plugin-data. Runtime authority remains owner + generation.
- SDK config.save?(task,data:JsonObject,expectedRevision:number): Promise<Result<ConfigSave>>. Optional host port keeps older in-memory fixtures source-compatible; actual workers provide it. No target owner in the request.
- ApplicationBridge: fixed getSnapshot/getHistory/saveProfile/interact/answer/startGuide/runPageAction. See packages/contracts/src/application.ts. Frozen preload facades enforce arity; Main checks the exact current trusted main-frame URL.
- app.profile@1 read/change owns canonical persona/appearance; agent.conversation@1 owns Core projection; llm.responses@1 returns complete Generation, including a nonempty successful attempts array and TokenMeters.

## Contracts / env

ApplicationAnswer is id + step + known choice + optional text. A secret input is consumed only by the credential broker path; it is never archived as a guide choice. A new step has a new id; successful action state is persisted before publishing the next step.

Core history is one monotonic cursor store. Snapshot shows a bounded latest page; getHistory({before,limit}) reaches older entries, limit1..200. Delta after returns the scanned cursor boundary, not an unscanned latest cursor. Renderer deduplicates only its memory projection by cursor and invalidates it when clear moves the cursor backwards.

Cortico public WebUiPageManifest JSON comes through existing panel contributions. Runtime/ui/worker and declared panel.entry artifacts all enter DiscoveredPlugin.files and source verification. Public metadata projection strips external client scripts/reserved builtins. Same-owner declared command actions execute in TaskSupervisor; pageId, panelId and owner generation must still match.

TSX_DISABLE_CACHE=1 selects the loader supported in-memory path so plugin runtime needs no shared global Temp transform cache. Keep cortico/* and tsx/* external in plugin ESM builds: upstream top-level await and provider-directory imports must retain their layout. Do not bundle the esbuild JavaScript API into native QA runners that compile fixtures.

## Validation & error matrix

| Trigger                                                  | Required behavior                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| missing/wrong owner or no active task on own config.save | deny; no cross-owner argument accepted                                                                                |
| stale expectedRevision                                   | conflict, preserve draft/data                                                                                         |
| config schema explicit full prompt bound                 | up to16384 code points; default remains4096;48KiB value byte budget still applies                                     |
| source artifact changed                                  | package-changed / review exact new fingerprint; never silently trust current discovery                                |
| network/credential provider setup                        | ask policy; local denies network and cannot mean cloud-ready                                                          |
| saved prefix candidate, Core session write fails         | applied revision remains old, error reported, same candidate can retry; do not generate until acknowledgment succeeds |
| agent deliberately stopped/removed/faulted at startup    | start recovery UI; migrate/attach only active generation; marker changes only after successful import                 |
| voiceEnabled=false                                       | real canRecord=false; prevent new recording and cancel voice intent/capture, preserve text path                       |
| stale guide/update/permission choice                     | reject; cannot approve newer task/state                                                                               |

## Good / base / bad cases

Base: fresh no-Key app starts the content-pinned page/profile/Core roles, pet guide saves canonical preferences, scripted pet input enters the same record shown by Settings.

Good: model configure_pet calls app.profile.change; provider-owned files/plugin-data lease prompts in the pet; allow commits one CAS revision; deny preserves data and acknowledged prefix.

Bad: treating successful save as successful reload, auto-trusting changed code during guide, setting a cloud source to local, keeping a second persistent DemoHistory writer, or hiding a failing setting behind defaults.

## Tests required

- SDK own save: foreign returned snapshot rejected, input copied/frozen, existing config.get fixtures unaffected.
- discovery.test: panel.entry content changed after discovery invalidates source.
- prefix-reload.test: a failed session reset keeps old acknowledged revision, blocks generation and retries same revision.
- application-backend-e2e: pet-only edits, exact stale CAS, ready-ASR voice disable, older page/delta coverage, Core clear, disabled-agent recovery and external page command/fault/config retention.
- application-model-e2e: real Core tools, exact ApprovalInbox owner/task/digest, allow/deny/replay/CAS, actual receipt-driven reply and canary exclusion.
- application-ui-acceptance: click real controls and keep native artifacts current; no media-consent bypass, no paid services. GUI CDP tests do not imply OS click-through/drag evidence.

## Wrong vs correct

Wrong: systemSegments consumes pending into current, then reload fails; UI says revisionN applied and equality guard skips retry.

Correct: systemSegments builds from pending, while current remains the last acknowledged profile. Advance current only after reload resolves, preserve failed candidate and permit retry; turn refuses generation while promptState=error.

Wrong: global snapshot-read sequence identifies a microphone session or stale async completion clears the next capture.

Correct: the active AbortController/session token owns capture across navigation; any cleanup after await must recheck that identity. Temporary history-page requests have a separate projection sequence and cannot repopulate a cleared record.
Normal startup regression: isolated --demo-acceptance checks do not cover an existing normal-profile process. Updating dist while the old main/preload/worker remains alive can mix new renderer files with the old API and registry. Before normal-launch acceptance, verify/close only the owned stale instance, preserve existing profile/vault/history, and confirm all primary page contributions plus native pet visibility using the normal profile. A repeat launch must reuse the current instance.

## Scenario: reference Start model setup and browser authorization

### 1. Scope / trigger

The Start model card crosses trusted Electron UI, configuration CAS, runtime capability selection, credential leases and browser OAuth. Contracts live in [model-connection](../../../packages/contracts/src/model-connection.ts), fixed endpoint facts in [model-services](../../../packages/contracts/src/model-services.ts); runtime methods are ordinary llm.responses@1 providers.

### 2. Signatures

ModelConnectionBridge exposes getSnapshot(), getModels({id,key?}), testSelected({id,model,key?,reasoningEffort?}), saveAndStart({id,model,expectedRevision,key?,reasoningEffort?}), testConnection(), openServicePage({id}), setPaused({paused}), startSignIn(), getSignInState(), cancelSignIn(). Preload enforces exact arity; Main validates exact keys and current trusted main frame. There is no caller-supplied URL, credential key or target owner.

CredentialBroker.registerManagedSecret({pluginId,instanceId},keyId,resolver) is host-only. An approved borrow may resolve {value,stored?,sensitiveValues?}; value is the access token delivered to the existing sensitive channel, stored replaces the encrypted record in the existing write queue. A permanent OAuth refresh refusal returns revoked:true; remove the encrypted token record and deliver no credential. SDK gains no setter, refresh token or raw broker object.

### 3. Contracts

- saveAndStart: fixed id; model≤128 characters; safe nonnegative expectedRevision; optional Key≤4096 characters. Reject control characters before configuration changes. Regional endpoints use distinct broker keys; historical DeepSeek retains api-key and its model field.
- Result.ok means the operation returned a receipt. Its test.ok separately says whether the model completed a real diagnostic generation. Test result has elapsedMs, optional reason/model; snapshot exposes endpoint metadata and Key presence, never decrypted values. testConnection remains the saved-active diagnostic; Start uses testSelected for its current draft. getModels/testSelected do not write config/Key or activate a provider. A typed Key is borrowed for one task; absent Key uses the existing encrypted credential.
- Save config/Key first as the reference does; a failed test does not revert saved data. After a successful probe, require the saved revision before activation. Select the actual provider, set reply mode and resume the real Core bus. Presets are preserved; kernel's initial ask policy is not a reason to overwrite an explicit deny.
- CredentialBroker.clientForHost owns the single lazy client per owner generation for runtime and host queries. Do not issue another client at the same generation or keep a second runtime map. withSecretForHost takes manifest-declared keys and may use one supplied Key without persisting it; existing authorization, cancellation and redaction still apply.
- reasoningEfforts[endpoint.id] persists default/low/medium/high alongside models. Missing legacy values mean default; explicit values reach nativeSpec and the actual protocol request. Provider/Key edits discard old Start catalogs and test receipts.
- Native provider fixtures must match the actual negotiated mode: Responses without onEvent uses stream:false and returns a JSON resource; browser plan uses SSE. A browser SSE fixture is not evidence for unary Responses. Keep fixture errors separate from product transport failures.
- All19 fixed endpoint providers fit existing manifest bounds. Group origins/keys in clauses of at most16; each respond/test method has its exact origin policy. Keep complete Generation, origin and attempts. Missing native usage remains unknown; diagnostic max_output_tokens256 accommodates the complete SSE receipt.
- Gemini opaque signatures remain in standard reasoning.encrypted_content. The Core proxy forwards only reasoning id and the four public ItemOrigin fields; it does not duplicate raw context or expose arbitrary metadata/blobs. Replay only a matching compatibility domain. Imported tool history uses Gemini's documented marker; no second history/cache is added.
- OAuth opens only the fixed authorization URL from the trusted Start action. PKCE S256, state, nonce and exact127.0.0.1 callback host/path bind the flow; duplicate/replayed callbacks fail. Verify RS256 JWKS, issuer, audience, expiry and nonce, and require chatgpt.tokens.use.direct. Public client registration metadata uses the existing config store; access/refresh tokens use the existing encrypted broker. Renewals serialize against current stored tokens and respect owner/task/key cancellation.
- Browser-plan setup reads authenticated visible model slugs before its initial diagnostic; the saved active test does not select another model. Namespaced tools and streamed terminal receipts retain structured output even when the service's terminal output array is empty.
- restore() reestablishes the saved provider binding without a model probe, credential decryption, mode change or automatic bus resume. Content pin or renewed exact source review remains required. A deliberate disabled marker prevents restoration. A successful retry clears the previous restore notice. Late state observation after ApplicationController.close cannot persist shutdown as user disablement.
- ApplicationSnapshot.desktop reports native operability and visibility. Guide success makes a hidden pet visible through canonical preferences and moves Settings aside; console capture ends before hiding it.

### 4. Validation & error matrix

| Condition                                                             | Outcome                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| unexpected frame, URL, arity or payload key                           | reject before management                             |
| stale revision before save                                            | conflict, no Key replacement                         |
| config revision changes during approved probe                         | conflict; no activation/binding/mode/resume          |
| network/credential denied or task cancelled                           | failed test; saved data remains, no false activation |
| browser login has no granted plan, bad state/identity or is cancelled | no new credential; failed/idle state                 |
| plan grants no visible model                                          | failed test, no invented default connection          |
| explicit deny during save/restore                                     | preserve deny; do not prompt or use Key              |
| source changed or not reviewed during restore                         | restore notice; keep recovery UI                     |
| provider omits usage                                                  | nullable/unknown meters, not zero-cost proof         |

### 5. Good / base / bad cases

Base: no Key, source-pinned page/Core startup and scripted interactions remain usable. Good: save a regional Key, allow the actual task/permissions, test one real generation, select its provider and resume; repeat startup restores only the binding. Bad: display 已连接 from Result.ok with test.ok=false, share one CN/intl Key, or run a model request merely to restore startup state.

### 6. Tests required

[Model workflow probe](../../../qa/probes/start-model-e2e.mjs) uses actual host/Core/approvals/media/config and a scripted model. Assert all18 API-key endpoints, denial/cancellation, exact CAS, no Key leakage, post-probe conflict, explicit deny and four new Host lifecycles with preserved user disable state. Its headless emulatedCipher is not DPAPI or an OS process-restart proof.

[OAuth tests](../../../apps/desktop/src/main/model-oauth.test.ts) exercise a real loopback callback with signed fixture identity, bad nonce/plan denial/cancel, same encrypted authority and renewal. [Broker tests](../../../packages/host-kernel/src/credentials/credential-broker.test.ts) assert concurrent renewal and that a newer manual replacement wins without storing runtime generation. [Protocol tests](../../../plugins/llm-provider/src/native-protocols.test.ts) assert actual requests, tool replay and unknown usage; browser-plan tests preserve complete streaming receipts and granted-model selection. No paid services or real account login in automated verification.

### 7. Wrong vs correct

Wrong: treat a successful RPC or Key presence as a successful connection. Correct: render test.ok/reason and actual snapshot.active separately from saved endpoint metadata.

Wrong: encrypt a runtime CredentialOwner object during renewal. Correct: normalize persistent owner to pluginId+instanceId, retain generation only in the active lease.

Wrong: flatten native Generation into text or discard Gemini signatures. Correct: reuse framework transport/attempts and preserve opaque standard reasoning in the one canonical session.

## Scenario: local theme studio and interactive Start preview

### 1. Scope / trigger

The reference theme editor changes persisted UI state from a mode string to a scheme record; Start reuses the real pet renderer, conversation and visible-expression receipts. These are UI-owner changes, not a new agent or data store.

### 2. Signatures

[Theme owner](../../../apps/desktop/src/renderer/console/theme.ts): readThemeState(), writeThemeState(next):ThemeWriteResult, subscribeTheme(listener), previewPalette(palette), resetPreview(), selectScheme(state,id):StoredTheme|null, saveSchemeAs(state,{name,palette,appearance}):{state,id}, saveCurrentScheme(state,{name,palette,appearance,schemeId}):StoredTheme|null, removeScheme(state,id):StoredTheme|null. These scheme operations are pure state changes; ThemeEditor persists the result through writeThemeState. Keep old mode-facing API for the sidebar. [ThemeEditor](../../../apps/desktop/src/renderer/console/theme-editor.tsx) accepts optional title/description and renders the complete section.

### 3. Contracts

- The single UI-only key remains pet.console.theme. StoredTheme={selectedId,mode,custom}; mode is light/dark/system. ThemeScheme={id,name,note,palettes:{light,dark},builtin?,custom?}. Builtins are code-owned, not duplicated into saved custom state.
- Migrate the existing bare mode to selectedId mint/custom empty. Normalize exactly36 known palette tokens; no arbitrary CSS property names. Hex accepts #rgb/#rrggbb, normalizes lowercase six-digit form. Scheme names≤40, notes≤80. Unknown/corrupt old UI preference returns the documented default, without a second store.
- Draft color preview is ephemeral. An invalid field shows its error without changing the last legal draft or durable state. Unmount/leave resets preview. Saving a custom variant retains the other appearance; builtin palettes cannot be overwritten. Delete requires a second activation within4000ms and disarms on relevant selection change.
- writeThemeState reports success only after storage write/readback. Side rail subscribes to the same owner; do not cache a separate mode or copy palette state into application config.
- Render36 reference CSS variables plus the existing ui-kit aliases, data-theme and color-scheme. System follows matchMedia changes. Preserve native keyboard zoom/reduced-motion behavior.
- Preview uses PetAvatar, PetComposer, demo.sendText and the existing ExpressionTimeline. One console Demo owner owns microphone/media, and the Core owns the one history. A visible expression receipt requires two frames plus visible document/preview; dispose invalidates old callbacks. No local message echo is a host reply.
- Run toggle reads actual agent readiness and Core paused state and remains accessible in the collapsed rail. Demo readiness queries that Core state: paused means no new chat/capture, and pausing ends the current owned capture through the existing cancellation path.

### 4. Validation & error matrix

| Condition                           | Behavior                                    |
| ----------------------------------- | ------------------------------------------- |
| invalid hex or unknown token        | reject field/token; retain legal draft      |
| storage quota or readback mismatch  | show failure; no saved success              |
| leave with preview                  | restore committed palette                   |
| delete window elapsed               | arm again, do not delete                    |
| unavailable Core                    | run action disabled with truthful state     |
| focus moves inside preview composer | keep composer mounted; Send must reach host |
| hidden/disposed preview             | no expression receipt                       |
| rejected text submission            | retain draft, no invented user/reply record |

### 5. Good / base / bad cases

Base: a bare dark preference still opens dark mint. Good: clone a builtin, edit/save its dark variant, switch light and restart; preserve both committed palettes. Bad: mark storage failure as saved, let a color draft persist after navigation, or clear a Send draft when only its click was seen but host rejected it.

### 6. Tests required

Theme unit cases cover migration, legal palette/variant operations, storage failure and delete semantics. [Real UI acceptance](../../../qa/probes/coopanion-start-ui-e2e.mjs) must exercise actual controls in the built Electron app at1200×800 and880×600: no horizontal overflow,248/72 rail,15 vendor groups, actual denied network save,36 colors/variant persistence/4000ms delete/leave undo, pause, native visibility, visible preview reaction/chat and two clean app lifecycles. Component/server rendering alone does not prove effect/focus/painting behavior.

### 7. Wrong vs correct

Wrong: close the composer from document.activeElement during a descendant blur; the browser can temporarily expose body and lose the Send click. Correct: use the blur relatedTarget to keep focus transitions inside the scene mounted.

Wrong: draw a local response or write a second chat history. Correct: submit to the current owner, adopt its receipt and project its canonical Core events.

## Start design review presentation

1. **Use when** comparing alternative Start information architectures after functional replication. The normal application still uses the baseline.
2. **Signatures**: unpackagedMain recognizes START_DESIGN_LAB_FLAG (--start-design-lab), selects isolated lab userData, and passes fixed START_DESIGN_LAB_ARG to the Console preload. The readonly marker is window.petDesignLab?: StartDesignLabPresentation {enabled:true}. StartDesign.render receives one StartContext and wired StartSlots {status,vendors,connect,pet,theme}.
3. **Contract**: no new business IPC or authority. Console URL is exact and unchanged; local review selection uses Reactstate. Existing unique acceptance profiles outrank the default lab profile. ConsoleApp retains application/model/capture/history owners; memory-only model/Key draft survives layout switching. Theme workspace exit unmounts the editor and withdraws unsaved preview. Guide remains one shell-title action.
4. **Boundary/errors**: packaged runs ignore the developer flag; no marker is exposed for normal rendering. Missing designs are visibly unavailable, not fake successes. Saved, tested and active remain distinct. Styles may be statically loaded but are scoped to lab classes; do not claim they are absent from the normal bundle.
5. **Examples**: variants consume the supplied slots once and read metadata from pure catalog.ts; registry imports variants. Do not import registry metadata from variant modules (top-level cyclic initialization), create a new recorder/provider poll, duplicate guide/Key fields, or use hash/query routing. Morphicons receives own24-gridglyphdata and reducedMotion=user or always; its default never is not used.
6. **Matrix**: normal native baseline remains valid; allfive review choices expose real forms/auth/regions/preview/theme. Test private drafts across choices, one Core user/reply per send, native pause/visibility receipts, theme rollback forspine/stage/workspaces, minimum880×600/zoom/focus/reducedmotion and isolated process restart. Shared backend regressions run once, not five times per layout. When extracting positive availability guards, verify the actual button output for both states: disabled={!saveEnabled(...)} must not become disabled={saveEnabled(...)}. A pure guard test alone does not establish its component wiring.
7. **Completion evidence**: fullcheck plus actual accepted native reports/screenshots, asset provenance/notices, and explicit live-account/model limits. Component/static output or existing reference screenshots alone do not establish new native/layout success.

## Original Start presentation

1. Use when an accepted functional replica is being given its own product identity. Reuse state/actions, not the reference widget markup.
2. Start now consumes useStartModel and original-ui controls. New model/provider/receipt/preview/theme controls render in normal and all five review layouts; the fixed Main/preload URL/profile boundary is unchanged.
3. The single config/credential/Core/capture/history/theme owners remain authoritative. Builtin theme migration maps legacy selections to original IDs and preserves custom palette values, order and mode. Own character assets may be shared; old preview chrome is not a visual dependency.
4. Native controls carry state: positive can.save/can.test are inverted only at disabled, saved/tested/active receipts remain distinct, current selection alone does not prove unsaved work. No active provider must not be described as a different active provider.
5. Native details onOpenChange reports a value: set that value rather than blindly flipping on every toggle, including mount events. Menus, fields and switches must retain real label/focus/disabled behavior.
6. Verify visible nonzero unclipped avatar and usable preview width in each actual container; viewport-only breakpoints do not protect narrow columns. Test saved-key/probe-denied truth, all36theme fields/CRUD/undo, migration, retained drafts/history, actual native visibility/pause/guide and restart.
7. Originality needs actual whole-window and control closeup review against the rejected predecessor. Absence of old classes, a new palette or functional pass alone does not establish a coherent original component language. The state board is labelled as design samples, not fake backend receipts.

## Plugin desktop-pet MVP

The current module ownership, speech.output contract, hidden capture-owner lifetime, revision-bound editor drafts and owner-scoped runtime invocation rules are maintained in [the canonical MVP guide](../../../docs/plugin-pet-mvp.md). Follow that guide when extending these surfaces; keep active page contributions and config/permission/media authority in the existing kernel. Native evidence is [recorded here](../../../qa/plugin-pet-mvp/README.md).

## Compact plugin management

1. **Scope / trigger:** the plugin-list state control consumes the existing lifecycle target through the Kernel → Console snapshot → renderer projection.
2. **Signatures:** PluginSnapshot.desiredActive:boolean and ConsolePlugin.desiredActive:boolean are required readonly projections. Existing onOpenConfig(plugin) and onAction(plugin,action) callbacks remain unchanged.
3. **Contracts:** desiredActive is Entry.desired, not a new store. Enable sets the target true; disable sets it false. Availability remains state and may be unready or failed while the target is true. Card navigation matches all three owner fields (pluginId, instanceId, generation) against current contributed pages, otherwise opening the existing schema editor under the dirty-draft guard.
4. **Validation / errors:** existing actionsFor, pending and host rules still gate actions. Protected plugins cannot be stopped or removed; protected unready/failed plugins whose target is already enabled retain an explicit repair retry through the existing enable action. Rejected plugins cannot be enabled; activating/deactivating/pending_restart cannot accept lifecycle actions. Operation errors retain their actual returned snapshot. Removing the config button never deletes saved config.
5. **Cases:** base disabled/false enables; good unready/true still has an on switch that can request disable; bad active-only inference would falsely display an off switch after a failed activation. Nested switch, uninstall and permission actions must not navigate.
6. **Tests:** [target regression](../../../packages/contract-tests/src/plugin-target.test.ts) covers disabled → unready → disabled → active → failed → disabled with target assertions. Plugin page tests cover controlled callbacks, pending/protected states and removed copy. [Serial native probe](../../../qa/probes/plugin-list-cleanup-native.mjs) checks actual receipts, card whitespace/keyboard navigation, icon uninstall, theme persistence and minimum-window containment.
7. **Wrong vs correct:** do not use checked={state === 'active'} or an optimistic local enabled cache. Read checked={plugin.desiredActive}, request disable when true and enable when false, and render the next authoritative snapshot.

## User-selected desktop permission and bubble defaults

The2026-11-03 user instruction selects allow for initial desktop source registrations, including user plugins, through the existing preset system. Do not overwrite it with application-specific ask/local values; explicit current-session policy edits remain effective. The reusable kernel still defaults to ask outside this desktop adapter. Bubble motion, exact dark/light geometry and verification are maintained in [the canonical bubble note](../../../docs/pet-bubble-design.md).

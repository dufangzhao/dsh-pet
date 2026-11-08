# Shared desktop entry: implementation contract

Status: planning freeze candidate, 2026-11-08. This is the sole task-local source for exact new types, fixed IPC operations and host-private ports. [PRD](prd.md) owns requirements; [design](design.md) owns decisions; [implementation plan](implement.md) owns order/acceptance. GPT writes the declarations first and signals the frontend handoff before DeepSeek implements against them. Names below are proposed new declarations, not claims that source files exist.

## 1. Ownership and files

Browser-safe declarations go in `packages/contracts/src/desktop-companion.ts` and `companion-profile.ts`, exported from the existing contracts root. Main-only types/ports go in `apps/desktop/src/main/companion-client-types.ts`; no Node/Electron/host-kernel imports enter renderer contracts. Existing CompanionSnapshot, message/task/model commands, Result and KernelError remain canonical; do not fork them into desktop versions. [Current wire declarations](../../../../../packages/contracts/src/companion.ts) and [model declarations](../../../../../packages/contracts/src/companion-model.ts) remain unchanged except the independent profile-read addition.

`pet.companion-client/default` is an ordinary removable desktop source. Manifest v1, platform list exactly `win32-x64`, `linux-x64` for this stage, runtime entry `dist/index.mjs`, Config v1 `{baseUrl:string}` with empty default, max2048 characters and immediate application. Runtime describe reads current own Config through config.get rather than retaining ctx.config; Main owns connection retirement on every committed revision, so endpoint changes need no stateless plugin reload. Permissions: files/plugin-data/read-write for own configuration/source authority and credentials key `service-token`. Its runtime provides `companion.client@1` provider `client` with method `describe(_task, null)` returning exactly `{version:1,baseUrl:string,configRevision:number}` from current own Config, no token; describe methodPermissions require files/plugin-data/read. No Core, conversation store, worker execution or credential setter in this plugin. Optional fixed JSON panel contribution can expose its existing desktop connection view; it does not load remote scripts.

Main is the host-provisioned HTTP adapter for this source. Arbitrary user-selected endpoint transport is **not** granted by pretending the generic literal-HTTPS network permission supports it. Exact endpoint selection plus source/config/credential leases bind this native port, following the [existing provisioned model transport](../../../../../apps/companion-service/src/model-client.ts#L18); no wildcard permission or SDK-wide fetch interface is added.

## 2. Endpoint, token and identity

Accept an explicit absolute HTTP or HTTPS **service root**: normalized URL origin, optional trailing `/`, no username/password, query, fragment or non-root path; reject all other schemes and whitespace/control characters. Store the normalized origin as `baseUrl`. This supports the known LAN trial as well as loopback/HTTPS without hardcoding a private address. It is a desktop owner-input exception to the research's conservative HTTPS/loopback suggestion, not a model-gateway auth-policy change. All requests use fixed `/api/*` paths, `redirect:'error'`, `credentials:'omit'`, `cache:'no-store'` and Authorization header. No renderer-specified relative path or HTTP method.

Token: explicit console input only,24–512 UTF-8 bytes, reject control characters; never persisted or included in Config/DTO/log/error/URL/argv/receipt fingerprint. The input is cleared immediately after invocation. Main holds a session-only token slot; no old desktop, DSH or service-launch credential import. It borrows through existing CredentialBroker supplied-secret leases; use the existing memory-only broker pattern if safeStorage is unavailable, with persistence operations refused. Do not invent encryption or require Linux keyring setup for process-only auth.

Serialize connection control transitions (connect/reconnect/disconnect) and return conflict for another concurrent transition; ordinary independent requests do not share a global lock. connect.expectedRevision refers to state.configRevision (source Config CAS), not state.revision (projection ordering). A successful configuration CAS precedes retirement. A rejected CAS does not destroy the current connection/token. After commit, synchronously fence the predecessor and retire its token before fallible cleanup. A new activation waits for actual local drain; timeout/unconfirmed drain leaves unavailable, no replacement. Connect with the same target and a new token is also a new generation. Only reconnect of the current generation may reuse its token/uncertain intents; token clearing, explicit disconnect, source retirement and process exit require new input.

## 3. Browser-safe state and bridge

```ts
interface CompanionProfileView {
  readonly agentId: string;
  readonly name: string;
  readonly persona: string;
  readonly revision: number;
}
interface DesktopCompanionPending {
  readonly commandId: string;
  readonly kind: 'message' | 'stop';
  readonly taskId: string | null;
  readonly status: 'sending' | 'uncertain' | 'accepted';
}
interface DesktopCompanionState {
  readonly version: 1;
  readonly revision: number; // Main-local projection order, monotonically increasing
  readonly source: 'ready' | 'disabled' | 'unavailable';
  readonly baseUrl: string; // saved nonsecret endpoint, empty until configured
  readonly configRevision: number;
  readonly connectionId: string | null; // fresh UUID, never a Session or service Agent ID
  readonly phase: 'idle' | 'connecting' | 'live' | 'offline' | 'retiring';
  readonly confirmedAt: number | null;
  readonly snapshot: CompanionSnapshot | null;
  readonly pending: readonly DesktopCompanionPending[];
  readonly error: KernelError | null;
}
interface DesktopCompanionTarget { readonly connectionId: string }
interface DesktopArtifactSave {
  readonly status: 'saved' | 'cancelled';
  readonly name: string;
  readonly sizeBytes: number; // 0 for cancelled; never a local absolute path
}
interface DesktopCompanionBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopCompanionState>>;
  onChanged(listener: () => void): () => void;
  connect(input: { readonly expectedRevision: number; readonly baseUrl: string;
    readonly token: string }): Promise<Result<DesktopCompanionState>>;
  reconnect(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  disconnect(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  refresh(input: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>>;
  sendMessage(input: DesktopCompanionTarget & CompanionMessageCommand):
    Promise<Result<CompanionCommandReceipt>>;
  stopTask(input: DesktopCompanionTarget & CompanionStopCommand & { readonly taskId: string }):
    Promise<Result<CompanionCommandReceipt>>;
  stopForeground(input: DesktopCompanionTarget): Promise<Result<null>>;
  readProfile(input: DesktopCompanionTarget): Promise<Result<CompanionProfileView>>;
  readTask(input: DesktopCompanionTarget & { readonly taskId: string }):
    Promise<Result<CompanionTask>>;
  saveArtifact(input: DesktopCompanionTarget & { readonly artifactId: string }):
    Promise<Result<DesktopArtifactSave>>;
  saveModel(input: DesktopCompanionTarget & { readonly command: CompanionModelSaveCommand }):
    Promise<Result<CompanionModelView>>;
  testModel(input: DesktopCompanionTarget & { readonly command: CompanionModelTestCommand }):
    Promise<Result<CompanionModelView>>;
}
```

Expose only `window.petCompanion`, frozen, with disposable callbacks. IPC constants `DESKTOP_COMPANION_IPC`: key `changed` maps to `companion:desktop:v1:changed`; every other key is the exact method name above and channel `companion:desktop:v1:<method>`. `getState` takes zero arguments; every operation takes exactly one object; changed carries no DTO or credential. Main validates exact keys/arity, bounded JSON, current trusted main-frame sender ID and exact expected file URL using the [existing source check](../../../../../apps/desktop/src/main/ipc-request.ts#L24). Both pet and console may read/subscribe/refresh/send/stop/readProfile/readTask/saveArtifact. Only console may connect/reconnect/disconnect/saveModel/testModel. No credential getter, generic request, history clear, persistent pause, Harness switch, plugin-admin HTTP or gateway-key relay. stopForeground generates the required wire commandId in Main but retains the existing Result<null> semantics, without inventing durable deduplication.

All IDs reuse the current service ID grammar; message text is nonempty trimmed and≤8000 UTF-16 code units (`text.length`), matching [the actual service validator](../../../../../plugins/state-sqlite/src/validation.ts#L27). UI maxlength/counters and Main admission must use the same unit; supplementary Unicode characters count as two. Do not silently replace this with code-point counting. Pending list≤16 items; exceeding it returns quota-exceeded before I/O. Pending metadata is Main-owned, not an optimistic canonical message. It contains no text; renderers retain their draft and command ID. New deliberate sends use a new UUID; an uncertain unchanged retry uses its original UUID. Changed payload with an existing command ID returns conflict. An uncertain stop retains the same task/command pair. Confirmed messages remove corresponding pending records by inputId; terminal task facts clear stop records. Bounded omission cannot prove an uncertain message never existed. No automatic resend on reconnect.

For connect/reconnect/refresh, Result.ok means the attempt returned its current authoritative local state, not that the service is live; inspect phase/error/configRevision. Pre-admission invalid-input/conflict/disabled-source returns Result failure without mutation. After endpoint CAS commits, transport or drain failure returns the saved/current state with its error rather than pretending the endpoint was not saved. Disconnect completes only after successful local drain; unconfirmed cleanup returns the retiring/unavailable state and prohibits replacement.

One `/api/snapshot`+fetch-SSE owner updates `snapshot`; command responses never replace it. Successful commands schedule a coalesced refresh. Increment Main revision for every public state change; renderers only accept newer reads and fence all async actions by connectionId. Profile/model form completions cannot overwrite a new target's draft. Old connection requests return stale-owner/cancelled and cannot publish state. `snapshot` can remain for failed refresh/offline/explicit disconnect (with stale labeling); an explicit new connect clears old target projection/pending after committed selection. Local projection revision never resets within the process. No profile body is duplicated into state.

Wire responses retain the existing≤64KiB service boundary. Direct Electron `getState` aggregate has its own≤80KiB ceiling for one unmodified bounded service snapshot plus≤16 pending metadata/local fields; it never passes through supervisor JSON. Supervisor operations return null and retain native values privately. Do not trim facts/history a second time to satisfy this envelope. Profile read remains a separate≤64KiB Result. Boundary overflow fails explicitly.

## 4. Local presentation contract

Expose `window.petLocalPresentation` as a second frozen fixed facade; it is local state only. Define `DesktopPresentationPreferences = Pick<ApplicationPreferences, DesktopPresentationKey>` and a shared constant key tuple exactly:

```text
figure palette size visible alwaysOnTop draggable reducedMotion
bubbleFontSize bubbleSpeed glow hover doubleClickTyping statusBubble saidBubble
hideInFullscreen rememberPosition lockFps frameRate
soundEnabled soundMove soundTouch soundFace soundSnore soundUi
speechEnabled speechProvider speechVoice speechRate speechVolume
```

```ts
interface DesktopPresentationSnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly preferences: Readonly<DesktopPresentationPreferences> | null;
  readonly desktop: { readonly available: boolean; readonly shown: boolean };
  readonly error: KernelError | null;
}
interface DesktopPresentationBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<DesktopPresentationSnapshot>>;
  onChanged(listener: () => void): () => void;
  save(input: { readonly expectedRevision: number;
    readonly patch: Partial<DesktopPresentationPreferences> }):
    Promise<Result<DesktopPresentationSnapshot>>;
}
```

`DESKTOP_PRESENTATION_IPC` keys snapshot/save/changed map to `companion:presentation:v1:<key>`. Reads/changed both windows; save both trusted windows. Validate nonempty exact allowlist patch, merge into the existing profile record, CAS through ConfigService, preserve every excluded field verbatim. No new configuration file/store for the same display values; theme keeps its existing owner. Do not accept full ApplicationPreferences from shared UI. Absent/unsupported profile yields null preferences+not-ready; QA-only fixed presentation props must be explicitly identified, never persisted as a fake working profile.

On Windows keep the actual profile/avatar/needed page/audio plugins active under existing admission. No local Core is required to read/save display state. Retain the existing pet/window, settings launcher, presentation-theme and speech-output bridges. Shared preload does not expose legacy `petDemo`, `petModels` or `petApplication`; their channels are absent/denied in the shared Main. Local permission dialogs may use the existing ApplicationDialog DTO plus existing security approval route; they do not run the legacy conversational guide. Ordinary chat uses service name; excluded local petName/persona fields are retained archives, not active persona. Physical reactions stay ephemeral and do not invoke legacy interact.

## 5. Profile HTTP and wire reuse

Add `GET /api/profile`, same bearer/origin/no-store checks as snapshot. Return `Result<CompanionProfileView>` from existing canonical runtime profile plus stable assistant identity; never raw Config data, model fields, credentials or internal Session. Name≤80 and persona≤16384 Unicode code points (`[...text].length`), as enforced by [the existing Config validator](../../../../../packages/host-kernel/src/config/schema.ts#L65) and [profile field schema](../../../../../packages/companion-runtime/src/core-plugin.ts#L52); these differ deliberately from the message UTF-16 limit. Positive safe revision; agentId uses service ID grammar. Bound the full UTF-8 Result≤64KiB; explicit quota-exceeded if the legal string set cannot fit. Profile is read-only; no schema/version change or persona write endpoint. Client accepts profile only for the current snapshot agentId and matching profileRevision, otherwise reports conflict and schedules refresh (no retry loop).

Add explicit non-React package export `@pet/text-client/protocol` and declarations. It reexports existing DTO guards, SseDecoder, HTTP functions and pure task/projection helpers; no client.ts/App/React/document/native plugin activation. GPT alone owns this export and any shared protocol edits. Existing web behavior/tests stay intact.

Existing HTTP helpers gain optional trailing AbortSignal arguments for commands/model/artifact; current browser callers remain valid. Every request combines operation/connection signal with20s ordinary JSON deadline. SSE retains45s byte-liveness watchdog, comments renew it, and cancellation aborts/cancels/releases the reader. Add `getProfile`+guard, `stopForeground`, and `getTask`+guard for an explicitly opened truncated task. `getArtifact` gains bounded streaming use for Main: export a fixed `fetchArtifact(transport,id,signal)` yielding an authenticated Response with checked status; the Main consumer owns byte limits and file write. Browser getArtifact still returns Blob. No arbitrary-path public helper. Redirects are rejected for both browser and Main helpers.

Model save/test preserve current command/CAS/native semantics. Desktop projection forcibly sets every model credential.writable=false even when the native loopback request would make server ingress appear local. There is no Main method forwarding `/api/model/credential`. Save/test result views are form-local operation results only; authoritative global model view remains snapshot-owned.

### Controlled model UI export (console only)

Export `ModelDialog`, `ModelDialogProps` and the existing `ModelTransport` type through `@pet/text-client/model-ui`; export the extracted stylesheet through `@pet/text-client/model.css`. The protocol subpath remains non-React and must not reexport this UI entry. The [existing ModelTransport](../../../../../plugins/text-client/src/client/model-form.ts#L465) remains the exact three-method saveModel/testModel/writeModelCredential interface; retain the existing form state machine and operation helpers rather than copying/reimplementing the dialog or its form logic.

```ts
interface ModelDialogProps {
  readonly open: boolean;
  readonly view: CompanionModelView | null;
  readonly live: boolean;
  readonly agentStatus: CompanionAgentView['status'] | null;
  readonly transport: ModelTransport;
  readonly onClose: () => void;
}
```

The component no longer imports/types against CompanionClient or ClientState. Web App passes its existing snapshot.model/null, live fact, agent.status/null and current CompanionClient as the structural transport; behavior, CAS, explicit test, key input rules and draft-generation handling remain unchanged. Desktop console passes the current connection-scoped projected model facts and a small adapter over the fixed bridge, keys the component by connectionId and closes it when that generation retires. saveModel/testModel call their exact bridge methods and preserve real Result failures. Its required writeModelCredential method returns `Result` failure with `makeError('permission-denied',false)` immediately: **zero Main invocation and zero HTTP behavior**, no success placeholder. Every native model view/result still forces credential.writable=false, so no key input/remove action is reachable through normal desktop UI. Add a direct adapter regression in addition to checking hidden input.

The UI entry must not import text-client App/main/hooks, its full page stylesheet, or mount another client/root. React/react-dom and @pet/ui-kit remain external in any reusable ESM UI build, avoiding a second React copy; the existing standalone browser bundle retains its current packaging. Add source/type exports following current package conventions plus separate reusable ESM/CSS build artifacts; UI has no automatic page-style import. Web and desktop console explicitly import the same extracted model.css once. GPT owns package/build/export changes, the props-only model.tsx adaptation, its Web App caller and corresponding tests; broader UI-kit/component/style work requires parent coordination.

[Current DialogProps](../../../../../packages/ui-kit/src/dialog.tsx#L5) has **no className prop**, and Dialog renders inline as a native dialog rather than portaling it. Do not assume className support or change ui-kit for this slice. Wrap both normal and missing-view dialog branches in `.tc-model-dialog`; extract the [existing model rules](../../../../../plugins/text-client/src/client/styles.css#L204) and their narrow-screen overrides into model.css, prefixing the dialog/content/footer/control/field selectors with that wrapper. Preserve [open]-only layout so a closed modal stays hidden. No unscoped `.pk-dialog` overrides, html/body/#root rules, universal reset, page shell/chat/task styles or root theme declarations belong in model.css. Preserve existing dimensions, scrollable content, fixed footer,≤760px layout and focus/escape behavior; this is CSS extraction/scoping, not a redesign.

The [ui-kit root](../../../../../packages/ui-kit/src/index.ts#L7) itself imports theme.css with a [root background declaration](../../../../../packages/ui-kit/src/theme.css#L47). Therefore the model-ui export is **only mounted/imported by the desktop console**, which already consumes ui-kit. Pet consumes protocol/types/status and uses the settings launcher to reach console model settings; pet never imports model-ui/model.css or a shared barrel that pulls them in. No ui-kit export/style modification is authorized by this props/export adjustment. Verify the actual built pet dependency/CSS graph and computed html/body backgrounds before/after loading and closing the console model dialog: the pet must stay transparent, and unrelated console dialogs must keep their existing layout. A static source grep alone does not establish visual isolation.

Required handoff tests: structural transport accepted without CompanionClient; same existing web rendered/native model behavior; native nonwritable key presentation and denied no-I/O credential adapter; stale connection keyed remount cannot apply old form results; scoped CSS excludes page/global selectors, closed dialog hidden, small-window footer/scroll/focus reachable, transparent pet unaffected. DeepSeek imports the controlled export and never copies the360-line form as a fallback.

## 6. Host-private port and physical lifetime

The Main controller is `DesktopCompanionController`; native dependencies use this task-specific interface, not the SDK/public bridge:

```ts
interface DesktopCompanionSource {
  readonly owner: OwnerRef;
  readonly digest: string;
  readonly policyEpoch: number;
  readonly configRevision: number;
  readonly baseUrl: string;
  readonly signal: AbortSignal; // active source lifetime, private
}
interface DesktopCompanionEndpointSave {
  readonly baseUrl: string;
  readonly configRevision: number;
  readonly source: Result<DesktopCompanionSource>;
}
interface ArtifactSaveCommit {
  readonly source: DesktopCompanionSource;
  readonly connectionId: string;
}
interface DesktopCompanionHostPort {
  readEndpoint(): Promise<Result<{ readonly baseUrl: string; readonly revision: number }>>;
  readSource(): Promise<Result<DesktopCompanionSource>>;
  saveEndpoint(baseUrl: string, expectedRevision: number):
    Promise<Result<DesktopCompanionEndpointSave>>;
  onConfigurationCommit(listener: (revision: number) => void): () => void;
  isCurrent(source: DesktopCompanionSource): Promise<boolean>;
  withToken<T>(source: DesktopCompanionSource, token: string,
    signal: AbortSignal, operation: (token: string, signal: AbortSignal) => Promise<T>,
    commit?: ArtifactSaveCommit): Promise<T>;
}
interface DesktopArtifactDestination {
  choose(name: string, senderId: number, signal: AbortSignal): Promise<string | null>;
}
```

`readEndpoint` is a host read of the source's nonsecret Config and remains usable while that installed source is disabled; `readSource` additionally requires actual active generation, verified package and permitted policy. Neither method auto-enables a deliberately disabled/removed source. Startup honors existing builtin-removal and `host.application-state/default` disabled markers; a small shared controller reads/updates only the existing disabled list through FileConfigStore CAS while preserving every other ledger field, without constructing legacy ApplicationController or rewriting legacyMigrated/guide state. New source defaults enabled only when no deliberate marker says otherwise. Persist only the acted-on plugin's actually adopted desired intent; outer Result.ok or another installed source's default desiredActive=false is not evidence. An adopted stop can remain pending_restart and still persist disabled; pre-admission failures cannot change markers. `saveEndpoint` outer failure means no CAS commit; outer success always retains the committed record's endpoint/revision even when its nested source check fails or throws. Connect reports those saved facts with unavailable state and performs no unauthorized requests.

`withToken` creates an existing TaskSupervisor task for source.owner, obtains declared files/read source lease and service-token credential lease, combines all abort signals, verifies current source/policy/revision before admission, on event publication and return, captures native response/error outside JSON, returns null to supervisor, then awaits actual work and handle.settled before release. SSE is one such tracked operation without an arbitrary overall timeout; its heartbeat watchdog bounds silent failure. JSON/download operations are separate tracked tasks. A cancelled operation never retires unrelated current-generation calls unless their shared source/binding is invalid. Source disable/revoke/source-generation change retires all connection calls. No unrestricted core token bypass.

The remote-worker plugin cannot call a Main closure through its ordinary JSON capability. Therefore DesktopHost's private composition option is exactly `companionLifecycle?: { readonly sourcePluginId: string; stopFor(owner: OwnerRef): Promise<void> }`, bound to `DesktopCompanionController.retireSource(owner): Promise<void>` before source activation. A narrow RuntimeDriver decorator forwards start to the existing remote driver; only for that exact client source it wraps RuntimeSession.stop. The wrapper starts `stopFor(owner)` (which fences immediately) and the original session.stop, awaits both actual settlements even when one fails, and propagates cleanup failure so PluginManager cannot report a clean replacement. Source faults also fence/drain this owner before completing their host cleanup. The decorator adds no new plugin class, worker protocol or generic SDK method. QA's actual-platform composition uses the same lifecycle wrapper. Tests must prove disable/uninstall waits for real Main stream/download settlement, not merely a changed notification or resolved cancellation Result.

A successful ConfigService save of this source fences the old binding before save returns, whether through connect or generic SDK/host save. Reuse the companion host's observed-save pattern at the desktop adapter; do not change kernel CAS ownership. `onConfigurationCommit` is source-specific and notification-only: observer faults cannot turn an already committed CAS into an uncommitted error. The normal commit observer fences; connect holds new token only after its own save result and awaited predecessor drain. Other config writers clear auth and leave endpoint awaiting explicit connect.

Artifact save: validate ID against current snapshot or checked task-detail response. Choose a destination owned by Main/native dialog, then fetch from its fixed authenticated route. Max64MiB per file and120s transfer deadline; verify announced metadata/Content-Length when present and exact final byte count. Stream into an exclusively created same-directory temporary file. Recheck binding after awaits and before rename; only then atomically publish the file at the user-approved path. Cancellation/retirement removes only the verified owned temporary file; do not overwrite an existing final file after a stale chooser or silently report success. Native overwrite confirmation belongs to the actual dialog. No filesystem path comes from renderer input or service download headers. No JSON transfer of artifact bytes.

Final file publication has a narrow Main-owned commit boundary: enter only while the binding is current, then retirement waits any already-entered rename to settle before a replacement can activate. No rename begins after the retirement fence. If an already-entered rename actually committed while stop raced, preserve that local saved-file fact under the original operation; never claim rollback or present its receipt as the new target's action. A per-save private ArtifactSaveCommit binds the captured source object and connectionId. Only the artifact module records the exact successful Result identity in a private WeakMap after real rename completion; native credential/task and controller fences preserve only that recorded outcome for its original caller. Saved-shaped payloads, uncommitted results and failures never gain this exception, and no result is adopted into a replacement's projection. Redaction still checks decoded own string values/keys through the existing SecretRedactor without serializing native values/errors. No general filesystem transaction layer is introduced.

`retireSource(owner)` only fences/drains that owner's Main resources; it never recursively calls PluginManager.disable/shutdown from inside RuntimeSession.stop. Controller retirement aborts all readers/requests/chooser ownership, prevents new admission, waits actual I/O and source tasks, closes token leases and clears token, then settles. A native OS chooser that cannot be physically cancelled can finish later, but its result is fenced and cannot start a download; report this local pending cleanup honestly and do not use its result for a new binding. Disconnect never sends foreground/task stop. Network failure leaves current memory token for manual reconnect; auth refusal has no automatic retry, and explicit reconnect can retry only the same target. New target/auth needs connect with new token.

## 7. Shared-startup admission fence

Shared Main does not construct DemoController, legacy ApplicationController, ModelConnectionController/ModelOAuth or VoiceInputController/restore. The deny set is legacy `pet.agent-cortico`, `pet.llm-provider`, `pet.chat`, `pet.voice-chat`, `pet.asr-local`, `pet.asr-cloud`, `pet.audio-capture`, `pet.talk-key`; these source roles cannot start in this composition through startup, dependencies, generic enable, restore, guide/page commands or model/provider handlers. Keep packages/data available as historical installations where possible; the shared host admission policy rejects their activation with not-ready, without changing core PluginManager compatibility. No legacy data read/import and no schema migration that changes identity/persona/history values.

`pet.profile` generic config saves in shared mode must compare excluded fields to the current record and reject changes; shared UI uses allowlisted presentation.save. Runtime app.profile.change can only reach the same allowlist if retained. A page command cannot activate forbidden roles indirectly. Local stop-all refers only to local I/O/playback and is labeled accordingly; service tasks require exact targeted stop. Retained Windows-native QA using legacy fixtures remains separately labeled, not rewritten to pretend shared startup needs one Core.

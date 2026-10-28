# Plugin-owned console pages and reusable management contracts

Status: historical pre-Cortico proposal. The later Cortico research and current design supersede the standalone console-page/page-command and custom agent-loop portions. Current host source/authority evidence remains useful; do not implement the obsolete protocol from this file.

Research only, 2026-10-28. No product implementation or task-state changes are part of this document. The parent session owns backend implementation.

## Recommendation

Add one controlled `console-page` contribution to the existing manifest/registration path. Render its typed descriptor with host components, bind generic settings to the contributing plugin's own configuration, and bind generic buttons to that plugin's declared commands. Keep the existing runtime, owner generations, task supervisor, config service, permission kernel, and credential broker. Do not load plugin scripts into the console renderer.

Use five thin, normally manageable page plugins for Start, Habits, Appearance, Conversation, and Voice Input. They register audited application UI; existing ASR, model, avatar, and conversation providers remain ordinary peers under the same plugin standard. Put shared settings/plugin operations behind one host-owned discover/inspect/validate/change service. The trusted console and a future authenticated model-tool adapter call that service through different, explicitly scoped clients. This iteration delivers those interfaces and their behavior, not an LLM tool loop, arbitrary code generation, or package installation.

The only additional persistence needed for page lifecycle is an extension of the existing host builtin-policy ledger to remember deliberately disabled pages and restored pages awaiting enablement. Configuration remains in FileConfigStore. The generic SQLite/Drizzle examples in [database.md:1](../../../../.trellis/spec/backend/database.md#L1) describe a template; the production composition explicitly constructs FileConfigStore in [desktop-host.ts:149](../../../../apps/desktop/src/main/desktop-host.ts#L149). They are no reason to introduce a database.

## What the source actually implements

| Concern | Exact evidence | Reuse or implication |
| --- | --- | --- |
| Single plugin model | [ADR-0010:9](../../../../docs/adr/0010-unified-plugin-model.md#L9), [ADR-0010:15](../../../../docs/adr/0010-unified-plugin-model.md#L15) | UI/provider/orchestration are responsibilities of the same manifest and lifecycle. Builtin origin is neither a tier nor automatic authorization. |
| Controlled UI | [ADR-0001:20](../../../../docs/adr/0001-controlled-ui-contributions.md#L20), [contribution.ts:1](../../../../packages/contracts/src/contribution.ts#L1) | Plugins cannot modify arbitrary host DOM. Host owns theme, navigation, permissions, cleanup. |
| Present contribution shapes | [contribution.ts:11](../../../../packages/contracts/src/contribution.ts#L11), [contribution.ts:46](../../../../packages/contracts/src/contribution.ts#L46) | Commands, buttons, hotkeys, settings-section IDs, and panel entry paths exist; none is an executable console-page integration. |
| UI paths are not a UI loader | [manifest.ts:59](../../../../packages/contracts/src/manifest.ts#L59), [discovery.ts:102](../../../../packages/host-kernel/src/runtime/discovery.ts#L102), [discovery.ts:185](../../../../packages/host-kernel/src/runtime/discovery.ts#L185) | Discovery hashes entries.ui; runtime loader imports entries.runtime. No renderer mount/bridge/lifecycle is supplied by naming a UI path. panel.entry is only declarative here. |
| Manifest checks | [validate.ts:130](../../../../packages/contracts/src/validation/validate.ts#L130), [validate.ts:161](../../../../packages/contracts/src/validation/validate.ts#L161) | Extend existing closed schema, unique-ID checks, and same-manifest command cross-references rather than add a separate page catalog format. |
| Registration transaction | [plugin-manager.ts:359](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L359), [plugin-manager.ts:373](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L373) | A runtime must register every declared contribution; no publication before ready. Failure aborts and cleans the activation. Non-command contributions take no handler. |
| Actual visibility | [plugin-manager.ts:478](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L478) | Only active registered contributions are returned. The more general policy table at [lifecycle.ts:50](../../../../packages/contracts/src/lifecycle.ts#L50) says unready/failed can show contributions, but the manager does not currently do that. Follow the manager for this change. |
| Stop/fault/removal | [plugin-manager.ts:405](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L405), [plugin-manager.ts:429](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L429), [plugin-manager.ts:460](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L460) | Abort and clear contributions/providers before awaited cleanup. Failed cleanup is pending_restart; uninstall removes registration only after successful cleanup/removal. |
| Resource effects | [cordis-driver.ts:30](../../../../packages/host-kernel/src/runtime/cordis-driver.ts#L30), [cordis-driver.ts:63](../../../../packages/host-kernel/src/runtime/cordis-driver.ts#L63) | ctx.effect and returned disposers already unwind in reverse order. Use these for plugin resources; use React cleanup for host-rendered page subscriptions. |
| Identities | [identity.ts:2](../../../../packages/host-kernel/src/runtime/identity.ts#L2), [plugin-manager.ts:232](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L232), [plugin-manager.ts:278](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L278) | Storage uses pluginId + instanceId; execution adds generation and abort signals. Each activation changes generation. Never put generation or page title into a persistent config key. |
| Console currently loses page metadata | [console.ts:35](../../../../packages/contracts/src/console.ts#L35), [console-snapshot.ts:13](../../../../apps/desktop/src/main/console-snapshot.ts#L13) | Snapshot exposes owner/id/kind/title only. Add the typed page descriptor projection, not paths or runtime objects. |
| Fixed navigation/rendering | [pages.ts:2](../../../../apps/desktop/src/renderer/console/pages.ts#L2), [console-app.tsx:361](../../../../apps/desktop/src/renderer/console/console-app.tsx#L361) | Both a fixed array and a component switch must be replaced for primary pages. Moving their files into a plugins directory changes neither. |
| Missing lifecycle publication | [use-snapshot.ts:67](../../../../apps/desktop/src/renderer/console/use-snapshot.ts#L67), [use-snapshot.ts:84](../../../../apps/desktop/src/renderer/console/use-snapshot.ts#L84) | Current hook reads on mount/manual request and adopts action replies; manager has no change subscription. Runtime faults/dependency degradation also need a host notification. |
| Existing command transport | [remote-runtime.ts:415](../../../../packages/host-kernel/src/runtime/remote-runtime.ts#L415), [worker-server.ts:258](../../../../packages/host-kernel/src/runtime/worker-server.ts#L258) | runtime.command already carries a contribution ID, task ID, owner, signal, deadline and JSON input/result. Missing piece is a checked host-only manager resolver/dispatcher, not a new RPC protocol. |
| Supervised execution | [task-supervisor.ts:115](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L115), [task-supervisor.ts:173](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L173), [task-supervisor.ts:403](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L403) | TaskSupervisor.run handles page commands; nested capability calls continue through invokeCapability. Disable cancels owner tasks. Capability bindings are host-issued and owner checked in [capability-registry.ts:125](../../../../packages/host-kernel/src/runtime/capability-registry.ts#L125). |
| Revisioned configuration | [service.ts:113](../../../../packages/host-kernel/src/config/service.ts#L113), [service.ts:172](../../../../packages/host-kernel/src/config/service.ts#L172), [file-store.ts:103](../../../../packages/host-kernel/src/config/file-store.ts#L103) | inspect does not create defaults; save validates, compares revisions, and reports changeMode. File store uses exclusive lock, bounded records, fsync/temp file/rename and cancellation commit fence. |
| Validation and application modes | [schema.ts:87](../../../../packages/host-kernel/src/config/schema.ts#L87), [schema.ts:250](../../../../packages/host-kernel/src/config/schema.ts#L250), [schema.ts:290](../../../../packages/host-kernel/src/config/schema.ts#L290), [config.ts:27](../../../../packages/contracts/src/config.ts#L27) | Reuse prepared validate/changeMode and supported schema subset. Default apply mode is reload. A successful save alone does not activate/reload a plugin. |
| Human IPC boundary | [ipc-request.ts:24](../../../../apps/desktop/src/main/ipc-request.ts#L24), [console-config-request.ts:18](../../../../apps/desktop/src/main/console-config-request.ts#L18), [console-config-request.ts:34](../../../../apps/desktop/src/main/console-config-request.ts#L34) | Existing console actions require the exact trusted main-frame URL and owner generation. This is human application authority, not a reusable authorization grant for a model or plugin. |
| Plugin operations | [console-plugin-request.ts:42](../../../../apps/desktop/src/main/console-plugin-request.ts#L42), [console-plugin-request.ts:50](../../../../apps/desktop/src/main/console-plugin-request.ts#L50) | Reuse stale-owner/protected checks, per-instance concurrency guard, config load before enable, and snapshot + operationError result. A valid lifecycle request can partially change state and still report failure. |
| Trust and permissions | [host-permissions.ts:44](../../../../apps/desktop/src/main/host-permissions.ts#L44), [host-permissions.ts:79](../../../../apps/desktop/src/main/host-permissions.ts#L79), [kernel.ts:299](../../../../packages/host-kernel/src/permissions/kernel.ts#L299) | Host owns source fingerprint and re-verification; authorization requires live owner/task, declared permission, matching trust fingerprint, policy epoch, cancellable lease, and audit. |
| Capability use is not management | [policy.ts:119](../../../../packages/host-kernel/src/permissions/policy.ts#L119), [adapters.ts:18](../../../../packages/host-kernel/src/permissions/adapters.ts#L18) | local preset allows capability-use; provider methodPermissions can add provider permissions. Neither supplies caller-specific cross-plugin config/lifecycle scope. Do not interpret it as blanket manage authority. |
| Approval identity | [approval-inbox.ts:26](../../../../apps/desktop/src/main/approval-inbox.ts#L26), [approval-inbox.ts:54](../../../../apps/desktop/src/main/approval-inbox.ts#L54) | Reuse requestId/owner/task/permissionDigest/deadline matching and abort cleanup. Current prompt has no reviewed config diff; that is a small necessary extension. |
| Durable removal and restore | [builtin-registry.ts:18](../../../../apps/desktop/src/main/builtin-registry.ts#L18), [builtin-registry.ts:67](../../../../apps/desktop/src/main/builtin-registry.ts#L67), [desktop-host.ts:236](../../../../apps/desktop/src/main/desktop-host.ts#L236) | Builtin removal is a FileConfigStore tombstone. Restore checks package digest, reinstalls disabled, registers source/config and initializes existing data; it never enables or grants trust. |
| Data survives removal | [plugin-removal.ts:6](../../../../apps/desktop/src/main/plugin-removal.ts#L6), [desktop-host.ts:91](../../../../apps/desktop/src/main/desktop-host.ts#L91), [demo-history.ts:5](../../../../apps/desktop/src/main/demo-history.ts#L5) | Package directory, configuration, vault and plugin-data are separate. Conversation history retains pet.voice-chat identity. Do not move data to the new page owners. |
| Credential separation | [schema.ts:176](../../../../packages/host-kernel/src/config/schema.ts#L176), [schema.ts:212](../../../../packages/host-kernel/src/config/schema.ts#L212), [credential-broker.ts:188](../../../../packages/host-kernel/src/credentials/credential-broker.ts#L188), [plugin-sdk/index.ts:65](../../../../packages/plugin-sdk/src/index.ts#L65) | Config supports declared credential-ref identifiers; host can report presence. Raw values only enter authorized withSecret callbacks, not config snapshots or plugin management APIs. |
| Encryption and egress | [desktop-host.ts:105](../../../../apps/desktop/src/main/desktop-host.ts#L105), [secret-cipher.ts:26](../../../../packages/host-kernel/src/credentials/secret-cipher.ts#L26), [host-services.ts:64](../../../../packages/host-kernel/src/runtime/host-services.ts#L64) | Reuse encrypted FileCiphertextStore + safeStorage and KnownSecretBoundary. Encryption unavailability remains unavailable, with no plaintext fallback. Known-value redaction is a bounded defense, not a malicious-code sandbox. |

## Architecture alternatives

| Alternative | Executable extension behavior | Cost / decision |
| --- | --- | --- |
| Rename/move the existing five React pages and keep a fixed page-ID switch | Only precompiled pages work; external manifests cannot create a usable page. | Small file diff, but fails the real extension acceptance criterion. Reject. |
| Host-rendered descriptors: generic own-settings + declared commands, plus audited application views | An extension declares/registers a settings page and commands; the host supplies form controls and executes the plugin's registered handler. Product views use the same page contribution lifecycle. | Smallest complete option. Reuses manifest, runtime.command, config schema/forms and task supervision. Recommend. |
| Plugin-owned renderer JS modules, iframe/webview or sandboxed remote views | A plugin can author arbitrary custom UI in an isolated surface. | Needs a real UI module loader, origin/isolation protocol, view permissions, theme bridge, disposal and process-failure policy. entries.ui/panel.entry do not implement these. Unnecessary for this task; arbitrary host DOM injection remains prohibited. |

A fixed host component registry is acceptable for application views, but is insufficient as the entire extension contract. The generic settings/command view is what lets an unknown fixture plugin add useful content without editing the navigation or renderer switch. Avoid a general layout language: one bounded form view plus existing product-specific host components covers the confirmed needs.

## Compact proposed typed extension

Illustrative types only; names are not a promise of implemented APIs.

~~~ts
type AppPageView = 'start' | 'habits' | 'appearance' | 'conversation' | 'voice-input';
type ConsolePageView =
  | { kind: 'settings'; commands?: readonly LocalId[] }
  | { kind: 'application'; view: AppPageView };

interface ConsolePageContribution extends ContributionBase {
  kind: 'console-page';
  order: number; // bounded integer; ties resolved by stable plugin/instance/local ID
  view: ConsolePageView;
}
interface ConsolePage {
  owner: OwnerRef;
  id: LocalId;
  title: string;
  order: number;
  view: ConsolePageView;
}
interface PageCommandRequest {
  owner: OwnerRef;
  pageId: LocalId;
  commandId: LocalId;
  input: JsonValue;
}
interface ConsolePageBridge extends Pick<ConsoleBridge,
  'getSnapshot' | 'inspectConfig' | 'saveConfig'> {
  runPageCommand(request: PageCommandRequest): Promise<Result<JsonValue>>;
  onChanged(listener: () => void): () => void;
}
~~~

This bridge remains a trusted human-console adapter. Host views receive owner-bound facades; model/plugin code never receives the full bridge.

The manifest adds one contribution variant; ctx.contribute(pageId) remains unchanged. Shape validation keeps closed objects, bounded strings/lists and existing ID budgets. Semantic validation requires each settings-view command ID to name a command in the same manifest. Generic settings always uses the page owner's stable configuration identity; a descriptor cannot choose another config namespace. Command labels come from command declarations and JSON output renders as plain text. Form labels/constraints come from ConfigDefinition, not a schema editor.

Application-view names are reserved host components. A user package claiming view=application or a builtin plugin ID does not receive their privileged bindings. The host's exact bundled-page catalog binds each application view to its expected owner/package contents. Their human facades expose only the concrete controls required by that screen; the descriptor never carries an arbitrary IPC channel, function, URL, path, DOM fragment, or target-selection authority.

A generic button request is checked against the current registered page, current owner generation, and the same-manifest command list. Add a host-only checked command resolver on PluginManager and dispatch through TaskSupervisor.run. The resolver is never exported to plugin code. Existing runtime.command then executes the registered handler. Inside it, ctx.host.capabilities.invoke continues through [host-services.ts:130](../../../../packages/host-kernel/src/runtime/host-services.ts#L130), existing provider selection, leases, and child-task supervision. Do not call provider functions directly or supply an always-allow authorizer.

### Page data flow and cleanup

~~~text
validated manifest -> runtime activate -> ctx.contribute(local page ID)
 -> manager publishes active registered contribution with current OwnerRef
 -> console snapshot projects typed descriptor -> host renders view
 -> own-config facade or declared command -> existing config/task/permission services
~~~

Use a stable navigation key (pluginId, instanceId, contributionId), and include generation in the mounted React key and every execution request. On disappearance or generation replacement, unmount the old view, release subscriptions/listeners/previews, discard authority held by it, and select the first remaining primary page or the host extension manager. Never keep rendering the stale selected component because its old ID is still in local state. Unsaved form state can be reported as discarded after removal; it cannot keep an owner alive or delay disablement.

Add one manager lifecycle/change subscription and a console invalidation event. Emit when publication/visibility/owner changes, including activation, start of stop, runtime fault, dependency degradation and recovery. Reuse the existing snapshot shape and action-return snapshots; the renderer must invalidate any older in-flight read so a late result cannot restore an old page. Do not wait for cleanup completion to withdraw navigation, and do not rely solely on UI action replies or a periodic poll.

Navigation unmount is different from plugin disablement. Keep the recording session, microphone controller, useDemo and ongoing conversation controls at shell/session scope, as already done by [console-app.tsx:133](../../../../apps/desktop/src/renderer/console/console-app.tsx#L133) and [console-app.tsx:269](../../../../apps/desktop/src/renderer/console/console-app.tsx#L269). Moving between pages retains recording and Stop/Cancel. Disabling the actual conversation/capture owner aborts its supervised tasks and releases the microphone. Merely disabling a thin page plugin withdraws that UI; it does not falsely claim to disable a separate provider. The extension manager must communicate that distinction.

## First launch, ordinary page plugins, and trust

Today discovery installs plugins disabled and does not activate them ([desktop-host.ts:207](../../../../apps/desktop/src/main/desktop-host.ts#L207)); manager activation calls the trust gate before importing a runtime ([plugin-manager.ts:306](../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L306)). Publishing active-only pages without a bootstrap would leave a fresh profile with no primary pages. Do not fix this by trusting every builtin package, showing disabled runtime contributions, or asking the user to perform five technical source approvals.

Recommended minimum bootstrap:

1. Ship the five thin page plugins as audited application interface code. Their self-contained runtime only registers the declared local UI description. They declare no providers, capability consumption, sensitive permissions, workers or resources. Their application views are existing host components and specific human action facades. A page's own declarative config is allowed. Feature implementations stay in their current peer plugins.
2. Generate the small host-owned application-page admission catalog at build time and pin it inside the main application bundle. It binds exact plugin ID, expected builtin installation root, allowed view, and expected manifest/runtime entry hashes from the audited build inputs. Compare discovery evidence with those pinned expected hashes and re-verify the files before recording the actual source fingerprint. Computing the current package hashes at runtime and treating those same hashes as the admission allowlist would trust a modified package and is forbidden. Matching origin or ID alone is insufficient. The catalog is an application-code trust boundary; it is not a new manifest trust flag, plugin type, SDK or loader.
3. For matching page packages on a fresh profile, record that exact source through existing PermissionControl.confirmTrust, then call the ordinary config/readiness/manager.enable path. The existing manager trust gate remains in force. Only those audited page runtimes are admitted; ASR/model/conversation/avatar providers and all third-party runtimes retain their existing approval requirements. Never propagate the page package's trust or grants to a provider.
4. Always retain the small host extension-management, approvals/recovery, and About shell. A user can disable or remove all five page plugins and still recover them. Runtime faults/hash mismatch show recovery there, rather than silently importing a different entry or rendering the old page.
5. Extend the existing builtin-policy record with a disabled-page list using its existing FileConfigStore CAS; migrate the existing removed list without resetting it. Bootstrap only pages not deliberately disabled or removed. Explicit restore must also leave the restored page disabled/untrusted until a subsequent explicit enable/source-admission action; it must not trigger bootstrap admission in the same call or on the next restart. This prevents restore or a restart from undoing the user's choice. Do not persist third-party source trust as a side effect.

This deliberately adds an application-owned admission rule; the current source has no such rule. If retaining entirely human-granted source trust is preferred, the concrete alternative is one understandable first-run action, “Enable the settings pages supplied with this app.” It authorizes the displayed finite catalog as a group, while the host still verifies/records each exact package and leaves feature runtimes untouched. It requires storing the page enable choice and exact application-content admission policy for subsequent starts. It should not become five individual hash dialogs.

Thin page ownership is intentionally separate from feature availability. Start and Voice Input must stay usable when a model/ASR provider is unready, so their page runtimes must not declare those providers as required dependencies. They display actual provider status and let the human configure/approve them. This is responsibility composition within ADR-0010, not a UI/provider plugin hierarchy.

## Reusable settings/plugin management API

Extract business operations from the Electron source gate without weakening it. Keep the trusted main-frame check in the human adapter; give the service a host-created caller context. Never accept a wire parameter such as caller=human, trusted=true, arbitrary owner authority, or permissionControl. Existing [console.ts:79](../../../../packages/contracts/src/console.ts#L79) can remain a transitional human adapter while its methods delegate to the shared service.

~~~ts
type ManagementChange =
  | { kind: 'config'; owner: OwnerRef; schemaVersion: number;
      expectedRevision: number; data: JsonObject }
  | { kind: 'plugin'; owner: OwnerRef;
      action: 'enable' | 'disable' | 'uninstall'; expectedSourceDigest: string }
  | { kind: 'restore'; pluginId: PluginId; expectedDigest: string };

interface ChangePreview {
  change: ManagementChange; // validated, immutable exact intent
  summary: string;
  fields: readonly { pointer: string; label: string;
    before?: JsonValue; after?: JsonValue }[]; // omission means absent; null stays null
  changeMode: ConfigApplyMode | null;
  effects: readonly string[]; // e.g. cancel active conversation, hide Appearance
}
interface ManagementClient {
  discover(): Promise<Result<ManagementCatalog>>;
  inspect(owner: OwnerRef): Promise<Result<PublicConfigInspection>>;
  validate(change: ManagementChange): Promise<Result<ChangePreview>>;
  change(change: ManagementChange): Promise<Result<ManagementOutcome>>;
}
~~~

ManagementCatalog projects permitted plugin/page metadata, configuration definitions, present revisions, supported actions, and apply requirements. PublicConfigInspection is the existing ConfigInspection's non-secret projection, optionally with declared credential-key presence metadata. ManagementOutcome preserves ConfigSave or the current snapshot/security/operationError semantics; it distinguishes saved, actually applied, pending restart, failed and unknown results. Discovery/read/validation never initialize defaults or modify revisions. Validation is a fresh computation, not a persisted proposal queue or authority token.

For config validate, reuse ConfigService.definition().validate, inspect, and changeMode. Compare the supplied schemaVersion as well as owner generation and revision. change repeats these comparisons at its commit boundary and calls the existing save/CAS operation; it never blindly applies an earlier preview or merges over a conflicting record. First save uses expectedRevision=0. If application requires reload/restart, return the explicit effect; do not silently activate a disabled plugin or claim reload has happened. Immediate fields need a real consumer/invalidation path. If application fails after persistence, report “saved, could not apply” with the actual snapshot; do not invent rollback success.

For plugin changes reuse protected checks, source fingerprint/re-verification, enabled configuration checks, cancellation/cleanup, removal tombstone and restore routines. Per-target serialization and current-state snapshots stay in one shared business path. A removed plugin has no live OwnerRef: restore is intentionally the existing pluginId + expectedDigest operation. It grants neither enablement nor trust.

### Model callers and least authority

The model is not an Electron window and does not inherit the renderer's authority. This round can expose and test the typed host service without implementing tool-call parsing/dispatch inside the LLM provider. A later model-tool adapter receives a host-issued client bound to its real trusted owner, supervised conversation/tool task and cancellation signal. It converts selected tool names to these typed calls. The API does not grant the model raw PluginManager, ConsoleBridge, PermissionControl, CredentialBroker or an arbitrary request/send primitive.

There is a real missing permission shape. The current permission union at [permission.ts:10](../../../../packages/contracts/src/permission.ts#L10) has no cross-plugin configuration/lifecycle operation. Recommended narrow addition:

~~~ts
type ManagementOperation = 'config.read' | 'config.change'
  | 'plugin.enable' | 'plugin.disable' | 'plugin.uninstall' | 'plugin.restore';
interface ManagementPermission {
  kind: 'management';
  target: { pluginId: PluginId; instanceId: LocalId };
  operations: readonly ManagementOperation[];
}
~~~

A declaration names exact targets and operations, with no wildcard or “all installed plugins” grant. Extend the current normalizer/schema/subset check for exact target and operation subset; reuse PermissionKernel for source trust, declarations, task identity, lease validity, revocation, audit and approval. local must not auto-allow management. Discovery filters to the caller's scopes; inspect requires config.read; validating/changing a proposed config requires the relevant config.change scope and a live task. A capability-use permission may gate an optional management capability transport, but it never replaces this target/action check. Own-config get in [plugin-sdk/index.ts:80](../../../../packages/plugin-sdk/src/index.ts#L80) stays read-only; there is no blanket host.config.set. If an SDK client is added, expose only this bound optional facade.

For each model mutation, allocate a supervised operation and freeze exactly one intent. Augment the existing approval presentation with host-produced target name, action, schema version/revision for config, source digest for package changes, field diff, and concrete effects. Associate the immutable intent/digest with that exact task/request ID. The existing permissionDigest only describes the permission scope; it is not by itself a digest of the reviewed data. Approval must authorize the displayed immutable intent, not a later mutable change request. Revalidate owner/schema/revision/digest after the human answers; reject changed inputs and expired/cancelled tasks. Execute that intent once under the lease. The API need not add a durable plan store or return a reusable bearer grant.

Source trust, preset changes, answering approvals, credential values, and unknown-code installation are outside model management operations. They remain host/human actions. A model may propose enabling an already trusted installed target; it cannot make an untrusted package trusted, lower its own policy, or approve itself. Ordinary human saves continue through their trusted application action facade; do not route every name/color edit through a new technical approval dialog.

### Secrets

Keep credential import/update/delete in the existing explicit human credential route ([demo-request.ts:53](../../../../apps/desktop/src/main/demo-request.ts#L53)); raw keys never become ManagementChange.data. Schema credential-ref values are local key IDs only. Read APIs may return available/configured and declared key ID; configured does not mean decrypted, connected, or successfully authenticated ([demo-controller.ts:144](../../../../apps/desktop/src/main/demo-controller.ts#L144)). Do not return ciphertext, raw secret callbacks, native exceptions, or key material in previews, diffs, audit or model context.

Actual provider use remains the existing credentials.withSecret path with owner/key/task permission and cancellation. Reuse the existing known-secret egress boundary for model API JSON/results too; do not describe a field-name blacklist or redaction as a general secret detector. No plaintext fallback is permitted if the encrypted broker is unavailable.

## Migration from fixed pages and preservation of effects

1. Keep provider identities and records: pet.llm-provider/model, pet.asr-local/model, pet.voice-chat/mode + autoSend, its history/data directory, and the credential namespace pet.llm-provider/api-key. New page IDs are navigation identities, not replacement data owners. Page creation and restore must never reset initialized records.
2. Add the five page declarations/runtimes with the same registration API, project their descriptors in ConsoleSnapshot, and render primary navigation from that projection. Keep only management/recovery/About fixed in the host. Replace primary component selection with the controlled view registry. Preserve intentional ordering and define new stable test IDs; do not retain legacy fixed navigation as a fallback pretending to be plugin ownership.
3. Start's model controls continue to edit the existing provider record and use the existing credential route/status. Start's color/preview and Appearance must read the same saved avatar/profile settings used by the desktop pet. The current avatar plugin only describes renderer/moods ([avatar-default/index.ts:3](../../../../plugins/avatar-default/src/index.ts#L3)); the main process only synchronizes avatar enable/visibility ([main/index.ts:142](../../../../apps/desktop/src/main/index.ts#L142)). Saving a new color field without a pet snapshot/render consumer does not satisfy the task.
4. Put new Habits settings in one stable declared record. Have the actual conversation intent snapshot the configured habits values and forward a bounded typed preference payload to the reply provider; do not give that provider cross-plugin config-read authority. The current turn path forwards text/history ([demo-controller.ts:590](../../../../apps/desktop/src/main/demo-controller.ts#L590)), while the real provider hardcodes its system prompt ([llm-provider/index.ts:16](../../../../plugins/llm-provider/src/index.ts#L16)). Language, address and persona controls require an explicit change to that real consumer. Do not present unsupported interaction preferences as functioning toggles.
5. Keep Conversation on the existing controller/history/tasks and move history/compose/stop there. Voice Input edits the existing applicable ASR/autoSend settings and readiness. The controller already reads those records for actual turns ([demo-controller.ts:125](../../../../apps/desktop/src/main/demo-controller.ts#L125)); a new page must not duplicate its store/session or cancel recording on navigation.
6. The current theme preference is localStorage ([theme.ts:27](../../../../apps/desktop/src/renderer/console/theme.ts#L27), [use-theme.ts:5](../../../../apps/desktop/src/renderer/console/use-theme.ts#L5)). If theme is included in reusable machine-managed settings, explicitly import a valid legacy choice once into the canonical revisioned host/UI record before initializing its defaults, then use that record as the sole preference source. Stop dual-writing localStorage; theme application remains a host UI concern. If the record already exists, do not overwrite it with an older localStorage value.
7. A schema change requiring stored-data conversion uses the existing prepared migration/CAS/rollback machinery ([service.ts:214](../../../../packages/host-kernel/src/config/service.ts#L214), [service.ts:321](../../../../packages/host-kernel/src/config/service.ts#L321)) and runtime migrateConfig hook ([plugin-sdk/index.ts:153](../../../../packages/plugin-sdk/src/index.ts#L153)). These facilities are present but startup currently calls register/initialize, so upgrade orchestration must be explicit when needed. Reading defaults is not migration; no migration may rename away current identities or overwrite history/keys.

## Five essential behavior tests

1. **Fresh-profile bootstrap and user choice.** A new profile shows all five admitted application pages without five technical confirmations. Existing providers and a same-ID/unapproved or hash-changed user package remain untrusted/unexecuted. Disable/remove a page, restart, and confirm it stays withdrawn; the host recovery shell remains usable. Restoring it preserves data, creates a new owner and leaves it disabled/untrusted until explicitly enabled/admitted.
2. **Real external extension.** A fixture package, using only the documented manifest + ordinary activate/contribute API, adds a usable own-settings page and a declared command button without editing a frontend navigation list. Save a valid setting and execute the command through the supervisor/runtime.command path. Incomplete/failed activation and an undeclared/cross-plugin command reference publish no usable page.
3. **Owner cleanup and ongoing work.** While a fixture command/session is running and its page is selected, disable, uninstall, or fault the owner. Navigation/view/listeners/previews disappear on withdrawal; tasks abort, stale completions and old generation requests cannot update the replacement. Cleanup timeout reports pending_restart rather than completed uninstall. Moving between surviving pages keeps recording controllable; disabling the actual recording owner releases the microphone. Config, vault entry and conversation history survive removal/reinstall.
4. **CAS, migration and actual consumers.** Inspect/validate an absent config without creating a record; first save at zero succeeds once, competing/stale saves conflict, schema-version/owner changes are rejected, and a cancelled pre-commit write does not overwrite newer data. Saved habits affect the real reply preference input, avatar settings affect both preview and desktop, and supported speech settings affect the next turn. Restart/migration preserves old model/history/key identities; reload/restart or apply failure is reported honestly.
5. **Scoped machine management and no secret disclosure.** Exercise discover/read/validate/change through a bound fixture caller, including declared/undeclared target/action, local preset, revoked trust/lease, forged human authority, changed schema/revision/source, and cancelled/expired approval. Only the exact reviewed mutation can execute once; enabling cannot grant source trust. Config/read/preview/error/audit/model results reveal neither a known broker secret nor ciphertext, and an unavailable cipher cannot fall back to plaintext.

No tests were executed for this read-only research. The scenarios above are implementation acceptance targets, not claims that the proposed interfaces already exist.

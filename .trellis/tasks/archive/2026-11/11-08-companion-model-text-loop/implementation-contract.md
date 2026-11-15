# Implementation contract — model connection v1

Status: implementation target, frozen for backend/frontend handoff on 2026-11-08; no endpoint, test pass or live connection is claimed by this document. The owner approved proceeding. [Design](design.md) owns rationale; [implementation plan](implement.md) owns ordering/assignments; this document alone owns exact port/DTO/API names and semantics. Changes to this contract must be coordinated before either implementation diverges.

## 1. Scope and owners

Default connector: `pet.model-connection-magpie/magpie`. Alternative proof: `pet.model-connection-fixture/fixture`, an ordinary **connection** plugin, not another Harness/framework. Both use `companion.model.connection@1`. Cortico remains the consumer and does not know which connector was selected. The native request/response protocol is the existing pinned Cortico Responses facade; no gateway, model router, task runner or multimodal API is added.

Magpie is an external Go gateway, not an embedded npm SDK. This stage ships its companion adapter and does **not** bundle, install, discover credentials for, start or stop a Magpie process. The default base URL is `http://127.0.0.1:3425/v1` (localhost gateway); `/v1/responses` is appended by the existing native provider. The owner supplies the actual gateway/model. Unconfigured/unreachable is truthful, never a direct-provider or scripted fallback.

## 2. Host-only native port

Reuse the [current ResponseClient facade](../../../../../plugins/harness-cortico/src/harness.d.mts#L10), including its native Request/Response/origin/attempts, and export its type through the companion-runtime host boundary. Do not introduce a new package or a runtime import cycle just to relocate the declaration. Extend the existing options declaration with `diagnostic?: boolean` and `[key: string]: unknown` so native/private options are forwarded rather than reconstructed. The existing signal/onEvent/role/sessionId members keep their types. New runtime exports can use the following declarations:

```ts
import type { ResponseClient } from '@pet/harness-cortico';
export type { ResponseClient } from '@pet/harness-cortico'; // type-only reuse
export const MODEL_CONNECTION_CAPABILITY = 'companion.model.connection@1';
export interface TextModelBinding {
  readonly model: string;
  readonly client: ResponseClient;
}
export interface AuthorizedResponseTransport {
  readonly client: ResponseClient;
  close(): Promise<void>;
}
export interface ModelConnectionPorts {
  bind(binding: TextModelBinding): () => Promise<void>; // fence, remove, actual drain
  authorizedResponses(baseUrl: string): AuthorizedResponseTransport;
}
export type ModelConnectionPortsFor =
  (context: PluginContext) => ModelConnectionPorts; // PluginContext from existing SDK
export interface ModelConnectionDescription {
  readonly label: string;
  readonly synthetic: boolean;
  readonly settings: ResponsesConnectionSettings | null; // shared public type below
  readonly model: string | null;
  readonly credentialRequired: boolean;
  readonly credentialWritable: boolean;
}
export interface ModelConnectionRegistration extends ServicePluginRegistration {
  readonly connection: {
    readonly providerId: string;
    describeConfig(config: JsonObject): ModelConnectionDescription;
  };
}
export function createMagpieConnectionPlugin(
  portsFor: ModelConnectionPortsFor,
): PluginDefinition;
```

`portsFor` is supplied by service composition with plugin/provider identity already fixed. It may accept only that current activation context; plugins cannot select another owner/provider, credential namespace or Config revision. `bind` registers one immutable facet for the exact owner generation, provider and activation Config revision. Its async disposer fences/aborts/removes only that facet and awaits its tracked in-flight native promises through actual settlement, including credential-free clients. This is ownership bookkeeping for existing source tasks, not another scheduler. Old references are fenced on owner abort/unbind/selection or revision change. Only an active current declared provider can be consumed; request.model must match the captured binding model rather than silently substituting another model. Do not put the client, callbacks, AbortSignal, native options/results/errors or partials in JSON `ctx.provide`, `TaskHandle.result`, HTTP or events.

`authorizedResponses` reuses [createAuthorizedModelClient](../../../../../apps/companion-service/src/model-client.ts#L14), substituting the connector source ID and its host-private supplied credential. It returns no plaintext. The plugin owns the returned transport's close effect and binding disposer using ordinary `ctx.effect`; register transport close first and binding removal second so disposal removes registration before closing transport. The host also fences on the activation signal immediately, before disposer settlement. No network runs during construction/activation.

A custom connection factory returns an ordinary `definePlugin(...)`, registers a manifest-declared control provider and binds its compatible client through the same ports. `ModelConnectionRegistration` only extends the existing service-side registration, not PluginDefinition/kernel; its providerId must be declared in the manifest. Its pure `describeConfig` projects already validated nonsecret Config without I/O, so settings remain readable while that connector is inactive. Validate source trust before running that projector, then validate/budget its allowlisted return. The same description is the control provider's JSON `describe` result; host supplies actual identity/revisions/credential availability instead of trusting plugin claims about those fields. No special Magpie branch exists in Cortico. The fixture binds its deterministic native-compatible client directly and has no credential requirement. The public capability is not a JSON transport for native `respond`.

For each private native call:

1. The host captures/validates the exact selected binding and consumer owner before admission. Ordinary replies use the Cortico consumer source; explicit connection checks use the companion-host consumer source, so a check does not require a ready Cortico.
2. Existing `withSourceAuthority` obtains the consumer's declared `capability-use` lease. The dispatcher separately obtains the connector's declared `files/plugin-data/read` source/config-read lease, including for the credential-free fixture. An active owner alone does not establish deny/fingerprint/revoke permission.
3. The Magpie transport additionally uses the existing connector-owned `model-api-key` credential lease. Forward the union of caller, both owner/task, permission and credential signals to actual native work. Never borrow unrestricted core authority. `describe.methodPermissions` protects describe only; the private native dispatcher must acquire its own leases.
4. Preserve request/options/private member identity except the necessary composed signal and authority/redactor event guards. Event objects stay intact; invoking a retained callback after settlement, revoke, retirement, owner/selection/revision change or an observed source-fingerprint failure is suppressed. Connector invalidity retires its binding; caller/timeout/consumer cancellation only suppresses or aborts that request and must not retire the shared provider or cancel another legitimate consumer. Current-stage ConfigService.save (SDK or host path) synchronously fences the exact old revision before returning a successful committed save; actual drain is still awaited separately. This host adapter does not add generic kernel watchers or migration behavior. Preserve returned native objects and original safe native exceptions, including GenerationError partial/attempts. Normal reply wrappers retain the existing 180000ms model bound; the explicit check supplies its shorter 15000ms combined signal/deadline. Do not introduce an accidental 30000ms outer default that changes native reply behavior. Observe actual work and await `TaskHandle.settled`; logical cancellation alone does not release the slot or permit replacement. Recheck exact selection/owner/revision/leases before releasing successful results.

Companion-host and Cortico manifests declare optional consumption plus permission for `companion.model.connection@1`. Move `hostCredentials:['model-api-key']` and the credential permission from Cortico to the actual connector. The fixture still declares the config-read permission. Keep the existing headless host-owned transport boundary; this stage does not add a generic network/process adapter to the SDK.

## 3. Magpie manifest and configuration

Create one ordinary package/manifest/factory with identity `pet.model-connection-magpie`, version `0.1.0`, host `^1.0.0`, existing Linux/Windows/macOS targets and runtime entry `dist/index.mjs`. Required capability/permission/config fragment:

```ts
provides: [{
  id: 'magpie', capability: 'companion.model.connection@1',
  features: {
    nativeResponses: 1,
    methodPermissions: {
      describe: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
    },
  },
}],
permissions: [
  { kind: 'files', scope: 'plugin-data', access: 'read-write' },
  { kind: 'credentials', keys: ['model-api-key'] },
],
config: {
  version: 1,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['baseUrl', 'model', 'authMode'],
    properties: {
      baseUrl: { type: 'string', minLength: 1, maxLength: 2048,
        default: 'http://127.0.0.1:3425/v1' },
      model: { type: 'string', minLength: 0, maxLength: 128, default: '' },
      authMode: { type: 'string', enum: ['local-client-id', 'gateway-key'],
        default: 'local-client-id' },
    },
  },
  apply: { baseUrl: 'reload', model: 'reload', authMode: 'reload' },
}
```

Config belongs to `pet.model-connection-magpie/default`, through existing ConfigService/FileConfigStore only. The protected host profile adds optional `modelConnection` (default Magpie selector) and `modelMode` (`scripted|model`, default scripted for preserved old profiles). These fields do not replace name/persona/Harness/disabledPlugins. Existing schema-version-1 records remain valid; resolve omitted new fields explicitly since defaults do not hydrate existing records. Cortico Config stays `{}`. Explicit environment model options seed/override the Magpie Config through CAS; do not turn an absent environment mode into an overwrite of saved mode.

Validate once at the service/plugin boundary: no control characters, URL username/password/query/fragment; normalized absolute base URL removes trailing slash, preserves full path and follows URL host/port normalization. HTTPS is accepted; HTTP is accepted only for exact hostnames `localhost`, `127.0.0.1`, `[::1]`. `local-client-id` additionally requires one of those loopback hosts, even on HTTPS. It supplies the documented public client label `magpie-dsh-pet`, not a saved vendor key. Never offer this mode for a nonloopback target. `gateway-key` uses an independently supplied gateway key; Magpie retains upstream vendor/account credentials.

Bind credential availability to **connector ID plus full normalized base URL plus auth mode**, not just origin. Model-only changes may retain same-target credentials but invalidate checks. Endpoint/connector/auth-mode change must not send the old key to the new binding; it requires new explicit input/injection. Gateway key: nonempty, at most 4096 UTF-8 bytes, no control characters. Once the new selection CAS commits, switching away clears memory/environment slots, rotates their versions and fences the old binding before fallible retirement; physical work/broker cleanup is still awaited. A rejected CAS leaves the healthy key unchanged. A same-ID retry after partial application cannot resurrect the predecessor's key; switching back requires fresh explicit target-bound input/injection. Environment injection supplies its explicit matching base URL, not only an unbound key. No Linux identity/plaintext cipher, key file, secret hash/suffix, DSH or desktop secret import. This HTTP composition accepts browser key submission only through owner-controlled loopback/SSH; remote pages use independent host injection.

Each credential slot has an opaque version of at most 128 characters containing a fresh process generation plus fresh slot version, e.g. two UUIDs. Missing/no-secret slots also have a version. Restart must **never** reset to a reusable numeric zero. Replacement/removal/target change rotates it; stale form CAS cannot match after a restart. Local-client-id and fixture descriptors explicitly require no secret. `available` means their auth requirement is satisfied, not that inference succeeded.

## 4. Browser-safe DTOs (backend-owned shared source)

Add these to a browser-safe `packages/contracts/src/companion-model.ts` and export from `@pet/contracts`. They are the only model state consumed by frontend code. The implementation must include `model` on every new-service snapshot; make the new member additive/optional in CompanionSnapshot v1 so older fixtures/clients do not fabricate a connection. If the member is absent, the settings feature is unavailable; if present but malformed, reject that snapshot rather than inventing values.

```ts
export interface ResponsesConnectionSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly authMode: 'local-client-id' | 'gateway-key';
}
export interface CompanionModelCredentialView {
  readonly required: boolean;
  readonly available: boolean;
  readonly source: 'none' | 'local-client-id' | 'not-required' | 'environment' | 'memory';
  readonly version: string; // opaque process + slot generation; never secret-derived
  readonly writable: boolean; // connector capability intersected with this HTTP ingress safety
}
export interface CompanionModelConnectorView {
  readonly id: string; // pluginId/providerId; <=255 chars
  readonly label: string; // <=80 chars
  readonly synthetic: boolean;
  readonly configRevision: number;
  readonly settings: ResponsesConnectionSettings | null;
  readonly model: string | null;
  readonly credential: CompanionModelCredentialView;
}
export interface CompanionModelBindingView {
  readonly connectorId: string;
  readonly configRevision: number;
  readonly credentialVersion: string;
}
export interface CompanionModelCheckView {
  readonly state: 'unconfigured' | 'configured' | 'validating' | 'verified' | 'failed';
  readonly commandId: string | null;
  readonly binding: CompanionModelBindingView | null;
  readonly startedAt: number | null;
  readonly checkedAt: number | null;
  readonly elapsedMs: number | null;
  readonly evidence: 'network' | 'synthetic' | null;
  readonly error: KernelError | null;
}
export interface CompanionModelView {
  readonly profileRevision: number;
  readonly desired: { readonly mode: 'scripted' | 'model'; readonly connectorId: string };
  readonly applied: CompanionModelBindingView | null;
  readonly enabled: boolean;
  readonly connectors: readonly CompanionModelConnectorView[];
  readonly check: CompanionModelCheckView;
  readonly error: KernelError | null; // current application/lifecycle problem
}
```

Bound the connector directory to registered providers (maximum 8 in this composition), not installed packages or a marketplace. `settings` is the fixed Responses form for the default plugin; `null` means no general settings form (fixture/programmatically configured custom connector). It is not arbitrary plugin Config/Admin CRUD. A custom plugin may preconfigure its additional fields through its factory/operator path; this browser handles selection and the defined Responses fields only. Its model/credential descriptor must remain truthful. The control `describe` result uses these allowlisted descriptor fields (without host-generated revision/version), and the host validates it before projection.

`credential.writable` is the intersection of the connector's supported credential operation and this HTTP request's actually permitted ingress. The server uses the same predicate to reject the key write itself. Only actual loopback peer plus loopback Host, with no Origin or a loopback Origin, can be true. A remote entry is false/403 even when publicOrigin says HTTPS and a local proxy forwarded the connection: that does not prove a TLS-only ingress. Remote pages use independent host injection or a correctly configured owner-controlled SSH/loopback entry. TLS-termination integration is future scope; arbitrary Origin/X-Forwarded-Proto headers establish no trust. This verifies loopback peer/authority, not whether an administrator exposed a rewriting proxy in front: `/api/model/credential` must not be publicly forwarded, and remote deployments use host injection. The deployment template must explicitly block that private route. Frontend obeys this field and explains safe entry or independent host injection; it does not guess transport security.

`applied` identifies an active usable connector facet for its actual Config/key version. `enabled` additionally requires the model-mode foreground consumer to be active and bound to it. A scripted foreground can have an applied/testable connector while `enabled=false`; a verified check does not silently enable it. Saved desired mode/selector can differ from actual application after failure. Never derive enabled from a saved flag, key presence, check success or `manager.enable.ok` alone.

`unconfigured`: selected model/target incomplete. `configured`: complete settings, without a successful check of the current binding; missing gateway key is visible separately. `validating`: admitted check with actual work not yet settled. `verified`: completed nonempty native assistant output for its exact binding. `failed`: a settled unsuccessful check. A synthetic verified result displays “模拟检查通过，未连接真实模型”; never a live badge. Reset the check on connector/config/key/source-trust/restart changes. Old completion cannot overwrite a replacement. Do not persist check truth; preserve original native exceptions internally and reduce only this DTO. Normal chat success is not an explicit check result.

## 5. HTTP commands and UI actions

All routes retain bearer header/origin enforcement, existing 64 KiB JSON body bound, no-store and fixed Result envelopes. Snapshot and `GET /api/model` return the same canonical view. Runtime changes call existing `notify`; SSE `refresh` triggers a coalesced snapshot refresh, with no new event cursor, polling loop or secret-bearing event.

```ts
export interface CompanionModelSaveCommand {
  readonly commandId: string;
  readonly expectedProfileRevision: number;
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly mode: 'scripted' | 'model';
  readonly config?: JsonObject; // full target plugin config, never credentials
}
export interface CompanionModelCredentialCommand {
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
  readonly apiKey: string | null; // request-only; null explicitly removes
}
export interface CompanionModelTestCommand {
  readonly commandId: string;
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
}
export interface CompanionModelCommandResult {
  readonly receipt: CompanionCommandReceipt;
  readonly view: CompanionModelView;
}
```

| Route | Success envelope / behavior |
| --- | --- |
| `GET /api/model` | 200 `Result<CompanionModelView>`; no inference. |
| `POST /api/model` | 200 `Result<CompanionModelCommandResult>`; save and apply current settings/selection/mode at the safe boundary, no inference. Omitted config retains target's saved Config. |
| `POST /api/model/credential` | 200 `Result<CompanionModelView>`; private memory key CAS and safe apply, no inference. No command receipt/durable key-bearing command payload; branch before generic commandId extraction. |
| `POST /api/model/test` | 202 `Result<CompanionModelCommandResult>` after durable nonsecret intent and check admission; final result arrives in view via refresh. |

A valid save with missing model/key may return 200 with the accepted receipt, saved view, `enabled=false` and `view.error=not-ready`; it must not claim enabled/applied success. This permits the single UI action to supply its new-target key next. Test admission still returns 503 when no usable binding/auth exists. Actual lifecycle/drain failure returns a fixed failure and prohibits the follow-up replacement/key application until reconciled.

The frontend has two main actions: **保存并应用** and **测试连接**. Selecting desired model mode as part of the form enables it through the save/apply action; there is no extra candidate/enable/draft service. Save does not test; test does not save edited fields or change mode. Disable test while local form differs from confirmed saved settings, or while applied target/auth is missing, a check runs or the UI is offline. No automatic test on mount/save/reconnect/retry.

For a typed remote key, one save-button action may first save/apply the nonsecret settings, then submit the private credential update using the returned revision/version. Do not report overall success until both responses are reconciled. A key-only edit skips unnecessary nonsecret save. Clear the key input after dispatch, including uncertain failure; never put it in shared reducer/pending-command history/browser storage. Missing key can leave configuration saved but model unavailable until the private operation succeeds. Removal is an explicit key action, not an empty string. The backend accepts key writes only for the selected saved connector and exact current Config/key versions.

Save/test command IDs are stable per nonsecret intent. Reuse `getCommand/recordCommand` and compare current actual state before converging; a receipt is not applied behavior. Config/profile are separate CAS records, not a cross-record transaction: preserve partial committed settings honestly, return fixed failure when appropriate and let the client refetch. Do not implement rollback that revives an old target or erase data. Retrying a known intent may reconcile only its unchanged target; a superseded revision/changed payload conflicts.

Record test intent before network admission. Same-ID duplicate never sends another inference request, including after restart. If the old result is unavailable, return duplicate receipt with current unverified view; UI says prior result unknown and requires a fresh explicit test action. A credential operation has process-version CAS instead of durable intent dedup; uncertain retry must not be automatic. On any error/uncertain HTTP outcome, refresh actual view; preserve last confirmed state when offline.

## 6. Check and error semantics

The check consumes the exact selected applied connector under companion-host authority. Request: fresh user “Reply with OK.”, no product history/files/tools, `max_output_tokens:256`, native `diagnostic:true`, role `probe`, real internal `onEvent` for SSE and 15-second source deadline. Use the same native client as normal replies. Require completed status plus nonempty assistant output; do not execute a returned function call. No catalog/hello discovery, candidate connection, custom retry or scripted fallback. Fixture uses the same admission/status path and marks synthetic evidence.

Native diagnostic mode disables the pinned client's retries, not Magpie classifier/account/group work. One HTTP request is not a promise of one paid upstream call. Live acceptance uses an owner-chosen concrete model/known route policy and explicit action. Network attempt provenance is preserved where supplied; do not claim unknown resolved provider/account identity. Await actual cleanup before ending validating or allowing replacement; local abort does not establish remote compute/billing cancellation.

| Condition | Required fixed code / public behavior |
| --- | --- |
| Bad JSON/field/auth-mode/target/private key shape | `invalid-input` (400), no mutation/call. |
| Missing/wrong service token / foreign Origin | `auth-failed` (401) / `permission-denied` (403), no mutation/call. |
| Stale profile/config/process-key CAS, changed command payload, foreground/control/check busy | `conflict` (409), no new target call. |
| Missing model/key/native facet, disabled connector, unconfirmed application | `not-ready` (503); configuration may remain saved and visible. |
| Gateway 401/403, 429, unsupported endpoint/model 400/404 | check `auth-failed`, `rate-limited`, `unavailable`; no fallback. |
| Explicit source deadline / malformed or incomplete native terminal / transport failure | check `timeout` / `unavailable` / `network`. |
| Source deny/revoke/fingerprint/stale owner | existing `permission-denied` / `package-changed` / `stale-owner`; explicit revoke aborts live leases immediately. Disk fingerprints are checked at admission/event/return boundaries, not by fswatch; detecting invalidity fences/aborts and prevents stale publication/verification. Silent in-flight loaded code is not claimed to stop at the instant disk bytes change. |
| Noncooperative cleanup / pending_restart | `unavailable` or existing timeout; keep unavailable/unapplied, no replacement. |

Provider failures occur after test admission, so the HTTP admission can be 202 while `check.state` later becomes failed. Fixed KernelError is the only browser error payload; no native exception body/status text/partial/stack/key is serialized. Original native errors remain untouched on the host path. Map explicit source/lease failure from actual captured authority state rather than mislabeling every aborted GenerationError as a network failure.

## 7. Frozen acceptance and handoff

Backend first lands shared browser/native types plus one initial unconfigured view/fixture serialization. DeepSeek then implements only the frontend scope in [the plan](implement.md); GPT owns all shared/backend files and integration changes. Both must stop and coordinate on a contract change, not edit another owner's files or duplicate DTOs. No package install or gateway process is needed to prove the contract with the local fixture.

Required acceptance: both source leases and real socket/drain; same-Cortico connector replacement with no duplicate effects; stale process-version form rejection after restart; full target-bound key isolation; synthetic check labeling; saved/applied/tested distinction; responsive chat, selected stop and exact artifacts during real isolated work; existing core/recovery/browser/full gate retained. Missing real gateway/model/key keeps **real Magpie/upstream acceptance pending**, never passed by fixture/loopback evidence.

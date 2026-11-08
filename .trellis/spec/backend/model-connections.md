# Replaceable model connection contracts

## 1. Scope / trigger

Use for model-connection plugins, native host ports, model configuration/check APIs and their snapshot aggregation. Read [service contracts](companion-service.md) for canonical work/state ownership and [the operator guide](../../../docs/35-text-agent-foundation.md) for deployment and credential entry.

The default ordinary plugin is `pet.model-connection-magpie/magpie`; `pet.model-connection-fixture/fixture` proves replacement with the same Cortico Harness. Capability **`companion.model.connection@1`** follows the existing dot-segment grammar; a hyphenated capability is invalid. This integrates an independently operated Magpie gateway, not a bundled Go process, another scheduler or framework.

## 2. Signatures

Host-only canonical declarations: [model-connection-types.ts](../../../packages/companion-runtime/src/model-connection-types.ts). `ResponseClient` reuses the [native facade](../../../plugins/harness-cortico/src/harness.d.mts), including opaque options, origin and attempts. The capability exposes JSON `describe`; native `respond` uses only private ports.

```ts
interface TextModelBinding { readonly model: string; readonly client: ResponseClient }
interface AuthorizedResponseTransport { readonly client: ResponseClient; close(): Promise<void> }
interface ModelConnectionPorts {
  bind(binding: TextModelBinding): () => Promise<void>;
  authorizedResponses(baseUrl: string): AuthorizedResponseTransport;
}
type ModelConnectionPortsFor = (context: PluginContext) => ModelConnectionPorts;
```

- `ModelConnectionRegistration extends ServicePluginRegistration` adds `connection: {providerId, describeConfig(config: JsonObject): ModelConnectionDescription, nativeProvider?: NativeResponseProviderFactory}`. The projector is pure and returns no native client or secret; the host-only optional factory `(baseUrl, apiKey) => ResponseClient` is invoked only inside that connector's authorized credential borrow.
- [Magpie factory](../../../plugins/model-connection-magpie/src/index.ts): `createMagpieConnectionPlugin(portsFor: ModelConnectionPortsFor): PluginDefinition`.
- [ModelConnections](../../../packages/companion-runtime/src/model-connections.ts): `portsFor(context: PluginContext): ModelConnectionPorts`, `clientFor(consumer: OwnerRef): ResponseClient`, `invalidate(key: string): void`, `enable/disable(key: string): Promise<void>`.
- [Host observation](../../../packages/companion-runtime/src/plugin-host.ts): `onConfigurationCommit(observer): () => void`, with `{pluginId,instanceId,revision}` after a successful `ConfigService.save` commit.
- [Model controller](../../../apps/companion-service/src/model-controller.ts): `view(): Promise<CompanionModelView>`; `save(input: unknown)` / `test(input: unknown)` return `Promise<CompanionModelCommandResult>`; `credential(input: unknown): Promise<CompanionModelView>`; `seedEnvironment(key, apiKey, baseUrl): Promise<void>`.

All browser DTOs/command fields live only in [companion-model.ts](../../../packages/contracts/src/companion-model.ts), exported type-only from `@pet/contracts`; [CompanionSnapshot](../../../packages/contracts/src/companion.ts) adds optional `model`. Current service snapshots include it; a malformed present view is not an absent feature. Routes reuse bearer/origin checks, bounded JSON and no-store responses.

| HTTP route | Canonical request | Success value / effect |
| --- | --- | --- |
| `GET /api/model` | none | 200 `Result<CompanionModelView>`; same projection as snapshot |
| `POST /api/model` | `CompanionModelSaveCommand` | 200 `Result<CompanionModelCommandResult>`; save/apply selection, config and mode; no inference |
| `POST /api/model/credential` | `CompanionModelCredentialCommand` | 200 `Result<CompanionModelView>`; private credential-version CAS; no durable secret-bearing command |
| `POST /api/model/test` | `CompanionModelTestCommand` | 202 `Result<CompanionModelCommandResult>`; admit one explicit current-binding check, then refresh final state |

## 3. Contracts

**Native authority.** The consuming Cortico source holds `capability-use`; an owner check uses the protected companion-host consumer instead, so checking does not require a ready Harness. The selected connector holds its own config-read source lease and, when required, its own `model-api-key` credential lease through the [authorized model client](../../../apps/companion-service/src/model-client.ts). `describe.methodPermissions` protects describe only; private native dispatch explicitly acquires its leases, including for a credential-free fixture.

Bind immutable `{owner generation,provider,Config revision,policy epoch}` and model. An activation abort token protects both bound clients and directly retained `authorizedResponses` transports. Preserve native values/errors/partials/private options in host closures; only `null` crosses supervisor JSON. No JSON roundtrip of a generation or native exception. Await actual native work, credential use and `TaskHandle.settled`; `bind`'s async disposer fences registration and drains tracked calls. This confirms local transport/work settlement, not remote compute or billing cancellation.

Events retain their object identity behind authority/redactor wrappers. Callback invocation checks current owners/selection/signals/source. Connector invalidity fences its binding; caller timeout/cancellation or one consumer's invalidity suppresses/aborts only that request, preserving other legitimate consumers. A callback after that operation settles is ignored. Explicit revoke aborts live leases; disk fingerprints are observed at admission/event/return boundaries, without fswatch or instant disk-change cancellation claims.

Known-secret rejection uses [SecretRedactor.containsValue](../../../packages/host-kernel/src/credentials/redactor.ts#L37) on decoded own string values/keys, including native error data, without cloning or roundtripping the original generation/exception. Comparing the raw key only against `JSON.stringify(value)` misses legal quote/backslash keys after escaping. Preserve the [transport echo/identity regressions](../../../apps/companion-service/src/model-client.test.ts); the desktop consumer's lifetime/projection rules are in [desktop client contracts](desktop-companion.md).

**Configuration and application.** [Magpie Config](../../../plugins/model-connection-magpie/plugin.json) owns `{baseUrl,model,authMode}` with reload application. Default is `http://127.0.0.1:3425/v1`, empty model, `local-client-id`; the public label `magpie-dsh-pet` needs no secret. Local-client-id requires exact loopback hostname (`localhost`, `127.0.0.1`, `[::1]`). Nonloopback transport requires HTTPS and independent gateway-key provisioning. Cortico owns no connection config/credential; the host profile stores optional `modelConnection` / `modelMode` and preserves old schema-1 records.

`FileConfigStore` remains the sole CAS writer, keyed only by `{pluginId,instanceId}`. The host's local ConfigService adapter observes committed **save** revisions before successful return and fences the exact old connector, even without a bound client. Observation cannot report a committed write as uncommitted; observer faults are counted. Actual cleanup stays in tasks/disposers. This does not generalize migration or watch configuration files.

Profile/config are separate CAS records. Save/apply uses the existing runtime control boundary, rejects busy foreground/control/check, retires Core and connector, then reconstructs from canonical state. No replacement after unconfirmed cleanup/pending_restart. Independent work, identity, facts and receipt/task/execution/artifact IDs survive. Completion while quiescing keeps its committed outcome/notice without delivery to the retired Harness.

**Secrets and recovery.** A key slot binds connector ID plus the full normalized base URL/path/auth mode, with an opaque fresh process-generation + slot-generation version (never reusable restart zero or secret-derived hash). Model-only changes may retain same-target auth but invalidate the check. Memory/environment keys never cross connector/target changes. After the new selection CAS commits, retire/rotate the predecessor's key and fence it **before fallible cleanup**; same-ID recovery cannot resurrect it. A rejected CAS leaves a healthy key/version intact. Environment injection requires its explicit matching base URL. No new cipher, plaintext key file or DSH/desktop credential import.

The server's `credential.writable` is connector capability intersected with the same [ingress predicate](../../../apps/companion-service/src/server.ts) used by the write endpoint: actual loopback peer plus loopback Host and absent/loopback Origin. Remote Origin/HTTPS declarations/X-Forwarded-Proto are not proof. A rewriting public proxy can disguise locality; private `/api/model/credential` must not be publicly forwarded and its public path must return403. Deployment details and host injection belong only in the [guide](../../../docs/35-text-agent-foundation.md).

**Saved/applied/tested.** View separates desired mode/selector, actual applied binding, enabled model foreground, credential availability and exact-binding check. Configured/key-present/Core-ready is not verified. State is `unconfigured|configured|validating|verified|failed`; reset on binding/auth/source/restart changes, reject stale completions and label fixture evidence synthetic. Request rejection is not a current application failure: stale CAS/invalid input before mutation must not poison healthy `view.error`. [CLI logging](../../../apps/companion-service/src/main.ts) reads model view desired/applied/enabled, never environment defaults or state snapshot.

Save/apply does zero inference; explicit test does not save edits or enable model mode. Record its nonsecret intent before I/O and honor the **atomic recordCommand receipt** under control: duplicate means no second call, including a pre-lock absent lookup race or process restart. An old duplicate with no retained result remains unverified/unknown until a fresh explicit action. Private key writes use version CAS, not persisted secret payloads/hashes or automatic replay.

The explicit check uses the same applied client: no history/tools, “Reply with OK.”, `max_output_tokens:256`, native `diagnostic:true`, role `probe`, SSE callback and 15000ms deadline. Require completed, nonempty assistant output; never execute a returned function call. Native diagnostic disables client retries, not Magpie routing/classifier/account work. Local protocol fixtures do not establish real gateway/account/upstream operation. Actual host Magpie0.1.3225/`codex/gpt-6.1-sol` acceptance is separately recorded in the [QA evidence](../../../qa/companion-model-acceptance.md).

The Magpie-specific native provider ignores only the three observed nonstandard metadata types when they are not in the upstream standard set. Standard events/results/errors remain native. Its fixed65536 UTF-16-code-unit frame floor uses the version-scoped [Cortico patch](../../../patches/README.md); default providers and output-token/generated-output bounds are unchanged. Do not substitute broad unknown-event tolerance, payload rewriting or global fetch hooks. Adapter regressions must cover both metadata and large legal standard resources through the complete native transport.

**One snapshot budget.** [Runtime aggregation](../../../packages/companion-runtime/src/runtime.ts) reserves model/agent/plugins/projection plus the final Result shell, then sends optional `snapshot.byteBudget` to the [existing state projector](../../../plugins/state-sqlite/src/state.ts). Final JSON UTF-8 stays ≤64KiB; default state budget remains 60KiB. Reuse its task/message truncation and true `hasMoreMessages/hasMoreTasks/taskDetailsTruncated`; never discard facts or duplicate trimming in the runtime. An unfittable fixed fact set fails explicitly. Bound connector directory/validated metadata prevents unbounded extra projection cost.

## 4. Validation & error matrix

| Condition | Required outcome |
| --- | --- |
| Bad field/URL/auth/key shape or custom descriptor | Fixed `invalid-input`; no native call. Rebuild descriptor/settings from strict allowlists; reject extras/oversize, preserve null fixture settings, expose no raw secret or exception |
| Wrong token / foreign Origin / unsafe key ingress | `auth-failed`401 / `permission-denied`403; key availability/writable does not bypass the endpoint check |
| Stale profile/config/process-key CAS; busy control; changed command payload | `conflict`409; no new call or poisoning of a healthy applied view |
| Missing model/key/facet or unapplied target | `not-ready`; test admission503. Valid config may be saved200 while enabled=false |
| Duplicate check after a raced lookup or restart | Return duplicate receipt/current view; zero new inference, no fabricated old result |
| Provider401/403,429,400/404; bad/incomplete response; deadline/network failure | Check `auth-failed`, `rate-limited`, `unavailable`, `timeout` or `network`; no scripted fallback/provider body |
| Source/owner/revision invalidity or cleanup unconfirmed | Existing fixed permission/package/stale-owner/conflict errors; no stale publication/replacement, actual drain still awaited |
| Extra/oversized custom settings or insufficient projection budget | Invalid connector metadata becomes a safe unavailable projection; preserve history/facts. Unfittable fixed facts: `quota-exceeded` |

## 5. Good / base / bad cases

- **Base:** default unconfigured Magpie reads without inference; owner saves a target, then explicitly tests its exact binding.
- **Good:** a check times out; another consumer keeps the same connector owner and completes, including after the cancelled caller emits a late event.
- **Good:** A→B selection commits but retirement fails; same-ID retry converges, and returning to A requires fresh key input.
- **Good:** max legal history plus eight 2048-character URLs fits the final Result, retaining facts and truthful omission flags.
- **Bad:** any saved key, metadata, plugin activation, local `/models` response or synthetic fixture is presented as real provider verification.

## 6. Required tests and assertions

- [Native connection tests](../../../packages/companion-runtime/src/model-connections.test.ts): consumer/provider deny and source boundaries, original native/error/event identities, two pending consumers, caller/deadline isolation, old callbacks, SDK/host save fencing, observer faults and physical drain.
- [Unbound transport probe](../../../qa/probes/companion-model-transport.test.mjs): no `bind`; committed save aborts the retained transport before return without changing owner or settling raw work early; old new calls/results rejected.
- [Controller/HTTP tests](../../../apps/companion-service/src/model-controller.test.ts): zero-call save, actual SSE, deterministic same-ID barrier only one request, process/full-path key CAS, switch-away/partial-retry retirement, malformed custom projectors, healthy409 handling, ingress false/403 and final maximum SQL snapshot bytes/flags.
- [Transport](../../../apps/companion-service/src/model-client.test.ts) and [source authority](../../../packages/companion-runtime/src/source-authority.test.ts): actual socket cancellation, native partial/options, fingerprint/lease refusal and no persisted key canary.
- [Config tests](../../../plugins/model-connection-magpie/src/index.test.ts) and [state tests](../../../plugins/state-sqlite/src/state.test.ts): fixed endpoint/auth constraints, optional budget, unchanged default projection and facts preserved/fixed-budget failure.
- [CLI tests](../../../apps/companion-service/src/main.test.ts): saved model + no env override logs actual mode; disabled state still exposes model management; zero inference and clean SIGTERM.
- Preserve [service recovery/Core/Docker gates](companion-service.md#6-required-tests) and full `pnpm check`; keep browser, loopback protocol and authorized real-provider evidence distinct.

## 7. Wrong vs correct

```ts
// Wrong: a pre-lock read can be stale; the atomic receipt may already be duplicate.
await this.runtime.state('recordCommand', lookup);
await client.respond(request, options);
// Correct: after checked admission under the existing control boundary.
const receipt = await this.runtime.state('recordCommand', lookup);
if (receipt.status === 'duplicate') return { receipt, view: await this.view() };
// Only this newly admitted intent starts tracked native work.
```

```ts
// Wrong: this signal includes one caller's cancellation, not just provider lifetime.
if (sourceSignal.aborted) this.fence(captured);
// Correct: source invalidity is shared; a cancelled request is local.
if (!this.sourceCurrent(captured)) { this.fence(captured); return; }
if (sourceSignal.aborted) return;
// Forward the original event only while its consumer/operation is current.
```

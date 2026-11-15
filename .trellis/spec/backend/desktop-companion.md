# Shared desktop companion contracts

## 1. Scope / trigger

Use when changing the desktop service client, Main/preload boundary, local presentation saves or shared-startup admission.
The independent service owns Agent identity/persona, messages/facts, work, artifacts and model settings; Main owns one connection/projection for pet and console.
Read [service contracts](companion-service.md) for canonical state/execution and [model contracts](model-connections.md) for gateway configuration/credentials.
The ordinary [client plugin](../../../plugins/companion-client/plugin.json) owns endpoint Config and source lifetime, not another Agent/history store.
Shared [Main startup](../../../apps/desktop/src/main/index.ts) does not construct legacy Core/Demo/model/OAuth/voice controllers or import their history/vault.
Local appearance/theme and existing explicit audio mechanisms retain their existing owners; unsupported old features get no local fallback.

## 2. Signatures

Canonical declarations live in source; extend them there instead of copying DTOs into clients or another spec.

| Boundary | Canonical source / operation |
| --- | --- |
| Browser-safe client state, pending intents, fixed methods/channels | [desktop-companion.ts](../../../packages/contracts/src/desktop-companion.ts): `DesktopCompanionBridge`, `DesktopCompanionState`, `DESKTOP_COMPANION_IPC` |
| Local presentation patch/snapshot | [same declarations](../../../packages/contracts/src/desktop-companion.ts#L117): `DESKTOP_PRESENTATION_KEYS`, `DesktopPresentationBridge` |
| Main connection implementation | [DesktopCompanionController](../../../apps/desktop/src/main/companion-client-controller.ts): connect/reconnect/disconnect, snapshot/SSE, commands, reads and artifact save |
| Native source/config/credential port | [companion-client-types.ts](../../../apps/desktop/src/main/companion-client-types.ts): `DesktopCompanionHostPort`, `DesktopCompanionSource`, `DesktopCompanionEndpointSave` |
| Service persona/memory | [canonical DTOs](../../../packages/contracts/src/companion-profile.ts) and [persona-memory contracts](persona-memory.md): bounded reads and fixed console owner writes |
| Shared wire readers/guards | [protocol export](../../../plugins/text-client/src/protocol.ts), [HTTP/SSE helpers](../../../plugins/text-client/src/client/protocol.ts), [guards](../../../plugins/text-client/src/client/guards.ts) |
| Physical local publication | [companion-artifact.ts](../../../apps/desktop/src/main/companion-artifact.ts): `saveCompanionArtifact`, private `ArtifactSaveCommit` provenance |

`saveEndpoint(baseUrl, expectedRevision)` returns `Result<DesktopCompanionEndpointSave>`: outer success retains canonical saved baseUrl/configRevision plus a nested source Result.
`withToken<T>(source,token,signal,operation,commit?)` is host-only; its optional commit metadata is never a renderer/SDK credential bypass.
Preload exposes frozen named [facades](../../../apps/desktop/src/preload/companion-bridge.ts); Main's [closed request table](../../../apps/desktop/src/main/companion-client-request.ts) checks roles, arity, exact keys and the current trusted file frame.
`openWeb({connectionId}): Promise<Result<null>>` accepts no URL/token. Main validates the exact trusted frame, rechecks the captured current connection after async source checks, and calls its injected opener only with the normalized service root; pending opening work joins the existing connection lifetime. The [startup](../../../apps/desktop/src/main/index.ts) injects `shell.openExternal`. It exposes no QQ management configuration.

Only console manages auth/model and owner-form writes. The fixed bridge adds `readMemory`, `saveProfile`, `upsertFact`, `forgetFact`; exact types, saved/applied facts and counters live once in [persona-memory.md](persona-memory.md). There is no arbitrary HTTP/path method or Main `/api/model/credential` relay.

## 3. Contracts

**Target, auth and saved facts**

- Config is the existing FileConfigStore CAS owner, keyed by pluginId/instanceId. The client plugin's immediate `baseUrl` defaults empty.
- Explicit owner-selected HTTP/HTTPS service roots, including LAN, normalize to one origin; reject userinfo/query/fragment/non-root path and redirects.
- Native service-target selection is not a wildcard kernel network permission or a relaxation of model-gateway API-key URL rules.
- Token is24–512 UTF-8 bytes, rejects controls, and stays in the current Main process; quotes/backslashes remain legal. No environment/profile/account import or persistence.
- Connect.expectedRevision is source Config CAS revision, not the Main projection revision. Reject stale CAS without retiring healthy auth.
- After CAS commits, fence predecessor auth before fallible cleanup. Preserve saved endpoint/revision if later source read, disable/revoke or drain fails.
- Saved is not connected/applied/verified. Post-commit source loss returns the saved facts with unavailable/offline state and no unauthorized requests.
- Reconnect reuses only the same live memory binding; explicit disconnect, target/auth replacement or process exit requires fresh token supply.

**One projection and bounded wire**

- One Main snapshot/fetch-SSE owner maintains confirmed service state; command views/receipts never replace snapshot state. [M6 personal-surface rules](qq-platform-entry.md#personal-surfaces) add bounded readonly `snapshot.qq`, without another reader/config API. `desktopPersonalSnapshot` filters owner-private messages/work and owner/public facts; unknown audience is not owner. Same-key fact rows in different scopes remain distinct.
- Main-local revision orders projections; connectionId identifies the captured client binding, not an Agent, task or execution Session.
- Ordinary JSON reads use20s deadlines; SSE bytes/comments renew45s liveness. Failed reads/ended streams leave live state before reconciliation.
- Offline retains last confirmed content/time and labels nonterminal work unknown. Snapshot refresh alone cannot invent a live stream; reconnect retains one reader.
- Service JSON remains≤64KiB UTF-8. Direct Main IPC state has its own≤80KiB ceiling around the canonical personal projection and≤16 pending metadata entries. Scope filtering is not another byte-trimming pass.
- Do not run this80KiB aggregate through64KiB supervisor/preload validation or trim canonical facts/history again. Supervised native operations return null privately.
- Inline message text remains8000 UTF-16 code units (`string.length`); canonical semantic text may be a declared document when the complete record exceeds its local budget. Preserve its content/material metadata instead of treating the explanation as the full body. Name/persona limits remain80/16384 code points in the existing Config validator, with separate UTF-8 budgets.
- Profile reads are bounded, read-only, omit raw Config and must match current agentId/profileRevision; mismatches conflict, not overwrite persona.

**Source authority and actual settlement**

- Bind owner generation, package digest, policy epoch, Config revision, normalized target and connectionId through [the source adapter](../../../apps/desktop/src/main/companion-client-host.ts).
- Recheck actual owner/policy/signal after asynchronous trust/config admission. An already-aborted signal must not leave a fictitious connecting state.
- Acquire source file-read and service-token credential leases under an existing TaskSupervisor task; preserve native values privately and await actual work plus settled.
- Read callbacks validate source at admission/event/return boundaries; explicit revoke aborts live leases. There is no filesystem watcher claim.
- Detached SSE checks must revalidate the exact captured connection after await, for success, false and rejection; same owner/generation does not identify the same connection.
- [DesktopHost's narrow stop wrapper](../../../apps/desktop/src/main/desktop-host.ts#L215) awaits both Main drain and the existing worker disposer even if either fails.
- Logical cancellation is not physical cleanup. Unconfirmed cleanup stays unavailable/pending_restart and cannot activate a replacement.
- Client disconnect/removal never stops service work. Local playback stop, foreground stop and selected-task stop remain distinct.

**Intent ledger, pending confirmation and privacy**

- [Console plugin actions](../../../apps/desktop/src/main/console-plugin-request.ts#L63) notify only the acted-on plugin's actually adopted desired intent.
- [The ledger](../../../apps/desktop/src/main/shared-application-state.ts) changes that marker only; preserve unrelated markers, guide/migration fields and existing user data.
- An unsupported/untrusted/unadmitted role's default desiredActive=false is not an explicit disable. Outer Result.ok or operationError alone cannot decide adoption.
- Adopted disable may end pending_restart; failed uninstall may already have adopted stop. A pre-admission stale/protected/rejected action adopts nothing.
- Local presentation uses the canonical allowlist merged into the original profile CAS; excluded identity/persona fields stay unchanged even through generic host/SDK saves.
- Canonical inputId/terminal task confirmation may remove pending before its HTTP receipt settles. Only the same remaining pending-entry object can be settled afterward.
- Unknown outcomes get one coalesced reconciliation, never automatic resend. Retry unchanged intent with the same commandId; do not fabricate a missing receipt.
- A stop receipt must match commandId and requested taskId. Task detail must match requested id and every artifact.taskId; one shared guard protects browser and Main.
- [SecretRedactor.containsValue](../../../packages/host-kernel/src/credentials/redactor.ts#L37) scans decoded own strings/keys without native serialization; escaped JSON text is not a safe substitute.
- Keep native object/error identities and opaque values. Credential echo produces a fixed refusal, not a partly redacted snapshot or raw exception.
- Native model views force writable=false; the console-only controlled model UI has no credential HTTP action. See [model UI interaction](../frontend/model-settings.md).

**Artifact publication**

- Main owns the native chooser and a≤64MiB/120s authenticated transfer. Renderer supplies a known artifact id, not a URL or filesystem destination.
- Verify metadata/final byte count, write an exclusively created same-directory temporary file, and remove only the verified owned temporary path on failure.
- Enter rename only while the captured binding is valid. Retirement waits an already-entered rename before replacement can activate.
- Record the exact successful Result in a module-private WeakMap only after real rename success, bound to source object and connectionId.
- Require map existence **and** exact recorded identity: absent `get()` and an unrecorded `undefined` are not proof. Saved-shaped JSON also proves nothing.
- Preserve a committed saved fact for its original operation across cancellation; never publish it as the replacement's action. Real rename failure remains failure.
- Chooser cancellation/stale results or cancellation before commit cannot publish a final file. No general transaction framework or rollback fiction is added.

## 4. Validation & error matrix

| Condition | Required result |
| --- | --- |
| Wrong frame/role/arity/extra key | Fixed permission-denied/invalid-input before I/O |
| Bad root URL/token or stale Config CAS | Refuse; no auth transfer, preserving healthy prior binding on CAS conflict |
| Config committed, later source unavailable | Saved endpoint/revision plus current error; no unsaved claim or request under lost authority |
| Disable/revoke during source admission | Recheck after await; no false connecting/live state |
| Delayed old detached source check | Ignore for replacement; owner identity alone cannot retire it |
| Source cleanup incomplete | pending_restart/unavailable; no replacement |
| Wrong/null stop task receipt or wrong task detail | Fixed unavailable/uncertain; retain original intent id and reject cross-target cache/artifact use |
| Canonical confirmation precedes late/dropped receipt | No pending resurrection and no invented receipt |
| Quoted/backslash token echoed in value/key | Refuse decoded echo with fixed error; never narrow legal token syntax to hide the defect |
| Retire before rename / successful entered rename / failed rename | No final file / original saved fact / actual failure, respectively |
| Missing provenance, unrecorded undefined or forged saved object | Ordinary fences remain enforced |
| Skipped role versus adopted failed stop | No new marker versus persist desired disable while preserving failure status |

## 5. Good / base / bad cases

- **Base:** source starts with saved nonsecret endpoint and no token; no HTTP/model probe or local Core starts from restore.
- **Good:** new target CAS commits, source is revoked during post-save read; UI receives the saved revision and unavailable state without a network call.
- **Good:** native rename is gated; replacement waits, real file bytes establish saved under the old request, then the new binding becomes live.
- **Good:** canonical task/message facts arrive before a dropped response; pending stays cleared and retry never invents a new intent.
- **Bad:** scan all installed desiredActive=false entries into disabled markers, or accept artifact success from payload.status/undefined equality.
- **Bad:** JSON.stringify an echo before matching the raw bearer, or let an old owner-matching SSE callback stop a new connection.

## 6. Tests required

- [Controller tests](../../../apps/desktop/src/main/companion-client-controller.test.ts): exact frame/role, actual UTF-16 bounds, near64KiB→80KiB aggregate, one SSE reader, detached old false/true/rejection after replacement, already-aborted admission and canonical-before-late/dropped message/stop receipts.
- [Source/native tests](../../../apps/desktop/src/main/shared-companion-host.test.ts): actual-platform worker/leases, disable waits for drain, rejected disposer stays pending_restart, revoked work waits actual settlement, real gated rename success/EISDIR failure and unrecorded saved-shaped/**undefined** negatives.
- The same source tests assert quoted bearer snapshot/profile echo refusal, disable while trust is pending, and post-CAS disable/revoke/throw with saved metadata and zero unauthorized HTTP.
- [Artifact tests](../../../apps/desktop/src/main/companion-artifact.test.ts): actual authenticated file bytes, stale chooser zero I/O, aborted stream cleanup and no final file.
- [Lifecycle request tests](../../../apps/desktop/src/main/console-plugin-request.test.ts) distinguish unadopted failures from adopted pending_restart/removal failure; [ledger tests](../../../apps/desktop/src/main/shared-application-state.test.ts) verify restart markers and untouched fields.
- [Fixed HTTP target tests](../../../plugins/text-client/tests/targeted.test.mjs): wrong/null receipt stays uncertain, retry commandId is unchanged, wrong task and cross-task artifact metadata are rejected.
- [Native model tests](../../../apps/companion-service/src/model-client.test.ts) cover the same escaped-key defect and preserved native exception/options identity; [profile tests](../../../apps/companion-service/src/profile.test.ts) assert auth/origin/no-store/bounded canonical fields.
- [Existing credential tests](../../../packages/host-kernel/src/credentials/secret-boundary.test.ts) and [broker lifetime tests](../../../packages/host-kernel/src/credentials/credential-broker.test.ts) remain required; protocol/source tests do not replace them.

Run affected package types/tests/lint and the root quality gate after integration. Use isolated fixture data; no real model call or original trial-service restart is needed.
Software/root checks do not establish completed native acceptance. Actual Electron Main/preload/two-window/DOM/save-chooser checks and Windows-specific device/profile evidence must be recorded separately; they are not finally accepted by this spec.
Linux uses actual declared client support and production shared components; unchanged Windows-only plugins must remain rejected, with no process.platform/target spoofing or core-admission relaxation.

## 7. Wrong vs correct

```ts
// Wrong: an unrecorded value and WeakMap.get() can both be undefined.
return commit?.source === source && committedSaves.get(commit) === value;
// Correct: only an actual recorded rename result proves the narrow exception.
return commit?.source === source && committedSaves.has(commit)
  && committedSaves.get(commit) === value;
```

```ts
// Wrong: the canonical snapshot may already have removed this operation.
connection.pending.set(id, lateOutcome);
// Correct: canonical reconciliation or a newer operation may have removed/replaced the entry.
if (connection.pending.get(id) !== pending) return result; // real receipt/error unchanged
```

For async source checks, apply the same rule to the captured connection before **and after** await. For credentials, inspect decoded values rather than comparing escaped serialized text; preserve originals instead of roundtripping native results.

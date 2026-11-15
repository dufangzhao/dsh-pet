# Model settings interaction contracts

## 1. Scope / trigger

Use for the companion text client's model settings, request outcomes, credential entry, Dialog layout and browser checks. The canonical browser types are [companion-model.ts](../../../packages/contracts/src/companion-model.ts); the native/service boundary is maintained in [model connections](../backend/model-connections.md). This supplements the [frontend baseline](index.md), not a new UI framework.

## 2. Signatures

- [CompanionClient](../../../plugins/text-client/src/client/client.ts): `saveModel(command)`, `testModel(command)`, `writeModelCredential(command)` return `Result<CompanionModelView>`; `refresh()` requests an authoritative snapshot.
- `CompanionSnapshot.model?: CompanionModelView`: absence means this service has no settings feature; a present invalid view invalidates the complete received snapshot.
- [ModelDialog](../../../plugins/text-client/src/client/model.tsx) owns the form and its lifetime; [model-form.ts](../../../plugins/text-client/src/client/model-form.ts) holds the form's tested transitions. Shared DTOs are imported rather than copied.

## 3. Contracts

The two principal actions are save/apply and explicit connection test. A saved config, an applied connection, an enabled model foreground and a verified check are distinct server facts. A synthetic verification must say that no real model was connected. An unenabled model selection is not a scripted fallback.

The global model view has one owner: the existing snapshot/SSE reconciliation path. A command response belongs to that particular operation and supplies its next CAS values; it cannot directly replace `snapshot.model`. A newer snapshot may already have observed another save, key update or check. Successful commands schedule reconciliation rather than guessing order from opaque versions.

A draft captures profile/config/credential versions at its read baseline. The profile revision detects server selection/mode changes; connector config/key versions belong to the **draft target**. On selecting B, capture B's versions and compare them with the current B entry, not `view.desired` (which remains A until saved). A second server baseline is unnecessary. Test unequal A/B revisions: choosing B alone is not an external edit, saving sends B's revision, and a later B/profile change still conflicts. Ordinary refreshes may update an untouched, idle form, but cannot clear an edited field, typed key or in-flight busy state. An external change preserves the draft and requires an explicit rebase/review before a new save intent. Rebase updates the baseline and clears the old save intent, not the user's fields.

A typed Key stays only in component memory. Clear it at dispatch and when connector/full target URL/auth mode changes; changing only the model does not change the credential target. Key-only save and clear use the captured baseline; only a preceding successful save in the same operation may supply the second step's new versions. Empty input is not deletion. The server's `credential.writable` alone controls whether input is offered; do not infer permission from URL, draft fields or proxy headers. Generic form dirtiness cannot imply that a Key is needed. A no-secret connector stays no-secret; only an actual draft auth-mode transition to gateway-key warrants a save-auth-first message. Render the selected target's credential facts and the specific pending auth edit separately.

Closing/reopening advances the form's generation. An old response cannot settle a new form. This local fence is separate from the global snapshot rule and does not make an already accepted backend operation disappear.

## 4. Validation / error matrix

| Case | Required result |
| --- | --- |
| Optional model view absent / present malformed | Hide feature / reject snapshot |
| Nonsecret config unchanged, Key entered | One credential request; no redundant config save |
| Stale config or credential baseline | Preserve draft, clear dispatched secret, show conflict and reachable recovery |
| Save succeeds but applied binding absent | Report saved but not applied |
| Desired model but foreground disabled/unavailable | Report actual model state; do not call it scripts |
| Test binding no longer equals applied binding, including null | Do not display old verified result as current |
| Test request network/timeout outcome uncertain | It may already have started; do not claim rejection or resend automatically |
| Offline, foreground busy, or test running | Disable relevant writes/tests with a reason; independent backend work alone does not block |
| `writable=false` | No password/clear controls; explain supported operator input |
| Native Dialog closed | No layout box or pointer interception |

## 5. Good / base / bad cases

- Base: no model configured, scripted mode, no implicit model call; fields show current defaults without claiming discovery.
- Good: save a connection, explicitly test it, then use model mode; a late response from earlier save A cannot overwrite newer connection B or a newer check.
- Bad: adopt a command's old view into global state; refresh away a typed Key; use newest props versions to submit an older draft; show applied because HTTP returned200.

## 6. Required evidence

- State/transport tests cover optional/invalid view, secret-free state, response identity and truthful result parsing.
- Real delayed HTTP/SSE tests serialize the old response **before** delaying it. Verify newer binding/check survives; delaying before serialization cannot reproduce the stale-response bug.
- Form regressions cover Key-only, retarget clearing, dispatch failure, stale baseline, explicit conflict recovery, late form settlement and saved-but-unapplied results.
- [Fixture DOM probe](../../../plugins/text-client/tests/browser/model-dialog.browser.mjs) clicks actual controls and checks closed/open Dialog state at desktop and390px; no forced click or internal state injection substitutes for reachability.
- [Real API probe](../../../qa/probes/companion-model-browser-acceptance.mjs) verifies service outcomes/call deltas, downloads, identity/work continuity and viewport hit testing against a frozen build. Protocol fixture results are not real Magpie/upstream acceptance.

## 7. Wrong vs correct

```ts
// Wrong: an older command response may arrive after a newer snapshot.
this.#dispatch({ type: 'model-view', view: result.value });
// Correct: keep the command result for its caller; reconcile through the existing reader.
if (result.ok) this.#scheduleRefresh();
```

```css
/* Wrong: author display overrides the native closed-dialog rule. */
.pk-dialog { display: flex; }
/* Correct: apply layout only while open; closed dialogs keep their native hidden behavior. */
.pk-dialog[open] { display: flex; }
```

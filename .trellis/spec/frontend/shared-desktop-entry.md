# Shared desktop entry (pet + console)

## 1. Scope / trigger

Use when wiring the desktop pet window and settings console to **one** companion service connection, or when touching the shared renderer hooks that read it. The canonical browser types live in [desktop-companion.ts](../../../packages/contracts/src/desktop-companion.ts) and [companion-profile.ts](../../../packages/contracts/src/companion-profile.ts); this supplements the [frontend baseline](index.md) and the [model settings contract](model-settings.md), and does not introduce a second UI framework or a local core.

## 2. Signatures

- [use-companion.ts](../../../apps/desktop/src/renderer/shared/use-companion.ts) — `useCompanion()` returns `{available, state, loading, readError, notice, refresh, connect, reconnect, disconnect, send, stopTask, stopForeground, readProfile, readTask, saveArtifact, saveModel, testModel, clearNotice}`. `connect` returns `ConnectResult` (adds `configRevision`).
- [companion-state.ts](../../../apps/desktop/src/renderer/shared/companion-state.ts) — pure derivations: `canConnect`, `canSend`, `canStopTask`, `settleTarget`, `endpointBaseline`, `endpointMoved`, `rebaseOnConnect`, `taskView`, `petStateOf`, `sendBlockedReason`.
- [use-local-presentation.ts](../../../apps/desktop/src/renderer/shared/use-local-presentation.ts) — `useLocalPresentation()` owns the *machine-local* presentation record, not the service.
- [console-views.ts](../../../apps/desktop/src/renderer/shared/console-views.ts) — the current composition's four pages. The wider `AppView` in [app-views.ts](../../../apps/desktop/src/renderer/console/app-views.ts) belongs to retained design experiments and is not the production page list.

Import DTOs from `@pet/contracts`; never restate their shape.

## 3. Contracts

**One snapshot owner.** `DesktopCompanionState` comes only from Main via `getState()`/`onChanged`. A command response is that operation's receipt and is never written into the snapshot; a successful command schedules reconciliation. `state.revision` orders projections (a lower one is dropped); it is *not* the Config CAS version.

**`latest` is a fence, not a dispatcher.** The hook keeps one `latest` ref advanced only by `accept()`. It answers "does this result still belong to the current target" — it never re-aims an action. Each action captures the `connectionId` of **the render that produced it**, and compares against `latest` both *before dispatch* and *after settlement*; either mismatch returns `stale` with **zero IPC**. A stale render must not send A's `taskId` or text to B. Reading `latest.current` as the dispatch target is the bug this rule exists to prevent.

**Two different revisions.** `state.revision` is Main's projection order. `connect.expectedRevision` is the source Config CAS version. Mixing them guarantees a conflict after the first projection.

**Endpoint draft CAS.** The address form captures the Config version it was read at (`endpointBaseline`). Submitting uses that draft baseline, never "whatever is newest": an external A(rev1)→C(rev2) edit must not be silently overwritten by a draft B. `endpointMoved` reports an external change and the draft is preserved until the user explicitly rebases.

**Baseline advances from the committed fact.** After `connect` succeeds, the form advances its baseline from **`ConnectResult.configRevision`** — the version this write actually landed — not from the pre-submit render's `state`. Do not guess `+1` and do not adopt an arbitrary latest view, which would erase a concurrent external update. `rebaseOnConnect` is that rule.

**Form pending suppresses false externality.** Main publishes the new Config (and may hold at `connecting`) before the `connect` promise settles. During that window the draft baseline legitimately lags; reporting it as "changed elsewhere" is a lie. A form-local `submitting` boolean (no new global state) keeps `endpointMoved` false while pending and drives `busy` so repeat submits are blocked. After settle the baseline has advanced, so a genuine external rev3 is still detected.

**Token lifetime.** The token is typed for *this target, this attempt*. Clear it at dispatch (before the invoke, so no path leaves a secret), on any address draft edit, on explicit "read latest address", and on cancelling the token input. Changing only the token for the same address stays a normal path.

**Online update is reachable.** `canConnect` is `source === 'ready' && phase !== 'connecting' && phase !== 'retiring'`. Live is allowed: the service supports online retire→newbind, and disabling it would leave no in-place way to change target. Only the two transitional phases are blocked, plus any non-ready source. Wording follows `updatesConnection`: "更新连接或更换令牌" when connected, otherwise connect/reconnect copy.

**Service identity and memory have one owner form.** Persona and active facts are edited through the shared component and rules in [persona and active memory](persona-memory.md); the desktop only adapts its fixed bridge into that transport. Persona text still comes from a detail read, and the model form reuses the existing [model-ui](../../../plugins/text-client/src/model-ui.ts) dialog through `createReadOnlyModelTransport`, so `writable=false` stays true and no credential input is offered.

### Pet window specifics

The pet window has **no** connect/disconnect rights — only the console may call `connect|reconnect|disconnect|saveModel|testModel`. The pet shows facts and opens settings.

Presentation is scoped: `@pet/text-client/model.css` and the ui-kit tokens are imported by the console only. The pet bundle must stay free of `pk-*` and `tc-model-dialog` so the transparent window is not painted opaque. A closed dialog must occupy no layout box and intercept no pointer events.

Any new pet panel or state must enter both `collectHitShapes()` and the `geometry` key in [App.tsx](../../../apps/desktop/src/renderer/pet/App.tsx); that key already includes phase, pending count and per-task `id:status`. Otherwise the interaction region goes stale and the pet becomes unclickable.

### Retained but unmounted

`console/start-designs/**`, `console/style-families/**`, `console/original-ui/**`, `console/pet-preview.*`, `preview-behavior.ts`, the demo/application/model-connection/voice-input hooks and `pet/PetDialog.tsx` are **retained design and QA material**. They are not mounted from the production roots and must not be deleted to make new types pass; their pure helpers are still callable contracts for the experiments and the start-style QA probes.

Production roots must not import them. Verify with a scoped search rather than by removal. Unmounted legacy source does not start a second agent or a local core.

## 4. Validation / error matrix

| Case | Required result |
| --- | --- |
| `source: 'disabled'` | No connect action; point to the plugins page to re-enable |
| `source: 'unavailable'` | "连接组件不可用"; no form |
| `phase: 'connecting' \| 'retiring'` | Connect action disabled; no second submit |
| `phase: 'live'` | Connect action **enabled** (update target / rotate token) |
| `phase: 'offline'` | Connect enabled; last confirmed content kept, status marked unknown |
| Read fails / returns null / older revision | `latest` unchanged; not evidence that the target did not change |
| Action returns after target switched | `stale`; draft kept, no success, no old profile/task/model payload |
| Action throws, same target | `uncertain`; text kept, retry reuses the same `commandId` |
| Action throws, target switched | `stale`; the old error never lands on the new target |
| `connect` fails | Draft and old baseline preserved; token not refilled |
| Self submit pending | No external-change notice; controls disabled |
| Text over 8000 | Rejected by `COMPANION_MAX_TEXT`; composer `maxLength` matches |

## 5. Good / base / bad cases

- Base: no connection — console shows honest empty state, pet shows facts only and cannot connect.
- Good: connect, send, stop a task by id, save an artifact, then rotate the token while live; each action belongs to the target it was rendered for.
- Bad: writing a command response into the snapshot; using `latest.current` as the dispatch target; sending `expectedRevision: state.configRevision` for a draft read at an older Config; clearing the draft on an `uncertain` send; reporting the self-caused mid-commit revision as an external change.

## 6. Required evidence

- [use-companion.test.ts](../../../apps/desktop/src/renderer/shared/use-companion.test.ts) drives the real hook through a minimal React stand-in that reproduces hook-slot order, dependency-based `useCallback` reuse and explicit commits, so a genuinely stale render's action can be called after a newer state is adopted. Covers zero-IPC staleness for send/stopTask/stopForeground/disconnect/readProfile/readTask/saveArtifact, plus the reverse case that the current render still dispatches.
- [companion-state.test.ts](../../../apps/desktop/src/renderer/shared/companion-state.test.ts) covers the pure matrix: target settlement, task staleness when offline, and the connect phase/source table.
- [app-pages.test.tsx](../../../apps/desktop/src/renderer/console/pages/app-pages.test.tsx) renders the real pages and asserts reachability on the actual buttons (`start-ask-token` enabled on live, disabled on transitional/unavailable) and the CAS/baseline rules.

**Evidence boundary.** These are hook-stand-in and static-render tests. They do **not** exercise real DOM event ordering, real React commit timing, or the Electron main round trip. The ConnectionCard click path (fill token → edit address → token empty), the pending-window absence of a false external notice, and online update all require the native suite; do not cite the above as DOM acceptance.

## 7. Wrong vs correct

```ts
// Wrong: the stale render's intent is silently re-aimed at the newer connection.
const current = latest.current;
await bridge.sendMessage({ connectionId: current.connectionId, commandId, text });

// Correct: keep this render's target; compare before dispatch and after settlement.
const target = state.connectionId;
if (settleTarget(latest.current, target) === 'stale') return STALE;
const reply = await bridge.sendMessage({ connectionId: target, commandId, text });
if (settleTarget(latest.current, target) === 'stale') return STALE;
```

```ts
// Wrong: a successful connect advances the baseline from the pre-submit render.
setBaseline(state.configRevision);

// Correct: advance from the version this write actually committed.
setBaseline((current) => rebaseOnConnect(result.configRevision, current));
```

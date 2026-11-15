# Persona and active memory (shared form)

## 1. Scope / trigger

Use when changing the web or desktop owner surface for the service Agent's name/persona or its active facts, or when touching the shared form that drives both. Canonical types are [companion-profile.ts](../../../packages/contracts/src/companion-profile.ts) and [companion-memory.ts](../../../packages/contracts/src/companion-memory.ts); snapshot fields live in [companion.ts](../../../packages/contracts/src/companion.ts). This supplements the [frontend baseline](index.md) and inherits the connection rules in [shared desktop entry](shared-desktop-entry.md); it adds no second snapshot owner, router or state framework.

## 2. Signatures

- [memory-form.ts](../../../plugins/text-client/src/client/memory-form.ts) — pure rules: `PersonaMemoryForm`, `emptyPersonaMemoryForm`, `profileEditable`, `memoryEditable`, `availability`, `profilePlan`, `memoryPlan`, `upsertCommand`, `forgetCommand`, `adoptProfile`, `adoptMemory`, `forgetSucceeded`, `rebaseOnLatest`, `failOperation`, `startEditing`, `startAdding`, `cancelEditing`, `originLabel`, `applicationLabel`, `codePointLength`, `keyProblem`, `valueProblem`.
- [persona-memory.tsx](../../../plugins/text-client/src/client/persona-memory.tsx) — `PersonaMemory` and its `PersonaMemoryProps` / `PersonaMemoryTransport`.
- [persona-memory-ui.ts](../../../plugins/text-client/src/persona-memory-ui.ts) — the UI-only subpath both clients import. Styles need an explicit `@pet/text-client/persona-memory.css`.

`PersonaMemoryTransport` is structural — five methods (`readProfile`, `saveProfile`, `readMemory`, `upsertFact`, `forgetFact`). Do not widen it to a concrete client class.

## 3. Contracts

**One shared form.** Web and desktop render the same component and the same pure rules. Desktop only adapts the fixed bridge into the transport and its own layout; it must not grow a second copy of baseline, retry or dirty logic. Web's `CompanionClient` already satisfies the transport shape, so the adapter is a five-method object literal, not a new abstraction layer. If a third surface ever needs it, it supplies the same five methods rather than a variant of the form.

**Snapshot owns memory; detail reads are per-feature.** `snapshot.facts` + `snapshot.memory` is the single global projection, so SSE-arrived facts and application state are visible without a fetch. `readMemory()` is only a form-level read/recovery, and must not become a cache that permanently outranks the snapshot. Persona text is not in the snapshot (it can be large), so it needs its own read owner: when the canonical `agent.profileRevision` moves, keep the previously read text, mark it stale and coalesce one re-read — never null it out, because a null profile makes the component report "unsupported" and hides the external-change notice.

**`null` is "not captured"; `0` is a real revision.** `profileBaseline` / `memoryBaseline` / `factBaseline` are nullable. `null` means no baseline has been captured yet; `0` is a legitimate revision (an empty fact set). A baseline is captured once, when the draft starts (first keystroke, `startAdding`, `startEditing`, explicit rebase) from the status actually rendered at that moment. Never re-derive it from the newest status on every render: doing so turns "empty set at rev0, someone else writes rev1, then submit" into a silent CAS against rev1.

**Externality compares against the captured baseline.** `profileChangedUnderneath(baseline, view, selfPending)` and `memoryChangedUnderneath(baseline, status, facts, editingKey, factBaseline, selfPending)` report a change only when the incoming revision is **newer** than the captured one. A revision below the baseline is a view that has not caught up, not an external edit. `selfPending` suppresses the notice while this form's own write is in flight, because the mid-commit revision is ours.

**Render-captured target, operation identity, unmount fence.** Each action uses the `connectionId` of the render that produced it (see the fence rules in [shared desktop entry](shared-desktop-entry.md)). The in-flight lock is a token, not a boolean: `claim()` returns a symbol and `release(token)` only clears that token, so a settling old target cannot unlock a newer operation. Handlers hold the token in `try`/`catch` and clear both the lock and `busy` on a thrown transport. An unmount bumps the generation, so a late receipt neither settles the next page nor announces.

**Forget freezes its whole intent.** Opening the confirm captures `{fact, memoryRevision, targetKey, generation, commandId}`. Confirming uses only that frozen payload; it never re-reads the latest status, so a concurrent edit cannot be deleted by a stale confirm. The dialog closes only on success, so a failed or unknown outcome retries with the same `commandId`. Success goes through `forgetSucceeded(form, forgottenKey, result, facts)`, which keeps an unrelated in-progress draft: forgetting A must not clear or advance the draft for B.

**Per-feature rebase.** `rebaseOnLatest` takes each feature's own read result (`{ok:true,value}` / `{ok:false,error}`). A failed read reports the real error instead of claiming success, and a successful one never moves a baseline backwards past a revision already observed. Clicking the persona re-read must not advance the memory draft baseline, so the two rebases are separate actions.

**Honest labels.** `applicationLabel(applied, error)` separates "已保存，尚未生效" from "已生效"; `adoptProfile` and `adoptMemory` build this operation's notice from that response's `management.application` / `view.application` facts. A duplicate receipt proves the write was recorded, not applied — say "此前已记录，没有重复写入". `originLabel` returns "手动设置" for `owner-form` (accurate on both surfaces), "对话中记住" for `user-input`, and an explicit unknown for `legacy-unknown` or a missing field.

**Availability copy stays neutral.** `availability()` reports one reason at a time, in the order: not connected → this form's own operation in flight → the feature's metadata missing → the field itself invalid. The metadata reasons name the missing capability ("服务暂未提供可编辑的人格/记忆"), never the peer's version, because a current peer whose source is unavailable looks the same as an old one. A busy agent is an ordinary operation condition, not a capability claim.

**Limits follow the contract's units.** Profile name/persona are **code points** — use `codePointLength`, and do not put a UTF-16 `maxLength` on those inputs. Memory key is trimmed and case-sensitive; value is preserved exactly and only checked for non-whitespace, so an empty value is an invalid draft, never a delete. Show `usage.count/32` and `usage.dataBytes/8192`; `originBytes` is an internal budget and is not a user-facing counter.

**Validation is separate from error display.** `keyProblem`/`valueProblem` always validate and determine whether submit is disabled. `memoryTouched` only controls `Field.error` presentation and resets when the editor is cleared. An untouched blank editor has no red error and cannot submit; do not return a fake valid result merely to hide feedback. Hints/counters must not duplicate the error text.

**Read details follow canonical metadata.** Web's read owner follows both connection generation and `agent.profileRevision`, coalesces the same target/revision read, and ignores superseded results or failures. A failed read keeps existing detail with an explicit retry; no automatic failure loop. An unedited idle form may follow newer actual detail even after a prior save; a dirty form keeps its captured baseline until deliberate rebase. `profileApplication` from the snapshot can change without a profile revision change and must not remain frozen in an older detail response.

### Where each surface mounts it

Desktop puts the component inside the existing persona page card, below the read action and above the local-presentation card; local appearance stays a separate concern and the transparent pet window imports none of this CSS. Web renders it in the existing side column under the task strip, with persona detail refreshed by its single connection/revision-aware read owner and memory derived from the snapshot. Neither surface gains a route, window or navigation entry. Long editable service names must stay within the rail's bounded footer at both collapsed and wide widths, with real ellipsis and the full name available through its title; hiding horizontal overflow alone is not a layout fix.

### Why the pure module is separate

Every decision that can silently corrupt data lives in `memory-form.ts` as a plain function: which baseline to send, whether a change is external, when to advance after success, what to keep on conflict. The component only wires those decisions to DOM and owns two things a pure function cannot: the in-flight token and the generation counter. Keeping that split is what lets the rules be tested without a browser while the interaction timing is tested with one.

## 4. Validation / error matrix

| Case | Required result |
| --- | --- |
| `profile.management` absent | Only persona becomes read-only ("服务暂未提供可编辑的人格"); memory unaffected |
| `snapshot.memory` absent | Only memory becomes read-only; persona unaffected |
| Agent `busy`, not live, or local write in flight | Writes disabled with a neutral reason; metadata presence never overrides these |
| Draft started at rev0, external write to rev1 | Submit still sends `expectedMemoryRevision: 0`; conflict keeps the draft |
| Baseline not yet captured | No command is dispatched (no fabricated `0` CAS) |
| Forget confirmed after the row changed | Sends the frozen row/set revision and conflicts; never deletes the newer row |
| Forget A while editing B | B's draft text and row baseline survive |
| Unknown or failed forget | Confirm stays open; retry reuses the same `commandId` |
| Transport throws | Lock and `busy` are released; the form stays usable |
| Old target settles after a switch | Result discarded; it must not unlock the newer operation |
| Saved but not applied | "已保存，尚未生效" with the real application error; never "已生效" |
| Duplicate receipt | "此前已记录，没有重复写入"; current application state shown separately |

## 5. Good / base / bad cases

- Base: no metadata — both blocks state their own "暂未提供可编辑" fact and stay read-only, without claiming the peer is an old version. A connected peer that simply has not sent the field yet looks the same, which is why the copy names the missing capability rather than the peer's age.
- Good: capture a draft, someone else writes, submit conflicts, draft survives, rebase only the feature that moved, save again.
- Bad: re-seeding the baseline from the newest status each render; treating `0` as "uninitialized"; letting `adoptMemory` clear an unrelated draft; releasing the lock unconditionally in `finally` without an ownership check; nulling the profile on revision change.
- Bad: showing "已生效" because the HTTP call returned 200, or "已应用" when only the Config write landed — the saved and applied facts come from different places and must be read from the response, not inferred from success.

## 6. Required evidence

- [memory-form.test.mjs](../../../plugins/text-client/tests/memory-form.test.mjs) — 28 pure-rule cases: nullable baselines, revision-above-baseline externality, value preservation, frozen forget payload, per-feature rebase, label honesty.
- [persona-memory-render.test.mjs](../../../plugins/text-client/tests/persona-memory-render.test.mjs) — 14 static-render cases: per-feature unsupported state, limits, origin labels, applied/error lines.
- [persona-memory.browser.mjs](../../../plugins/text-client/tests/browser/persona-memory.browser.mjs) — 20 real-Chromium component cases with controlled transport: rev0 submit, frozen forget retry, unrelated-draft preservation, cross-target lock ownership, rejection recovery, per-feature rebase and quiet-but-disabled empty forms.
- [rail-width.browser.mjs](../../../plugins/text-client/tests/browser/rail-width.browser.mjs) — five real-browser geometry cases using actual production CSS, including long names at collapsed/wide widths; fixture layout must not override the product rules.
- [web-profile-read.browser.mjs](../../../plugins/text-client/tests/browser/web-profile-read.browser.mjs) — seven actual App/client cases with controlled HTTP: same-Agent profile revision updates, dirty draft/rebase, application state, same-ID reconnect and readable failure recovery.

**Evidence boundary.** The browser suite drives real clicks and inputs against real React commit and remount, but the transport is a scripted fixture: no real service, model or network. It is component-level DOM evidence, not service E2E. Actual acceptance of the HTTP, migration and Electron paths belongs to the native suite.

## 7. Wrong vs correct

```ts
// Wrong: the draft baseline follows whatever the newest status says.
const memoryBase = status.revision;
// Correct: capture once when the draft starts; null means "not captured", 0 is real.
const memoryBase = form.memoryBaseline;
```

```ts
// Wrong: an unrelated forget clears the draft the user is editing.
return { ...form, editingKey: null, key: '', value: '' };
// Correct: only collapse the editor when the forgotten row is the edited one.
return forgetSucceeded(form, forgottenKey, result, facts);
```

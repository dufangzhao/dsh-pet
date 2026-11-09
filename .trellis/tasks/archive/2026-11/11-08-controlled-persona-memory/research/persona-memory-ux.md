# Controlled persona and memory: UI/UX research

Read-only research, 2026-11-08. No product edits, builds, service starts, model calls or data migration were performed. Backend/contract design is GPT's; this report locates the **existing renderer primitives, forms, hooks and shared component entry points** the two surfaces can reuse, and what the real consumers need. It does not invent DTOs or bridges.

Parent requirements are [P1–P8/C1–C8](../prd.md#L17). The [backend/state research](../../../../11-06-unified-companion-architecture/research/controlled-persona-memory.md#L1) already establishes owners and CAS semantics; this report does not restate them.

## What actually exists in the UI

| Area | Current source-backed behavior | Smallest UI extension |
| --- | --- | --- |
| Desktop persona | [persona.tsx](../../../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L35) reads profile on demand via `companion.readProfile()`, fences by `connectionId` generation, and shows revision/agentId. It is **read-only** and says so at [L130](../../../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L130). | Add name/persona inputs beside the read view, with a captured `expectedProfileRevision`. Keep the local presentation card below untouched. |
| Desktop facts | [CompanionFact](../../../../../../packages/contracts/src/companion.ts#L53) is key/value/revision/updatedAt; it already arrives in [snapshot.facts](../../../../../../packages/contracts/src/companion.ts#L86). | No renderer currently reads `facts` (grep: zero non-test hits). Add a memory card; the DTO is already in the snapshot. |
| Web persona/memory | [getProfile](../../../../../../plugins/text-client/src/client/protocol.ts#L336) exists and is used by Main's controller, but [CompanionClient](../../../../../../plugins/text-client/src/client/client.ts#L132) exposes only submit/stop/model/download. [App](../../../../../../plugins/text-client/src/client/app.tsx#L13) has no persona or memory surface at all. | Expose profile/memory reads on `CompanionClient`; add one compact panel next to [TaskStrip](../../../../../../plugins/text-client/src/client/tasks.tsx#L20) in the [Side](../../../../../../plugins/text-client/src/client/app.tsx#L109) column. |
| Form pattern to copy | [model-form.ts](../../../../../../plugins/text-client/src/client/model-form.ts#L28) already implements captured baseline, `changedUnderneath`, `dirtyOf`, `beginOperation`, `adoptView`, `rebaseOnLatest`, `failOperation` and a reused save intent. | Reuse the *pattern*, not the file: persona/memory need their own small pure module with the same names/shape. Do not generalize `model-form.ts` into a framework. |
| Shared primitives | Web: `Field`, `Section`, `List`, `Dialog`, `StatusBadge`, `Button` from [ui-kit](../../../../../../packages/ui-kit/src/index.ts#L1). Desktop: [Card/Field/Status/Switch](../../../../../../apps/desktop/src/renderer/console/minimal-ui/controls.tsx#L74) plus [ui-kit Dialog](../../../../../../packages/ui-kit/src/dialog.tsx#L34) for confirm. | Both sides already have every control this needs. No new component library, no new dialog primitive. |
| Limits to show | [32 facts / 8 KiB aggregate](../../../../../../plugins/state-sqlite/src/types.ts#L118); [key 128 / value 2048 UTF-16](../../../../../../plugins/state-sqlite/src/validation.ts#L174). | Render remaining capacity and per-field counters. Do not silently truncate; reject over-limit before dispatch with the same numbers. |

## Interface the real consumers need

The desktop bridge already has `readProfile/saveModel/testModel`; web has the matching HTTP reads. The gap is one profile **write** and one memory **view + write** on each side. Concretely, the renderer needs:

- a profile view that carries `agentId` + `name` + `persona` + `revision` (already [CompanionProfileView](../../../../../../packages/contracts/src/companion-profile.ts#L2)), plus, after a write, a **saved revision** that is distinct from "applied";
- a memory view carrying `facts[]` + a **memory revision** + each fact's origin/revision, where legacy rows report origin as unknown rather than guessed;
- `upsertFact` / `forgetFact` commands carrying `commandId` + captured `expectedMemoryRevision`, returning their real receipt and current view.

Two facts about placement matter for the UI: memory revision must **not** be the projection `state.revision` (M2 lesson — a chat or task event must not make every form stale), and the profile write must return the committed revision so the form advances its baseline from the write, not from a pre-submit render ([shared-desktop-entry §3](../../../../../spec/frontend/shared-desktop-entry.md#L16)).

## Reuse rules carried over from M2

Apply these without re-deriving them; each has a regression behind it.

- **Single snapshot owner.** Memory/profile reads come from the existing snapshot or a dedicated read; a command response never becomes global state.
- **Render-captured target + latest fence.** Each action captures the `connectionId` of the render that produced it and compares before dispatch and after settlement. The fence is not a dispatcher: it never re-aims a stale render's write at a new target.
- **Draft baseline ≠ projection sequence.** Persona CAS uses `profileRevision`; memory CAS uses `memoryRevision`. Neither is `state.revision`.
- **Form pending suppresses false externality.** While the owner's own write is in flight, the baseline legitimately lags; a form-local pending boolean keeps "changed elsewhere" from flashing.
- **Forget needs deliberate intent.** This is the one place where an extra confirmation is justified, because the effect is not obviously reversible from the user's view. It is a single confirm on the row, not a permission workflow.

## Copy and state honesty

| Situation | What the UI must say |
| --- | --- |
| Profile saved, not yet applied | "已保存，尚未生效" / "尚未用于后续回复" with the saved revision — never "已应用" |
| Profile applied | Show the applied revision from the service, not the one we sent |
| Memory write saved, context refresh failed | Saved receipt stands; application failure is a separate visible line |
| Fact origin unknown (legacy) | "来源未知（旧数据）" — never "由你添加" |
| Forget | "只从当前记忆移除；对话记录与日志保留" at the action. Say what is removed and what stays; do not claim it is technically unrecoverable, and do not claim full deletion |
| Duplicate/old baseline | Conflict, draft preserved, explicit re-read — no automatic overwrite |
| Over capacity | Name the real limit; do not accept then truncate |

Forget removes an active fact and its application. History stays. The distinction belongs in the confirm text, not in a help page. State only what this action does to current memory and to retained history — do not assert that the value cannot be recovered by any means, and do not present it as erasing everything.

## Minimum real DOM acceptance paths

These must run in the real web page and real Electron windows; static render or a hook stand-in does not count (M2 boundary, [§6](../../../../../spec/frontend/shared-desktop-entry.md#L73)).

1. **Persona round trip.** Read profile → edit name/persona → save → saved revision shown → "尚未生效/尚未用于后续回复" until the service reports it is in use → reopen shows the committed text. Restart survival is a backend gate.
2. **Memory add/correct/forget.** Add a key/value → appears with its revision and origin → correct it in place → forget with confirm → row disappears from active memory while the history view still shows the conversation.
3. **Conflict.** Change the profile/memory from the other surface (or a second tab) → the open form must keep its draft, show the external change, and offer explicit re-read. Verify the draft text is still there afterwards.
4. **Retarget.** Switch connection while a form is dirty → old target's write must not reach the new service; the form must not silently adopt the new target's values.
5. **Late action.** Hold the HTTP response (proxy), perform the other-surface change, then release → the late response must not clear the draft or overwrite the newer view.
6. **Keyboard and focus.** Tab through the memory rows and the forget confirm; Escape closes the confirm and restores focus to the invoking row. Minimum window (880×600) must keep the rail and both forms usable with no horizontal overflow — the same class of defect just fixed in the sidebar.
7. **Two surfaces agree.** The same id/name/facts are visible on web and desktop after a change on either side.

Test-harness note: the failure mode these must catch is **form timing**, so the probe must drive real input events and observe DOM after settle. A unit test of the pure transition module is necessary but not sufficient evidence.

## Surface placement

The two clients are not symmetric and should not be forced to be.

Desktop already has a persona page with a read view and a local-presentation card. Memory belongs on that same page as a second card: identity above, active memory below, local presentation last. This keeps "things about the service Agent" together and leaves the appearance page purely local. The page is already reachable from the rail and survives the collapsed width.

Web has no persona page and should not grow one. Its Side column holds tasks; a compact "记忆与人格" section there matches the existing density and needs no routing. Persona text is long (up to 16384 code points), so the web form uses the existing [Dialog](../../../../../../packages/ui-kit/src/dialog.tsx#L34) for editing while the side panel shows a short summary — the same split the model settings already uses between [summaryText](../../../../../../plugins/text-client/src/client/model-form.ts#L370) and the dialog body.

Neither surface gains a new navigation entry. No new route, no new page shell, no second settings window.

## Editing model

Three interaction choices keep this small and honest:

- **Correction is in-place edit, not delete+add.** A fact row becomes editable with its `expectedRevision` captured; saving sends an upsert with that baseline. Renaming a key stays an explicit add+forget because that is a different intent, and inventing a batch rename API is not warranted.
- **Forget is one confirm on the row.** The confirm states that it removes the fact from current memory and that history is retained — facts, not a permission workflow, and no claim that the value is unrecoverable. It carries the row's revision so a concurrent correction conflicts instead of silently deleting the newer value.
- **Add uses the same form as correction.** Empty key or value is not a deletion; it is an incomplete draft. The capacity line updates as the user types so the limit is visible before dispatch, not as an error afterwards.

Drafts are per-form and cleared only on an accepted receipt. A conflict keeps the text and the old baseline; re-read is a deliberate action that replaces the baseline, not the fields.

## Non-goals

No semantic/vector search, no inferred memory, no new permission workflow, no second state store, no persona/memory tool for the model in this MVP, no history or log erasure, no migration of real trial data during development. Existing unmounted design material and legacy helpers stay where they are.

## Open questions for GPT's type handoff

1. Does the memory view come from `snapshot.facts` plus a new revision field, or a separate `/api/memory` read? This decides whether the renderer needs a second fetch or can render from the snapshot it already has.
2. Is `origin` a new field on `CompanionFact` or a parallel view type? The UI needs "unknown" to be representable and distinguishable from "owner".
3. After a persona save, does the response carry the applied revision, or must the client re-read? "Saved ≠ applied" needs two facts, and the UI cannot invent the second.
4. Forget by key alone, or key + expectedRevision per row? The confirm must not race a concurrent correct.

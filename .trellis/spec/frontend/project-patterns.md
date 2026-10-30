# Source-backed frontend patterns

Existing desktop baseline: b9a803e. This guide records current patterns; the active task design specifies the future Cortico/pet-first changes. Read AGENTS.md and the shared project-baseline before modifying UI.

## Ownership and layout

Console source is apps/desktop/src/renderer/console, with page components under pages/, stateful use-*.ts hooks, local copy/labels and console.css. Pet source is the sibling pet/ directory. Shared primitives are packages/ui-kit/src. Main/preload and browser-safe contracts remain separate packages/layers; do not create the template src/renderer/src/features or src/shared alias hierarchy.

ConsoleApp currently owns navigation, theme, actual snapshots, security actions, toasts and the one useDemo recording state. It passes view state/actions to page components. Existing navigation is React state because trusted requests check the exact window URL; do not introduce hash/URL routes without changing and validating that boundary. A new page must not independently create another microphone or conversation owner.

Evidence: [console-app.tsx](../../../apps/desktop/src/renderer/console/console-app.tsx), [pages.ts](../../../apps/desktop/src/renderer/console/pages.ts), [demo-console.tsx](../../../apps/desktop/src/renderer/console/pages/demo-console.tsx).

## Multiple style candidates

When the user requests several visual styles and different control types, count independent presentation families rather than layouts. Share state/actions and native semantics, while each candidate owns its actual widgets, typography, surfaces and complete frame. The existing original kit may be a labelled retained candidate; it is not the required rendered kit for all candidates. Consolidation into one product system follows direction selection.

## Accessible controls

Reuse the owning product primitives by default rather than emulate controls with clickable divs. When the user explicitly requests an original component language, implement native semantic controls in the new product kit and reuse behavior/state separately; the earlier replica Button/Field/Section markup is not a required visual dependency. Preserve the accessibility contracts below. Avoid keeping two competing active control systems for the same redesigned surface. Button defaults to type=button; form submission must be explicit. Field owns the label/control ID and description/error association. Connect its inputId, describedBy and invalid result to the actual input. Keep hints outside the accessible name. Dialog uses native showModal, explicit tab wrapping, Escape handling and focus restoration; data-autofocus identifies a deliberate initial target.

Evidence: [button.tsx](../../../packages/ui-kit/src/button.tsx), [field.tsx](../../../packages/ui-kit/src/field.tsx), [dialog.tsx](../../../packages/ui-kit/src/dialog.tsx). Changes to pet choice dialogs must preserve the same keyboard/focus principles while also honoring native pet hit/drag geometry.

## Website-sourced foundations

If the user chooses existing website controls as the foundation, retain the licensed raw files and exact authors/links/revisions, then build a small namespaced adapter. Preserve the control-specific shape, material and interaction; do not turn matching author credits into an original replacement kit. Distinguish adopted source, necessary adaptation and genuinely new extensions in one manifest. Vendor runtime assets with the UI rather than importing task directories that move on archival.

For CSS-only original examples, use an isolated style boundary compatible with the existing CSP. Keep raw bytes untouched and stop native form submission at the preview host so a sample cannot navigate the trusted console. The current app uses an open ShadowRoot because frame-src is none. Source defaults belong in the existing builtin palette; source variables read the same effective theme and preview values as the editor. Do not add a separate visual override that hides selected builtin schemes.

For responsive source controls, check the actual child bounds and hard shadow inside their host, not only document scrollWidth. A native fieldset can constrain its own box while a grid content track leaves the fixed-width radio child overflowing. The sourced footer uses ordinary block flow; native tests cover expanded/collapsed containment at both window widths.

## Preview geometry and menu interaction

A menu and its trigger must participate in the outside-dismiss containment check, including when the chosen layout renders them beside the visual scene. Keep that interaction boundary separate from the scene ref used for visibility receipts and drag limits; widening the observed scene just to keep a menu open changes those geometry contracts. Verify actual menu callbacks, Escape/outside dismissal and a real drag in the native window.

## Configuration drafts and real state

usePluginConfig keeps an inspection snapshot, one draft and a baseline key. It builds a validated candidate, saves with the inspected revision (zero creates a first record), and only promotes the draft baseline on success. Conflict retains the draft and requires explicit reload. A failed read clears the old form rather than leave an editable stale revision. Follow the same boundary for person-name and full-prompt editing; do not save each keypress or erase draft input on a background refresh.

ConfigApplyMode is a declared mode, not evidence that a running service has applied a change. The planned Cortico prefix reload must wait for actual application and show saved/pending/applied separately; do not copy a generic savedText(immediate) message as runtime proof.

Evidence: [use-config.ts:93](../../../apps/desktop/src/renderer/console/use-config.ts:93), [use-config.ts:184](../../../apps/desktop/src/renderer/console/use-config.ts:184), [config-draft.ts](../../../apps/desktop/src/renderer/console/config-draft.ts), [config-form.test.tsx](../../../apps/desktop/src/renderer/console/config-form.test.tsx).

Theme currently has its own useTheme/theme.ts UI-only localStorage path. That is not permission to persist provider/persona/history in localStorage. Any move of theme into canonical machine-managed settings must be a deliberate one-source migration.

## Reads, subscriptions and asynchronous ownership

useDemo numbers snapshot reads so stale results cannot replace newer state. The latest completed read clears loading even when it is a silent refresh; otherwise a visible read replaced by onChanged can leave a permanent spinner. Cleanup returns the disposable onChanged subscription. Reuse this ordering pattern when adding lifecycle or shared-history invalidation.

Recording identity is the active AbortController/token, not a snapshot read sequence. Register the local session before asynchronous device setup so arming can be canceled. Dispose a late device if its controller is no longer current. Preserve capture above navigation, flush tail/await real IPC acknowledgments, and submit recognition only on the explicit completed-capture path. Error cleanup must not issue an extra cancel that clears the actual backend failure.

When an async completion clears shared references, verify it still owns that session after await as well as before sending the operation. The current ended callback has its pre-submit check at use-demo.ts:383 and cleanup after await at:388; this is a review point for restart/cancel/new-session tests, not a pattern to assume safe across every await.

Evidence: [use-demo.ts:132](../../../apps/desktop/src/renderer/console/use-demo.ts:132), [use-demo.ts:333](../../../apps/desktop/src/renderer/console/use-demo.ts:333), [microphone.ts](../../../apps/desktop/src/renderer/console/demo/microphone.ts), [capture-worklet.test.ts](../../../apps/desktop/src/renderer/console/demo/capture-worklet.test.ts), [microphone.test.ts](../../../apps/desktop/src/renderer/console/demo/microphone.test.ts).

## Fixed IPC and browser-safe imports

The console and demo bridges are frozen objects with named methods, exact arity and Result<T>. Renderer components consume their typed values and dispose subscriptions; they do not receive ipcRenderer, raw invoke/send, manager/control/broker objects, Node APIs or plaintext secret readers. Import shared types from @pet/contracts; validation and host services stay outside the browser bundle.

Binary PCM is the separate Uint8Array argument to pushAudio, not a JSON object/list or control-channel base64. Keep unavailable-bridge errors distinguishable from a valid backend rejection. Do not infer a provider is connected from key presence.

Evidence: [console-bridge.ts](../../../apps/desktop/src/preload/console-bridge.ts), [demo-bridge.ts](../../../apps/desktop/src/preload/demo-bridge.ts), [console.ts](../../../packages/contracts/src/console.ts), [demo.ts](../../../packages/contracts/src/demo.ts).

## UI truth and checks

Expose useful labels/actions; model schemas, owner revisions, runtime flags and diagnostic payloads are not daily settings. The proposed pet-first guide must save through the actual shared service rather than only link to a settings row. Visible actions need real handlers and actual readiness; do not copy illustrative reminder success, fake update versions or unsupported model-download controls into the product.

Use existing CSS/custom properties and ui-kit rather than add a state/style library to match a generic template. Respect keyboard focus, reduced motion, min-window scrolling and explicit Chinese font inheritance. Check real settings and pet windows; a screenshot does not prove saved/apply/permission behavior.

Run focused meaningful Vitest/type checks while implementing and pnpm check for final scope. Native Electron scripts run serially against isolated profiles and public fake audio, without the automatic media-consent bypass flag or paid services. Existing behavior coverage: [demo-ui-e2e.mjs](../../../qa/probes/demo-ui-e2e.mjs), [config-e2e.mjs](../../../qa/probes/config-e2e.mjs), [security-e2e.mjs](../../../qa/probes/security-e2e.mjs).

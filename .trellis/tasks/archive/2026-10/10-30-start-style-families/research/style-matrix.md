# Current style matrix provenance

The five-family visual/control matrix, ten pairwise comparisons, view tradeoffs, ownership boundaries and current validation state are maintained in one [canonical review](../../../../qa/start-style-families-review.md). This file records only implementation and QA locator provenance; it replaces the early handoff's stale three-family, 283-test, pending-format and static-error-count conclusions.

## Actual source facts

- [Registry](../../../../apps/desktop/src/renderer/console/style-families/registry.ts) connects all five real components. [Gallery](../../../../apps/desktop/src/renderer/console/style-families/gallery.tsx) owns the neutral review toolbar and one StartModel; it mounts each complete frame without the normal PB shell. The old five layouts remain a separate comparison entry.
- [Precision](../../../../apps/desktop/src/renderer/console/style-families/precision.tsx) uses a native select plus table; [Hearth](../../../../apps/desktop/src/renderer/console/style-families/hearth.tsx) uses wrapping labels with actual radio inputs; [Folio](../../../../apps/desktop/src/renderer/console/style-families/folio.tsx) uses ol/li/button, aria-pressed and a visible tick for provider selection. Folio's boolean controls are actual checkboxes; its provider picker is not a checkbox group.
- [Prism](../../../../apps/desktop/src/renderer/console/style-families/prism.tsx) uses a native dialog with an input combobox and listbox options; [Workbench](../../../../apps/desktop/src/renderer/console/style-families/workbench.tsx) accurately retains the PB kit, slots and board. Four new families do not render those PB presentation components.
- Error and busy props must be followed through the rendered primitives and interaction. A zero literal role=alert count inside a board function does not establish absent error feedback. Current board coverage limits are stated once in the canonical review.
- [Theme adapter](../../../../apps/desktop/src/renderer/console/style-families/use-family-theme.ts) owns presentation seeds, delegating explicit edits to the existing theme controller/store. [Preview adapter](../../../../apps/desktop/src/renderer/console/style-families/use-family-preview.ts) shares behavior and raw character assets; each family renders its own scene/menu.

## Stable review and family-specific locators

| Purpose | Actual locator |
| --- | --- |
| Review / current frame | style-family-gallery / style-family-root with data-family and data-view |
| Family selection | style-pick-precision, style-pick-hearth, style-pick-folio, style-pick-prism, style-pick-workbench |
| Start / state board | style-view-start / style-view-board |
| Full frame roots | sf-precision / family-hearth / sf-folio / family-prism / workbench-window |
| Provider selection | Precision model-provider-select; Hearth real model-pick-ID radio; Folio model-pick-ID pressed button; Prism model-provider-open → model-provider-dialog with model-provider-search; Workbench model-pick-ID tile |
| Theme inputs | Precision/Folio theme-token-KEY + theme-hex-KEY; Hearth/Prism theme-token-KEY-picker + theme-token-KEY-hex; retained Workbench board |
| Undo / visible control | Precision/Folio theme-undo; Hearth/Prism/Workbench theme-undo-preview. Folio uses pet-visible instead of separate pet-hide/pet-show |

## Evidence naming

The [first full native report](../../../../qa/screenshots/style-families/native-1793326740693-77bcffbd/native-report.json) stores 40 real shots. Its filenames follow FAMILY-MODE-VIEW-WIDTHxHEIGHT.png, for example precision-light-start-1200x800.png and prism-dark-board-880x600.png. Future contact sheets must consume the accepted final report's per-family files; old five-layout screenshot names do not describe this task. This first report remains failed-attempt evidence. Refrozen final run and acceptance are owned in the [native QA record](../../../../qa/style-families-results.md).

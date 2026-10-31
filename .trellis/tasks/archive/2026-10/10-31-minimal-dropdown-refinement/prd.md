# Refine provider icons and minimal dropdowns

The user accepts the simple settings direction, asks to retain provider logos, and dislikes the current dropdown. Refine only the existing qa/minimal-settings-preview: restore real logos in the provider trigger and options; give the three select controls coherent clean trigger/picker/hover/selected/focus appearance. Keep all existing choices and local draft bindings. No whole-layout redesign, production changes or backend work. Frontend remains DeepSeek max.

Actual preview Chrome156 supports appearance:base-select and ::picker(select). Prefer this native customizable select to preserve keyboard/focus/Escape/outside dismissal and existing change events without a second JS listbox framework or store. Use existing vendoredLobeHubSVGs1.101.0/MIT for the7providers, preserve original brand colours, keep text labels alongside icons. Reuse same10px radius/lightline/white surface/black checks as the accepted style.

Acceptance:
- [x] Current selected provider and every provider option show their actual icon+name.
- [x] Provider and two Voice dropdowns have consistent refined closed/open states.
- [x] Native keyboard selection, Escape, outside dismissal and existing local-state updates work.
- [x] Actual open/closed browser screenshots at1200/880; popup readable/unclipped.
- [x] Accepted overall style and production functionality unchanged, refreshed preview opened.

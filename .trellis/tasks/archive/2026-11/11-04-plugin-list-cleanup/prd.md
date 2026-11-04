# Compact plugin management

The user explicitly asks DeepSeek to implement a concise plugin list using the existing theme. Remove the declared-permission disclaimer and builtin-distribution explanation. Replace separate enable/disable buttons with one truthful state-aware control; uninstall is icon-only. Remove the configuration button: activating a card opens its own contributed settings page, or the existing configuration editor when no custom page is active.

## Acceptance

- [x] Requested explanatory copy is absent.
- [x] One lifecycle control with real pending/error/protected state; accessible delete icon preserves existing uninstall behavior.
- [x] Card mouse/keyboard activation opens matching-owner settings; nested controls do not navigate.
- [x] Light/dark/custom tokens and minimum viewport remain coherent.
- [x] Actual DeepSeek route implements the frontend; focused checks, full quality and serial native actions/screenshots pass.

Scope excludes plugin consolidation, user configuration deletion, new theme stores or new permission workflows.

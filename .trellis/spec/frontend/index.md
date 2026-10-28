# Desktop pet frontend guidelines

The actual baseline uses Electron45, React19, Vite, strict TypeScript, existing CSS custom properties and @pet/ui-kit. UI implementation for the active redesign belongs to DeepSeek max; the main session owns backend/contracts/integration.

## Read before UI work

1. [Shared project baseline](../shared/project-baseline.md) — actual packages, storage, authority and checks.
2. [Source-backed frontend patterns](project-patterns.md) — current component, draft, hook, recording, bridge and verification behavior.
3. The active task PRD/design/implementation plan and curated implement.jsonl/check.jsonl — target behavior and approved scope.

## Pre-development checklist

- Locate the existing component/hook and browser-safe contract before adding state or abstractions.
- Keep recording/conversation lifetime above page navigation and preserve disposable bridge subscriptions.
- Identify the real consumer and saved/pending/applied states for each proposed control.
- Keep human pet/settings and future model tools behind their correct authority adapters.
- Follow the project CSS/token/typography and minimum-window requirements.

## Quality check

- Preserve draft input/conflict behavior and reject stale owner/session effects.
- Verify accessible labels, focus, reduced motion and reachable actions.
- Add meaningful regressions for actual changed behavior; use current native probes for visual/device flows.
- Run final pnpm check and affected serial Electron acceptance.

The remaining initially generated generic documents are not source-backed project contracts yet. Do not add their example SQLite/Drizzle/Zod, React Query, alias hierarchy or new libraries merely to follow a template. The separate bootstrap task remains open until its full checklist and review are complete.

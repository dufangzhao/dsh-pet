# Desktop pet project baseline

This source-backed guide describes the existing repository at `b9a803e`. Use it when a generic Trellis template assumes a different stack or directory layout. It does not authorize future architecture changes.

Current additive application contracts are in [plugin-application-contracts.md](plugin-application-contracts.md); the following baseline remains the source for unchanged native services.

## Actual boundaries

- This is a pnpm workspace. `apps/desktop` is Electron45/React19/Vite; `packages/contracts` holds browser-safe shared contracts, `packages/host-kernel` owns lifecycle/tasks/config/permissions, and `packages/plugin-sdk` exposes owner-bound plugin services. See the root and package manifests.
- Console UI lives in `apps/desktop/src/renderer/console`; pet UI is the sibling `pet` directory. Existing console styles are plain CSS/custom properties with `@pet/ui-kit`. Tailwind is installed, but its presence is not a reason to replace the console styling system.
- Runtime storage is `ConfigService` with `FileConfigStore`, scoped plugin-data directories, and `FileCiphertextStore` through `CredentialBroker` (`apps/desktop/src/main/desktop-host.ts`). There is no application SQLite/Drizzle database and no Zod schema stack. Contracts use JSON Schema and AJV (`packages/contracts/package.json`).
- Main/preload/renderer are separate authority boundaries. Renderer imports contract types and fixed frozen bridges; do not import host-kernel, filesystem, validation runtime, Electron, or plaintext credentials into UI components. See `apps/desktop/src/preload/console-bridge.ts` and `demo-bridge.ts`.

## Reuse before extending

- Keep one plugin model: `docs/adr/0001-controlled-ui-contributions.md`, `0010-unified-plugin-model.md`, and the current contract/runtime/SDK documents. Builtin distribution does not imply blanket permission.
- Config storage identity is exactly pluginId + instanceId. Runtime authority also includes generation. Project `OwnerRef` explicitly when crossing into storage (`apps/desktop/src/main/console-config-request.ts:34`). Saves use expectedRevision; do not create shadow local persistence or silently overwrite conflicts.
- `PluginManager` owns lifecycle and contribution cleanup. `TaskSupervisor` owns intents, cancellation and capability work. Reuse these rather than adding a second manager or untracked background job.
- The existing working recording owner is `use-demo.ts`. Device setup, tail flush, ordered binary acknowledgments, AbortSignal cleanup and error preservation live under `renderer/console/demo/`. Keep capture ownership above page navigation. Snapshot request ordering is not recording identity.
- Real reply generation is optional. Offline scripted replies are explicitly labeled; secret presence is not a successful connection test. Do not fabricate connected providers, hardware readiness, saved settings, or applied behavior.

## UI and error conventions

- User-facing controls describe useful outcomes; technical diagnostics and machine schemas are not daily UI. Source/permission decisions still show understandable requested effects.
- Use `Result<T>` / fixed `KernelError` from contracts at boundaries, as in the existing console handlers. Preserve actual returned state even when an operation reports failure. No new HTTP error hierarchy or swallowed persistence errors.
- Existing shell navigation uses React state because the trusted bridge checks the exact loaded URL. Do not introduce URL/hash navigation without changing that contract deliberately.
- Use original local assets and system fonts. Coopanion is a design/reference source; its code, brand and character assets are not copied.

## Verification

Run `pnpm check` for workspace types/tests/QA/lint/format/build. Use focused meaningful regressions while implementing. Native Electron acceptance scripts run serially under `qa/probes`; use isolated profiles and public WAV fake devices, with real permission decisions. Do not add the automatic media-consent flag when testing authority. The environment needs explicit `--no-sandbox` for native acceptance; do not describe it as OS sandbox validation.

Read `AGENTS.md` for restraint/readability and the current task PRD/design/implementation plan for scope. The generic template files are references, not evidence of dependencies that exist in this repository.

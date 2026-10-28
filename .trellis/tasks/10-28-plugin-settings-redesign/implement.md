# Implementation plan

Implementation approved by the user with the DSH-style unified plugin architecture retained. Cortico is an interchangeable agent implementation under that host; frontend belongs to DeepSeek max, backend to the main session.

## Ownership and ordered work

1. [ ] Main session verifies the pinned Cortico release/source provenance, MIT notices and desktop-relevant dependency closure. Build a minimal ESM agent process with required provider metadata/layout on actual Electron, using a scripted ResponseClient. Prove Core startup, event/tool/result/reply, abort and confirmed shutdown before broad migration. Do not put the TS/TLA registry into the current CJS worker or install the private root Minecraft/canvas graph.
2. [ ] Freeze browser-safe owner-bound page/config/prompt/event/dialog/update adapters using upstream public Cortico contracts. Withdraw the new console-page DSL/page-command RPC proposal. PluginManager owns installation/trust/enable decisions and delegates World mount/unmount to Core; no competing stock launcher/WorldAssembly/installer state. Preserve narrow first-party UI admission and permanent recovery access.
3. [ ] Implement one DesktopPersona/interaction World and exact ResponseClient adapter. Reuse existing native capture/ASR/cancel/vault/permission services. Cut DemoController reply/session orchestration out after compatibility proof; do not wrap a second agent loop around Cortico. Add scoped config/desktop tools to actual Core dispatch.
4. [ ] Implement one Core cursor-history projection and stable receipt correlation for messages, touches, applied expressions, guide choices and app notices. Import legacy records once with stable IDs and keep read-only recovery until cutover; stop old history writes. Test reconnect/restart/cancel/dedup and honest storage failure.
5. [ ] Implement persona full-prompt CAS/edit/preview/application and actual name/style/language/avatar consumers. Map committed settings to Core projections; no second stock prompt-file/config writer or .env secret path. Respect safe-boundary prefix reload and saved/pending/applied state.
6. [ ] DeepSeek max implements renderer/UI in disjoint paths against frozen contracts: original pet bubbles/choices/masked input, same-history timeline, Start/Persona/Appearance/Conversation/Voice views, preview and accessible shared controls. Main owns contracts/host/preload/runtime/SDK/build/QA. Agent does not guess backend state, add dependencies, build/open competing native apps or modify backend.
7. [ ] Main implements local no-Key guide/config flow and updater status/action adapter; bubble choices save directly through the same service as Settings. Bind one-shot flow/step/action/revision, skip/resume/retry; exclude secrets. First native pet must be available before model/optional plugin activation. Update installer/feed remains an explicit release prerequisite; fixture tests must not impersonate real updates.
8. [ ] Integrate source decisions, one recording owner, dynamic page withdrawal, config/model tool changes, real expression acknowledgments and global stop. Remove duplicate chat identity, diagnostic-first Start content and stale fixed-page assumptions.
9. [ ] Run targeted behavior regressions, then pnpm check, affected strict probes and serial actual Electron visual/behavior acceptance. Fix observed failures, document source-backed conventions, update the authoritative usage guide, make reviewed local commits, record Trellis progress and archive only the completed task. No push or destructive reset.

## Acceptance matrix

| Criteria | Evidence |
| --- | --- |
| AC1 | Native five-view screenshots1040x740/760x560, light/dark/system/reduced-motion and user-control review |
| AC2 | Restart/prompt-conflict/reload tests plus actual provider system-prefix and desktop preview/shape/palette/name assertions |
| AC3 | Existing public-WAV ASR/capture pipeline connected to Core; navigation during capture/approval, real stop and ended tracks |
| AC4 | Unknown extension fixture renders config/actions through upstream page contracts; async withdrawal, stale owner and restore choices |
| AC5 | Scripted Core tool execution with target/action/schema/revision checks, exact review binding and secret exclusion |
| AC6 | Full workspace/strict probes/native final checks and reviewed local commits |
| AC7 | One cursor projection includes text, voice, real poke/blush, application guide/update and correlated assistant output without replay effects |
| AC8 | Pinned compiled ESM artifact on Electron, full ResponseClient protocol, provider-directory closure and process cleanup |
| AC9 | Empty-profile no-Key pet-only guide completion/skip/restart plus truthful updater fixture/action outcomes |

## Commands and rollout gates

Use focused package typecheck/Vitest while developing; final pnpm check and affected qa/probes TypeScript projects. Build the real app before native probes and run Electron scripts serially with isolated profiles/public fake devices. Do not pass the automatic media-consent bypass flag. No paid services or ambient recording.

Known working product baseline is b9a803e. Preserve user-initialized Trellis files and original profile data. Keep migration additive until Core/native/persistence evidence passes; do not run two permanent agent/history/config writers or fake success after a partial apply. A changed technical finding that materially changes scope returns to planning before continuing. The separately initialized bootstrap task remains its own checklist.

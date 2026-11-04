# Compact plugin management acceptance

Task 11-04-plugin-list-cleanup completed on 2026-11-04. Final workspace quality gate and serial native Electron acceptance passed.

## Result

Plugin cards now have one authoritative enable switch, an accessible icon-only uninstall control and a native title button covering the card to open settings. The requested explanatory copy and separate configuration button are removed. Internal actions remain separate from navigation. The existing confirmations, pending/error handling, protected-package rules and theme store are preserved. Protected failed/unready plugins retain their permitted enable-only repair action. No plugin consolidation or saved-configuration deletion was performed.

The frontend was implemented by the child explicitly dispatched through provider `magpie`, model `group/deepseek-pool`, reasoning effort `max` (agent 54e2d838-abe7-4d82-92fa-b662cc0fe17f). The current model catalog was inspected before dispatch, and the child reported no model/tool permission rejection. The parent handled integration, review and native verification.

## Checks

- Final `pnpm check`: passed, covering workspace types/tests, QA, lint, formatting and desktop build. QA: 120 passed; one existing symlink case skipped because Windows refused creating the fixture. The build retains its large-chunk advisory.
- Renderer console suite: 42 files / 372 tests passed, including 17 plugin-card regressions for requested state, pending, rejection, protected recovery and transition states.
- Lifecycle target: 1 test passed; Console snapshot projection: 2 tests passed, including false and true targets and the exact field allowlist.
- Existing user-package removal and permission-page regressions: 14 passed; operation-outcome regressions: 5 passed.
- Independent source review: no unresolved scoped findings. It identified the protected retry and reduced-motion pseudo-element issues, both corrected and verified.
- A prior concurrent verification run hit existing OAuth polling timeouts; all 7 OAuth tests passed in isolation and the final independent full check passed. OAuth source was not changed.

## Native evidence

[The probe](../probes/plugin-list-cleanup-native.mjs) ran serially against the final built Electron app with a unique `--demo-acceptance` profile. Its [machine-readable report](report.json) records the exact profile, observed lifecycle states, computed colors, layout bounds and focus/motion results.

| Acceptance          | Observed result                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| State control       | Installed switches match host `desiredActive`; cancel retains target/focus; Space disables and re-enables the real speech plugin               |
| Card navigation     | Card whitespace and Space open the owned voice page; Tab and Enter reach the existing ASR schema form                                          |
| Uninstall           | Named trash icon reaches the actual uninstall confirmation and removes the selected builtin from the isolated host snapshot without navigating |
| Themes              | Light and dark surfaces differ; saved custom surface `rgb(40, 55, 71)` survives navigation and renderer reload                                 |
| Minimum window      | Native 880×600 window / 864×561 content; document width 864; no controls outside card bounds                                                   |
| Keyboard and motion | Visible card focus outline; track and thumb transitions both 0s under reduced motion; no page errors                                           |

The native profile contained active and disabled plugins and no protected packages. Failed/unready/protected/pending/transition cases are covered by the Kernel and page regressions, not claimed as native fault-injection coverage. Startup enables local ASR after the initial console snapshot; the probe waits for that target and uses the existing Refresh control before comparing snapshots. No paid service, normal user profile or automatic media-consent flag was used. The environment-required `--no-sandbox` launch option does not establish OS sandbox validation. Native QA scripts are excluded by repository ESLint configuration; the probe was syntax-checked and executed.

## Screenshots

| Appearance           | Native capture                             |
| -------------------- | ------------------------------------------ |
| Light                | [plugins-light.png](plugins-light.png)     |
| Dark                 | [plugins-dark.png](plugins-dark.png)       |
| Saved custom palette | [plugins-custom.png](plugins-custom.png)   |
| Minimum window       | [plugins-compact.png](plugins-compact.png) |

Screenshots are unedited Electron page captures. Transient operation notices were closed using their existing UI buttons before capture.

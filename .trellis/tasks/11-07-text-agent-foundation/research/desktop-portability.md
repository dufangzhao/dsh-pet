# Desktop and QA path-fixture portability

The focused Linux run reproduced 13 failures and one pass across the three console test files. Every failure occurred at the `manager.install(...).ok` setup assertion, before the tested console behavior.

`PluginManager.install` checks `node:path.isAbsolute` for the running OS. The simulated `win32-x64` manifest/host platform controls compatibility, not filesystem syntax. The hardcoded `C:/settings-fixture`, `C:/actions-fixture` and `C:/PRIVATE_INSTALLATION` strings are relative on Linux.

The fixture-only fix imports `node:path` and uses `path.resolve` on each original fixture basename in:

- [console-config-request.test.ts](../../../../apps/desktop/src/main/console-config-request.test.ts)
- [console-plugin-request.test.ts](../../../../apps/desktop/src/main/console-plugin-request.test.ts)
- [console-snapshot.test.ts](../../../../apps/desktop/src/main/console-snapshot.test.ts)

This produces native absolute paths on Windows and Linux. The protected-package catalog and installation still share the same `directory` value. The snapshot fixture retains `PRIVATE_INSTALLATION`, so the existing sensitive-path projection assertion remains meaningful. Manifest platforms, origins and behavioral assertions are unchanged. The injected runtime loader and removal callbacks keep these paths virtual; no directory creation, deletion or real profile access is needed. Production validation is unchanged.

Verified on Linux with Node 26.13.0 / pnpm 11.24.0:

```sh
pnpm --filter @pet/desktop exec vitest run src/main/console-config-request.test.ts src/main/console-plugin-request.test.ts src/main/console-snapshot.test.ts
pnpm --filter @pet/desktop typecheck
pnpm exec eslint apps/desktop/src/main/console-config-request.test.ts apps/desktop/src/main/console-plugin-request.test.ts apps/desktop/src/main/console-snapshot.test.ts
pnpm exec prettier --check apps/desktop/src/main/console-config-request.test.ts apps/desktop/src/main/console-plugin-request.test.ts apps/desktop/src/main/console-snapshot.test.ts .trellis/tasks/11-07-text-agent-foundation/research/desktop-portability.md
```

Results: all 14 focused tests passed across three files; desktop TypeScript, scoped ESLint and formatting passed. Windows was not executed in this environment; native `path.resolve` preserves the equivalent absolute-path fixture contract there. The parent integration session owns the full workspace quality gate.

## ASR QA follow-up

The parent then reported all 847 desktop tests passing and one further OS-specific fixture in [asr-download.test.mjs](../../../../qa/probes/asr-download.test.mjs). A focused reproduction of `toSafeSegmentsWithin` failed because `C:/Windows` is not a native absolute path on Linux: it reaches the unsafe `C:` segment check instead of the expected repository-boundary rejection.

Only that test's generic root and outside-path fixtures changed: the virtual root is `path.resolve('ws-root')`, and the outside absolute candidate is `path.resolve(root, '../outside-ws-root')`. Both absolute escape and relative `../x` traversal still require the original `/repoRoot/` error assertion. Explicit hostile Windows path coverage remains in the existing relative-path/model-id tests (`C:/windows/x`, `C:\\windows\\x`, `C:tmp`, reserved names and alternate data streams). The production helper is unchanged; no virtual fixture directories are created.

```sh
node --test --test-reporter=spec qa/probes/asr-download.test.mjs
node --check qa/probes/asr-download.test.mjs
git diff --check -- qa/probes/asr-download.test.mjs
```

Results: all 105 tests passed across 15 suites with no skips; syntax and scoped whitespace checks passed. Repository ESLint and Prettier configurations explicitly exclude `qa/`, so no formatter rewrite was applied to this existing probe. Windows execution remains unverified in this Linux environment.

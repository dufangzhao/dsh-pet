# Windows device acceptance (desktop and local host)

## Machine and baseline

Actual device: Windows 11 家庭版 中文版, build 10.0.26200, x64, 18 logical processors, 31.5 GiB RAM. PowerShell 7.6.10 for the development terminal and Windows PowerShell 5.1.26100.9444 for the native helpers. The session ran as a normal user, not elevated, with Developer Mode off (no `AppModelUnlock` key).

Node 26.13.0 was installed project-locally at `.cache/tooling/node-v26.13.0-win-x64/node.exe` (SHA256 `14319838b3f355e0398c13569a90270bce4fc68f25189f58c59b03dadae0e6d5` from `https://nodejs.org/dist/v26.13.0/SHASUMS256.txt`) and pnpm 11.24.0 was used through the existing global install. The system Node was left untouched.

`pnpm install --frozen-lockfile --ignore-scripts` installed 45 workspaces / 278 packages in 1m44.7s and passed the lockfile supply-chain policy (373 entries).

`node ./node_modules/electron/install.js` failed with `TypeError: fetch failed`. The locked Electron 45.0.0 win32-x64 archive was downloaded from `https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-win32-x64.zip` and accepted only after matching `node_modules/electron/checksums.json` SHA256 `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`; it was extracted to `node_modules/electron/dist` with `path.txt` = `electron.exe`.

## Windows private directory

`pnpm --filter @pet/local-host exec vitest run src/windows-private-directory.test.ts`: 1 file, 7 tests, 6 passed and 1 skipped (the skip is the Linux-only case). The Windows-only case "executes Windows initialization and verifies directory/file identities under a normal user anchor" passed in 9529ms, so the repaired PowerShell helper creates and verifies the protected directory and file identities under an ordinary inherited-ACL anchor on this device.

## Desktop composition regression and its fixture defect

The first full desktop run reported 3 failures, all in `apps/desktop/src/local-host/composition.test.ts`, each ending in `KernelFault: errors.permission-denied` from `packages/local-host/src/windows-private-directory.ts:111`.

Cause: the fixture handed `createProductionLocalHost` a bare `mkdtemp` directory. On POSIX `mkdtemp` already creates mode 0700, so the helper accepts it; on Windows the directory inherits the parent ACL, `AreAccessRulesProtected` is false, and the helper deliberately refuses to repair an existing unprotected directory (`windows-private-directory.ps1:74`). Direct inspection produced the exact reason token `local-host-private-profile-unavailable:unprotected-directory`. Production never takes that path: `apps/desktop/src/main/index.ts:357` and `apps/desktop/src/local-host/client.ts:19` open the role profile through `openPrivateDirectory` first, which creates a protected DACL.

Repair was confined to the test: the fixture now opens the role profile through `openPrivateDirectory` before composing, and each Windows case gets a 120s timeout because one ACL/identity check costs about 0.85s (PowerShell start plus C# helper compilation). The three cases then passed in 22.4s / 22.5s / 22.5s. No product code changed.

## Desktop suite and static gates

The full suite is load-sensitive: at the default worker count 2 unrelated cases (`shared-voice-host`, `shared-companion-host`) occasionally exceed the deliberate 5s plugin activation budget and surface as `internal`. `--testTimeout=30000` did not change that, and both files pass alone in under 1s, so the cause is machine saturation, not a logic defect. With `--maxWorkers=4` (73.63s) and again with `--maxWorkers=8`: 121 files / 1144 tests passed.

`pnpm --filter @pet/desktop build` succeeded (pet 86 modules / 299.24 kB, console 170 modules / 517.20 kB). Root `pnpm -r typecheck` exited 0 across all 45 projects. `pnpm lint`, `pnpm format:check` and `pnpm --filter @pet/desktop typecheck` exited 0.

## Actual Windows lifecycle acceptance

New probe `qa/probes/companion-local-host-windows.mjs` drives the built development Main process, the real preload bridge and the independent daemon. Earlier attempts failed on probe-side assumptions only: the local-host section is the second card of the QQ page rather than a page of its own, the page heading is `h2.page__title` (the `h1` is the titlebar brand), and the permission preset renders the Chinese label 允许.

The passing run recorded status `Windows-development-lifecycle-passed` with five checks:

1. `Windows-production-Main-preload-start-private-directory-and-role-guards`
2. `actual-three-source-DOM-trust-and-allow-authenticated-native-OneBot-ready`
3. `GUI-process-exited-independent-native-source-still-answers-ping`
4. `GUI-reopen-same-host-boot-source-key-and-idempotent-start`
5. `server-absent-explicit-stop-completes-and-closes-native-peer`

Evidence: `qa/fixtures/local-host/evidence/windows-44ae2bd4-0671-46d3-a2f7-4edc475547d4/report.json` and `running.png`. The report records `win32` / `x64` / Electron `45.0.0` / `packaged: false`, both windows at sandbox true, contextIsolation true, nodeIntegration false, hostId `b5ed4790-2ce4-413e-b6af-61efc8bcffca` and bootId `baba02b6-5c93-448c-a5f7-d13ff5ed8824`. No plaintext source credential and no sqlite file appeared under `local-plugin-host`; no Electron or Node process survived the run.

Limits recorded by the report: this is the development build, not the packaged preview.9 ZIP, and the OneBot peer is a controlled authenticated loopback peer with no real QQ account, model, ASR or TTS call.

## What still does not run on Windows

Two root gates fail here for reasons unrelated to the desktop work, and both must not be read as Windows regressions of this task:

- `plugins/cloud-exec` declares `platforms: ["linux-x64", "linux-arm64"]` and targets Docker. Its 20 failures are a mix of `unavailable` (no Docker engine) and `EPERM` on `symlink`, which a non-elevated Windows user cannot create. `pnpm -r test` stops at this package (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`), so it never reaches the remaining packages.
- `qa/probes/companion-service*.test.mjs` compose the headless service in-process. `plugins/text-client` and `plugins/qq-media-codec` also declare Linux-only platforms, so `PluginManager.install` marks them `rejected` and `CompanionPluginHost.create` throws `not-ready` at `packages/companion-runtime/src/plugin-host.ts:352`. That produced 14 failures (182 tests, 163 passed, 14 failed, 5 skipped).

Consequence: the continuous Agent service stays a Linux-side component. A complete Windows-only closed loop would need either a reachable service over the network or a separate decision to declare `win32-x64` for those three plugins and port their native dependencies. Neither is part of this acceptance.

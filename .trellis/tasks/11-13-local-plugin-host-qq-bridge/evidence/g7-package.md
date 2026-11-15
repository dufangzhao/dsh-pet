# G7 portable application packaging

2026-11-14, Asia/Shanghai. **The final application artifact and native package acceptance remain in progress.** [G0 package evidence](g0-package.md) remains a separate successful Linux feasibility proof; it is not the production Windows preview.

The actual Windows-x64 Electron45 archive is acquired and verified against the [published Electron45 checksums](https://github.com/electron/electron/releases/download/v45.0.0/SHASUMS256.txt). GitHub's direct transfer was too slow; the exact archive was resumed through the public npm mirror only after stopping and collecting the original transfer. The complete158,223,852-byte ZIP hashes to `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`. Safe extraction rejects traversal and symlink entries. The actual executable is PE/AMD64 (`0x8664`), version45.0.0, SHA256 `8e84549b05d27d444da2957653200d1e0ac287eff0fc5722b92835b9e0821a59`. **No Windows executable, ACL or device trial has run.**

[The assembler](../../../../apps/desktop/package-portable.mjs) uses a complete current tracked-plus-new working-tree snapshot, excluding data/keys/cache/node_modules and deleted tracked files. Copy-time source-before/source-after/destination hashes must agree; the installed source module links/metadata and raw lock have a separate whole-operation before/after fence. All installs/builds use copied temporary workspaces, never the live importer. Public cache provisioning, when selected, retains frozen lockfile and normal package-manager policy with scripts disabled.

The actual temporary development install and full Desktop production build have passed. This includes the fixed GUI/daemon role router, standalone host, preload and both renderers. The source output directories were not built or replaced by these runs.

A strict dependency audit then found that legacy pnpm deploy re-resolves transitive ranges while warning that lockfile reading/writing is disabled. A real candidate installed `@babel/runtime@7.29.14`, absent from the original frozen lock; the assembler rejected it. The current implementation instead performs a fresh target-specific production install directly from the original frozen lock with the existing hoisted node linker. Workspace packages have one canonical physical installed directory; source workspace aliases are not shipped. The output additionally requires all dependency versions to occur in the original lock/workspace, no Unix symlinks, actual AMD64 PE native files and no Linux ELF/shared libraries in a Windows package.

The replacement frozen production install and physical module copy actually passed lock membership. A [read-only audit of that rejected candidate](../../../../qa/fixtures/local-host/evidence/package-audit-b68ef107-030d-4fc5-a320-19bddba71c2d/report.json) confirms zero symlinks, the same physical SDK/kernel/contracts resolution through LocalHost and all three source packages, both exact helper copies, and16 actual AMD64 PE files. It also identifies36 foreign prebuilds bundled in bare-fs/bare-path/bare-url. The candidate remains rejected; target-only prebuild selection is now implemented, with the strict binary scan retained. Static resolved paths do not establish runtime object equality or Windows execution.

Other retained failures were bounded: missing full/abbreviated offline metadata was reported and provisioned through normal protected copied-workspace package-manager commands; an output-directory copy ordering error was corrected; one snapshot was rejected because QQAgentLink changed while being copied. None is a successful candidate or a permission to use an inconsistent snapshot.

Both `windows-private-directory.ps1` and `owned-process.ps1` must accompany their actual external modules and byte-identical GUI bundled-module siblings. The current source includes this requirement. The final snapshot must also include the in-progress process-identity/recovery contracts before being handed off.

Independent Linux and Windows candidates were assembled from the same 1,736-file source snapshot SHA256 `5aa3df3dac627dff929c17719218e6b2a2450e17df6ae5129994f1caa1055219`; Windows and Linux layouts contained 3,744 and 3,801 files respectively, and the live source-module fence matched before and after (`3f1e5db811d629f522f9ac698ac498eafba24b73889499e24fed1ff110df86f1`). These r2 candidates predate later source changes and are not final artifacts. The Linux [production resolution report](../../../../qa/fixtures/local-host/evidence/production-resolution-linux-r2-20261114-1852.json) used actual Electron45/Node24.22/ABI150, fenced before registering tsx, resolved 291 modules inside the layout and confirmed strict SDK/kernel/contracts object equality with zero remaining scoped processes.

The production GUI runs exposed two packaging defects, described with cleanup and native results in [G6 native evidence](g6-native.md): Electron's stock basename reports unpackaged, and a clean-environment Linux worker cannot locate the candidate's private libraries. The source assembler now names the executables `pet-desktop` and `Pet.exe`, pairs Windows `Pet_wer.dll`, updates both launchers and provides a Linux fixed-library worker wrapper. The r2 Linux trial used a same-byte executable copy and an additional wrapper; it was an adjusted experiment, not a final rebuild.

A fresh independently built Linux r3 candidate completed frozen installs, desktop build and strict layout audit, with 3,802 files and snapshot SHA256 `29bd232d9076faa0ac6aecddd017c8788c6912ef926ff6c12907f137f9b87153`; the live module/lock fence remained `3f1e5db811d629f522f9ac698ac498eafba24b73889499e24fed1ff110df86f1` before and after. Its same-byte Electron and fixed worker ran the successful production GUI lifecycle described in G6. The candidate predates ongoing cross-team source changes and is not the final Windows preview; final assembly remains required.

No source archive is presented as a distributable. No signing, installer, OS startup registration, live QQ, paid-model call, original4120/SnowLuma change, work commit or public release occurred.

## Preview4 Windows-x64 portable — audited historical candidate, not the final delivery (2026-11-15, Asia/Shanghai)

This section records **preview4 as an audited historical candidate** (a UI authorization-entry gap was found in user-path acceptance, it has been superseded by the subsequent renderer fix, and it is **not the final delivery**). It does not assert whole-project static quality, lint/typecheck/format status or test results, which are reported separately. The earlier "final artifact in progress" line above described the 2026-11-14 state. The r2/r3 Linux/Windows candidates above remain historical mechanism proofs and are not the final deliverable.

**Assembly.** After all source writers reported SOURCE READY and stopped, the approved command ran once as background job `bash-3cf3e4ba4e85415f` with exit code 0:

```
node apps/desktop/package-portable.mjs --output=/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/release/Pet-Windows-x64-0.1.0-preview.4 --runtimeDirectory=/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.companion-data/tooling/desktop/electron-45-win32-x64 --target=win32-x64 --version=0.1.0-preview.4
```

The first offline `--frozen-lockfile --ignore-scripts` run succeeded; no `--provisionCache` was needed. No `pnpm deploy`, no Root-cwd install/build, and Root `node_modules`/`pnpm-lock.yaml` were never written (whole-operation module/lock fence held). The `snapshot-complete` marker released the source freeze; all installs, the Desktop build and the second target-specific production install ran in copied `/tmp` workspaces.

**Snapshot and source fence.** 1,736 tracked-plus-new source files copied with per-file before/after/destination hash agreement; `sourceContent` = `76aa8609e1d32c6916d8557edde605091dc384ea832f5d4c6b7c3fff4ee5e185`. The module/lock fence was identical before and after: `3f1e5db811d629f522f9ac698ac498eafba24b73889499e24fed1ff110df86f1`. Assembler result: `portable-candidate-assembled`, 3,744 layout files.

**Preview4 package directory.** `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/release/Pet-Windows-x64-0.1.0-preview.4/` — 3,746 files / 578 directories / 0 symlinks / 455,662,504 bytes. `Pet.exe` is the renamed stock `electron.exe` (249,797,632 bytes, PE/AMD64, SHA256 `8e84549b05d27d444da2957653200d1e0ac287eff0fc5722b92835b9e0821a59`, Electron 45.0.0), paired with `Pet_wer.dll`; stock names are absent and `Start Pet.cmd` clears `ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS` and launches `Pet.exe`. Application and local-host-role manifests both carry `0.1.0-preview.4`. `package-report.json` (assembler report, including 3,744 per-file SHA-256 entries) and `package-audit.json` (independent strict audit) ship inside the package.

**Strict audit (all green).** 0 symlinks, 0 ELF / `.so` / `.dylib`, 16 native PE files all AMD64 (`0x8664`), 36 non-target-platform prebuilds omitted, 138 installed `name@version` ids all present in the original lock/workspace, 0 mismatches against the assembler's per-file manifest, 0 private-state paths, and no `.env`/`.npmrc`/`.pem`/`.key`/credential/userdata file or user-profile key. Both PowerShell assets are present twice (`resources/app/dist/main/` and `resources/app/node_modules/@pet/local-host/src/`) and byte-identical to their source (`windows-private-directory.ps1` `b41aa9bb…`, `owned-process.ps1` `2e75afc7…`). The two informational profile-path mentions are a pnpm store path in the assembler build log and a Windows Temp JSDoc example in `@types/node/fs.d.ts`; neither is a key.

**Deliverables** (all under `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/release/`, an ignored directory — no new ignore file, no untracked pollution of the source snapshot or the separate static-quality baseline):

| Path | Size | Note |
| --- | --- | --- |
| `Pet-Windows-x64-0.1.0-preview.4/` | 455,662,504 bytes | portable |
| `Pet-Windows-x64-0.1.0-preview.4.zip` | 184,346,437 bytes | single top-level directory, 4,324 entries |
| `Pet-Windows-x64-0.1.0-preview.4.sha256` | 102 bytes | ZIP SHA256 `6be03db8e4571e9c7dc9e3601f61f7ac771fd9172b4b02d69f6df4e9ada83200` |
| `Pet-Windows-x64-0.1.0-preview.4-README.md` | — | concise Chinese README; reuses the packaged `README.txt` for full usage |

The ZIP passed `unzip -t` with no CRC errors and Python `zipfile.testzip()`; all entries belong to the single top-level directory `Pet-Windows-x64-0.1.0-preview.4` with zero `..`/absolute/backslash/drive-letter traversal entries. `sha256sum -c` succeeds.

**Limitations and remaining work.** This is a **Windows x64 preview candidate**. No Windows device, Windows ACL or Windows-side execution trial has run; the successful Linux production GUI/native evidence does not prove Windows execution. PowerShell helpers are structural/type-complete only, pending real Windows validation. No real QQ account, paid-model, original4120/SnowAstrBot or WindowsOS account joint trial occurred. No signing, installer, OS startup registration, commit, push or public release occurred. Windows-device/account joint acceptance and whole-project quality verification remain for the parent to schedule; no source archive is presented as a distributable.

## Preview5 Linux/Windows-x64 portable — current GUI-acceptance candidate (2026-11-15, Asia/Shanghai)

Preview5 supersedes preview4. Preview4 failed user-path acceptance on a UI authorization-entry gap; the renderer fix and its QA are separate evidence. Preview5 is the artifact built **after** the SOURCE READY freeze, and is the candidate handed to the GUI owner for real-button acceptance. It is **not yet final**: GUI acceptance, the Windows ZIP and the Chinese README are pending, and no Windows-device execution has run.

**Assembly.** No old worker, process or job was live and no preview.5 output existed; nothing was overwritten or deleted. Both commands ran once from Root, each as a background job, each exit 0, on the first offline `--frozen-lockfile --ignore-scripts` attempt — no `--provisionCache`, no `pnpm deploy`, no Root-cwd install/build, no Root `node_modules`/`pnpm-lock.yaml` write.

| Target | Job | Output | Files / dirs | Bytes |
| --- | --- | --- | --- | --- |
| linux-x64 | `bash-14d53ca9f35e435e` | `.cache/release/Pet-Linux-x64-0.1.0-preview.5/` | 3,803 / 587 / 0 symlinks | 642,487,424 |
| win32-x64 | `bash-f424497837054066` | `.cache/release/Pet-Windows-x64-0.1.0-preview.5/` | 3,745 / 578 / 0 symlinks | 458,029,195 |

**Snapshot and source fence.** Both runs copied the same 1,738-file snapshot, `sourceContent` = `b32cd6719ec5279a78d17dac41b9ce4b41909d71716f8894e0b3809bdb2d4d1d`; each reported `snapshot-complete` and released the freeze before any install. The live module/lock fence was identical before and after in both runs: `3f1e5db811d629f522f9ac698ac498eafba24b73889499e24fed1ff110df86f1`. Assembler status `portable-candidate-assembled`; 14 workspace packages; 36 non-target prebuilds omitted.

**Windows package.** `Pet.exe` is the renamed stock `electron.exe` (249,797,632 bytes, PE/AMD64 `0x8664`, SHA256 `8e84549b05d27d444da2957653200d1e0ac287eff0fc5722b92835b9e0821a59`, Electron 45.0.0) with `Pet_wer.dll` (425,472 bytes, PE); stock names absent, `Start Pet.cmd` clears `ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS`. Strict layout audit green: 0 symlinks, 0 ELF/`.so`/`.dylib`, 0 private-state paths. Both PowerShell assets appear twice (`resources/app/dist/main/` and `resources/app/node_modules/@pet/local-host/src/`) and are byte-identical (`windows-private-directory.ps1` `b41aa9bb…`, `owned-process.ps1` `2e75afc7…`). Application and local-host-role manifests both carry `0.1.0-preview.5`.

**Linux package.** `pet-desktop` (235,716,088 bytes, ELF x86-64, SHA256 `bcf2b3e430c49265f6da8b81b2f28032e0434155e1e7c4d8d7edfaf449b024dc`) with `start-pet.sh` and the clean-environment `pet-worker` wrapper; `lib/` and `lib/browser/` bundled; `/usr/bin/ldd` on `pet-desktop` reports no `not found`. Same strict layout audit green.

Both directories ship their `package-report.json` (including per-file SHA-256 entries). The GUI owner's real three-source read/trust/allow probes and `companion-local-host-desktop.mjs` run against the Linux path is the pending acceptance step; ZIP, `.sha256` and Chinese README are produced only after that passes. No signing, installer, OS startup registration, commit, push or public release occurred, and no source archive is presented as a distributable.

The GUI probe requires the layout to live outside the checkout, so the audited preview5 Linux package was byte-and-permission copied with `cp -a` to `/tmp/pet-qq-preview-linux-20261115-r5` (3,803 files / 0 symlinks / 642,487,424 bytes, target verified absent first, source left in place). Its full 3,802-entry manifest re-hashed to 0 mismatches; the single extra path is `package-report.json` itself. Verification: [external-linux-preview5-copy-20261115.json](../../../../qa/fixtures/local-host/evidence/external-linux-preview5-copy-20261115.json).

## Preview6 Linux/Windows-x64 portable — current candidate after the management stop-path fix (2026-11-15, Asia/Shanghai)

Preview6 replaces preview5. The only product delta is `packages/local-host/src/management.ts` (stop reply joins the write flush before `onStopped` closes the socket; a `stopping` host no longer emits unreadable view hints) plus its test; the kernel `close` failure protection is unchanged. Preview5's GUI pass was a second-run 6/6 after an offline-stop/stale-owner first attempt, and that earlier attempt is not treated as resolved by re-running. At this assembly checkpoint GUI acceptance, the Windows ZIP and the Chinese README were still pending; the completed acceptance and final files are recorded below. No Windows-device execution has run.

**Assembly.** Targets verified absent before each run; nothing overwritten or deleted; each ran once from Root as a background job with exit 0, on the first offline `--frozen-lockfile --ignore-scripts` attempt — no `--provisionCache`, no `pnpm deploy`, no Root-cwd install/build. Linux was built directly at its outside path, avoiding a 642 MB duplicate.

| Target | Job | Output | Files / dirs | Bytes |
| --- | --- | --- | --- | --- |
| linux-x64 | `bash-2c7bc7aabc5448c3` | `/tmp/pet-qq-preview-linux-20261115-r6` | 3,803 / 586 / 0 symlinks | 640,087,276 |
| win32-x64 | `bash-06893c09fdcb4679` | `.cache/release/Pet-Windows-x64-0.1.0-preview.6/` | 3,745 / 577 / 0 symlinks | 455,667,028 |

**Snapshot and source fence.** Both runs copied the same 1,738-file snapshot, `sourceContent` = `b9d7d276366429da83d3ccd85600b042a6ac6f61f79005044a9b5ded27198e82` — different from preview5's `b32cd671…` because the management fix is part of the source; no target divergence. The live module/lock fence was identical before and after in both runs: `3f1e5db811d629f522f9ac698ac498eafba24b73889499e24fed1ff110df86f1`.

**Audits.** Each package re-hashed against its own `package-report.json`: Linux 3,802 entries and Windows 3,744 entries, 0 mismatches, 0 missing, the only extra path being `package-report.json` itself. Both are `portable-candidate-assembled` with 14 workspace packages and 36 non-target prebuilds omitted; 0 symlinks, 0 ELF in the Windows layout, no private-state paths. The shipped `management.ts` hashes to `b2ca7e3b246632a1…` in both artifacts, confirming the fix is what was packaged. `Pet.exe` is PE/AMD64 `0x8664` (249,797,632 bytes, `8e84549b…821a59`) with PE `Pet_wer.dll`; `pet-desktop` (235,716,088 bytes, `bcf2b3e4…b024dc`) links clean under `ldd`. Application and role manifests carry `0.1.0-preview.6`. No signing, installer, OS startup registration, commit, push or public release occurred.

**GUI acceptance (real run, no retry).** Job `bash-eb7e8cc5e2df4ea6` exit 0, report [desktop-ed89c186…/report.json](../../../../qa/fixtures/local-host/evidence/desktop-ed89c186-57e7-437e-b565-e1f55bc0f301/report.json): full 6/6 on the first run against `/tmp/pet-qq-preview-linux-20261115-r6`. All three sources were authorized through the DOM (read → trust → allow), and after an OS-level quit the probe confirmed pong, same boot, key re-attach and `offlineStop` passing on the first attempt. Native cleanup reported `nativePeer`/`gui`/`display` all true with no remaining proot. This is the first run in which the management stop-path fix was exercised; preview5's earlier first-attempt failure was not re-run away.

### Final artifact — preview6 Windows-x64 portable (this delivery)

Preview6 is **this delivery**; preview4 and preview5 remain historical records above and are superseded.

| Path (under `.cache/release/`, ignored) | Size | Note |
| --- | --- | --- |
| `Pet-Windows-x64-0.1.0-preview.6.zip` | 184,349,203 bytes | single top-level dir, 4,324 entries |
| `Pet-Windows-x64-0.1.0-preview.6.sha256` | 102 bytes | ZIP SHA256 `e152c89eebc1ac40aaccaf8b147c57c02e0780504fc4e523485e4fb6ea2745de` |
| `Pet-Windows-x64-0.1.0-preview.6/` | 458,038,719 bytes | portable layout, 3,746 files / 578 dirs / 0 symlinks |
| `Pet-Windows-x64-0.1.0-preview.6-README.md` | 4,235 bytes | Chinese handoff guide; Parent clarified host startup, required Agent-link authorization and the actual stop-button label without changing ZIP bytes |

The independent audit (`package-audit.json`, shipped inside the package) is `audit-verified` against the current Root source: `sourceContent` `b9d7d276…98e82` with 1,738 snapshot files, module/lock fence equal before and after (`3f1e5db8…86f1`), 0 manifest mismatches over 3,744 entries, 0 symlinks, 0 ELF, 16 native PE files all AMD64, 0 non-AMD64, 0 private-state paths, 138 installed dependency ids all inside the original lock/workspace, 14 workspace packages, 36 foreign prebuilds omitted, both PowerShell helpers present twice and byte-identical to source (`b41aa9bb…`, `2e75afc7…`), app and role manifests at `0.1.0-preview.6`, and `Pet.exe` matching the pinned Electron 45.0.0 SHA256. The ZIP passed `unzip -t` with no CRC errors and Python `zipfile.testzip()`; every entry sits under the single top-level `Pet-Windows-x64-0.1.0-preview.6/` with zero traversal/absolute/backslash/drive-letter entries, and `sha256sum -c` succeeds.

**Limitations.** No Windows device, Windows ACL or Windows-side execution trial has run; the Linux GUI/native pass is not a Windows OS conclusion. No real QQ account, paid-model, original4120/SnowAstrBot or WindowsOS account joint trial occurred. PowerShell helpers are structural/type-complete only. No signing, installer, OS startup registration, commit, push or public release occurred; no source archive is presented as a distributable.


## Preview7 Windows-x64 portable — settings-console redesign (2026-11-15, Asia/Shanghai)

Preview7 is the current Windows delivery. UI source was frozen after the settings-console redesign: sidebar in three groups (连接 / 助手 / 插件), the start page keeping only connections, and model/QQ/local-host/voice/desktop-pet as independent pages. Verified before packaging: desktop typecheck 0, 121 files / 1,135 tests, build 0, local-host browser 25/25 and QQ browser 7/7; screenshots in [ui-redesign-20261115-2040](../../../../qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/). Only Windows was rebuilt; Linux was not touched.

**Assembly.** Target `.cache/release/Pet-Windows-x64-0.1.0-preview.7` verified absent; disk was 1.7 GB free and no leftover `/tmp/pet-portable-build-*` existed. Job `bash-16a020932b3447ef`, exit 0, first offline `--frozen-lockfile --ignore-scripts` attempt; no `--provisionCache`, no `pnpm deploy`, no Root-cwd install/build.

**Snapshot and fence.** 1,746-file snapshot, `sourceContent` = `5fa5155268f7d4dfd12ce11d6dc77987d5175c494f34fe739fc394576ddad20a`. Recomputing with the packager's own file filter against the current Root reproduced the same hash over 1,746 files. Module/lock fence was `3f1e5db8…86f1` before and after.

**Audit** (`package-audit.json`, `audit-verified`): 3,744 manifest entries, 0 mismatches, 0 missing (only extra path `package-report.json`); 3,745 regular files / 455,676,615 bytes before the audit file; 16 native PE all AMD64, 0 non-AMD64, 0 ELF, 0 symlinks, 0 private-state paths; 138 installed dependency ids all in the original lock/workspace; 14 workspace packages; 36 foreign prebuilds omitted; both PowerShell helpers present twice and byte-identical to source (`b41aa9bb…`, `2e75afc7…`); app and role manifests at `0.1.0-preview.7`; `Pet.exe` still the pinned Electron 45.0.0 build `8e84549b…821a59` with `Pet_wer.dll`.

**Final artifact.**

| Path (under `.cache/release/`, ignored) | Size | Note |
| --- | --- | --- |
| `Pet-Windows-x64-0.1.0-preview.7.zip` | 184,351,553 bytes | single top-level dir, 4,324 entries |
| `Pet-Windows-x64-0.1.0-preview.7.sha256` | 102 bytes | ZIP SHA256 `34fedc946207305f0a1f88aefab26f05f16b9d56b99a1d96097c4e9d0c43f709` |
| `Pet-Windows-x64-0.1.0-preview.7/` | 458,048,306 bytes | 3,746 files / 578 dirs / 0 symlinks |
| `Pet-Windows-x64-0.1.0-preview.7-README.md` | 4,508 bytes | Chinese README incl. the new navigation and step-by-step first-use order |

The ZIP passed `unzip -t` with no CRC errors and Python `zipfile.testzip()`; all 4,324 entries sit under the single top-level `Pet-Windows-x64-0.1.0-preview.7/` with zero traversal/absolute/backslash/drive-letter entries; all 3,746 files inside the ZIP are byte-identical to the directory; `sha256sum -c` succeeds. Preview4, preview5 and preview6 above remain historical records and are superseded.

**Limitations.** No Windows device, Windows ACL or Windows-side execution trial has run; the Linux build and automated-test evidence is not a Windows OS conclusion, and final joint acceptance needs the user's real Windows device. No real QQ account, paid-model, original4120/SnowAstrBot or WindowsOS account joint trial occurred. PowerShell helpers are structural/type-complete only. No signing, installer, OS startup registration, commit, push or public release occurred; no source archive is presented as a distributable.

## Preview8 Windows-x64 portable — second UI round (2026-11-15, Asia/Shanghai)

Preview8 is the current Windows delivery. UI source was frozen after the second settings round: the QQ page now merges the local host, the plugin page groups by functional module with internal parts collapsed, and voice is split into ASR and TTS pages each carrying its Magpie gateway dependency card. Verified before packaging by the parent: desktop typecheck 0, `test -- --run` 0 (121 files / 1,142 tests), build 0, root lint 0, format:check 0, local-host.browser 25/25 and qq-status.browser 7/7; screenshots in [ui-round2-20261115-2227](../../../../qa/fixtures/local-host/evidence/ui-round2-20261115-2227/). Only Windows was rebuilt; Linux was not touched, and no split volumes were produced (the parent cuts those).

**Assembly.** Target verified absent; 3.5 GB free. Job `bash-52fffc3721ab47ce`, exit 0, first offline `--frozen-lockfile --ignore-scripts` attempt; no `--provisionCache`, no `pnpm deploy`, no Root-cwd install/build.

**Snapshot and fence.** 1,747-file snapshot, `sourceContent` = `fd34f8301dd6dd83937c2224ec102775c0d2f337a3ac086adf3297fd340c1e0a`; recomputing with the packager's own filter against the current Root reproduced the same hash over 1,747 files. Module/lock fence `3f1e5db8…86f1` before and after.

**Audit** (`package-audit.json`, `audit-verified`): 3,744 manifest entries, 0 mismatches, 0 missing (only extra `package-report.json`); 3,745 regular files / 455,681,092 bytes before the audit file; 16 native PE all AMD64, 0 non-AMD64, 0 ELF, 0 symlinks, 0 private-state paths; 138 installed dependency ids all in the original lock/workspace; 14 workspace packages; 36 foreign prebuilds omitted; both PowerShell helpers present twice and byte-identical to source; app and role manifests at `0.1.0-preview.8`; `Pet.exe` pinned Electron 45.0.0 `8e84549b…821a59` with `Pet_wer.dll` `234b9aba…`.

**Final artifact.**

| Path (under `.cache/release/`, ignored) | Size | Note |
| --- | --- | --- |
| `Pet-Windows-x64-0.1.0-preview.8.zip` | 184,352,632 bytes | single top-level dir, 4,324 entries |
| `Pet-Windows-x64-0.1.0-preview.8.sha256` | 102 bytes | ZIP SHA256 `87d948d7e0f97dddf112a8989fe9885d9926485db89d1b4b519f12a2899bdfad` |
| `Pet-Windows-x64-0.1.0-preview.8/` | 458,052,783 bytes | 3,746 files / 578 dirs / 0 symlinks |
| `Pet-Windows-x64-0.1.0-preview.8-README.md` | 4,696 bytes | Chinese README with the merged QQ/host page and split voice pages |

The ZIP passed `unzip -t` with no CRC errors and Python `zipfile.testzip()`; all 4,324 entries sit under the single top-level `Pet-Windows-x64-0.1.0-preview.8/` with zero traversal/absolute/backslash/drive-letter entries; all 3,746 files inside are byte-identical to the directory; `sha256sum -c` succeeds. Preview7 remains on disk as the rollback; earlier previews are history.

**Limitations.** No Windows device, Windows ACL or Windows-side execution trial has run; the Linux build and automated-test evidence is not a Windows OS conclusion, and final joint acceptance needs the user's real Windows device. No real QQ account, paid-model, original4120/SnowAstrBot or WindowsOS account joint trial occurred. PowerShell helpers are structural/type-complete only. No signing, installer, OS startup registration, commit, push or public release occurred; no source archive is presented as a distributable.

## Preview9 Windows-x64 portable — private-directory helper fix (2026-11-16, Asia/Shanghai)

Preview9 is the current Windows delivery and the first one carrying the repaired native helpers. Preview8's real start failure was root-caused on a Windows 5.1 host: `windows-private-directory.ps1` line 95 used a C# `//` comment outside the `Add-Type` here-string. The fix replaces it with `#`, narrows the catch to fixed reason tokens, and maps unknown failures to `internal` while recognized ACL failures stay `permission-denied`; the protocol is unchanged. A static regression now catches the old line-95 shape, and a Windows-only initialization case was added. The QQ UI title is `QQ 客户端接入` with a single `qqClientLabel`, and the copy states it is not client detection. Handoff docs (`docs/41-windows-development-handoff.md`, root README and the docs index) were written and passed lint/format.

**Assembly.** Target verified absent; 2.6 GB free. Job `bash-9c2ac92dcbb84251`, exit 0, first offline `--frozen-lockfile --ignore-scripts` attempt; no `--provisionCache`, no `pnpm deploy`, no Root-cwd install/build.

**Snapshot and fence.** 1,748-file snapshot, `sourceContent` = `037c871ad94bfd7cddf5f1cc40c28cd29d4a16c582e7adc283a8643f69295095`; recomputing with the packager's own filter against the current Root reproduced the same hash over 1,748 files. Module/lock fence `3f1e5db8…86f1` before and after.

**Helper repair verified in the artifact.** Both shipped copies of `windows-private-directory.ps1` hash to `63ba6b5de489969a9553456992428f224c04c7b4d065b35b38f754908ceb7be2`, equal to source, and line 95 reads `# This overload applies the descriptor during creation…`. A static scan for `//` outside here-strings returns zero hits on both helpers; the remaining `//` lines (win line 48, owned lines 33 and 40) are legitimate embedded C# and were left untouched. `owned-process.ps1` remains `2e75afc7…` and was never affected.

**Audit** (`package-audit.json`, `audit-verified`): 3,744 manifest entries, 0 mismatches, 0 missing (only extra `package-report.json`); 3,745 regular files / 455,686,942 bytes before the audit file; 16 native PE all AMD64, 0 non-AMD64, 0 ELF, 0 symlinks, 0 private-state paths; 138 installed dependency ids all in the original lock/workspace; 14 workspace packages; 36 foreign prebuilds omitted; app and role manifests at `0.1.0-preview.9`; `Pet.exe` pinned Electron 45.0.0 `8e84549b…821a59` with `Pet_wer.dll` `234b9aba…`.

**Final artifact.**

| Path (under `.cache/release/`, ignored) | Size | Note |
| --- | --- | --- |
| `Pet-Windows-x64-0.1.0-preview.9.zip` | 184,354,557 bytes | single top-level dir, 4,324 entries |
| `Pet-Windows-x64-0.1.0-preview.9.sha256` | 102 bytes | ZIP SHA256 `2c63caa225de7f043045536d30ddeaa6e8a2b66e3df01b16a65fba3faa9cae50` |
| `Pet-Windows-x64-0.1.0-preview.9/` | 458,058,633 bytes | 3,746 files / 578 dirs / 0 symlinks |

The ZIP passed `unzip -t` with no CRC errors and Python `zipfile.testzip()`; all 4,324 entries sit under the single top-level `Pet-Windows-x64-0.1.0-preview.9/` with zero traversal/absolute/backslash/drive-letter entries; all 3,746 files inside are byte-identical to the directory; the packaged helper read back out of the ZIP still carries the `#` fix; `sha256sum -c` succeeds. Preview7 and preview8 remain on disk untouched.

**Limitations.** No Windows device, Windows ACL or Windows-side execution trial has run; the Linux build and automated-test evidence is not a Windows OS conclusion, and final joint acceptance needs the user's real Windows device. The Windows-only initialization case is skipped off-Windows, so the repaired helper's real ACL behaviour still awaits a real host. No real QQ account, paid-model, original4120/SnowAstrBot or WindowsOS account joint trial occurred. No signing, installer, OS startup registration, commit, push or public release occurred; no source archive is presented as a distributable.

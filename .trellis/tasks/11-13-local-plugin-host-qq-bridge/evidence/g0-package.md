# G0 independent package feasibility

2026-11-14, Asia/Shanghai. **The Linux mechanism gate passed with an actual isolated Electron process.** This proves a feasible external layout for the small coreless host, existing native source and authenticated stop. It is not the final production GUI, a published distributable, a Windows artifact or whole-G0 acceptance. No real QQ/model/Agent, old4120, SnowLuma/AstrBot, OS service installation or public release was used.

## Final evidence and executable command

```sh
node qa/probes/companion-local-host-package.mjs --run-g0
```

Final run **exit0**, job `bash-25dfceefc80e48b2`: [actual report](../../../../qa/fixtures/local-host/evidence/package-a34e4be8-201e-4e93-834b-889e17644401/report.json), [complete resolved-file trace](../../../../qa/fixtures/local-host/evidence/package-a34e4be8-201e-4e93-834b-889e17644401/resolved-files.json). The earlier [first successful run](../../../../qa/fixtures/local-host/evidence/package-af4bddb8-b228-466f-ba97-b4a6a05b5900/report.json) also exited0; final rerun adds explicit package digests, ABI and preserved trace.

The [package probe](../../../../qa/probes/companion-local-host-package.mjs), [layout helper](../../../../qa/fixtures/local-host/package-layout.mjs) and [fixed entry helper](../../../../qa/fixtures/local-host/package-entry.mjs) implement the proof without changing Root package/lock/config, Desktop build or plugin trust/factory code.

## Complete temporary workspace and source isolation

- Git tracked **and** untracked/nonignored code provide the complete temporary workspace, including the new local-host code, all43 project manifests, current lock/workspace metadata and patches.1668 files were copied; each source-before/source-after/destination SHA must agree. No Git archive of old HEAD is used. User data, keys, `.env`/`.npmrc`, `.cache`, `.companion-data`, repository node_modules and evidence outputs are excluded.
- Offline/frozen/ignore-scripts install and deploy run **only with cwd inside that temporary workspace**, using existing manager/store and a minimal OS-native environment. Install explicitly uses `--prod=false`; deployment uses `--prod --legacy` into an independent sibling layout. Install added278/deploy130 packages, both exit0 with download0. No third-party install scripts ran, no global configuration changed and no new packager/installer was added.
- The source Root raw lock, `.modules.yaml`, workspace-state, pnpm virtual-store lock, per-package dependency links and `.bin` entries are separately fenced. Final metadata/link before/after hash: `cfc932d109c1e7aa7cf573cab6dff5cdf01b5ca7e853f5c52a7b38375d7eed1d`; raw-lock before/after: `da938eb2cc3b57c0d66e37202203689530c34fefc81a3ec814fcbc87a62646dc`. Both match. Failure paths also check this fence.

Actual private roots were siblings under `/tmp/local-host-package-x9aJS2`: `workspace` for pnpm and `layout` for execution. The package process's resolver rejects fallback to **either** temporary workspace or original checkout.

## Actual runtime, package identity and native behavior

The layout contains copied Electron45/runtime, actual private Linux dependency libraries, the existing source entry/composition, and external physical deployed packages. Existing service workspace-relative imports are internal aliases to the **same deployed package roots**; they are not second source copies. Legacy deploy's own self-alias is verified and rebound only within the copied output. Every layout symlink resolves inside the layout.

The resolver fence is installed before any package/TS loader import. Final result: **309 resolved files, all inside the layout**. The report/trace include actual file paths. SDK `definePlugin`, kernel `KernelFault` and a contracts function are strict-equal through both protocol dependency contexts, proving one module instance for this composition.

Actual target: **Electron45.0.0 / Node24.22.0 / modules ABI150 / N-API10 / Linux-x64**. The copied executable is ELF64, e_machine62 (x86-64), SHA `bcf2b3e430c49265f6da8b81b2f28032e0434155e1e7c4d8d7edfaf449b024dc`. Actual ldd exited0 with no missing library; its resolved native paths are in the report. The test uses explicit `--no-sandbox`; OS sandbox effectiveness is not claimed.

The real kernel loads/reviews the physical packages whose factories it imports. In the final layout, protocol roots are under `layout/packages/local-host/node_modules/.pnpm/@pet+qq-…/node_modules/@pet/qq-…`, rather than the checkout. Both real factories activate after explicit review; no local Core/State is constructed.

| Actual deployed source | Same-root package fingerprint recorded before native activation |
| --- | --- |
| `@pet/qq-official` | `f128a4bf64e16f63c0132b10673e5cabb44a861aec37ea383dd26dd5a1dfadb0` |
| `@pet/qq-onebot` | `63b5c13f2e9705f1420ec5b00a3e02b5581ea121f6264f54704083f62d57ca04` |

The fingerprints use the existing packageFingerprint implementation; actual kernel review/pin checks bind those installed roots, not arbitrary metadata. No factory is esbuild-inlined while another directory supplies its trust digest.

Owned native process PID2836633 opened actual controlled OneBot listener33713, authenticated a controlled peer and observed one native input. The private management client authenticated the captured boot, then stop joined real kernel/native work: `pendingWork:0`, native peer closed and child **exit0**. Official factory activation is real, but no official network/account flow is claimed in this package test. No full UI or large-media matrix was run.

The display joined. Only `/tmp/local-host-package-x9aJS2` (dev64514/inode323709/UID1000) was removed after abs/realpath/inode/owner checks and actual child/peer settlement. The trace/report remain in the evidence directory. There is no running package process or retained layout from these attempts.

## Failed isolation and assembly attempts retained

The first source-cwd deploy attempts were **failed isolation**, even though raw lock equality held. Parent confirmed source workspace-state became `production:true`, `dev:false`, `filteredInstall:true`; a normal source command then attempted autoInstall--production and failed without a TTY. There was no before snapshot of installed metadata, so this is not evidence of deleted development dependencies. Root never declared Vitest; its absent root-level entry is not a deletion test. Parent restored the actual workspace via explicit offline/frozen/ignore-scripts `--prod=false`, confirmed dev/filtered state and normal tests, and authorized the full-temporary-workspace method above. No CI purge or global config change was used.

| Retained failed report | Real failure and correction |
| --- | --- |
| [3479a006](../../../../qa/fixtures/local-host/evidence/package-3479a006-70ef-4adc-a531-548906fb06aa/report.json), [61a6d1fd](../../../../qa/fixtures/local-host/evidence/package-61a6d1fd-358d-41c6-a774-79ee1234eb3a/report.json) | Deploy's own workspace self-alias escaped layout; copied-output self-alias now points to deployed package, remaining links strictly internal |
| [f62fc6b0](../../../../qa/fixtures/local-host/evidence/package-f62fc6b0-aaac-44f4-b2f3-0e18835da3dc/report.json) | Actual startup missed libatk; both verified private native-library sets are now copied and actual ldd checked |
| [c28c0dbb](../../../../qa/fixtures/local-host/evidence/package-c28c0dbb-32e2-49f2-8532-f2acab2f25c1/report.json), [cleanup](../../../../qa/fixtures/local-host/evidence/package-c28c0dbb-32e2-49f2-8532-f2acab2f25c1/failed-attempt-cleanup.json) | Missing copied ESM package metadata made TSX emit CJS; real Desktop/service package metadata now accompanies source. Captured failed startup PID gone, no native kernel; root verified removed |
| [134f1015](../../../../qa/fixtures/local-host/evidence/package-134f1015-e21b-4dff-bb5b-af506121247a/report.json), [7c3a1eac](../../../../qa/fixtures/local-host/evidence/package-7c3a1eac-525f-4d9c-99c1-6092f290d56d/report.json) | Full temporary workspace/fence already passed, but old service/fixture relative imports lacked package aliases; now aliases name the same deployed external packages. Source fence matched, owned failed bootstraps/display/roots joined and removed |

These remain failed records. Failed-bootstrap process termination is cleanup of the exact child created by the probe, not a successful source-stop or a business-effect retry. The successful gate uses authenticated native stop and child exit0.

## Windows and product follow-up

Linux ELF/native-library evidence cannot serve as a Windows candidate. G2/G7 must supply actual Windows-x64 Electron45/Node ABI-compatible runtime and native optional dependencies, preserve physical factory/source digest identity and one SDK/kernel, validate and package the [G2 same-user SID/DACL implementation](g0-process.md), and execute the Windows-device package/reopen/stop test. No Linux `.so`/addon is labeled or copied as Windows evidence. No global service/autostart or final UI installer/release is included here.

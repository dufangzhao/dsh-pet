# 本地 work-commit 审阅计划（local-plugin-host-qq-bridge）

> **状态：SOURCE FREEZE 后的最终批次计划。用户已直接授权本阶段提交 / 推送 / 合并，Root 即可按下列精确路径执行 4 个 commit 并推送合并，无需再审批。**
> 本子 agent 只产出本计划，不 stage/commit/push/archive、不改 task.json / progress.md / g7-package.md / 任何源码；本 scope 唯一写入文件即本 [commit-plan.md](commit-plan.md)。
> 提交时必须逐批按下述**精确相对路径** `git add`，**禁止 `git add .`**；每批只列本批路径，目录一律展开到文件；生成 evidence 的 raw report 与 UI 截图一律不纳入。
> 审批依据：[task.json](task.json) 的 `implementationApproval`（已批准实现）、[implement.md](implement.md):78（"Present exact local work-commit batches once for approval"）、[prd.md](prd.md) 与 [design.md](design.md) 最近批准 scope。`planningBaseline 6897787` 未变（HEAD 仍 `6897787`，此前无 commit）；审批 5 artifact SHA 未变。用户后续开发机为 Windows。

## 已核验的最终事实（只引用报告，不重测、不改代码）

- **交付版本：preview9 已构建并审计完成（本次交付）**。Windows x64 portable ZIP **184,354,557 B**，ZIP SHA256 `2c63caa225de7f043045536d30ddeaa6e8a2b66e3df01b16a65fba3faa9cae50`；源码快照 **1,748 files**，`sourceContent` SHA256 `037c871ad94bfd7cddf5f1cc40c28cd29d4a16c582e7adc283a8643f69295095`。两份 Windows private helper 哈希 `63ba6b5de489969a9553456992428f224c04c7b4d065b35b38f754908ceb7be2`，第 95 行 `#` 注释修复已入 ZIP 确认；0 symlink / 0 ELF / 0 private-state、16 个 PE 全 AMD64；build / audit / zip 全 0。preview4（`76aa8609…`）/ preview5（`b32cd6719…`）/ preview6（`b9d7d276…`）/ preview7（`5fa51552…`）/ preview8 均为被取代的历史候选，**不再作为当前交付**。**Windows 设备/账号联合验收仍待用户**，Linux/自动化证据不证明 Windows OS 执行。
- **PS195 修复**（[windows-startup-fix.md](evidence/windows-startup-fix.md)）：Windows PowerShell 5.1 helper 第 95 行的 JS/C# `//` 注释已改为 `#`；TS 分类保持 `internal` / `permission`，**未改 KernelError 或协议**。
- **SOURCE FREEZE 最终 checks（Root 实测）**：`pnpm -r typecheck` exit 0；`packages/local-host` 9 files / **39 passed + 1 Windows skip**；`apps/desktop` 121 files / **1144 pass**；`pnpm lint` 0 / `format:check` 0；UI 类型与 build 由 c9 验证 0。
- **更早门禁证据（历史记录，见 evidence 文档）**：G3 5/5（[g3-bridge.md](evidence/g3-bridge.md)）、G5 55/55（[g5-delivery.md](evidence/g5-delivery.md)）、G6 preview6 首跑 6/6 三源 DOM 授权 + stop-flush、[quality-final.md](evidence/quality-final.md) Root 六 gate 全 0（3245 passed / test:qa 178 pass 4 skip）、[quality-docker-optin.md](evidence/quality-docker-optin.md) 14+4 Docker opt-in 真实全 pass（初次 18 skip 已补全）、[g6-stop-review.md](evidence/g6-stop-review.md) management stop-path 最窄修复。
- **设置台 UI 重构**（[ui-redesign.md](evidence/ui-redesign.md)）：分组侧栏、独立页面、共享信任卡；desktop typecheck 0 / 121 files 1135 tests / build 0 / local-host browser 25/25 / qq browser 7/7 / 根 lint·format 0。历史 UI 第二轮 `pages/local-host.tsx` 为故意合并到 QQ 页后删除的未跟踪临时文件，已按 Root 确认从 §B3 移除、不补回。
- **跨平台交接**：用户后续开发机为 Windows；新增 [41-windows-development-handoff.md](../../../docs/41-windows-development-handoff.md) 与 [README.md](../../../README.md) / [docs/README.md](../../../docs/README.md) 索引链接归 **B4**。
- 服务最终 Parent job `bash-220cc404c8874b47` / PID `3428075`：same Agent id/epoch、0 msg / 0 tasks，非原 child 旧 pid（[service-handoff.md](evidence/service-handoff.md) 保留迁移期中间记录）。
- **报告角色区分**：canonical 任务 evidence/规划文档（B4 提交）vs 运行时生成的 raw report 与 UI 截图（§EXCLUDED 保留在 workspace、不默认纳入源码提交）；[progress.md](progress.md)、[g7-package.md](evidence/g7-package.md)、[task.json](task.json) 与 Windows/UI 相关 evidence 由 Root 自行更新，本子 agent 未改。本刷新只重算路径与 counts，**不重测、不改代码、不删生成物**。

---

## 正文：4 个批次（依赖顺序 B1 → B2 → B3 → B4）

### 批次 B1 — G1 基座：canonical contracts + State4 + 冷迁移
**中文意图**：先声明闭合的 bridge/本地管理契约、State4 私有执行绑定与停机 format3→4 迁移，并把 `getDeliveryExecution` 登记进运行时 read 目录。State4 默认「无 execution」保留旧 service-local 指纹与旧行为，因此本批**可 standalone 编译**（contracts 新文件仅互引 contracts；`migrate.ts` 仅引 `@pet/host-kernel` 与 `@pet/contracts`；不触碰任何 `apps/companion-service` 的 qq 运行时，也不引 `@pet/local-host`）。
**拟 commit message**：`feat(contracts): declare local-host contracts and State4 cold migration`
**依赖顺序**：第 1 批，无前置；是 B2/B3 的契约与 State 前置。
**支撑证据**：[g1-state4.md](evidence/g1-state4.md)（5/5 synthetic 迁移、旧 IDs/fingerprints/receipts 不变、无历史 replay）、`migrate-v4.test.ts`、`execution.test.ts`、`local-host*.test.ts`、`state-sqlite/src/index.test.ts`；[quality-final.md](evidence/quality-final.md) 的 types/lint/format 0。
**文件数**：27（M 17 / A 10）。精确清单见附录 §B1。

### 批次 B2 — G2–G5 核心：独立宿主 + 共享 QQ 源 + 服务端桥接 + raw custody + once-only 远程投递
**中文意图**：把独立本地宿主（含 G2 迁移/复用的 QQ native 源）、`local-agent-link` / `local-host-bridge` 两插件、服务端 remote-source facade、raw custody cut、G5 once-only 远程投递，以及**全部 workspace 依赖清单与 `pnpm-lock.yaml`** 一起落地。companion-service 的 qq 控制器/ingress/delivery/media/audio/server/service 现有文件全部改走 `@pet/local-host` 子路径导入；因此本批必须把「新宿主包 + 两插件 + 8 个源文件迁移删除 + companion-service 改动 + 依赖/lock」放在**同一批**，否则前批无法编译。另含 tracked M 的 `qa/fixtures/companion-service/helpers.mjs`（Docker opt-in `effectRecord` 等待顺序修复）；`packages/local-host/src/management.ts` 及其 tests 的 stop-path 修复、两份 `*.ps1` 的 PS195 `//`→`#` 修复只是本批目录内**内容更新**，无新增路径。
**拟 commit message**：`feat(local-host): compose independent host, shared QQ sources and once-only remote delivery`
**依赖顺序**：第 2 批，依赖 B1（contracts + State4 + read 目录）。
**支撑证据**：[g0-bridge.md](evidence/g0-bridge.md)、[g0-process.md](evidence/g0-process.md)、[g0-custody.md](evidence/g0-custody.md)、[g2-sources.md](evidence/g2-sources.md)、[g3-bridge.md](evidence/g3-bridge.md)（5/5）、[g4-media.md](evidence/g4-media.md)、[g5-delivery.md](evidence/g5-delivery.md)（55/55）、[g5-independent-review.md](evidence/g5-independent-review.md)、[g6-stop-review.md](evidence/g6-stop-review.md)、[quality-docker-optin.md](evidence/quality-docker-optin.md)（14+4 真实全 pass）、[windows-startup-fix.md](evidence/windows-startup-fix.md)（PS195 定位）；`qq-local-host.test.ts`、`qq-remote-delivery.test.mjs`、`local-host-trust.test.ts`、`bridge-channel.test.ts` 等；SOURCE FREEZE 最终 `pnpm -r typecheck` exit 0 与 local-host 9 files 39 passed + 1 Windows skip。
**文件数**：106（M 30 / D 8 / A 68）。精确清单见附录 §B2。

### 批次 B3 — G6/G7 桌面与 portable + 设置台 UI 重构：Main/preload/Renderer + portable builder + 验收 probes
**中文意图**：在生产桌面入口接入/启停独立宿主，落地 desktop `src/local-host/*`、Main/preload/Renderer 的本地源管理与 portable 打包脚本，并附桌面浏览器测试与 QA probe 入口。含**共享 UI 源码信任卡**与**设置台 UI 重构**（`console/nav.ts`、`minimal-ui/icons.tsx`、`pages/{model,qq,pet,voice-settings,tts-settings,gateway-note}.tsx`、`local-host.css`、`settings-shell` / `shell` / `controls` / `foundation.css` / `settings-sections.css` / `shared-speech-settings.tsx` / `start` / `qq-status` / `persona` / `plugins` / `voice-card` / `app-views` / `shared/console-views` / `console-app` / `icons` 与 UI 测试、`qa/probes/plugin-list-cleanup-native.mjs`）——全部归 **B3** 桌面层，已有批次位置保持原位**不重复归类**。`pages/local-host.tsx` 已按 Root 确认移除。`build.mjs` 会复制 `packages/local-host/src/*.ps1`（B2）、`package-portable.mjs` 会 import `qa/fixtures/local-host/package-layout.mjs`（B2），故本批在 B2 之后。
**拟 commit message**：`feat(desktop): add local-host management, settings-console redesign, portable build and acceptance probes`
**依赖顺序**：第 3 批，依赖 B1（contracts）+ B2（`@pet/local-host`、宿主源、QA fixtures、manifests/lock）。
**支撑证据**：[g6-ui.md](evidence/g6-ui.md)、[g6-native.md](evidence/g6-native.md)、[ui-redesign.md](evidence/ui-redesign.md)（desktop typecheck0 / 121 files 1135 tests / build0 / local-host browser25/25 / qq browser7/7 / 根 lint·format0）、[g7-package.md](evidence/g7-package.md)（preview9 ZIP / sourceContent / 审计）、[progress.md](progress.md)；SOURCE FREEZE 最终 desktop **121 files / 1144 pass**、`pnpm lint` 0 / `format:check` 0、UI 类型与 build 由 c9 验证 0；5 个 `qa/probes/companion-local-host-*.mjs` 为 `pnpm test:qa` 受控入口，跨层引用 B2/B3 源码，**仅在全部批次完成后的门禁统一执行**，单批不单独声称通过。
**文件数**：70（M 31 / A 39）。精确清单见附录 §B3。

### 批次 B4 — 文档层：canonical backend specs + Windows 交接 + 任务阶段证据/规划 + 本计划
**中文意图**：一次性更新 canonical backend 契约说明（含新 `local-plugin-host.md`），纳入 **Windows 开发交接文档** `docs/41-windows-development-handoff.md` 与 `README.md` / `docs/README.md` 索引链接，并把本任务的规划/审查/research/evidence（含已批准的 5 个 artifact、[windows-startup-fix.md](evidence/windows-startup-fix.md)、[ui-redesign.md](evidence/ui-redesign.md)、[g7-package.md](evidence/g7-package.md) preview9 节等内容更新、与本 [commit-plan.md](commit-plan.md)）作为只读记录落地。**Parent 已确认的 5 个 review 项亦归入本批**（见下）。纯文档，不改任何编译输入；本子 agent 未改 task.json / progress.md / g7-package.md。
**拟 commit message**：`docs(task): record local-host specs, Windows handoff, stage evidence and work-commit batches`
**依赖顺序**：第 4 批（最后）；文档引用 B1–B3 的源码路径，故随后落地；可独立审阅。
**支撑证据**：[quality-static.md](evidence/quality-static.md)、[quality-model-budget.md](evidence/quality-model-budget.md)、[quality-final.md](evidence/quality-final.md)、[quality-docker-optin.md](evidence/quality-docker-optin.md)、[service-handoff.md](evidence/service-handoff.md)、[g6-stop-review.md](evidence/g6-stop-review.md)、[ui-redesign.md](evidence/ui-redesign.md)、[windows-startup-fix.md](evidence/windows-startup-fix.md)；[g7-package.md](evidence/g7-package.md) 的最终 preview9 ZIP 审计；[task.json](task.json) 审批 5 artifact 哈希不变。
**文件数**：50（M 8 / A 42，A 含本计划文件）。精确清单见附录 §B4。

---

## Parent 已确认：5 个 review 项全部归入 B4

Parent 已亲读 3 个 review diff、确认这 5 项均为**同 task bookkeeping**（不是无关既有旧工作），**全部纳入 B4**；本计划不擅覆盖/排除、**不改这些文件的任何内容，只归类**，附录精确清单按此展开：

- `CONTEXT.md`（M）：根级术语表新增「本地宿主」定义。
- `.trellis/tasks/11-06-unified-companion-architecture/prd.md`（M）：父任务新增 R25 部署澄清与本子任务引用。
- `.trellis/tasks/11-06-unified-companion-architecture/task.json`（M）：父任务 `children` 追加 `11-13-local-plugin-host-qq-bridge`。
- `.trellis/tasks/11-13-local-plugin-host-qq-bridge/progress.md`（A）：本任务母记录。
- `.trellis/tasks/11-13-local-plugin-host-qq-bridge/task.json`（A）：本任务母记录，含审批/执行元数据。

## 明确排除项（含原因，按 fresh git 实际枚举）

- `qa/fixtures/local-host/evidence/**`（A，**实际 64 个**）：**运行时生成的 probe 原始输出与 UI 截图**（UUID 目录 + `report.json` / `failed-attempt-cleanup.json` / `resolved-files.json` / `production-resolution-linux-r2-*.json` / `external-linux-preview5-copy-20261115.json`，以及 `ui-redesign-20261115-2034/`、`...-2040/`、`ui-redesign-20261115-2236/`、`ui-round2-20261115-2227/` 四批 PNG + README）。经 `git check-ignore` 核验**未被 gitignore**，但属每轮产物、非产品源码、非批准实现 scope 的源码测试；仅作为任务内 evidence 文档的本机链接引用。**排除、Root 保留在 workspace、保持 untracked、不写入任何 `git clean`/`git rm` 命令、不删生成物**；源码提交仍不默认纳入所有生成报告/截图，与 B4 的 canonical evidence 文档角色区分。精确清单见附录 §EXCLUDED。
- 已被 gitignore 的产物/依赖/私有数据：`node_modules/`、`.pnpm-store/`、`dist/`、`build/`、`out/`、`release/`、`.cache/`（含 preview7/8/9 Windows 分发 zip）、`*.log`、`userdata/`、`.companion-data/`、`models/`、`.env*`、`*.tsbuildinfo`、`.trellis/.developer`、`.trellis/.runtime/` 等**不在 git status 中**，一律不加 Git、不 stage、不放入任何清理/移除命令。

## 提交前核验（credentials / 大文件；Root 执行 4 commits 前建议复核）

- 全部 317 个计划/排除路径逐条 `git check-ignore`：**无一被忽略、无一位于 `.cache/` / `.companion-data/` / `userdata/` / `.env*` 等密钥或数据根下**；已忽略的 `.cache/`（preview7/8/9 ZIP、Electron 二进制）与 `.companion-data/` 绝不入库。
- 工作树内 317 个改动**无 >200KB 文件**；`qa/fixtures/local-host/evidence/` 全部 64 个产物合计约 2 MiB。真正的 runtime QA 大文件只在已忽略根内。
- 4 处看似凭证、实为**合成测试夹具**的字符串（GitHub secret scanning 可能误报，推送前备案即可，勿删改）：`apps/companion-service/src/qq-native.test.ts:27-30`（`isolated-qq-test-secret-…`、`isolated-qq-access-token-…`、自签 WSS `-----BEGIN PRIVATE KEY-----` 合成证书）、`qa/probes/companion-speech-output-fixture.test.mjs:9`、`qa/probes/companion-local-host-lifecycle.mjs:80`、`qa/probes/companion-local-host-package.mjs:328`（`Bearer g0-…` / `Bearer spe…`）。`packages/local-host/src/management-secrets.ts` 是密钥管理源码、0 个高熵字面量；`plugins/local-agent-link/plugin.json` 只声明 credential key 名、不含值。
- 建议：逐批逐路径 `git add`（禁止 `git add .`），每批提交前 `git diff --cached --name-only` 复核，并扫一遍 `git ls-files | grep -Ei '\.(zip|exe|dll|onnx|png|key|pem|env)$'`。

## 关键编排约定（避免重叠 / 保证可审阅）

- **共用 root index / contracts / deps / lock 各只落一个批次，不跨批重叠**：`packages/contracts/src/index.ts` 及全部 `packages/contracts/*` 只在 **B1**；`pnpm-lock.yaml` 与所有 workspace 依赖清单（`package.json`，含 `apps/desktop/package.json` 的 `@pet/local-host` / `tsx` 声明）集中在 **B2**，保证 lock 与各 `package.json` 不跨批错位；`plugins/state-sqlite/plugin.json` 是**权限清单、非依赖清单**，随其 State4 源码落 **B1**。同一文件不在两批出现。
- **QA helper 与 impl 同批，不丢到末尾 docs 批**：`qa/fixtures/local-host/*.mjs`（9 个）与 tracked M 的 `qa/fixtures/companion-service/helpers.mjs` 全部在 **B2**——其中 `bridge-common.mjs` / `bridge-native.mjs` 被 B2 源码测试 `apps/companion-service/src/qq-remote-delivery.test.mjs` 直接 import，`package-layout.mjs` 被 B3 的 `apps/desktop/package-portable.mjs` import（B2 在前即可用）；`qa/companion-qq-review-integration-scenes.test.ts`（M，改指向 `packages/local-host/src/qq-input.js`）也在 **B2**。否则前批 test 不 build。
- **设置台 UI 重构全归 B3、不重复归类**：新增 `console/nav.ts`、`minimal-ui/icons.tsx`、`pages/{model,qq,pet,voice-settings,tts-settings,gateway-note}.tsx`、`local-host/local-host.css` 与 `settings-shell` / `shell` / `controls` / `foundation.css` / `settings-sections.css` / `shared-speech-settings.tsx` / `start` / `qq-status` / `persona` / `plugins` / `voice-card` / `app-views` / `shared/console-views` / `console-app` / `icons` 及 UI 测试均落 **B3**；已在 B3 的路径保持原位，不因内容更新而重复列出或改批。`pages/local-host.tsx` 按 Root 确认从 B3 移除、不补回。`management.ts` / `*.ps1` 的修复只是 **B2 已有路径的内容更新**，不新增路径、不另起批次。
- **8 个 D 是迁移复用，不是删功能**：`apps/companion-service/src/` 下 `qq-delivery-transport.ts`、`qq-input.ts`、`qq-native-types.ts`、`qq-official-io.ts`、`qq-official-media-io.ts`、`qq-onebot-io.ts`、`qq-onebot-media-io.ts`、`qq-socket.ts` 整体迁入 `packages/local-host/`（6 个进 `src/qq-native/`，`qq-input.ts` / `qq-delivery-transport.ts` 进 `src/`）。经 sha256 比对：7 个在迁移时按 G2 边界改造（`qq-socket.ts` 字节不变），旧路径**无任何 compat re-export stub**，companion-service 现有文件已核验无 `./qq-input.js` 等旧相对导入残留。git 会按 rename+modify 或 D+A 呈现；**本计划不创建 old compat stub**，也不把这 8 个删除拆到前批（否则 companion-service 无法编译）。
- **每批尽量 buildable，不为好看拆跨层功能**：B1 自洽可编译；B2 把「宿主包 + 插件 + 删除 + consumer 改动 + 依赖/lock」一次落地，避免前批断链；B3 在 B2 之上（UI 重构与桌面入口同层，不另拆）；B4 纯文档。跨层依赖全部按此顺序合并，而非拆散。

## 为何 4 批（而非 3 批）

不并为 3 批：B1 是 G1 基座（默认无 execution、可 standalone 编译），与 B2 的 106 文件跨层宿主实现必须分开，否则无法单独审阅契约/State4 语义；B4 是纯文档/证据层（含已批准 5 artifact、Parent 确认的 5 个 review 项、Windows 交接文档与本计划），与代码批分开使 commit 可审阅且不影响编译。若压成 3 批，要么让 B2 吞掉 B1 契约/迁移（不可审阅），要么把 docs 掺进代码批（违背「一处维护、一处引用」）。故保留 4 批，符合 implement.md:78 的 4–5 批易审阅要求。

---

# 附录：完整精确路径清单（A=新增 / M=修改 / D=删除，目录已展开）

> 每个当前改动都归入下表的某批或 §EXCLUDED，无遗漏；数字经 SOURCE FREEZE 后 fresh `git status --porcelain=v1 -uall` 与逐路径核对。
> 覆盖核对：当前工作树共 **317**（`M 86 + D 8 + ?? 223`，其中 ?? 含本计划文件 1 个）；分配为 **B1 27 + B2 106 + B3 70 + B4 50 + EXCLUDED 64 = 317**，无重叠、无遗漏、无 `git add .`。Parent 确认的 5 项已归入 §B4；`pages/local-host.tsx` 已按确认从 §B3 移除。

## §B1 — 27（M 17 / A 10）
```
A apps/companion-service/src/migrate-v4.test.ts
A packages/contracts/src/desktop-local-host.ts
A packages/contracts/src/local-host-console.test.ts
A packages/contracts/src/local-host-console.ts
A packages/contracts/src/local-host-process.test.ts
A packages/contracts/src/local-host-process.ts
A packages/contracts/src/local-host-qq.ts
A packages/contracts/src/local-host.test.ts
A packages/contracts/src/local-host.ts
A plugins/state-sqlite/src/execution.test.ts
M apps/companion-service/src/migrate-v3.test.ts
M apps/companion-service/src/migrate.test.ts
M apps/companion-service/src/migrate.ts
M packages/companion-runtime/src/runtime.ts
M packages/contracts/src/companion-qq.ts
M packages/contracts/src/index.ts
M packages/contracts/src/validation/index.ts
M packages/contracts/src/validation/registry.ts
M packages/contracts/src/validation/validate.ts
M plugins/state-sqlite/plugin.json
M plugins/state-sqlite/src/deliveries.ts
M plugins/state-sqlite/src/index.test.ts
M plugins/state-sqlite/src/index.ts
M plugins/state-sqlite/src/schema.ts
M plugins/state-sqlite/src/state.ts
M plugins/state-sqlite/src/types.ts
M plugins/state-sqlite/src/validation.ts
```

## §B2 — 106（M 30 / D 8 / A 68）
```
A apps/companion-service/src/qq-local-host.test.ts
A apps/companion-service/src/qq-local-host.ts
A apps/companion-service/src/qq-media-authority.ts
A apps/companion-service/src/qq-remote-delivery.child-fixture.mjs
A apps/companion-service/src/qq-remote-delivery.test.mjs
A apps/companion-service/src/qq-remote-delivery.ts
A packages/companion-runtime/src/local-host-trust.test.ts
A packages/local-host/package.json
A packages/local-host/src/authority-check.ts
A packages/local-host/src/bridge-channel.test.ts
A packages/local-host/src/bridge-channel.ts
A packages/local-host/src/bridge-handshake.ts
A packages/local-host/src/index.ts
A packages/local-host/src/kernel.test.ts
A packages/local-host/src/kernel.ts
A packages/local-host/src/management-network.test.ts
A packages/local-host/src/management-secrets.test.ts
A packages/local-host/src/management-secrets.ts
A packages/local-host/src/management.test.ts
A packages/local-host/src/management.ts
A packages/local-host/src/owned-process.ps1
A packages/local-host/src/owned-process.test.ts
A packages/local-host/src/owned-process.ts
A packages/local-host/src/qq-agent-link.ts
A packages/local-host/src/qq-control.ts
A packages/local-host/src/qq-delivery-transport.ts
A packages/local-host/src/qq-delivery-types.ts
A packages/local-host/src/qq-execution.ts
A packages/local-host/src/qq-input-projection.ts
A packages/local-host/src/qq-input.ts
A packages/local-host/src/qq-native/index.ts
A packages/local-host/src/qq-native/qq-native-types.ts
A packages/local-host/src/qq-native/qq-official-io.ts
A packages/local-host/src/qq-native/qq-official-media-io.ts
A packages/local-host/src/qq-native/qq-onebot-io.ts
A packages/local-host/src/qq-native/qq-onebot-media-io.ts
A packages/local-host/src/qq-native/qq-operation.ts
A packages/local-host/src/qq-native/qq-socket.ts
A packages/local-host/src/qq-source-identity.ts
A packages/local-host/src/qq-source.test.ts
A packages/local-host/src/qq-source.ts
A packages/local-host/src/rendezvous.test.ts
A packages/local-host/src/rendezvous.ts
A packages/local-host/src/windows-private-directory.ps1
A packages/local-host/src/windows-private-directory.test.ts
A packages/local-host/src/windows-private-directory.ts
A packages/local-host/tsconfig.json
A plugins/local-agent-link/build.mjs
A plugins/local-agent-link/package.json
A plugins/local-agent-link/plugin.json
A plugins/local-agent-link/src/index.ts
A plugins/local-agent-link/tsconfig.json
A plugins/local-host-bridge/build.mjs
A plugins/local-host-bridge/package.json
A plugins/local-host-bridge/plugin.json
A plugins/local-host-bridge/src/index.ts
A plugins/local-host-bridge/tsconfig.json
A plugins/text-client/src/client/local-host-protocol.ts
A plugins/text-client/tests/local-host-protocol.test.mjs
A qa/fixtures/local-host/bridge-common.mjs
A qa/fixtures/local-host/bridge-local.mjs
A qa/fixtures/local-host/bridge-native.mjs
A qa/fixtures/local-host/bridge-server.mjs
A qa/fixtures/local-host/gui.mjs
A qa/fixtures/local-host/host.mjs
A qa/fixtures/local-host/package-entry.mjs
A qa/fixtures/local-host/package-layout.mjs
A qa/fixtures/local-host/production-resolution.mjs
D apps/companion-service/src/qq-delivery-transport.ts
D apps/companion-service/src/qq-input.ts
D apps/companion-service/src/qq-native-types.ts
D apps/companion-service/src/qq-official-io.ts
D apps/companion-service/src/qq-official-media-io.ts
D apps/companion-service/src/qq-onebot-io.ts
D apps/companion-service/src/qq-onebot-media-io.ts
D apps/companion-service/src/qq-socket.ts
M apps/companion-service/package.json
M apps/companion-service/src/material-store.test.ts
M apps/companion-service/src/material-store.ts
M apps/companion-service/src/model-controller.test.ts
M apps/companion-service/src/qq-audio.test.ts
M apps/companion-service/src/qq-audio.ts
M apps/companion-service/src/qq-controller.ts
M apps/companion-service/src/qq-delivery-transport.test.ts
M apps/companion-service/src/qq-delivery.test.ts
M apps/companion-service/src/qq-delivery.ts
M apps/companion-service/src/qq-http.ts
M apps/companion-service/src/qq-ingress.test.ts
M apps/companion-service/src/qq-ingress.ts
M apps/companion-service/src/qq-input.test.ts
M apps/companion-service/src/qq-media-transfer.test.ts
M apps/companion-service/src/qq-media-transfer.ts
M apps/companion-service/src/qq-native-extra.test.ts
M apps/companion-service/src/qq-native.test.ts
M apps/companion-service/src/server.ts
M apps/companion-service/src/service.ts
M apps/desktop/package.json
M packages/companion-runtime/package.json
M packages/companion-runtime/src/plugin-host.ts
M packages/host-kernel/src/tasks/media-peer.ts
M plugins/qq-official/package.json
M plugins/qq-onebot/package.json
M plugins/text-client/src/protocol.ts
M pnpm-lock.yaml
M qa/companion-qq-review-integration-scenes.test.ts
M qa/fixtures/companion-service/helpers.mjs
```

## §B3 — 70（M 31 / A 39）
```
A apps/desktop/package-portable.mjs
A apps/desktop/src/local-host/client.test.ts
A apps/desktop/src/local-host/client.ts
A apps/desktop/src/local-host/composition.test.ts
A apps/desktop/src/local-host/composition.ts
A apps/desktop/src/local-host/console.ts
A apps/desktop/src/local-host/daemon.ts
A apps/desktop/src/local-host/main.ts
A apps/desktop/src/main/local-host-controller.test.ts
A apps/desktop/src/main/local-host-controller.ts
A apps/desktop/src/main/local-host-entry.ts
A apps/desktop/src/main/local-host-request.ts
A apps/desktop/src/preload/local-host-bridge.test.ts
A apps/desktop/src/renderer/console/local-host/local-agent-link-form.tsx
A apps/desktop/src/renderer/console/local-host/local-host-card.test.tsx
A apps/desktop/src/renderer/console/local-host/local-host-card.tsx
A apps/desktop/src/renderer/console/local-host/local-host-section.tsx
A apps/desktop/src/renderer/console/local-host/local-host-view.test.ts
A apps/desktop/src/renderer/console/local-host/local-host-view.ts
A apps/desktop/src/renderer/console/local-host/local-host.css
A apps/desktop/src/renderer/console/local-host/local-source-draft.ts
A apps/desktop/src/renderer/console/local-host/local-source-form.tsx
A apps/desktop/src/renderer/console/local-host/local-source-trust.test.tsx
A apps/desktop/src/renderer/console/local-host/local-source-trust.tsx
A apps/desktop/src/renderer/console/local-host/read-bridge.ts
A apps/desktop/src/renderer/console/minimal-ui/icons.tsx
A apps/desktop/src/renderer/console/nav.ts
A apps/desktop/src/renderer/console/pages/gateway-note.tsx
A apps/desktop/src/renderer/console/pages/model.tsx
A apps/desktop/src/renderer/console/pages/pet.tsx
A apps/desktop/src/renderer/console/pages/qq.tsx
A apps/desktop/src/renderer/console/pages/tts-settings.tsx
A apps/desktop/src/renderer/console/pages/voice-settings.tsx
A apps/desktop/tests/browser/local-host.browser.mjs
A qa/probes/companion-local-host-bridge.mjs
A qa/probes/companion-local-host-desktop.mjs
A qa/probes/companion-local-host-lifecycle.mjs
A qa/probes/companion-local-host-main-link.mjs
A qa/probes/companion-local-host-package.mjs
M apps/desktop/build.mjs
M apps/desktop/src/main/builtin-admission.json
M apps/desktop/src/main/companion-client-controller.test.ts
M apps/desktop/src/main/companion-client-controller.ts
M apps/desktop/src/main/index.ts
M apps/desktop/src/preload/companion-bridge.ts
M apps/desktop/src/preload/index.ts
M apps/desktop/src/renderer/bridges.d.ts
M apps/desktop/src/renderer/console/app-views.test.ts
M apps/desktop/src/renderer/console/app-views.ts
M apps/desktop/src/renderer/console/console-app.tsx
M apps/desktop/src/renderer/console/icons.tsx
M apps/desktop/src/renderer/console/minimal-ui/controls.tsx
M apps/desktop/src/renderer/console/minimal-ui/foundation.css
M apps/desktop/src/renderer/console/minimal-ui/settings-sections.css
M apps/desktop/src/renderer/console/minimal-ui/shared-speech-settings.tsx
M apps/desktop/src/renderer/console/minimal-ui/shell.tsx
M apps/desktop/src/renderer/console/pages/app-pages.test.tsx
M apps/desktop/src/renderer/console/pages/persona.tsx
M apps/desktop/src/renderer/console/pages/plugins.test.tsx
M apps/desktop/src/renderer/console/pages/plugins.tsx
M apps/desktop/src/renderer/console/pages/qq-status.test.tsx
M apps/desktop/src/renderer/console/pages/qq-status.tsx
M apps/desktop/src/renderer/console/pages/start.tsx
M apps/desktop/src/renderer/console/pages/voice-card.tsx
M apps/desktop/src/renderer/console/settings-shell.test.tsx
M apps/desktop/src/renderer/console/settings-shell.tsx
M apps/desktop/src/renderer/shared/console-views.ts
M apps/desktop/tests/browser/qq-status.browser.mjs
M apps/desktop/tsconfig.json
M qa/probes/plugin-list-cleanup-native.mjs
```

## §B4 — 50（M 8 / A 42，A 含本计划文件、windows-startup-fix.md、Windows 交接文档与 Parent 确认的 5 个 review 项）
```
A .trellis/spec/backend/local-plugin-host.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/check.jsonl
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/commit-plan.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/design.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence-review.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-bridge.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-custody.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-kernel.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-official-hello.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-package.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-process.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-wire-review.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g0-wire.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g1-state4.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g2-sources.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g3-bridge.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g4-media.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g5-delivery.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g5-independent-review.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g6-native.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g6-stop-review.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g6-ui.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/g7-package.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/quality-docker-optin.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/quality-final.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/quality-model-budget.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/quality-static.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/service-handoff.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/ui-redesign.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/windows-startup-fix.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/implement.jsonl
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/implement.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/prd.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/progress.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/research/desktop-ux-delivery.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/research/index.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/research/local-host.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/research/remote-authority-media.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/research/transport-reuse.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/review.md
A .trellis/tasks/11-13-local-plugin-host-qq-bridge/task.json
A docs/41-windows-development-handoff.md
M .trellis/spec/backend/companion-service.md
M .trellis/spec/backend/index.md
M .trellis/spec/backend/qq-platform-entry.md
M .trellis/tasks/11-06-unified-companion-architecture/prd.md
M .trellis/tasks/11-06-unified-companion-architecture/task.json
M CONTEXT.md
M README.md
M docs/README.md
```

## §EXCLUDED — 64（运行时生成 probe 原始输出 + UI 截图，按 fresh git 枚举，明确排除、保留在 workspace、保持 untracked、不删生成物）
```
A qa/fixtures/local-host/evidence/0ffd4162-14ee-451f-babf-295b3093ac28/failed-attempt-cleanup.json
A qa/fixtures/local-host/evidence/0ffd4162-14ee-451f-babf-295b3093ac28/report.json
A qa/fixtures/local-host/evidence/22fd8e2e-ce88-4083-8730-98035cfa5a48/failed-attempt-cleanup.json
A qa/fixtures/local-host/evidence/22fd8e2e-ce88-4083-8730-98035cfa5a48/report.json
A qa/fixtures/local-host/evidence/bb9814bd-9059-4e32-a5d1-2c59ba141607/report.json
A qa/fixtures/local-host/evidence/c57abb44-75ce-4afe-9aa2-4f6834b405c9/failed-attempt-cleanup.json
A qa/fixtures/local-host/evidence/c57abb44-75ce-4afe-9aa2-4f6834b405c9/report.json
A qa/fixtures/local-host/evidence/desktop-38138cc5-7621-4e02-b16e-68e664b67980/report.json
A qa/fixtures/local-host/evidence/desktop-5497d82a-5cc2-45da-a4b1-3461fd9d2c08/report.json
A qa/fixtures/local-host/evidence/desktop-5eeb57f8-8f3a-45d0-88af-ca5197934dcf/report.json
A qa/fixtures/local-host/evidence/desktop-65a2a150-26b7-4d9b-90b4-f3fb52c3e78e/report.json
A qa/fixtures/local-host/evidence/desktop-80fbfa7b-f3eb-406a-ae5c-7fb2b1f6147e/report.json
A qa/fixtures/local-host/evidence/desktop-843b74f9-0557-4168-9146-30136b35a685/report.json
A qa/fixtures/local-host/evidence/desktop-c2c184d4-de36-4e70-a209-67def260599d/report.json
A qa/fixtures/local-host/evidence/desktop-cbde33a4-f25e-4bd6-95f1-a3826c35d560/report.json
A qa/fixtures/local-host/evidence/desktop-ed89c186-57e7-437e-b565-e1f55bc0f301/report.json
A qa/fixtures/local-host/evidence/eb30717f-52b5-482f-920c-aba3bb705145/report.json
A qa/fixtures/local-host/evidence/external-linux-preview5-copy-20261115.json
A qa/fixtures/local-host/evidence/main-link-41201139-a0b3-4fb2-a831-cda9f8343277/report.json
A qa/fixtures/local-host/evidence/main-link-ef2f7ec4-4560-48d7-b33e-a8ae5c1214dd/report.json
A qa/fixtures/local-host/evidence/package-134f1015-e21b-4dff-bb5b-af506121247a/report.json
A qa/fixtures/local-host/evidence/package-3479a006-70ef-4adc-a531-548906fb06aa/report.json
A qa/fixtures/local-host/evidence/package-61a6d1fd-358d-41c6-a774-79ee1234eb3a/report.json
A qa/fixtures/local-host/evidence/package-7c3a1eac-525f-4d9c-99c1-6092f290d56d/report.json
A qa/fixtures/local-host/evidence/package-a34e4be8-201e-4e93-834b-889e17644401/report.json
A qa/fixtures/local-host/evidence/package-a34e4be8-201e-4e93-834b-889e17644401/resolved-files.json
A qa/fixtures/local-host/evidence/package-af4bddb8-b228-466f-ba97-b4a6a05b5900/report.json
A qa/fixtures/local-host/evidence/package-audit-b68ef107-030d-4fc5-a320-19bddba71c2d/report.json
A qa/fixtures/local-host/evidence/package-c28c0dbb-32e2-49f2-8532-f2acab2f25c1/failed-attempt-cleanup.json
A qa/fixtures/local-host/evidence/package-c28c0dbb-32e2-49f2-8532-f2acab2f25c1/report.json
A qa/fixtures/local-host/evidence/package-f62fc6b0-aaac-44f4-b2f3-0e18835da3dc/report.json
A qa/fixtures/local-host/evidence/production-resolution-linux-r2-20261114-1852.json
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/01-start-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/02-local-host-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/02b-local-host-sources-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/03-model-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/04-qq-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/05-local-host-980x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2034/README.md
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/01-start-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/02-local-host-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/02b-local-host-sources-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/03-model-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/04-qq-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/05-local-host-980x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/README.md
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/01-qq-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/01b-qq-host-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/02-asr-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/03-tts-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/04-plugins-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/04b-plugins-internal-1280x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/05-qq-980x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/06-plugins-980x900.png
A qa/fixtures/local-host/evidence/ui-redesign-20261115-2236/README.md
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/01-qq-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/01b-qq-host-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/02-asr-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/03-tts-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/04-plugins-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/04b-plugins-internal-1280x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/05-qq-980x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/06-plugins-980x900.png
A qa/fixtures/local-host/evidence/ui-round2-20261115-2227/README.md
```

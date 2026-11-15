# 最终全项目质量验收报告（Root whole-project quality gate）

## 当前交付：preview.6 增量验收

原始六门禁的精确执行记录保留在下文；它们之后的 UI 授权入口和停止回应排序修复，由受影响测试与实际新包验收补齐，没有假称旧全矩阵针对过后来的改动。

- 三来源共享授权 UI：桌面1128项、相关单元50项、真实DOM25项通过；同tick新boot接受后旧mutation不得覆盖的回归有反向mutation证据。
- 停止排序修复：本地宿主37项与内核218项、桌面1128项通过；最后移除无用catch后本地宿主37项再次通过。详见 [stop ordering](g6-stop-review.md)。
- 独立Linux preview.6 实际生产GUI **首次6/6通过、无retry**，三来源授权使用真实DOM按钮，含GUI退出后pong、同boot/key重附着与离线停止；cleanup全部true。见 [实际报告](../../../../qa/fixtures/local-host/evidence/desktop-ed89c186-57e7-437e-b565-e1f55bc0f301/report.json)。
- prepared-image Docker opt-in全部18个目标已实际通过，保留最初17/18失败及测试辅助函数修正历史，未放宽生产记录安全检查。见 [Docker补充](quality-docker-optin.md)。
- Parent对最终源码再次执行 **Root `pnpm typecheck`、`pnpm lint`、`pnpm format:check`全部exit0**；job `bash-4f9a1e79f25840ec`，日志/退出码/`result.json`在 `.cache/checklogs/final-preview6-parent/`，三项的总结果为 `passed:true`。未重复无新变化的后端大矩阵。
- 新Linux/Windows包都在临时副本完成完整构建，源快照一致为 `b9d7d276366429da83d3ccd85600b042a6ac6f61f79005044a9b5ded27198e82`，不替换Root依赖。WindowsZIP已由Parent独立核对SHA256、CRC、单顶层目录、零不安全路径/符号链接及Windows入口；详见 [G7](g7-package.md)。
- 4121已备份冷迁移并最终由Parent托管重启，同Agent/epoch且零消息任务，仍为scripted预览；详见 [服务交接](service-handoff.md)。Windows设备与真实账号/付费模型试验仍属于后续用户动作。

## 原始六门禁执行快照（2026-11-15 03:30–03:38）

> **状态：QUALITY ALL PASS** —— implement.md:82–93 六 gate 全绿，exit 全 0。
> 子 agent `trellis-check`，QUALITYGO 由 Parent 于 2026-11-15T03:28 明确下发后执行；时间 2026-11-15T03:30–03:38+08:00。
> 本报告为本 scope **唯一最终报告**；引用 [quality-static.md](quality-static.md) 的第一/二轮静态预检与窄修复阶段（旧数字保留作复核基线），**不覆盖审批快照 hash**。凭此向 Root 申请 SERVICEGO 恢复 4121 preview；本报告**不声称服务已启、不称产品功能完成**。

## 1. 结论先行

在冻结 source 上真实执行六 gate，顺序 **types → tests → QA → lint/format → build**（build 改插件 dist，故最后），**六条 exit 全 0，零失败、零需回 Root 的最窄 fix**。所有 6 个 background job 已逐一 collect、无遗留。无 install / commit / push / paid / liveQQ / 原 4120 / Snow 改动；未改任何 source、G3 文件、测试、配置；未加 timeout、未加 weak assert、未弱化测试。

## 2. 执行依据与前置

- Parent QUALITYGO：Windows packager FINALPACKAGE DONE（build/audit/zip exit 0、source snapshot == currentRoot、Root 模块/锁未改、所有 G3/history 源码 writer 冻结）；G3 最后 5/5、model controller 20/20、types/lint/format 0 已独立通过。本轮无其它 Native/GUI/Root 源码写、不抢 Windows zip CPU。
- 覆盖 implement.md:82–93 全部 gate；Root build 在**全部 tests 收齐后**为明确授权。
- Root `package.json` 六脚本执行前后各核对一次、**未变**：`typecheck=pnpm -r typecheck`、`test=pnpm -r test`、`test:qa=node --test --test-reporter=spec qa/probes/*.test.mjs`、`lint=eslint .`、`format:check=prettier --check .`、`build=pnpm companion:build && pnpm --filter @pet/desktop build`。**未永久改 package.json**。
- 环境：Node **v26.13.0** / pnpm **11.24.0**。基线（03:30）：git status **62 M / 8 D / 39 ??**、`git diff --name-only HEAD` **70** 行、审批 5 SHA 固定、4121 无监听。

## 3. 六 gate 逐条真实结果

全量日志与退出码落盘 `/tmp/trellis-quality-final/`（`01`–`06` 各自 `.log` + `.exit`，`00-approval-sha.txt`）。每条 `tee` 保存完整日志；job_output 视图对 Gate 2 截断 57587 B，但落盘 `02-test.log` 完整（108085 B），counts 从完整日志解析。

| Gate | 命令 | exit | 时间 / duration | jobID | log | 结果 / counts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pnpm typecheck` = `pnpm -r typecheck` | **0** | 03:30:00–03:31:17（77s） | `bash-38b234862f0545a5` | `01-typecheck.log` | `Scope: 44 of 45 workspace projects`，44 全 `Done`、0 error；含 3 个新包 `packages/local-host`、`plugins/local-agent-link`、`plugins/local-host-bridge` 及 `apps/companion-service`、`apps/desktop` |
| 2 | `pnpm -r --workspace-concurrency=1 test` | **0** | 03:31:33–03:35:29（236s） | `bash-3459f1eb9c2a4d5d` | `02-test.log` | 44 workspace command blocks 全跑、不 skip、0 fail；vitest **2782 passed / 270 test files** + node --test **477 tests / 463 pass / 14 skipped / 0 fail** → 合计 **3245 passed**；15 个 workspace `No test files found`（`--passWithNoTests`，exit 0，非跳过用例）。最长 `apps/companion-service` **150.02s**（G3 `qq-local-host.test.ts` 5/5 全过：真实 auth / native 文件字节 / context-only notice / 目标 receipt / wrong-bearer）、`apps/desktop` **20.60s**（120 files / 1120 tests） |
| 3 | `pnpm test:qa` | **0** | 03:36:20–03:36:40（20s） | `bash-4b92291fd563467c` | `03-test-qa.log` | **182 tests / 178 pass / 0 fail / 4 skipped / 15 suites / duration 18835.506065ms** |
| 4 | `pnpm lint` = `eslint .` | **0** | 03:37:18–03:37:41（23s） | `bash-c53544bce2c04f98` | `04-lint.log` | 0 error / 0 warning（成功时 eslint 无输出） |
| 5 | `pnpm format:check` = `prettier --check .` | **0** | 03:37:18–03:37:44（26s） | `bash-78d344c1a4784237` | `05-format-check.log` | `All matched files use Prettier code style!`，0 文件命中 |
| 6 | `pnpm build` | **0** | 03:38:00–03:38:10（10s） | `bash-ce60a5856fd04df4` | `06-build.log` | `pnpm companion:build`（esbuild 产出 fresh `dist/migrate.mjs`、`dist/main.mjs` + 14 插件 dist）+ `pnpm --filter @pet/desktop build`（Vite 8.3.5：pet 86 modules / console 161 modules，均 `✓ built`）。**dist mtimes 由 `11-13 14:31:15` 刷新为 `11-15 03:38:05`**，证明预检发现的陈旧 dist 已被重建。一条**非致命 advisory**：console chunk `503.23 kB > 500 kB` Vite chunk-size 提示（建议 code-split），无 error、exit 仍 0 |

### 命令选择原因（如实记录）

Gate 2 用 `pnpm -r --workspace-concurrency=1 test` 而非 `pnpm -r test`：**单序**降低 native/CPU 资源竞争；`-r` 仍覆盖全部 44 个带 `test` 脚本的 workspace，与 `pnpm -r test` **完全相同、不 skip**，脚本内容零改动、不永久改 `package.json`。Gates 4/5 为纯只读、彼此独立，故并行但各自独立 log/exit；Gate 6 严格等前五条全部 collect 后才启动。

### skip 真实原因（已核源码，非弱化、非本次引入）

- **Gate 2 的 14 条**：`plugins/cloud-exec/tests/docker.test.mjs:15` 与 `materials-docker.test.mjs:11` 的 `const enabled = process.env['PET_CLOUD_EXEC_DOCKER_TEST'] === '1'; test(name, { skip: !enabled, ... })`；`fixtures.mjs:10-13` 另要求 `PET_CLOUD_EXEC_IMAGE` 为**已安装**的 Node 镜像且「tests never pull images」。即 docs/35 与 implement.md:95 的**显式 opt-in 真实 Docker 套件**（SIGKILL reconcile / 真实容器执行 / 二进制材料等），本次 QUALITYGO 不含真实容器/native 执行，故按既有设计 skip；同包其余 22+30 条非 Docker 用例全过。
- **Gate 3 的 4 条**：`qa/probes/companion-service.test.mjs:154` 与 `companion-service-recovery.test.mjs:343/454` 的 `skip: !process.env.PET_CLOUD_EXEC_IMAGE`（`SIGKILL … exited/running execution without replay`、`HTTP input B … Docker work runs`、`cloud work continues across text activity and reconnect`）。
- 合计 **18 skip**，全部为既有 `PET_CLOUD_EXEC_*` env 门控的 opt-in 真实 Docker 用例；本轮**未设置这些 env、未加 timeout、未改断言、未弱化任何测试**。

## 4. 与既有静态阶段的关系

- [quality-static.md](quality-static.md)（本 scope 同目录）：第一轮 read-only whole-project 静态预检（typecheck 绿、lint 19 errors / format 8 files，全部归因本 task 新 untracked 文件）与第二轮 7 文件窄静态修复（owned eslint/prettier 0、37 窄单测、纯 prettier 字节级证明、剩余 G3 lint 路径交 owner）。其 §0 记录的「Root 全量待 G3 后重验」在本报告被**真实全量 Root 六 gate 复核通过**取代为最终态；旧数字与 checkpoint 保留作可复核基线，不覆盖、不重写。
- 审批快照 5 个 SHA256 实测与 `task.json` `reviewedArtifactsSha256` 逐项一致（前 16 位 `2d9a9b0d… / db068f8f… / d8676fd9… / 04b6f494… / 3e238eaf…`），本轮未改 prd/design/implement/implement.jsonl/check.jsonl；`task.json` 的 `reasoningEffort:max` 与 DeepSeek/Hy4 偏好未改。

## 5. 边界核对 / no-jobs & 资源 cleanup 说明

- **jobs**：6 个 background job 全部 `completed` 且逐一 `job_output` collect；`job_list` 复核 6 条全 completed、**0 running**、无遗留 job / 后台进程。
- **资源 / cleanup**：本轮除六条门禁命令外，检查 agent **未额外启动**服务 / GUI / 容器，也**未额外创建或删除**测试根、未执行 testrootcleanup 删除；**脚本内** fixture 资源（G3/G5 等的 controlled HTTP/WS/child，以及部分 codec 可能涉及的容器）按其各自测试 cleanup 处理，因此不把「本 agent 未直接调用 docker/native 命令」等同于「测试脚本完全无 native」。已确认 6 命令 exit 0，且无额外独立 job 残留。`pnpm test:qa` 日志中的 `Retained isolated profile: /tmp/companion-recovery-*` 是 QA fixture 自身设计的保留行为，未由本 agent 清理或修改。4121 仍**无监听**、旧 preview 未提前动。
- `pnpm build` 刷新 dist 是授权的最终 gate（会改插件 dist，故最后）；执行前后 git status 均 **62 M / 8 D / 39 ??**、`git diff --name-only HEAD` 均 **70** 行 → **无 tracked source 变化**；Root `package.json` 六脚本未变；审批 hash 未变。
- 无 install、commit / push / publish、paid model、live QQ、原 4120 数据、Snow/AstrBot 账号改动；未碰 G3 文件、未趁中间态改他人文件、未加 timeout / weak assert / 测试弱化、未跳过任何非 opt-in 用例。

## 6. 结论与后续

**QUALITY ALL PASS**：implement.md:82–93 的全部 gate 在冻结 source 上真实执行且 exit 0，未发现需回 Root 的最窄 fix，无失败文件。据此向 Root 申请 **SERVICEGO** 恢复 4121 preview（按 [service-handoff.md](service-handoff.md) 的 PREFLIGHT 预案，仍待明确 GO 才执行）。

不完结项（不属本报告结论，不在本轮动作）：Windows 设备/账号联合验收与真实 QQ / 付费模型试属后续显式范围；Linux 证据不等于 Windows 设备验收；产品功能完成度由各 G0–G7 evidence 分别记录。

---

### 文末记录

- **时间**：2026-11-15T03:30:00–03:38:37+08:00（基线 03:30:00，六 gate 03:30:00–03:38:10，最终核对 03:38:37）。
- **命令（按顺序）**：`pnpm typecheck` → `pnpm -r --workspace-concurrency=1 test` → `pnpm test:qa` → `pnpm lint` ∥ `pnpm format:check` → `pnpm build`；辅助只读 `node -v`、`pnpm -v`、`git status --porcelain=v1`、`git diff --name-only HEAD | wc -l`、`sha256sum <5 approval artifacts>`、`read package.json`、`grep skip 门控源码`、`stat dist mtimes`、`ss -ltnpH 'sport = :4121'`、`job_list`、各 `job_output`。
- **exit**：`01-typecheck=0`、`02-test=0`、`03-test-qa=0`、`04-lint=0`、`05-format-check=0`、`06-build=0`（全部 `.exit` 落盘）。
- **counts**：typecheck 44/45 projects；tests vitest 2782 passed/270 files + node --test 463 pass/14 skip，合计 3245 passed；test:qa 178 pass/4 skip/182 total；lint/format 0 error/0 warn；build 2 renderers built + dist 刷新。18 skip 全为 opt-in Docker env 门控。
- **failed files**：**无**（六 gate 全 0）。
- **完整日志**：`/tmp/trellis-quality-final/01-typecheck.log`(4421B)、`02-test.log`(108085B)、`03-test-qa.log`(14879B)、`04-lint.log`(11B)、`05-format-check.log`(87B)、`06-build.log`(1484B)，及各自 `.exit`、`00-approval-sha.txt`。
- **不能归因 / 不下结论的部分**：18 个 opt-in Docker skip 未在本次运行（既有 env 门控，未验证真实容器路径；后续由另一 max 子 agent 用 prepared image 单独补跑，不在本全矩阵内）；Vite 503.23 kB chunk advisory 未处理（非 error、未授权改构建配置）；Windows 设备/账号联合验收与真实 QQ/付费模型试不在本轮；**截至本报告 03:38 时刻** 4121 preview 恢复未执行、对「迁移后/启动后」状态零断言——后续 SERVICEGO 的实际迁移/启动/健康结果见 [service-handoff.md](service-handoff.md)，不在本文档重复；本静态/构建门禁不替代各 G0–G7 功能 evidence 的结论。

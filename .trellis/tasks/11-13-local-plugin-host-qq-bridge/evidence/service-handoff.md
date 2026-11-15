# 4121 session-owned test-service 交接 — ACTUAL 迁移 / 启动 / 健康结果

> **当前：SERVICE READY —— 最终代码由父会话 job `bash-220cc404c8874b47` 托管，PID3428075；127.0.0.1:4121，scripted，原Agent/epoch保留，零消息/任务。服务有意持续运行。**
>
> 最终部署时，Parent先核对旧进程的PID、exe、cwd与creation ticks，以及认证snapshot零消息/任务，再明确停止旧父会话job并从同一format4数据根启动最终源码。未再次迁移或建立新Agent。无鉴权GET401；认证snapshot/QQ状态与设置/plugins读取全部通过，QQ来源仍关闭、平台密钥不可用。实际新进程与私有日志位置单处记录在ignored operator目录的 `handoff-current.json`；`service-current.log`为0600，不作为交付文件。
>
> 初次子会话job `bash-b08810e878de46e8`/PID3235376后来退出，其原因未被日志证实；后由父会话job `bash-e6c0023c7eb442e1`/PID3248081稳定托管，再按上述身份/空闲检查做最终部署重启。下文06:35–06:42表格保留为**首次迁移与启动的历史快照**，其中旧PID不是当前进程。
> 子 agent `trellis-check`。PREFLIGHT 于 2026-11-15T02:29–02:38+08:00；SERVICEGO 实际执行于 2026-11-15T06:35–06:42+08:00。
> **本文件为 4121 交接的唯一维护点（单处维护）**：从 PREFLIGHT 更新为本次 ACTUAL 结果；原预检历史压缩为 §4 简短引用，不另开文档、不覆盖审批快照 hash。
> 只改 docs（含 planning 相对链接修正）与非 secret 新状态 JSON；**未改产品 source / data / code / 包 SHA / 审批 hash / Root lock / dist / package.json**。原 4120 与 Snow/AstrBot 一律未动。私有文件不 present 为交付、token 值不输出。

---

## 1. 授权与范围（planning 相对链接已修正并核 target）

- [implement.md:9](../implement.md#L9)：开发前「stop only the owned empty4121 development instance after checking its recorded PID/identity; retain its isolated data. Do not touch original4120 or the existing SnowLuma/AstrBot container.」
- [design.md:135](../design.md#L135)：「Stop only the owned empty4121 development instance when implementation would invalidate its loaded artifacts; use fresh isolated roots for every State/bridge migration test.」
- [progress.md](../progress.md)：当前交付与已恢复服务的状态由母记录维护。
- [task.json](../task.json)：原审批与最终受控验收状态；`execution.ownedIdle4121PreviewStopped` 当前为false，`original4120OrSnowLumaChanged` 仍为false。
- [design.md §6](../design.md#L94)：State 私有契约为「explicit stopped full-root format3→4 migration」，保留 legacy IDs/fingerprints/receipts。
- [implement.md:99](../implement.md#L99)：State4 回滚是「stopped full-root restore to an independent reviewed backup」，不做 in-place 降级或重放。
- QUALITYGO 全六 gate pass 与 fresh dist 见 [quality-final.md](quality-final.md)（其 §5 表述已按 Parent 指示做真实性修正）。

> **链接修正说明**：本文件位于 `…/11-13-local-plugin-host-qq-bridge/evidence/`，原 §1 六处 `../../implement.md` 等实际指向 `.trellis/tasks/implement.md`（不存在）；已改为 `../implement.md` 等，并用 glob 核实 `../implement.md`、`../design.md`、`../progress.md`、`../task.json` 四个 target 均存在。文内 `../../../../…`（仓库根相对源码/QA 链接）为 4 级上溯，正确，保留。

**范围红线**：原 4120 数据根无任何记录标识，**不猜、不动**；只识别并使用 owned 4121 预览的原 isolated root。

## 2. 本次 ACTUAL 执行（SERVICEGO，06:35–06:42）

### 2.1 前置重核（06:35:43，`00-precheck.log`，exit 0）

| 项 | 实测 |
| --- | --- |
| Node / pnpm | v26.13.0 / 11.24.0 |
| 原 isolated root | `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/manual-qq-test/agent-data`（`drwx------ kingBZ:kingBZ`，**路径未换**） |
| DB（readOnly） | `PRAGMA user_version=3`；`messages/tasks/qq_deliveries/facts/artifacts/input_admissions/materials/qq_judgments/conversation_observations` **全 0**；`assistantId=e30ad5b4-ba87-42b4-882d-2891def7a9bf`、`epoch=0a3072be-4911-48bb-9775-26936fae38fe`、`memoryRevision=0` |
| 迁移前全根 inventory | 46 entries / 22 files，逐文件 SHA256+size，存 `/tmp/trellis-servicego/pre.json` |
| 端口 / 旧 PID | `ss -ltnpH 'sport = :4121'` 无监听；旧 `service.pid=2577688` 的 `/proc` 不存在 |
| 私有文件 | `run-service.mjs`、`operator-token`、`service.pid` 均 `0600 kingBZ:kingBZ`；token 仅 stat 权限、内容未读 |
| fresh dist | `apps/companion-service/dist/{migrate,main}.mjs` mtime = **2026-11-15 03:38:05**（QUALITYGO `pnpm build` 产出，非陈旧） |
| 新 backupDirectory | `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/manual-qq-test-backup-format3-20261114T223543Z`（UTC stamp `20261114T223543Z`）：**绝对 / 不存在 / `nested(root,backup)=false` 且 `nested(backup,root)=false` / 父 `.cache` own UID=1000 kingBZ** |

### 2.2 TSX runner 首次失败 + 零部分状态证明（**与最终迁移成功明确分清**）

- **失败（06:36:35，`01-migrate.log`，exit 1）**：`node /tmp/trellis-servicego/migrate.mjs`（plain node）在模块解析阶段即 `ERR_MODULE_NOT_FOUND: packages/host-kernel/src/credentials/index.js imported from packages/host-kernel/src/index.ts`。原因：`dist/migrate.mjs` 以 `packages:'external'` 打包，外部 `@pet/*` 需经 `src/*.ts`（`.js`→`.ts` 说明符），**需 tsx loader**（与 Parent 确认的启动命令、QA `migrate-child.mjs` 的 `register()` 一致）。**失败发生在任何 migrate 代码执行前，属 runner 问题，不是迁移 error、未吞异常。**
- **零部分状态证明（06:37:09）**：`user_version` 仍 **3**、messages/tasks=0、全根 inventory(46/22) 与 `pre.json` **逐字节一致**、backup 目录仍**不存在**、`state/` 无 journal/WAL、`post.json` 未生成。
- **最窄修正**：仅同一脚本加 `node --import tsx`；**未改** migrate.mjs 逻辑/断言、dist、数据、package.json。Parent 已确认属正确最窄修、无需再审批。两次 `.exit`（1 与 0）与两份 log 均保留，不掩盖。

### 2.3 冷迁移成功（06:37:29，`01-migrate-tsx.log`，exit 0）

从刚 build 的 `apps/companion-service/dist/migrate.mjs` 调 `migrateCompanionData({dataDirectory:<原 root>, backupDirectory:<新 backup>})`；脚本严格断言、**不吞 error、不重建身份、不新 root、不假 seed**。实测（`post.json`）：

| 断言 | 结果 |
| --- | --- |
| `fromVersion → toVersion` | **3 → 4** |
| `agentId` / `epoch` | `e30ad5b4-…9bf` / `0a3072be-…8fe` **与预检 DB 完全一致** |
| `memoryRevision` | 0（保留） |
| `rootUserVersion` / `backupUserVersion` | **4 / 3** |
| 迁移后 root `messages/tasks/qq_deliveries` | **0 / 0 / 0** |
| `backupDirectory` | `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.cache/manual-qq-test-backup-format3-20261114T223543Z` |
| **backup 全根字节** | 46 entries / 22 files，`backupBytesMatchPreInventory=true`（逐文件 SHA256+size 与迁移前 inventory 相同） |

`migrateCompanionData` 自身先做全根逐字节校验备份、再事务内升级、失败整体回滚；保留 legacy IDs/fingerprints/receipts，不重放历史 IO。

### 2.4 首次 Managed 启动（06:37:52，历史快照；当前进程见文首）

- 命令：`node --import tsx .cache/manual-qq-test/run-service.mjs`（cwd 仓库根，`exec`，managed background）。
- **SERVICE JOBID：`bash-b08810e878de46e8`，状态 `running`，按 Parent 要求保留、不为清理停止**，供 Root 最终独立 GET 验收。
- 启动日志：`Companion text service: http://127.0.0.1:4121` / `Mode: scripted; model connection: not applied; model foreground: disabled`。
- host **127.0.0.1** / port **4121** / 原 isolated root **路径不换**；token 仅由原 `0600` 私有文件读入 env、**不打印**（精确比对真实 64B token 值，全部新 doc/JSON/log 均 `clean`）。
- 未运行 withdrawn `provision-onebot.mjs`、未发任何 POST、未调 real model / QQ / native。

**运行身份（不只裸 PID）**：

| 字段 | 实测 |
| --- | --- |
| newPID | **3235376**（由 `run-service.mjs` 自己写回 `service.pid`，非本 agent 手填） |
| 进程 | `/proc/3235376` alive；`comm=node-MainThread`、`stat=Ssl`、`lstart=Sun Nov 15 06:37:51 2026` |
| exe | `/home/kingBZ/.nvm/versions/node/v26.13.0/bin/node` |
| cwd | `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet` |
| port 绑定 | `LISTEN 127.0.0.1:4121 … users:(("node-MainThread",pid=3235376,fd=22))` |
| root | `.cache/manual-qq-test/agent-data`（现 format 4） |
| 未打印 | argv / environ / token（仅 `ps -o pid,ppid,comm,stat,lstart` + `readlink /proc/PID/exe|cwd`） |

> 启动后对 root DB 的 readOnly 重开返回 `database is locked` —— 这是 `PRAGMA locking_mode=EXCLUSIVE` 下**运行服务独占写锁**的预期表现，也是「服务确实持有该 root」的正面证据；**未用 busy_timeout 绕过、未停服务**。format 4 / 0 内容的事实已由 §2.3 `post.json` 与认证的 `/api/snapshot` 共同证明。

### 2.5 认证 GET-only 健康验收（06:40:04–05，`02-health.log`，exit 0，`health.json`）

| 检查 | 结果 |
| --- | --- |
| `GET /api/snapshot` 无鉴权 | **401** |
| `GET /api/snapshot` 带 `Authorization` | **200 / ok**，`agent.status=ready`、`agent.mode=scripted`、`agent.id=e30ad5b4-…9bf`（身份未变）、`messages=0`、`tasks=0`、`facts=0` |
| `GET /api/qq/status` | **200**，official + onebot 两源 `desiredEnabled=false`、`source/phase=disabled`、`hasCredentialField=false` |
| `GET /api/qq`（完整 QQView） | **200**，onebot `credential.available=false`、`credential.source=none` |
| `GET /api/plugins` | **200 / ok** |
| `allPass` | **true**（5/5） |

**契约注意（首次自测误读，已按契约修正，非服务 bug）**：`/api/qq/status` 返回 `QQStatus=Pick`，**按契约不含 `credential` 字段**；credential availability 必须读 `GET /api/qq` 的完整 `QQView`（`ingressView`）。首次 health（06:39:00，exit 1）误在 status 投影上断言 `credential` key 而失败；已用 `qq-http.ts:50-55` 与 `/api/qq` 实测形状纠正断言（**未弱化**：保留 status 的 disabled 投影断言，另加 `/api/qq` 的 `credential.available=false` 断言）。Parent 独立只 GET 验收亦通过并确认此契约点；**不改 API**。

### 2.6 预期运行 / jobs / 资源说明

- **保留运行中的服务 job** `bash-b08810e878de46e8`（`running`），**不停止**；`job_list` 复核仅此 1 条 running。
- 其它临时 jobs `bash-763c966b85f64b72`（迁移 runner 失败，completed exit 1）与 `bash-04d518e6754f42e8`（tsx 重跑，completed exit 0）**均已 collect**；precheck / 零状态证明 / health 为前台命令，输出均已收；无遗留临时 job。
- 本轮未额外启动服务 / GUI / 容器，未创建或删除测试根、未做 testrootcleanup 删除；除授权的服务进程外无资源需回收。原 4120 / Snow / Astrbot 未动。

### 2.7 私有运行新状态（非 secret JSON，不覆盖历史）

- 新建 `.cache/manual-qq-test/handoff-current.json`：含 phase / serviceUrl / host / port / `intentionalRunning=true` / `serviceJobId` / `newPid` / `processIdentity{comm,exe,cwd,lstart,portBinding}` / `isolatedDataRoot` / `agent{id,epoch,mode,status,messages,tasks,facts}` / `migration{fromVersion,toVersion,backup…}` / `health` / `constraints` / 历史证据 SHA 前缀。**无 token 值、无 env、无 argv**。
- 旧历史证据 `.cache/manual-qq-test/handoff.json` 与 `ops-state.json` **SHA 未变**（前缀 `451ac611e258dfff4a1eb143`），其 `tokenPrinted` 等历史字段未覆盖；新 PID 由脚本自己写回 `service.pid`。
- 私有文件**不 present** 为交付。

## 3. 文档真实性修正（仅 docs，不影响已执行结果）

- [quality-final.md](quality-final.md) §5「无资源」过宽表述按 Parent 指示改为：检查 agent 未在六条门禁命令之外额外启动服务/GUI/容器，脚本内 fixture 资源按其各自测试 cleanup 处理，**不把「agent 未直接调 docker/native」等同「测试脚本完全无 native」**；已确认 6 命令 exit 0、无额外独立 job 残留。18 个 opt-in Docker skip 按当时实际保留，注明由另一 max 子 agent 用 prepared image 单独补跑（不重跑本全矩阵）。
- 同文件「4121 preview 恢复未执行」改为「**截至本报告 03:38 时刻**」，并指向本 ACTUAL 文档，避免与后续 SERVICEGO 矛盾、不重复细节。
- 本文件 §1 六处 `../../` planning 链接改为 `../` 并核实 target；`../../../../` 仓库根链接保留。
- `task.json` / `progress.md` 母记录由 Parent 最后统一更新，本 agent 不改。

## 4. 原 PREFLIGHT 历史（02:29–02:38，简短引用）

原预检（本文件上一版本）在**未启动/未迁移**前提下只读核实并得出：归属记录集位于 `.cache/manual-qq-test/`（`handoff.json`/`ops-state.json`/`service.pid`/`run-service.mjs`/`source-package.json`/`provision-onebot.mjs`(已撤回)/`agent-data/`/`operator-token`(仅 stat)）；`serviceUrl=http://127.0.0.1:4121`、`agentId=e30ad5b4-…9bf`、`mode=scripted`、`messages/tasks/deliveries=0/0/0`、onebot `desiredEnabled=false`/`credential.available=false`、`snowOriginalBytesRestored=true`、`containsCredentials=false`、基线源码 `commit=6897787 / source-not-installer`。
关键结论：root 为 **format 3**（`state.ts:110` 对 v1/2/3 抛 `not-ready`，不自动迁移）、当时 `dist/migrate.mjs` 陈旧（11-13 14:31 vs `src/migrate.ts` 11-14 07:51）、故必须 **format3→4 冷迁移**（`migrateCompanionData` 全根 verified backup，保留身份），「重建新 root」因会换身份而**非批准路径**。
当时列出的缺失 record：(a) 原 4120 路径（不猜）；(b) 原始启动命令 flags/cwd 无落盘记录（后由 Parent 按脚本/NodeNext 确认 `node --import tsx`）；(c) 停服 PID/identity 校验无落盘（本次 §2.4 已补 exe/cwd/port/lstart）；(d) backupDirectory 无记录（本次 §2.1 已新建并核实）；(e) `COMPANION_EXEC_IMAGE` 可用性未记（scripted 模式不依赖执行提供者）；(f) 旧 `handoff.json` 由已撤回脚本生成。
`dist` 陈旧问题已由 QUALITYGO `pnpm build`（03:38:05）解决；上述结论全部被 §2 的 ACTUAL 执行核实/取代，细节不再重复。

## 5. 边界核对

- 审批快照 5 个 SHA256 与 `task.json` 逐项一致（前缀 `2d9a9b0d… / db068f8f… / d8676fd9… / 04b6f494… / 3e238eaf…`），未改；`git status` 前后均 **62 M / 8 D / 39 ??**，无新增 tracked source 变化；Root `package.json` 六脚本未变；无新 Root build / install / git 操作。
- 未碰 G3 文件；未跑 GUI / Native business / model / paid / liveQQ / withdrawn provision / 任何 POST；原 4120 数据、Snow/AstrBot 账号连接未动；未读/输出 token 内容、env、完整 argv；未 present 私有文件。
- 另一 max 子 agent 用 prepared image 单独补跑 implement.md:95 的 18 条 opt-in Docker 测试，与本 agent 的 source/端口/数据不重叠；该子 agent 严禁全局 stopDocker；不影响本次启动授权。

---

### 文末记录

- **时间**：PREFLIGHT 02:29–02:38；SERVICEGO 实际 06:35:43（precheck）→ 06:36:35（runner 失败）→ 06:37:09（零状态证明）→ 06:37:29（迁移成功）→ 06:37:52（启动）→ 06:40:04（health）→ 06:42:31（最终核对）。
- **命令**：`node --input-type=module`（readOnly DB + inventory）、`stat`/`ss`/`ps`/`readlink`（仅 pid/exe/cwd/port，无 argv/env）、`node --import tsx /tmp/trellis-servicego/migrate.mjs`（从 `apps/companion-service/dist/migrate.mjs` 调 `migrateCompanionData`）、`node --import tsx .cache/manual-qq-test/run-service.mjs`（managed）、`node /tmp/trellis-servicego/health.mjs`（GET-only）、`sha256sum`/`git status`/`job_list`/`job_output`。
- **exit**：`01-migrate.exit=1`（runner 失败，保留）、`01-migrate-tsx.exit=0`、`02-health.exit=0`；首次 health `02-health.log` 被第二次成功运行覆盖前的值为 exit 1（契约字段误读，已在 §2.5 说明）。六 QUALITYGO gate 全 0 见 [quality-final.md](quality-final.md)。
- **failed files**：产品/数据/API **无失败**；两次「失败」均为本次检查脚本自身的 runner/断言形状问题，已各自用证据最窄修正并保留 log，未改服务或 API。
- **完整日志**：`/tmp/trellis-servicego/` → `00-precheck.log`、`pre.json`、`01-migrate.log`/`.exit=1`、`01-migrate-tsx.log`/`.exit=0`、`post.json`、`02-health.log`/`.exit=0`、`health.json`、`backup-path.txt`、`migrate.mjs`、`health.mjs`；服务运行日志见 job `bash-b08810e878de46e8`。
- **不能归因 / 不下结论**：原 4120 路径未知且不猜；18 条 opt-in Docker 测试未在本轮运行（另一子 agent 补跑）；root DB 运行中被独占锁，未强制重读（format 4 由 §2.3 与认证 snapshot 证明）；Windows 设备/账号联合验收与真实 QQ/付费模型试不在本轮；本交接不代表产品功能完成度结论，各 G0–G7 由各自 evidence 记录。**服务按授权持续运行，等待 Root 后续独立验收，不主动停止。**

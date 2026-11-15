# quality-docker-optin — 已有 prepared-worker-image Docker opt-in 补充验收

## 最终增量验收

**DOCKER OPTIN ALL PASS：14 个执行目标与 4 个恢复目标均已实际通过。** 初次运行的17/18及失败日志保留在下一节，不再作为未解决阻断。

Parent 复核了真实执行器的提交顺序：`executor.ts` 先等待包含 container ID 的 `saveRecord` 完成，再启动容器；`effect.txt` 由容器代码产生，因而只能在该检查点发布后出现。原 QA `effectRecord` 在等执行标记之前就轮询严格的记录读取，可能与发布检查点相遇。此次只把该测试辅助函数的等待顺序改为：找到唯一合法 job ID → 等真实 `effect.txt` 内容为 `once\n` → 原样调用严格 `readRecord` 和 `inspectOwned`。没有捕获或忽略 `unsafe-records`，没有修改生产记录的 nlink/UID/mode/内容校验，没有增加 timeout、重试或生产缓存。原失败瞬间的 nlink 值未被捕获，因此“旧文件描述符遇原子替换后 nlink=0”仍只是机制解释，不伪称当时的直接观测。

| 增量运行 | 实际结果 | 资源与范围 |
| --- | --- | --- |
| 原失败 running 场景，job `bash-35fa10f9d1814292` | 1/1 pass，exit0；case8745.80ms，runner9645.68ms | 原 SIGKILL/reconcile/once-only 断言全部执行，未跳过 |
| 4 个 Docker QA 目标合跑，job `bash-bba22996250f4e24` | 4/4 pass，0fail/0skip，exit0，22025.12ms | exited恢复7614.69ms；running恢复7064.32ms；HTTP input B6683.83ms；cloud-work/reconnect9865.15ms |
| Parent 收尾复核，job `bash-570676a4e9454605` | exit0 | `pet.cloud-exec.job` 容器剩余0；执行器 scratch为空；生产 records/executor 相对HEAD无改动；4121同Agent/epoch、ready/scripted、messages/tasks/facts均0 |

4目标合跑使用原本已准备的精确镜像，命令仍为带 `PET_CLOUD_EXEC_IMAGE` 的两份 QA 文件加原4名称过滤；未替换镜像、未拉取镜像、未触及 Snow/AstrBot。最初14执行目标（Node计数16含两个嵌套子测试）已全通过，未重复运行。测试新留下的隔离恢复目录按既有fixture约定保留，不做全局清理。

## 初次执行结果（失败历史，已由上述增量验收解决）

**当时17 / 18 PASS，1 FAIL；该次运行不能单独称为全部通过。**

- 14 个 cloud-exec Docker opt-in：`tests 16 / pass 16 / fail 0 / skipped 0`，退出码 0，20s（14 个顶层目标用例 + staging 用例的 2 个嵌套子测试）。
- 4 个 QA Docker opt-in：`tests 4 / pass 3 / fail 1 / skipped 0 / cancelled 0`，退出码 1，17s。**4 个目标全部真执行、无 skip**；过滤跳过与 env 门控已分别取证。
- 确切阻断：`SIGKILL service during Docker work reconciles running execution without replay` 在 `effectRecord` 轮询阶段抛出 `unsafe-records`。见下方「FAIL 实际栈与阶段」与「核故障前阶段」。
- 按指令：**未重跑、未增大 timeout、未削断言、未替换 image、未以既有 gate PASS 冒充**。本轮只报告 + 保留失败 root；未加 `catch unsafe-records`、未放宽 `nlink`、未用重试掩盖、未改任何源码。交由 Root 定点复现 / 最窄 fix。
- Parent 自行管理新 service job：我未 restart/kill 旧 preview、未改业务。

## 准备镜像（非 secret；只用本机已装镜像，未 pull）

`docker image inspect sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72`，退出码 0：

| 字段 | 值 |
| --- | --- |
| Id | `sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72` |
| RepoTags | `1panel/deepseek-harness:0.2.0-rc.2` |
| RepoDigests | `1panel/deepseek-harness@sha256:72c58e3b343cce588a05d0d107abb362f6b4c52eb313d54afe3a28ef4cef6d7f` |
| Architecture / Os | `amd64` / `linux` |
| Config.Env NODE_VERSION | `24.21.0` |
| Config.Volumes | `null`（满足 executor 的 `image inspect --format '{{.Id}}\n{{json .Config.Volumes}}'` 准入） |
| Size | `854156674` |

- Docker `27.0.3`；宿主 node `v26.13.0`（`process.features.typescript=strip`，cloud-exec 用仓库自身 build-free loader `tests/source-loader.mjs`）。
- **node worker 实测可用**：自建探针容器（`--name pet-docker-optin-nodeprobe-4ad45e183249-...`，`--label pet.docker-optin.owner=4ad45e183249`，`--network none`，`--entrypoint node <Id> -e ...`，CID `a36696bf0b1000ab4dfe9f4d18c57011405b41befa5baf1d1a2e4a5351a4b13c`）输出 `NODE_OK v24.21.0`，`start` 退出 0，随后 `docker rm` 该 CID（exit 0）。
- executor 只发 `docker image inspect` / `create` / `start` / `wait` / `stop` / `rm`（均针对自身 label + 全 ID 校验过的容器），**从不 pull**；`missing image reports unavailable without pulling or host execution` 用例也以 21ms 通过，印证无 pull。
- 未读 `operator-token`；未读任何容器 env/credentials。

## 实际命令、env 键、jobID

日志与 `.exit` 全部在 `/tmp/trellis-docker-optin-4ad45e183249/`。两个 background job 均已 `job_output` collect：`bash-22c3ebfdf5234fc1`、`bash-9f4b7d7c41ad4740`（均 completed，无遗留未收 job）。

| Job | 命令 | env 键 | 退出码 | 时长 |
| --- | --- | --- | --- | --- |
| A `bash-22c3ebfdf5234fc1` | `cd plugins/cloud-exec && node --import ./tests/source-loader.mjs --test --test-reporter=spec tests/docker.test.mjs tests/materials-docker.test.mjs` | `PET_CLOUD_EXEC_DOCKER_TEST=1`, `PET_CLOUD_EXEC_IMAGE=sha256:a9975a0d...17a72` | 0 | 20s |
| B `bash-9f4b7d7c41ad4740` | `node --test --test-reporter=spec --test-name-pattern='<exact 4 names>' qa/probes/companion-service.test.mjs qa/probes/companion-service-recovery.test.mjs` | `PET_CLOUD_EXEC_IMAGE=sha256:a9975a0d...17a72` | 1 | 17s |
| control（0 用例执行，仅取证门控） | 同上 name-pattern | `PET_CLOUD_EXEC_IMAGE` **故意 unset** | 0 | 0.74s |

仓库实际配置核对：cloud-exec 的 `test:docker` 用 `node --import ./tests/source-loader.mjs`（Node TS erasure，不需 build），并非 bare tsx；QA 由 `tsx/esm/api` 的 `register()` 自注册，根脚本 `test:qa` 亦无 `--import tsx`。故按仓库真实命令执行，未 build、未改源码。

QA 门控源码：`companion-service.test.mjs:154` `skip: !process.env.PET_CLOUD_EXEC_IMAGE`；`companion-service-recovery.test.mjs:35` `image = process.env.PET_CLOUD_EXEC_IMAGE`，`:343`/`:454` `skip: !image`。cloud-exec 门控：`docker.test.mjs:15,16` / `materials-docker.test.mjs:11,12` `PET_CLOUD_EXEC_DOCKER_TEST==='1'`，`fixtures.mjs:10-15` 要求 `PET_CLOUD_EXEC_IMAGE`（否则 throw，且 "tests never pull images"）。

## 14 个 cloud-exec 目标用例（全 PASS，真实 skip = 0）

`tests/docker.test.mjs` 11 个 + `tests/materials-docker.test.mjs` 3 个。runner 计 `tests 16` 是因 staging 用例含 2 个嵌套子测试。全部 ✔、无 `skipped`、无 `cancelled`。

| # | 用例 | 时长 |
| --- | --- | --- |
| 1 | real Docker reads text, executes code and retains a durable artifact | 601.36ms |
| 2 | cancel stops only its owned container while another task completes | 1593.84ms |
| 3 | timeout and nonzero exit preserve actual Docker status and bounded logs | 3608.30ms |
| 4 | generated symlink artifacts are refused after real container execution | 885.80ms |
| 5 | plugin disposal waits for actual running-container cleanup | 1542.95ms |
| 6 | SIGKILL then fresh executor reconcile stops the orphan without repeating its effect | 4028.93ms |
| 7 | reconcile preserves an exited-zero effect, verified artifacts and durable receipt across restarts | 2168.05ms |
| 8 | mismatched execution labels and hostile metadata refuse cleanup and block new work | 1946.68ms |
| 9 | paged receipts are idempotent and absent containers never authorize effect replay | 931.76ms |
| 10 | bounded recovery must visit every nonterminal record before admitting new execution | 2706.40ms |
| 11 | missing image reports unavailable without pulling or host execution | 21.31ms |
| 12 | host-private binary material reaches real Docker once with unchanged text and output budgets | 637.51ms |
| 13 | guessed execution ID cannot read bytes without matching the host ActiveWork task binding | 52.31ms |
| 14 | cancellation and configured timeout during staging join the reader and leave no binary or container | 1092.39ms（子测试 cancel 63.83ms / timeout 1027.26ms） |

## 4 个 QA 目标用例（3 PASS / 1 FAIL / 真实 skip = 0）

`--test-name-pattern` 精确锚定这 4 个名字（见 `20-qa4.pattern`）。**4 个全部被执行、无 skip**：

| # | 用例 | 结果 | 时长 |
| --- | --- | --- | --- |
| 1 | SIGKILL service during Docker work reconciles exited execution without replay | PASS | 7446.99ms |
| 2 | SIGKILL service during Docker work reconciles running execution without replay | **FAIL** | 2612.20ms |
| 3 | HTTP input B gets the next model permit while A retains its actual receipt and Docker work runs | PASS | 6766.88ms |
| 4 | cloud work continues across text activity and reconnect, with exact target cancellation | PASS | 9843.66ms |

**过滤跳过 vs env 门控（区别取证）**：control 以同一 pattern、故意 unset `PET_CLOUD_EXEC_IMAGE` → `tests 4 / pass 0 / skipped 4`，4 个目标都显示 `# SKIP`（`skip:!image` 的 env 门控），非目标用例根本不计数（被 `--test-name-pattern` 过滤）。正式 run 设了 env → 门控打开，同一 4 个用例真执行（`skipped 0`）。未重跑 Root 已通过的普通 178 QA。

### FAIL 实际栈与阶段

```
✖ SIGKILL service during Docker work reconciles running execution without replay (2612.196464ms)
  Error: unsafe-records
      at readRecord (/home/kingBZ/DeepSeek-WorkSpace/dsh-pet/plugins/cloud-exec/src/records.ts:123:13)
      at async Promise.all (index 0)
      at async file:///home/kingBZ/DeepSeek-WorkSpace/dsh-pet/qa/fixtures/companion-service/helpers.mjs:157:19
      at async until (file:///home/kingBZ/DeepSeek-WorkSpace/dsh-pet/qa/fixtures/companion-service/helpers.mjs:54:12)
      at async TestContext.<anonymous> (file:///home/kingBZ/DeepSeek-WorkSpace/dsh-pet/qa/probes/companion-service-recovery.test.mjs:376:18)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
```

- **阶段**：`companion-service-recovery.test.mjs:376` `record = await effectRecord(root);` —— 紧接 `first.post('/api/tasks', start)` 受理之后、**在任何 SIGKILL / reconcile 断言之前**；崩溃恢复断言根本未到达。
- **只读定位（未改代码，机制未证）**：`readRecord`（`records.ts:116-123`）在严格 stat 校验（`nlink!==1` / `uid!==getuid()` / `(mode&0o077)!==0` / `size>65536`）失败时抛 `unsafe-records`；`effectRecord` 经 `until`（`helpers.mjs:54`）调用，`until` 不吞该异常而是直接向外抛。Parent 已读 `records.ts:75-127`：写入端是 `wx` `0600` + `fsync` + **atomic rename**，不是普通半写；具体候选（**Parent 提供、非我证实**）是先 `open` 到旧 inode、随后 rename 覆盖使 `FD.stat().nlink=0`，从而命中 `info.nlink!==1`。生产 `DockerExecutor.reconcile`（`executor.ts:163+`）受 `#locked` 保护并跳过 `activeJobs`，与本次 QA `effectRecord` 轮询 live checkpoint 是不同路径，不能据此推断生产 reconcile 受影响。同文件 `exited` 变体在第 376 行相同代码路径上 7.4s 通过 → 表现为时序相关，**但不据此判定为「只是 flaky」而抹平**，作为确切阻断上报 Root。

## 核故障前阶段（失败 root 只读复核）

失败 profile `/tmp/companion-recovery-f9WEoA` 已保留，只读复核见 `32-prefailure-phase.txt`：

| 观察 | 值 |
| --- | --- |
| `service-3243971.log` | 存在，0 bytes（first 服务进程日志） |
| `state/state.sqlite` | 167936 bytes + `state.sqlite-journal` 41552 bytes（服务已起、任务已受理） |
| `configuration/*.config.json` | 多个（插件配置已写） |
| `jobs/<jobId>/code.mjs` | 355 bytes（工作区与代码已 stage） |
| `jobs/<jobId>/work/` | **空**：无 `effect.txt` / `ready` / `release`（容器尚未产出效果） |
| `.records/<jobId>.json` | 1133 bytes；`version=1`、`containerId=<64hex 已写>`、`result=null`、2 个 bind mounts、outputs `effect.txt`；事后 stat `mode=600 uid=1000 nlink=1`（合法） |

即故障前阶段为：服务启动 → 任务受理 → workspace/code stage → 记录首 checkpoint → `docker create` + `inspectOwned` 后**写入 containerID checkpoint（第二次 `saveRecord`）** → `docker start` 之前/当口；`effect.txt` 尚未出现、`result` 仍为 null。这与「两次 `saveRecord` 原子 rename 之间的读窗口」候选一致，但**不构成证明**。按 Parent 指令：未加 catch、未放宽 nlink、未重试掩盖、未改 records security guard；保留 root 供定点 QA 复现（必要时从 `effect.txt` barrier 入手让 read 在 containerID checkpoint 之后）。该失败 job 的容器在 `finally` 的 `cleanupContainers` 后已不存在（见下节容器清理）。

## owned containers / readers / processes / tmp 清理

- **容器 scope before/after（容器清理）**：before 仅 `346493a41f67 astrbot-snowluma`（`motricseven7/snowluma:v2.4.2`, Up 6 days）；after 仍仅此一个。所有 `pet-cloud-exec-<uuid>`（label `pet.cloud-exec.job`）与 node 探针容器均已由 fixture 的 `close`/`removed`/`cleanupContainers`（精确 label + 全 ID + mount 校验）回收；`docker ps -a --filter name=pet-` 为空。失败 job `c05a7bff-9402-4f58-b2fb-60ed0034bbc0` 还单独复查 `docker ps -a --filter label=pet.cloud-exec.job=<该 jobId>` → **空**，即失败用例同样未遗留容器。未执行任何全局 `docker stop/rm/prune/pull`，未停止已存在 Snow/AstrBot。
- **进程**：QA `subprocess` 为 `detached:true` 自有进程组，kill 仅 `process.kill(-child.pid,'SIGKILL')`，日志确认 PGID 为 `3243499 / 3243726 / 3243971`（均本次 fork，均 ≠ 4121 preview 的 PGID `3235376`）；三者已退出。cloud-exec `crashedJob` 用 `child.kill('SIGKILL')`（自有 spawn 的正 pid）与自有容器 ID 的 `docker stop/rm`。无 pkill/全局 kill。干净 `/proc` 扫描确认无遗留 `service-process.mjs` 子进程（此前 `pgrep` 命中是我校验脚本自身文本的自匹配）。
- **tmp**：cloud-exec `plugins/cloud-exec/.cache/` before 空、after 空（0 entries、0 `test-*` 残留），由 `fixtures.mjs` 的 `t.after`（realpath + parent + basename 校验后 `rm`）自清；未全局清任何已有 cache。QA 本次新增 4 个 `/tmp` 私有 profile（均 realpath 自等、parent=`/tmp`、前缀 `companion-recovery-*` / `companion-http-test-*`）：`/tmp/companion-recovery-TWBWfL`、`/tmp/companion-recovery-f9WEoA`、`/tmp/companion-recovery-TqL6uW`、`/tmp/companion-http-test-UmVt39`。fixture 明确 `Retained isolated profile`，故**按 fixture 实际行为保留**（尤其 `f9WEoA` 为失败运行的记录，留待 Root 排查），未删除；未触碰约 250 个先前存在的 `/tmp/companion-*` 根。

## 是否影响 source / preview（不改动任何业务数据）

- **准确界限（经 Parent 更正）**：4121 preview 是 `node --import tsx .cache/manual-qq-test/run-service.mjs` 导入**当前 Root 实时 src/main.ts**，并非旧 `.cache/handoff` 源码 ZIP；`CompanionPluginHost.permission` 的 `packageFingerprint` 实时哈希源码树，仅排除 `node_modules/.git/coverage`，**不排除 `plugins/cloud-exec/.cache`**。因此 14 个 direct-executor 用例运行期间创建的 `test-*` 临时根**确实临时改变了 cloud-exec 包的指纹**。不写「与 live source 无涉」，也不以「未找到代码」下否定结论。preview 当时（Parent 报文）为 scripted / 0msg / 0task / QQ disabled；**是否发生过权限/信任决策我无证据，不作该结论**。
- **恢复确认**：测试后 `plugins/cloud-exec/.cache/` 已空（文件集合恢复到 before 的空状态），`git status --porcelain -- plugins/cloud-exec/` 为空 → 我的运行未在该指纹包内留下任何源码改动；仓库内其余 M/D/?? 均为既有 G0–G7 实现改动，非本检查产生。诚实保留一点：`.cache` 目录 inode `1358997` 的 mtime 因临时建删变为 `06:47:47`；我**未**改 mtime、未改 fingerprint 规则、未改 Root source，由 Parent 的 re-GET 判定指纹是否完全复位。
- **未改业务数据**：未接 4121 任何业务 API，未停它，未改 `agent-data`，未碰真实 QQ / paid model（QA 用 `controlled-offline` fixture 控制 SSE、随机 loopback 端口 `serveText port ?? 0`、fresh private profile）。
- **须 Parent 知悉的状态**：终检（06:54:50 / 06:55:40）时 `service.pid` 仍为 `3235376`（mtime `06:37:52` 未变），但 **pid 3235376 已不存在、无 `run-service.mjs` 进程、无 4121 listener**；它在 06:46（仍存活）至 06:54 之间退出/被外部停止，未重启。上述 kill-scope 证据表明**非本测试运行所致**。Parent 自行管理新 service job，本检查未 restart/kill 旧 preview、未改业务。

## 日志清单（`/tmp/trellis-docker-optin-4ad45e183249/`）

`00-env.txt`、`01-image.txt`、`02-nodeprobe.*`、`03-containers.before.txt` / `03-cloudcache.before.txt` / `03-tmp.before.txt`、`10-cloud14.{cmd,log,exit,duration}`、`20-qa4.pattern` / `20-qa4-control-nogate.log`、`21-qa4.{cmd,log,exit,duration}`、`22-tmp-new.txt`、`23-containers.after.txt`、`30-final-verification.txt`、`31-preview-investigation.txt`、`32-prefailure-phase.txt`。

唯一产出文件即本 `evidence/quality-docker-optin.md`；未 spawn、未改产品/源码文件、未 commit/publish、未安装/构建；未 restart/kill 旧 preview、未改业务。

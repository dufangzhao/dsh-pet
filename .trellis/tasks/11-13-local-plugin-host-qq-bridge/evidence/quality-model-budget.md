# model-controller 历史预算用例超时根因 — 11-13-local-plugin-host-qq-bridge

> 子 agent `trellis-check` 定点诊断 + 方案 A 实施。诊断期临时 stage 计时已 `git checkout` 还原；最终改动只在本 test 文件与本文档。

## 结论先行

**超时在历史构造，不在最终 response / assert / teardown。**

`GET /api/snapshot` 真实边界只花 **123ms**；同一 fixture 构造历史花 **~23.0s**。20s 预算被构造吃光，final Result 预算本身健康。

根因不是 SQLite 写入，也不是本 case 的 100/24/8 内容压力，而是**每次 capability 调用固定重算全部插件包指纹**：
`authorize` → `isTrusted` → `host.fingerprint` → `packageFingerprint(插件目录)` 同步遍历并 SHA-256 读整个包（`plugins/state-sqlite` 含 1.7MB `dist`，单次 ≈6.4ms）。
一次 `runtime.state()` 触发 **3 次 authorize / 6 条 audit**，≈10.8 次包扫描，实测 **70–77ms/次**，与读/写、payload 大小无关。

**已实施（Parent 授权方案 A）**：历史构造移入本 case 专属 `describe` 的 `beforeAll`（budget **60_000ms**），final Result/snapshot 的 `it` 保留**原 20_000ms 与全部原断言**。**296 次真实 history 写入全部保留，只改变它们计时的边界**——不再计入 final Result/snapshot 的 20s。未加 timeout、未降内容压力、未弱化断言、未碰生产信任/缓存。

## 0. 实施结果（已验收）

`apps/companion-service/src/model-controller.test.ts`，`git diff --stat`：**1 file changed, 100 insertions(+), 83 deletions(-)**。

- 新增 `describe('final snapshot budget over retained history')`：typed captured fixture（`f` / `raw` / `maximum`）在 `beforeAll` 内用**真实 `createCompanionService` 完整 composition + 真实 State provider** 写入同一套 24 tasks / 24 facts / 100 messages（内容逐字不变），`beforeAll` budget `60_000`。
- `it(...)` 保留原 case 名、原 `20_000` budget，断言**逐字未改**：`JSON_MAX_BYTES` 上下界、`jsonPreflight(...).ok`、`facts` 全等、`projection` 三项 truncation、`messages.length < raw.messages.length`、`status === 200`、8 connectors / 2048-char URL / 全部 repeat 长度不变。
- `cleanups` drain 提为单处 `drainCleanups()`，`afterEach(drainCleanups)` 与 `describe` 的 `afterAll(drainCleanups)` 共用；`splice` 保证重复调用幂等、不重复 close。即使 case 被过滤或 beforeAll 失败，`afterAll` 仍真实 join HTTP server 与 runtime。
- 未使用 disabledPlugins、未 SQL seed、未 trust cache、未改全局 timeout、未改生产代码。

**验收（focused，单 case）**：

| 项 | 结果 |
| --- | --- |
| `vitest run src/model-controller.test.ts -t 'budgets real SQLite history once'` | **exit 0**，`1 passed | 19 skipped` |
| `it` 本体耗时 | **121–124ms**（真正 final snapshot 边界） |
| 总运行 | **24.60s**（setup/history ≈23s 在 beforeAll） |
| `tsc --noEmit -p apps/companion-service` | **0** |
| `eslint` 该文件 | **0** |
| `prettier --check` 该文件 | **All matched files use Prettier code style** |
| 资源 join | 本次运行后无新增 `/tmp/companion-model-http-*` 残留（现存 111 个均为 2026-11-08 及更早的旧目录，非本次产物） |

## 1. 实测阶段（真实 service + loopback HTTP，单跑该 case）

在 case 内加 monotonic stage 计时（`performance.now()`，无全局 monkeypatch、无 CPU profiler 采 stack），`afterEach` 打印后自然 20s 失败：

```
budget-stages {"setup":874,"tasks-facts":7995,"messages":23166,"rawSnapshot":23238}
```

| 阶段 | 累计 ms | 区间 ms | 说明 |
| --- | --- | --- | --- |
| `setup` | 874 | 874 | `createCompanionService` + loopback gateway |
| `tasks-facts` | 7995 | **7121** | 24×(`createTask`+`updateTask`+`memorySnapshot`+`rememberFact`)=96 次调用 |
| `messages` | 23166 | **15171** | 100×(`acceptMessage`+`updateInput`)=200 次调用 |
| `rawSnapshot` | 23238 | **72** | 一次真实 `state('snapshot')` |
| 最终 `GET /api/snapshot` | — | **123** | 独立探针实测（见 §2） |

296 次 capability 调用 ≈ 22.3s，占 20s 预算的 111%；**final Result/snapshot 边界仅 0.12s（0.6%）**。

复跑同 case 的探针，把最终边界也纳入计时（真实 service，非 vitest）：

```
{"marks":{"tasks-facts":7443,"messages":22929,"rawSnapshot":23007,"maximum":23017,"httpSnapshot":23140},
 "httpSnapshotMs":123,"status":200,"bytes":58235,"rawBytes":58203}
```

`httpSnapshot` 从 23017 → 23140，**最终 `/api/snapshot` 123ms**，`status=200`，序列化 **58235B ≤ 64KiB**。
所以：JSON_MAX_BYTES 预算、`jsonPreflight`、facts 保留、`projection` 三项 truncation 断言**都在真实预算内成立**，只是它们前面排队了 23s 构造。

## 2. 逐层定位（为什么不是 SQLite、不是内容压力）

| 测量 | 结果 | 含义 |
| --- | --- | --- |
| `SqliteState.invoke` 直调（同 pragmas，含 JSON roundtrip） | read **0.07ms** / write **2.8ms** | SQLite 层不是瓶颈 |
| 裸 `BEGIN IMMEDIATE`+`COMMIT`（`synchronous=FULL`） | **2.53ms/commit** | fsync 不是瓶颈 |
| 真实 service `runtime.state('memorySnapshot')` | **70–77ms** | 固定开销在 host 层 |
| `host.run(async()=>null)` | **0ms** | task supervisor 本身不慢 |
| 10×`setTimeout(0)` / 10×microtask | **1ms / 0ms** | 事件循环不拥塞，不是 timer 风暴 |
| `manager.get` / `resolveBound` / `manager.signal` | **0ms** | 解析层不慢 |
| 每 case 内 `authorize` 计数（audit delta） | read 3 次 / write 3 次，各 6 条 audit | 每次 state 调用 3 次授权 |
| CPU profile（200 次调用，14.6s） | `packageFingerprint` **84.2%**、`isTrusted` **83.8%**、`readFileSync` 13.5% | 归属明确 |
| `packageFingerprint(plugins/state-sqlite)` | **6.4ms**（src 1.9ms，加 `dist` 7.2ms） | 每次扫描整包 |

调用栈（profile 热点帧回溯）：

```
hash.update @crypto/hash
  ^ packageFingerprint @src/plugin-host.ts
  ^ isTrusted @permissions/kernel.ts
  ^ authorize @permissions/adapters.ts
  ^ invokeCapability @tasks/task-supervisor.ts
```

代码路径：`runtime.state` → `host.call` → `TaskSupervisor.invokeCapability` → `capabilityPermissionAuthorizer`
→ `PermissionKernel.authorize`（每次至少 1 次 `valid()`，另加 methodPermissions 的 files 授权）
→ `isTrusted(identity, digest)` → `options.host.fingerprint(id)` → `packageFingerprint(dir)` **同步重算，无缓存**。

## 3. 归因（本 task 是否相关）

- 该 test 文件与 `packageFingerprint`/`isTrusted` 逻辑在 `HEAD` 均未改（`git show HEAD:` 确认）。
- 但**不能据此说无影响**：本 task 让 `service.ts` 多注册 `local-host-bridge`，`plugins/state-sqlite` 包也从 1 个文件增到含 1.7MB `dist`；`packageFingerprint` 的成本随包体积/文件数线性增长，且每次调用都重算。
- 因此正确表述是：**超时是既有「每次授权重算包指纹」设计 × 本 task 放大后的包体积 × 296 次 fixture 调用** 三者相乘，不是单一新 bug。
- `plugins/state-sqlite/dist` 未被 git 跟踪（`git ls-files` 为空），但运行期真实存在，直接放大每次指纹成本。

## 4. 已采用的修法（方案 A，已实施并验收）

**把昂贵历史构造移到本 case 专属 `describe` 的 `beforeAll`；296 次真实写入一次不省，只是不再计入 final Result/snapshot 的 20s 预算。**

- `describe('final snapshot budget over retained history')` 内用 typed captured fixture（`f` / `raw` / `maximum`），`beforeAll(..., 60_000)` 以**真实 `createCompanionService` 完整 composition + 真实 State provider** 写入同一套 24 tasks / 24 facts / 100 messages，内容逐字不变。
- 真正 final Result/snapshot 的 `it` 保留**原 20_000 budget** 与**全部原断言**（`JSON_MAX_BYTES` 上下界、`jsonPreflight`、`facts` 全等、`projection` 三项、`messages.length` 比较、`status`），语义逐字未改。
- `cleanups` drain 提为单处 `drainCleanups()`，`afterEach` 与 `describe.afterAll` 共用；`splice` 幂等，不会重复 close。case 被过滤或 `beforeAll` 失败时 `afterAll` 仍真实 join HTTP/runtime。
- 未使用 disabledPlugins、未 SQL seed、未 trust cache、未改全局 timeout、未改生产代码。

**不采用**：单纯加大 test timeout（掩盖 23s 构造）；削减 100/24/8 或缩小 payload（削弱真实历史压力）；放宽 `JSON_MAX_BYTES`/facts/guard（削弱预算语义）；生产侧加 TTL 信任缓存或 authorize 缓存（违反 spec「Do not compensate by caching trust」，且是另一议题）。

> 遗留议题（不在本 task 范围）：`packageFingerprint` 每次授权同步重算整包，是生产侧真实的每次调用固定成本（≈70ms/state 调用）。本修法**只改变受测边界计时**：该 case 仍然支付全部 296 次真实 history 准备，只是把它们移到 `beforeAll`，不再计入 final Result/snapshot 的 20s 预算。**未**改变该生产行为；若要优化应作为独立任务评估（缓存需同时满足 spec 的信任语义，不能为过测试而加）。这是 fixture 边界选择，不是全产品故障，也不扩大本 task scope。

## 5. 可复核命令

```bash
# 精确 case 过滤名（读自 it() 原文，describe 包裹后不变）
pnpm --filter @pet/companion-service exec vitest run src/model-controller.test.ts \
  -t 'budgets real SQLite history once'
```

现状：**exit 0**，`1 passed | 19 skipped`，`it` 本体 **121–124ms**，总运行 **24.60s**（历史构造在 `beforeAll`，60s budget 内完成）。**未跑 371 全量 suite**，未 SIGTERM 计 pass。

## 6. 环境与限制

- 全部 fresh `mkdtemp` + loopback，无 real QQ、无付费模型；诊断期临时探针脚本在 `/tmp/budget-probe/`，产物已 `rm` 清理，本次运行无新增 `/tmp/companion-model-http-*` 残留。
- 未 install/build/commit；未改 production、Root deps、host-kernel、权限缓存、审批 docs。
- 改动仅 `apps/companion-service/src/model-controller.test.ts` 与本文件；未动 G3 报告。

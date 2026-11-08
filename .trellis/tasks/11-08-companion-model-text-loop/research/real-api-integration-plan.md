# 真实 API 联调计划（frontend 侧）

状态：计划。backend 已 freeze，本文件只写**怎么做和怎么判**，不含任何已通过结论。
执行前提：parent 提供临时 profile + 回环服务 URL/token 文件；不启动 public 4120、不改原 profile、不把 loopback 夹具当真实 Magpie。

## 0. 我已从真实源码确认的事实（静态阅读，不是测试结果）

| 事实 | 出处 | 对前端的影响 |
| --- | --- | --- |
| 路由：`GET /api/snapshot`、`GET /api/model`、`POST /api/model`、`POST /api/model/credential`、`POST /api/model/test`、`GET /api/events` | [server.ts:308-390](../../../../apps/companion-service/src/server.ts#L308-L390) | 与 [protocol.ts](../../../../plugins/text-client/src/client/protocol.ts) 完全一致，无改名 |
| 保存 200、测试 202、凭据 200，均为 `Result<…>` 信封 | 同上 | 与 `modelCommand()` / `writeModelCredential()` 期望一致 |
| 状态码：401/403/400/409/413/503(not-ready, unavailable)/500 | [server.ts:448-456](../../../../apps/companion-service/src/server.ts#L448-L456) | 信封里的 `error.code` 先被解析，所以 `not-ready`、`permission-denied` 不会被状态码覆盖成 `unavailable` |
| `writable` = 服务端判定的回环入口 **且** 连接自己声明可写 | [server.ts:64-100](../../../../apps/companion-service/src/server.ts#L64-L100) | 127.0.0.1 访问时 Magpie 可写；任何非回环入口一律只读 |
| 默认 mode 来自 `COMPANION_MODE`，缺省 `scripted` | [main.ts:13](../../../../apps/companion-service/src/main.ts#L13) | 初始应是「脚本 + 未配置」，不是模型模式 |
| `view.error` 在 `desired.mode==='model' && !applied` 时为 `not-ready` | [model-controller.ts:355](../../../../apps/companion-service/src/model-controller.ts#L355) | 界面不能把它当硬错误弹（已按此实现） |
| `commandId` 需匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` | [server.ts:23](../../../../apps/companion-service/src/server.ts#L23) | `crypto.randomUUID()` 与兜底格式都合法 |
| 凭据写入要求「已选中的已保存连接」+ 精确 config/凭据版本 | [model-controller.ts:463-500](../../../../apps/companion-service/src/model-controller.ts#L463-L500) | key-only 路径必须先有一次保存把连接变成 selected+applied |

## 1. 联调前的一次性检查（不产生任何模型调用）

1. 确认 token 文件只被本进程读取，token 只进 `Authorization`，不打印、不进 URL、不进截图。
2. `GET /api/snapshot` 与 `GET /api/model` 返回同一个 `view`（contract §5 要求二者同源）。
3. 记录服务 URL、`COMPANION_MODE`、`COMPANION_MODEL_BASE_URL`，以及是否注入了环境密钥——这些决定后续每一项的期望值。

## 2. 必测项与判据

每项都写「操作 → 期望」，不写「已通过」。

### A. 初始无配置
- 打开页面 → 头部有「模型」入口；对话框摘要说明当前是脚本回复。
- 期望：`desired.mode='scripted'`、`applied=null`、`enabled=false`、`check.state='unconfigured'`；Magpie 与 fixture 都出现在连接下拉里。
- 反例判据：出现任何「已连接/已就绪」字样即失败。

### B. 保存零模型请求 / 应用
- 填好 Magpie 地址与模型 → 点「保存并应用」。
- 期望：只有 `POST /api/model` 一次；`applied` 出现且 `enabled=true`（mode 选模型回复时）。
- 判据：**服务端与网关侧零推理请求**。验证方式是网关访问日志/计数，不是界面文案。
- 另测：只填地址不填模型 → 200 但 `applied=null`、`view.error=not-ready`，界面必须说「已保存，还没有应用」。

### C. 真实 test 的 HTTP/SSE 计数
- 点「测试连接」→ 期望 202 受理，随后 SSE `refresh` 带来 `check.state: verifying→verified`。
- 判据：**恰好一次**上游 HTTP 请求（`/v1/responses`），一次 `GET /api/events` 长连接不因测试而重开。
- 同一 `commandId` 再点（或刷新后重复）不得产生第二次上游请求。
- 证据形态：网关侧请求计数 + 服务端 check 的 `startedAt/checkedAt/elapsedMs`。

### D. synthetic 标记
- 选 fixture 连接并测试 → `check.evidence='synthetic'`，界面写「模拟检查通过，未连接真实模型」。
- 判据：不得出现「测试通过」这种不带模拟限定的说法。

### E. 缺 key / 只读入口
- 缺 key：网关模式但没有密钥 → 测试被拒（503 `not-ready`），界面说「没有开始测试」而不是失败结果。
- 只读入口：用**非回环** Host 访问（例如通过 LAN 地址或反代头）→ `writable=false`，界面只显示宿主注入说明，不出现密码框；若强行 `POST /api/model/credential` 应得 403。
- 判据：这一项要真的用非回环入口验一次，不能只看回环下的表现。

### F. 冲突与晚响应
- 冲突：界面里改一项 → 另开一个客户端（curl）把同一连接改掉 → 点保存 → 409，草稿保留，出现「读取最新版本，保留我的修改」；点它之后能真正保存成功。
- 晚响应：保存 A 后立刻改回 B 并让 B 的快照先落地，确认最终 `applied` 是 B 而不是 A（前端已改成命令响应不写全局，这里验真实服务的行为一致）。

### G. 模式切换保留任务 / identity
- 在模型模式发起一个任务 → 切回脚本 → 切回模型。
- 期望：`agent.id`/`name` 不变；任务列表、已确认消息、产物字节不变；进行中的任务不被取消或重放。
- 判据：切换前后的 `GET /api/tasks/<id>` 与产物 sha256 相同。

### H. 390px 键盘
- 390×844 视口：对话框内容可滚、三个按钮在视口内、无遮挡；Tab 顺序可达每个字段与按钮，焦点环可见；软键盘弹出后按钮仍可点。

## 3. 与 fixture 证据的界线

- 前端已有 138 个单元/集成用例与 18 项 DOM 检查，全部是 **fixture-backed**。
- 本计划里 A–H 若在真实服务上跑过，只能记为「loopback 真实服务 + 未连接真实 Magpie」，除非 owner 明确授权真实网关调用。
- 只有 C 项的网关计数、以及真实模型回复，才算真实上游证据；其余仍是协议一致性证据。

## 4. 中止条件

出现以下任一情况立即停并报告 parent，不自行改契约：
- 真实 `view` 的字段与本仓库 `packages/contracts/src/companion-model.ts` 不一致；
- 保存后出现意料外的推理请求；
- 同一 commandId 产生第二次上游请求；
- 切换连接后 `agent.id` 变化或任务丢失；
- `credential.writable` 在非回环入口仍为 true。

## 5. 已知的前端限制（联调时如实记录，不修产品源码）

- 测试按钮的 15 秒服务端期限与前端 20 秒请求上限：测试是 202 受理，不受影响；但若 SSE 断流，界面只能显示「结果未知」，不能替服务端下结论。
- 检查结论严格绑定 `check.binding`；服务端重置 check 后界面显示「还没有测试过这一份连接」，这是正确行为而非缺陷。

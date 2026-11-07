# 文字客户端真实浏览器验收（2026-11-08）

服务由父代理启动，隔离 scripted profile，真实 Cortico + SQLite + Docker。本报告只记录**实际执行**的结果；未执行的项目在末尾单列。

**交付版本复验**：`http://127.0.0.1:38471`（主实现整理完 Cortico 离线脚本的人类可读回复后重跑）。本轮复验开始后产品代码与 dist 保持冻结，验收期间只改 QA 与报告。

探针：`qa/probes/companion-browser-acceptance.mjs`；截图与机器可读报告：`qa/screenshots/companion/`。

## 结论

**22 项检查全部通过，0 个未捕获脚本错误。** 验收中发现并修复了 4 个真实缺陷（刷新失败判定、请求无上限、流失效后的状态顺序及窄屏布局），修复后本轮复验通过。

产物：`01-desktop-connected.png`、`02-offline-last-confirmed.png`、`03-narrow-390.png` 三张均已用 `read_image` 实际审阅，中文可读、无方框、无重叠。

## 运行方式

```sh
COMPANION_CONNECTION=/tmp/companion-browser-eOWhdw/connection.json \
FONTCONFIG_FILE=/tmp/dsh-pet-browser-fonts.conf \
LD_LIBRARY_PATH=/tmp/dsh-pet-browser-libs/usr/lib/x86_64-linux-gnu \
node qa/probes/companion-browser-acceptance.mjs
```

- `COMPANION_CONNECTION` 必填；缺省直接退出码 2，不静默用旧临时路径。
- `COMPANION_BROWSER` 可覆盖浏览器可执行文件，默认本机已验证的 headless shell。
- 本机默认无 CJK 字体，脚本在截图前检查 `fc-list :lang=zh`，缺失即失败，避免把方框图当作视觉通过。

## 实测结果

| 检查 | 实测证据 |
| --- | --- |
| 令牌入口 | 中文标签、`type=password`、明说「只保存在本页内存中」 |
| token 不外泄 | 页面 URL、`performance` 资源 URL 均不含 token |
| 键盘连接 | 键盘输入 token + Enter 进入 live |
| 身份与模式 | 「同伴」+「离线脚本回复，未调用模型」 |
| 宽屏 | 1440px 无水平溢出，`scrollWidth === clientWidth`，无越界元素 |
| Shift+Enter | 输入框内换行，消息数不变 |
| Enter | 发送，消息经服务端确认后草稿清空 |
| 真实任务 | exitCode 0，stdout `Created result.txt` |
| 回复可读性 | 聊天不出现 `commandId`/`taskId`/`inputId`/`executionId`/内部提示语/原始回执 JSON |
| 产物下载 | `result.txt` 26 字节，内容 `Companion demo completed.\n`，sha256 `ae5b19a1…`，与服务端记录一致 |
| 停止请求 | 点击后显示「停止请求已发送」 |
| 真实终态 | 服务端 `cancelled`（exit 137），UI 换「已取消」 |
| 任务隔离 | 停止一个任务后，另一任务终态与产物不变 |
| 断网 | 45.0s 检测到（`offlineDetectedAfterMs = 45006`），显示「连接已断开 / 当前状态未知，显示的是上次确认的内容」+「重新连接」；任务显示「状态未知（上次：运行中）」；发送禁用 |
| 后台继续 | 浏览器离线期间服务端把任务跑完（exitCode 0） |
| 重连 | 对账到真实终态「已完成」，不重放 |
| 窄屏 390px | 无水平溢出；任务区不遮挡输入框；聊天行未塌成 0 |
| 窄屏交互 | 输入并发送成功，收到回复 |
| 键盘焦点 | Tab 进入时有可见焦点环 |
| 脚本错误 | `pageErrors: []`、`consoleErrors: []` |

`diagnostics.failedRequests` 里的两条（`/api/events`、`/api/snapshot`）是断网段代理黑洞造成的，属预期，不是产品错误。

## 本轮修复的 4 个真实缺陷

### 1. 断网后界面一直显示「已连接」

`client.ts` 的 `#refresh()` 只在 `auth-failed` 时转 offline，其它失败被静默忽略。改为任何失败都转 offline，保留最后确认数据。

### 2. 快照请求无上限，TCP 挂起时永久等待

`request()` 没有超时；断网时 fetch 既不返回也不报错，`getSnapshot` 永久挂起，把断线判定卡死（实测 60s 仍显示「已连接」）。加 `REQUEST_TIMEOUT_MS = 20_000`（`AbortSignal.timeout` + `AbortSignal.any` 合并调用方 signal）。SSE 走自己的 45s 心跳看门狗，不受此值影响。

### 3. 事件流失效后仍等快照才转 offline

`#follow()` 原来在流结束后先 `await getSnapshot`，最多 20s 期间继续声称 live。改为**流失效立即 dispatch offline**，再对账：同 epoch 停在 offline 等手动重连，epoch 变化则采纳新快照恢复实时。未新增状态或空闲轮询。

### 4. 390px 窄屏输入框被任务区遮挡

`.tc-body` 计算为 `grid-template-rows: 0px 769px`：任务区 `auto` 吃掉整行，聊天行塌成 0；`.tc-chat { min-height: 60vh }` 使其溢出并盖住输入框，`elementFromPoint` 命中 `tc-task__line`，点击 30s 失败。改为任务区固定 `minmax(0, 38vh)` 并自己滚动，聊天 `min-height: 0`。

## 方法说明：断网是怎么模拟的

Playwright 的 `context.setOffline(true)` 和 CDP `Network.emulateNetworkConditions` **都不会切断已经建立的 SSE socket**：实测离线后新请求被拦（`ERR_INTERNET_DISCONNECTED`），但既有 SSE 仍在持续收到 keepalive。用它做「断网」会得到假阳性。

因此探针改为**本地 HTTP 代理黑洞化**：页面 origin 仍是真实服务地址（Origin 校验、相对 URL、token 行为与直连一致），断网时把上游连接销毁并暂停浏览器侧 socket——连接保持打开但不再有任何字节，等价于「网线被拔掉」。这是本轮唯一可用的真实断线形态。

## 交付版本上的回复可读性

主实现整理了 Cortico 离线脚本的人类回复：不再把受理回执 JSON 或「This is an execution observation…」这类内部模型提示呈现给用户；内部工具历史与关联 ID 原样保留，任务列表工具仍返回真实 ID。脚本回复改为读取 canonical task 状态与受理事实，不伪造完成。

本轮探针为此新增断言：聊天区域不得出现 `commandId`/`taskId`/`inputId`/`executionId`/`This is an execution observation`/`not a new user instruction`，也不得出现原始回执 JSON（`"status":` 形态）。实测通过。三张最终图已重新采集并逐张 `read_image` 审阅：回复为「任务已受理。可以继续交谈，也可以在任务区查看进度或停止它。」「Scripted file demonstration：已完成。产物可在任务区下载。」等自然语句。

## 未覆盖

| 项 | 原因 |
| --- | --- |
| 真实模型回复 | 本轮是 scripted profile，明说未调用模型；无付费调用 |
| 真实云端部署 / 外网暴露 | 不在本次范围 |
| OS 级浏览器隔离 | headless shell 默认 no-sandbox，本验收不构成隔离证明 |
| 移动端真实设备 | 仅 390×844 视口模拟 |
| 15s keepalive 长稳定性 | 只验证了单次断线；长时间稳定性需真实部署观察 |

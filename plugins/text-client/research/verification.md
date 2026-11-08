# text-client 验证证据（2026-11-07）

本文件记录 `plugins/text-client` 在交付时实际跑过的检查与输出。范围仅限本地：**不含真实服务联调、真实模型/执行、浏览器视觉与键盘走查**。

## 环境

- Node v26.13.0，Linux x86_64
- 依赖由父代理统一 `pnpm install --ignore-scripts` 建立 workspace link
- 无 Playwright 浏览器二进制、无 Electron 可执行文件，因此没有截图或真实点击证据

## 命令与结果

```sh
# 类型
plugins/text-client/node_modules/.bin/tsc --noEmit -p tsconfig.json
# 结果：无输出（通过）

# 构建
node build.mjs
# 结果：dist/index.html、dist/client.js、dist/client.css、dist/index.mjs

# 测试
node --import ./tests/source-loader.mjs --test tests/*.test.mjs
# 结果：tests 60, pass 60, fail 0

# 代码规范（仓库根）
node node_modules/eslint/bin/eslint.js "plugins/text-client/**/*.{ts,tsx,mjs}"      # 0 problems
node node_modules/prettier/bin/prettier.cjs --check "plugins/text-client/**/*.{ts,tsx,mjs,json,css,html,md}"
```

## 用例清单（60）

协议分帧 `tests/sse.test.mjs`：

- 解析 `id/event/data` 帧，忽略注释行（服务端 15s keepalive 即注释行）
- 半帧缓冲到空行到达
- 跨 chunk 的 CRLF
- 多行 `data` 合并与默认事件名

状态语义 `tests/state.test.mjs`：

- 快照确认后移除对应的本地待确认消息
- 结果不明时复用 commandId；文本改动后不复用
- 同 commandId 重复加入替换而非追加
- 明确拒绝时移除待确认行并给出固定错误文案
- 断线把待发消息与运行中任务标为未知，不当作当前真相
- 停止请求显示「停止请求已发送」，仅服务端终态才结束
- 结果不明的停止保留 commandId
- 终态不提供停止操作
- epoch 变化替换投影但保留本地待确认意图

响应校验 `tests/guards.test.mjs`（浏览器安全的字段级重建）：

- 合法快照逐字段重建，未知附加字段被丢弃
- 协议版本不支持时拒绝并带回收到的数字；非数字版本不臆造数字
- 单个字段损坏（角色、状态、cursor、epoch、数组类型、agent 为空）整条作废
- 列表中任意一项损坏整条作废（消息、任务的 artifacts、事实、插件）
- 必填数组 `messages/tasks/facts/plugins` 缺省即作废，不当成空数组
- 时间戳超出 Date 范围（`8.64e15±1`、`1e300`、`Infinity`、`NaN`）被拒；边界值仍合法
- 退出码必须是安全整数，小数与超大数被拒
- 必填的 `error` 字段缺失即作废（显式 `null` 才表示没有错误）
- 回执形状校验：缺字段、错误状态、错误类型都返回 null
- 回执的 commandId 必须与本次提交一致，`accepted`/`duplicate` 都不例外
- 事件 sequence 必须是安全非负整数；未知 kind 或非 JSON 对象 data 被拒
- 错误对象只按固定码重建，未知码收敛为 internal，服务端 messageKey 不参与显示

客户端行为 `tests/client.test.mjs`：

- token 只在请求头，任何 URL 都不含它
- 401 进入 offline 且保留固定错误码
- 两条事件合并为一次快照读取，之后空闲不再读取（无轮询）
- 无 id 的 `refresh` 同样合并成一次读取
- epoch 变化按新快照重新对账并保持连接
- 世代未变的流关闭判为断线并保留最后确认数据
- 结果不明的发送复用同一 commandId，重试不产生第二次提交
- 改动文本取得新 commandId
- 停止受理不等于退出，终态快照才结束
- 产物经认证请求取字节，文件名用于本地下载
- 损坏快照体、非 JSON 响应、超出 Date 范围的时间戳都让连接进入 offline 且不留半个对象
- 协议版本不支持停在入口并带上版本号
- 回执形状损坏或 commandId 不匹配时保持「结果未知」，不假装已受理
- 坏事件帧（坏 JSON、坏 sequence、未知事件名）被忽略且流继续工作

渲染语义 `tests/render.test.mjs`（`react-dom/server` 静态渲染，只证明文案与语义）：

- 令牌入口说明「只保存在本页内存中」，`type=password`，无 token 参数
- scripted 模式标注「离线脚本回复，未调用模型」
- 运行中任务有停止控件，已完成任务没有
- 断线运行中任务显示「状态未知」并给「重新连接」
- 断线时输入保留且发送按钮不可用
- 未输入令牌时渲染入口而非主界面
- 首次连接失败停留在入口并显示原因

真实 HTTP + SSE `tests/integration.test.mjs`（数据来自 `tests/fixture-server.mjs` 夹具，**不是产品服务**）：

- 建连 → 发消息 → 停止（请求先到，终态后到）→ 产物
- 未授权令牌被拒，永不进入 live
- 断开后重连对账到当前快照，不重放

## 模型连接设置（2026-11-08 增补）

`src/client/model.tsx` 增加了一个紧凑设置对话框，协议/守卫/状态层按
`packages/contracts/src/companion-model.ts` 与 implementation-contract.md 接线。
同一轮新增 23 个前端用例，合计 **92 通过**。

- 守卫：`snapshot.model` 缺省=没有该能力；出现但任一字段读不懂，整条快照作废（不造半个连接）。
- 协议：保存/测试都要求回执 `commandId` 与本次一致且视图整份可读；密钥写入走独立的 `/api/model/credential`。
- 状态：命令响应**不写**全局快照；`model` 只由 `/api/snapshot` 与 SSE 更新。命令成功后触发一次权威刷新，响应里的 view 只返回给调用方做两段 CAS 与文案判定。
- 交互：默认 Magpie，连接列表只来自服务端注册项；`settings=null` 的连接只显示元数据；测试只对已应用的那一份绑定，`dirty` 或切到别家时禁用；`writable=false` 时不提供必然失败的密钥输入框。本阶段只有 loopback/受控 SSH 入口可写，远程入口（含 HTTPS 反代）由宿主注入，界面只解释不给输入。
- 文案：`synthetic` 的通过写成「模拟检查通过，未连接真实模型」；配置变更后旧结论标为「不再适用」。
- 密钥：只存在组件的 `useState`，dispatch 后立刻清空，不进 reducer/outbox/存储；清除走 `apiKey: null`。

夹具服务（`tests/fixture-server.mjs`）扩了 `/api/model`、`/api/model/credential`、`/api/model/test` 三条路由，用真实 HTTP 往返验证保存→应用→测试→结算，并覆盖 409 冲突与 synthetic 标签。**它不是产品服务，也不代表真实 Magpie 或真实模型联通。**

### 第二轮：7 项交互缺口修复（2026-11-08）

判断从组件里抽到 `src/client/model-form.ts`（纯函数 + 可注入 transport），组件只负责接线。这样「点击之后发生什么」能用真实状态序列跑，而不是只靠静态渲染推断。

| 缺口 | 修复 | 回归 |
| --- | --- | --- |
| key-only 无法提交 | `dirtyOf` 拆成 nonsecret/key；`savePlan` 只有密钥时只发 credential | `a key-only edit plans exactly one credential request`、`a key-only click sends exactly one credential request and no save` |
| 密钥不绑目标 | `selectConnector` / `setSettings` 在换连接、改地址或鉴权方式时清空密钥；只改模型名保留 | `switching connector drops a key…`、`changing the base url or auth mode drops the key…` |
| 发起后不清空 | `beginOperation` 一进入就清空；`runSave` 全程只持有局部变量 | `beginning any operation clears the key before the request resolves`、`the key never reaches the state…` |
| false success | `savedText`/`summaryText` 读响应视图的 `applied`/`enabled`；模型模式未启用不再叫脚本 | `a saved but unapplied view is not reported as applied`、`an applied connection with the foreground not switched is not called scripted` |
| draft conflict | 草稿自带 `baseline`（profile/config/credential 版本），保存用它做 CAS；`aligned()` 现在也比较设置内容，刷新不再吞草稿 | `an external revision change keeps the draft and its original CAS baseline`、`a snapshot refresh with no server change does not erase typed settings` |
| busy 时仍可保存 | `availability()` 在 `agent.busy`、`validating`、offline 时禁用并给原因；独立任务不参与判断 | `an active reply blocks switching with an explanation`、`a validating check blocks save and test…`、`an offline page disables both actions` |
| stale check | `checkText` 要求 `check.binding` 与 `applied` 完全相同才报告已验证；`applied=null` 也判为「连接已变」 | `a verified check with no binding…`、`after unbinding, a previous verified result is not displayed as current` |

附加：非secret保存的 commandId 按意图指纹复用（`retrying an unchanged save intent reuses its command id`）；密钥写入不做自动重发，发起即失（`a key-only dispatch is never silently resent`）；关闭后迟到的响应由组件代际守卫丢弃。

**仍未做真实浏览器点击**：本机 `~/.cache/ms-playwright` 为空、无系统 Chromium，且本轮不允许安装浏览器/依赖。上述交互回归是真实执行的状态序列（含异步 await 与真实 HTTP 夹具），但不是 DOM 点击与布局证据。

## 未覆盖

| 项                                 | 原因                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| 真实产品服务联调                   | 等后端 API 稳定后由父代理/本人在真实服务 URL 上验收        |
| 真实 Magpie / 上游模型调用         | 未提供网关地址、模型与密钥；本轮不启动服务、不发起付费调用 |
| 浏览器视觉、键盘焦点、窄屏实测     | 无浏览器二进制且未获准安装；390px 对话框滚动只有静态布局推理 |
| 15s keepalive 长连接下的实际稳定性 | 需真实服务；注释行解析已有单测                             |

### 第三轮：真实 DOM 回归（fixture-backed，2026-11-08）

`tests/browser/model-dialog.browser.mjs` 用真实 Chromium（headless shell）点击本插件的构建产物，数据来自脚本自起的 127.0.0.1 夹具服务。**不注入应用内部状态**，全部通过填字段、点按钮、按 Escape 完成。它不参与默认 `node --test`；无浏览器时退出码 2 明确跳过。

```sh
export LD_LIBRARY_PATH=$PWD/.companion-data/tooling/browser/libraries/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$PWD/.companion-data/tooling/browser/fonts.conf
node plugins/text-client/tests/browser/model-dialog.browser.mjs
# 13 checks passed (fixture-backed DOM; not a live model connection)
```

覆盖（18 项）：key-only 可点且只发 credential、发起即清空、改地址丢密钥、409 保留草稿并给出「读取最新版本」恢复动作且恢复后能真正保存成功、saved-but-unapplied、模型模式未启用不叫脚本、解绑后无旧验证、关闭后迟到的失败不污染重开表单、输入密钥时无关刷新不清输入、请求在途时刷新不解锁按钮、测试明确拒绝说「没开始」而已受理丢响应说「可能已经开始」且不产生第二次测试、390px 按钮在视口内且命中、键盘焦点环可见、外部改版保留草稿。

真实点击抓出并修掉的产品问题：
1. 草稿跟随判定用内容差异，服务端改值后草稿不跟随（改为显式 `edited` 标记）。
2. 保存成功后的快照刷新会清掉成功提示（重铺表单时保留 notice）。
3. 409 只显示「没有保存成功」，没有说明草稿还在，也没有恢复动作。
4. 输入密钥期间的无关刷新会清掉密钥、并把在途请求的忙碌态错误解锁（改为「未编辑 + 无待提交密钥 + 无在途请求」三条件才跟随）。
5. 密钥写入用最新视图的版本做 CAS，别处改过凭据后会把新密钥静默写到旧版本上（改为用草稿基线；只有自有保存的第二段才用返回版本）。
6. `validating` 时保存按钮仍可点；填了未写入的密钥仍可测旧连接（都补上边界）。
7. 测试请求的任何失败都说「这次没有开始测试」，网络/超时其实可能已受理（改为区分明确拒绝与结果未知）。

以及 2 个探针自身的问题（夹具 CAS 写死版本号、`dialog.close()` 绕过 React 状态），已修。

### 第四轮：跨 client 层的迟到响应（2026-11-08）

**根因**：`client.ts` 里三个模型命令在成功后都直接 `dispatch({type:'model-view'})` 写全局快照。命令响应不带顺序信息，所以「A 已生效、响应还在路上 → 用户保存 B 并读到 B 的快照 → A 的旧响应才到」会把 `snapshot.model` 回退成 A。组件的代际守卫挡不住，因为写的是 client 全局状态。

**修法**：不比较 opaque 版本，也不引入第二套时序。**让快照只有一个所有者**——`model` 只由 `/api/snapshot` 与 SSE 更新。命令成功只触发一次权威刷新（`#scheduleRefresh`），响应里的 `view` 仍原样返回给调用方，用于两段 CAS 与文案判定。删掉了 `model-view` action 与 `#adoptModel`。

**回归**（真实 `CompanionClient` + 延迟 HTTP/SSE，`tests/integration.test.mjs`）：

- `a late save response never rolls the snapshot back to an older binding`：压住 A 的保存响应 600ms，等 A 的变更先被快照读到；再保存 B 并等 B 的快照落地；最后放行 A 的旧响应——`applied.connectorId` 仍是 B。
- `a late credential response does not overwrite a newer check result`：压住密钥写入，期间测试结算为 `verified`；旧凭据响应到达后 `check.state` 仍是 `verified`。

夹具的延迟是**先定格响应体再延迟送达**（`holds.save` / `holds.credential`），所以迟到的是真正的旧内容；否则延迟后重新序列化会掩盖问题。

**变异验证**：把 `#scheduleRefresh()` 换回直接写快照，这两条用例立即失败；还原后通过。说明它们真的锁住了这个缺陷。

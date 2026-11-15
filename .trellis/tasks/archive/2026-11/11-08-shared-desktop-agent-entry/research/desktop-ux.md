# 共享桌宠/控制台接入：前端设计

只做本阶段：让现有桌宠与控制台成为同一个独立服务的两个视图。接口以 [implementation-contract](../implementation-contract.md) 为唯一来源，本文不新增 API、不改共享类型。没有启动服务、没有 Electron/浏览器实测、没有改任何产品文件。

## 结论

1. **一处连接、两份视图**：Main 持 `window.petCompanion`（状态+动作）与 `window.petLocalPresentation`（本地外观/音频）。渲染器不再挂 `useDemo`/`useModelConnection`/`useApplication` 这三条旧数据源（[console-app.tsx:125-142](../../../../../../apps/desktop/src/renderer/console/console-app.tsx#L125-L142)、[App.tsx:368](../../../../../../apps/desktop/src/renderer/pet/App.tsx#L368)），改成一份服务快照 + 一份本地呈现快照。
2. **保留画法，换输入**：`PetAvatar`/`PetBubble`/`PetComposer`/`PetMenu`/`MinimalShell`/`Card`/`Field`/`Select`/`Button` 全部留用；只替换它们的 `state/text/canSend/onSend` 与菜单项，不改视觉语言。
3. **状态从事实推导，不复制状态机**：`phase`（idle/connecting/live/offline/retiring）+ `snapshot.agent.status` + `pending[]` 三者足以推出全部界面；断线时非终态一律显示「未知（上次：…）」，复用 [taskStatusView](../../../../../../plugins/text-client/src/client/state.ts#L245) 的判定语义。
4. **Token 只经过一次输入**：控制台对话框输入 → **在 invoke `connect` 的同一步、调用之前**就清空输入框（`setToken('')` 与 `onConnect(value)` 在同一提交里，先清后发，[connect.tsx:25-34](../../../../../../plugins/text-client/src/client/connect.tsx#L25-L34)），不等返回、不等成败；失败/挂起/CAS 冲突同样不留 secret。不进 localStorage/store/URL/DTO（契约 [§2](../implementation-contract.md#2-endpoint-token-and-identity)）。桌宠只读连接状态，不给凭据管理。
5. **不做的旧东西**：历史清空、加载更早记录、全局暂停、引导、语音输入、`app.profile.change`、插件市场、新路由、平台占位，一律从共享视图移除，不做假入口。

## 真正可复用的最小接口

| 现有源 | 复用方式 | 不复用/限制 |
| --- | --- | --- |
| [preload/index.ts:176-240](../../../../../../apps/desktop/src/preload/index.ts#L176-L240) 六个固定桥 | 新桥同形：`Object.freeze` + 具名方法 + `Result<T>` + 可释放订阅 | 共享 preload 不暴露 `petDemo`/`petModels`/`petApplication`（契约 [§4](../implementation-contract.md#4-local-presentation-contract)），旧通道缺失即「这台机器没有这份数据」 |
| [isTrustedPetSource](../../../../../../apps/desktop/src/main/ipc-request.ts#L24) | Main 每个 handler 先验 senderId+主帧+精确 file URL | 不能放宽成「任意 file:」；两窗都是本地 file 页面，CSP 仍 `connect-src 'none'`（[console/index.html:5](../../../../../../apps/desktop/src/renderer/console/index.html#L5)） |
| [ConnectForm:25-34](../../../../../../plugins/text-client/src/client/connect.tsx#L25-L34) | 令牌门的形态与「提交同一步先清空再 dispatch」照抄 | 组件在插件包里、属于 GPT 文件；前端在控制台内重画同样的字段与提示，不 import 该 TSX |
| [protocol.ts](../../../../../../plugins/text-client/src/client/protocol.ts#L137) 的 guards/SSE/HTTP | 只由 Main 使用（经 `@pet/text-client/protocol`） | 渲染器零网络、零 parser：不在 renderer 里再写一遍校验 |
| [state.ts:245](../../../../../../plugins/text-client/src/client/state.ts#L245) `taskStatusView`/`isActive` | 借用「断线→未知（上次：x）」与「停止已请求但未终态」两条判定 | 入参是插件自己的 `ClientState`；桌面侧写 8 行同义映射，不搬整个 reducer |
| [use-application.ts:194-233](../../../../../../apps/desktop/src/renderer/console/use-application.ts#L194-L233)、[use-demo.ts:127-149](../../../../../../apps/desktop/src/renderer/console/use-demo.ts#L127-L149) | 序号/issued-applied 的「晚到结果丢弃」写法 | 只借写法，不借 hook |
| [compose-rules.ts:9-20](../../../../../../apps/desktop/src/renderer/pet/compose-rules.ts#L9-L20) | `canSubmitDraft`/`draftAfterSubmit`/`isSubmitEnter` 原样用 | 语义要对齐：只有 `accepted` 才清草稿；`uncertain` 保留原文以便同 ID 重试。控制台输入框现在写死 `maxLength={2000}`（[conversation.tsx:244](../../../../../../apps/desktop/src/renderer/console/pages/conversation.tsx#L244)），服务上限是 `COMPANION_MAX_TEXT=8000`（[companion.ts:7](../../../../../../packages/contracts/src/companion.ts#L7)，校验用 `string.length` 即 UTF-16 单元，[validation.ts:27](../../../../../../plugins/state-sqlite/src/validation.ts#L27)）；改成 `COMPANION_MAX_TEXT` 并在超限时给理由，不要留一个悄悄比服务更紧的限制 |
| [PetComposer:13-41](../../../../../../apps/desktop/src/renderer/pet/PetComposer.tsx#L13-L41) | `onSend` 返回 boolean 的契约保留 | 适配层把 `accepted→true`，其余 `→false`，组件一行不改 |
| [TaskStrip:20-101](../../../../../../plugins/text-client/src/client/tasks.tsx#L20-L101) | 行结构（状态+标题+停止+产物+详情）作为控制台任务区蓝本 | 它的 props 绑死 `CompanionClient`；桌面侧按同一行结构写受控组件，动作走 `window.petCompanion` |
| [ModelDialog:44](../../../../../../plugins/text-client/src/client/model.tsx#L44) + [model-form.ts:465](../../../../../../plugins/text-client/src/client/model-form.ts#L465) `ModelTransport` | 模型保存/测试的唯一实现，含 CAS、冲突重读、密钥发起即清空 | GPT 已认领 narrow export（props-only + scoped CSS），我按真实导出接入，不自行改文本插件。桌面不转发 `/api/model/credential`，`credential.writable` 恒 false，密钥区只剩说明文字（[model.tsx:323-330](../../../../../../plugins/text-client/src/client/model.tsx#L323-L330)） |
| [MinimalShell:20](../../../../../../apps/desktop/src/renderer/console/minimal-ui/shell.tsx#L20)、[controls.tsx](../../../../../../apps/desktop/src/renderer/console/minimal-ui/controls.tsx#L34) | 外壳、导航、Card/Field/Select/Button/Status 全留 | 页面清单仍由宿主给；不新增页面类型 |
| [usePresentationTheme:11](../../../../../../apps/desktop/src/renderer/console/use-presentation-theme.ts#L11)、[SpeechSettingsPanel:34](../../../../../../apps/desktop/src/renderer/console/minimal-ui/speech-settings.tsx#L34)、[SpeechOutputPlaybackOwner:5](../../../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx#L5) | 主题同步、TTS 设置与「停止播放」保持原样 | 不把快照差异接到自动朗读；重连不补播 |
| [PetMenu:139](../../../../../../apps/desktop/src/renderer/pet/PetMenu.tsx#L139)、[PetTools:17](../../../../../../apps/desktop/src/renderer/pet/PetTools.tsx#L17) | 圆形工具与菜单板件留用 | 删掉 `paused/onTogglePause`、`onGuide`、`onToggleVoice` 三组 props 的传入，不删组件内部可选分支 |

## 一条数据流

`window.petCompanion.onChanged → getState()`（唯一快照所有者，Main 单调 `revision`）；动作只拿 `connectionId` 作目标。渲染器只做两件事：丢弃 `revision` 更小的读结果、在动作返回后核对 `connectionId` 是否仍是当前那个。命令回执**永远不写进**渲染器里的快照（M1 教训：命令响应没有顺序信息，[model-settings.md:17](../../../../../spec/frontend/model-settings.md#L17)）。

角色状态推导（`service-status.ts`，纯函数）：

| 事实 | 角色 | 气泡 |
| --- | --- | --- |
| `connecting`/`retiring` | `thinking` | 「正在连接…」/「正在断开…」 |
| `live` 且有 `pending.status='sending'` | `thinking` | 「正在发送」 |
| `live` 且有 `pending.status='uncertain'` | `thinking` | 「结果未知 · 重试不会重复发送」 |
| `live` 且有 `pending.status='accepted'` | 沿用上一条 | 已受理但仍未在快照里出现：不当作已送达，也不重发 |
| `live` 且 `agent.status==='busy'` | `thinking` | 「正在处理」 |
| `live` 且最后一条是 assistant | `replying` | 该条正文（截断，`clipBubbleText`） |
| `offline`/`idle` 且 `error!==null` | `error` | 固定错误名 + 「最后确认 HH:mm」 |
| 其余 | `idle` | 无气泡（不编一句话） |

`agent.mode==='model' && status==='unavailable'` 时输入框仍可写，但发送理由要说「模型当前不可用」而不是泛化的「插件尚未就绪」（[model-ux.md](../../11-08-companion-model-text-loop/research/model-ux.md) 同一结论）。

## 文案与行为

| 场景 | 显示 | 可做的动作 |
| --- | --- | --- |
| 默认首页（未配置，控制台） | 「还没有连接服务。填服务地址，再输入一次访问令牌。」 | 填地址（普通输入，保存为非secret Config）；「连接…」开令牌对话框 |
| 未配置/断线（桌宠） | 同一句事实，但只到「去设置台连接」 | **桌宠没有 connect/disconnect**（契约 §3：只有控制台可连接）；只给打开设置台 |
| 已存地址、无令牌（重启后） | 「地址已保存，令牌不跨进程保留，需要重新输入。」 | 「输入令牌并连接」（bridge 没有清空地址的方法，不造一个；换地址就重填再连接） |
| 连接中 | 「正在连接 {host}…」，所有写操作禁用 | 无取消（契约只允许串行过渡，另一过渡返回 conflict） |
| 在线 | 「已连接 · {agent.name} · {脚本演示/模型回复}」+「最后确认 HH:mm」 | 聊天、任务、产物、模型、身份、断开 |
| 断线 | 「连接已断开 · 最后确认 HH:mm」+「当前状态未知，下面是上次确认的内容。」 | 「重新连接」（同目标、用内存令牌）；「断开」；产物/发送/停止禁用 |
| 源被停用/移除（`source:'disabled'`） | 「这份连接已停用。服务里的对话与任务不受影响。」 | 只能去插件页恢复；不提供连接按钮（连接会失败，也不该假装能连） |
| 源不可用（`source:'unavailable'`） | 「连接组件没有就绪。」 | 无；给出重新读取 |
| 令牌被拒 | 「访问令牌被拒绝。」 | 重新输入令牌；不自动重试 |
| 协议不匹配 | 「服务返回的内容读不懂（协议版本 {n}），需要更新其中一侧。」 | 无自动降级 |
| 地址 CAS 冲突 | 「地址已被别处改过，已重新读取；你的令牌没有提交。」 | 保留地址草稿，显式重试 |
| 身份（只读） | 服务名 + 人格修订号 + 人格正文（滚动区），「人格由服务保存，这一版不能在这里修改」 | 关闭；`agentId`/`profileRevision` 与当前快照不符时只报冲突并等下一次快照，不重试循环 |
| 模型 | `summaryText` 同义一句（脚本/已应用/不可用）+ 已应用连接的地址/模型/凭据来源 | 「保存并应用」「测试连接」；密钥区固定说明「这个入口不允许在这里写密钥」 |
| 任务 | 每行：状态徽标 + 标题 + 时间 + 定向「停止」+ 产物按钮 + 详情（截断标注） | 仅 `live` 且非终态可停；「停止请求已发送」不等于结束 |
| 停止范围 | 三个独立词：本地播放停止（TTS 面板）、「停止这次回应」（`agent.status==='busy'` 时可用，无持久回执）、单任务停止 | 互不冒充；断开永不等于暂停 |
| 产物保存 | 原生选择框 → 成功后「已保存 {name}（{size}）」；取消 → 「已取消，没有写入文件」 | 只传 `artifactId`，不回显路径 |

## Token 与目标代际

- 令牌输入只活在对话框组件里；**提交处理里先 `setToken('')`，再用捕获到的局部值调 `connect`**，与 [connect.tsx:25-34](../../../../../../plugins/text-client/src/client/connect.tsx#L25-L34) 一致。清空不依赖 Promise 结算：失败、超时、挂起、CAS 冲突都不留 secret。渲染器不持久化、不拼 URL、不写日志、不进错误文案。
- 两个 `revision` 不是同一个东西：`state.revision` 是 Main 本地投影序（只用于丢弃更小的读结果），`connect.expectedRevision` 是源 Config 的 CAS 版本（`state.configRevision`）。拿 `state.revision` 去做 CAS 会在第一次投影后必然冲突（契约 [§2](../implementation-contract.md#2-endpoint-token-and-identity)）。
- 每个动作在发出前捕获 `connectionId`（停止/发送/产物）或 `configRevision`（连接）；返回后若 `connectionId` 已变，丢弃结果并**不**清任何草稿、不报「已保存」。切换地址/断开/源被停用都算换代。
- 表单（模型、身份、令牌）各有一个打开代数：关闭再打开的旧回执不得落到新表单（[model-settings.md:23](../../../../../spec/frontend/model-settings.md#L23)）。
- 未确认消息保留原文与 `commandId`，重试复用同一个；内容改了就是新意图、新 ID。
- 断线保留最后确认内容与时间戳；重连只补文字与任务，不补播语音、不重放触碰与旧对话框。

## 具体改动（前端自有文件）

1. `renderer/shared/`：`use-companion.ts`（订阅+revision 排序+动作包装）、`use-local-presentation.ts`、`service-status.ts`（纯函数：阶段/任务/角色/文案）、`artifact-actions.ts`（保存结果三态）。
2. `pet/App.tsx`：`useDemoStatus()` → `useCompanion()`；`demo.state ?? view.state` 换成推导状态；`collectHitShapes`（[App.tsx:434](../../../../../../apps/desktop/src/renderer/pet/App.tsx#L434)）把新增的任务/状态面板纳入；`geometry` 串（[App.tsx:609](../../../../../../apps/desktop/src/renderer/pet/App.tsx#L609)）补上 `phase/pending/task ids`，否则面板尺寸变了命中区不重算。
3. `pet/PetMenu` 传入项：删暂停/引导/语音；「停止」改为停止这次回应（`live && busy` 才可用，标题写清范围）。`PetTools` 只留聊天。
4. `console/console-app.tsx`：挂 `useCompanion`+`useLocalPresentation`；删 `useDemo`/`useModelConnection`/`useApplication`/design-lab 分支（[console-app.tsx:326](../../../../../../apps/desktop/src/renderer/console/console-app.tsx#L326)）；`RunToggle` 的「暂停回应」换成连接状态行；「停止全部任务」改为「停止本地播放」并只调本地 TTS stop。
5. `pages/conversation.tsx`：历史区换成服务消息（含 `hasMoreMessages` 标注）+ 待确认条目；删掉「加载更早记录」与录音/语音块（服务没有分页与录音）；Compose 接 `send` 三态并把 `maxLength` 提到 `COMPANION_MAX_TEXT`。
6. `pages/start.tsx` + `minimal-ui/start.tsx`：模型目录卡片换成「连接」卡片 + 服务模型卡片，保留 PetCard 与配色工作室。
7. `pages/persona.tsx`：改成只读服务人格 + 本地呈现字段（`bubbleFontSize/bubbleSpeed/glow/hover/statusBubble/saidBubble/doubleClickTyping` 走 `presentation.save`）；`petName/userName/replyLanguage/style/personaPrompt/personaTemplates` 不再可写，只显示「由服务或旧档案保留」。
8. `pages/appearance.tsx`：保存走 `presentation.save`（`expectedRevision` + patch），其余照旧。
9. `pages/voice.tsx`：共享组合里不再出现（语音输入不在本阶段），TTS 面板已在 persona 页保留。

## 与冻结契约的对照

契约 181 行已读，我的设计全部落在其中。**没有需要新增的 bridge 方法或 DTO**。四处按契约修正/收敛：

1. `state.revision`（Main 投影序）与 `connect.expectedRevision`（源 Config CAS）**不是同一个数**，连接只能用后者；早先草案里混用，已改。
2. bridge 没有「清空地址」方法：不造。换地址就是重填后 `connect`，旧地址保留在 Config 里直到被覆盖。
3. `source: 'disabled' | 'unavailable'` 是与 `phase` 正交的一维：源被停用时即便 phase 仍是 offline 也不给连接按钮（连接必然失败），只指向插件页恢复。
4. 桌面模型的 `credential.writable` 恒 false 且不 relay `/api/model/credential`，所以桌面表单**没有密钥输入**：只有「保存并应用」与「测试连接」两个动作，凭据来源只读显示。

模型表单的复用已由 GPT 认领：narrow export、props-only、scoped CSS，`ModelDialog`（[model.tsx:44](../../../../../../plugins/text-client/src/client/model.tsx#L44)）不再绑 `CompanionClient` 的 props 由那次导出决定。我等真实 types 就绪后接入，**不自行改文本插件、不与同一源码文件并写**。

若实现中确实需要新 DTO/方法，停下来报 parent，等契约更新，不在渲染器里造。

## 最低真实 Electron 验收（本机当前不可执行）

前置：`.companion-data/tooling/desktop` 下的 Electron45 与 Xvfb 就绪（本机 `node_modules/electron` 无 `path.txt`/`dist`，`DISPLAY` 未设，无 `xvfb-run`；**不得**用 `require('electron')` 取路径，会触发下载，见 parent research §Execution environment）。探针必须 `require.resolve('electron/package.json')` 读元数据 + 文件系统检查二进制。

1. 临时服务（隔离数据、回环随机端口、脚本模式）+ 真实浏览器第二视图；令牌只从控制台输入，不出现在 argv/报告/URL。
2. 真 Electron 起两窗：桌宠 file 页 + 控制台 file 页（生产 controller/handler/preload/视图，`linux-x64` 真实平台）。
3. 控制台输入地址+令牌 → 两窗同一 `agent.id`/name/revision；桌宠发一条 → 控制台与浏览器各出现一次同 ID 消息。
4. 两个任务：停一个，另一个完成；产物经原生保存路径落盘并核对字节；断线时任务显示「未知（上次：运行中）」且发送/停止禁用。
5. 断开→退出桌宠→浏览器看任务完成→重启桌宠（需重新输入令牌）→下载同一产物，字节一致。
6. 键盘/焦点：控制台 880×600、`Esc` 关闭对话框、关闭后焦点回到触发按钮、`.pk-dialog` 关闭时不占位（[components.css:354](../../../../../../packages/ui-kit/src/components.css#L354)、[dialog.tsx:34](../../../../../../packages/ui-kit/src/dialog.tsx#L34)）；桌宠命中区在新增面板展开/收起后各测一次真实点击穿透。
7. 坏令牌、坏 DTO、断流、迟到的旧目标回执各一次，确认不污染新目标、不清草稿。

**诚实边界**：Linux 只证明「新客户端 + 复用的文字 UI + Main 桥 + 真实两窗」；旧档案保留、真实 page/avatar/audio 插件准入、OS 指针/置顶/焦点、Windows TTS/热键仍是 Windows 侧待验，不能用 Linux 截图替代。QA 固定呈现输入必须标注 QA-only，不能当作真实 profile 保存成功。

## 明确不做

新 dashboard/多路由/hash 导航（URL 就是信任边界）、插件市场或通用 RPC、本地 Core 或脚本兜底、把 `CompanionSnapshot` 塞进 `DemoSnapshot`/`ApplicationSnapshot`、历史清空/更早分页/持久暂停/触碰回执/远程引导对话框、语音采集与自动朗读、平台占位。

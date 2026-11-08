# 模型连接的最小交互（前端设计）

只做本阶段：让主人填一次连接、看见真实测试结果、切模式、然后正常用文字和任务。接口以 [implementation-contract.md](../implementation-contract.md) 为唯一来源；本文不新增 API、不扩功能。全文是设计判断，没有启动服务、没有真实模型联通、没有浏览器实测。

## 结论

1. **配置属于 Magpie 连接插件**，界面只呈现"当前选中的连接 + 它的固定三项（地址/模型/鉴权方式）+ 它自己的密钥状态"。不做模型目录、不做插件市场、不做通用插件配置渲染。
2. **两个动作，语义不合并**：「保存并应用」只写配置并切换绑定，**不发一次推理**；「测试连接」只测**已保存并已应用的那一份**，不改草稿、不改模式（[design.md:9](../design.md#L9)、[contract:208](../implementation-contract.md#L208)）。
3. **四个词各自有落点**：已填写（本地表单）／已保存（Config 已写）／正在测试（check 已受理未结算）／测试结果（结算后的 verified/failed + 证据类型）。任何一个都不能顶替另一个。
4. **失败必须显形**：模式停在 `model`、连接显示不可用，绝不回落脚本；聊天里一次普通失败的文案是泛化的（[harness.mjs:222](../../../../../../plugins/harness-cortico/src/harness.mjs#L222-L224) 把所有非取消异常折成 `network`），所以**只有显式测试的结果才配得上"密钥错/模型不存在"这种具体结论**。

## 已有协议能给什么，什么必须等新契约

| 事实 | 现在就有 | 出处 |
| --- | --- | --- |
| 前台是脚本还是模型 | 有（`agent.mode`） | [companion.ts:59-67](../../../../../../packages/contracts/src/companion.ts#L59-L67) |
| 助手可用/忙/不可用 | 有（`agent.status`） | 同上；[runtime.ts:248-255](../../../../../../packages/companion-runtime/src/runtime.ts#L248-L255) |
| 当前 Harness | 有（`agent.harness`） | 同上 |
| 插件挂载与期望启用 | 有（`plugins[]`），但**不含**该插件的配置内容 | [companion.ts:69-75](../../../../../../packages/contracts/src/companion.ts#L69-L75) |
| 连接地址/模型/鉴权方式、Config revision | **没有** | 需 `CompanionModelConnectorView`（[contract:127-135](../implementation-contract.md#L127-L135)） |
| 密钥是否必需/是否可用/来源/版本/可否写入 | **没有**，且绝不能靠猜 | 需 `CompanionModelCredentialView`（[contract:120-126](../implementation-contract.md#L120-L126)） |
| 实际生效的绑定、是否已启用 | **没有** | 需 `applied` / `enabled`（[contract:151-159](../implementation-contract.md#L151-L159)） |
| 显式测试的状态/时间/耗时/证据/固定错误 | **没有** | 需 `CompanionModelCheckView`（[contract:141-150](../implementation-contract.md#L141-L150)） |

`snapshot.model` 是**可选成员**：缺了就是"这个服务没有模型设置能力"，界面直接不给入口；在但读不懂就整条快照作废（[contract:112](../implementation-contract.md#L112)），和现有守卫的严格程度一致（[guards.ts:271-307](../../../../../../plugins/text-client/src/client/guards.ts#L271-L307)）。不要为旧服务造一个空表单。

## 入口与版式

现有一屏只有：令牌门 → 头部（身份+模式+断开+连接行）→ 对话+任务（[app.tsx:30-63](../../../../../../plugins/text-client/src/client/app.tsx#L30-L63)）。**不新开页面、不加侧栏**。

- 头部右侧在「断开」左边加一个「模型」文字按钮，点开 `@pet/ui-kit` 的 `Dialog`（原生 `<dialog>`，自带焦点圈定、Escape、关闭后焦点归还，[dialog.tsx:26-66](../../../../../../packages/ui-kit/src/dialog.tsx#L26-L66)）。
- 对话框里只有一段：当前连接一行摘要 → 连接选择（≤8 个注册项的下拉，[contract:162](../implementation-contract.md#L162)）→ 三项固定字段 → 密钥区 → 底部两颗按钮 + 一行结果。没有标签页、没有第二层弹窗。
- 头部身份行改成三段事实：名字 · 模式（"脚本演示，未调用模型" / "模型回复"）· 连接名。模式文字沿用现有 [chat.tsx:138-150](../../../../../../plugins/text-client/src/client/chat.tsx#L138-L150) 的写法，不新造词。

**390px 的硬问题**：`pk-dialog` 只有 `width: min(440px, 100vw-48px)`，没有 `max-height`/内部滚动（[components.css:354-393](../../../../../../packages/ui-kit/src/components.css#L354-L393)），而模态打开时 `body` 被锁死滚动（同文件 L396）。手机键盘弹出后可视高度常剩 ~450px，四项字段+密钥+状态+按钮必然溢出，底部按钮会顶到键盘后面。text-client 必须自己给内容区一个可滚动容器（`max-height: min(72vh, 100%)` 之类）并让底部按钮常驻，不能改共享 ui-kit。

## 四个状态词各自长在哪

| 词 | 唯一来源 | 界面位置 | 不成立的推断 |
| --- | --- | --- | --- |
| 已填写 | 组件本地表单状态 | 结果行「配置有改动，先保存再测试」+ 保存按钮变为可点 | 不等于已保存，也不让测试按钮可用 |
| 已保存 | `connectors[].configRevision` 与表单提交时的 revision 对比 + 本次响应 | 结果行「已保存」 | 不等于已应用，更不等于能连 |
| 已应用 | `applied` 与 `desired` 的关系 | 结果行「已应用 / 已保存，尚未应用」 | 不等于测试通过 |
| 正在测试 | `check.state === 'validating'`（服务端进程内状态） | 结果行 + 按钮转「正在测试…」 | 不等于会通过；断线时只能说"上次看到在测，现在未知"，不能继续转圈 |
| 测试结果 | `check.state` 的 `verified`/`failed` + `checkedAt` + `evidence` | 结果行固定句式 | `verified` 只对这一份绑定成立；`synthetic` 必须换成"模拟检查通过，未连接真实模型"（[contract:166](../implementation-contract.md#L166)） |

`credential.available` 只表示"鉴权要求已满足"，**不是**推理成功（[contract:108](../implementation-contract.md#L108)）；`agent.status === 'ready'`、插件已挂载、密钥已填，三者都不构成"测过"。

## 主流程（一次走完）

1. **打开**：读 `snapshot.model`。为 `null`/缺失 → 按钮不显示。读不到 → 对话框里一句"暂时读不到模型设置"，无表单。
2. **看现状**：顶部一行摘要，按 `desired.mode` + `applied` + `enabled` 组合出 5 种之一（见文案表）。`settings === null`（自定义连接）→ 只显示连接名、模型名与凭据来源，**不渲染地址/模型输入框**，并说明"这个连接由程序配置，这里只负责选用和测试"（[contract:162](../implementation-contract.md#L162)）。
3. **改**：三个字段预填 `connectors[选中].settings`。改任意字段 → 本地 `dirty`，测试按钮立即禁用（[contract:208](../implementation-contract.md#L208)）。
4. **保存并应用**：发 `POST /api/model`，带 `expectedProfileRevision`、`expectedConfigRevision`、`mode`、完整 `config`（[contract:173-180](../implementation-contract.md#L173-L180)）。HTTP 200 **不等于**"已应用"：契约允许 200 + `enabled=false` + `view.error=not-ready`（缺模型/缺密钥时的正常中间态，[contract:206](../implementation-contract.md#L206)）。若本次还填了远程密钥，紧随其后发 `POST /api/model/credential`，用返回的 revision/version 做 CAS；**两步都成功且最终 view 显示 applied/enabled 才说"已保存并应用"**，只有非secret那步成功就说"配置已保存，密钥没有写入"（[contract:210](../implementation-contract.md#L210)）。
5. **测试连接**：只在**选中的连接就是 `applied.connectorId`**、`dirty === false`、`applied !== null`、鉴权要求已满足、`check.state !== 'validating'`、`phase === 'live'` 时可点。切到另一个连接但还没保存时，测试必须禁用——测试的对象永远是"已应用的那一份"，不是下拉里选中的那一项。发 `POST /api/model/test` 带三份期望版本；202 只表示受理，界面进入"正在测试…"，最终状态靠快照刷新（[contract:204](../implementation-contract.md#L204)）。**503 表示根本没受理**（没有可用绑定或鉴权，[contract:206](../implementation-contract.md#L206)），要显示成"这次没有开始测试"，不能显示成一次失败的测试结果。
6. **读结果**：结果行只写一句，句子里必须同时含"这一份绑定 + 结论 + 时间"。失败给固定码文案（`auth-failed` 身份验证失败 / `rate-limited` 请求过于频繁 / `unavailable` 当前不可用 / `timeout` 操作超时 / `network` 网络不可用），不给原生错误体、不给状态码原文。
7. **正常用**：对话框关掉，回到对话。`agent.mode === 'model'` 且 `status === 'unavailable'` 时，输入框仍可写，但发送会被服务端以 `not-ready` 拒绝（[runtime.ts:289-297](../../../../../../packages/companion-runtime/src/runtime.ts#L289-L297) → [server.ts:371-379](../../../../../../apps/companion-service/src/server.ts#L371-L379) 映射 503）。注意客户端的实际路径：错误码从 JSON envelope 里取出（[protocol.ts:120-122](../../../../../../plugins/text-client/src/client/protocol.ts#L120-L122)），所以最终文案是固定表里的"插件尚未就绪"（[errors.ts:42](../../../../../../packages/contracts/src/errors.ts#L42)），经 [state.ts:129-134](../../../../../../plugins/text-client/src/client/state.ts#L129-L134) 显示成"没有发送成功：插件尚未就绪"。对主人来说这句是错的——插件好好的，是模型连不上。前端应在 `agent.mode === 'model' && agent.status === 'unavailable'` 时把这条 notice 换成"模型当前不可用，检查连接后再发"，其余错误码照旧。这不需要新 API，也不需要改共享错误表。

## 文案表（够用即止）

| 位置 | 文案 |
| --- | --- |
| 头部模式 | `脚本演示，未调用模型` / `模型回复` |
| 摘要：脚本且未配 | `现在用脚本回复。要接真实模型，先选连接并填好地址和模型。` |
| 摘要：已配未应用 | `配置已保存，还没有应用到这个服务。` |
| 摘要：已应用、脚本模式 | `连接已就绪，但服务仍是脚本演示；保存时选「模型回复」才会切换。` |
| 摘要：模型模式不可用 | `模型模式已选，但连接当前不可用。` |
| 摘要：模型模式正常 | `模型回复 · {连接名} · {模型}` |
| 测试按钮 | `测试连接` / `正在测试…` |
| 测试结果·通过 | `{HH:mm} 测试通过：这一份连接返回了真实回复。`（synthetic：`{HH:mm} 模拟检查通过，未连接真实模型。`） |
| 测试结果·失败 | `{HH:mm} 测试没有通过：{固定错误}。` |
| 测试结果·结果未知 | `上次测试的结果没有取到，需要重新测试。` |
| 结果未知（旧命令） | 只在本会话记得自己发过该 commandId 时出现；刷新后回到"未测试" |
| 缺配置 | `还差{模型/密钥}，补上才能测试。` |
| 密钥区（local-client-id / fixture） | `这个连接走本机回环，不需要密钥。` |
| 密钥区（环境注入） | `密钥由服务端环境提供，这里不能改。` |
| 密钥区（可写） | 输入框 + `只用于这一次提交，不保存到浏览器。` + `清除密钥` |
| 密钥区（后端不可写） | `这个入口不允许在这里写密钥，请在宿主上用环境或密钥管理注入。`（loopback/SSH 之外一律如此，含 HTTPS 反代） |
| 保存冲突 | `配置已被别处改过。已重新读取，你刚才的修改还在。` |

## 密钥规则（硬约束）

- 密钥只存在对话框组件的 `useState` 里，和令牌门同一套做法（[connect.tsx:12-15](../../../../../../plugins/text-client/src/client/connect.tsx#L12-L15)）：不进 reducer、不进 `outbox`/待确认历史、不进 URL、不进 localStorage/sessionStorage、不回显。
- 浏览器能写密钥的入口，本阶段只有 loopback 和受控 SSH 转发；远程/反代部署由宿主注入，界面不提供写入（见上一条 `writable`）。
- 提交后立刻清空输入（包括结果不明时）；结果不明不自动重发，改为重新读快照（[contract:210](../implementation-contract.md#L210)）。
- "清除密钥"是显式动作，发 `apiKey: null`；空字符串不等于删除。
- 目标变了（连接/地址/鉴权方式任一变化）旧密钥不可用，界面必须重新要求输入，不能把旧值带过去（凭据绑定"连接 + 完整规范化地址 + 鉴权方式"，见 [contract:106](../implementation-contract.md#L106)）。
- 没有"显示密钥"开关。Linux 服务没有可接受的持久加密（[design.md:59](../design.md#L59)），界面也不能暗示"已保存在这台机器上"。
- **能不能在这里填密钥，只由 `credential.writable` 决定**，不由前端看 URL、Host 或 Origin 猜。本阶段实际只有 loopback 与受控 SSH 入口可写；远程入口（含 HTTPS 反代）一律走宿主侧环境/密钥管理注入，`writable=false`，浏览器写入会 403。false 时密钥区改成一句说明——"这个入口不允许在这里写密钥，请在宿主上用环境或密钥管理注入"——并隐藏输入框与清除按钮，不提供点了会失败的按钮。

## 配置变化与旧结果

- 任一项变化（连接、地址、模型、鉴权方式、密钥、服务重启）后，旧 `verified` 一律作废，界面回到"未测试"，**不能**留着上一次的绿字（[contract:166](../implementation-contract.md#L166)）。
- 规则落在渲染上：结果行只在 `check.binding` 与当前 `applied` 完全一致（connectorId + configRevision + credentialVersion）时才显示为结论；不一致就显示"配置已改变，之前的测试不再适用"。
- 断线时：保留最后确认的摘要，结果行改为"当前状态未知"，测试按钮禁用（沿用 [status.tsx:14-41](../../../../../../plugins/text-client/src/client/status.tsx#L14-L41) 的读法）。

## 正在回复/有任务时切换

- 服务端在 `agentStatus === 'busy'`、有未处理输入、控制忙或测试进行中时直接 `conflict`（[runtime.ts:649-651](../../../../../../packages/companion-runtime/src/runtime.ts#L649-L651)）。界面在 `agent.status === 'busy'` 或 `check.state === 'validating'` 时禁用「保存并应用」，理由写"等这次回复结束"。
- **独立任务在跑不阻止切换**：只有对话前台忙才拦。任务区照常显示，切换后任务 ID、产物、停止按钮都不变（[runtime.ts:533-548](../../../../../../packages/companion-runtime/src/runtime.ts#L533-L548) 的任务身份不随连接变）。
- 保存/应用期间会出现短暂 `agent.status === 'unavailable'`（前台被重建）。界面这几十秒只显示"正在应用…"（本地 in-flight 标记），不要把它渲染成"模型失败"。
- 服务端在边界上仍可能返回 409（`pendingInputs` 前端看不到）：按冲突处理——重读快照、保留草稿、给一次明确提示，不自动重试。

## 需要后端确认的四点（不改 API）

1. **测试对象与表单对象可能不是同一个连接**：表单展示的是"选中的连接"，而契约规定 check 消费的是"已应用的连接"（[design.md:9](../design.md#L9)、[contract:208](../implementation-contract.md#L208)）。保存部分成功时两者会分开。前端处理：摘要里写"已应用：{applied 连接名}"，测试按钮文案带上它（`测试 {applied 连接名}`），避免主人在测 A 却以为在测 B。这不需要新字段。
2. **没有"应用中"状态**：`desired !== applied && error === null` 既可能是"正在应用"也可能是"保存了但配不完整"。前端只能靠自己的 in-flight 标记区分，请求结束后一律按"已保存，尚未应用"显示。如果后端愿意，`CompanionModelView.error` 在应用失败时必须非空，这条要在实现里守住。
3. **重复测试的"结果未知"**：契约要求返回 duplicate receipt 并让界面说"上次结果未知"，但 `check.state` 只有五态、没有 unknown，且检查结果不持久化（[contract:166](../implementation-contract.md#L166)）。当前可行的读法：只在**同一页面会话内**记住自己发过的 test commandId，用它显示"结果未知"；刷新或服务重启后如实回到 configured/unconfigured。若后端希望跨刷新也表达这件事，需要加一个字段——这属于契约变更，先不做。
4. **`enabled=false` 但 `applied≠null`**：脚本模式下允许"连接可用、前台不消费"。界面必须把这两件事分开写（"已应用"与"模型回复在用"各说一次），不能合成一句"已连接"。

## 真实浏览器验收要点（待实现后执行，现在未执行）

1. 未配模型时打开对话框：显示未配置与缺什么，测试按钮禁用且给出原因；全程 0 次网络推理请求。
2. 填写但不保存：出现"有未保存的修改"，测试按钮禁用；关掉再开，字段回到已保存值（不残留草稿）。
3. 保存并应用：结果行先"正在应用"，再"已应用"；期间 `agent.status` 的瞬时不可用不被渲染成失败。
4. 显式测试：点击后进入"正在测试…"，`check.state` 结算后出现带时间的结论；通过时**不**自动把模式改成 model。
5. 错误密钥/不存在模型：结论是固定中文错误，不是脚本回复、不是空白、不是原始状态码；模式仍是"模型回复"。
6. 配置改动后：旧结论消失或标为"不再适用"，不能保留绿字。
7. 密钥：输入框 `type=password`、提交后清空、页面 URL 与 `performance` 资源列表、localStorage/sessionStorage、DOM 属性里都搜不到该值；刷新后需重新输入。
8. 回复进行中点保存：按钮禁用并说明原因；任务在跑时保存：按钮可用，任务区身份/产物/停止不变。
9. 断线（代理黑洞，沿用既有探针做法）后打开对话框：状态未知、测试禁用；重连后回到真实状态。
10. 390×844：对话框内容可滚动、两颗按钮始终可点、`elementFromPoint` 命中按钮而不是遮罩；键盘 Tab 顺序为字段→密钥→保存→测试→关闭，Escape 关闭并把焦点还给头部「模型」按钮。
11. 对话区回归：模式行、发送、停止、下载、离线/重连文案与现状一致（[browser-acceptance.md:11](../../11-07-text-agent-foundation/research/browser-acceptance.md#L11)、窄屏修复见同文 L69-L71）。

## 明确不做

模型目录/自动发现、`/v1/models` 下拉、多连接并行与路由、任务看板、插件市场/上传安装、通用插件配置表单、密钥持久化、保存即测试、失败自动回落脚本、为旧服务造假表单。

## 实施落点（2026-11-08，前端已写）

| 文件 | 内容 |
| --- | --- |
| `plugins/text-client/src/client/model.tsx`（新增） | 对话框：连接选择/服务模式/地址/模型/鉴权/密钥区/结果行；两个动作与禁用条件 |
| `guards.ts` | `parseModelView` 及子结构；`snapshot.model` 缺省可用、坏了整条作废 |
| `protocol.ts` | `saveModel`/`testModel`/`writeModelCredential`，回执 commandId 与视图双重校验 |
| `state.ts` | 不接收命令响应；`model` 只由权威快照更新（单一所有者） |
| `client.ts` | 三个设置动作 + `refresh()`；`newCommandId` 导出复用 |
| `app.tsx` / `chat.tsx` | 头部「模型」入口（仅服务端给了视图时）；身份行补已应用连接名；模型不可用时的输入框提示 |
| `styles.css` | 对话框三行布局（内容滚动、按钮常驻）+ 窄屏规则 |
| `tests/*` | 夹具服务三条模型路由 + 23 个新用例，合计 92 通过 |

与契约的两处判断（不改 API）：

1. **测试按钮的文案带连接名**（`测试 Magpie`），因为下拉可以选到还没保存的连接；按钮本身在 `applied.connectorId !== 选中项` 时禁用。
2. **`view.error` 不当作保存失败弹出**：保存成功但缺模型/密钥时后端会给 `not-ready`，界面改由结果行说明"还没有应用到这个服务"，避免把正常的中间态渲染成报错。

## 第二轮修复（parent review 7 项，2026-11-08）

判断从组件抽到 `src/client/model-form.ts`，组件只接线。7 项全部修复并有真实状态序列回归：

1. **key-only**：`dirtyOf` 分 nonsecret/key；只有密钥时只发 `/api/model/credential`，不做多余的 save。
2. **密钥绑目标**：换连接、改地址或改鉴权方式立刻丢弃已输入的密钥；只改模型名保留（同一份凭据）。重开对话框一律从服务端种子开始。
3. **发起即清空**：`beginOperation` 在任何请求前清空密钥；成功、失败、结果不明都不留，也不自动重发。
4. **不谎报成功**：`savedText`/`summaryText` 读响应视图的 `applied`/`enabled`；「模型模式但前台没切」与「脚本模式」分开说。
5. **草稿冲突**：草稿带 `baseline`（profile/config/credential 版本），保存用草稿基线做 CAS，外部更新得到 409 而不是被覆盖；冲突后草稿原样保留。`aligned()` 现在也比较设置内容，普通刷新不会吞掉正在编辑的字段。
6. **忙时禁用**：`agent.busy`、`validating`、offline 时两颗按钮都禁用并给原因；独立后台任务不参与判断，不阻止切换。
7. **stale check**：`checkText` 要求 `check.binding` 与 `applied` 完全一致才报告结论；`applied=null` 同样判为「连接已变」，不显示旧验证。

契约冲突：**无**。没有新增字段，也没有改 DTO/API 名称；`companion.model.connection@1` 的改名在前端不可见（前端只用 HTTP 视图）。

浏览器 DOM 回归已完成（fixture-backed）：`plugins/text-client/tests/browser/model-dialog.browser.mjs` 用真实 Chromium 点击构建产物，13 项检查覆盖 key-only、发起即清空、换目标丢 key、409 保留草稿、saved-not-applied、模型模式未启用、解绑后无旧验证、关闭后迟到失败、390px 命中与焦点环、外部改版保留草稿。真实点击抓出并修掉 3 个产品问题（草稿跟随判定、成功提示被刷新清掉、409 文案）。

这仍是**夹具**证据：不是真实服务、不是真实 Magpie/上游模型。真实 URL 联调等 backend freeze 后单独做。

## 缺陷记录：密钥提示误用通用 dirty（2026-11-08）

真实服务截图审阅发现：切到「模拟连接（无真实模型）」——该连接 `credential.required=false`、`settings=null`——界面却提示「先把连接保存下来，密钥要按已保存的连接单独填」。

**根因**：`CredentialField` 的「不需要密钥」分支用 `dirty.nonsecret` 决定文案，而这个通用 dirty 包含「换了目标连接」；切换动作把它置真，于是盖掉了本该说的「这个连接不需要密钥」。

**修法**：新增 `pendingAuthChange(draft, view)`，只由**同一已选连接**的已保存 `settings` 与草稿 `settings` 推导「是否正从非 gateway-key 改成 gateway-key」，不看通用 dirty，也不看服务端当前 desired 是否等于草稿目标。无新增状态或接口。

**同时核对了其余文案分支**（当前应用 / 草稿目标 / required·available·writable / pending auth / saved 未 applied / synthetic / conflict·rebase），未发现同类问题；`failed` 结论同样要求绑定归因，已由 `checkText` 保证。

交互契约以 [model settings spec](../../../../../spec/frontend/model-settings.md) 为准，此处只记录该缺陷的根因与修法。

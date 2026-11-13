# QQ 插件管理：界面信息架构与关键状态

只读规划研究，2026-11-12。**未改任何产品源码**，未安装、未运行、未连接 QQ、未调用真实模型。需求见[子 PRD](../prd.md)（Q1–Q12）；协议与 AstrBot 证据见[运行时入口](runtime-entry.md)、[AstrBot 研究](astrbot-qq.md)、[平台选项](platform-options.md)。本文只回答**界面该长什么样、哪些状态必须分清、哪些必须用户决定**，不新造契约、不预设实现。

## 结论

**QQ 的配置界面不需要新页面体系，但需要一个新的"归属层"**：一个 QQ 平台分组下的模块卡片与若干独立域——准入名单、群触发、成员权限、内容与媒体。这些今天在现有 UI 里没有任何对应物，而它们正是 Q7–Q12 的核心。

现有入口的真实分布：

- **桌面 Console** 有插件页（真 enable/disable + 重试）与 Schema 驱动的配置页（CAS + dirty 拦截）。但它的 `runPluginAction`/`inspectConfig`/`saveConfig` 作用在**本机 `activeHost`**（[index.ts:445-463](../../../../apps/desktop/src/main/index.ts#L445-L463)），管的是本机 sources，**管不到服务端 QQ 模块**。它的**交互范式**可复用，权限边界不可直接沿用。
- **服务 Web** 有对话、任务、语音、模型、人格记忆，且**已经在写服务端配置**（`saveModel`/`writeModelCredential`/`saveVoiceSettings`/`saveProfile`，[client.ts:265-390](../../../../plugins/text-client/src/client/client.ts#L265-L390)）。它没有插件管理 UI，但"Web 不能管"不是所有权结论——配置唯一写入权始终在服务端 Config/CAS，两个 UI 不等于两个 owner。
- **服务端**只有 `GET /api/plugins` 与 `POST /api/plugins/{id}`（[server.ts:355](../../../../apps/companion-service/src/server.ts#L355)、[:453](../../../../apps/companion-service/src/server.ts#L453)），**没有 QQ 配置的读取/保存路由**。这是真正的通道缺口。

**管理入口已由 Q14 定案：服务 Web 是完整管理面，桌面只显示状态与打开 Web 的入口。** 所以本文不再给候选，具体界面规划见 [Web 主管理界面规划](ui-plan.md)。不受选择影响的一条仍然成立：**普通 QQ 成员永远看不到管理面**。

## 一、现有可复用的入口与控件（源码事实）

| 现有物 | 位置 | 可复用什么 | 不能复用什么 |
| --- | --- | --- | --- |
| 插件页 | [plugins.tsx:163](../../../../apps/desktop/src/renderer/console/pages/plugins.tsx#L163) | 真 `enable/disable`、`busy`、失败重试、`desiredActive` 与 `state` 分开显示 | 它按"一个插件一个开关"设计，装不下"一个模块两协议 + 四个策略域" |
| 插件配置页 | [plugin-config.tsx:24](../../../../apps/desktop/src/renderer/console/pages/plugin-config.tsx#L24) | **Schema 驱动**、`dirty` 拦截切页、冲突处理、错误摘要聚焦 | 它是扁平字段表单，装不下名单列表、概率、模型选择这类结构化编辑 |
| 声音卡 | [shared-speech-settings.tsx](../../../../apps/desktop/src/renderer/console/minimal-ui/shared-speech-settings.tsx) | "本机/远端两个 source 分两行说清"的呈现范式 | — |
| 语音输入卡 | [voice-card.tsx](../../../../apps/desktop/src/renderer/console/pages/voice-card.tsx) | 提供者/就绪/原因三段式、独立保存域 | — |
| 模型连接 | [model.tsx](../../../../plugins/text-client/src/client/model.tsx) | 凭证可写性、连接测试、已保存≠已应用 | 不要把 QQ 账号塞进模型连接 |
| ui-kit 控件 | [controls.tsx](../../../../apps/desktop/src/renderer/console/minimal-ui/controls.tsx) | `Button/Card/Field/Select/Switch/Status` 已够用 | — |

**结论：不需要新控件体系。** 需要的是一个新的组合方式：一个模块卡 + 若干子域 + 一个名单编辑器。

## 二、信息架构建议

一个 QQ 条目，不拆成两个插件页条目。理由：Q1 已定"两个可选协议模块指向同一个 Agent"，用户心智是"我接了一个 QQ"，不是"我装了两个 QQ 插件"。协议是**这个条目里的选择**，不是并列的两个产品。

```
QQ 接入                                  [状态: 已连接 / 未配置 / 已停用]
├─ 协议模块        ○ 官方 QQ WebSocket   ○ OneBot v11        ← 二选一，可换
├─ 连接与凭证      AppID/Secret 或 OneBot 地址+token         ← 独立保存域
├─ 准入名单        私聊白名单 [多人]      群白名单 [多群]
├─ 群触发          @ / 唤醒词 / 主动回复（开关+频率+机制）
├─ 成员权限        普通成员 / 主人（分级）
└─ 内容与媒体      text（必有）/ image / voice（附加）/ file
```

### 每个域的职责边界

**协议模块**：Q1 已定首版**两条都支持**。界面建议是**同一平台分组下的两张模块卡片**（官方 QQ WebSocket / OneBot v11），各自有独立的启用开关与连接状态——这既满足"两条都支持"，也让"我现在到底走哪条路"永远可见。若只启用一张，另一张显示"未启用"而不是消失。

**这与"多账号"是两个不同问题。** 两张卡片 = 两种协议各一个实例；同时连多个账号 = 同一协议下多个实例。后者受当前 host 的默认单实例约束（服务端目前固定 `default` 实例，见[运行时入口的注册表](runtime-entry.md#L50)），**本阶段未选**，界面上不应预留多账号槽位，也不要把"两张卡片"说成"多账号已支持"。

**连接与凭证**与协议模块**同一张卡但不同保存域**：协议是配置（CAS），凭证是 secret（CredentialBroker）。QQ AppSecret、派生 access token、OneBot token 都必须**独立于** text/ASR/TTS/DSH/AstrBot 凭据——[AstrBot 研究的复用表](astrbot-qq.md#L163)把"token/secret 鉴权"列为应复用现有 CredentialBroker 的专属 owner/key slot，而不是共享既有 key。界面上不能出现"复用模型 key"这种选项。

**准入名单**是 Q7 的核心。两个列表形状不同，不能合并：
- 私聊是**人**（openid / QQ 号），一行一个人；
- 群是**群**，一行一个群。

**空集合 = 无人准入**，这是 Q7"白名单 + 指定群"这个选择本身的语义，不是需要再问的默认值。AstrBot 的"空白名单=不检查"（fail-open）是它自己的行为，本产品不沿用它。界面上应把这条写出来（例如空列表下方一行"当前没有任何人/群被允许，QQ 消息不会被处理"），让人不会误以为留白等于不限。

**群触发**是 Q10。三类触发（@、唤醒词、主动）要能分别开关。主动回复还要有频率/概率与机制——**Q11 已定两种机制都提供**：规则/概率门控与可选的 Magpie 模型 judge，不是二选一。所以界面上这组字段是"主动回复：开/关 → 机制：规则概率 / 模型判断（可叠加或择一，取决于设计）→ 各自的参数与预算"。模型 judge 需要模型选择与调用预算，属独立的配置域，不要和回复生成混在一张表单里。这里最容易做成"一个滑块解决一切"，实际是多个独立决定。

**成员权限**是 Q8。普通成员与主人是**两种能力集**，不是两个标签。界面上要说清各自能做什么：普通成员能用受限工具、能建/看/停自己的 work；主人能做全局配置与跨用户管理。**群管理员身份不等于 Agent 主人**——AstrBot 用裸 sender ID 精确匹配 admin，而不是读 QQ 群主/管理员身份（[astrbot-qq.md:192](astrbot-qq.md#L192)），本产品也应如此，界面上不能暗示"群主自动是主人"。

**内容与媒体**是 Q12，形态由 Q16 收口：**文字恒有且不可关**；语音是**附加**输出，不是替代。所以界面不能出现"语音回复"这种听起来像二选一的开关，只能是"额外发送语音"。

四项的平台限制不同（官方 QQ 与 OneBot 对图片/语音/文件的支持并不一致），界面上应按**当前所选协议**显示真实支持情况，而不是列四个勾选框假装都能用。

## 三、必须分清的状态层次

这是本文最重要的部分。Q4 已要求"输入接受、Core 工作、发送尝试、平台回执、实际送达"分开，界面上不能合并成一个"已发送"。

| 层次 | 事实来源 | 界面该说什么 | 绝不能说什么 |
| --- | --- | --- | --- |
| 配置已保存 | Config CAS 返回 | "已保存" | "已生效" |
| 连接已应用 | 实际 WS 握手 + READY | "已连接"（含账号/协议） | "已登录 QQ"（OneBot 下登录归外部实现） |
| 消息已接受 | canonical `acceptMessage` | "已进入处理" | "已回复" |
| 发送尝试 | adapter 调用 | "正在发送" | "已送达" |
| 平台接受 | 平台 API 的**真实回包** | "平台已接受" / "平台拒绝" / "结果未知" | 任何"已送达/已读" |
| 实际送达/已读 | **今天没有这个事实** | 不要显示 | 任何"已送达/已读" |

**这里要纠正上一版的过度推论。** 我写过"发送成功在协议层就不成立"——**不对**。协议层**有**接受回执：

- OneBot 规范：`status=ok,retcode=0` 表示操作成功，同步结果是 `data.message_id`；`status=async,retcode=1` 表示仅提交异步处理、成功失败无法获知；`failed` 是失败（[astrbot-qq.md:124](astrbot-qq.md#L124)）。
- 官方 QQ：botpy 把 HTTP 200/202/204 视为成功并返回解析内容，需要自己校验业务响应形状与错误码（[astrbot-qq.md:118](astrbot-qq.md#L118)）。

真正的问题在于 **AstrBot 把这些回执丢弃了**：官方路径 `send()` 不向调用者返回结构化回执、异常被 catch 后返回 `None`；OneBot 路径 `_dispatch_send()` 的返回值直接丢弃（[astrbot-qq.md:110-122](astrbot-qq.md#L110-L122)）。所以本产品要做的不是"放弃回执"，而是**不要沿用 AstrBot 的丢弃语义**，把协议已有的 `ok/async/failed` + `message_id` 如实区分出来。

**但即便有 `message_id`，那也不是收件人确认**——规范明确它不是"已收到"（[astrbot-qq.md:124](astrbot-qq.md#L124)）。所以界面可以标"平台已接受/已拒绝/未知"，**不能**标"用户已收到/已读"。

**另一组必须分清的是身份**，至少五种（[astrbot-qq.md:100](astrbot-qq.md#L100)）：Agent 身份、平台实例/bot account、聊天目标/发送者、上游事件/消息 ID、网关恢复 session。界面上：

- 私聊显示**人**（昵称 + 可辨识 ID），不显示 session；
- 群聊显示**群**，不显示"会话"；
- **绝不向普通使用者暴露 Session/会话切换**——R12 已定用户不该管理 Session。QQ 用户看到的应是"和同一个助手说话"，不是"当前会话 abc123"。

## 四、服务 Web 与桌面入口的最小增量

### 桌面 Console（只显示状态 + 打开 Web 入口）

Q14 已定桌面不做管理面。桌面插件页今天管的是**本机 `activeHost`**（[index.ts:445-463](../../../../apps/desktop/src/main/index.ts#L445-L463)），本来就管不到服务端 QQ，所以这不是削减，是与它的实际边界一致。

桌面只做两件事：显示 QQ 连接状态、提供一个打开服务 Web 管理页的入口。**入口不得携带 owner token**——现有令牌生命周期是"这次连接"，明确不写 URL、不写 web storage。

### 服务 Web（完整管理面）

Q14 已定。Web 今天已在写服务端配置（`saveModel`/`writeModelCredential`/`saveVoiceSettings`/`saveProfile`，[client.ts:265-390](../../../../plugins/text-client/src/client/client.ts#L265-L390)），所以"Web 管理"不是新的所有权模型。

真正的缺口是**服务端没有 QQ 配置路由**（只有 `GET /api/plugins` 与 `POST /api/plugins/{id}`，[server.ts:355](../../../../apps/companion-service/src/server.ts#L355)、[:453](../../../../apps/companion-service/src/server.ts#L453)），以及 `CompanionPluginView` 字段不足。这是通道缺口，归 GPT。

具体分区、控件复用、状态落点见 [Web 主管理界面规划](ui-plan.md)。

## 五、没有遗留的产品决定

Q14/Q15/Q16 收口后，本文不再有待用户拍板的产品选择。剩下的只是表达方式（例如"普通成员不能改记忆"这句话放成员区还是放公开 facts 操作处），属实现细节。

### 已由用户决定、不再列为未定

- **触发机制**：Q11 已定规则/概率与 Magpie judge **都提供**，不是二选一。界面按"开关 → 机制 → 各自参数与预算"组织即可。
- **空名单语义**：Q7 选了白名单 + 指定群，空集合即无人准入，不再征询是否允许全员。
- **两条协议**：Q1 已定首版都支持，界面是两张模块卡片。
- **多账号**：属另一问题，当前 host 单实例约束下**未选**，界面不预留。
- **管理入口**：Q14 已定 Web 主管理、桌面只状态与入口。
- **长期记忆写入**：Q15 已定只 owner/admin，普通成员不可写（含自己 scope）。
- **文字与语音**：Q16 已定文字恒有、语音是附加输出，不做 voice-only。

## 六、技术 handoff（只记录，归 GPT）

- **H1 归属字段**：`CompanionMessageCommand` 只有 `{commandId,text}`，无平台/发送者/会话/回复目标。界面上要显示的"谁在哪个群说了什么"目前**无处可取**。这是 QQ 的前置依赖，不是 UI 能补的。
- **H2 多输入折叠**：普通回复只保留 `inputIds[0]`。多人同时说话时，回复归属会丢失——界面上若显示"回复给某人"，需要先有这个事实。
- **H3 任务来源**：`startTask` 丢弃 origin，任务没有发起人或受众。Q8 的"看/停自己的 work"因此**今天无法实现**，需要新契约。
- **H4 平台回执契约**：协议层有 `ok/async/failed` 与 `message_id`，但本产品**没有承载它的契约**（adapter 返回值今天无处落）。要做"平台已接受/拒绝/未知"，需要新契约；"用户已读"则根本没有来源，见第三节。
- **H5 插件配置是否支持结构化列表**：现有 Config Schema 是否足以表达"名单数组 + 概率 + 模型引用"，归 GPT 核；若不足，是要扩 Schema 还是走别的通道，不能在 UI 里自己发明。
- **H6 QQ 配置的服务端通道**：服务端只有 `GET /api/plugins` 与 `POST /api/plugins/{id}`，**没有 QQ 配置的读取/保存路由**；`CompanionPluginView` 也只含 id/name/state。Q14 已定 Web 主管理，所以这条必须补。这是通道缺口，不是所有权问题。

## 七、非目标

不新增页面体系、不重做导航、不设计通用 channel 框架、不预设协议实现、不在规划阶段连 QQ 或跑真实模型。管理面在 Web（Q14），桌面只有状态与入口。媒体能力（Q12）的平台差异需要按协议实测后才能写进界面，现在只能标注"待验证"。

## 八、冻结

以上为界面信息架构，不构成实施批准。Q14/Q15/Q16 已收口；服务端 QQ 配置路由与视图字段就绪前，界面无法落地。具体 Web 分区见 [Web 主管理界面规划](ui-plan.md)。

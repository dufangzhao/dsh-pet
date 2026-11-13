# AstrBot QQ / OneBot v11 公开源码研究

研究日期：2026-11-12（Asia/Shanghai）。结论用于 M6 需求与设计收敛，不构成实施批准，也不替用户选择首版 transport scope。

本轮只读本项目契约、已有研究和公开原始资料；未读取本机 AstrBot 的环境、账号、配置、数据或凭据，未安装、运行 AstrBot、登录或发送消息。初始范围是只返回报告，后经 Parent 明确授权，仅新增本文。外部检索使用 Anysearch，10 个成功 search 子查询已全部提交评分。

## 1. 结论与版本证据

AstrBot 的官方 QQ 与 OneBot v11 是不同的接入实现，不是换一组账号配置即可互换的同一协议：

- 官方 QQ：AstrBot 自己作为 QQ Bot API 客户端；事件可用出站 WebSocket，也可用入站 HTTPS Webhook；发消息仍调用官方 HTTPS API。
- OneBot v11：AstrBot 作为反向 WebSocket 服务端，外部 OneBot 实现连接它，负责平台登录、QQ 协议和消息 API。OneBot 是接口标准，支持该标准不等于拥有 QQ 官方机器人身份或官方权限。
- 可借鉴的是 adapter 的接收/归一化/发送边界、实例身份、协议字段、连接关闭和消息组件转换经验。本项目应以自己的普通插件、Kernel/TaskSupervisor/Permission/Credential 和既有 canonical state 重新实现，不能搬入另一套 PlatformManager/EventBus/ConversationManager。
- AstrBot 的 `send()` / `send_by_session()` 多为 `None` 返回，部分异常会被吞掉或触发主动发送 fallback；不能据此建立本项目的交付事实，更不能把 HTTP 200、API 返回消息 ID、日志 `response_sent` 当作用户收到或已读。

| 证据 | 固定点与适用范围 |
| --- | --- |
| 当前主分支 | [commit 2c3ee62b15eb0d329f608481002bed5fc45e84e7][head]，提交时间 2026-11-12T04:51:26Z。下文 AstrBot 源码链接全部固定该 SHA。 |
| 最新公开 release | [v4.29.4][release]，发布于 2026-10-31；[tag ref][tag-ref] 解析到 `61335414433db721b3f7ecc93f90deafe0a59d78`。已额外直接复读该 tag 的 [QQ adapter][release-qq]；全量群消息 handler、主动发送分支、受控 shutdown 在发布版已经存在，不应称为仅 master 新能力。 |
| 依赖声明 | [pyproject.toml][pyproject] 仍声明项目版本 4.29.4，`qq-botpy==1.2.1`、`aiocqhttp>=1.4.4`；版本字符串不能替代 commit。未声称已核验任一实际部署的 lock/install 状态。 |
| qq-botpy 参考 | [v1.2.1 ref][botpy-ref] → `8d766f17f9a15d94e9e1668377c5c9f0e8235c96`。这是 AstrBot 精确声明的 SDK 版本参考，不是本项目依赖选择。 |
| aiocqhttp 参考 | [v1.4.4 ref][aiocqhttp-ref] → `2520928d2373f5be71059600b832e230a39ccdb9`。它满足 AstrBot 的版本下界；下文 SDK 内部行为明确限定此版本。 |
| OneBot v11 规范 | [master ref][onebot-ref] → `d4456ee706f9ada9c2dfde56a2bcfc69752600e4`。官方文档站抓取失败后，读取规范维护仓库的原始 Markdown，最终链接固定此 SHA。 |
| QQ / AstrBot 官方文档 | 本次读取的在线页面，未取得不可变文档 commit；作为 2026-11-12 的公开说明，不能声称其等于某次账号运行验收。 |

## 2. 文件、入口与注册

| 实现 | 精确源码位置与入口 |
| --- | --- |
| 官方 QQ WebSocket | [astrbot/core/platform/sources/qqofficial/qqofficial_platform_adapter.py][qq-adapter]：`@register_platform_adapter("qq_official", ...)`；类 `QQOfficialPlatformAdapter`；`run()` → `self.client.start(appid=self.appid, secret=self.secret)`；`create_event()` → `QQOfficialMessageEvent`。 |
| 官方 QQ 消息/发送 | [astrbot/core/platform/sources/qqofficial/qqofficial_message_event.py][qq-event]：`QQOfficialMessageEvent.send`、`_post_send`、`_post_send_one`、`post_c2c_message`、`send_streaming`、`_send_with_markdown_fallback`。 |
| 官方 QQ Webhook | [astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_adapter.py][webhook-adapter]：`@register_platform_adapter("qq_official_webhook", ...)`；`QQOfficialWebhookPlatformAdapter.run`、`webhook_callback`、`terminate`。 |
| Webhook 服务 | [astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_server.py][webhook-server]：`QQOfficialWebhook.initialize`、`handle_callback`、`webhook_validation`、`_verify_qq_webhook_signature`。 |
| Webhook 事件复用 | [astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_event.py][webhook-event] 的 `QQOfficialWebhookMessageEvent` 直接继承官方 QQ 消息事件；收消息归一化也复用 WebSocket adapter 的 `_parse_from_qqofficial`。 |
| OneBot v11 | [astrbot/core/platform/sources/aiocqhttp/aiocqhttp_platform_adapter.py][onebot-adapter]：`@register_platform_adapter("aiocqhttp", ..., support_streaming_message=False)`；类 `AiocqhttpAdapter`；`run()` → `self.bot.run_task(...)`；`create_event()` → `AiocqhttpMessageEvent`。 |
| OneBot 发送 | [astrbot/core/platform/sources/aiocqhttp/aiocqhttp_message_event.py][onebot-event]：`_parse_onebot_json`、`_dispatch_send`、`send_message`、`send`、`send_streaming`。 |
| 公共注册与加载 | [register.py][register] 的 `register_platform_adapter` 写 `platform_registry` 和 `platform_cls_map`，记录 `module_path`；重复名称拒绝；`unregister_platform_adapters_by_module` 支持清理插件注册。[manager.py][manager] 的 `PlatformManager.load_platform` 按 `platform_config.type` 导入上述 built-in 类，再用 map 实例化并启动 task。 |
| 公共消息入口 | [platform.py][platform] 的 `Platform.commit_event` 调用 `_event_queue.put_nowait(event)`；[event_bus.py][event-bus] 的 `EventBus.dispatch` 选择配置、处理 session isolation、启动 pipeline。 |

这证明 AstrBot 有自定义平台扩展接口，但其内置加载分支、Python 全局注册表和任务循环不是本项目需要再建的模块。本项目的“可插拔”应落实在现有 `PluginDefinition` 注册、owner generation、capability 与 disposer 上。

## 3. 连接方向、鉴权与断开

### 官方 WebSocket

[QQ adapter][qq-adapter] 读取 `appid`、`secret`、`enable_group_c2c`、`enable_guild_direct_message`；构造 `botpy.Intents(public_messages, public_guild_messages, direct_message, interaction)`。`public_messages` 对应群/C2C，`public_guild_messages` 是频道 @ 消息，不能将“频道全量消息”与“QQ群全量消息”混为一谈。

[QQ 官方鉴权文档][qq-auth] 当前要求：

- `POST https://api.bot.qq.com/app/getAppAccessToken`，请求 `appId`、`clientSecret`，响应 `access_token`、`expires_in`。
- HTTPS API 使用 `Authorization: QQBot ACCESS_TOKEN`；通常有效期为 7200 秒，接近过期的 60 秒有新旧 token 重叠规则。
- [事件协议][qq-events]：先取得 `/gateway` 或 `/gateway/bot` 的 WSS 地址；客户端收到 `op=10 Hello` 后发 `op=2 Identify`，携带 `token`、`intents`、`shard`；`READY.d.session_id` 是连接恢复身份。心跳携带最近 `s`，恢复用 `op=6 Resume` 的 `session_id/seq`；`op=7` 要求重连，`op=9` 表示 session 无效。

不要照搬旧 SDK 固定域名。[botpy/robot.py][botpy-token] 的 `Token.update_access_token` 使用旧地址 `https://bots.qq.com/app/getAppAccessToken`；[botpy/http.py][botpy-http] 的 `Route.DOMAIN` 为 `api.sgroup.qq.com`，另有 sandbox 域名，并发送 `X-Union-Appid`。它们说明 pinned SDK 实现，不证明旧地址是当前首选或永远可用。新实现应以当前官方文档和后续明确授权的验收为准。

断开实现：[QQ adapter][qq-adapter] 的 `botClient.bot_connect` 追踪 `_active_websockets`；`ManagedBotWebSocket.on_closed` 在 shutdown 时禁止重连；`close` 关闭 native connection；`botClient.shutdown` 设 `_shutting_down`、关闭活动连接并 `client.close`；adapter `terminate` 等待它。[SDK gateway][botpy-gateway] 的 `on_closed`、`ws_identify`、`ws_resume` 管理 token 重置和恢复，但 SDK 心跳使用固定 30 秒，且 sequence 在 parser 处理前更新；不能把这套实现当成“业务已持久接收/绝不丢消息”的证明。

### 官方 Webhook

QQ → 可公网访问的 HTTPS callback；发消息仍是本方 → QQ HTTPS API。AstrBot [Webhook 教程][webhook-doc] 推荐统一回调；[Platform.webhook_callback][platform] 注释给出统一入口 `/api/platform/webhook/{uuid}`；独立 helper 则注册 `/astrbot-qo-webhook/callback`，默认内部端口 6196。

[Webhook helper][webhook-server]：

- `op=13` 用 `d.event_ts + d.plain_token` 生成 Ed25519 签名，返回 `plain_token/signature`。
- 普通回调用 `X-Signature-Timestamp`、`X-Signature-Ed25519` 验证原始 body；secret 重复/截取到 32-byte seed；签名不合法返回 401。
- `handle_callback` 以顶层 `id` 做 60 秒进程内去重，然后通过 botpy parser dispatch，返回 `{"opcode":12}`。
- 该去重在持久业务提交前记录，重启即丢失；函数没有校验签名 timestamp 新鲜度。`op=12` 仅是回调接收确认，不能视为 Core 已处理、回复发送成功或用户收到。
- `terminate` 设置 shutdown event、关闭 client、停止独立 server；server shutdown 异常会被记录并继续，不足以替代本项目的 cleanup 证据。

### OneBot v11 反向 WebSocket

[AstrBot 教程][onebot-doc] 明确 AstrBot 是 server，协议实现是 client；默认 `ws(s)://<host>:6199/ws`。配置字段是 `ws_reverse_host`、`ws_reverse_port`、`ws_reverse_token`。[adapter][onebot-adapter] 构造 `CQHttp(..., api_timeout_sec=180, access_token=ws_reverse_token)`，监听 group/private message、notice、request 和连接 lifecycle。

[OneBot 原始规范][onebot-reverse]：握手 `X-Self-ID` 为机器人 QQ 号，`X-Client-Role` 为 `API|Event|Universal`；Universal 在一条连接上同时收事件与 API 结果。断线重连由协议实现客户端发起。[鉴权规范][onebot-auth] 是握手 `Authorization: Bearer <access token>`；[aiocqhttp 1.4.4 `_handle_wsr`][aiocqhttp-init] 同时接受 Token/Bearer，缺 header 返回 401、不匹配返回 403，未配置 token 则不检查。

协议调用帧是 `action/params/echo`，结果为 `status/retcode/data/echo`；`echo` 是关联标识，规范没有赋予它发送幂等键语义。见 [WebSocket 规范][onebot-ws]。

[aiocqhttp 1.4.4][aiocqhttp-init] 同时注册 `/ws`、`/ws/api`、`/ws/event`，也额外注册 HTTP `POST /`；后者使用另一项 `secret` 校验 HMAC，而非 WS access token。AstrBot 这里只传 access token。因此新插件应只暴露已设计的入口和方法，不能照搬 SDK server surface 后假设一个 WS token 保护了全部路由。

[adapter 的 `terminate/_close_reverse_ws_connections`][onebot-adapter] 设置 shutdown event，关闭 API/Event socket（code 1000），清理 client maps；close 的部分异常被忽略、gather 使用 `return_exceptions=True`。本项目应明确实际 server/socket/回调工作是否已 drain。连接日志本身也不能证明 QQ 已在线或本次发送成功。

## 4. 消息归一化与身份

| 来源 | AstrBot 对应字段与处理 |
| --- | --- |
| 官方 QQ 群 @ / 全量消息 | [botClient.on_group_at_message_create/on_group_message_create][qq-adapter] → `_parse_from_qqofficial`。`GROUP_MESSAGE`；`group_id=session_id=message.group_openid`；sender=`author.member_openid`。旧 @ 事件强制 At；全量事件依据 `mentions[].is_you` 识别机器人 mention。 |
| 官方 QQ C2C | `on_c2c_message_create`；`FRIEND_MESSAGE`；sender/session=`author.user_openid`；`self_id` 可为占位 `unknown_selfid`，不能当真实 bot account。 |
| 官方频道 / 频道私信 | `on_at_message_create` 使用 `channel_id` 作为 group/session；`on_direct_message_create` 使用 `author.id` 作为 sender/session。事件回复时频道私信实际还需要 `guild_id`。 |
| 官方消息内容 | `AstrBotMessage.message_id=message.id`；组件有 `Plain/At/Image/Record/Video/File/Reply`；`_set_raw_message_fields` 保留 `raw_data/message_type/msg_elements`；`message_type=103` 的引用元素可转换为 Reply。归一化的 `timestamp=int(time.time())` 是本地处理时间，不是原始发送时间。 |
| OneBot 消息 | [convert_message/_convert_handle_message_event][onebot-adapter] 取 `self_id`、`sender.user_id`、`sender.card` 或 nickname；group→`GROUP_MESSAGE` + `group_id`，private→`FRIEND_MESSAGE`；session 为 group ID 或 sender ID；`message_id` 转字符串；要求 message segment array，不接受 CQ 字符串作为该实现的正常输入。 |
| OneBot 段处理 | text/at/reply/file 等转换为组件；reply 会再调 `get_msg`，file URL、群成员/陌生人资料可能再调 action。部分不支持段/查询异常仅记录并忽略；不应据此把降级后的文本称为原消息完整保真。 |
| OneBot notice/request | 生成空文本/空组件事件（poke 可有 Poke），`message_id=uuid.uuid4().hex`；这个本地产生的 ID 不是上游稳定去重身份。 |

[MessageSession][session] 的 `platform_name` 自 v4 起实际装的是**平台适配器实例 ID**，不是 `qq_official/aiocqhttp` 类型名；`platform_id` 由它派生。字符串 UMO 为 `platform_id:message_type:session_id`。[AstrMessageEvent][astr-event] 的 `unified_msg_origin` 返回这个字符串。

[EventBus._apply_session_isolation][event-bus] 在 `platform_settings.unique_session=true` 且群消息时，通过 `UNIQUE_SESSION_ID_BUILDERS` 将官方 QQ、Webhook、OneBot 的 session 改成 `sender_id_group_id`。所以“一个群一个 conversation”不是无条件事实。发送 adapter 再取最后一个 `_` 后的 group ID；本项目宜保留结构化 target，不照搬字符串拆装。

[ConversationManager][conversation] 明确区分 session 与 LLM conversation：`new_conversation(umo)` 生成独立 UUID；`session_conversations[umo]` 和 `sp.session_put(umo,"sel_conv_id",cid)` 保存当前选择，支持切换。它不做跨平台人员自动识别。

必须区分至少五种身份：本项目 Agent/canonical identity、外部平台实例及 bot account、聊天目标/发送者、上游事件/消息 ID、网关恢复 session。OneBot `self_id` 需要参与实例绑定与路由；当前 AstrBot UMO 本身不含它，复用一个实例接多 bot 不能自动保证会话隔离。官方 `member_openid/user_openid` 与 OneBot QQ 数字 ID 也不能直接等同。QQ [FAQ][qq-faq] 说明 `union_openid` 另有同主体绑定要求；其缺失不能靠昵称推定同一人。

官方 [群事件][qq-group-event] / [C2C 事件][qq-c2c-event] 还有 `message_scene.ext`：`msg_idx/ref_msg_idx` 用于引用，`auth_token` 是鉴权信息。附件 URL 也可能带临时授权参数。只投影必要且脱敏的来源/引用字段，不把 raw event、整个 ext 或媒体 URL 直接写日志、记忆或模型上下文。

## 5. 发送回执、异常和未知结果

### AstrBot 官方 QQ 路径

[QQOfficialMessageEvent][qq-event]：

- `send()` 只设置 `send_buffer` 并等待 `_post_send()`，没有向调用者返回结构化发送回执。
- `_post_send_one()` 按源选择 `post_group_message`、自定义 `post_c2c_message`、频道 `post_message`、频道私信 `post_dms`；填 `msg_id` 或 interaction `event_id`，非频道随机生成 `msg_seq`；多媒体可能拆成多次发送。
- `_send_with_markdown_fallback()` 捕获 Forbidden/MethodNotAllowed/NotFound/SequenceNumber/ServerError 后，可能去掉 `msg_id/event_id` 改成主动发送，再在指定条件下调整流尾换行或退化 plain text。这个行为改变发送方式和权限前提，不能作为本项目默认恢复策略。
- `post_c2c_message()` 对 ServerError/SequenceNumber/OSError/timeout/None 等有最多 3 次重试；耗尽 None 重试或非 dict 响应后可返回 None。上传还各有重试，上传成功也不等于消息发送成功。
- `send_streaming()` 仅 C2C 真正流式，其余累积后发送；payload 包含 `state/id/index/reset`，结束 `state=10`。异常被 catch 后记日志、清 buffer 并返回 None，且基类发送操作标志已提前设置；不提供可靠的终端交付成功状态。
- [adapter `_send_by_session_common`][qq-adapter] 使用进程内 `_session_scene` / `_session_last_message_id` 路由；缺信息时可 warning+return；C2C 主动发送移除 msg_id；群主动分支依赖 scene 缓存。返回的 `id` 只缓存，不返回给上层。事件回复支持频道私信，不代表这种仅有 `FRIEND_MESSAGE+session_id` 的主动路由足以正确区分频道私信与 C2C。
- [AstrMessageEvent.send][astr-event] 的 `response_sent` trace、`_has_send_oper=true` 记录发送操作；[Platform.send_by_session][platform] 主要记录 metric，都不是用户收取回执。

SDK 亦有影响：[botpy `_handle_response`][botpy-http] 将 HTTP 200/202/204 视为成功并返回解析内容，异常主要按 HTTP status 映射；`BotHttp.request` 对 timeout 可仅记录后返回 None。因此本项目需自己校验业务响应形状、错误码、消息 ID 和请求对应关系，保留可用的安全 trace ID，不能只看 HTTP status 或“无异常”。

### AstrBot OneBot 路径

[OneBot event][onebot-event] 的 `_dispatch_send()` 调 `send_group_msg(group_id, message)` 或 `send_private_msg(user_id, message)`，事件回复时带 `self_id`；`send_message()` 对普通链、转发、文件分别发送，返回值均被丢弃。[adapter `send_by_session`][onebot-adapter] 没有 event，bot account 选路依赖依赖库可用连接，不能照搬到本项目的多实例环境。

[规范 HTTP 响应][onebot-http] 明确：除鉴权/格式/接口等错误外，操作成功与失败都可 HTTP 200；`status=ok,retcode=0` 表示操作成功；`status=async,retcode=1` 仅提交异步处理，成功失败无法获知；`failed` 是失败。[标准发送 API][onebot-api] 的同步结果是 `data.message_id`，不是收件人确认。

[aiocqhttp 1.4.4 api_impl][aiocqhttp-api]：`WebSocketReverseApi.call_action` 发送 `echo:{seq}`；`ResultStore.fetch` 超时抛 `NetworkError`；没有合适连接抛 `ApiNotAvailable`；`_handle_api_result` 只对 `status=failed` 抛 `ActionFailed`，其他情形返回 `data`。也就是说调用层可把 async/null 走成正常返回，AstrBot 再丢弃它，不能沿用这种布尔式成功语义。

### 本项目应保留的事实层次

可将“尚未尝试/已被明确拒绝”“平台 API 已接受且有上游消息 ID”“结果未知”“另有明确的投递或阅读证据”区分；具体 DTO 留给设计。这里没有找到可把上述发送 API 回包解释为用户已收到/已读的契约。

发送后断链、超时、进程退出或本地取消，可能发生远端副作用而本地没有结果；必须保留 unknown，不自动重发或把取消记录成从未发送。OneBot echo 只是关联，QQ `msg_id+msg_seq` 是特定被动回复的去重规则，二者均不能替代本项目 durable command/effect identity。随机换 msg_seq、重新生成请求 ID、删掉 msg_id 转主动都不能用于清除不确定性。

## 6. 官方权限与当前文档冲突

平台最新官方规则优先于旧框架教程和源码注释；不同场景不混用限额。

| 主题 | 当前原始证据与含义 |
| --- | --- |
| 个人/企业使用范围 | [QQ FAQ][qq-faq]：企业主体公开使用已开放；个人主体暂不支持公开使用。个人机器人创建者可添加自己为群主/管理员的群，私聊可配开发体验用户。不是“任意 QQ 用户都能使用”的入口。 |
| 测试环境 | 同一 FAQ：新管理端管理员可直接测试，无需旧沙箱；旧管理端不再支持添加沙箱群/频道。AstrBot [WebSocket 教程][qq-doc] 仍有手动申请沙箱 ≤20 人等旧内容，应标为历史流程而非当前硬限制。 |
| 群全量输入 | [GROUP_MESSAGE_CREATE 文档][qq-group-event] 明确对应 `GROUP_AND_C2C_EVENT (1<<25)`；[FAQ][qq-faq] 规定群主开启获取全部消息。收到全量事件不等于本项目应把所有群成员都当作 owner 授权指令。 |
| 群主动输出 | 群主单独允许主动在群聊发言；全量收消息开关、主动发言开关、群管理员撤回权限是不同能力。AstrBot metadata `support_proactive_message=True` 不能证明特定账号/群已获准。 |
| Markdown/按钮 | 当前 FAQ：单聊/群聊自定义 Markdown 与按钮对所有机器人开放，无需单独申请模板。API 仍可能返回具体权限/格式错误，不能用旧“全部需申请”或新“必定成功”概括。 |
| 群被动回复 | [群发送 API][qq-group-send]：5 分钟、每条最多 5 次；`msg_id` 是收到事件 `d.id`，`event_id` 是外层事件 ID，二选一；重复 `msg_id+msg_seq` 会失败。群不支持流式参数。 |
| 群主动频控 | 同页：发送方企业/个人身份证认证 60/qpm，未认证 30/qpm；单关系 20/qpm、每群每日最多 1000 条；这些与接口总体 100 QPS 是不同维度。 |
| C2C 被动回复有文档矛盾 | [单聊发送 API][qq-c2c-send] 页首写 **60 分钟、每条 4 次**，但 `msg_id` 字段描述仍写 **5 分钟**。必须记录此矛盾，后续用官方澄清或明确授权验收收敛；不能任选一个数作为保证，也不能沿用源码“私聊似乎不限制”的注释。 |
| C2C 主动频控 | 同页写认证 bot 10/qps；未认证 5/qps 且 30/qpm；单关系 20/qpm、每好友每日最多 1000 条。还列出用户拒收、无好友关系、主动无权限等错误。 |
| intents 与在线状态 | [事件订阅文档][qq-events]：无权订阅的 intents 会导致连接报错关闭；权限被取消时当前连接可能只是停止收到该类事件，重连才报错。socket 存活不是所需能力持续有效的充分证据。 |
| IP 白名单 | AstrBot 教程的 warning 与“可选”标题已经不一致。具体新管理端 IP 规则应以 Parent 已读的当前 QQ 官方总览与账号配置为准，不从旧教程推断一律必须或一律不需要。本轮未访问任何真实配置。 |

错误应保留真实类别。例如群/单聊官方 API 的 `40034005` 回复 ID 过期、`40034024` ID 无效/越权、`40034100` 主动频控、`40034105` 主动无权限、`40034128` 被动时间/次数超限、`40054005` 去重；C2C 另有 `40054013` 用户拒收。不可统一吞成“断线，稍后重试”。

## 7. 对照本项目：复用什么、重做什么

本项目证据：[companion service contracts](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/spec/backend/companion-service.md>)、[model connection contracts](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/spec/backend/model-connections.md>)、[CompanionPluginHost](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/packages/companion-runtime/src/plugin-host.ts#L282>)、[withSourceAuthority](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/packages/companion-runtime/src/source-authority.ts#L6>)、[消息契约](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/packages/contracts/src/companion.ts#L49>)。

| 可借鉴的机制 | 本项目必须自己的实现与边界 |
| --- | --- |
| 接收→规范化→交给 Agent；发送独立 adapter | 每种协议作为可启停/替换的普通插件，沿用 PluginManager、source owner/generation 和 disposer；不建第二套平台 manager、Agent、会话库或队列。 |
| 平台实例、发送者、会话分开 | 当前 `CompanionMessageCommand` 只有 `commandId/text`，`CompanionMessage` 只有 `id/role/text/createdAt/inputId/taskId`。设计必须增加明确的来源/目标/关联语义或等价内部契约，不能把 QQ 信息拼进 text 就认为解决身份与回送。 |
| 会话选择/群内隔离 | 保留外部 route 与 canonical Agent/persona/memory 的关系；接入 QQ 不自动代表所有群共享私有记忆、外部人拥有 owner 权限或与桌面用户同一身份。范围由 Parent 与用户收敛。 |
| token/secret 鉴权、握手身份 | 用现有 CredentialBroker 的专属 owner/key slot/lease/redactor；QQ AppSecret、派生 access token、OneBot token 都独立于 text/ASR/TTS/DSH/AstrBot 凭据，目标/账号变化 fence 旧租约。非秘密配置继续由 ConfigService/FileConfigStore CAS 管理。 |
| 连接长期运行与断开回收 | 连接根工作归插件/source 生命周期；发送/接收处理归相应监督任务。复用 `runFor` / `withSourceAuthority`，等待 actual work 和 `TaskHandle.settled`；禁用/换配置/撤权先 fence 旧 callback，再确认 socket/server/task drain。cleanup 未确认不报告已完全停止，不激活替代实例。 |
| 网络连接 | 当前 service readiness 只支持 `capability-use/files/process/credentials`，generic network 不可用。应设计明确注册、受源权限和凭据约束的窄宿主传输能力，不能仅宣称插件化后直接开一个未跟踪 socket，也不放开所有 SDK 网络权限。 |
| 上游重连/重复事件 | 使用稳定 provider event/message identity 与明确 account/route scope 对接既有 command/state 事务去重；重复不得重复推理/执行/发送。不能复制 60 秒内存 dedup、随机 notice UUID 或 parser 前推进游标来承诺 durable exactly-once。 |
| 异步任务完成后回复 | 已接受的 canonical work 与连接寿命分离；可回送哪个原目标及谁获准看到结果必须明确。断线不能自动取消已接受云任务，也不能把其完成输出广播到当前群/当前连接。 |
| 上游 send 回包 | 本地 admission、平台 API 接受、未知结果、设备/用户实际收取是不同事实。记录 effect 关联与安全回执，真实失败原样分类；不继承主动 fallback、无边界重试或 void 成功语义。 |
| Rich message / media | 保留文本、mention、quote 的明确结构与能力限制；未来媒体应经过本项目受控资源/媒体能力，不能让外部 URL、本地 file URI、OneBot path mapping 获得宿主文件读取权限。首版是否接媒体尚待范围决定。 |

`withSourceAuthority` 已在真实 `runFor` 任务内取得 PermissionKernel leases、合并 task/lease signal、保留私有 native value/error、最终等待 settled。应让新增传输沿用这些机制，而不是以 adapter 自己的 enabled/connected 布尔值代替授权。Kernel 授权的是插件能力；外部群成员的业务权限仍须单独收敛。

后续验收至少需要覆盖所选 transport 的：重复输入只入账一次、账号/群/实例路由不串、错误 token/错误 self_id 拒绝、未知 API 结果不自动重发、明确失败不造成功、来源撤权/替换后旧回调不能发布、断开后的实际 drain、任务完成回送不泄露到别的目标。这里只列边界，不新增测试或实施。

## 8. License 与研究限度

AstrBot [LICENSE][license] 和 [pyproject][pyproject] 明确 **AGPL-3.0-or-later**，不仅是笼统“开源”。本项目 [LICENSE](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/LICENSE>) 是 MIT。直接移植或翻译 AstrBot 的受保护实现不能假定仍可只按 MIT 发布；AGPL 第 5/13 条涉及修改作品的分发与远程交互源代码义务。本轮建议记录协议事实和设计经验，按公开 QQ/OneBot 接口与本项目契约独立实现，不复制整个框架或适配器。

所核 [qq-botpy LICENSE][botpy-license] 与 [aiocqhttp LICENSE][aiocqhttp-license] 为 MIT，但这是各自上游代码的许可，不会消除 AstrBot adapter 的 AGPL；也不自动构成选用 Python SDK 或某个 Node SDK 的决定。未审计 NapCat 等具体 OneBot 实现的部署、账号权限或许可证。

本文证据是静态源码与公开文档，没有真实连接、发消息、权限、可靠投递或关闭时序验收。已明确保留 C2C 回复时限的官方文档矛盾；首版传输范围的新选择及多人权限增补见第 9 章。

## 9. 多人权限与上下文：定点增补

2026-11-12 第二轮，沿用同一 master SHA。用户已明确首版同时做**官方 QQ WebSocket + OneBot v11**，接入**白名单多人私聊 + 指定群**；前文 Webhook 是协议对照，不是新增首版范围。本轮只补研究，新增 2 个 Anysearch search 子查询已评分。

**结论：AstrBot 有代码执行的权限检查，不能说它只有 prompt；但白名单、会话隔离、工具授权和记忆可见性是不同层。“一个 Agent”不等于每个参与者共享全部历史、记忆和操作权限。**

| 机制 | 同 pin 实际函数/字段与边界 |
| --- | --- |
| 管道顺序 | [STAGES_ORDER][permission-stage-order] 为 Waking→Whitelist→SessionStatus→RateLimit→ContentSafety→PreProcess→Process→ResultDecorate→Respond；[PipelineScheduler._process_stages][permission-scheduler] 遇 `event.is_stopped()` 停止传播。是代码门禁，不靠模型遵守。 |
| AstrBot 管理员 | [WakingCheckStage.process][permission-waking] 用当前 profile 的 `admins_id` 与 `event.get_sender_id()` 精确比较，设置 `event.role="admin"`；默认 member。`_role_resolved` 可保留已解析角色，`_api_key_allow_admin_role=False` 禁止 API-key 身份升级。这里不是读取 QQ 群 owner/admin 身份；裸 sender ID 的配置也不是跨平台统一人员绑定。 |
| 白名单 | [WhitelistCheckStage.process][permission-whitelist] 检查 `unified_msg_origin` **或裸 group_id**；空白名单=不检查，WebChat 豁免，`wl_ignore_admin_on_group/friend` 可让 admin 绕过。群被允许意味着该群可进入处理，不等于每个群成员有管理员/工具权限；私聊按 UMO 匹配，不是任意裸 user_id。 |
| 群触发 | [WakingCheckStage.process][permission-waking] 支持 wake prefix、At bot、未忽略的 AtAll、Reply 引用 bot、handler filter、已有等待会话；私聊默认无须前缀。`is_wake` 与 `is_at_or_wake_command` 不同：[ProcessStage.process][permission-process] 执行已匹配 handler 后，普通 LLM 路径另要求后者。内置群 handler 可记录非 @ 消息，[GroupChatContext.need_active_reply][permission-group-context] 另有概率/名单主动回复规则。不能把“允许群”简化为“全群每条消息都执行 Agent”。Waking 自身还可能先发送权限不足提示，故本项目不可把它照搬成绝对先白名单再一切副作用的保证。 |
| 指令权限 | [PermissionTypeFilter.filter][permission-filter] 的 `ADMIN` 要求 `event.is_admin()`；`GROUP_ADMIN` 表示在群聊要求 **AstrBot admin**；`SHARED_GROUP_ADMIN` 在群聊允许 admin 或实际 `_session_isolated=True`；其余返回 True。这是特定 handler 的代码检查，不会自动施加到任意 LLM 工具。 |
| 每次输入权限 | [AgentPermissions.from_event / AgentInput / AgentTurn.steer][permission-runtime] 捕获不可变 role，每输入独立；steer 必须同 UMO、同 sender、同 permissions、同 `plugins_name`。排队执行调用 [admit_agent_input][permission-input] 重新检查 provider/会话开关并更新 plugin 集合；这里权限仍来自 event，不能声称它重新匹配了全部外部角色政策。可借鉴“共享会话也不继承上一人的权限”。 |
| 工具选择与执行 | [collect_plugin_capabilities][permission-input]、[filter_tools][permission-capabilities] 按 profile `plugin_set` 选工具，但 MCP、无 owner、owner 无法解析的工具保留；reserved 插件也有豁免。[SessionPluginManager][permission-session-plugins] 的 session disabled 列表过滤的是 handlers；不能假定同时覆盖所有 tools。[apply_persona][permission-persona] 按 persona.tools 组装工具（None=全部、空列表=无该 persona 工具），而 [FunctionToolExecutor._execute_local/_execute_mcp][permission-executor] 与 [call_local_llm_tool][permission-plugin-call] 分派 handler/MCP，不是统一每资源 lease 的授权内核。插件自身仍须检查其操作。 |
| 原生执行确有硬检查 | [get_local_permission_policy/check_local_execution_permission][permission-local-policy] 按 member/admin 控制 execution、network、filesystem=`none/workspace/host`；所需 OS isolation 不可用时禁执行。[ExecuteShellTool.call][permission-shell] 实际在调用前检查，向 managed shell 传 UMO owner、sender creator、policy，动态回调还检查管理员是否已撤销；`ShellSessionTool.call` 携 owner/requester/admin 参数管理会话。不能把这些原生工具的保护推断为任意插件/MCP 全部受同样约束。 |

上下文方面，前文 `unique_session` 真正改变 UMO/对话选择，属于数据分区，不只是提示词。[AstrAgentRuntime.open_session][permission-native-runtime] 还校验 `conversation.user_id == umo` 和 `session.umo == umo`，拒绝跨 UMO 绑定；这补充了底层 ConversationManager 本身的存取语义。关闭 unique_session 时，同群成员共享群 conversation；打开后按 `sender_group` 分开，但身份权限仍须逐输入独立判断。

名称为 `provider_ltm_settings` 的内置能力不能直接当作个人长期记忆系统：[GroupChatContext.handle_message/on_req_llm][permission-group-context] 使用 **UMO-keyed、有限条数的内存 deque** 暂存群聊，再作为 `extra_user_content_parts` 注入；[内置 Main.persist_group_message/persist_llm_response][permission-builtin-main] 另有 opt-in 的 `group_message_history_enable`，持久消息记录的 `user_id` 也是 UMO。两者都不自动建立“私有个人事实/群公开事实”的读写权限。

知识库的 [retrieve_knowledge_base][permission-kb] 先取 `sp.session_get(umo,"kb_config")` 的 kb_ids，否则用 profile 的 kb_names，再按这些库检索；调用参数没有逐 sender 或逐文档 audience。若同一 KB 配给多个会话，它们就可能检索同一资料，不能用“conversation 已隔离”证明 KB 内容也私有。第三方长期记忆插件没有在本次范围内逐一审计。

仅供模型理解的层次应单独标注：[append_system_reminders][permission-input] 将姓名/ID/群名加到用户内容；[apply_safety_instructions][permission-persona] 把安全规则拼进 system prompt；[apply_workspace_instructions][permission-workspace] 加载 workspace 的额外提示文本。这些文字不能代替人员授权、记忆检索过滤或工具执行检查。

对本项目，已选的双 transport 可以服务同一个 canonical Agent/persona，但需要在现有 Kernel 与 state/projection 边界明确三个独立问题：

1. **谁可发起输入**：按 provider instance/bot account + 外部 user/群绑定的私聊与群准入；群触发规则与群内可操作人员另行决定。名单空时含义应明确，不能无意继承 AstrBot 的 fail-open 或 admin 绕过。
2. **这次输入能看到什么**：私聊历史/私有事实按参与者范围投影，群历史/群事实按群范围投影；owner 的桌面私有记忆与他人的私聊不因“一个 Agent”自动注入群上下文。跨范围共享需明确的事实与授权，过滤必须在调用模型/检索前完成，不只写“不要泄露”的 prompt。
3. **这次输入能做什么**：参与者授予的操作范围与插件/source 的 Kernel capability/PermissionLease 取交集；查询、启动/停止任务、读文件、写 canonical memory、改配置/凭据、对外发送分别有归属。后台任务与回送保留发起人、授权范围和原受众，不能继承同会话上一位 admin 的权限或发送到后来切换的目标。

这些是待需求/设计收敛的边界，并未替用户决定所有白名单成员的能力，也不要求复制 AstrBot 的会话管理框架。

[permission-stage-order]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/stage_order.py
[permission-scheduler]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/scheduler.py
[permission-waking]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/waking_check/stage.py
[permission-whitelist]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/whitelist_check/stage.py
[permission-process]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/process_stage/stage.py
[permission-filter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/star/filter/permission.py
[permission-runtime]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/agent/runtime.py
[permission-input]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/agent_input.py
[permission-capabilities]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/star/agent_capabilities.py
[permission-session-plugins]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/star/session_plugin_manager.py
[permission-persona]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/main_agent/persona.py
[permission-executor]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/tool_executor.py
[permission-plugin-call]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/star/tool_execution.py
[permission-local-policy]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/tools/computer_tools/util.py
[permission-shell]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/tools/computer_tools/shell.py
[permission-native-runtime]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/runtime.py
[permission-group-context]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/builtin_stars/astrbot/group_chat_context.py
[permission-builtin-main]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/builtin_stars/astrbot/main.py
[permission-kb]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/tools/knowledge_base_tools.py
[permission-workspace]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/astr_agent_runtime/main_agent/workspace.py

[head]: https://github.com/AstrBotDevs/AstrBot/commit/2c3ee62b15eb0d329f608481002bed5fc45e84e7
[release]: https://github.com/AstrBotDevs/AstrBot/releases/tag/v4.29.4
[tag-ref]: https://api.github.com/repos/AstrBotDevs/AstrBot/git/ref/tags/v4.29.4
[release-qq]: https://github.com/AstrBotDevs/AstrBot/blob/61335414433db721b3f7ecc93f90deafe0a59d78/astrbot/core/platform/sources/qqofficial/qqofficial_platform_adapter.py
[pyproject]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/pyproject.toml
[license]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/LICENSE
[qq-adapter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial/qqofficial_platform_adapter.py
[qq-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial/qqofficial_message_event.py
[webhook-adapter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_adapter.py
[webhook-server]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_server.py
[webhook-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial_webhook/qo_webhook_event.py
[onebot-adapter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_platform_adapter.py
[onebot-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_message_event.py
[register]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/register.py
[manager]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/manager.py
[platform]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/platform.py
[session]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/message_session.py
[astr-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/astr_message_event.py
[event-bus]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/event_bus.py
[conversation]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/conversation_mgr.py
[qq-doc]: https://docs.astrbot.app/platform/qqofficial/websockets.html
[webhook-doc]: https://docs.astrbot.app/platform/qqofficial/webhook.html
[onebot-doc]: https://docs.astrbot.app/en/platform/aiocqhttp.html
[qq-faq]: https://bot.qq.com/wiki/bot_FAQ/
[qq-auth]: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
[qq-events]: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
[qq-group-event]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html
[qq-c2c-event]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html
[qq-group-send]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
[qq-c2c-send]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html
[botpy-ref]: https://api.github.com/repos/tencent-connect/botpy/git/ref/tags/v1.2.1
[botpy-token]: https://github.com/tencent-connect/botpy/blob/8d766f17f9a15d94e9e1668377c5c9f0e8235c96/botpy/robot.py
[botpy-http]: https://github.com/tencent-connect/botpy/blob/8d766f17f9a15d94e9e1668377c5c9f0e8235c96/botpy/http.py
[botpy-gateway]: https://github.com/tencent-connect/botpy/blob/8d766f17f9a15d94e9e1668377c5c9f0e8235c96/botpy/gateway.py
[botpy-license]: https://github.com/tencent-connect/botpy/blob/8d766f17f9a15d94e9e1668377c5c9f0e8235c96/LICENSE
[aiocqhttp-ref]: https://api.github.com/repos/nonebot/aiocqhttp/git/ref/tags/v1.4.4
[aiocqhttp-init]: https://github.com/nonebot/aiocqhttp/blob/2520928d2373f5be71059600b832e230a39ccdb9/aiocqhttp/__init__.py
[aiocqhttp-api]: https://github.com/nonebot/aiocqhttp/blob/2520928d2373f5be71059600b832e230a39ccdb9/aiocqhttp/api_impl.py
[aiocqhttp-license]: https://github.com/nonebot/aiocqhttp/blob/2520928d2373f5be71059600b832e230a39ccdb9/LICENSE
[onebot-ref]: https://api.github.com/repos/botuniverse/onebot-11/git/ref/heads/master
[onebot-reverse]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/communication/ws-reverse.md
[onebot-auth]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/communication/authorization.md
[onebot-ws]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/communication/ws.md
[onebot-http]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/communication/http.md
[onebot-api]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/api/public.md

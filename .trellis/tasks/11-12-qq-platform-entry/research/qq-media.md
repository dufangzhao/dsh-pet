# QQ 双协议媒体、主动发送与循环边界

研究时间：2026-11-12（Asia/Shanghai）。本轮仅新增本文；未修改产品、账号或其他研究文件，未安装、运行、登录、连接真实机器人或发送消息，未另派 agent。Anysearch 的 10 个成功 search 子查询已全部评分；全文优先采用原始协议、QQ 官方页面和固定 AstrBot 源码，搜索摘要不足以确定的数字不作承诺。

已选需求保持不变：**官方 QQ WebSocket + OneBot v11；白名单多人私聊与指定群；文本、图片、语音、文件全部支持；受限成员工具/own tasks；按人/群隔离并共享公开 facts；群 context、唤醒词/@、可配置主动回复（规则/概率或 Magpie 模型 judge）**。下文列出实现这些需求需履行的协议契约，不把条件或未知项解释成删减媒体范围。

基础注册、身份、权限、生命周期与许可证研究集中在 [AstrBot QQ 研究](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/tasks/11-12-qq-platform-entry/research/astrbot-qq.md>)。本轮继续固定 AstrBot `2c3ee62b15eb0d329f608481002bed5fc45e84e7`、OneBot v11 规范 `d4456ee706f9ada9c2dfde56a2bcfc69752600e4`；QQ 在线文档是本日读取，未取得不可变文档 commit。静态支持不等于账号权限、格式兼容和用户实际收取已验收。

## 1. 结论

1. **官方 QQ 私聊、群聊均明确支持四种所选媒体**，文件不再是只能靠第三方实现的类型；官方 `file_type=4` 已存在。不要将频道的文件限制套到 QQ 私聊/群聊。
2. **OneBot v11 基础标准明确文本、图片、语音，但普通文件收发不完整标准化**。需要固定协议端及其文件扩展版本才能实现所选完整范围，不能宣称任意 v11 实现都能直接满足。
3. **上传成功、发送 API 接受、完整批次完成、用户收到/播放是四层事实**。一条逻辑回复拆成多个上传/消息时须记录每一步结果；超时/取消后未知副作用不能自动重发。
4. **音频格式、文本长度、被动回复窗口存在需要区分的证据层次**。官方媒体文档有音频格式矛盾；C2C 时限仍有 60/5 分钟矛盾；统一文本长度和语音时长上限本轮未取得足够原始证据，均标 unknown。
5. **双协议循环必须在身份和发送归属上阻断**。同名群、相似文本、QQ OpenID 与 OneBot 数字群号，均不是跨协议同群/同人证明；不自动建映射或转发桥。

## 2. 官方 QQ：入站字段与下载引用

[单聊事件][qq-c2c-event]、[群 @ 事件][qq-group-at-event]、[群全量事件][qq-group-event] 使用共同附件结构；不同之处主要在身份与触发事件：

| 场景 | 路由/作者 | 文本与媒体 |
| --- | --- | --- |
| C2C 私聊 | `C2C_MESSAGE_CREATE`；作者 `author.user_openid`；消息 `d.id` | `content`、`attachments[]`；引用可在 `msg_elements[]` 中嵌套内容/附件。 |
| 群 @ | `GROUP_AT_MESSAGE_CREATE`；`group_openid`、`author.member_openid` | 官方说明 content 已去掉 @ 自身前缀，mentions 列表不含 bot 自身；不能因 mentions 没有 bot 就判定未唤醒。 |
| 群全量 | `GROUP_MESSAGE_CREATE`；同上 | 群主允许全量接收后推送；并不代表本项目要对每条消息生成回复。 |

| 媒体 | 原始字段 | 本项目需要保留的语义 |
| --- | --- | --- |
| 文本 | `content`；`message_type=0`；引用类型 103 可含 `msg_elements` | 空文本不代表没有媒体。引用内容与本次作者当前输入分开保留。 |
| 图片 | `attachments[].url/filename/size/content_type/width/height`，如 image/jpeg、image/png、image/gif | 下载引用与真实文件字节不同；MIME/尺寸/声明 size 要以实际取得的字节再校验。 |
| 语音 | `content_type="voice"`、原始 `url`；可有 `voice_wav_url`、`asr_refer_text` | WAV URL 是平台转换引用，ASR 是参考转写，不能冒充未经转换的原话或默认已通过本项目 Magpie ASR。缺失或过期应走可验证的原始音频解码路径。 |
| 普通文件 | `attachments[].url/filename/size/content_type`，共享 schema 将 file 注释为群文件；[官方场景表][qq-types] 同时明确 C2C/群文件收发支持 | 文件名是显示元数据，不是可信宿主路径。传输/存储/回送文件与“能理解任意文件格式”是不同能力。 |

附件字段在当前文档没有逐项必填保证。引用的 `msg_elements` 也可递归，不能只拿顶层 content 后假称已处理全部文件。`message_scene.ext` 可含 `msg_idx/ref_msg_idx/auth_token`；只保留必要引用身份，不向日志/模型/公开 facts 暴露 auth_token。

官方示例下载 URL 带 `rkey` 等查询参数；本轮没有找到所有入站附件 URL 的统一 TTL 或“永久可重新获取”保证。它们是私有、可过期的取数引用，不是 durable artifact 本体。用受限下载任务获取字节后再生成自有 artifact/reference；不可把远端给出的 file URI 当成宿主文件读取许可。

[AstrBot `_append_attachments`][astr-qq-adapter] 读取 content_type/url/filename，再以 MIME 或扩展名转 `Image/Record/Video/File`；`_prepare_audio_attachment` 下载/转换 WAV，失败时保留 Record URL。它没有在该函数使用 `voice_wav_url/asr_refer_text`，也没有以 attachment.size 建立本项目所需的下载授权/配额。`_parse_from_qqofficial` 对引用主要处理 `message_type=103` 的首个 element；不能当完整递归消息解析规范。

## 3. 官方 QQ：出站上传与发送矩阵

[单聊上传][qq-c2c-files] / [群上传][qq-group-files] 都先得到 `file_info`，再向相同场景 `/messages` 以 `msg_type=7, media.file_info` 发消息。`file_info` 是不透明字符串，无需解析。文本则 `msg_type=0,content`，Markdown 为 `msg_type=2,markdown`；同时填写 markdown 时 content 必须为空。

| 类型 | C2C / 群可用路径 | 官方当前声明 |
| --- | --- | --- |
| 文本 | `/v2/users/{user_openid}/messages` 或 `/v2/groups/{group_openid}/messages` | 同步发送可返回 `id/timestamp/ext_info.ref_idx`。不是用户收取回执。 |
| 图片 | 对应 `/files`，`file_type=1`；后续 media 消息 | 限制表写 png/jpg、软限 20 MB、硬限 200 MB；概述展示表还列 gif/webp/bmp，见下文格式冲突。 |
| 语音 | 对应 `/files`，`file_type=3`；后续 media 消息 | 限制表写 silk、软限 20 MB、硬限 200 MB；其他段落列更多 codec，不能混成一个已验证支持集合。 |
| 普通文件 | 对应 `/files`，`file_type=4`；后续 media 消息 | [富媒体概述][qq-rich] 明确任意格式、文件卡片可下载，软/硬限均 200 MB；仍受账号、内容、当天容量等检查。 |
| 视频（仅对照） | file_type=2 | mp4、软限 30 MB、硬限 200 MB；不是本轮新增需求。 |

**超过软限制会降级为文件类型，超过硬限制报错。** 因此“接口允许 200 MB 上传”不等于“200 MB 图片仍显示成图片，或 200 MB 音频仍可作为语音条播放”。不能静默把语音条交付记为完成，却实际只发了普通文件卡片。

上传机制：

- URL：body `url`，由 QQ 服务端下载转存；开发者服务的鉴权 artifact URL 不一定可被 QQ 读取，不能附加本项目 bearer token 或改成公开永久链接来凑通。
- `file_data`：当前接口表称二进制直接上传，类型写 string，限制 **5M 以内**；JSON/base64 编码细节和“5M”精确计量须按实际 codec 验证。AstrBot 使用 base64，不能将其 10 MiB 阈值当官方限制。
- 推荐分片：[upload_prepare][qq-prepare] 请求 `file_type,file_size:string,file_name,md5,sha1,md5_10m`，其中前缀哈希覆盖 **10,002,432 字节**；返回 `upload_id,block_size,parts[].index/presigned_url/block_size,upload_config`。按返回大小 PUT 原始字节；每片调用 [upload_part_finish][qq-finish] 的 `upload_id,part_index,block_size,md5`；最终 POST `/files` 传 upload_id 合并。预签名 PUT 与 QQ Bot API 的凭据边界不同，不能向任意返回 URL转发 QQ access token。
- `file_name` 在分片或直传时文档要求必填。返回 `file_uuid,file_info,ttl`；ttl 到期需重新上传，0 表示可长期使用。`raw_url` 仅在分片合并且类型为图片/视频/语音时返回；普通 file_type=4 不返回，不能要求每个发出的文件都有此字段。
- `srv_send_msg=false` 只上传；`true` 在上传时就直接发消息并占主动消息频次，返回 id。故上传任务并非天然无外部消息副作用，正常分阶段实现应显式保留该字段的语义。
- 单聊与群聊上传不能跨场景复用。文档也未证明任意跨 bot、跨收件人复用均合法；本项目引用应绑定原 owner/account/目标，避免扩大授权。
- 文档频率：`/files` 50 QPS，prepare/part_finish 10 QPS；服务端还下发并发与重试策略。`40093002` 表示当天文件发送容量用尽，但本轮没有拿到统一的每日字节数。

另有独立的 [Markdown 素材管理][qq-material]：`/v2/media-images/prepare → PUT → complete` 生成绑定 bot 的 `qqbot-media://image/v1/...` 引用，**单图 10 MB、png/jpeg/gif/webp、每 bot 100 张、90 天未引用失效、上传任务 4 小时**。它与普通 media.file_info 不是同一机制，不能套用 200 MB 上限；临时 preview_url 不应持久化。complete 可成功而发送时实际格式校验失败，再次证明上传完成不等于消息交付。

### 音频格式与时长的证据分歧

| 来源 | 声明 |
| --- | --- |
| [富媒体概述][qq-rich] 展示表 | silk/mp3/wav/ogg；图片 jpg/png/gif/webp/bmp。 |
| 同页限制表 | 语音 silk，图片 png/jpg。 |
| [C2C `/files`][qq-c2c-files] 字段 | 语音 silk。 |
| [群 `/files`][qq-group-files] 字段 | 语音 silk/mp3/wav，但页首仍写 silk。 |
| AstrBot | `_parse_to_qqofficial` 将 Record 转成 `target_format="tencent_silk"`，给出一条明确兼容转换路径，而非官方唯一 codec 的证明。 |

**unknown：**所有账号/客户端下 mp3/wav/ogg 原生语音条的实际支持集合；统一语音条最大秒数；长语音的显示/播放行为；入站语音最大时长/大小。不能引用社区常见的 60 秒或其他数字作为本轮已核实的官方硬限制，也不能从 20 MB 推出允许任意时长。

[AstrBot Tencent helpers][astr-silk] 的 `tencent_silk_to_wav` 接受 `0x02/0x03` 前缀 SILK，解码为 **24 kHz、mono、16-bit PCM WAV**；`wav_to_tencent_silk` 以实际 WAV 参数处理并 `tencent=True` 编码，输出 QQ 兼容 SILK。`convert_to_pcm_wav` 的 ffmpeg 分支还加 2 秒 padding，这是参考实现选择，不是平台规则，不应盲目复制。

本项目 [M5 协议](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/spec/backend/shared-speech-output.md#L35>) 的 Magpie TTS 输出是 PCM16LE/24 kHz/mono **流**。原始 PCM chunk 不是 WAV 容器，也不是 SILK；不能仅换扩展名、base64 后作为 QQ Record。需在受监督媒体任务中生成有效容器/编码、校验完整采样和结束状态，再发送。QQ 普通语音上传接口不是实时 PCM 播放流；按段上传时每段又是独立消息及配额消耗，必须明确部分成功与剩余失败。

## 4. 官方 QQ：主动、被动、引用与长回复

“主动回复决策”是产品选择是否开口；“官方主动消息”是发送 API 是否携带可用 msg_id/event_id。二者不能按中文名称直接等同。

| 模式 | 协议含义与限制 |
| --- | --- |
| 被动回复用户 | `msg_id=d.id`，`msg_seq` 与 msg_id 联合去重；不是 `message_reference.message_id`。 |
| 被动响应事件 | `event_id` 取外层 id，只支持文档列出的事件；与 msg_id 二选一。 |
| 主动消息 | 不依赖这次用户消息引用；仍要求用户/群允许主动发送、存在关系和有额度，不是“无条件授权”。 |
| 互动召回 | `is_wakeup=true`，与普通被动字段互斥；30 天内按四个周期各一条，不能用来无限续期回复。 |
| 展示为引用回复 | `message_reference.message_id=REFIDX_...`；用户消息索引取 `message_scene.ext` 的 msg_idx，机器人消息取发送响应 `ext_info.ref_idx`。它是 UI 引用，不授予被动回复资格。 |

[官方消息总览][qq-overview] 与 [C2C 发送页][qq-c2c-send] 页首一致：**C2C 被动 60 分钟/4 次，群 5 分钟/5 次**；但 C2C 页 msg_id 字段仍写 5 分钟。总览增强了 60 分钟的文档证据，仍不能消除同一接口描述矛盾；实际窗口列待官方澄清/授权验收。不能硬承诺长任务一小时内一定可回原消息，更不能到期后悄悄转主动发送。

主动额度：C2C 认证 bot 10/qps，未认证 5/qps 且 30/qpm；群认证 bot 60/qpm，未认证 30/qpm；单关系均 20/qpm，每用户/群每日 1000 条。发送接口总体 100 QPS 与这些业务维度不是同一个限制。用户拒收、主动无权限、回复过期、被禁言、去重、超长应分别报告。

普通文本和 Markdown 的**统一最大字符/字节数、最大媒体数量、单逻辑回复最大批次数**：当前读取的具体发送页没有给出可作为通用保证的数字，标 unknown。确有 `40054007` 长度超限、C2C `40054018` 过长/异常；不能把本项目 8000 字符上限或社区 4096 数字当 QQ 平台上限。

[当前 C2C 流式接口][qq-stream] 是 `/v2/users/{user_openid}/stream_messages`：`input_mode=append|replace`、`input_state=1|10`、递增 index、content_type/content_raw、stream_msg_id；replace 要保留已经下发的前缀，响应可能给 `remain_msg_len`。未明确给出一个总最大长度；群消息明确不支持流式参数。这与 pinned AstrBot 向 `/messages` 发送旧 `stream:{state,id,index,reset}` 的实现不同，不能直接复制旧流式 wire 协议当当前唯一接口。

长文本/长语音/多文件交付要在设计时选择能保留完整内容的明确计划：拆分前检查目标能力与配额；逐条关联消息 ID、顺序与结果；如采用完整文本文件、音频文件加短说明，应明确这是文件形式，不能假称所有内容已显示为正文/语音条。批次前半成功后半失败时保留 partial，不整批重发。这里没有批准具体长度、分段策略或额外主动外发。

## 5. OneBot v11：标准与实现扩展分开

规范固定到 [消息事件][ob-message]、[消息段][ob-segment]、[公开 API][ob-api]、[通知事件][ob-notice]。

| 媒体 | 私聊/群入站 | 出站/取数 | 标准保证与未知 |
| --- | --- | --- | --- |
| 文本 | `message_type=private|group`，message array 内 `text.data.text` | `send_private_msg(user_id,message)` / `send_group_msg(group_id,message)` | 返回 data.message_id；无统一字符上限、群风控额度、批次数数值。 |
| 图片 | `image.data.file` 文件名/标识、`url`；部分 type=flash | 出站 file 可用已有标识、网络 URL、file URI、base64；`get_image(file)` 返回下载后的 file 路径 | 路径属于协议实现运行环境，不一定是本服务宿主路径；实际格式/大小/访问权限依实现。 |
| 语音 | `record.data.file/url/magic` | 同类 file 引用；`get_record(file,out_format)`，规范列 mp3/amr/wma/m4a/spx/ogg/wav/flac；结果 file 是协议端转换路径 | 规范可能要求实现安装 ffmpeg；没有保证任意实现都解码 SILK、接收 PCM、支持任意时长。`can_send_record` 只报告基本能力，不能证明具体文件可发。 |
| 普通文件 | 标准有 `notice_type=group_upload`：`file.id/name/size/busid`；基础消息段表没有通用 file 段，标准未完整定义私聊文件入站 | 标准公开 API 无通用 upload_private_file/upload_group_file/get_*_file_url 契约 | 完整文件能力必须由选定实现的扩展补齐并验收；文件 requirement 保留，不能把“v11标准合规”当验收。 |
| 引用 | `reply.data.id`，`get_msg(message_id)` 可查询原消息 | reply 段表示引用；send API 本身不要求官方 QQ 的 msg_id/event_id 窗口 | 不能把官方 bot 的 4/5 次规则套在 OneBot；协议端仍受 QQ 账号/关系/禁言/平台风控，标准未承诺无限发送。 |

OneBot 私聊还有 `sub_type=friend|group|other`（群临时会话不等于好友私聊），受限成员准入与回送路由需要保留该区别。`self_id` 必须绑定已鉴权连接；不能由消息文本提供。基础 sender schema 不提供可靠通用 `is_bot`，也没有跨官方 OpenID 与数字 QQ 号映射。

### AstrBot 对 OneBot 媒体的实际处理

[AiocqhttpAdapter._convert_handle_message_event][astr-ob-adapter] 要求 array；image/record 等通常按组件映射，reply 再调 get_msg；`file` 段优先用 data.url，否则分别调 `get_group_file_url(file_id,group_id,self_id)` 或 `get_private_file_url(file_id,self_id)`，读取响应 url/file_name/name。这些是兼容具体实现的扩展，不能解释为 v11 基础标准。

尤其 `_convert_handle_notice_event` 只建空消息（poke 另有组件），没有将标准 `group_upload.file` 转 File。因此若协议端只上报标准群上传 notice，不能保证 AstrBot 普通消息链会自动拿到文件；本项目应在所选协议端上明确消息段/notice是否双报及如何关联，避免遗漏或重复。

[AiocqhttpMessageEvent][astr-ob-event]：

- `_from_segment_to_dict` 把 Image/Record 转成 `base64://`；File 的绝对路径可转换 file URI。这只证明它的传输用法，不证明网络两端共享文件系统。
- `send_message` 普通段可合并发送；含 Node/Nodes/File 时拆开发；File 仍以扩展 file 段调用 send_group_msg/send_private_msg；forward 则使用具体 action。
- 一些拆分普通段 sleep 0.5 秒；流式 fallback 按句发送、sleep 1.5 秒。这些是框架策略，不是 OneBot 法定速率，也不能满足所有协议端的风控或批次语义。
- `_dispatch_send` 丢弃返回值。API `status=ok/retcode=0` 是协议端成功响应；`async/1` 不保证最终成功；连接断开/超时保留 unknown，echo 不是幂等键。

**当前协议端来源限制：**本轮查 NapCat 官方文档兼容表，页面提取失败，不能用旧搜索摘要承诺当前 API。进一步读取原仓库：main ref 固定为 `105f38e3ecb1428c147e0f9165f65f854233d988`，[tree][nap-tree] 只有 [README][nap-readme]，内容为 “Ending / 到这里告一段落。” 这仅说明本轮可见主分支状态，不能据此认定历史版本不可用或所有 OneBot 实现结束；也不能继续把当前 NapCat main 当作可直接复核的完整实现。所选协议端、版本、文件扩展、媒体传输方式和自消息回报行为仍需单独固定，未替用户选择或安装。

**候选补注（Parent 同日独立公开查证，本子任务未再扩查）：**[LLOneBot 原仓库地址](https://github.com/LLOneBot/LLOneBot) 当前跳转 [LuckyLilliaBot](https://github.com/LuckyLilliaDev/LuckyLilliaBot)，公开 README 声明 OneBot11/Satori/Milky，源码与测试目录可见；只作为候选，实际实现版本、文件/语音扩展、登录与运行兼容均未验证。[Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) 当前 master 为 V2/Milky，V1 注明 sunset，不把旧 OneBot 教程当当前默认。此处没有为候选固定可用版本或作部署推荐；下一步以用户提供的**现有 OneBot 实现与版本**固定验收目标。四类媒体需求不变，本文现有协议事实与 unknown 已足够支撑首轮设计约束。

## 6. AstrBot 官方媒体实现可借鉴与不可照搬处

| 源码位置/函数 | 已核行为 | 本项目意义 |
| --- | --- | --- |
| [QQOfficialMessageEvent._split_message_chain_by_media][astr-qq-event] | 每遇第二个 Image/Record/Video/File 就另起一条 chain | 多媒体会产生多次真正消息发送，必须预估回复次数；不是原子批量。 |
| `_parse_to_qqofficial` | Plain 聚合；一份 image_base64；Record→Tencent SILK；File保留name与file/url | 保留媒体类型转换边界，但对失败媒体静默置空的策略不可继承。 |
| `upload_group_and_c2c_image` | 单独走 base64 file_data，`file_type=1,srv_send_msg=false` | 此路径没有调用大文件分片；也没有随上传填 file_name，和当前直传文档要求存在差异，需重新实现 codec。 |
| `upload_group_and_c2c_media` | 本地文件大于 `QQOFFICIAL_CHUNKED_UPLOAD_THRESHOLD` 才分片；其余本地全部读入base64，否则走URL | [常量][astr-chunked] 为 **10 MiB**，当前官方直传 **5M**；5M～10MiB 区间不能沿用。URL可访问性与字节下载授权也不能猜。 |
| [QQOfficialChunkedUploader][astr-chunked] | `_compute_file_hashes`、`_upload/_upload_part/_finish_part` 实现prepare→PUT→finish→merge；处理40093001/40093002；并发最多4 | 可参考协议步骤与明确业务错误；不能复制其重试、全量缓存或后台work ownership替代本项目TaskSupervisor/资源限制。 |
| `_post_send_one` | 上传后设置 `msg_type=7,media`，去掉markdown、保留plain content；随机msg_seq | 消息引用/seq、媒体回执需本项目稳定关联，不随机换号掩盖未知。 |
| `_send_with_markdown_fallback` / `send_by_session` | 可能移除msg_id/event_id改主动；部分缺信息仅log后return | 不能将被动失败自动升级为主动，不能以None返回制造成功。 |
| [MediaResolver][astr-media] | 可物化URL/base64/本地引用、做格式转换和临时文件管理 | 是资源边界参考，不授权接收外部任意file URI或复用它的所有读取入口。 |

发送 API、媒体下载、转码、上传、模型视觉/ASR/TTS 是独立步骤，分别有权限、取消、实际 drain 和失败事实。模型只看到文本不能称图片理解完成；ASR失败不能把空字符串当用户空消息；上传失败不能删掉媒体后仍宣称完整回复已发。

## 7. 自身/其他机器人、双协议与主动循环

### 原始证据

- QQ 官方事件 `author.bot` 可标识机器人；`mentions[].is_you` 是某些 raw payload/SDK 的 mention 信息，不是可靠的所有消息自身 account identity。[AstrBot QQ adapter][astr-qq-adapter] 保留 author.bot 于raw，但归一化 MessageMember 主要是ID/name，没有在该转换路径统一丢弃其他机器人消息；self_id 在一些场景为 `qq_official/unknown_selfid` 占位。
- [WakingCheckStage.process][astr-waking] 只有在 `ignore_bot_self_message` 打开且 `get_self_id()==get_sender_id()` 时阻断；默认 get(...,False)。这不等于“所有机器人自动忽略”，也不能在占位self_id时保证自身识别。
- OneBot standard 有 self_id/user_id，可按绑定账号识别自身；没有通用其他机器人标志。AstrBot另硬编码屏蔽一个QQ管家账号，不能作为一般机器人识别方案。
- AstrBot OneBot只注册 `on_message(group/private)`，convert只分message/notice/request；实现自有的 `message_sent` 是否出现、是否被当普通message处理不属于v11统一保证，不能靠它未处理某类自消息证明循环不存在。
- [GroupChatContext.need_active_reply][astr-group-context] 检查enabled、群消息、非明确唤醒、主动名单，当前match只有 `possibility_reply` 概率路径；没有本项目已选的Magpie模型judge实现，也没有完整跨协议回声关联。

### 对本项目的设计约束（不改变用户已选模式）

1. **先身份/准入，再上下文与judge。** 对已确认自身、已知机器人、由本系统发出的已关联回声，不再次触发自动回应或把其当新人的工具指令。官方bot字段缺失时保留unknown；OneBot其他bot需明确配置/可信实现扩展，不能用昵称猜测。
2. **消息身份始终带协议实例/账号/目标。** 入站事件ID、业务输入ID、每段出站effect/messageID各自关联；回声不是另一次用户命令。文本哈希只可辅助诊断，不能作为跨协议稳定去重或人员证明。
3. **双协议不自动认同一群。** 官方group_openid与OneBot数字group_id分别保留。即使昵称/内容/时间相同也不合并私有context、不共享成员grant、不复制回送。若未来明确绑定同一物理群，须显式指定自动回应的路由/抑制关系及另一侧bot身份，验证A→B→A不会循环；绑定前不声称天然只有一次答复。
4. **主动judge只有建议权。** 规则/概率/Magpie模型judge共享同一准入、bot排除、受众、频率/并发预算和撤权检查；judge只看该群获准context，不读他人私聊或owner私有facts；返回“应回复”不是凭据、工具、主动发言权限，也不能自己创建下一次judge输入。
5. **输出不可反向变成人类唤醒。** 自己的说明、错误消息、部分发送结果、TTS转写、外发附件标题和任务完成通知，均保留machine-origin，不能经过普通入站通道反复触发。用户真实回复/引用仍需按实际作者与当前权限判断。
6. **控制频率不等于确认投递。** 每目标的冷却/预算可以限制回声放大，但不能替代身份排除；断线/未知结果也不自动换协议重发。多媒体批次、异步任务完成和主动消息都应固定原受众与发起授权。

## 8. 已知限制、unknown 与后续验收证据

| 项目 | 目前状态 | 后续需要的证据 |
| --- | --- | --- |
| 官方C2C/群四媒体 | 原始文档明确支持 | 两场景分别验收真正下载、显示/播放/文件卡片；API回包与人工收取证据分开。 |
| 官方文件大小 | 文档硬200MB、软20/30/200MB、直传5M | 精确byte/MB计量、直传编码、本地产品上限及软限降级表现。 |
| 官方音频/图片扩展格式 | 文档前后不一致 | 各场景选定codec实测；SILK与PCM/WAV不得混标。 |
| 官方语音最大时长 | unknown | 账号/客户端实际可播放秒数、超长错误/降级；不拿文件字节限推导。 |
| 官方普通文本统一长度/批次 | unknown | 字符/UTF-8计量、多段次数、Markdown限制和错误回包；不采用社区数字做保证。 |
| C2C回复窗口 | 总览/页首60分钟4次，字段仍5分钟 | 官方澄清或明确授权的窗口验证；群5分钟5次单独保留。 |
| OneBot文件全功能 | 标准不足，AstrBot使用扩展 | 固定协议端版本，私/群文件事件、URL获取、上传/发送API、跨机字节传输、大小/时长/配额。 |
| 入站/出站附件引用有效期 | 出站file_info有ttl；入站统一TTL unknown | URL失效/refresh/下载拒绝的真实行为，禁止把临时链接当永久artifact。 |
| 自己与其他bot事件 | 绑定自身可检查；其他bot/cross-protocol不统一 | 每协议raw事件的self/bot/回声字段，显式映射及双bot回声场景。 |
| judge支持 | 用户已选；AstrBot所核概率分支不是实现证明 | 自有Magpie judge的context授权、固定输出、无副作用/撤权、不会自触发；本轮不执行。 |
| 交付事实 | 仅静态协议 | 上传成功、API接受、部分批次、未知、人工确认/播放分别记录；未真实联调。 |

后续应继续使用现有 PluginManager/TaskSupervisor/PermissionKernel/CredentialBroker、受众投影与受控artifact/media通道。媒体bytes不塞进64KiB业务JSON；转码和传输均有有界资源与实际settlement，真实格式/计量不足时明确失败或unknown。本轮未复制AGPL实现，未选择新依赖、具体OneBot协议端或实际发送策略。

[qq-types]: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/overview.html
[qq-c2c-event]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html
[qq-group-at-event]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html
[qq-group-event]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html
[qq-c2c-files]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html
[qq-group-files]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html
[qq-rich]: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html
[qq-prepare]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html
[qq-finish]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html
[qq-material]: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/material-management.html
[qq-overview]: https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html
[qq-c2c-send]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html
[qq-group-send]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
[qq-stream]: https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_stream_messages.post.html
[ob-message]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/event/message.md
[ob-segment]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/message/segment.md
[ob-api]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/api/public.md
[ob-notice]: https://github.com/botuniverse/onebot-11/blob/d4456ee706f9ada9c2dfde56a2bcfc69752600e4/event/notice.md
[astr-qq-adapter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial/qqofficial_platform_adapter.py
[astr-qq-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial/qqofficial_message_event.py
[astr-chunked]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/qqofficial/qqofficial_chunked_upload.py
[astr-silk]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/utils/tencent_record_helper.py
[astr-media]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/utils/media_utils.py
[astr-ob-adapter]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_platform_adapter.py
[astr-ob-event]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_message_event.py
[astr-waking]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/core/pipeline/waking_check/stage.py
[astr-group-context]: https://github.com/AstrBotDevs/AstrBot/blob/2c3ee62b15eb0d329f608481002bed5fc45e84e7/astrbot/builtin_stars/astrbot/group_chat_context.py
[nap-tree]: https://api.github.com/repos/NapNeko/NapCatQQ/git/trees/105f38e3ecb1428c147e0f9165f65f854233d988
[nap-readme]: https://github.com/NapNeko/NapCatQQ/blob/105f38e3ecb1428c147e0f9165f65f854233d988/README.md

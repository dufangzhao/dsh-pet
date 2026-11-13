# QQ 双源协议验收候选计划与 SnowLuma API 证据

日期：2026-11-12。状态：**研究与测试计划，所有测试均未执行，真实平台联调未授权**。本轮仅新增本文；没有产品修改、安装、运行、连接真实端点、登录、消息发送、模型调用或其他 agent。本轮 2 个成功 Anysearch search 子查询已全部评分。

需求基准为 [当前 PRD](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/tasks/11-12-qq-platform-entry/prd.md>) Q1–Q16：官方 QQ WS 与 OneBot v11 同属首版；多人私聊白名单及指定群；受限成员工具与自己的任务；按人/群隔离并共享显式公开 facts；规则/概率或 Magpie 模型 judge 可配置；文本、图片、语音、文件均纳入；**每次回复保留文字，语音仅为可选附加输出；长期 facts 的创建/修改/删除/公开仅 owner/显式管理员可做；Web 完整管理，Desktop 仅状态与入口。**

“文字必有”是产品内容与发送计划约束，不是网络失败时仍能保证用户收到：文字生成、持久保留、发送尝试、平台接受、用户收取须分别记事实。语音失败不能删除、撤回或重发已经成功的文字；任何媒体或长回复部分成功不能整体重发。

## 1. 证据边界与优先级

| 来源 | 可用于什么 | 不能推出什么 |
| --- | --- | --- |
| [既有 AstrBot 研究](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/tasks/11-12-qq-platform-entry/research/astrbot-qq.md>)；源码 pin `2c3ee62b15eb0d329f608481002bed5fc45e84e7` | adapter入口、字段、旧实现缺陷、权限/会话参考 | 本项目应复制框架或 AGPL 实现；参考成功即本项目通过。 |
| [媒体矩阵](</home/kingBZ/DeepSeek-WorkSpace/dsh-pet/.trellis/tasks/11-12-qq-platform-entry/research/qq-media.md>)；QQ当前官方文档 | 官方C2C/群的字段、上传步骤、配额、已知冲突 | 账号权限、所有客户端格式、真实收取/播放已验证。 |
| [OneBot v11 原始规范][ob-root]，pin `d4456ee706f9ada9c2dfde56a2bcfc69752600e4` | 基础消息/鉴权/action/echo语义 | 所有实现支持同一文件扩展、相同限额或可靠历史补发。 |
| 用户报告“现有 AstrBot 据说接 SnowLuma” | 优先兼容目标线索 | 已安装版本、端点、token、运行状态；也不是读取私有配置或连接许可。 |
| [SnowLuma 第三方存档][sl-root]，tag名 v2.3.4，镜像commit `62bb85d2a1c186dc7e40c63a3ffc06be46f7d325` | 本轮可读的 SDK README、公开类型、action名称与反向WS说明，用于提出兼容测试 | 原作者仓库真实性/字节等同、用户实际安装版本、原生运行兼容。不能将archive tag填入installedVersion。 |

本轮原文档地址 `https://snowluma.github.io/zh/docs/api` 提取失败；不继续扩大镜像、发行包或部署调查。初次只读存档的根 README、SDK README/反向WS说明和 SDK类型/action目录；随后经 Parent 明确限定，追加核对上层 OneBot `actions/group-file.ts`、`actions/message.ts`、`modules/message-actions.ts` 的文件发送包装行为（见2.4节）。没有继续追踪 bridge/protocol/native/注入实现。存档 README 自述 **source-available 非商业许可，非 OSI 开源；随附 native 组件专有**。这些材料用于接口研究，不复制实现、安装SDK或原生组件，也不确认任何腾讯介入/停止服务的归因。

以下未特别说明的 SnowLuma 类型内容称“**存档 SDK 声明**”；2.4节及表内明确标注的handler事实来自另行限定的上层包装核查。`SNOWLUMA_ACTIONS` 的源码注释明确：这是本地目录，**不是对已连接服务端的能力检查**。类型存在不代表当前用户端点接受它；类型缺少字段也不能反向证明运行时一定不支持。

## 2. SnowLuma OneBot 媒体扩展接口形状

只记录与所选消息/媒体验收有关的子集。SDK 通用 raw action 能列出许多额外动作，不意味着本项目要开放任意 action 入口。

### 2.1 基础消息、文件与取数

来源：[action名称目录][sl-actions]、[SnowLumaActionMap][sl-action-map]、[参数类型][sl-params]、[结果类型][sl-results]、[消息段类型][sl-messages]。

| action / 类型 | 存档声明的形状 | 需要核实的边界 |
| --- | --- | --- |
| `send_private_msg` / `send_group_msg` | 私聊 `{user_id:number,message,auto_escape?}`；群 `{group_id:number,message,auto_escape?}`；返回 `{message_id:number}` | 结果是协议端回执，不是人收到；消息ID可为有符号值，不能统一只准正整数或当数组序号。 |
| Image / Record | `image.data={file:string,type?:flash,subType?,summary?,url?}`；`record.data={file:string,url?}` | codec、文件最大字节/时长、base64/URL/路径接受行为依实际版本；不能由string类型推出所有scheme合法。 |
| 普通file段 | KnownMessageSegment没有专门FileSegment，但AnyMessageSegment允许通用段；上层send包装明确有file路径 | 存档支持发送file element的证据已补足（2.4节）；本部署具体字段/notice双报/版本仍unknown。 |
| `upload_group_file` | `{group_id,file:string,name?,folder?,folder_id?,upload_file?:boolean}` → SDK `{file_id:string|null}` | 上层schema已核 **upload_file默认true**，传入groupFile.upload；同层send包装注释明确true上传会publish。应按外发操作规划；底层实际效果/false语义与用户版本未验。file_id不是message_id。 |
| `upload_private_file` | `{user_id,file:string,name?,upload_file?:boolean}` → SDK `{file_id:string|null}` | 上层schema默认true；true时handler明确调用sendPrivateMessage，成功仅返回file_id，丢弃发送message_id。不是无外发的缓存上传；细节见2.4节。 |
| `get_group_file_url` | `{group_id,file_id:string,busid?:number}` → `{url:string}` | URL权限、有效期、跨群/跨账号拒绝；不能把busid猜成通用scope。 |
| `get_private_file_url` | SDK仍声明`user_id/file_id/file_hash`必填；**同commit上层handler实际user_id可选、file_hash默认空串、file_id必填** → `{url:string}` | 已确定存在类型/handler漂移，不能再把SDK三参数要求当wire硬条件。此存档schema接受file_id-only；缺少信息能否成功下载及用户实际版本仍待核，保留已有hash/身份且不伪造缺失值。 |
| `get_image` / `get_record` | `{file?:string,file_id?:string}` → `MediaInfo extends JsonObject` | 返回体是开放对象；没有足够类型约束确认url/path/codec。该typed声明未列标准get_record.out_format，不代表它运行时拒绝或兑现所有转码。 |
| `get_file` | 同 GetMediaParams → JsonValue | 不据泛型返回值认定普通文件可取得或可读取宿主任意路径。 |
| `download_file` | `{url?,base64?,name?,headers?:string|string[]}` → `{file:string}` | 是协议端文件物化候选；不自动把本项目凭据放进headers，返回路径不是本服务宿主路径。 |
| `fetch_ptt_text/get_ptt_text/get_record_text` | `{message_id: number|string}`（非零有符号）→ `{text:string}` | 仅说明存在转写查询契约，不替代已选Magpie ASR或转写来源标记；本轮不调用。 |
| `get_version_info/get_login_info/get_status/can_send_*` | version=`app_name/app_version/protocol_version`；login=`user_id/nickname`；status=`online/good/time`；capability=`yes` | 即使将来获得返回，也只是实例身份/基础状态，不是一切媒体已验收。当前均未请求。 |

**与 AstrBot 的具体差异：**AstrBot文件分支拿data.url或调用get_*_file_url，再发扩展file段；这只是参考方案。SnowLuma同commit的SDK与handler已有参数漂移，以上层已核schema解释该存档wire，实际部署仍独立验证；upload_*_file的file_id不可包装成send_msg的message_id，也不能“上传后再发一次”而忽略默认已发送。

### 2.2 跨机器字节传输候选

[media.ts][sl-media] 的 `MediaSource=UploadFileSource|NamedMediaSource` **明确排除string**，注释说明现有string路径指向server。`NamedMediaSource` 带source/filename；[streaming.ts][sl-streaming] 的字节源是 `Uint8Array|Blob|ReadableStream<Uint8Array>|AsyncIterable<Uint8Array>`。这支持“协议端路径与本项目文件对象分开”的设计，不代表可以加载该SDK绕过现有Kernel资源权限。

| action | 存档SDK字段/回包 | 验收含义 |
| --- | --- | --- |
| `upload_file_stream` | 请求 `stream_id`、可选`chunk_data/chunk_index/total_chunks/file_size/expected_sha256/is_complete/filename/reset/verify_only/file_retention`；创建时要求total_chunks | 精确chunk编码/边界/副作用以版本协议核实。stream_id必须一次上传独有；不能在结果未知时随意重置并重复后续外发。 |
| 上传进度 | `type=stream,status=file_created|chunk_received,received_chunks,total_chunks` | 分片确认，不是上传完成或QQ发送。 |
| 上传完成 | `type=response,status=file_complete,stream_id,file_path,file_name,file_size,sha256,received_chunks,total_chunks` | 只证明协议端报告文件完成；需核大小/hash，随后另行受控发送，不能直接称用户收到。 |
| `download_file_stream` / `download_file_image_stream` / `download_file_record_stream` | 请求file或file_id，chunk_size可选；结果先`data_type=file_info`，后`file_chunk`带index/base64 data/size/progress/base64_size，末尾`file_complete`带total_chunks/total_bytes | 需要流式读取完整终态并验证累计长度；提前断流不成功。3个action的实际资源范围分别验收，不认定generic必支持全部群文件。 |
| 流错误 | failed envelope，可能没有stream marker；错误data可为`type=error,data_type=error` | 先处理失败再等流标志，否则鉴权失败可能被误判为挂起。 |

SDK选项声明 decoded chunk `1..1,048,576` 字节、默认64KiB，`expectedSha256`、按chunk确认后await onProgress；`fileRetention=0` 表示不自动过期。这些是SDK声明，不是QQ媒体上限，也不是本项目默认。64KiB bytes经base64后已超过64KiB业务JSON；传输需走明确授权的私有媒体通道，不能把bytes塞进canonical command/event。文件留存/清理只针对owned transfer，不能调用清理整个协议端缓存的动作冒充本任务cleanup。

### 2.3 反向WS、自消息与错误

[SDK反向WS说明][sl-reverse] 描述：SnowLuma连接本方server；Universal或分离Api/Event；握手account/role必填，事件self_id须与连接一致；活跃重复channel拒绝409；断开后旧session/pending request失败，**不自动重放action，也不持久补齐断线期间事件**。这是存档SDK的说明，不是现有部署观察。

配置示例使用`messageFormat=array,reportSelfMessage=false`，不能据示例声称安装默认已关闭。[events.ts][sl-events] 允许`post_type=message|message_sent`，private/group都有可选message_seq；sender没有通用bot字段保证。自身消息、其他bot及跨协议身份的处理按既有媒体报告分别验收，不用昵称/文本相似性自动合群。

[SDK README][sl-readme]：raw在status=failed或retcode非零时抛错误，rawResponse保留整包；WS echo关联响应，并发echo必须不同；timeout/abort/connection/parse/auth/API errors分型。因此标准OneBot `async/retcode=1` 不能被本项目笼统当成功，也不能因SDK将其抛错就断言远端没有执行。SDK的取消仅是本地请求生命周期，远端发送是否发生仍可能unknown。

### 2.4 上层 action 的文件发送副作用补查

同日追加只读，仍是第三方存档pin `62bb85d2a1c186dc7e40c63a3ffc06be46f7d325`。证据止于 [group-file actions][sl-file-actions]、[message actions][sl-message-actions]、[OneBot message包装层][sl-message-wrapper]，没有继续读取被调用的bridge/QQ协议/native实现。以下是该存档的**上层代码事实/调用契约**，不是安装事实或真实投递证明；本次仅extract，Anysearch长文件被截断后用web_fetch读同一文件补足，无新增search待评分。

- **默认值确定：**`upload_group_file` 和 `upload_private_file` 均声明 `upload_file: f.bool().default(true)`。不能把省略此字段理解成“无消息副作用”。群action将group/file/name/folder/该flag交给`ctx.bridge.apis.groupFile.upload`；OneBot `sendGroupMessage` 的相同调用旁明确写“upload已经内部publish，不要再publish”，足以将该上层契约归为潜在/预期外发，而非纯缓存上传。底层false分支及用户版本未在此审计。
- **私聊默认发送有显式调用证据：**handler先调用`uploadPrivate(user_id,file,name,upload_file,false)`；flag为true时要求非空fileId并核对`recallUploadedFile`的private scope/userId，然后 `await ctx.sendPrivateMessage` 发file段，携`file_id/name/file_size/md5/file_hash`。最后只`okResponse({file_id})`，并不返回刚才的message_id。false跳过这个**显式发送分支**，但不能据此猜测底层是否只注册元数据、是否已上传字节或完全无其他副作用。
- **成功返回与文档形状：**两个action的returnsSchema写必填string file_id；SDK类型则允许null。私聊true在上层明确拒绝空ID，群action仅转交`result.fileId`；false路径也不应臆造有效ID。无论string/null都不产生“用户收到”的证据。
- **普通私聊file段：**`sendPrivateMessage` 把non-file与file分开。file仅有URL/path时，先`uploadPrivate(...,true,false)`，再显式`sendC2cFile`并保存回执；已有fileId则直接调用sendC2cFile。该包装层最后只返回**最后一个batch的messageId**。一个混合[text,file1,file2] action可能已发前面内容后在后续失败，单个回包不能描述全部part。临时群会话的file在发送前被拒绝，不能自动改发好友私聊。
- **普通群file段：**`sendGroupMessage` 对URL/path无fileId调用`groupFile.upload(...,true)`，注释明确此调用内部publish，不能再追加publish；已有fileId则显式`groupFile.publish(groupId,fileId)`。non-file内容先发送；file路径失败可留下先前副作用。不要把默认upload_group_file之后再send_group_msg(fileId)拼成必需两步，否则按此契约可能重复发布。
- **群message_id有语义陷阱：**纯file路径没有先前普通消息回执时，包装层从fileId派生本地opaque messageId，记录`sequence=0,clientSequence=0`；`finalizeSend` 保留`sequenceAuthoritative=false`。混合[text,file]可沿用普通text回执。故send_group_msg返回message_id也未必是每个文件对应的QQ服务端序号，不证明可撤回、全部发布或用户收到。
- **取数参数纠正：**同一group-file action的get_private_file_url是`user_id.optional()`、`file_hash.default('')`、file_id必填，缺user_id传0给下一层；注释说明这是file_id-only兼容。此前SDK三参数是类型声明，不应作为本存档实际schema的唯一依据。

相应E2/E3候选：在明确授权的小样本目标上分别记录省略/true/false的upload_*调用、实际文件/聊天侧效果与回执；**不为了验证而再盲发fileId**。受控peer先覆盖“上传完成后显式send失败”“私聊send成功但只有file_id返回”“群纯file生成opaque ID”“混合批次前成功后失败”；实际E3未授权且用户版本仍unknown。上传字节、QQ文件发布/聊天发送、回执取得、用户可下载四项独立，任何错误或unknown均不整体重发。

[sl-file-actions]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/onebot/src/actions/group-file.ts
[sl-message-actions]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/onebot/src/actions/message.ts
[sl-message-wrapper]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/onebot/src/modules/message-actions.ts

## 3. 验收组织：先证据级别，再结果

当前所有候选用例都是 **planned / not-run**。下列层次不是已完成状态：

| 层次 | 计划中的环境 | 可以证明 |
| --- | --- | --- |
| E0 静态契约 | 本文固定来源与已有文档，已完成查阅 | 字段/协议依据、冲突与unknown；不能证明运行成功。 |
| E1 本地逻辑 | 批准实施后，自有synthetic输入、纯codec/授权/状态测试，不导入受限上游实现 | schema、归一化、identity/ACL/回执规则、确定性边界。 |
| E2 受控协议peer | 批准实施后，isolated data root/自有凭据，本地mock QQ gateway/HTTP与OneBot peer，实际本地socket/流，模型用标明synthetic的provider | 真实传输、断开、背压、取消、源generation与权限整合；不是QQ账号或Magpie实际能力。 |
| E3 指定真实平台 | 以后单独明确授权的账号、私聊接收者/测试群、媒体样本、调用/条数预算、可读版本信息及动作清单 | 只证明该版本/账号/目标/样本/时间的实际兼容和收取。当前未授权，全部not-run。 |

模型/ASR/TTS/judge的真实Magpie调用也需独立授权；历史M5单次授权不复用。E2不得连接已部署SnowLuma、读取其配置/token，或启动原4120。真实账号的禁言/退群/权限变更/频控压力不作为默认测试动作，拒绝/过期/限流先用E2注入。

每项证据应记录：用例ID、版本/源码commit或unknown、protocol/source instance、去标识化account/target、样本大小/格式/hash、触发方法、预期/实际、发生时间、平台安全错误码/消息ID、结果层次。凭据/临时URL/auth_token、真实私人聊天内容不进报告。`fixture-pass`、`platform-api-accepted`、`human-confirmed` 分开，任何一项不能改写另一项。

## 4. 全媒体的独立验收单元

以下每行都拆成四个独立实例：**O-D（官方私聊）、O-G（官方群）、S-D（SnowLuma私聊）、S-G（SnowLuma群）**。例如M03产生M03-O-D等四条记录；不能以“群图片成功”代替“私聊语音成功”。主动与被动/事件触发还按第6章分别验证。

| 用例 | 官方QQ路径 | SnowLuma路径/候选 | 通过条件 |
| --- | --- | --- | --- |
| M01 入站文字 | content/id/author/scene | message text段/self_id/sender/sub_type | 保留内容、稳定origin与原目标；重复仅入账一次；不读其他人的上下文。 |
| M02 出站必有文字 | msg_type0/2，按场景messages | send_private_msg/send_group_msg | 每次获准回复都有文字内容与独立发送记录；声称平台接受需合法关联回包；对端显示另记E3证据。 |
| M03 入站图片 | attachments.url/type/size | image file/url；必要get_image或image_stream候选 | 权限检查后取得有效图片；原件/模型预览归属分清；过期/坏图不会伪造图片理解。 |
| M04 出站图片 | files(type1)→media.file_info | image段或SDK声明的字节上传后发送候选 | 验证图片字节/目标，上传与发消息回执不同；必有文字说明/回复；图片失败不删文字。 |
| M05 入站语音 | voice URL/WAV引用，参考ASR标出处 | record file/url；get_record/record_stream候选 | 真格式探测/解码→既有授权Magpie ASR路径；不把空转写/坏音频认成有效指令；E2转写用synthetic明确标记。 |
| M06 出站可选语音 | type3，明确codec，再media发送 | record段/已核该版本语音方法 | voice开启时有效容器/编码、完整采样、实际时长可核；文字一直保留；voice关闭时零TTS/语音上传/发送。 |
| M07 入站文件 | attachments+引用中附件 | file扩展或group_upload，URL查询需完整参数 | 原文件名只作显示，字节/大小/hash与sender/audience绑定；只取获准附件；notice+message双报不重复处理。 |
| M08 出站文件 | files(type4)→message | upload_group_file/private_file或确认的file段 | 准确区分协议端缓存上传、QQ文件上传/卡片发送；file_id/null不冒充message_id；文字必有，接收者真正可下载单独E3确认。 |
| M09 混合与引用媒体 | content+attachments/msg_elements，REFIDX显示引用 | text/image/record/file/reply，多事件关联 | 原顺序/源作者保留，引用不是新授权；逐media结果可见，不丢媒体后称完整成功。 |
| M10 长文字/多附件 | 依据限额规划每part与msg_seq | 依据固定实现能力规划segments/actions | 完整文字保留，无silent truncation；每part稳定关联、部分成功不整批重发；不能以仅voice/仅媒体取代文字。 |
| M11 长语音/文字+语音 | 验证实际codec/时长/软限降级 | 验证选定版本codec/时长 | TTS/转码/上传/send任一步失败均保留文字；多voice part只记真实完成部分，不称已全部播放。 |

M03–M11的最大字节、语音秒数、文字分段阈值必须来自设计中明确的有界产品策略及对应平台证据。未知平台上限不设成无限，也不从社区数字猜测。测试安全小样本通过只能证明该样本；平台上限附近测试以后另行授权，E2可先覆盖阈值前/等于/后与Unicode、空文件、坏头、错误MIME等边界。

## 5. 双源共同的准入、权限、隔离和生命周期

下表E1/E2都必须分别在O、S路径跑，涉及group/private的场景再分别覆盖；不得只单测纯函数而绕过真实PluginHost/TaskSupervisor/PermissionKernel/CredentialBroker。

| ID | 注入/触发 | 必须观察到的结果 |
| --- | --- | --- |
| C01 普通源生命周期 | 分别启用、停用、重载、移除一源 | 仅该源停止新入站/出站并确认owned socket/media/task drain；另一QQ源、Web/Desktop和Agent继续；cleanup未确认不报完全停止或启替代。 |
| C02 generation/CAS | 待发送时换账号/目标/配置、旧callback晚到 | 旧generation结果不得发布到新实例；目标绑定密钥不自动继承；错误CAS不破坏健康配置。 |
| C03 凭据边界 | 错key、撤销、401/403、返回体echo key | 拒绝并脱敏，零借text/ASR/TTS/AstrBot凭据；取消native请求且等待settled；QQ/OneBot秘密不进DTO/log。 |
| C04 人员/群准入 | 名单内/外多人私聊、指定/未指定群、身份缺失/篡改 | 在Agent、下载、judge和外发副作用前拦截未准入输入；群允许不等于所有成员管理员。 |
| C05 受限工具 | 普通成员允许/未允许action，伪称owner/引用admin消息 | participant grant与source capability交集；不能靠prompt自报身份、引用或上一轮role升级。 |
| C06 own tasks | A建任务，B读/停/取artifact；A与管理员操作 | B不能借taskID越权；允许的own操作保留真实owner；管理员跨人管理走明确授权路径。 |
| C07 facts写保护 | 成员请求新建/更改/删除/公开facts，包括自己的scope | 四项全部拒绝且无state mutation；写聊天上下文不自动写长期facts；仅owner/显式admin可写。 |
| C08 facts与上下文可见性 | 私聊A/B、群G1/G2、公开/私有facts交错 | 入模型、检索、judge、工具结果、Web投影/QQ回送全部按受众过滤；public可读不等于public可写。 |
| C09 双源同名/同文本 | 两源使用相同显示群名、相近时间/相同文本 | 不猜同群/同人，不自动合并context、授予权限或跨源重发；每源独立外部identity。 |
| C10 重复/乱序 | 重连后重复event、延迟结果、重复发送回包 | 一次canonical输入/任务effect；不因迟到结果覆盖已核终态；echo或序号不替代业务幂等。 |
| C11 文件安全与配额 | 超预算/错误长度/hash、过期URL、远端file URI、未授权跨目标引用 | 显式失败；不读宿主任意路径、不转发凭据、不绕redirect策略；文件保留/清理属于原任务。 |
| C12 自消息与回声 | 已知自身、known bot、message_sent、自己的错误/任务完成消息回流 | 不触发无限judge/回复；unknown bot不伪造识别；回声关联不删除真实人的同内容消息。 |
| C13 队列与撤权 | 排队后参与者撤权、任务完成时群权限变化 | admission/invoke/外发前重核当前权限；不能用旧admin输入给后来的成员赋权。 |
| C14 进程恢复 | accepted后崩溃、send前后崩溃、未持久回执 | 保留确定状态与unknown，不重跑旧模型/工具/外发；未证实删除/撤回不宣称已恢复无副作用。 |
| C15 Web/Desktop | Web改开关/名单/预算/凭据，Desktop刷新与跳转 | Web是唯一完整管理面；Desktop读服务状态并开入口，无独立配置owner/秘密；QQ成员不能调用管理API。 |
| C16 资源与稳定性 | 有界媒体流、reader慢、断流、取消、disposer拒绝 | 实际work和TaskHandle.settled都观察；资源未回收不伪报成功；不累积大base64到64KiB业务事件。 |

## 6. 官方 QQ 专项

官方来源与精确字段见既有媒体报告，本表不重复维护整套限额。

| ID | E2候选刺激；E3仅在获准时验证正常样本 | 通过条件/仍未知 |
| --- | --- | --- |
| O01 Gateway | Hello/Identify/READY、heartbeat ACK丢失、Reconnect/InvalidSession、Resume补发 | 连接状态如实变化；凭据不泄露；恢复游标≠已持久业务，重复可去重；不假称永不丢消息。 |
| O02 群@/全量 | @事件content已去前缀、mentions无自身；全量含非唤醒上下文 | @能按事件语义触发；非唤醒按群context策略存取，只有规则/judge允许才回复。 |
| O03 主动权限 | 用户/群拒收、无关系/被禁言、限流 | 失败具体可见；不改主动开关、不删msg_id自动兜底；规则/judge批准不能越过平台拒绝。 |
| O04 被动窗口 | 群5分钟/5次；C2C 5与60分钟两种受控响应；次数耗尽 | 过期/超次数明确结束该发送计划或进入设计认可的等待策略，不无限重发；C2C真实窗口仍unknown，不能标已验证60分钟。 |
| O05 引用/去重 | msg_id、event_id、REFIDX混用；相同msg_id+msg_seq | 拒绝字段混淆；UI引用不产生回复授权；相同意图未知时不随机换seq重发。 |
| O06 上传only | files `srv_send_msg=false`成功，随后send失败/未调用 | 只记上传完成；不记QQ发送；已成功文字保留，后续媒体不自动重传。 |
| O07 上传即发送 | peer返回srv_send_msg=true对应id | 若设计根本不使用此模式，应拒绝错误构造；若采用，必须计一次真实外发，不能再多发一次；E3需明确授权。 |
| O08 分片 | prepare→PUT→finish→merge，坏hash/少part/重复part/合并超时 | 正确累计字节、保留阶段状态与unknown；QQ token不传给COS任意URL；不照抄AstrBot10MiB直传阈值。 |
| O09 类型/大小 | 软限降file、硬限拒绝、普通文件无raw_url | 降级representation显式呈现，不能称语音播放/图片展示成功；file_info/ttl与实际目标绑定。 |
| O10 Codec | image真假格式、Tencent SILK前缀、PCM/WAV混标、声称mp3但坏容器 | 本地codec验证失败明确；实际支持codec/时长在E3逐项定，文档矛盾不“挑一个都支持”。 |
| O11 长文字/多media | 单媒体payload、多次消息、4/5次配额耗尽 | text总内容保留，逐part结果与预算一致，不能前半成功后整包重发；超额不伪报完整交付。 |
| O12 流式文字（若设计使用） | `/stream_messages`首片/续片/结束、replace前缀不符、remain_msg_len | 不把旧AstrBotstream{}路径当当前契约；群不伪装同接口；末片失败不报全文已显示。 |

## 7. SnowLuma / OneBot 专项

以**用户实际部署版本**为E3基准；第三方v2.3.4存档只是E1/E2候选形状。若实测版本不支持某扩展，保留未完成项，不偷换协议端或把首版文件需求标“可选”。

| ID | E2候选刺激；真实兼容待授权 | 通过条件/版本未知处理 |
| --- | --- | --- |
| S01 身份/能力 | get_version_info/status/login的合成回应与不支持action | 分别记录identity/readiness/capability，不凭catalog或version号宣布媒体全支持；当前installed version保持unknown。 |
| S02 Reverse WS | Bearer/错token、错self_id、未知role、Universal/split、重复活跃channel | 按所选本项目契约拒绝或准确绑定；不能Event-only就显示可发；跨账号echo不串；端点不是实例自动扫描所得。 |
| S03 断开 | 发送后断链、API/Event任一断开、重连 | pending操作变unknown/明确未发；旧对象不继续发送，不重放actions；不承诺断线事件持久补发。 |
| S04 Envelope | status failed/retcode≠0、async1、缺echo/重复echo/非法JSON、有效负message_id | 正确关联分型；异步受理不等最终成功，SDK抛异常不等无副作用；不错误拒绝有效有符号ID。 |
| S05 私聊文件URL形状 | 存档handler接受file_id-only，SDK仍要求user_id/hash；两套peer fixture | 按固定版本处理schema与取数失败，不因旧SDK类型无条件拒绝file_id-only；不猜hash/user_id、不静默跨账号查找。 |
| S06 群文件关联 | group_upload notice、file段、两者双报、file_id/size/busid不同 | 正确入站文件且去重不误合并；群号和sender来源真实，不能仅凭filename匹配。 |
| S07 专用文件发送 | upload_*省略/true/false；私聊显式send后仅file_id；群纯file opaque ID；混合前成功后失败 | 存档默认true按外发权限/任务跟踪，不能上传后再盲发fileId；false真实语义按版本验。file_id/本地message_id/QQ序号分清；单一最终回包不掩盖part结果。 |
| S08 跨机上传流 | stream创建/chunk/complete、wrong sha256/size/count、取消、reset | 终态才得到owned remote path；路径绝不当本地；文件完成后仍需独立发送，旧stream不污染新owner。 |
| S09 下载流 | info/chunk/complete、无stream marker失败、坏base64/跳index/超预算/断流 | 校验累计bytes和终态；局部下载不成功；generic/image/record资源范围分别认定。 |
| S10 语音与图像能力 | get_image/get_record开放结果、out_format差异、URL/base64/server path | 对未声明字段/codec明确unknown；不自动假定支持标准所有转码或共享宿主路径。 |
| S11 自消息 | reportSelfMessage true/false的fixture、message/message_sent、self身份变化 | 自身不再次触发；示例false不是部署事实；其他bot识别与权限另测；不能靠没监听某事件掩盖循环。 |
| S12 清理/保留 | owned缓存到期、仍活跃上传、取消时清理失败 | 不删除共享/他人文件，不调用全局clean_cache“修复”；确切保留能力按版本验证。 |

## 8. 必须单独证明的产品结果组合

| ID | 组合 | 预期事实与行为 |
| --- | --- | --- |
| R01 文字成功，语音关闭 | 正常文字回复 | 文字记录/回执独立成立，零TTS；不能因支持voice就默认调用。 |
| R02 文字成功，TTS失败 | 已启用语音但provider拒绝/超时/坏PCM | 文字保留；语音失败明确，无voice-only fallback、无重发文字。 |
| R03 文字成功，语音上传成功/send失败 | 分阶段故障 | 文件已上传不伪报语音已发；整体可标部分结果，但文字成功状态不可回退为未发生。 |
| R04 文字失败或未知，语音可能已接受 | 部分外部副作用 | 保留文字完整内容供授权管理面查看；不得称满足“文字已送达”或完整成功；不以语音替代文字，也不整体重发。可选音频是否等待文字接受由设计固定并测试。 |
| R05 图片/文件失败，文字正常 | 生成/下载/转码/上传/send任一点失败 | 每media失败分型，文字正常独立完成；不能丢失败media后称完整结果已发。 |
| R06 长结果前N段成功，N+1未知 | 接口超时/断线/重启 | 保留每part identity和结果；禁止从头重发。仅在明确授权和明确幂等/未发生证据下处理未完成部分。 |
| R07 群概率/规则触发 | 确定性随机源、阈值/预算/关闭/冷却 | 禁用即零主动生成和发送；相同获准context的规则行为可复核，不读私人facts。 |
| R08 Magpie judge | 合法yes/no、坏JSON、异常、预算用尽、晚到结果、尝试工具调用 | judge只读已授权群context；无工具/写facts权限；失败按明确设计静默跳过或可见诊断，不制造回应授权；不实际调用模型于本轮。 |
| R09 管理员facts | admin写私有/群/公开facts，成员读/尝试改 | 既有state事务/CAS及authority执行；公开标记变更即权限变更；不可用persona/prompt代替校验。 |
| R10 后台任务完结 | 发起者A的task完成时B正在另群发言或source已停 | 原受众/owner固定；不回“最近活跃群”；已完成任务事实保留，发送失败独立，不重跑任务。 |
| R11 双bot回声 | 两协议同名未绑定群；显式绑定测试目标中的A→B→A | 未绑定不合并；已绑定按明确抑制/路由测试终止循环；机器输出不变成人类指令。 |
| R12 管理面可理解性 | Web/desktop展示混合状态 | 分开连接/配置/平台接受/部分/未知/未真实验收；无“绿灯=用户收到”；Desktop不写另一份QQ配置。 |

R02–R06适用于四个目标组合；不能只测文字失败或只测语音成功。已选择“文字必有”也不授权失败时无限补发提示；错误通知自身同样受发送配额和防循环规则。

## 9. 真实平台 unknown 的处理与后续材料

尚缺但不阻碍完成协议设计的材料：实际SnowLuma版本/构建标识；已配置OneBot方向/消息格式/所需文件扩展；明确测试账号与目标；允许的媒体样本、字节/时长/条数和模型调用预算。由用户或管理员主动提供非秘密版本资料即可开始固定兼容目标，不要求上传私有配置、.env、账号数据或token；是否读取授权端点的get_version_info以后另行决定。

必须继续标unknown的项目：

- SnowLuma存档与实际安装是否一致；私聊file_hash要求、upload_file副作用、开放MediaInfo形状、文件段字段、跨机stream动作及codec/限额的真实支持。
- 官方C2C回复窗口文档冲突；统一普通文本字符/字节上限；统一语音秒数；mp3/wav/ogg等格式分歧；附件URL有效期与软限降级显示行为。
- 用户真实接收、完整下载与语音播放；平台API接受不是此证据。

unknown不是假成功，也不是删掉首版功能。若受控fixture全部通过但E3未授权，报告为“受控协议测试通过、真实平台未验证”；若必须的扩展在实际版本不支持，报告具体缺口并回到兼容设计，不自动安装镜像、迁移账号、换协议端或复制native实现。验收结论按源×场景×媒体独立维护，一个未通过项不能被另一路成功覆盖。

[ob-root]: https://github.com/botuniverse/onebot-11/tree/d4456ee706f9ada9c2dfde56a2bcfc69752600e4
[sl-root]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325
[sl-readme]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/README.md
[sl-reverse]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/REVERSE_WEBSOCKET.md
[sl-actions]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/actions.ts
[sl-action-map]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/actions.ts
[sl-params]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/params.ts
[sl-results]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/results.ts
[sl-messages]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/messages.ts
[sl-events]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/events.ts
[sl-media]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/media.ts
[sl-streaming]: https://git.fragrance.moe/shouko/SnowLuma/src/commit/62bb85d2a1c186dc7e40c63a3ffc06be46f7d325/packages/sdk/src/types/streaming.ts

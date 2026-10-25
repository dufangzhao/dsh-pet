# M1 v1 契约实现基线

状态：主会话冻结的本轮实现接口，API 1.0.0 / wire protocol 1；不是公开稳定发行。M0的pet-prototype接口原样保留。依据docs/13草案及已采纳ADR，不改变产品范围。

## 1. 边界与入口

插件同一标准；来源、可信与protected由宿主赋予，清单不得声明。SDK不暴露Electron、Cordis Context、任意IPC或全局注册表。插件仍是可信本机程序，SDK不是OS恶意代码沙箱。M1内部使用instanceId+generation隔离，默认单实例，不承诺多实例设置界面。

contracts根入口只导出类型、纯常量、Schema数据、固定错误文案，禁止导入Node/Electron/Ajv/semver或执行代码生成。新增@pet/contracts/validation宿主子路径，使用Ajv8.20.0、semver7.8.5及@types/semver7.8.0；不做I/O/网络。保留既有pet-prototype.ts与十四项测试。

## 2. 基础类型

JsonValue = null | boolean | finite number | string | JsonValue[] | JsonObject。JSON预检拒绝循环、访问器、函数、symbol、bigint、undefined、NaN/Infinity、危险键__proto__/prototype/constructor；只接受普通/null原型对象。深度<=32、总键数<=4096、UTF-8序列化<=65536字节。不得触发输入getter/toJSON。

PluginId：1..128，ASCII小写字母起始，后续小写字母/数字/点/连字符；禁止连续点以及首尾点/连字符。official/core前缀不赋权限。
LocalId：1..128，ASCII字母/数字起始，后续字母/数字/点/下划线/连字符，禁止危险原型键；无斜杠、空白或冒号。用于instance/provider/contribution/credential/request/task/session/stream。
OwnerRef={pluginId:PluginId,instanceId:LocalId,generation:positive safe integer}。通道身份由宿主绑定，载荷owner不能当授权凭据。
CapabilityId=domain.name@major：前缀小写字母起、字母/数字/点，至少一个点、每段非空；主版本正整数。允许input.talkKey@1。

KernelErrorCode：not-ready、invalid-input、auth-failed、quota-exceeded、rate-limited、network、unavailable、timeout、cancelled、internal、permission-denied、stale-owner。
KernelError={code,messageKey:errors.<code>,retryable:boolean}；用固定ERROR_MESSAGES查表，不带原始异常/Key/用户内容。Result<T>={ok:true,value:T}|{ok:false,error:KernelError}。导出makeError(code,retryable?)、errorMessage(error)。无返回值用Result<null>。

## 3. 清单

PluginManifest必填schemaVersion:1、id、version、displayName、description、license、host、platforms、entries。所有对象拒绝未知字段，以下可选字段除外均必填。
- version完整SemVer，不接受v前缀或空白；host合法semver范围。启用时检查宿主API版本；默认不把预发布版视为稳定兼容。
- displayName/description为1..8项本地化字典；语言键使用简化BCP47，值为非空文本，分别<=128/1024字符。UI仅按文本渲染。
- license非空<=128字符，声明不等于法务鉴定。
- platforms：1..8个无重复值，限win32-x64/win32-arm64/darwin-x64/darwin-arm64/linux-x64/linux-arm64；实际发行仍Windows-x64。
- entries={runtime:RelativePath,ui?:RelativePath,workers?:Record<LocalId,RelativePath>}。不开放普通插件main入口；UI/worker启用位置仍由宿主决定。
- RelativePath：非空<=240，使用/；拒绝绝对路径、盘符、反斜杠、空段、.、..、尾点空格、ADS、Windows保留设备名。词法检查不代替宿主的realpath/符号链接检查。
- provides?:ProviderDeclaration[]，最多32，形状{id:LocalId,capability:CapabilityId,features?:JsonObject}；provider id唯一。
- consumes?:ConsumptionDeclaration[]，最多32，形状{capability:CapabilityId,optional:boolean,features?:JsonObject}；capability唯一。
- contributes?:ContributionDeclaration[]，最多64，id唯一。通用id、kind、title（本地化字典）；kind额外字段：command{handler:LocalId}、shortcut-button{command:LocalId}、hotkey{command:LocalId,defaultKey?:string<=64}、settings{section:LocalId}、panel{entry:RelativePath}。按钮/热键引用同清单已声明command，不接受任意脚本。
- config?:{version:positive integer,schema:JsonObject,apply?:Record<string,immediate|reload|restart>}。M1-01仅检查JSON安全结构，M1-05落实受限设置Schema子集，拒绝远程ref/动态代码。Key不能写普通配置。
- permissions?:PermissionDeclaration[]，最多64，见下节。
- resources?:ResourceDeclaration[]，最多64且id唯一：{id:LocalId,url:HttpsUrl,bytes:positive safe integer,sha256:64位小写hex,license:string,shared:boolean}。URL禁止userinfo/fragment；声明不等于文件已校验。

导出PLUGIN_MANIFEST_SCHEMA与validateManifest(value):Result<PluginManifest>；checkCompatibility(manifest,{hostApiVersion,platform}):Result<null>，不兼容返回not-ready。校验错误不能回显输入，不自动安装依赖/取网络/执行入口。

## 4. 权限声明

PermissionDeclaration为以下判别union，拒绝未知字段：
- {kind:capability-use,capability:CapabilityId}
- {kind:microphone} / {kind:screen-capture} / {kind:text-input}
- {kind:network,origins:HttpsOrigin[]}：精确规范化HTTPS origin；无通配符、userinfo、路径、query、fragment；规范化后必须与输入相同。
- {kind:credentials,keys:LocalId[]}：仅当前实例命名空间，无任意namespace参数。
- {kind:files,scope:plugin-data|resources|user-selected,access:read|write|read-write}
- {kind:process,workers:LocalId[]}：只引用entries.workers已声明项，M1不实现任意外部程序启动。
- {kind:clipboard,access:read|write|read-write}
声明不等于授权；类型中的屏幕/文字输入不是本轮功能实现。消费者capability-use与提供方系统操作双侧检查。

## 5. 生命周期、绑定、任务

PluginLifecycleState：rejected、disabled、activating、active、unready、failed、deactivating、pending_restart。PluginStatusSnapshot={owner:OwnerRef,state:PluginLifecycleState,reason?:KernelError}。
激活先暂存注册，成功才发布，失败逆序回滚；停用先拒绝新任务并隐藏贡献。清理超时且不能独立终止时标pending_restart，不谎称已卸载。每次启用新generation，旧实例结果永不复活。

导出MVP_CAPABILITIES纯常量：input.talkKey@1、audio.capture@1、speech.asr@1、llm.chat@1、chat.session@1、avatar.render@1。
CapabilityBinding={capability:CapabilityId,consumer:OwnerRef,provider:OwnerRef,providerId:LocalId}。任务开始时固定，设置更改不迁移在途任务，不静默改提供方/目的地。
TaskState：pending、running、cancelling、completed、failed、cancelled、timed-out。
TaskContext（仅进程内）={taskId:LocalId,owner:OwnerRef,signal:AbortSignal,deadline?:number}；deadline是当前时钟域单调毫秒，不能直接跨进程比较。
TaskEvent<T>={taskId,owner,sequence:nonnegative safe integer,kind:started|progress|data|completed|failed|cancelled,data?:T,error?:KernelError}。结束最多一次，取消后不再交付业务数据。

## 6. 媒体

StreamHeader={streamId:LocalId,taskId:LocalId,owner:OwnerRef,sequence:nonnegative safe integer,byteLength:0..262144}。MediaFrame={header:StreamHeader,payload:Uint8Array}；字节数须匹配。使用自有缓冲，不使用sherpa.readWave外部ArrayBuffer。
控制预算64KiB；媒体块256KiB、单流8块且总量<=2MiB，无额度不能无限缓冲或静默丢帧却报告成功。音频编码在M3前另冻，M1不编造业务数据。

## 7. 控制IPC

ControlMessage通用必填protocol:1、sessionId:LocalId、id:LocalId、owner:OwnerRef、type；使用以下union且拒绝未知字段：
- request：method:LocalId,payload:JsonValue,taskId?:LocalId,budgetMs?:positive integer<=86400000
- response：replyTo:LocalId,result:Result<JsonValue>
- event：topic:LocalId,sequence:nonnegative safe integer,payload:JsonValue,taskId?:LocalId
- cancel：taskId:LocalId,reason:user|owner-disabled|deadline|permission-revoked|shutdown
- stream-credit：streamId:LocalId,taskId:LocalId,credits:1..8
- stream-end：streamId:LocalId,taskId:LocalId,sequence:nonnegative safe integer,error?:KernelError

导出CONTROL_MESSAGE_SCHEMA、STREAM_HEADER_SCHEMA以及validateControlMessage/validateStreamHeader/validateMediaFrame，返回Result。JSON/Schema只证明形状与预算；身份、请求去重、generation、seq、取消、目标绑定由宿主再校验。普通插件IPC不能发审批答复。原始凭据不进通用IPC，凭据代理另用敏感通道且禁日志旁路。

## 8. 主会话服务约束

凭据使用safeStorage异步接口，经注入SecretCipher适配；磁盘仅密文，密文内绑定pluginId/instanceId/localKey。client由宿主绑定身份/世代，不接收任意namespace。访问前、解密后、结果交付前均检查授权/撤销/取消。JS字符串不能承诺擦除，同用户恶意程序不在隔离承诺内。
权限区分声明/预设/单次审批；默认拒绝。审批不可用、取消、过期、旧世代都拒；一次授权绑定规范化操作指纹和nonce并消费，不跨请求复用。审计仅固定metadata，不记payload/音频/转录/提示词/Key/URL query。
配置先校验候选副本，迁移成功后原子提交，失败旧配置不变。目录由宿主绑定实例。插件管理器、路由、任务及SDK类签名由主会话在后续工作包前补冻，不由子任务猜测。

## 9. M1-01 验收

测试正反清单、官方/外部同Schema、未知protected/origin/trusted拒绝、路径和设备名、重复ID和command/worker引用、SemVer/能力名、错误无输入回显、JSON预算/循环/getter/危险键、取消/媒体类型。根入口不引入Node/校验器；既有M0接口与十四项测试不回退。

## 主会话复核补充

config Schema的结构安全预算为16KiB（仍受全清单64KiB上限）；实际表单子集在M1-05实现。validation为宿主/Node入口，可用Node原生isProxy先拒绝Proxy；根入口仍无Node依赖。数组不允许不可JSON表示的自有额外属性，隐藏访问器也拒绝。validateMediaFrame检查数据描述符和TypedArray内部槽后返回自有字节副本，不共享上游可复用缓冲区。

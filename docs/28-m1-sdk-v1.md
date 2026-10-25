# M1-09 SDK与媒体接线基线

## SDK实现范围

packages/plugin-sdk根入口只依赖@pet/contracts的浏览器安全根，导出类型及definePlugin。宿主工厂createPluginHostServices位于@pet/plugin-sdk/host子路径，可使用contracts/validation的Node安全校验；不得依赖host-kernel/Electron/网络/文件系统。运行区注入冻结服务对象，插件不拿管理器、审批control或原始IPC。

类型：PluginTask={taskId,signal,deadline?}；PluginConfigSnapshot={pluginId,instanceId,schemaVersion,revision,data:JsonObject}；MediaReference={streamId,taskId,owner:OwnerRef}。

PluginContext={owner,signal,config,provide,contribute,effect,host:PluginHostServices}；provide(providerId,methods)和contribute(id,handler?)均同步注册；methods/handler为(task:PluginTask,input:JsonValue)=>Promise<JsonValue>；effect(factory)接受返回同步或异步disposer的工厂。PluginDefinition={activate(context):void|Disposer|Promise<void|Disposer>;migrateConfig?(request:{fromVersion,toVersion,data:Readonly<JsonObject>,signal}):Promise<JsonObject>}。definePlugin仅检查函数形状/未知字段，返回冻结自有顶层副本，不能执行activate或migrateConfig，不自动创建权限。

PluginHostServices精确字段：version:1、config:{get():Promise<Result<PluginConfigSnapshot>>}、capabilities:{invoke(task,capability,method,input):Promise<Result<JsonValue>>}、media:{openInput(task):Promise<Result<PluginMediaReader>>;openOutput(task):Promise<Result<PluginMediaWriter>>}。无任意request/send，无权限/凭据明文/文件/网络/进程管理API。

PluginMediaWriter={reference:MediaReference,write(payload:Uint8Array):Promise<Result<null>>,end():Promise<Result<null>>,cancel():void}；PluginMediaReader=AsyncIterable<Uint8Array> & {reference:MediaReference,cancel():void}。字节只经媒体port，不通过控制request序列化。输入/输出均相对于插件：input由宿主向插件传，output由插件向宿主传。宿主依据已绑定任务为端点选择业务数据源/去向，不能借streamRef更换owner或任务。

宿主工厂：createPluginHostServices(scope:{owner:OwnerRef,signal:AbortSignal},port:PluginHostPort):PluginHostServices。PluginHostPort精确方法：getConfig(owner):Promise<Result<PluginConfigSnapshot>>；invoke(owner,task,capability,method,input):Promise<Result<JsonValue>>；openInput(owner,task):Promise<Result<PluginMediaReader>>；openOutput(owner,task):Promise<Result<PluginMediaWriter>>。只作为宿主注入参数，不在返回服务暴露。

宿主工厂检查owner、任务ID、原生signal与deadline，绑定scope取消，调用前/后检查失效；JSON输入先预检/复制，返回配置/JSON副本冻结；接口与嵌套服务冻结。ID使用已有契约正则，拒绝危险键，不用String强转接受数组。异常只返回固定unavailable/invalid-input/cancelled，不回显原异常；control Result错误也校验固定形状。无权限时port由宿主返回permission-denied，SDK不越权补默认值。host子路径可复用现有contracts验证，不安装新依赖。

## 主会话宿主与媒体范围

host.config.get与host.capability.invoke通过运行区反向RPC，只接受该peer已启动的精确owner；能力调用须绑定真实父任务并由PermissionService授权，创建受父信号约束子任务。配置只读，metadata不等同于激活实例自动热更新。

逻辑媒体通道使用fd4（宿主→worker）/fd5（worker→宿主）一对单向匿名句柄，启动时有单次校验帧与控制回执；每peer最多64流、每owner/任务最多4流；已知引用才收字节/额度/结束，owner与task精确匹配，有序帧、8块额度、单块256KiB、有界2MiB队列，任务失效即撤销。sender等待额度并在end前确认债务为0，reader消费后返还额度，取消发出有错误的结束并拒绝晚到数据。端口关闭的错误不被写成正常结束。

本轮只接基础SDK与媒体，敏感凭据/网络/文件服务另行冻结/接线；没有真实业务插件或权限UI完成承诺，不自动上传或改数据去向。

# M1-09 正式凭据入口与已知值旁路防护

## 可选SDK扩展

PluginHostServices增加可选credentials:PluginCredentialServices；PluginHostPort增加可选withSecret(owner,task,keyId,operation):Promise<Result<JsonValue>>。PluginCredentialServices唯一方法withSecret(task:PluginTask,keyId:LocalId,operation:(secret:string,signal:AbortSignal)=>Promise<JsonValue>):Promise<Result<JsonValue>>。根入口导出PluginCredentialServices类型，不加入Node运行时依赖。

createPluginHostServices仅在port有合法自有/安全数据属性withSecret函数时增加冻结credentials子对象；缺失则仍精确保留原四字段。存在但非函数/访问器/Proxy原型时固定工厂错误。仍无set/delete/repair/授权/namespace参数。scope owner由工厂绑定，keyId按LOCAL_ID_PATTERN，任务按当前检查，operation必须函数。

回调前后检查scope/任务取消与deadline。port不得将原始异常外传。SDK包装回调：只接受非空、UTF8完整、<=16KiB且无控制字符的原始值/原生signal；用户回调结果先jsonPreflight复制、冻结，拒访问器/Proxy/预算越界。JSON实际字符串与键名若包含当前值、URL编码或Base64形式则拒绝invalid-input，不把明文或原异常放进Result。回调取消/超时/坏结果要传播固定错误；不要让恶意或错误port直接绕过包装给成功结果，必须确认包装实际执行一次后才接受成功结果。

此校验是已知值的有限旁路防护，不承诺识别任意编码、拼接或阻止可信插件直接访问OS。原始值已经交给已批准回调，无法保证擦除插件自留副本。

## 运行区接线

控制host.api仅请求credentials.use，payload为keyId与一次引用，reference.taskId必须对应真实参与者且owner为此peer启动的精确世代；控制ctx.taskId使用reference.streamId作为独立RPC取消票据，不替代业务任务身份。worker先在SensitivePeer登记accept再发控制请求，宿主校验声明与权限后调用CredentialBroker.withSecret，将值由独立fd6（宿主→worker）发送；fd7返回空载荷ACK/取消。普通控制响应只返回Result<null>，业务回调结果留在worker。

Callback结果与host控制结果必须都成功才向插件交付结果；任一失败就撤销本次敏感引用，不能让未授权的accept等待到默认超时。租约保留到ACK，权限/任务/owner撤销会取消两端，晚到结果不交付。每世代broker client仅发放一次，宿主缓存与manifest声明key绑定；插件不能指定另一个namespace或拿管理方法。

KnownSecretBoundary由宿主创建，登记已知原始值及常用编码形式有界保存。控制Endpoint请求/事件/响应和运行区返回值均在结构预检后扫描字符串与键名，不扫描转义后的JSON文本；检测到已知值则固定invalid-input，日志只记固定元数据。SDK媒体出口也拒包含已知值的字节（包括相邻帧边界），敏感管道不套这个普通媒体防护。登记容量耗尽时不交付新值，不静默遗忘旧值。

主进程边界复用broker.redactor已登记值；worker在SensitivePeer.observe先登记再执行回调。worker stdout/stderr不收集为诊断，普通插件控制API仍没有任意send。此机制不是对同进程恶意Node代码的权限沙箱。

## 应用与验收

DesktopHost创建现有配置/数据目录之外的私有vault，注入锁定Electron实际异步safeStorage与FileCiphertextStore；无新Renderer管理面，缺加密服务时不提供凭据服务或返回not-ready。退出时立即撤销权限/凭据并在已有外部截止时间内收尾，不冒称强制撤回已开始I/O。

验收必须包含独立SDK契约、真实RemoteRuntimeDriver插件、实际加密密文、通用控制不含公开合成凭据、跨namespace/未声明拒绝、每次审批、撤销/晚到、回调直接返回凭据被拒、媒体旁路被拒及进程退出。仅合成值，无用户Key/付费接口/真实云。

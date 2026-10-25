# M1 生命周期与路由实现接口 v1

范围：M1-02/03 内核及运行区适配。宿主主进程不得直接加载普通插件代码；CordisRuntimeDriver供插件运行区使用。本轮先以真实Cordis和注入加载器验证，跨进程启动/转发由M1-04接线。

## 运行区接口

PluginModule.activate(context)可同步/异步返回void或Disposer；Disposer为()=>void|Promise<void>。PluginRuntimeContext只含owner、signal、provide(providerId,methods)、contribute(id)、effect(create)。effect接收资源创建函数，返回同步/异步清理函数；通过Cordis登记，不把Context对象给插件。

CapabilityMethod=(context:CapabilityCallContext,input:JsonValue)=>Promise<JsonValue>；CapabilityCallContext含taskId、signal、可选本时钟域deadline。方法表为LocalId到函数的只读记录；不在通用JSON消息中序列化函数。

RuntimeActivation={owner,manifest,entryPath,config,signal}；ActivationRegistrar提供provide/contribute。RuntimeDriver.start(activation,registrar)同步返回RuntimeSession={ready:Promise<void>,stop():Promise<void>}；start若抛出必须没有遗留资源。stop幂等，不能保证收尾时宿主按时限标pending_restart；无偷偷终止共享运行区的单插件kill。

## 宿主管理

每实例身份为pluginId+instanceId，安装记录先占一个世代，实际每次启用再递增；卸载重装同身份在本宿主会话内也不复用世代。保护信息只由发行配置加可信内置目录匹配产生，不能来自manifest或插件请求。陌生插件启用需宿主信任确认钩子；默认拒绝。

安装/发现不执行入口。启用先核对兼容、配置/权限/资源与必需依赖，再暂存能力和贡献；全部成功后才发布。失败逆序收尾、隐藏注册；不完整收尾进入pending_restart。停用/卸载先拒新任务、撤销世代访问、隐藏贡献，再等待清理；超时或失败不得删除安装记录或伪报disabled。

未就绪/失败状态的管理修复入口来自宿主清单快照，不复用已失效运行时句柄。依赖失效后消费方转unready，已绑定任务不能换实现；修复后可重新协调已启用意图，但不能恢复旧任务或旧临时授权。

## 路由

多个提供方并存，选择由宿主显式设置，按消费者实例与能力键保存，不采用加载顺序或唯一候选自动选择。选择指向稳定提供方身份及providerId，任务绑定时捕获真实generation。已有绑定不随设置变化迁移；提供方停用/换世代后旧绑定失效。

特性要求：对象递归子集匹配；原始值和数组严格比较，不把未知能力假定支持。公开列表只给元数据副本，不泄露实现函数；方法解析为宿主内部接口，SDK以后只拿异步代理。

## 测试夹具接口（M1-08首批）

packages/contract-tests可依赖@pet/host-kernel的纯类型创建PluginModule夹具：makeRecordingPlugin、makeFailingPlugin、makeSlowPlugin、makeStuckCleanupPlugin、makeProviderPlugin。夹具不得真实杀进程、泄漏OS定时器、调用网络或持久化。卡住清理用永不settle的Promise模拟；真实进程崩溃验证留给M1-04。

makeRecordingPlugin()返回{module,events:string[]}，激活effect启动/停止写入events；makeFailingPlugin()返回{module,events}，登记effect后抛出固定测试异常；makeSlowPlugin()返回{module,events,release():void}；makeStuckCleanupPlugin()返回{module,events,release():void}（清理在release前不settle）；makeProviderPlugin(providerId,methods)返回{module,events}。M1-08本轮只做夹具及自身测试，不虚报整个契约测试套件完成。

## 实现复核补充

- 最小运行时上下文含只读config快照；command贡献通过contribute(id, handler)登记函数，其余贡献不接受handler。所有声明的提供方/贡献在激活成功前须已登记。
- Cordis原生多effect的异步清理不是严格逐项等待，且dispose可能吸收清理异常。项目采用单个受托管资源栈逐项await，并独立记录清理失败；失败/超时必须pending_restart。
- 不响应取消的激活仍等待其收尾，不能提前谎报停止。active与世代存活分别判断：依赖不就绪会禁新任务，但不会把仍有有效绑定的在途任务迁移到另一个提供方；失效绑定由M1-04任务层取消/拒收。
- 能力绑定由当前登记表签发，复制/伪造的绑定对象不可解析实现；这些对象是宿主本地凭证，不作为插件可自报的IPC权限。
- 目录发现不执行代码，记录清单与显式入口指纹；加载前复核。同路径已加载内容变化要求新版本目录或运行区重启，避免ESM缓存返回旧模块。这里只校验声明入口，不冒充完整包签名、递归依赖完整性或同用户恶意进程沙箱。
- 文件卸载依赖宿主安装管理器明确回执，当前未提供回执钩子时拒绝成功；数据去留与发行安装流程不由本模块偷偷决定。

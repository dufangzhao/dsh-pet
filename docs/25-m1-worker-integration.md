# M1 正式运行区与只读宿主桥接线

状态：M1-04后半段接口。普通插件仅在独立Electron Node模式运行区内导入；主进程持有状态、代理和监督。共享运行区不被称为恶意代码沙箱。

## 启动与信任

启动配置由宿主构造：version:1、sessionId、运行区principal OwnerRef、最多8个已知DiscoveryRoot。只通过spawn参数/匿名IPC传递，不开放TCP端口；环境只允许必要Windows变量及ELECTRON_RUN_AS_NODE=1，不继承Node注入选项或凭据。worker脚本来自本应用构建产物。

运行区只读发现这些根目录，加载前仍重验声明入口。不接受RPC指定的任意代码或新增目录。runtime.activate携带owner、entryPath、manifestDigest、config；运行区需与自身发现结果匹配，拒绝未知包/摘要不符/重复或旧世代。

## 控制方法

- runtime.info：固定版本/就绪元数据，不返回密钥、配置或任意异常。
- runtime.activate：创建实例世代，返回提供方id及方法名、贡献id及是否有命令处理器。函数留在worker，宿主只创建RPC代理。
- runtime.stop：立即撤销实例信号并等待实际清理；只有确认清理后返回成功。共享区的单个实例超时不得偷偷杀整个运行区。
- runtime.invoke / runtime.command：只调用已登记方法/贡献处理器；target owner必须精确匹配，调用信号由实例和RPC取消域合成。

激活RPC结束不等于实例结束：激活阶段临时监听RPC取消，在成功后移除该监听，保留独立实例lifetime。父通道断开时停止全区并退出；宿主全局关闭有有界等待，超时可终止自己创建的worker，并记录是否确认退出。

## 只读宿主状态桥（本轮新增契约）

packages/contracts/src/host-status.ts导出HOST_IPC={status:'host:v1:status'}、HOST_RUNTIME_STATES=['starting','ready','failed','stopped']及HostRuntimeState、HostStatus、HostStatusBridge。
HostStatus精确字段：version:1、runtime:HostRuntimeState、installedPlugins、activePlugins、unreadyPlugins、pendingRestartPlugins、runningTasks、pendingWork；所有计数为非负安全整数。HOST_STATUS_SCHEMA为无动态代码/无Node依赖的纯JSON Schema数据，拒绝未知字段。
HostStatusBridge={readonly version:1;getStatus():Promise<Result<HostStatus>>}。只读、无参数、无泛用send/invoke、无路径/凭据/配置返回。不改PET_IPC或PetPrototypeBridge。
主进程核对精确webContents、主frame身份与URL，并限制请求速率；不信任renderer自报身份。预加载导出冻结petHost对象。此时没有设置台界面，也不新增前端功能；桥用于后续受控UI接线与验收。

## 保留边界

配置就绪、权限审批与SDK敏感服务仍由后续工作包接入，默认拒绝不能因信任确认而自动放行。M0原型仅模拟交互不变。没有真实用户Key、云接口、录音或Coopanion执行。

## 本轮实测补充

真实Node worker与实际桌宠入口均已验证，见[记录](../qa/M1-04-worker.md)。IPC断开可能先于进程exit，不能在disconnect事件中直接把自然退出记成强制终止。监督器保留短暂有界确认期，并以exit事件作为退出证明。状态桥默认ready/0激活只表示宿主可用，不代表业务插件已上线。

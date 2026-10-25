# M1-08 参考夹具与契约集成

DeepSeek按主会话冻结接口实现记录型、失败激活、慢激活、卡住清理、能力提供方共五类夹具，限制写入contract-tests包；只导入宿主纯类型，不使用真实定时器、网络、进程或文件I/O。自身12项测试通过，随后主会话完成[真实宿主集成](M1-02-03.md)。

主会话独立测试揭示了替身与Cordis在异步清理顺序及异常传播上的差异，未以替身通过假报真实框架行为，适配层修复后通过。

这不是整个M1-08完成：脚本化ASR、任务/取消/媒体背压、权限与SDK契约套件仍需后续接口完成后补充。屏幕/文字输入不属于当前MVP实现，不因参考测试策略提及而提前接入真实系统。

## M1-04基础阶段补充

DeepSeek另交付46项有界媒体契约用例，仅改测试文件；主会话复核其3项实现缺口并新增严格断言。加上7项真实宿主能力调用授权集成，契约测试包现84项通过。仍不等于M1-08完整SDK/配置/权限套件完成，详见[M1-04记录](M1-04-core.md)。

## 总体验收补充

DeepSeek新增fixture-only脚本ASR：23项自身用例、13项真实Cordis/PluginManager/TaskSupervisor集成，合计36项。能力为test.scriptedAsr@1，partial/final文本加可控gate，不碰麦克风、模型、网络或worker。正常模式在步骤边界检查signal，坏模式忽略取消；宿主仍只交付单一终态，workPending保留至实际gate结束。

集成复用原记录/失败/慢/卡清理夹具，确认兄弟实例隔离、激活失败回滚、停用/世代失效、卡清理保留pending_restart且不能谎报卸载。实际进程崩溃与运行区整合由[统一原生报告](M1-native-acceptance-results.json)另行证明，不把这些内存夹具当进程证据。

主会话另补[固定元数据事件契约](../packages/contract-tests/src/task-event-contract.test.ts)4项：冻结/顺序/无业务内容、观察者异常隔离、重入取消、64观察者上限；[公开SDK示例](../packages/plugin-sdk/src/examples/recording-provider.test.ts)2项验证清单/类型/激活/调用/清理。示例工厂供契约调用，不宣称它已是可安装发布包。

### 成员观察与范围核对

成员指出TaskEvent类型保留data/progress，而TaskSupervisor只产started/completed/failed/cancelled。事实成立：[冻结基线](../docs/24-m1-tasks-ipc-v1.md#L9)刻意只提供不含用户内容的任务元数据总线，业务分块走独立流。当前矩阵仅验此限定实现，不把partial/final夹具内存记录标为实时ASR事件穿越IPC；M3流式转录协议/业务progress尚未交付。

成员另观察提供方停用时在途任务为cancelled，而旧绑定再解析为stale-owner；测试按当前明确语义分别检查，两者都不能交付旧结果。没有把这一差异悄悄改成成功或弱化世代检查。

当前包内268项通过（含主会话事件4项），SDK97项；工作区总1054项、QA120通过/1既有权限跳过。整体安全审查与最终矩阵仍需完成。

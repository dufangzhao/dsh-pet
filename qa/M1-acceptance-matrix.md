# M1 总体验收矩阵

状态：[跨进程实际结算失败](M1-task-settlement-failure.json)已修复并[复验通过](M1-task-settlement-results.json)，独立安全审查尚待结论，M1尚未完成；不将成员返回覆盖率、历史通过或探针数量等同质量验收。最终结论需当前全量检查、原生流程与独立审查同时闭合。范围以[原计划M1](../docs/19-implementation-plan.md#L89-L101)为准。

| 工作包 | 原完成定义 | 当前证据 | 最终核对 |
| --- | --- | --- | --- |
| M1-01 | 类型与示例清单 | [契约](M1-01.md)、contracts测试与示例清单 | 当前1054项全量门槛通过 |
| M1-02 | 生命周期/依赖契约 | [管理器记录](M1-02-03.md)、实际Cordis/worker | 待独立整合审查 |
| M1-03 | 路由单测 | 固定任务绑定/显式选择、多实现、依赖降级；[特性子集测试](../packages/host-kernel/src/runtime/identity.test.ts)与ProviderMetadata查询 | 待独立整合审查 |
| M1-04 | 取消与晚到丢弃 | [运行区](M1-04-worker.md)、[SDK流](M1-09.md)、固定任务元数据事件与只读桥；另有可控gate结算复核 | [原失败](M1-task-settlement-failure.json)已转为[当前通过](M1-task-settlement-results.json)；第8条原生专门覆盖 |
| M1-05 | 迁移与回滚 | [配置](M1-05.md)、schema负例与真实提交/激活失败回滚 | [当前8条原生复跑通过](M1-native-acceptance-results.json) |
| M1-06 | 跨插件凭据隔离 | [修复/敏感传输](M1-06-repair-sensitive.md)、[正式SDK](M1-09-credential-sdk.md) | 待独立整合审查 |
| M1-07 | SEC-01/05/09–12 | [后端权限](M1-07.md)、权限/任务/实际加密与逐次审批 | 待逐SEC核对 |
| M1-08 | 检出坏参考插件 | [原夹具](M1-08-fixtures.md)、失败/慢/泄漏/崩溃、[脚本ASR36项](M1-08-fixtures.md)、实际崩溃；[任务事件4项](../packages/contract-tests/src/task-event-contract.test.ts) | 当前全量通过，待整合审查闭合 |
| M1-09 | 类型/示例契约，不给内核对象 | [基础SDK](M1-09.md)、[正式凭据](M1-09-credential-sdk.md)与可选表面/反射/终态/容量 | 待独立整合审查 |

## 原生证据入口

[统一探针入口](probes/m1-native-acceptance.mjs)仅运行自有合成Windows/Electron流程：worker/配置/权限/SDK媒体/敏感通道/正式凭据/只读桥。报告固定元数据和hash，不运行Coopanion，不读Key，不调用付费API。

## 指定SEC后端映射

| 指定项 | 限定验收语义 | 证据 |
| --- | --- | --- |
| SEC-01 | 未授权microphone请求拒绝且有元数据审计，不启动真实录音 | [独立权限契约](../packages/contract-tests/src/permission-contract.test.ts#L250) |
| SEC-05 | 新调用拒绝、在途租约/任务/结果取消 | [撤销契约](../packages/contract-tests/src/permission-contract.test.ts#L1005)、[实际凭据撤权](M1-09-credential-sdk-results.json) |
| SEC-09 | 旧世代临时批准不复活 | [世代测试](../packages/contract-tests/src/permission-contract.test.ts#L1093)、实际worker重启验证 |
| SEC-10 | 无host审批通道默认拒绝 | [预设/通道测试](../packages/contract-tests/src/permission-contract.test.ts#L565)，应用无审批UI保持拒绝 |
| SEC-11 | 等待审批取消，晚到答复丢弃 | [调用者取消](../packages/contract-tests/src/permission-contract.test.ts#L857)、[任务结束](../packages/contract-tests/src/permission-contract.test.ts#L882) |
| SEC-12 | 同一操作两次新批准，除非显式预设允许 | [逐次审批测试](../packages/contract-tests/src/permission-contract.test.ts#L749)、正式原生脚本精确6次 |

原文见[SEC定义](../docs/15-security-and-privacy.md#L100-L115)。这是原计划M1-07的后端定义；真实录音适配器、SEC-06授权UI防伪和网络最终目标控制不外推为本轮已完成。

## 不在本次完成宣称内

- M0快速轻点/拖拽与混合DPI保留项见[M0门槛](M0-final-gate.md)，不修改250ms既定临界判定。
- 授权/设置/插件管理界面属于M2；当前无真实审批UI时维持默认拒绝，不把测试注入审批当用户界面。
- M3/M4真实麦克风、ASR模型/云端、对话、网络/文件业务适配器不因通用SDK/夹具存在而完成。
- 可信本机Node插件不是OS代码沙箱；已知值守卫不是任意编码/拼接的完整DLP。

## 主会话实际结算复核

旧7条流程未覆盖的组合曾被[可控gate探针](probes/task-settlement-smoke.mjs)检出：worker仍holding时主进程settled/workPending已结算。现已按[修复与当前结果](../docs/31-m1-physical-rpc-settlement.md)闭合并加入第8条原生流程；失败记录保留，不能将最初7条通过外推到当时未验预算。

## 独立审查

脚本ASR夹具已交接并经当前全量验收；安全整合只读审查（独立DeepSeek任务82fb7b07-4aa4-4495-b20e-4457cdf7cc31，起始基线fcd102b）尚待实际返回。当前结算修复改变了基线，返回后须与新代码/断言重核。未返回不等于无问题，不提前关闭M1。

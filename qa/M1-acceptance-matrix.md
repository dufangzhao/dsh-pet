# M1 总体验收矩阵

结论：按[原计划M1完成定义](../docs/19-implementation-plan.md#L89-L101)与原目标要求，由主会话完成累计实现审查、当前整合复核和实跑验收。M1-01至M1-09限定后端/SDK验收通过；不是可用语音对话产品验收。证据：[最终门槛](M1-final-gate.json)、[主会话复核](M1-main-review.md)。

## 结论依据与独立审查限制

早期矩阵草案额外列了独立安全整合审查门槛。该任务失败且无结论，未重试/增派，也没有把失败改成通过。原目标要求的是主会话审查，本次由主会话逐项复核并补真实负例，未删减下表任一原始完成定义。独立全安全审查仍未取得，不能把本结论称为独立审计通过；见[覆盖缺口](M1-security-review-gap.md)。

| 工作包 | 原完成定义 | 当前证据 | 结论/边界 |
| --- | --- | --- | --- |
| M1-01 | 类型与示例清单校验通过 | [契约](M1-01.md)，当前contracts293项，公开示例清单与浏览器安全根 | 通过 |
| M1-02 | 生命周期/依赖契约 | [管理器/Cordis](M1-02-03.md)、真实worker世代/崩溃/卡清理，脚本坏夹具集成 | 通过；卡清理保持pending_restart |
| M1-03 | 路由单测 | 显式选择、任务开始时固定绑定、多实现/降级；[特性子集](../packages/host-kernel/src/runtime/identity.test.ts)及ProviderMetadata查询 | 通过，不自动换提供方 |
| M1-04 | 取消与晚到丢弃 | [SDK流](M1-09.md)、[元数据事件4项](../packages/contract-tests/src/task-event-contract.test.ts)、[实际结算修复](../docs/31-m1-physical-rpc-settlement.md)、第8条原生gate/退出证明 | 通过；数据/progress业务事件非当前元数据总线交付 |
| M1-05 | 迁移与回滚 | [配置](M1-05.md)、Schema负例与真实原子提交/激活失败回滚 | 通过；设置表单/业务热应用属后续 |
| M1-06 | 插件不能经接口读取其他插件凭据 | [正式SDK/DPAPI](M1-09-credential-sdk.md)、[重加密](M1-06-repair-sensitive.md)、[主会话7项边界](../packages/contract-tests/src/runtime-credential-boundary.test.ts)及4阶段实际容量 | 通过；非恶意Node代码OS隔离 |
| M1-07 | SEC-01/05/09–12 | 独立权限60项、宿主/任务/凭据联动、原生逐次审批与撤权 | 通过限定后端；真实授权UI属于M2 |
| M1-08 | 检出参考坏插件 | [脚本ASR36项与旧夹具](M1-08-fixtures.md)、记录/失败/慢/卡清理、实际进程崩溃与晚到值 | 通过；不冻结M3生产ASR协议 |
| M1-09 | 类型/示例契约，不给插件内核对象 | SDK97项、[公开SDK示例](../packages/plugin-sdk/src/examples/recording-provider.test.ts)、真实媒体/可选凭据上下文 | 通过；无任意管理、网络/文件系统API |

## 指定SEC后端映射

| 项 | 证据 | 不外推 |
| --- | --- | --- |
| SEC-01 | [未经授权请求拒绝且审计](../packages/contract-tests/src/permission-contract.test.ts#L250) | 不启动真实麦克风 |
| SEC-05 | [撤权](../packages/contract-tests/src/permission-contract.test.ts#L1005)、实际凭据撤权 | 不能撤回已发生I/O |
| SEC-09 | [旧世代不复活](../packages/contract-tests/src/permission-contract.test.ts#L1093)、真实worker重启 | 不把预设允许当旧临时票据复活 |
| SEC-10 | [缺审批通道拒绝](../packages/contract-tests/src/permission-contract.test.ts#L565)、应用就绪不等授权6项 | 测试审批不是宿主对话框 |
| SEC-11 | [调用者取消](../packages/contract-tests/src/permission-contract.test.ts#L857)、[任务结束](../packages/contract-tests/src/permission-contract.test.ts#L882) | 晚到答复不执行操作 |
| SEC-12 | [两次新审批](../packages/contract-tests/src/permission-contract.test.ts#L749)、原生脚本精确6次 | 仅显式预设允许自动放行 |

原文：[SEC定义](../docs/15-security-and-privacy.md#L100-L115)。SEC-06真实授权UI防伪与实际网络最终目标控制不在M1限定通过结论。

## 可重复门槛

- 工作区1071项通过：contracts293、SDK97、host-kernel191、desktop215、contract-tests275。
- QA120通过、1项既有Windows链接权限跳过，不改报通过；类型/lint/格式/构建通过。
- 严格探针类型通过；[统一入口](probes/m1-native-acceptance.mjs)及pnpm test:m1:native先构建再顺序复验8条自有流程。
- [当前8条原生报告](M1-native-acceptance-results.json)检查退出码、报告新鲜度与hash；自有坏worker强制回收为预期场景，不写成自然退出。

## 发现过的缺口与保留边界

[原生实际结算失败](M1-task-settlement-failure.json)已按[修复](../docs/31-m1-physical-rpc-settlement.md)转为[当前通过](M1-task-settlement-results.json)，旧失败保留。主会话本轮另修复凭据取消后实际预算绕过和应用旧就绪占位，见[复核记录](M1-main-review.md)。

M0快速轻点/拖拽与混合DPI及250ms临界风险仍见[M0门槛](M0-final-gate.md)，没有改报通过。M2设置/授权/插件管理界面、M3/M4真实麦克风/模型/云/对话闭环、网络文件等业务适配器仍属后续。可信Node插件非OS沙箱，已知值守卫非任意编码/拼接的完整DLP。无真实用户Key、付费接口、录音/键盘注入、远程仓库或推送。

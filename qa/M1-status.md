# M1 执行记录

结论：M1-01至M1-09按[原计划完成定义](../docs/19-implementation-plan.md#L89-L101)和原目标的主会话审查要求完成限定验收。见[总矩阵](M1-acceptance-matrix.md)、[最终门槛](M1-final-gate.json)与[主会话复核](M1-main-review.md)。独立安全审查失败且无结论，未重试/增派、未计为通过，见[覆盖缺口](M1-security-review-gap.md)。

| 工作包 | 当前结论 | 证据与边界 |
| --- | --- | --- |
| M1-01 | 通过 | [契约记录](M1-01.md)，当前contracts293项，清单/生命周期/错误/IPC与浏览器安全 |
| M1-02/03 | 通过 | [生命周期/路由](M1-02-03.md)、[正式worker](M1-04-worker.md)，事务/世代/显式固定绑定/特性子集 |
| M1-04 | 通过限定任务与流/事件基线 | [基础](M1-04-core.md)、[SDK流](M1-09.md)、[实际结算修复](../docs/31-m1-physical-rpc-settlement.md)；业务data/progress与生产ASR协议属后续 |
| M1-05 | 通过 | [配置/迁移](M1-05.md)，校验/原子提交/失败回滚/生效标注/私有目录；设置表单属M2 |
| M1-06 | 通过 | [基础凭据](M1-06.md)、[修复/敏感通道](M1-06-repair-sensitive.md)、[正式SDK](M1-09-credential-sdk.md)、[主会话任务与实际容量复核](M1-main-review.md) |
| M1-07 | 通过指定SEC后端 | [权限记录](M1-07.md)，SEC-01/05/09–12，真实审批UI属M2，无通道仍默认拒绝 |
| M1-08 | 通过 | [参考夹具与集成](M1-08-fixtures.md)，脚本ASR/记录/失败/慢/卡清理/实际崩溃，能检测晚到和原生实际结算问题 |
| M1-09 | 通过 | [基础SDK](M1-09.md)、[可选凭据](M1-09-credential-sdk.md)、公开SDK静态示例；无任意宿主管理对象或网络/文件系统接口 |

当前1071项工作区测试通过：contracts293、SDK97、host-kernel191、desktop215、contract-tests275。QA120通过、1项既有Windows链接权限跳过；类型/lint/格式/构建与严格探针通过，8条当前原生流程通过。

曾发现跨进程worker仍执行时主进程过早settled，[失败](M1-task-settlement-failure.json)与[修复后结果](M1-task-settlement-results.json)均保留。主会话又补实际凭据工作32槽与应用有限后端就绪策略，取消不释放仍执行的原生工作预算，就绪不授予权限。

M0原生快速交互、多屏与250ms临界风险仍见[M0门槛](M0-final-gate.md)，没有改报通过。M2设置/授权/插件管理界面和M3/M4真实语音/云/对话闭环未完成，当前不是可用语音产品。可信Node插件非OS沙箱、已知值守卫非完整DLP；无真实用户Key/付费接口、录音/键盘注入、远程仓库或推送。

# M1 主会话整合复核

结论：按原计划完成定义，M1宿主内核与SDK通过主会话验收。依据是累计代码审查、下列新增回归及[最终门槛](M1-final-gate.json)，不是独立安全审计。独立任务失败未计为通过，记录见[审查缺口](M1-security-review-gap.md)。

## 本轮复核

| 重点 | 结果与证据 |
| --- | --- |
| 真实任务与世代 | [7项集成](../packages/contract-tests/src/runtime-credential-boundary.test.ts)：虚构任务、无关owner、旧世代、结束任务均在解密前拒绝；停用期间不交付，新世代可重新发放client |
| 凭据实际容量 | [解密回归](../packages/host-kernel/src/credentials/credential-work-capacity.test.ts)先失败后修复；[另外3阶段](../packages/host-kernel/src/credentials/credential-work-stages.test.ts)验证审批、读取、回调，实际工作结束后恢复容量 |
| 应用就绪 | [6项测试](../apps/desktop/src/main/host-readiness.test.ts)：已实现后端可就绪，缺后端/配置/资源继续未就绪；已信任但无审批通道仍拒绝敏感操作 |
| 跨进程结算 | [原生gate与退出证明](M1-task-settlement-results.json)：逻辑取消立即生效，实际预算等待handler结束或确认worker退出 |
| 凭据与IPC | 复核SDK绑定owner、实际任务成员、一次引用/空ACK、取消/晚到，以及JSON/媒体已知值扫描和固定错误；由现有契约与8条原生流程共同验证 |

## 修复

1. 反复取消可留下32个未结束的解密并继续启动第33个。CredentialBroker现保留32个实际use槽，跟踪审批、读取、解密和回调，直到真正settle才释放；超量返回quota-exceeded。诊断与等待接口只留宿主。
2. DesktopHost仍以“任意权限声明即未就绪”挡住已实现服务。现在仅允许capability-use及有加密后端的credentials通过服务就绪检查，逐操作授权不变。

1071项工作区测试、QA120通过/1既有权限跳过、类型/lint/格式/构建、严格探针与8条原生流程全部通过。工作包映射与交付范围集中见[验收矩阵](M1-acceptance-matrix.md)。

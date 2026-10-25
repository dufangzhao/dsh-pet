# M1-04 跨进程实际工作结算修复边界

状态：原失败已按本页边界修复，[当前原生结果](../qa/M1-task-settlement-results.json)通过；保留失败记录，整体仍待独立审查。

## 已证事实

[失败记录](../qa/M1-task-settlement-failure.json)由可控worker gate与一次state RPC屏障得到：取消后workerStillHolding=true，但mainSettled=true、mainWorkPending=false。旧7条原生流程未覆盖此组合；不能据其通过推断实际工作已结束。入口：[探针](../qa/probes/task-settlement-smoke.mjs)。

问题发生在RemoteRuntimeDriver代理调用等待ControlEndpoint的逻辑取消结果，底层work Promise随之结束；TaskSupervisor只能看到该Promise，而不知道worker handler仍未settle。Worker端已有有界inbound槽，不能据此声称无限物理执行，但主进程全局实际work预算与settled语义不完整（当前TaskSupervisor没有每owner独立上限，不虚构该能力）。

## 拟定修复

- 逻辑任务取消/超时仍立即terminal，结果不晚到。实际invoke RPC增加宿主内部waitForWork模式，取消只发送撤销并保留本次等待/容量，直到对端handler物理settle或运行区确认退出。
- Worker ControlEndpoint对runtime.invoke/runtime.command配置延迟终态响应：立即abort handler signal，但不在底层handler结束前发送代表结束的响应；正常其它RPC仍保留既有快速逻辑取消。请求/回复仍是契约v1，不把用户payload当控制标志。
- endpoint双方配对行为须通过runtime.info固定能力标记确认，旧worker不能被误认为支持实际结算。
- 对端断链不等于进程退出：代理调用在失联后等待监督器确认exit，不能仅凭断连释放实际work预算；已有外部截止时间/kill监督不失效。
- 活跃/取消后未合作的RPC继续计入通道与TaskSupervisor容量；停用/退出时仍按pending_restart/exitConfirmed事实报告。

## 验收

必须补延迟取消/时限/晚到值/断链与实际退出的控制端点测试、原生gate释放前预算保留与释放后settle，复跑现有任务/SDK/凭据/运行区探针。M0保留项、M2审批UI和M3ASR业务范围不变。

## 当前实现与验收结果

ControlEndpoint新增本地waitForWork请求选项和宿主workCompletionMethods列表，仅正式runtime.invoke/runtime.command配对启用；取消/时限立即abort并保留在途槽，响应以最先取消原因固定失败，直到handler实际结束。其它RPC保持快速逻辑取消，原有11项控制端点测试不变。

Worker runtime.info声明completion=work-v1，驱动拒绝不匹配版本。代理连接关闭后等待真实exit；在gate未放行时pendingWork保持true，在失联仍存活的自有坏worker用例中，监督器强制回收并确认exit后才settled。强制退出是预期用例，不被标成自然清理。

SensitivePeer额外支持按引用drain，worker凭据端口等待本次实际回调结束，不因其它引用未结束而阻塞；保留全局取消后实际回调容量。

新增6项控制端点结算回归、1项分引用drain回归，加上原生gate/退出证明用例通过。完整工作区1054项通过（contracts293、SDK97、host-kernel187、desktop209、contract-tests268），QA120通过/1既有权限跳过；[统一8条原生报告](../qa/M1-native-acceptance-results.json)均为当前新鲜报告。

这是handler Promise/明确登记callback的实际结算，不承诺追踪任意可信Node插件自行脱离框架创建的后台任务、OS对象或已发生I/O；非OS沙箱边界不变。

# M1-06 重加密与专用敏感传输基础

结论：repairSecret宿主限定修复与SensitivePeer传输基础通过。尚未在正式PluginHostServices开放凭据入口或把通道挂入正式worker，不能将本轮记为SDK敏感服务全部接通。

## 实现

- repairSecret只在宿主CredentialBroker管理面，返回repaired/current，不返回明文。普通withSecret仍拒绝shouldReEncrypt；修复验证namespace/keyId/envelope后调用异步encrypt并写入密文，不静默重置。
- 写队列与每键ticket保证较新的set/delete/repair撤销旧修复，修复期间普通使用未就绪；取消/dispose在异步checkpoint阻止尚未开始的commit。写入fence之后不保证撤回实际效果。
- SensitivePeer使用一次owner世代/task/request引用与独立二进制载荷；仅序号0携带1–16KiB UTF8值，序号1/2/3为空载荷成功ACK/失败ACK/撤销。接收结果只留本端，ACK不含回调对象或异常。
- 最多32逻辑/实际回调槽、独立64发送排队上限；不合作回调取消后仍占容量，直到物理settle。终态窗口有界保留；已知晚到值不执行回调并清零副本，未知引用拒绝。超时最长30秒，写口异常固定化。
- 原生探针用fd6/fd7单向匿名句柄对单独传输，控制IPC只传引用、注册/完成固定状态。通道自身不是权限权威，仍由外部凭据租约与任务参与者控制。

## 验证

| 验证 | 结果 | 范围/限制 |
| --- | --- | --- |
| DeepSeek独立repair契约 | 32通过 | fake legacy/current密文、直接播种、不依赖setSecret的脱敏登记 |
| 敏感协议/复核 | 11通过 | 一次ACK、跨引用拒、晚到清零、32不合作槽、超时、提前ACK、异常写口 |
| 实际DPAPI+独立进程 | 通过 | [结果](M1-06-sensitive-runtime-results.json)：实际重新封装/文件密文、fd6/fd7、撤权与自然退出 |
| 既有SDK运行区 | 通过 | 双向9帧、两端零流、自然退出复验 |

原生入口：[敏感通道烟雾脚本](probes/credential-sensitive-smoke.mjs)；[严格脚本类型检查](probes/tsconfig.security.json)。使用公开合成串，无真实Key/付费云调用/录音。

## 严格解释与保留

原生用例通过wrapper将shouldReEncrypt设true以驱动修复，但解密/重新加密均为锁定Electron45实际异步API。它证明修复机制，不等于已获得真实旧Windows用户密文或验证版本迁移触发条件。current用例验证无额外修复；文件始终是密文，测试记录已删。

撤权用例先让已批准接收回调进入等待，再撤销并验证本次结果取消、实际回调释放容量；不声称能抹除已经授权交给回调的字符串。晚到未授权执行则由协议用例另行验证。JS字符串/插件自留副本无法承诺物理清除，可信代码仍可能绕过SDK，不作OS沙箱或完整DLP承诺。

错误码沿用原代理：缺失not-ready；坏JSON/版本/缺owner/跨Key ID为unavailable；缺/非法secret或跨namespace为permission-denied；取消/较新写意图cancelled；dispose为unavailable或更早已生效的cancelled。原生I/O错误不能一概说旧文件未变，须读回确认。

后续正式SDK接线还须将原始值隔离于通用JSON/事件/日志，绑定真实运行区owner/任务和权限租约；本轮observe只提供登记钩子，不把测试控制消息检查当完整旁路防护完成。

完整门槛953项工作区测试通过（contracts293、SDK51、host-kernel172、desktop209、contract-tests228），QA120通过/1既有权限跳过；类型、lint、格式、构建通过。

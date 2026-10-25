# M1-06 凭据修复与专用敏感传输

## 重加密修复

CredentialBroker增加宿主控制面方法repairSecret(namespace,keyId,signal?):Promise<'repaired'|'current'>。该方法不出现在插件CredentialClient或SDK管理面。普通withSecret遇shouldReEncrypt仍为not-ready，不自动把需修复明文交付给插件。

repairSecret按现有全局写队列/键世代执行：读取旧密文、异步解密、验证原envelope的namespace/keyId与secret形状、添加宿主脱敏表；若current则不写，若shouldReEncrypt则经异步cipher.encrypt得到新密文并原子替换。读/解密/校验/重新加密失败不写入；缺失not-ready、坏envelope或namespace固定错误，不清空或静默重置。

修复调用占用键变更槽并撤销该键在途使用；signal取消、dispose或后续set/delete/repair意图令本次ticket失效，写入前复核。原子写commit fence开始后不能承诺取消撤回实际效果；I/O错误须读回确认，不宣称所有失败均未落盘。只管理宿主唯一写入者，不抵御恶意同用户文件系统竞争。

固定错误码：缺失not-ready；坏JSON/版本/缺owner/跨Key ID为unavailable；缺/非法secret与跨namespace为permission-denied；预取消/较新变更cancelled；dispose为unavailable或此前已生效cancelled。

## 专用敏感通道（传输基础）

控制IPC仅传owner/taskId/Key ID/随机requestId等元数据，原始凭据不进入通用request/result/event。媒体不复用为凭据旁路。原始凭据仅走另一个逻辑敏感通道的单向匿名管道对；沿用已实测可异步写的分离句柄方式，不开放TCP。

SensitiveReference={streamId,taskId,owner}，streamId是一次性随机请求标识；发送端/接收端均须先登记同一引用，调用者由宿主验证真实任务参与者与credentials租约。传输对象SensitivePeer不做权限决定，仅执行引用、预算与生存期校验。

SensitivePeer(options:{write(frame):Promise<Result<null>>,observe?(secret):boolean,timeoutMs?})。send(reference,secret,signal):Promise<Result<null>>；accept<T>(reference,signal,operation:(secret,signal)=>Promise<T>):Promise<Result<T>>；receive(frame):Result<null>；close():void；diagnostics仅有pending/running/closed计数；drain可由宿主在外部截止时间内等待当前实际工作/发送队列settle，不谎称可强制结束原生I/O。

帧仍使用严格头与二进制载荷，但该端口只收SensitivePeer：sequence0为单次UTF-8凭据（1–16KiB，fatal UTF-8，无控制字符）；sequence1是成功ACK、2是失败ACK、3是撤销，后3种载荷必须为空。引用owner世代/taskId/requestId逐项匹配；ACK不带插件结果或异常文本。发送端直到ACK才完成以保持授权租约；接收端回调结果只留在接收端，不能通过ACK回传原始对象。

每peer最多32等待/在途，超时最多30秒，关闭/任务取消立即使本次结果失效并发送撤销；不合作回调仍保留running预算至实际settle。终态引用有界保留以拒绝复用/晚到交付，未知引用和畸形帧失败关闭。缓冲副本尽可能清零，但JS字符串和插件自行保留的副本不能保证物理清除。

observe用于接收侧登记已知敏感值的通用JSON旁路防护；拒绝观察则不执行回调。SDK withSecret与运行区四根单向管道接线在后续步骤完成，本轮基础通过不等于已向插件开放明文读取。可信插件仍可能绕过SDK使用OS，非代码沙箱/完整DLP承诺。

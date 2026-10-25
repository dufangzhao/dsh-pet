# M1-09 正式凭据SDK、vault与已知值边界

结论：可选credentials.withSecret、正式运行区敏感句柄、宿主vault及有限已知值旁路防护通过。M1总体验收矩阵/独立整合审查仍未完成；真实Key设置页面/网络文件等业务适配器按各自里程碑交付，不声称恶意Node代码被OS沙箱隔离。

## 已实现

- SDK根类型增加可选credentials，只有withSecret，无管理/namespace/授权方法；旧port无此函数仍精确保持旧四字段。工厂拒绝非法端口、Proxy/访问器，owner从工厂绑定，任务与Key ID严格校验。
- 包装回调一次执行，文本预算/原生signal校验，回调结果先预检复制冻结，拒当前值及URL编码/Base64形式出现在实际字符串或键名；原异常固定化。端口结束后封印回调，拒绝晚到重入/结果。
- 正式RemoteRuntimeDriver增加fd6（宿主→worker）与fd7（worker→宿主）专用敏感管道。普通host.api仅传Key ID和一次引用；凭据结果只留worker，普通响应为Result<null>。
- 凭据RPC用独立request取消票据（引用streamId），真实业务任务在reference.taskId由宿主复核，避免本次失败影响同任务其它RPC。宿主按当前世代/manifest key列表缓存只读client，经真实任务与credentials租约才送明文，租约直到ACK。
- 本地接收槽预留确认失败则不发宿主请求/审批；对端尚未登记时先到的空撤销不授予任何交付权限，也不破坏其它会话。拒绝注册可本地discard，晚到值清零不调用。
- 主/worker边界扫描JSON实际字符串及键名；普通媒体扫描已知原始值/URL/Base64字节并保留相邻帧尾部，完成后清尾。登记与尾部有界，容量耗尽拒绝新交付，不静默忘旧值。
- DesktopHost注入锁定Electron异步safeStorage与私有vault密文存储，缺加密库则未就绪，不用明文fallback；页面仍只有原只读状态桥。退出立即撤销凭据，worker确认退出后清宿主外置脱敏表。

## 验证

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| DeepSeek SDK凭据契约 | 42通过 | 可选表面、固定失败、命名空间绑定、一次回调、无Getter/Proxy执行、结果已知值拒绝 |
| 主会话生命周期复核 | 2通过 | 端口结束后不可复用与晚到结果不发布 |
| 已知值边界 | 5通过 | JSON键/值、编码形式、跨媒体帧、容量、控制传输前拒绝 |
| 取消/容量复核 | 3通过 | 先到空撤销、拒绝注册不通知未配对引用、本地满槽不请求宿主 |
| 正式worker+实际DPAPI | 通过 | [结果](M1-09-credential-sdk-results.json)，同Key ID不同namespace、未声明拒绝、每次审批、旁路与撤权 |

原生入口：[凭据SDK烟雾脚本](probes/credential-sdk-smoke.mjs)，[严格类型检查](probes/tsconfig.security.json)。共6次宿主测试审批，明确断言连续两次正常调用产生两次新审批。审批来自注入测试通道，不是已完成的设置台对话框。

旁路用例分别尝试回调直接返回值、缓存后作为能力结果返回、发往另一个能力请求、写普通媒体字节，全部拒绝且未记录原始值。之后正常withSecret仍成功，撤权时结果不晚到；worker自然退出，测试密文记录删除。所有值是公开合成串，无用户Key/付费服务/录音。

## 发现与修复

初次原生装置使用带连字符的能力名，被冻结清单契约拒绝，见[初始失败](M1-09-credential-sdk-initial-failure.json)；修装置而非放宽能力正则，并加入明确发现数量检查。

SDK原有42项通过后，主会话两项终态复核先失败，补trace终态封印后通过；另一个本地满槽用例先失败，修为预留确认后才请求，避免无必要审批。所有失败断言保留。

## 保留边界

KnownSecretBoundary是已知值与常用编码的有限防护，不承诺重建任意拼接/编码或跨不同业务流的蓄意泄漏；可信Node插件仍可绕过SDK直接访问OS。明文已交给获批回调后，JS字符串/自留副本不能保证物理擦除；授权撤销不会撤回已发生I/O。

本轮没有新增原始日志通道，stdout/stderr不收集，通用IPC固定错误；这不等于覆盖任意第三方自行写文件或联网。没有提供页面set/delete/repair入口，M2须由受控宿主窗口复核来源。正式网络/文件/录音适配器仍需按业务阶段复核最终目标，当前SDK没有那些系统API。

完整门槛1005项工作区测试通过（contracts293、SDK95、host-kernel180、desktop209、contract-tests228），QA120通过/1既有权限跳过；类型、lint、格式、构建通过。

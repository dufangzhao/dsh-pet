# M1-07 权限、一次性审批与审计基线

沿用ADR-0012：可信本机插件、控制SDK敏感操作，不承诺OS代码沙箱。声明、代码信任、配置与操作授权互不替代。

## API与权威

createPermissionKernel(options)返回{service,control}；service为操作面，control仅留在宿主，不能经插件RPC或普通renderer暴露。options.host提供describe(owner)={manifest,digest}、isLive(owner)、ownerSignal(owner)、taskSignal(taskId,requester)。taskSignal只对真实任务参与者返回宿主真实信号，不接受载荷提供的signal作身份。

control.confirmTrust(identity,digest,boolean)、setPreset(identity,ask|deny|local)、revoke(identity)、resume(identity)、snapshotAudit()；digest是宿主记录的包指纹（清单及声明入口），变更后旧信任失效。service.isTrusted(identity,digest)、authorize(owner,taskId,permission,signal?)、run(owner,taskId,permission,operation,signal?)、issueClient(owner)、close()。客户端只有绑定owner的run，不接受调用者换namespace。

authorize返回宿主内部PermissionLease={signal,isValid,close}，SDK不把租约交给插件；run每次新建请求，回调前后复核，结束即关闭。默认无owner/任务/信任/权限声明或审批通道则拒绝。审批只对本次请求有效，不升级成preset或下次许可。

## 预设（首个保守实现）

- ask：默认。声明内的请求仍须本次宿主审批；无通道拒绝。
- deny：所有操作拒绝。
- local：由宿主控制面明确选择后，可自动执行声明内的capability-use、microphone、plugin-data文件及声明worker；网络拒绝，其余请求仍审批。不是默认或自动推荐授权。

请求permission使用契约声明的同一结构，但必须是声明范围子集；origin、Key ID、worker ID、文件scope/access均精确匹配，不自动放宽目的地。网络只接受规范HTTPS origin，实际资源适配器还须复核请求的最终URL与重定向。

## 审批与撤销

审批通道只能由宿主注入。ApprovalPrompt={requestId,owner,taskId,permission,permissionDigest,policyEpoch}；ApprovalDecision={requestId,owner,taskId,permissionDigest,approved}。随机requestId、owner世代、任务、目标摘要逐项匹配，不接受晚到、错目标或重放答复。等待时任务取消/owner失效/preset切换/撤销会撤回signal并立即拒绝；不等未知通道自行返回。

revoke(identity)阻止该实例新请求，并撤销等待/有效租约；resume或明确setPreset才解除阻止。owner停用/任务结束的信号使旧租约失效，重连/重新启用不恢复一次性许可。服务重建不恢复临时状态。

## 审计

有界内存环（默认1024条）记录请求与决定、操作开始/结果/关闭/撤销。字段只有id、at、owner、taskId、kind、targetHash、event、source、固定errorCode；不存payload、结果、Key、录音、转录、URL路径或原始异常，默认不落盘。目标用摘要关联；审批界面显示必要permission元数据且按纯文本处理。记录总数与丢弃数可见；不是无限留存承诺。审计入口失败时不开始操作。

## 验收与限制

覆盖SEC-01、05、09–12及控制面不可伪造、错误声明/跨目标答复、预算与取消；注入测试审批通道不代表真实设置台对话框已完成。M2由DeepSeek实现UI，宿主继续核对真实frame来源。授权不能撤回已经发生的系统/网络效果，取消只阻止继续授权与业务结果交付；资源适配器负责在signal上收尾。

## 指纹与实际任务补充

host另须提供fingerprint(identity)，用于稳定实例的当前包指纹查询；describe(owner)仍按精确世代查询。isTrusted与confirmTrust都核对当前指纹。声明经规范化后再匹配，异常/畸形声明失败关闭。TaskSupervisor记录所有者及固定提供方参与者，终态/失效后taskSignal不再返回。

审批截止时间同时检查单调时钟，不能仅依赖定时器按时调度。无合作通道与操作在取消后仍占实际工作预算，避免重复取消绕过上限。

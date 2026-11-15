# 文字 Agent 基础服务验收

本记录对应 [PRD A1–A9](../.trellis/tasks/archive/2026-11/11-07-text-agent-foundation/prd.md)。环境为 Linux x64、Node26.13.0、pnpm11.24.0、Docker27.0.3。所有验收使用临时独立数据目录；没有读取旧桌面用户资料、登录真实平台、调用付费模型或购买/部署云资源。

状态：后端集成、异常恢复、真实浏览器22项验收及完整 `pnpm check` 均已通过。最后一次门禁覆盖工作区类型/测试、根级QA、lint、格式、服务与桌面构建，退出码0。启动和部署方法统一见[服务指南](../docs/35-text-agent-foundation.md)。

后续默认 Magpie 连接插件与配置界面的新增验收维护在[模型连接阶段记录](companion-model-acceptance.md)，下文保留本基础阶段证据。

## 已运行证据

| 验收 | 证据 | 已确认行为 |
| --- | --- | --- |
| A1 | [HTTP 服务测试](probes/companion-service.test.mjs) | 无 Electron 启动；未认证401、跨 origin403；真实 Core 文字回复；稳定 Agent身份 |
| A2 | [恢复/调度测试](probes/companion-service-recovery.test.mjs)、[Core gate](probes/companion-cortico-gate.mjs) | HTTP输入B在下一真实 Core 推理步收到处理及启动回执，Docker工作仍在运行，未等待onIdle |
| A3 | 同上、[执行插件测试](../plugins/cloud-exec/tests/docker.test.mjs) | 定向取消、独立任务并行；受理/运行写入竞态；结果/停止竞争；真实settled后记账 |
| A4 | HTTP服务测试及浏览器验收 | 服务端代码真实生成文件；认证下载同一产物；重复命令不重做效果，浏览器已实际核对文件字节 |
| A5 | 恢复/调度测试、[状态测试](../plugins/state-sqlite/src/state.test.ts) | 同目录重启保留身份/偏好；运行或已退出容器经SIGKILL恢复；原task/execution关联、append-once、产物与游标幂等 |
| A6 | HTTP服务测试及恢复/调度测试 | 停用文字入口不丢产品数据；失败控制命令同ID可收敛；拒绝disposer导致pending_restart时不激活替代 |
| A7 | HTTP服务测试、[Harness测试](../plugins/harness-cortico/tests/harness.test.mjs) | 真实Cortico与能力不同的fixture；前台重建保留独立任务/偏好，不重放已受理效果 |
| A8 | [客户端测试](../plugins/text-client/research/verification.md)、[浏览器记录](../.trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/browser-acceptance.md) | 客户端68项检查；真实浏览器22项通过，含键盘、下载、代理黑洞断线、重连、390px窄屏及点击命中 |
| A9 | [模型传输测试](../apps/companion-service/src/model-client.test.ts) | 原生Responses经真实回环HTTP/SSE，错误/部分结果/实际socket取消；来源撤销、生代更换、私有参数与密钥不落盘 |

## 执行命令与结果

- `node qa/probes/companion-cortico-gate.mjs`：真实Cortico0.2.7，4项通过，模型网络调用0。
- `PET_CLOUD_EXEC_IMAGE=1panel/deepseek-harness:0.2.0-rc.2 node --test --test-reporter=spec qa/probes/companion-service*.test.mjs`：**14/14通过、无跳过**。包含真实服务、Docker、定向停止、强杀重启和原生Core排序。
- `PET_CLOUD_EXEC_IMAGE=1panel/deepseek-harness:0.2.0-rc.2 PET_CLOUD_EXEC_DOCKER_TEST=1 node --import ./plugins/cloud-exec/tests/source-loader.mjs --test plugins/cloud-exec/tests/*.test.mjs`：**15/15通过**，包括真实容器运行限制、路径拒绝及多个崩溃窗口。
- 状态提供者：**15项通过**，包括实际跨进程写入锁、事务回滚、unknown同状态证据补全和幂等。
- 来源权限：**10项通过**；模型传输：**9项通过**；Harness：**8项通过**；文字客户端：**68项通过**。
- 全工作区类型检查通过。桌面相关 **847项通过**；宿主内核 **218项通过**；SDK **100项通过**；契约 **315项通过**；跨包契约 **290项通过**。
- 最终 `pnpm check` **完整通过，exit0**。旧测试Windows绝对路径假设仅在夹具层修正，未改变桌面行为或削弱安全断言；桌面内置准入表更新了构建生成的ASR worker摘要（新增公共契约模块产生173字节空初始化器），见[跨平台证据](../.trellis/tasks/archive/2026-11/11-07-text-agent-foundation/research/desktop-portability.md)。
- [生命周期补测](probes/companion-service-lifecycle.test.mjs) **4/4通过**：配置/禁用状态/修订稳定、状态提供者关闭后的受控修复、fixture排空及再次切换。服务类场景合计18项。
- [真实浏览器探针](probes/companion-browser-acceptance.mjs) **22/22通过**。代理黑洞后约45s标记未知，后台继续完成，重连取回终态；390×844下输入可点击，无脚本错误。`setOffline`不会切断已有SSE，未将它当作断网证据。

本轮使用的已存在镜像为 `1panel/deepseek-harness:0.2.0-rc.2`，ID `sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72`；没有自动拉取镜像。它是本机执行验证材料，不是产品默认镜像。各Docker测试在finally核对并清理自己的完整容器ID。

## 关键缺陷与验证结果

- 取消请求可能早于运行句柄登记：现在先保留执行准入记录，停止意图可在SQL提交刚可见时定位；确认未启动的工作不会执行。
- 运行状态保存失败曾留下无人观察的句柄：现在状态写入先于外部执行，每个实际句柄都保留到物理结算。
- 已记录控制回执不等于操作已应用：同ID重试再次收敛实际状态，失效/未知目标不变成假成功。
- Provider未声明methodPermissions会绕过自身deny/revoke：所有相关方法和来源Harness端口现在有实际权限门槛。
- 服务强杀后原进程计时器消失：持久执行记录支持核对原容器并回收；没有重跑命令。缺少终态证据保持unknown。
- unknown→unknown核对曾丢掉已保留文件：状态插件现在允许同状态证据补全，重复核对不增加事件或重复产物。

## 证据范围

真实执行/认证/持久化/生命周期证据来自本机服务进程、SQLite和Docker，不表示已完成公网云部署。模型验证使用真实传输与受控协议服务，不表示任意真实账号或网关已经联通。当前只有一个真实Harness；fixture不算第二个真实框架。Windows原生桌面、语音、全双工及真实QQ/哔哩哔哩仍属于后续范围。

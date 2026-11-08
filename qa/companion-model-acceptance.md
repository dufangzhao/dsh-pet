# Magpie 模型连接阶段验收

对应[阶段PRD](../.trellis/tasks/11-08-companion-model-text-loop/prd.md)。默认内置普通 Magpie 连接插件，可替换为其他连接插件；身份、资料和任务仍归原服务。操作说明统一维护在[服务指南](../docs/35-text-agent-foundation.md)。

状态：工程实现及最终构建的真实API浏览器25项验收完成，10张截图已审阅。真实 Magpie 网关、账号和所选上游模型尚未提供，PRD A2 的真实模型实用任务验收保持待办。下面的回环协议服务不代替该项。

## 已执行的工程验证

| 范围 | 结果与证据 |
| --- | --- |
| Native 连接与来源 | [runtime tests](../packages/companion-runtime/src/model-connections.test.ts)：运行时26项通过，覆盖来源与消费者权限、原生值、实际排空、版本失效、两个并发消费者及单次取消隔离。 |
| HTTP/控制器/传输 | [controller tests](../apps/companion-service/src/model-controller.test.ts)、[transport tests](../apps/companion-service/src/model-client.test.ts)：合计26项通过；实际HTTP/SSE、同ID竞态只发一次请求、Key目标/进程版本、部分失败重试、拒绝请求不污染健康状态、描述白名单与完整快照预算。 |
| 直接持有的传输 | [unbound transport probe](probes/companion-model-transport.test.mjs)：1项通过；未bind的旧transport也在Config保存返回前收到abort，真实Promise仍等待结算。 |
| 默认插件与状态 | [Magpie tests](../plugins/model-connection-magpie/src/index.test.ts)8项；[SQLite tests](../plugins/state-sqlite/src/state.test.ts)16项通过。 |
| CLI 重启 | [main tests](../apps/companion-service/src/main.test.ts)2项通过；已保存model且无env覆盖时日志真实，state禁用仍可管理，无推理，SIGTERM正常退出。 |
| 保留行为 | Cortico8项、真实Core4项、已有镜像的服务/恢复/生命周期18项通过；未拉镜像。 |
| 前端 | 当前155项包内测试和25项夹具DOM检查通过；源码说明与命令在[客户端验证记录](../plugins/text-client/research/verification.md)。 |
| 全工作区 | 最终源码 `pnpm check` 完整exit0（已收集job `bash-9821f701ec754ac8`），覆盖类型、单元、根QA、lint、格式与服务/桌面构建。此后仅清理一条过时注释，重新构建的客户端JS/CSS与浏览器验收产物摘要完全一致。 |

## 浏览器证据

最终真实服务检查由[浏览器探针](probes/companion-model-browser-acceptance.mjs)和[隔离启动器](fixtures/companion-service/model-preview.mjs)复现，详细过程与当前产物路径见[真实API验收](../.trellis/tasks/11-08-companion-model-text-loop/research/real-api-acceptance.md)。

最终构建A–K主探针21项、L切换探针4项全部通过：保存零请求、Key-only、显式SSE检查和去重、错误/15s超时、模拟标签、只读入口403、聊天、原生工具生成真实Docker文件、下载合计25、切换保留身份与任务/产物、关闭弹窗和390px命中/焦点，以及不同revision目标的正确保存与无Key提示。10张最终截图与[主探针JSON报告](screenshots/companion-model/report.json)已保留；L段的详细证据维护在上面的真实API验收记录。截图审阅发现的问题均已修复并在此最终构建重跑。

## 范围与待办

- 使用独立临时资料和合成令牌；原4120试用服务已按用户要求关闭，原资料/令牌保留。
- 回环peer只产生确定性原生协议数据；文件执行、SQLite、HTTP/SSE、浏览器和Docker是真实组件，模型智能及真实供应商连通未由此证明。
- 最后需要操作者指定实际 Magpie API base URL、模型/组标识与独立鉴权，并明确进行真实验收。Key不应放进聊天记录；可通过受控本机入口或宿主注入提供。
- 本轮没有公网部署、真实账号发布、语音或第二个真实Harness实现。后续共享入口/记忆/语音阶段沿既定路线推进。

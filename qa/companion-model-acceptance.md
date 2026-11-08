# Magpie 模型连接阶段验收

对应[阶段PRD](../.trellis/tasks/11-08-companion-model-text-loop/prd.md)。默认内置普通 Magpie 连接插件，可替换为其他连接插件；身份、资料和任务仍归原服务。操作说明统一维护在[服务指南](../docs/35-text-agent-foundation.md)。

状态：阶段验收完成。最终构建的真实API浏览器25项通过，10张截图已审阅；随后使用宿主机实际 Magpie0.1.3225 和 `codex/gpt-6.1-sol` 完成真实偏好、文件任务及运行中交互验收。下文分别记录受控协议与真实模型证据。

## 已执行的工程验证

| 范围 | 结果与证据 |
| --- | --- |
| Native 连接与来源 | [runtime tests](../packages/companion-runtime/src/model-connections.test.ts)：运行时26项通过，覆盖来源与消费者权限、原生值、实际排空、版本失效、两个并发消费者及单次取消隔离。 |
| HTTP/控制器/传输 | [controller tests](../apps/companion-service/src/model-controller.test.ts)、[transport tests](../apps/companion-service/src/model-client.test.ts)：服务模块合计32项通过（控制器19、原生传输11、CLI2）；实际HTTP/SSE、同ID竞态只发一次请求、Key目标/进程版本、部分失败重试、拒绝请求不污染健康状态、描述白名单与完整快照预算。 |
| 直接持有的传输 | [unbound transport probe](probes/companion-model-transport.test.mjs)：1项通过；未bind的旧transport也在Config保存返回前收到abort，真实Promise仍等待结算。 |
| 默认插件与状态 | [Magpie配置](../plugins/model-connection-magpie/src/index.test.ts)与[原生适配](../plugins/model-connection-magpie/src/native-provider.test.mjs)合计24项；[SQLite tests](../plugins/state-sqlite/src/state.test.ts)16项通过。 |
| CLI 重启 | [main tests](../apps/companion-service/src/main.test.ts)2项通过；已保存model且无env覆盖时日志真实，state禁用仍可管理，无推理，SIGTERM正常退出。 |
| 保留行为 | Cortico8项、真实Core4项、已有镜像的服务/恢复/生命周期18项通过；未拉镜像。 |
| 前端 | 当前155项包内测试和25项夹具DOM检查通过；源码说明与命令在[客户端验证记录](../plugins/text-client/research/verification.md)。 |
| 全工作区 | 真实Magpie兼容修复后的 `pnpm check` 完整exit0（已收集job `bash-a75026919f104b32`），覆盖类型、单元、根QA、lint、格式与服务/桌面构建。该修复未改前端，先前过时注释清理后的JS/CSS也已核对与浏览器验收产物完全一致。 |

## 浏览器证据

最终真实服务检查由[浏览器探针](probes/companion-model-browser-acceptance.mjs)和[隔离启动器](fixtures/companion-service/model-preview.mjs)复现，详细过程与当前产物路径见[真实API验收](../.trellis/tasks/11-08-companion-model-text-loop/research/real-api-acceptance.md)。

最终构建A–K主探针21项、L切换探针4项全部通过：保存零请求、Key-only、显式SSE检查和去重、错误/15s超时、模拟标签、只读入口403、聊天、原生工具生成真实Docker文件、下载合计25、切换保留身份与任务/产物、关闭弹窗和390px命中/焦点，以及不同revision目标的正确保存与无Key提示。10张最终截图与[主探针JSON报告](screenshots/companion-model/report.json)已保留；L段的详细证据维护在上面的真实API验收记录。截图审阅发现的问题均已修复并在此最终构建重跑。

## 真实 Magpie 主场景

宿主机 `http://127.0.0.1:3425/v1`、Magpie0.1.3225、`codex/gpt-6.1-sol` 和公开本机客户端标识。实用场景在39.038s内完成：真实 `remember` 保存回答简短偏好；真实 `start_work` 受理并由Docker执行成功；下载52-byte Markdown和34-byte CSV，三项12/8/5总计25。任务仍运行时收到新输入并回复，早于完成约5.5s。

新的A2预算为8次原生生成、180s：7次HTTP200/completed，最后一次自动结果通知轮在正常关闭中aborted/statusnull。第二个实时取消任务因预算不足未运行，定向取消依据已有真实Docker/服务回归，不写成此场景已执行。服务和所属容器均已清理。安全事实、字节与哈希保存在[结构化报告](companion-live-magpie-result.json)，诊断和兼容修复原因见[实际网关记录](../.trellis/tasks/11-08-companion-model-text-loop/research/live-magpie.md)。

[真实验收探针](probes/companion-model-live.mjs)是显式opt-in、非默认测试入口；无 `PET_COMPANION_LIVE_MAGPIE=1` 时不发请求。此前短诊断的2次额外请求另行计数，不与A2预算混用。

## 范围与待办

- 使用独立临时资料和合成令牌；原4120试用服务已按用户要求关闭，原资料/令牌保留。
- 回环peer只产生确定性原生协议数据；文件执行、SQLite、HTTP/SSE、浏览器和Docker是真实组件，模型智能及真实供应商连通未由此证明。
- 真实验收覆盖上述明确网关与模型，不自动代表所有模型/网关版本。Key 的配置与部署要求见服务指南。
- 本轮没有公网部署、真实账号发布、语音或第二个真实Harness实现。后续共享入口/记忆/语音阶段沿既定路线推进。

# AI 桌宠项目（暂定名）

当前阶段：M0 已恢复，前端按用户新决定改交 DeepSeek。M0-01 工程骨架、M0-02 版本/最小运行时、M0-03 Cordis生命周期已通过；其余验证进行中，见[执行计划](docs/19-implementation-plan.md#9-执行记录)、[生命周期证据](qa/V-01.md)与[版本记录](qa/versions.md)。首版闭环为跟桌宠语音对话，当前尚不是可用产品。

目标是实用、可定制、交互顺畅的独立桌面助手：用户可按需组合语音、声音、角色、屏幕理解与电脑操作能力，而非仅有聊天/养成的桌宠。已确定能力 + 受控UI贡献点；DSH为可选集成，不是运行前提。

## 从这里阅读

- [文档导航与开工条件](docs/README.md)
- [首版需求：跟桌宠语音对话](docs/18-voice-chat-mvp-prd.md)
- [实现计划与任务拆解](docs/19-implementation-plan.md)
- [开工提示词](docs/20-implementation-kickoff-prompt.md)
- [产品需求基线 v0.1](docs/00-product-brief.md)
- [逐题选型与决策清单](docs/01-discovery-plan.md)
- [Coopanion 设置与交互专项评审](docs/02-coopanion-ui-review.md)
- [Coopanion 架构与复用核验](docs/04-coopanion-architecture-review.md)
- [扩展产品规格](docs/03-extension-product-spec.md)与[已确认架构决策](docs/adr/0001-controlled-ui-contributions.md)
- [总体架构草案](docs/05-architecture-overview.md)
- [项目术语](CONTEXT.md)
- [第一阶段可视化调研报告](research/report/ai-desktop-pet-research-20261023.html)

## 参考项目边界

Coopanion仅作为交互、设置台与架构参考，本阶段不二开，见[ADR-0006](docs/adr/0006-reference-coopanion-without-fork.md)。这不排斥按许可复用合适的基础框架和引擎。

## 版本管理

本地 Git 主分支为 main；实现阶段按工作包审查、验证并使用约定式提交。
不提交密钥、个人聊天、录音、模型权重、依赖目录与临时截图。当前没有远程仓库，也未执行推送。

## 开发检查

本机已验证 Node 24.18.0 + pnpm 11.24.0。安装依赖时默认不运行第三方构建脚本；后续原生依赖逐项审阅。

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm format:check
```

M0-01 的 Vitest 为零测试空跑；后续工作包必须添加真实用例。当前没有产品启动或打包命令。

## 许可

自有代码与原创文档采用[MIT](LICENSE)。第三方代码、工具资源、模型、声音和角色不自动继承本项目许可，见[第三方材料边界](THIRD_PARTY_NOTICES.md)。

## 资料与决策的区别

调研材料是选型依据，不代表采用其中项目的代码、许可或全部功能。正式开发以用户确认后的文档和决策记录为准。

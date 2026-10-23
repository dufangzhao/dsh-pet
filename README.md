# AI 桌宠项目（暂定名）

当前阶段：需求访谈与架构选型。尚未开始产品代码实现；自有代码已确定采用MIT，技术栈和首版范围仍待选择。

目标是实用、可定制、交互顺畅的独立桌面助手：用户可按需组合语音、声音、角色、屏幕理解与电脑操作能力，而非仅有聊天/养成的桌宠。已确定能力 + 受控UI贡献点；DSH为可选集成，不是运行前提。

## 从这里阅读

- [文档导航与开工条件](docs/README.md)
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

本地 Git 主分支为 main。需求与文档分阶段提交；实现阶段的分支/发布策略仍待确认。
不提交密钥、个人聊天、录音、模型权重、依赖目录与临时截图。当前没有远程仓库，也未执行推送。

## 许可

自有代码与原创文档采用[MIT](LICENSE)。第三方代码、工具资源、模型、声音和角色不自动继承本项目许可，见[第三方材料边界](THIRD_PARTY_NOTICES.md)。

## 资料与决策的区别

调研材料是选型依据，不代表采用其中项目的代码、许可或全部功能。正式开发以用户确认后的文档和决策记录为准。

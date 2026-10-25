# AI 桌宠项目（暂定名）

当前阶段：M2设置台开发中，窗口与只读宿主接口已接通，界面尚待实现。M1宿主内核、插件运行区与SDK已通过限定主会话验收，见[M1矩阵](qa/M1-acceptance-matrix.md)与[执行记录](qa/M1-status.md)。前端/限定实现交由DeepSeek，主会话负责后端、安全、集成与审查。独立安全审查失败未计为通过，额外覆盖限制见[审查记录](qa/M1-security-review-gap.md)。已具备配置、权限、凭据与取消/流的测试基础，首版语音对话闭环仍未完成，当前尚不是可用产品。M0快速交互/多屏保留项仍见[门槛报告](qa/M0-final-gate.md)，不因M1推进改报通过。

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
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm format:check
pnpm test:qa
```

或运行 `pnpm check` 一次完成工作区类型/测试、QA回归、lint、格式与构建；该命令不接管真实鼠标或键盘。

M0-01曾为空跑；当前已有真实工作区测试、下载安全测试与Electron集成探针。

Windows上复跑M1自有原生流程：

```sh
pnpm test:m1:native
```

该命令先构建，再顺序验证worker/迁移/权限/SDK流/敏感管道/凭据/只读桥与实际工作结算。会启动并关闭自有Electron测试进程与桥接窗口，不使用用户Key、不调用真实付费服务、不录音或注入键鼠；输出[机器报告](qa/M1-native-acceptance-results.json)。这不是M2授权界面或真实语音闭环验收。

```sh
pnpm dev
```

该命令构建并打开 **M0模拟桌宠**（不是完整语音对话产品）。退出按钮关闭原型。单独构建用 `pnpm build`；真实窗口自动化验收用 `node qa/probes/desktop-e2e.mjs`。说话键/ASR复现及覆盖边界分别见[按键记录](qa/V-key.md)、[ASR记录](qa/V-03.md)、[窗口记录](qa/V-06.md)。尚无安装包。

## 许可

自有代码与原创文档采用[MIT](LICENSE)。第三方代码、工具资源、模型、声音和角色不自动继承本项目许可，见[第三方材料边界](THIRD_PARTY_NOTICES.md)。

## 资料与决策的区别

调研材料是选型依据，不代表采用其中项目的代码、许可或全部功能。正式开发以用户确认后的文档和决策记录为准。

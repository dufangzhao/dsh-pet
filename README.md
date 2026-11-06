# AI 桌宠项目（暂定名）

当前采用 DSH 式统一插件宿主：Cortico 负责智能体与统一日常记录，五个设置页面、人设、外观和语音能力通过插件组合。桌宠气泡与设置台使用同一份配置与记录；没有 Key 时可体验明确标注的离线脚本。当前使用与扩展说明统一见[插件式桌宠指南](docs/34-plugin-pet-guide.md)，历史 Demo 交付记录保留在[原验证记录](qa/demo-status.md)。前端由 DeepSeek max 实现，主会话负责后端、集成与验收。

目标是实用、可定制、交互顺畅的独立桌面助手：用户可按需组合语音、声音、角色、屏幕理解与电脑操作能力，而非仅有聊天/养成的桌宠。已确定能力 + 受控UI贡献点；DSH为可选集成，不是运行前提。

## 打开当前 Demo

双击项目根目录的[启动桌宠.cmd](启动桌宠.cmd)，桌宠和设置台会按当前已保存的启用选择显示。首次可直接在桌宠气泡完成初始化。重复双击复用同一设置窗口；桌宠面板和托盘都可退出。首次选择模型、确认功能与对话步骤见[当前使用说明](docs/34-plugin-pet-guide.md)。启动器直接打开当前构建，不需要全局安装 Node 或 pnpm。

启动器先按标准模式运行；遇到本机已确认的启动失败（退出码3或STATUS_BREAKPOINT），会自动重试本地兼容预览，仅该次启动关闭 Electron 沙箱，不再等待按键。缺依赖、缺构建或兼容启动仍失败时会保留错误提示。

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
不提交密钥、个人聊天、录音、模型权重、依赖目录与临时截图。公开仓库：[dufangzhao/dsh-pet](https://github.com/dufangzhao/dsh-pet)，主分支为 main。

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

该命令重新构建并运行当前 Demo；通过托盘打开设置台。单独构建用 `pnpm build`；完整 Demo 原生验收用 `node qa/probes/demo-ui-e2e.mjs`，使用已有公开 WAV 假设备并保留真实权限判断，不采集环境音。历史 M0 说话键/ASR/窗口记录分别见[按键记录](qa/V-key.md)、[ASR记录](qa/V-03.md)、[窗口记录](qa/V-06.md)。

## 许可

自有代码与原创文档采用[MIT](LICENSE)。第三方代码、工具资源、模型、声音和角色不自动继承本项目许可，见[第三方材料边界](THIRD_PARTY_NOTICES.md)。

## 资料与决策的区别

调研材料是选型依据，不代表采用其中项目的代码、许可或全部功能。正式开发以用户确认后的文档和决策记录为准。

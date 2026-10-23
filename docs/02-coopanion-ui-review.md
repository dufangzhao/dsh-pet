# Coopanion：设置台、交互与扩展体验专项评审

研究快照：2026-10-24。主仓固定提交为 `3dd0892c2d70a026253ab980af392302b88ff8b1`（v0.2.8）。方法：官方开发文档、README、局部源码与官方截图静态核查；未安装运行，未测帧率、延迟或无障碍完整性。

## 结论

Coopanion值得优先借鉴的是“桌面角色 + 气泡交互 + 完整设置台 + 开发者高级模式”的组合，而不只是美术风格。但其普通界面扩展边界、声音实现和插件信任模型，与本项目需要分别对齐，不能从UI丰富推导为全部需求已满足。

## 为什么它的体验值得参考

| 设计 | 可观察依据 | 对本项目的建议 |
| --- | --- | --- |
| 桌宠是入口，不强开完整窗口 | 官方说明启动只出现角色；输入、任务状态与选项围绕气泡 | 保留轻入口；复杂配置去设置台，而不是塞进气泡 |
| 气泡承担首次引导 | 引导依次配置称呼、人设、走动、模型和语音；允许关闭重跑 | 可中断、可回到设置修复，避免强制长向导 |
| 设置有稳定信息架构 | 左侧导航、活跃项高亮、成组控件与解释文本 | 为高频功能保留固定位置，不随安装插件随机变化 |
| 形象配置可即时预览 | 装扮截图显示预览与形象/颜色/配件并置 | 减少“保存→关闭→看桌宠→再打开”的往返 |
| 操作状态具体 | README描述思考、读、搜、写、电脑操作的活动气泡 | 反馈真实任务阶段，不只转一个无限加载圈 |
| 复杂度分层 | 普通/高级模式、模式持久化 | 普通用户可快速设置；开发者有诊断与扩展入口 |
| 行为与常驻成本可调 | 活跃帧率、静止策略、全屏隐藏、位置、走动、输入泡等选项 | “流畅”和“省资源”应同时有策略，而非总开最高帧率 |
| 变更生效方式可理解 | 人设保存、立即应用、清空会话重开区分；设置失败回滚有说明 | 在每项设置标明立即/重载/重启，不让用户猜 |

这些是体验设计判断，不是实测“丝滑”结论。用户认为其交互合意，是本项目的偏好输入。

## 设置功能地图

以该提交的README和开发文档为主，不把旧截图的菜单位置当成现行代码。

| 区域 | 官方说明包含什么 | 本项目对应待选点 |
| --- | --- | --- |
| 开始 | 模型连接、测试、显示/隐藏、预览、主题、重跑引导与运行状态 | 能否做插件健康/配置缺失的一站式入口 |
| 习惯 | 称呼、行为响应、悬停按钮、气泡、大小、帧率、全屏隐藏、音效、电脑操作、OBS等 | 分组能否避免变成长表；哪些默认值适合实用助手 |
| 装扮 | 形象包导入/替换/卸载、配色、配件、即时预览 | 形象、人设和音色是否可分别组合；资产许可如何呈现 |
| 语音输入 | 开关、识别引擎、模型下载、热键、麦克风、监听模式 | 聊天输入与跨应用听写不能混为一条功能 |
| 系统提示词 | 人设及其他段落、变量预览、保存/回退、立即应用、清空会话 | 普通用户是否需要结构化人设编辑，而非先看整份提示词 |
| 用量与成本 | 日用量与费用 | 记录口径、预算提醒和本地/云成本如何分开 |
| 对话 | 历史、图片、输入、上下文占用和整理提示 | 与角色气泡共享同一会话，避免重复或状态分叉 |
| 高级/扩展 | 模型、扩展、World总览、Core、控制台；按manifest挂World/Persona/Memory页面 | 是否也为普通用户开放受控UI贡献点，而不是仅给开发者看 |

## 最重要的扩展边界

[开发文档](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/docs/DEVELOPMENT.md)明确：

1. Cortico是内核，Coopanion是产品；产品壳与自带World接口归Coopanion，不属于通用Cortico契约。
2. 普通模式、桌宠菜单不接受其他World的按钮/页面/菜单项。
3. 扩展的webUi面板/链接在高级模式中呈现。
4. 扩展要展示内容，可经Bot气泡/对话反馈，或托管自己的独立应用环境。
5. v0.2.2曾加入桌宠菜单“扩展页面”，v0.2.3因越过产品边界撤回。

因此它有开放扩展，但不是任意扩展都能接入普通设置台。本项目Q1已选择能力 + 受控UI贡献点，开放方向比其普通界面更广；这并不决定是否fork。见[ADR-0001](adr/0001-controlled-ui-contributions.md)。

## 声音与角色，不从界面标签推断能力

并行源码核验已发现：语音输出使用预生成音节库、近似音节映射与播放速率调音高；不能直接称为自然整句TTS、音色克隆或训练平台。角色中有自研sprite rig的表现路径；Live2D式效果不自动意味着兼容Cubism模型。现已完成固定提交核验：[speech.js · speech](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/speech.js#L1-L16)、[index.ts · speechtext](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/speech/index.ts#L1-L38)、[figure.js · whalerender](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/whale/figure.js#L1-L15)。完整说明见[架构评审](04-coopanion-architecture-review.md)。

## 不能照搬的地方

- 截图内大控件、单列说明很清楚，但长设置页可能难找；可评估搜索、分组与常用/高级分层，而非直接复制所有项。
- 功能依赖悬停时必须另有键盘、托盘或设置入口；本次未做完整键盘/读屏测试。
- 电脑访问授权周期不能只学控件外观；需分开屏幕读取、输入执行、敏感动作与撤销。
- 遥测要看字段而非只看“匿名”标签。官方[遥测文档](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/docs/TELEMETRY.md)列有安装ID、功能使用、模型用量、扩展与部分配置等，声明不发送对话、截图、Key等；本次未抓包验证。项目自身策略尚未决定。
- 主项目为AGPL-3.0-or-later；fork、派生代码的分发和网络使用义务须按实际场景审查。AGPL不等于禁止商业使用，但也不是宽松闭源许可。角色/声音/依赖仍另审，不是法律意见。

## 截图证据的版本限制

已查看以下官方图片。虽然图片路径取自v0.2.8固定提交，习惯/装扮截图自身显示v0.1.19，属于较早版本画面：用作视觉布局参照，不证明v0.2.8运行界面逐项一致。

- [桌面角色与气泡](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/image/README/pet-desktop-en.png)
- [习惯设置截图（画面版本v0.1.19）](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/image/README/habits-en.png)
- [装扮预览截图（画面版本v0.1.19）](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/image/README/dress-en.png)

## 一手来源

- [项目README](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/README.md)：用户功能、设置页、操作方式与分发说明。
- [开发文档](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/docs/DEVELOPMENT.md)：产品壳/扩展边界、目录与构建职责。
- [普通/高级模式实现](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/console/features/mode.ts)：模式持久化与切换事件；文件顶部概述不能替代完整菜单清单。
- [依赖与脚本清单](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/package.json)：Electron、TS、构建/测试依赖；依赖存在不证明每个页面用该框架。
- [遥测字段](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/docs/TELEMETRY.md)：官方声明的采集与关闭行为。

未找到的猜测路径不作为“功能不存在”的证据。未复制第三方角色/音色到产品，下载的研究截图仅在被Git忽略的本地缓存中。

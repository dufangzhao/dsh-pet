# 技术选型预研：四道“我推荐、你确认”的题 v0.1

状态：预研材料，不是决定。对应[剩余问题](01-discovery-plan.md)中的Q16、Q18、Q19、Q27。每题列出事实依据、候选、我的倾向和成立条件；轮到这些问题时，再逐一请你确认。部分结论依赖尚未回答的问题，已在文中标注。

方括号里的编号是调研文件中的条目编号，便于核对原始来源。

## Q19 插件框架具体选型（依赖Q11）

**事实**

- DSH内置的Cordis：Context是根依赖容器，ctx.plugin()返回Fiber，Service发布具名服务，inject声明依赖，Fiber释放时清理它所拥有的副作用、事件监听和服务。[DSH-01，[平台调研](../research/tech-platform.json)]
- Loader支持从配置文件加载、分组和禁用开关；只改“可热更新”字段时保持运行，其他变化会重新挂载。[DSH-03、DSH-04]
- DSH的宿主侧动态插件在node:vm中运行，文档明确说明这层隔离不是安全边界。[DSH-07]
- @deepseek-ai/cordis 4.0.5已在npm公开发布。它是DSH对上游Cordis的内置维护版本（基线为上游4.0.0-rc.7，另有本地修补），不等于上游的cordis 4.0.5。[PUB-01、PUB-02]
- 上游cordis在npm上的最新版本为4.0.0-rc.12，官方README声明接口不稳定，可能不经通知变化。[PUB-03]
- 两者都是MIT许可。[PUB-04]

**候选**

| 候选 | 优点 | 风险 |
| --- | --- | --- |
| A：DSH维护的@deepseek-ai/cordis，锁定精确版本 | 与DSH同一套心智模型；有实际产品在用；有本地修补和修改日志 | 跟随DSH的发布节奏；发布包的类型声明要在实施时核实（本机安装目录中未读到声明文件）[UNK-01] |
| B：上游cordis，锁定候选版本 | 直接跟随上游 | 官方声明接口不稳定；仍是候选版 |
| C：自研轻量注册表 | 完全可控 | 依赖解析、生命周期清理、重入处理都要自己实现和测试 |

**我的倾向：A，并且插件面对的是项目自己的SDK，不直接接触Cordis的Context。**

1. 统一单层插件模型需要的依赖注入和自动清理，Cordis已经提供，并且与DSH一致。
2. 插件不直接拿宿主内部对象，将来可以替换框架，也可以把插件放进独立进程（独立进程本来就拿不到同一个Context）。这也符合[Electron运行边界](12-electron-runtime-boundaries.md)的原则。
3. 用生命周期回归测试固定行为，升级前先审查变更。

**成立条件**：实施前先用最小原型验证锁定版本的类型声明、启停和清理行为，即[架构验证项V-01](05-architecture-overview.md)。若Q11选B（受限运行环境），框架只在宿主内部使用，受限插件通过消息通道接入，这个倾向不变。

## Q18 Windows原生能力的实现语言（依赖Q12、Q15）

**需要的原生能力**

- 文字输入：SendInput只能向同级或更低权限级别的程序输入；返回值只表示事件已插入输入流，不代表目标应用已收到。[input-01、input-02，[Windows自动化调研](../research/tech-windows-automation.json)]
- 目标识别与复核：通过UI Automation获取焦点元素、判断是否为密码类控件。[lib-dotnet-01、input-08]
- 如果Q12选择“按住说话”，需要能同时收到按下和松开的全局键盘事件。Electron的globalShortcut没有松开回调[ELE-02]；可用Windows低级键盘钩子（[LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)，配合SetWindowsHookEx），或uiohook-napi。

**候选**

| 候选 | 依据 | 优点 | 风险 |
| --- | --- | --- | --- |
| A：C#/.NET辅助进程 | 本机已装.NET 10 SDK；FlaUI（MIT）封装UIA，最新正式发布v5.0.0，主分支已到v6并面向.NET 10；System.Windows.Automation源码为MIT[lib-flaui-01、lib-flaui-02、lib-dotnet-01] | UIA生态最成熟；键盘钩子、文字输入、UIA集中在一个独立进程，与Electron版本解耦 | 多一种语言和运行时；需选择发布方式（自带运行时会增大安装包） |
| B：Rust辅助进程 | uiautomation-rs（Apache-2.0，0.25.1）[lib-rust-01、lib-rust-02] | 单文件、体积小、无托管运行时 | 本机未装Rust；封装成熟度与覆盖范围未验证 |
| C：Node原生扩展（koffi调用Win32、uiohook-napi） | koffi为MIT、Node 16以上、提供Windows x64预编译包[lib-koffi-01]；uiohook-napi提供按下与松开事件[ELE-03] | 不引入新语言 | koffi不提供现成的UIA封装和COM线程处理；uiohook-napi依赖LGPL-3.0或更高版本的libuiohook，需审计分发义务[ELE-04]；原生模块要匹配Electron的ABI |

**我的倾向：A。** UIA在.NET中最成熟；三项原生能力集中在一个可单独测试的辅助进程里，通过统一插件契约接入（作为text.input等能力的提供方）。这样能避开Electron原生模块的ABI问题，也不必审计LGPL依赖的分发义务。

**成立条件**：若Q12只选“按一下开始、再按一下结束”，就不需要松开事件，键盘钩子不再必需；若Q15中的软件主要是网页，还要评估是否需要浏览器侧方案。

## Q16 本地识别引擎与模型（依赖Q14）

**事实**

- sherpa-onnx的官方Node包sherpa-onnx-node支持Windows x64，要求Node 16以上；与具体Electron版本是否兼容，需要验证原生模块ABI。[node-platform、electron-native，[语音调研](../research/tech-voice-character.json)]
- 边说边出字的中英双语流式模型：streaming-paraformer-bilingual-zh-en（不提供时间戳）、streaming-zipformer-bilingual-zh-en（模型分发许可待审）。[streaming-paraformer、streaming-zipformer]
- SenseVoiceSmall支持普通话、粤语、英语、日语、韩语；通过语音活动检测分段识别，属于“伪流式”。权重采用自定义的FunASR模型协议v1.1，官方README链接了商用澄清，发布前须存档并复核。[[组件调研](../research/practical-modules.json)]
- faster-whisper：MIT，基于Python和CTranslate2，支持多语言；它的生成器式输出不等于原生实时协议。[[组件调研](../research/practical-modules.json)]

**候选（取决于Q14）**

| Q14的结果 | 倾向 | 理由 |
| --- | --- | --- |
| 普通话，或普通话加中英混说 | 引擎用sherpa-onnx，模型在SenseVoiceSmall与一个中英流式模型中择一作为默认 | 同一引擎可切换模型；都能用CPU运行，但速度和准确率必须在你的电脑上实测 |
| 更多语言 | 增加faster-whisper（Python工作进程），或选用sherpa-onnx支持的多语言模型 | 语言覆盖更广，但多一种运行环境 |

**运行位置**：sherpa-onnx放在独立工作进程（Node子进程或utilityProcess），不放进Electron主进程或界面进程，与[Electron运行边界](12-electron-runtime-boundaries.md)一致。参考项目cute-fat-fish-pet也是用独立的Node子进程运行sherpa-onnx，见[指定项目调研](../research/requested-repos.json)。

**伪流式还是真流式**：如果是按住说话、松开后直接上屏，说话期间不显示文字，按句分段的伪流式就能满足流程；如果希望说话时就看到文字，则需要真流式模型。最终取决于Q12、Q13的回答和实测效果。两类模型的许可都需要在选定后复核。

## Q27 仓库结构、分支与持续集成

**事实**：本机已装pnpm 11和Node 24；仓库目前只有文档和调研资料；尚未创建远程仓库。

**我的倾向**

pnpm工作区单仓库：

```text
apps/desktop/            Electron主进程、桌宠与设置台界面
packages/host-kernel/    插件管理、能力路由、任务、授权、凭据代理
packages/plugin-sdk/     插件开发者使用的接口与工具
packages/contracts/      能力契约的类型与配置结构
packages/contract-tests/ 契约测试套件与参考插件
plugins/                 官方插件：听写、音频采集、本地ASR、云端ASR、Windows文字输入
native/windows-helper/   C#辅助进程（若Q18选A）
docs/  research/  qa/
```

- **为什么单仓库**：契约、SDK、官方插件和契约测试需要同步演进；改一次契约，就能同时更新插件和测试。官方插件也只使用公开SDK，用来证明第三方能做出同样的扩展。
- **分支**：在main上主干开发，配合短期功能分支；提交信息沿用当前的约定式格式（docs:、feat:、fix:）；发布时打标签。
- **持续集成**：先在本机运行检查脚本（类型检查、单元测试、契约测试）；创建远程仓库后，再接入Windows构建机。是否创建远程仓库、建在哪里，由你决定。

## 需要先回答的前置问题

- Q11：影响Q19中插件的接入方式。
- Q12：决定Q18是否需要键盘钩子。
- Q14：决定Q16的模型范围。
- Q15：影响Q18和兼容矩阵。

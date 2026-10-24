# 实现计划与任务拆解 v1.0

状态：用户于2026-10-24确认开工；M0 已开始，M0-01 已独立验收通过，见[执行记录](#9-执行记录)。原始交接见[开工提示词](20-implementation-kickoff-prompt.md)。首版范围见[语音对话PRD](18-voice-chat-mvp-prd.md)。

## 1. 工作规则

1. 已采纳的决策（ADR-0001至0006、0008至0013）在实现中不得改变；确需改变时先问用户，并用新ADR记录。
2. 标“暂定”的默认值按用户规则“不确定先参考Coopanion”给出，可凭验证证据调整；调整写入本文件或新ADR。
3. Coopanion只作参考：可阅读固定提交的源码理解机制，不得复制其源码、素材、文案和图片（AGPL与素材授权，见[ADR-0006](adr/0006-reference-coopanion-without-fork.md)）。
4. 所有功能以插件实现；官方功能作为内置插件随应用提供，用户可停用或卸载；只有少量基础模块受保护（[ADR-0010](adr/0010-unified-plugin-model.md)）。
5. 不调用真实付费接口，除非用户提供Key并同意；Key只经凭据代理。
6. 模型权重不入库，经下载脚本获取并校验哈希。
7. 每个工作包完成后：类型检查与测试通过、相关文档更新，由主会话审查并提交。

## 2. 暂定默认（未逐题询问，按用户规则确定）

| 事项 | 暂定默认 | 依据 |
| --- | --- | --- |
| Q18 首版原生能力 | 只需说话键状态检测：Node/TS + Koffi调用GetAsyncKeyState轮询，在插件运行区进程中执行；跨应用文字输入随听写插件再定 | 首版不写入其他软件（ADR-0013）；参照Coopanion的轮询做法 |
| Q19 插件框架 | @deepseek-ai/cordis锁定精确版本；插件只面对项目SDK，不直接拿宿主内部对象；由M0-03验证 | 用户要求类似DSH；[技术预研](16-technical-recommendations-prep.md) |
| Q20 界面框架 | React + TypeScript + Tailwind | Coopanion设置台使用React与Tailwind |
| Q21 首版贡献点 | 设置页（Schema表单）、命令、热键请求、角色旁快捷按钮、对话面板 | [扩展规格](03-extension-product-spec.md)；Coopanion的悬停按钮与设置页 |
| 桌宠最小形态 | 原创极简2D角色（SVG）；待机、倾听、思考、回答、出错；气泡；不使用Coopanion任何素材 | Coopanion的Coo为按帧生成的SVG；素材授权边界 |
| 窗口 | 透明无边框置顶、显示时不抢焦点、默认鼠标穿透、开启上下文隔离与沙箱 | Coopanion桌宠窗口的配置思路（独立实现） |
| Q22 数据保存 | 录音不落盘；对话历史本机保存、可清空；日志不含内容 | Coopanion保留对话历史；[安全策略](15-security-and-privacy.md) |
| Q23 匿名统计 | 首版不收集 | 与Coopanion不同：它有自建统计服务器，本项目没有 |
| Q24 安装与更新 | electron-builder打NSIS安装包；首版手动更新；不做代码签名 | Coopanion用electron-builder且Windows版未签名；个人签名资格受限 |
| Q25 性能初始目标 | 动画与拖拽目标60帧/秒，静止时降到30帧/秒；从按下说话键到出现“倾听”反馈，目标100毫秒以内；均为初始目标，M5实测后调整 | Coopanion的帧率策略；0.1秒是常用的“即时反应”经验值 |
| Q26 排期 | 首版 = 桌宠 + 语音输入 + AI对话；其余见第8节 | ADR-0013 |
| Q27 仓库与流程 | pnpm工作区单仓库（第4节）；main主干开发；约定式提交；本机检查，暂无远程与持续集成 | 技术预研；Coopanion也用pnpm工作区 |
| 语音结束后 | 定稿文字自动发给AI；设置中可改为“先放进输入框” | Coopanion识别后直接交给角色 |
| AI模型接入 | 模型服务插件：厂家表 + 协议适配器；先做OpenAI兼容协议；默认DeepSeek；自带Key | Coopanion服务商插件的结构与默认厂家 |
| 回复中再次说话 | 先停止当前回复，再开始新一轮 | 暂定，体验测试后调整 |
| 界面语言 | 首版中文；文案集中管理，便于以后增加语言 | 暂定 |

## 3. 分工与子代理

| 角色 | 负责 | 路由 |
| --- | --- | --- |
| 主会话 | 复杂后端与关键路径：宿主内核、插件运行时、能力路由、任务与取消、进程间通信、权限审批、凭据代理、ASR与AI流式协议、云端适配器、安全相关代码；集成、审查、测试、Git提交 | 新会话本身 |
| DeepSeek | 规格清晰的执行型任务：工程脚手架与配置、按已定接口写类型/Schema/样板代码、单元测试、脚本、参考插件、文档整理 | subagent：provider `workbuddy-subscription`，model `deepseek-v4.1-flash` |
| DeepSeek（前端） | 所有前端任务：桌宠窗口界面与交互、气泡、设置台（React + Tailwind）、插件管理与授权界面、对话面板、原创极简角色、可访问性 | subagent：provider `workbuddy-subscription`，model `deepseek-v4.1-flash`；用户在K3失败后明确要求前端也改用DeepSeek |

规则：

- 开工前用list_subagent_models确认当前指定路由可用；现工程与前端均为workbuddy-subscription/deepseek-v4.1-flash。不可用时告诉用户，不擅自更换模型。
- 同时最多3个子代理；写入范围互不重叠。
- 子代理看不到主会话的上下文，任务说明必须自包含：目标、要读的文档、写入范围、接口约定、完成定义、验证命令、禁止事项。
- 子代理不执行git提交和推送、不安装全局依赖、不修改写入范围外的文件，完成后汇报改动与验证结果。
- 前端用到的预加载桥、IPC消息与事件名，由主会话先在packages/contracts或apps/desktop/src/preload中定义，前端子代理按约定使用，不自行增加系统调用。
- 子代理的结果是材料：主会话审查diff并运行验证，不合格退回修改，通过后由主会话提交。

## 4. 仓库结构（暂定）

```text
apps/desktop/
  src/main/               Electron主进程：窗口、托盘、启动、宿主进程托管（主会话）
  src/main/windows/       桌宠窗口创建与行为（DeepSeek前端，与主会话约定接口）
  src/preload/            预加载与受控桥（主会话定义）
  src/renderer/pet/       桌宠窗口界面（DeepSeek前端）
  src/renderer/console/   设置台界面（DeepSeek前端）
packages/
  contracts/              能力契约类型、清单Schema、错误分类、IPC消息（主会话定规格，DeepSeek实现）
  host-kernel/            插件管理、路由、任务、配置、凭据、权限审批（主会话）
  plugin-sdk/             插件开发接口（主会话定规格，DeepSeek实现）
  contract-tests/         契约测试套件与参考插件（DeepSeek）
  ui-kit/                 设置台与插件界面共用组件、主题令牌（DeepSeek前端）
plugins/
  talk-key/  audio-capture/  asr-local/  asr-cloud/  llm-provider/  chat/  voice-chat/  avatar-default/
scripts/                  模型下载与校验、打包（DeepSeek）
qa/                       验证与验收记录
```

## 5. 里程碑与工作包

### M0 工程骨架与技术验证

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M0-01 | pnpm工作区骨架：根package.json（private、packageManager、engines node>=22）、pnpm-workspace.yaml、tsconfig基础配置、代码检查与格式化、Vitest、各包空壳 | DeepSeek | — | 根配置、各包空壳 | pnpm install成功；pnpm -r typecheck与test空跑通过 |
| M0-02 | 锁定版本：Electron（参考Coopanion的44.4.4，开工时核实当前稳定版）、TypeScript、React、Tailwind、sherpa-onnx-node（参考1.13.8）、Koffi（参考3.3.1）、@deepseek-ai/cordis | 主会话 | M0-01 | 根package.json、qa/versions.md | 版本与理由记录在qa/versions.md |
| M0-03 | 验证V-01：Cordis在插件运行区进程中的启停、依赖注入、dispose清理、激活失败回滚 | 主会话 | M0-02 | qa/V-01.md、packages/host-kernel试验代码 | 结论已记录；不通过则评估替代方案并告知用户 |
| M0-04 | 验证V-03：sherpa-onnx-node在所选进程模型中加载并识别样本（对照Coopanion使用应用运行时的Node模式子进程） | 主会话 | M0-02 | qa/V-03.md | 两个候选模型都能加载并出结果；记录进程方式 |
| M0-05 | 验证说话键：Koffi调用GetAsyncKeyState轮询（参照Coopanion的30毫秒周期），长按与轻点判定、快速轻点漏检、CPU占用 | 主会话 | M0-02 | qa/V-key.md | 阈值初值与实测记录 |
| M0-06 | 桌宠窗口原型：透明无边框置顶、显示不抢焦点、角色区域可点击、空白区域穿透、拖拽、多显示器与缩放 | DeepSeek（前端） | M0-02 | src/main/windows、src/renderer/pet | 截图或录屏证据；问题清单 |

M0验证结论全部记入qa/后，才进入依赖它们的工作包。任一验证不通过：先记录证据，再告诉用户可选方案。

### M1 宿主内核与插件运行时

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M1-01 | 契约包：按[契约草案](13-plugin-contract-draft.md)定义清单Schema、生命周期状态、错误分类、能力名、IPC消息类型；示例清单校验测试 | DeepSeek（主会话先给规格） | M0-01 | packages/contracts | 类型检查与示例清单校验测试通过 |
| M1-02 | 插件管理器：发现内置与用户插件目录、清单校验与兼容检查、启用停用卸载、受保护标记、状态机、事务化激活与回滚、世代号 | 主会话 | M0-03、M1-01 | packages/host-kernel | 契约测试中的生命周期与依赖类通过 |
| M1-03 | 能力注册与路由：多实现并存、显式选择、任务开始时绑定、特性查询 | 主会话 | M1-02 | packages/host-kernel | 路由单元测试通过 |
| M1-04 | 任务、取消与流：任务标识、跨进程转发取消、有序分块、背压、结束；事件总线；插件运行区与主进程、界面之间的IPC | 主会话 | M1-02 | packages/host-kernel、src/main、src/preload | 取消与晚到丢弃测试通过 |
| M1-05 | 配置：Schema校验、版本迁移、生效方式标注、数据目录 | 主会话 | M1-01 | packages/host-kernel | 迁移与回滚测试通过 |
| M1-06 | 凭据代理：按锁定的Electron版本选择safeStorage异步接口；插件命名空间；日志脱敏 | 主会话 | M0-02 | packages/host-kernel | 插件无法读取其他插件凭据的测试通过 |
| M1-07 | 权限预设、一次性审批、默认拒绝、审计记录（[ADR-0012](adr/0012-dsh-style-trust-and-permissions.md)） | 主会话 | M1-02 | packages/host-kernel | SEC-01、SEC-05、SEC-09至SEC-12通过 |
| M1-08 | 契约测试套件与参考插件：脚本化ASR、记录型提供方、崩溃、慢、泄漏插件（[测试策略](14-test-and-acceptance-strategy.md)第7节） | DeepSeek（主会话先给接口） | M1-01 | packages/contract-tests | 能检出参考坏插件的问题 |
| M1-09 | 插件SDK：对插件开放的接口与辅助函数；插件不直接拿宿主内部对象 | DeepSeek（主会话先给规格） | M1-01 | packages/plugin-sdk | 类型检查通过；示例插件通过契约测试 |

### M2 界面骨架

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M2-01 | 界面组件与主题令牌：按钮、表单、列表、对话框、通知；深浅主题；键盘焦点样式 | DeepSeek（前端） | M0-01 | packages/ui-kit | 组件示例页；键盘可达 |
| M2-02 | 设置台框架：左侧导航；页面：开始、桌宠、语音输入、模型、插件、权限与数据、关于；普通与高级分层（参照Coopanion思路） | DeepSeek（前端） | M2-01 | src/renderer/console | 各页面可导航；有空状态与加载状态 |
| M2-03 | 由配置Schema生成设置表单；显示“立即生效、需重载、需重启”与保存失败 | DeepSeek（前端） | M1-01、M2-01 | src/renderer/console | 校验与保存状态显示正确 |
| M2-04 | 插件管理页：列表、状态、启用停用卸载、权限声明、错误与修复入口 | DeepSeek（前端） | M2-02、M1-02接口 | src/renderer/console | 与宿主状态一致；停用后入口消失 |
| M2-05 | 授权对话框、权限预设切换、审计记录查看（只由宿主渲染） | DeepSeek（前端） | M1-07接口 | src/renderer/console | 插件内容无法触发授权（SEC-06） |
| M2-06 | 贡献点注册与清理（宿主侧）：设置页、命令、快捷按钮、面板 | 主会话 | M1-02 | packages/host-kernel、src/main | 停用插件后贡献点全部清除 |
| M2-07 | 原创极简角色与状态动画；气泡（临时文字与最终文字区分）；角色旁快捷按钮 | DeepSeek（前端） | M0-06 | plugins/avatar-default、src/renderer/pet | 不使用任何Coopanion素材；负载下按性能目标测量 |
| M2-08 | 托盘菜单：显示/隐藏、设置、停止全部、退出 | DeepSeek（前端，主会话定义命令） | M2-06 | src/main中的托盘部分（与主会话约定） | 一键停止可用 |

### M3 语音输入链路

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M3-01 | 录音插件：麦克风采集、16kHz单声道PCM帧、有界流、设备切换（采集方式以M0验证决定） | 主会话 | M1-04 | plugins/audio-capture | 拔出麦克风有提示；停用后释放设备 |
| M3-02 | 说话键插件：报告按下与松开（Koffi轮询）；可配置热键与冲突提示 | 主会话 | M0-05、M1-02 | plugins/talk-key | 按实测阈值，快速轻点不漏检 |
| M3-03 | 本地识别插件：sherpa-onnx工作进程；SenseVoiceSmall（VAD分段，可选定时重识别半句给出临时结果，参照Coopanion）与中英流式模型；特性声明 | 主会话 | M0-04、M1-04 | plugins/asr-local | 两个模型都可选；取消后没有晚到结果 |
| M3-04 | 模型下载与校验脚本、模型清单（来源、大小、哈希、许可） | DeepSeek | M0-04 | scripts、plugins/asr-local/models.json | 哈希不符时拒绝加载（SEC-08） |
| M3-05 | 云端识别插件：厂家表；阿里云百炼、火山引擎、OpenAI三个适配器（依据[云端资料](../research/tech-cloud-asr.json)，火山部分字段实施前补核）；自带Key；临时文字只显示，定稿交给对话；取消与晚到丢弃；标注验证状态 | 主会话 | M1-04、M1-06 | plugins/asr-cloud | 模拟服务端测试通过；真实Key验证在M5 |
| M3-06 | 语音对话插件：长按与轻点判定、录音、识别、送入对话；静音自动结束；回复中再次说话先停止当前回复 | 主会话 | M3-01至M3-03、M4-02 | plugins/voice-chat | AC-VC-01、02、04通过 |
| M3-07 | 语音输入设置页：设备、热键、识别引擎与厂家、模型下载进度、Key填写（经凭据代理）、数据去向提示 | DeepSeek（前端） | M2-03、M3各插件接口 | src/renderer/console | 数据去向显示正确 |

### M4 AI对话链路

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M4-01 | 模型服务插件：厂家表与协议适配器，先做OpenAI兼容Chat Completions；默认DeepSeek；自带Key；流式；取消；错误分类；拒绝向公网明文HTTP端点发送（参照Coopanion） | 主会话 | M1-04、M1-06 | plugins/llm-provider | 模拟服务端测试通过 |
| M4-02 | 对话插件：会话、历史（本机保存、可清空）、人设、上下文长度管理、停止 | 主会话 | M4-01 | plugins/chat | 取消与晚到丢弃测试通过 |
| M4-03 | 厂家表数据：各厂家端点、协议、默认模型字段与官方文档链接 | DeepSeek（主会话给格式） | M4-01 | plugins/llm-provider/vendors | 单元测试通过；链接均为官方文档 |
| M4-04 | 对话面板与气泡接入流式回复；思考与回答动画 | DeepSeek（前端） | M2-07、M4-02接口 | src/renderer | 回复期间拖拽与停止可用 |
| M4-05 | 模型设置页：厂家、Key、模型名、连通性测试（参照Coopanion开始页） | DeepSeek（前端） | M2-03、M4-01接口 | src/renderer/console | 测试结果区分鉴权、网络与模型错误 |

### M5 验收与打包

| ID | 工作包 | 负责 | 依赖 | 写入范围 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| M5-01 | 性能埋点与负载场景测量（[测试策略](14-test-and-acceptance-strategy.md)第3、4节） | 主会话 | M3、M4 | qa | 记录是否达到初始目标 |
| M5-02 | 故障注入与安全验收 | 主会话 | M3、M4 | qa | 相关AC与SEC均有记录 |
| M5-03 | 首次使用引导：气泡式，可跳过、可重来（参照Coopanion思路） | DeepSeek（前端） | M2、M4 | src/renderer | 可跳过；设置台有重来入口 |
| M5-04 | 打包：electron-builder NSIS；模型不打包；第三方许可清单 | DeepSeek | M3、M4 | scripts、打包配置 | 干净环境中安装、启动、卸载有记录 |
| M5-05 | 用用户的真实Key做端到端验证，更新厂家验证状态 | 主会话（需用户提供Key并同意） | M3-05、M4-01 | qa、厂家表 | 已验证与未验证如实标注 |
| M5-06 | 用户说明与插件开发说明 | DeepSeek | M1-09、M5-04 | docs | 照说明能安装、能使用、能写出示例插件 |

## 6. 并行建议

- M0-01（DeepSeek）先行；完成后M0-02至M0-05（主会话）与M0-06（DeepSeek前端）并行。
- M1以主会话为主；M1-01、M1-08、M1-09交给DeepSeek；同时DeepSeek前端推进M2-01、M2-02。
- M3与M4的后端由主会话推进；对应设置页与面板由DeepSeek前端并行；脚本与厂家表由DeepSeek并行。
- 任一时刻最多3个子代理。

## 7. 主要风险与应对

| 风险 | 应对 |
| --- | --- |
| Cordis锁定版本不满足需求 | M0-03先验证；不通过时告知用户并评估替代 |
| sherpa-onnx-node与Electron运行时不兼容 | M0-04验证；参照Coopanion使用应用运行时的Node模式子进程 |
| 4GB显存与CPU负载影响流畅 | 识别放在工作进程；按需加载；M5实测 |
| 火山引擎文档获取受限 | 实施前补核；未验证的如实标注 |
| 云端接口变更（例如OpenAI旧转写模型计划于2027-02-26关闭） | 适配器使用当前推荐模型；版本与日期写入厂家表 |
| 子代理产出质量 | 自包含任务说明 + 主会话审查 + 测试门槛 |

## 8. 首版之后（暂定顺序，均为插件）

1. 朗读插件（TTS，本地与云端，复用厂家表做法）与说话动画。
2. 跨应用听写插件：复用Q12、Q13、Q13b、Q15的决定；Q18文字输入路线届时对照验证。
3. 看屏幕问答插件；声音制作插件。
4. 电脑操作插件（权限预设与逐次审批）；角色制作；长期记忆；DSH桥接。
5. 发布能力：自动更新、代码签名、匿名统计（需要服务端）。

## 9. 执行记录

当前已恢复：用户在K3失败后明确要求前端也改用DeepSeek，并恢复目标。执行型任务和前端现均使用workbuddy-subscription/deepseek-v4.1-flash，仍由主会话定义桥、审查与集成；不进入M1。历史暂停记录见[M0交接](../qa/M0-resume.md)。

2026-10-24：指定文档已通读，两个指定子代理路由已核实，环境/仓库基线见[记录](../qa/M0-00-environment.md)。旧草案中与 ADR-0013、首版PRD或本计划第2节不一致的历史表述不作为实施要求。

| 工作包 | 状态 | 证据与边界 |
| --- | --- | --- |
| M0-01 | 通过 | [独立验收](../qa/M0-01.md)；14包检查通过，测试为零用例空跑 |
| M0-02 | 通过（版本锁定与最小运行时探针） | [版本与理由](../qa/versions.md)；安装不等于原生兼容 |
| M0-03 | 通过 | [V-01](../qa/V-01.md)：4个测试及Electron Node模式进程实测通过 |
| M0-04 | 准备部分完成，未通过 | 模型缓存已校验；[下载草稿审查](../qa/M0-04-download-review.md)发现3个可复现缺陷；未运行识别 |
| M0-05 | 未实施 | 最小键态调用不等于轮询/漏检/CPU验证 |
| M0-06 | 委派异常，等待用户决定 | [K3异常记录](../qa/M0-06-dispatch-failure.md)；没有前端文件或窗口证据 |

实现补充：TypeScript 暂定锁定6.0.3，与typescript-eslint 8.72.0的 `<6.1.0` peer范围一致；不盲目升级npm latest 7.0.2。Electron选择当前稳定45.0.0，原生参考版本先保持不变，见[版本记录](../qa/versions.md)。为可复现安装，M0-02写入范围补充workspace catalog/overrides、相关包清单及锁文件；M0验证脚本放qa/probes，窗口桥及主会话集成范围见[原型接口](../qa/M0-06-bridge.md)。这些是实施路径补充，不改变产品决策。

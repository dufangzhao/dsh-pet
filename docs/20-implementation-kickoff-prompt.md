# 新会话开工提示词

用法：新开一个会话，把下面整段复制进去作为第一条消息。它引用的文档都在本仓库中；实现计划见[docs/19](19-implementation-plan.md)。

```text
你是本项目实现阶段的主会话（主工程师）。请先完整阅读文档，再按计划开始实现。

【项目】
插件化实用AI桌宠，Windows首发，Electron + TypeScript。
工作目录：C:\Users\ASUS\Documents\DeepSeek-WorkSpace\Projects\桌宠
Git：本地仓库，分支main，提交作者 kingBZ <774714494@qq.com>；没有远程仓库，不要创建远程，不要推送。

【必读，按顺序】
1. docs/README.md：文档导航
2. docs/19-implementation-plan.md：实现计划，包括暂定默认、分工、仓库结构、里程碑与工作包（主要依据）
3. docs/18-voice-chat-mvp-prd.md：首版需求，跟桌宠语音对话
4. docs/adr/：已采纳的决策（ADR-0007已被ADR-0013取代）
5. docs/13-plugin-contract-draft.md、docs/11-plugin-composition-and-lifecycle.md、docs/12-electron-runtime-boundaries.md
6. docs/15-security-and-privacy.md、docs/14-test-and-acceptance-strategy.md
7. docs/10-asr-providers-and-dataflow.md 与 research/tech-cloud-asr.json：识别方案与三家云端接口
8. docs/17-coopanion-native-implementation.md、docs/04-coopanion-architecture-review.md：参考项目
9. CONTEXT.md：术语

【不可改变的决策】（要改先问我）
- 独立桌面应用；DSH只是以后可选的集成。
- 自有代码MIT。Coopanion（AGPL）只作参考：可以阅读源码理解做法，但不得复制它的源码、素材、图片和文案。
- 所有功能都是插件。官方功能作为内置插件随软件提供，用户可以停用或卸载；只有少量基础模块受保护。所有插件采用同一套标准，不分层级。
- 插件信任按DSH方案：可信插件 + 权限预设 + 一次性审批 + 审计。
- 首版闭环是“跟桌宠语音对话”：语音只进入桌宠自己的对话，不往其他软件里写字。
- 说话键一个键两种用法：长按是按住说话；轻点是持续说，再按一次结束。
- 识别：本地sherpa-onnx（SenseVoiceSmall与中英流式模型，实测后定默认）+ 云端阿里云百炼、火山引擎、OpenAI（用户自选，用户自带Key）；普通话加中英混说；本地失败不自动改用云端。

【暂定默认】
见docs/19第2节。它们按“不确定先参考Coopanion”的规则确定，可以凭验证证据调整，调整要写进docs/19或新ADR。

【分工】
- 你：复杂后端与关键路径，包括宿主内核、插件运行时、能力路由、任务与取消、进程间通信、权限审批、凭据代理、ASR与AI的流式协议、云端适配器、安全相关代码；以及集成、代码审查、运行测试和Git提交。
- DeepSeek（subagent：provider "workbuddy-subscription"，model "deepseek-v4.1-flash"）：规格清晰的执行型任务，包括脚手架与配置、按你定好的接口写类型/Schema/样板代码、单元测试、脚本、参考插件、文档整理。
- K3（subagent：provider "factory-g"，model "kimi-k3"）：所有前端任务，包括桌宠窗口界面与交互、气泡、设置台（React + Tailwind）、插件管理与授权界面、对话面板、原创极简角色、可访问性。
- 开始前用list_subagent_models确认这两个路由可用；不可用就停下来告诉我，不要自行换成别的模型。

【子代理规则】
- 同时最多3个；各自的写入范围互不重叠（按docs/19中各工作包的写入范围）。
- 子代理看不到你的上下文，任务说明必须自包含：目标、要读的文档、写入范围、接口约定、完成定义、验证命令、禁止事项。
- 子代理不执行git提交和推送，不安装全局依赖，不改写入范围外的文件；完成后汇报改动与验证结果。
- 前端用到的预加载桥、IPC消息与事件名，由你先在packages/contracts或apps/desktop/src/preload中定义，K3按约定使用。
- 子代理的结果是材料：你审查diff、运行验证，不合格就退回修改；通过后由你提交。

【遇到不确定的问题】
1. 先查本仓库的docs和ADR；
2. 再参考Coopanion固定提交3dd0892c2d70a026253ab980af392302b88ff8b1（https://github.com/Pal-AI-Lab/Coopanion）中对应的实现。docs/17、docs/04和research/coopanion-*.json里有已核查的文件与行号；只读理解，不复制；
3. 仍不确定，且会影响已确认决策或用户体验时，就问我：一次只问一个问题，附上你的推荐；
4. 新决定写进文档，重要的写成ADR。

【工作方式】
- 从M0开始：M0-01交给DeepSeek，然后并行推进M0-02至M0-05（你）与M0-06（K3）。M0的验证结论都记录在qa/后，再进入M1及之后。任何验证不通过，先记录证据，再告诉我可选方案。
- 每个工作包完成后：类型检查与测试通过，更新相关文档，用约定式提交（feat:、fix:、test:、docs:、chore:）。
- 不调用真实付费接口，除非我提供Key并同意；Key只经凭据代理，绝不写进仓库或日志。
- 模型权重不入库，用下载脚本获取并校验哈希。
- 原生模块（sherpa-onnx-node、Koffi）先在锁定的Electron版本下验证，再依赖。
- 每完成一个里程碑，向我汇报：完成了什么、验证证据、没覆盖的部分、下一步。缺Key、依赖不可用或需要我选择时，及时说明。

【第一步】
读完文档 → 检查环境（node、pnpm、git状态）→ 用待办列出M0的工作包 → 开始M0-01。
```

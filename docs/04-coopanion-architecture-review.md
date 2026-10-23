# Coopanion：架构、实际能力与二开边界

研究日：2026-10-24。主仓固定 3dd0892c2d70a026253ab980af392302b88ff8b1（v0.2.8）；Cortico子模块 ace4c640af07f21c15f81116c370fda0fe828389。

## 给本项目的结论

建议优先借鉴交互与架构分层；接受AGPL、可自建素材、且愿意重构语音与权限插件宿主时，可作为有条件二开底座。不应把它当作开箱即用的全局听写+声音克隆+安全可替换能力平台。

本项目已选择受控UI贡献点（[ADR-0001](adr/0001-controlled-ui-contributions.md)），这比Coopanion固定普通界面的边界更开放。采用它的代码与借鉴其交互是两项不同决定，目前均未替用户选择。

**后续项目决策：**用户已选择[MIT](adr/0003-mit-license.md)，并在AGPL解释后明确[仅作参考、先不二开](adr/0006-reference-coopanion-without-fork.md)。下文条件fork保留为历史研究比较，不作为当前实施路线；框架与可复用组件仍须逐项核验。

## 简化实现链路

```text
Electron应用壳 → Core子进程 → 固定组装Cormini + Worlds + Provider
设置台 → Core WebUI接口 → 配置/会话/扩展状态
桌宠World → 本地HTTP/WS → 透明桌宠窗口与形象渲染
本地ASR → desktop-pet.speech事件 → 与Bot对话（不是直接听写到外部输入框）
Bot动作 → CUA授权 → 原生电脑操作引擎子进程 → 截图/输入与回执
```

此图只概括已核验的主要边界，不是完整进程/线程清单。

## 1. 技术栈与进程

**官方表述：**README称基于Cortico Core + Cormini Persona + 桌宠World。

**源码/配置核验：**Electron主进程fork Node/tsx Core；Core组装Persona与World，桌宠有本地HTTP/WS服务，单独Electron桌宠host，CUA原生调用再fork引擎。ASR sherpa在World/Core进程，不是专用隔离插件进程。主语言TS/JS/CJS，部分控制台React/CodeMirror/Tailwind，桌宠自写JS/SVG/WebGL。

**未验证：**未画出全部进程/线程图；未运行观察内存、帧率、启动时间。

依据：[package.json · stack](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/package.json#L1-L61) · [core-host.cjs · corehost](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/app/core-host.cjs#L74-L89) · [companion.ts · assembly](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L388-L396) · [companion.ts · assembly2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L473-L554) · [world.ts · asrconstruct](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L610-L629) · [electron-main.cjs · window](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/host/electron-main.cjs#L374-L396)

## 2. Cortico/Core/Cormini/World边界

**官方表述：**Cortico是框架，Core负责生命周期，Persona定义认知与Memory语义，World负责环境输入输出。

**源码/配置核验：**Coopanion固定装配Cormini的子类，覆盖PARTNER和git行为，再挂console、desktop-pet、coopanion通知World。Core负责编排session/事件/工具/provider；World提供工具、事件、envPrompt和配置；provider适配模型协议。Cortico支持bot扩展不意味着Coopanion现有入口支持任意Persona一键互换。

依据：[companion.ts · assembly](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L388-L396) · [companion.ts · assembly2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L473-L554) · [world.ts · world](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L28-L69) · [types.ts · types](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/types.ts#L902-L951) · [persona.ts · memory](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/persona.ts#L1-L12)

## 3. 扩展manifest与lifecycle

**官方表述：**npm扩展分world/provider/bot；安装后重启，再启用World。

**源码/配置核验：**manifest版本world6/provider6/bot7，检查ESM/默认导出/ID冲突/UI资产路径；上一版有临时过渡层。World defaults/create/preflight、start/stop、activate/deactivate/restart及前缀重建真实存在；停用后宿主lease阻止继续事件注入。模块代码升级不是热替换，需重启进程。未启用World也会create，disabled不是拒绝执行模块代码的信任边界。

依据：[manifest.ts · manifest](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions/manifest.ts#L23-L55) · [manifest.ts · manifestcompat](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions/manifest.ts#L128-L140) · [extensions.md · extensionsdoc](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/docs/extensions.md#L303-L315) · [extensions.ts · loader](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions.ts#L249-L340) · [world.ts · world](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L28-L69) · [world.ts · worldconstruct](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L217-L260) · [world.ts · worldlife](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L357-L397) · [core.ts · hostlease](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L471-L515)

## 4. 能力、路由与隔离

**官方表述：**describe展示全部工具与事件，能力元数据用于市场/配置。

**源码/配置核验：**当前manifest无文件/网络/麦克风/屏幕等强制capability授权。read/write/speak/act等tags是分类/装配线索；describe外工具或事件仍执行只warn。Node import同进程信任插件，Core进程分离与错误捕获不是每插件OS隔离。存在World认知请求只能点名自有工具及卸载lease等局部约束，不能说完全无安全设计。模型每次请求按activeProvider路由；语音识别/语音输出尚未统一为可替换能力插槽。

**未验证：**未完整审计所有Provider、WebUI面板、extension安装脚本和转发路径，也未实测恶意扩展。

依据：[manifest.ts · manifest](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions/manifest.ts#L23-L55) · [extensions.ts · loader](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions.ts#L249-L340) · [world.ts · world](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L28-L69) · [types.ts · tags](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/types.ts#L197-L279) · [core.ts · cognition](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L361-L378) · [core.ts · hostlease](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L471-L515) · [core.ts · modelroute](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L439-L467) · [world.ts · asrconstruct](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L610-L629)

## 5. 配置与密钥

**官方表述：**World配置归worlds.<id>，部署配置覆盖默认；本地保存Key/登录态。

**源码/配置核验：**WorldContext提供共享cfg引用/persist/restart；热读取配置即时生效，构造时复制值需重启。Coopanion rounds复制故需重启。core/companion从providers/<endpoint>/.env读取密钥引用，并无在这些路径中发现OS密钥保险库。

**未验证：**未审计全套配置迁移、所有密钥静态加密/OS凭据仓库可能性；不能宣称密钥已安全加密。

依据：[world.ts · world](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L28-L69) · [companion.ts · secrets](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L78-L84) · [companion.ts · assembly2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/companion.ts#L473-L554)

## 6. Electron窗口与渲染

**官方表述：**透明置顶、点击穿透、跨屏移动；鲸鱼称Live2D式分件模型。

**源码/配置核验：**BrowserWindow确实transparent/frame:false/alwaysOnTop/contextIsolation/sandbox，默认穿透；Coo按帧SVG；鲸鱼自研WebGL2/1 sprite rig，Canvas在SVG中，动态脸部与弹簧，不是Live2D Cubism运行时。所核验内置形象不是WebM播放。

**未验证：**不证明任意Live2D模型、WebM、VRM、Spine资源可直接导入；未全仓证明完全不存在任何视频用途。

依据：[electron-main.cjs · window](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/host/electron-main.cjs#L374-L396) · [coo.js · coorender](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/coo/coo.js#L187-L206) · [coo.js · coorender2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/coo/coo.js#L346-L351) · [figure.js · whalerender](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/whale/figure.js#L1-L15) · [rig.js · webgl](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/kit/rig.js#L48-L57)

## 7. ASR/PTT

**官方表述：**FunASR/SenseVoiceSmall、Whisper small、Windows SAPI；hold/toggle/always；默认LeftAlt*2。

**源码/配置核验：**本地PCM到sherpa OfflineRecognizer，SenseVoice500ms部分句重识别、Whisper句末转写；Windows系统引擎单独辅助进程。koffi全局键态读取。识别末端将文字flush到desktop-pet.speech事件唤醒bot，而非将结果直接写回当前任意应用。

**未验证：**准确率/耗时/噪声表现未测；README性能数据仅作者声明；不把全局触发键等同全局听写。

依据：[README.md · voicereadme](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/README.md#L154-L215) · [sherpa.ts · asr](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/sherpa.ts#L65-L99) · [sherpa.ts · asr2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/sherpa.ts#L188-L198) · [world.ts · asrconstruct](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L610-L629) · [world.ts · asrevent](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L1594-L1618) · [hotkey.ts · hotkey](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L126-L147) · [hotkey.ts · hotkeylinux](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L184-L194)

## 8. TTS、音色创建与声音克隆

**官方表述：**说话声将气泡逐字念成短音节，可调音高和速度；第三方声明为Edge Xiaoyi音节。

**源码/配置核验：**严格说有文本转声音的轻量拼接链，不是完全随机音效；但不是通常期望的整句自然神经TTS。规则/词典到IPA到最近中文音节，加载本地zh.ogg切片，以WebAudio playbackRate改音高并改时长。开发用build.py支持Edge/Azure及--voice重建音节库，非产品UI音色训练或用户录音克隆。

**未验证：**未验证Edge生成音节音频的再分发及商业使用许可条款；未发现已检查生产语音链中的参考音频上传/说话人embedding/训练克隆模型流程，不作全仓不存在第三方TTS扩展的断言。

依据：[speech.js · speech](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/speech.js#L1-L16) · [speech.js · speech2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/speech.js#L70-L128) · [index.ts · speechtext](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/speech/index.ts#L1-L38) · [build.py · speechbuild](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/scripts/speech-bank/build.py#L1-L20) · [THIRD_PARTY_NOTICES.md · assets](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/THIRD_PARTY_NOTICES.md#L26-L38)

## 9. 模型、记忆及git版本化

**官方表述：**多家模型；PARTNER.md每次整份进提示词；工作区每次改动版本化。

**源码/配置核验：**Coo provider按协议实例化Responses/Chat/Anthropic/Gemini，Core当前端点路由；多供应商代码存在不等于全部真实服务验证。记忆为文件工作区而非已核验向量RAG：CONSTITUTION/PARTNER及清单进入前缀，其余按需文件读写。成功写工具串行git commit，启动按应用版本tag，blobs排除；无git仍可写但无该版本保障；git仓是记忆工作区，不是自动改项目源码。

**未验证：**尚未审计全部摘要/handoff算法、长期遗忘效果、冲突解决和恢复可靠性；不能宣称全量记忆无损或所有文件变动均即时被监听提交。

依据：[index.ts · provider](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-provider-coo/src/index.ts#L141-L206) · [README_zh.md · providernote](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/README_zh.md#L163-L169) · [core.ts · modelroute](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L439-L467) · [persona.ts · memory](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/persona.ts#L1-L12) · [persona.ts · memory2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/persona.ts#L24-L47) · [persona.ts · memorycommit](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/persona.ts#L153-L190) · [workspaceGit.ts · git](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/bots/cormini/persona/workspaceGit.ts#L1-L5) · [workspaceGit.ts · gitexec](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/bots/cormini/persona/workspaceGit.ts#L142-L180)

## 10. 真实电脑控制

**官方表述：**默认关闭，启用后能截图/点按/键盘/窗口；用户活动会让位，登录支付交还人。

**源码/配置核验：**11类工具真实到原生API，Windows GDI截图、SetCursorPos/SendInput/EnumWindows，非虚拟桌面模拟。CUA引擎为子进程可重启，但不是隔离虚拟机。默认截图缩放1280x800及操作后截图；control=false拒绝输入，仅允许看。

**未验证：**macOS/Linux底层实现此轮主要依据官方文档而非逐行核验；未操作真实电脑。

依据：[cua.ts · cuatools](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/cua.ts#L331-L358) · [win32.ts · cuawin](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L41-L56) · [win32.ts · cuawin2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L108-L153) · [config.ts · cuadefault](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/config.ts#L8-L51) · [README.md · cuadoc](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/README.md#L410-L438)

## 11. 授权周期与敏感动作

**官方表述：**ask-each-turn / ask-before-acting / ask-once / never-ask，默认ask-once 30分钟；旧部署保留ask-each-turn。

**源码/配置核验：**see与act在引擎调用前permit；ask-once读取免问，动作经同意后grantedUntil生效；拒绝/超时当前turn继续拒绝，turn结束重置permission；grantedUntil是Cua对象内存状态，进程重建不保留。关闭cua将工具移除且结束引擎；同一对象switchedOff/endEngine没有清grantedUntil，故不能把关闭再开等同撤销旧同意（静态判断，未运行复现）。v0.2.8不存在终端输入/系统快捷键的额外分类审批。登录/密码/支付及不可逆动作先问在ENV_PROMPT，不能等同强制逐项策略拦截。

**对本项目的影响：**应明确读屏与输入分离授权、立即撤销、任务/应用/时间范围、敏感动作硬拦截；不能照搬30分钟广域同意作为实用助手默认。

依据：[config.ts · cuadefault](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/config.ts#L8-L51) · [cua.ts · cuaop](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/cua.ts#L228-L275) · [cua.ts · cuastop](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/cua.ts#L153-L194) · [world.ts · cuaworld](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L917-L920) · [world.ts · cuaworld2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L1654-L1657) · [seed.ts · cuamigration](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/core/seed.ts#L18-L20) · [v0.2.8.md · v028](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/docs/releases/v0.2.8.md#L1-L7) · [ENV_PROMPT.md · cuaprompt](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/ENV_PROMPT.md#L18-L21)

## 12. 本地HTTP与页面边界

**官方表述：**浏览器写请求同源，桌宠宿主随机凭据。

**源码/配置核验：**window/overlay-source校验启动key；浏览器Origin与Host限制；无Origin的本机客户端仍被允许。因此防网页跨源不等于防本机恶意程序。Electron renderer sandbox/contextIsolation真实存在，但不能覆盖Node World插件。

**未验证：**未进行CSRF、路径、WS、导航或权限绕过完整安全测试。

依据：[server.ts · serverauth](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/server.ts#L160-L168) · [server.ts · serverorigin](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/server.ts#L220-L231) · [electron-main.cjs · window](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/host/electron-main.cjs#L374-L396) · [extensions.ts · loader](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions.ts#L249-L340)

## 13. figure pack schema、可执行性和兼容

**官方表述：**API2起长久向后兼容，kit冻结、同版本只加不改，zip/folder导入。

**源码/配置核验：**figure.json manifest/api当前与最旧均2；entry/export动态import工厂，model/axes/presets/vocab/sounds/can/moves/needs等。pack是可执行JS不是纯贴图。工厂body至少step/layout/do，宿主postMessage传递有限状态，iframe opaque origin + connect-src none。128MiB导入、路径拒绝..与绝对路径；ready20秒超时。当前只实现2，未来兼容是承诺而非已观察多代兼容。

依据：[packs.ts · pack](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/packs.ts#L30-L53) · [packs.ts · packparse](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/packs.ts#L248-L311) · [figure-frame.js · packcontract](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/figure-frame.js#L9-L36) · [figure-frame.js · packexec](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/figure-frame.js#L72-L95) · [server.ts · packsandbox](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/server.ts#L330-L335) · [body-host.js · packhost](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/body-host.js#L119-L137) · [pack-import.ts · packimport](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/pack-import.ts#L22-L79) · [README.md · packcompat](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/README.md#L299-L316) · [figure-frame-contract.test.js · fixture](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/tests/figure-frame-contract.test.js#L1-L35)

## 14. figure capability不是系统能力插件

**官方表述：**needs目前只有windows，供身体站在窗沿。

**源码/配置核验：**几何顶边接口不提供标题/应用名；声明后可在CUA关闭时读取，和真实操作权限不同。沙箱不直接支持网络fetch、音视频元素与字体，声音经manifest交宿主。不应把装形象包等同装ASR/TTS/电脑能力插件。

**未验证：**窗口几何授权是否另需用户同意，此轮未见统一capability审批；README明确macOS/Linux窗沿未实测。

依据：[packs.ts · pack](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/packs.ts#L30-L53) · [figure-frame.js · packcontract](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/figure-frame.js#L9-L36) · [server.ts · packsandbox](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/server.ts#L330-L335) · [README.md · packneeds](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/README.md#L269-L282)

## 15. 许可与资产风险

**官方表述：**当前AGPL3-or-later，0.1.10及之前MIT；Cortico MIT；鲸鱼贴图排除。

**源码/配置核验：**LICENSE正文核实AGPL与Steamworks附加许可；Cortico固定提交MIT正文核实。鲸鱼原设/二创/商标及AI生成贴图并非随代码获得可自由再用授权。音节音频、模型及词典各有独立来源/许可。

**对本项目的影响：**允许商业使用不等于允许闭源组合分发；二开分发/网络交互需评估AGPL对应源码义务，Steamworks例外不是普遍闭源例外。建议新建自有形象资产并单独核查语音音频/模型条款。此为工程许可提醒，不是法律意见。

依据：[LICENSE · lic](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/LICENSE#L1-L16) · [README_zh.md · rootlicense](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/README_zh.md#L371-L375) · [LICENSE · mit](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/LICENSE#L1-L21) · [THIRD_PARTY_NOTICES.md · assets](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/THIRD_PARTY_NOTICES.md#L26-L38) · [THIRD_PARTY_NOTICES.md · thirdparty](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/THIRD_PARTY_NOTICES.md#L3-L24)

## 16. 成熟度、tests与CI

**官方表述：**三平台发行，但无Windows签名/macOS Developer ID；官方承认mac/linux多屏未真机验证。

**源码/配置核验：**v0.2.8公开release非prerelease，八个主要安装/便携产物及校验和；固定提交CI和release job均success。CI矩阵三OS，静态检查+Vitest含World回归；真实CUA E2E明确排除；API2 JSDOM契约测试存在。因此是有持续交付与回归的早期产品，不是裸demo，也不是经全面桌面/安全/供应商互操作验证的成熟平台。

**未验证：**没有运行测试；未核验所有case数量/覆盖率、历史失败率、安装包签名字节、真实设备体验或性能。

依据：[ci.yml · ci](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/.github/workflows/ci.yml#L11-L35) · [vitest.worlds.config.ts · e2eexcluded](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/vitest.worlds.config.ts#L4-L16) · [figure-frame-contract.test.js · fixture](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/tests/figure-frame-contract.test.js#L1-L35) · [release.yml · release](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/.github/workflows/release.yml#L16-L54) · [release.yml · releasepublish](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/.github/workflows/release.yml#L81-L98) · [README_zh.md · unsigned](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/README_zh.md#L63-L104) · [SECURITY.md · security](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/SECURITY.md#L11-L25) · [README.md · cuadoc](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/README.md#L410-L438)

## 关键需求差距

### 全局听写到任意前台应用

- 已有：全局PTT、麦克风管理、本地ASR、部分转写反馈、取消句子；CUA另有键盘注入。
- 缺口：独立听写模式及目标输入框/焦点快照、直接文本落点、剪贴板保护、文本注入适配（UIA/IME/粘贴）、撤销/替换上句、与聊天/指令模式隔离、识别隐私和失败回退。
- 判断：可复用识别和交互组件，不能仅把speech事件接到agent再让它打字当作可靠全局听写。
- 依据：[world.ts · asrevent](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L1594-L1618) · [world.ts · asrconstruct](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L610-L629) · [hotkey.ts · hotkey](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L126-L147) · [cua.ts · cuatools](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/cua.ts#L331-L358)

### 可创建/克隆个性音色

- 已有：固定音节库、音高/语速；开发构建脚本可换服务voice。
- 缺口：整句/流式TTS接口、音色库、录音/导入/同意证明、说话人建模或远程克隆API、预览/删除/版本/成本控制、播放取消与嘴型同步契约。
- 判断：需要新增独立TTS与voice-profile能力；不能宣传现有pitch调节=克隆。
- 依据：[speech.js · speech](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/speech.js#L1-L16) · [speech.js · speech2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/web/speech.js#L70-L128) · [build.py · speechbuild](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/scripts/speech-bank/build.py#L1-L20)

### 可替换能力插件与统一路由

- 已有：World/provider/bot模块边界、manifest、生命周期、配置UI、工具事件总线、市场。
- 缺口：ASR/TTS/voice/听写输出等统一service接口和声明，按能力选择默认/备用实现、实例和版本依赖管理、强制最小授权与进程/RPC隔离、故障恢复与资源预算、可撤销权限、跨插件迁移兼容保证。
- 判断：World作为集成扩展可用；不等于安全能力内核。建议ASR/TTS从desktop-pet World解耦。
- 依据：[manifest.ts · manifest](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions/manifest.ts#L23-L55) · [extensions.ts · loader](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/extensions.ts#L249-L340) · [world.ts · world](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/world.ts#L28-L69) · [core.ts · modelroute](https://github.com/Pal-AI-Lab/Cortico/blob/ace4c640af07f21c15f81116c370fda0fe828389/src/core/core.ts#L439-L467) · [world.ts · asrconstruct](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L610-L629)

## 复用路径的真实取舍

### 直接fork产品

**收益**
- 桌宠窗口、点击穿透、气泡工具和动作词表已形成实现链。
- 会话/事件/状态/文件记忆/git历史与模型接入可节省基础开发。
- figure API2、配置面板、扩展市场与多平台发布流程已存在。

**成本**
- AGPL影响闭源策略；鲸鱼贴图不随代码授权。
- ASR、电脑控制、窗口与宠物交互集中于桌宠World，目标能力替换需重构。
- npm World/provider直接导入Node，无法以现有manifest约束不可信插件OS访问。
- 授权策略较宽松，敏感行为多靠提示词；全局听写和声音克隆核心缺口未补。
- v0.x持续演进，World/provider/bot API只保证上一代过渡，长期插件兼容成本需承担。

### 借鉴交互，自行组合基础设施

**收益**
- 可独立设计满足实用AI桌宠的服务内核，避免迁就陪伴型固定装配。
- 可保留气泡/PTT/状态反馈的设计思想，采用自有美术和独立实现。

**成本**
- 需重新实现透明窗口/点击穿透/多屏/音频采集/动画生命周期等跨平台细节。
- 不能把借鉴交互视为可以复制AGPL代码或受限资产。

另可评估MIT Cortico作为框架，但其许可不授权复制AGPL产品代码或排除许可的角色素材；也不能免除语音能力接口、受控UI贡献点和权限隔离的开发。

## 方法与限制

未运行应用、模型、测试或电脑控制；没有独立性能基准或全面安全审计。源码存在、CI成功、安装包发布与实际使用稳定是不同证据层级。当前授权撤销相关观察是静态推断，未复现漏洞。

完整证据与覆盖：[架构研究JSON](../research/coopanion-architecture.json)。设置台与截图说明见[交互评审](02-coopanion-ui-review.md)。

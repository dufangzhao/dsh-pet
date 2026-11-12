# M5 speech output entry — source-backed research freeze

2026-11-11，planning/research；初次研究仅写本文，后续经Parent明确授权另写design/implement草案；不改产品/PRD/spec/task status，不 start/commit，不派 agent。读取当前工作树与已定位 AstrBot 源码，并定点复读公开 pinned 源码；未读取其实际配置、keys、persona、screenshots，未运行插件、服务、设备、音频 POST、推理或播放。本轮没有新本机 metadata GET；目录观察沿用父研究，明确为历史证据。本文是技术边界建议，不是用户产品选择或实现批准。

## O7/O8/O9 后续收敛（2026-11-11）

Parent已传达用户选择：真实optional内置feature，启用后自动朗读每条committed正式assistant（包括say正文），仅Pet出声；console仅control/state，Web无player。manual/voice-only/全端输出不再是待选产品分支。默认off为最终review技术候选，旧true试听设置不迁移为auto授权。下面manual/attribution表只保留初次研究的事实与取舍，不指导当前实现范围；**不增加input modality归因工作**。当前草案见 [design](../design.md) 与 [implement](../implement.md)。

追加核查：[say handler](../../../../plugins/harness-cortico/src/harness.mjs#L183)每次独立publish正式正文；[Main follow](../../../../apps/desktop/src/main/companion-client-controller.ts#L618)当前忽略EventMessage内容，只 [120ms合并refresh](../../../../apps/desktop/src/main/companion-client-controller.ts#L567)。SSE无正文而snapshot有界，故须按每条event的messageId从service现有canonical store读正文，不能snapshotdiff/latest-only。服务固定purpose合成、已知requestId的cancel/fence、bounded单consumer音频交付和真实join是后续设计交付点；parent确认≤4在途handles/有限terminalmetadata是必要operation bookkeeping，不是新通用registry/queue/DB。内部media reader需与producer并行消费credits，audioGET不得等待一个又反过来依赖audioGET返credit的producer result。本文与草案均无产品实现/测试执行。

追加O9：用户已选长正式回复也完整朗读。canonical assistant已有[8000 UTF-16 units](../../../../plugins/state-sqlite/src/validation.ts#L168)与[单message JSON28KiB](../../../../plugins/state-sqlite/src/state.ts#L394)上限；旧speech的4000cp/整段2MiB是旧单次合成约束，不是M5短回复产品限制。修订草案采用一个logical/FIFO槽、service按原文确定性顺序parts、无ahead，part完成即清audio；当前part+高水位压缩bookkeeping，不累计每partterminal记录。最小音色提案为普通MiMo固定voice；design虽可识别，但缺乏跨part固定音色复用证据，首片建议nonselectable，不声称效果已测。

**当前官方能力纠正：** 以Parent维护的 [current official MiMo evidence](mimo-tts-current.md) 为新权威研究context。两官方页本子代理亦已定点extract复读：普通MiMo明确支持stream:true+pcm16、SSE delta.audio.data及24kPCM16LEmono；design/clone仅完整推理后一次兼容结果。AstrBot非流式WAV代码只证明它的adapter用法，不能限制普通模型能力。故撤回64cp/250parts、大JSON/WAV整段buffer与40s短段设计；最新[design](../design.md)采用普通PCM流、有限canonical文本segments和boundeddevice窗口，首PCM在native完成前播放，不暗fallback/nonstream/retry，不称full-duplex。

**Magpie定点核查：** 已重新extract [pinned native.go][native]：nativeAny保留request body（除已有privacy masking），NewRequestWithContext从r.Context经p.Via/metered构造，复制上游Content-Type、以32KiB循环read/write并每次Flush、defer response.Body.Close；未完整收集SSE。这支持源码级流转发/取消路径，不证明安装实例exactSHA/实际首包时延或vendor停计费。对已定位本机discovery-only patch定点搜索未发现native.go/text-event-stream/Flush改动；未定位本机部署native.go，未运行gateway或模型POST。Parent的本机actualflow/livegate仍须另授权，不能把pinned源码当已测部署。

[CreditMediaSender](../../../../packages/host-kernel/src/tasks/credit-sender.ts#L41)是归还credit的有界窗口，end等debt归零，不是全流2MiB累计上限。流式预算分per-event/queuedbuffer与累计计数；firstPCM/activeproduceridle/consumerstall/absolute分别计时，故不能用40s/55s wholedeadline杀掉健康长流，也不能把主动背压等待误报vendoridle。完整规划以design/implement为准，不在research重复DTO/数字。

## 初次研究结论与约束（触发/目的地/旧整段限制已被O7/O8/O9替代）

1. 可复用既有 `speech.output@1` 的文本/PCM 描述、TaskSupervisor、TaskMediaPeer、Main 精确可信 frame 和 Pet 单播放 owner；不能直接把旧桌面 orchestration 搬到共享服务。旧控制器仍实际挂载，但依赖本地 profile，且 stop/close 不等待物理 drain。
2. 已定位AstrBot参考对MiMo普通TTS/design使用 **Magpie native → `/chat/completions` → nonstream完整JSON/base64**。这是参考adapter用法；现已由上文官方普通MiMo `stream:true/pcm16` 证据补全能力判断，首codec改用SSE PCM流，不能将参考nonstream路径当vendor限制。标准`/audio/speech`仍不据此替代MiMo native。
3. 显式朗读已提交 assistant message 不需要输入来源分类；“仅对语音输入自动回复”增加真实的输入归因和输出目的地约束。当前 canonical 消息没有 modality，而且 assistant 持久投影只保留 Core `inputIds` 的首项；不能声称已经具备可靠、跨客户端的 voice-origin 策略。
4. Provider（计算/网络）、播放设备（浏览器/Electron）与逻辑输出 owner（Agent、已提交消息、当前客户端绑定及播放意图）必须独立。断连/retarget 不重放，停止声音不停止 Core/独立 work/ASR，M4 mic-start 不隐式改策略。

需求依据：[M5 PRD O1–O6](../prd.md#L17)、[parent R1–R22](../../11-06-unified-companion-architecture/prd.md#L9)、[shared baseline](../../../spec/shared/project-baseline.md#L14)、[plugin contracts](../../../spec/shared/plugin-application-contracts.md#L192)、[shared voice](../../../spec/backend/shared-voice-input.md#L26)、[model connections](../../../spec/backend/model-connections.md#L38)、[desktop companion](../../../spec/backend/desktop-companion.md#L55)。父研究中的直接云/本地模型备选已被 R22 取代；系统 TTS 仅是复用证据，不是 M5 Magpie 失败时的后备模型。

## 当前真实入口与可复用 seams

| 层 | 当前事实与源码 | M5 复用边界 |
| --- | --- | --- |
| Contract | [speech-output.ts](../../../../packages/contracts/src/speech-output.ts#L8) 定义 `speech.output@1`、synthesize request、PCM descriptor、固定桥与 playback receipt。 | 延续已有概念；没有 Magpie/native WAV、service target/client binding 或 canonical message 验证。不能把旧桥字段当新共享 API 已存在。 |
| Main startup | [Main](../../../../apps/desktop/src/main/index.ts#L181) 将 profile、两个旧 speech provider 纳入本地角色；[media 回调](../../../../apps/desktop/src/main/index.ts#L230) 路由到 speech；[366](../../../../apps/desktop/src/main/index.ts#L366) 实际构造控制器并注册 IPC。音频只发 Pet window。 | 这不是死代码，但当前 Linux 的 Windows-only provider 不能据此变为可用；Main 不应承接另一套模型推理 owner。 |
| 精确桥 | [preload](../../../../apps/desktop/src/preload/index.ts#L129) 暴露 frozen facade；[bridge](../../../../apps/desktop/src/preload/speech-output-bridge.ts#L18) 检查 arity，chunk 独立 Uint8Array/copy；[Main 请求](../../../../apps/desktop/src/main/speech-output-controller.ts#L644) 检查 exact keys、当前 file main frame，只有 Pet 可报 playback。 | 保留固定、分角色接口和音频/control 分离；不能开放任意 URL/path/owner。 |
| 设置 | [persona 页面](../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L251) 有真实 SpeechSettingsPanel；[audition](../../../../apps/desktop/src/renderer/console/minimal-ui/use-speech-output.ts#L229) 发送用户输入试听文本，目标提示 Pet window。 | 这证明显式试听可达；不是 shared canonical assistant-message read-aloud，也没有自动新回复订阅。 |
| 旧 output owner | [SpeechOutputController](../../../../apps/desktop/src/main/speech-output-controller.ts#L123) 从本地 profile 读取 speechEnabled/provider/language/voice/rate/volume；[speak](../../../../apps/desktop/src/main/speech-output-controller.ts#L213) 收任意 text+utteranceId；[run](../../../../apps/desktop/src/main/speech-output-controller.ts#L368) 选 provider 并调 capability。 | 其 owner 是本地 profile，而非独立 Agent/canonical message/client binding；旧 request 不证明文本来自已提交 assistant。 |
| Pet player | [Pet root](../../../../apps/desktop/src/renderer/pet/App.tsx#L914) 一次挂载 [playback owner](../../../../apps/desktop/src/renderer/speech-output/playback-owner.tsx#L4)，设置页不播。 | 延续 desktop 单物理消费方；web 目前无同等 output owner，需普通 feature 的浏览器消费实现。 |
| Web | [web client](../../../../plugins/text-client/src/client/client.ts#L183) 是 shared text/voice consumer；本轮定点搜索 text-client 未发现 speech-output/AudioContext 播放路径，仅 voice sampler 的采集检查。 | 不能用 desktop 成功代替 web playback，浏览器 resume/autoplay 仍是独立事实。 |
| 独立 service | [plugin host](../../../../packages/companion-runtime/src/plugin-host.ts#L234) 通用 SDK openInput/openOutput 仍 unavailable；[voice providers](../../../../packages/companion-runtime/src/voice-providers.ts#L322) 通过 host-only scoped media 成对 TaskMediaPeer 实现 M4 ASR。 | M4 已提供窄 native authority/media seam；不要全局开放 SDK media/network 或新建 registry/queue。TTS 需要其自身的现有 host composition 接线。 |

当前 shared Pet 没有调用 speech.speak 的新回复路径；旧 MVP 的“语音回复文本提交后播音”说明是历史行为，应以 [当前 Main](../../../../apps/desktop/src/main/index.ts#L366)、[当前 Pet](../../../../apps/desktop/src/renderer/pet/App.tsx#L914) 和 [当前 canonical publish](../../../../packages/companion-runtime/src/runtime.ts#L1039) 为准，不能当成 M5 自动播放已接通。

### 系统 TTS 和媒体预算的实际含义

- [system-tts manifest](../../../../plugins/system-tts/plugin.json#L15) 只支持 win32-x64，声明固定 process worker；[engine](../../../../plugins/system-tts/src/engine.ts#L47) 只容纳一个子进程，非 Windows 明确 unsupported。固定 PowerShell、shell:false、JSON stdin，没有把文本拼进命令行。
- [PowerShell helper](../../../../plugins/system-tts/src/system-speech.ps1#L16) 用 System.Speech 将普通文字完整合成为 **24kHz/mono/PCM16**，最多 2MiB；language 只作输入验证，代码未按 language 自动选择 voice，指定 voice 则按安装名称精确匹配。rate -10..10 是该 Windows 合成器语义，不能直接映射为 MiMo speed。
- [provider](../../../../plugins/system-tts/src/index.ts#L10) 等整段 PCM 完成后，以 65536-byte chunks 通过 `ctx.host.media.openOutput(task)` 发送，再返回真实 media reference。它并非边生成边播。
- [speech contract](../../../../packages/contracts/src/speech-output.ts#L13)：text ≤4000 code points，旧 queue **current+pending 共4**；PCM整段 ≤2097152 bytes；descriptor 支持 8–96kHz、1/2 声道，校验 frames×channels×2。24kHz 是系统 provider 常量，不是所有 provider 必须伪装的采样率。
- [media contract](../../../../packages/contracts/src/media.ts#L14)：chunk ≤256KiB、最多8个未确认、每流缓冲≤2MiB；[TaskMediaPeer](../../../../packages/host-kernel/src/tasks/media-peer.ts#L86) 还限制每 peer 64 streams、同 owner/task 4 streams，绑定真实 signal、序号和 credits，单 consumer，writer.end 等 credit drain。这里的 2MiB 是传输缓冲边界；**整段输出上限**由 speech controller/descriptor 另行累计执行，不应混淆。
- [Main reader](../../../../apps/desktop/src/main/speech-output-controller.ts#L337) 累积整段，检查 provider owner、一个 stream、字节上限；[result 检查](../../../../apps/desktop/src/main/speech-output-controller.ts#L431) 要求 descriptor media 与实际 route 完全相同、精确 byte count。随后 [play](../../../../apps/desktop/src/main/speech-output-controller.ts#L457) 才发送 start/chunks/end。
- [renderer](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L34) 完整 end 后才 resume AudioContext、从 s16le 解码到 Float32/createBuffer/start；未实现编码音频解码、增量 PCM 播放、字词 timing 或 played-prefix。24kHz mono 2MiB 最多约43.69s（单纯字节算式，不是测量）；普通 canonical text 可达8000 UTF-16 units，合法回复不保证能整段装进4000 code points/2MiB。超界应明确拒绝；自动裁剪、拆句/排队、摘要朗读均是额外产品行为，不能偷偷加入。

## Stop、drain、played：已有事实与缺口

| 行为 | 真实证据 | 可声称/不能声称 |
| --- | --- | --- |
| Synthesis task | [run](../../../../apps/desktop/src/main/speech-output-controller.ts#L395) timeout60s；[system engine](../../../../plugins/system-tts/src/engine.ts#L74) abort kill 子进程，Promise 到 child.close 才结算。 | 有取消通道；kill 发出不等于子进程已退出。 |
| Playback task | [play](../../../../apps/desktop/src/main/speech-output-controller.ts#L468) 独立 task，deadline=音频时长+15s；[receipt](../../../../apps/desktop/src/main/speech-output-controller.ts#L538) 只接受当前 playbackId，started 后 playing，ended 要求已 started。 | task 与 synthesis 独立；generated bytes 不是 playing。 |
| Device started/ended | [player](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L108) resume 成功后 source.start 再报 started；onended 报 ended。 | 是 Web Audio 调度/节点生命周期事实，不证明物理扬声器非静音、声音被人听见，未给已播前缀或硬件延迟。 |
| Stop | [cancelCurrent/stop](../../../../apps/desktop/src/main/speech-output-controller.ts#L562) 立刻解绑 current、发 stop、abort/cancel tasks、丢 bytes、清旧 queue/epoch，返回 idle snapshot。 | 能 fence 旧工作；**stop Promise 没有 await task.settled 或 device release ACK**。 |
| Renderer release | [player.stop](../../../../apps/desktop/src/renderer/speech-output/playback.ts#L160) 清 session，source.stop/disconnect，gain.disconnect；AudioContext.close fire-and-forget 且 catch 空。 | 当前旧实现不能表达 stopping/released、close rejection 或延迟 close，也没有停止释放回执。 |
| Task settlement | [TaskSupervisor](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L189) `result` 可先终态，workPending 到实际 work finally 才 false；[cancel](../../../../packages/host-kernel/src/tasks/task-supervisor.ts#L256) 立即 resolve logical result；release 要终态且 !workPending。 | M5 必须 await **actual work + settled**；旧 [track](../../../../apps/desktop/src/main/speech-output-controller.ts#L297) 事后 release 不使 stop 自己成为 drain。 |
| Service source work | [withSourceAuthority](../../../../packages/companion-runtime/src/source-authority.ts#L14) 私下保留 native value/error，supervisor 只传 null，等 result+settled；[M4 disposer](../../../../packages/companion-runtime/src/voice-providers.ts#L212) fence 后 join pending，media finally join pump/native。 | 可直接复用这种 authority/drain 次序，不新增 scheduler。 |

旧 [controller tests](../../../../apps/desktop/src/main/speech-output-controller.test.ts#L144) 覆盖媒体 identity、actual playback receipt 顺序、stop 后晚音频、CAS/disable、queue bounds；[player tests](../../../../apps/desktop/src/renderer/speech-output/playback.test.ts#L61) 用模拟 AudioContext 验证 PCM/sequence/resume-late/failed。它们没有 delayed close/release ACK，也不是本轮真实设备或 Magpie TTS 验收。父研究引用的旧 Windows 原生证明只属于当时平台/版本，不外推 Linux/web/MiMo。

M5 生命周期应先撤销该输出意图并立即停止本地节点，再等待对应 synthesis transport/media/tasks/device 实际清理，才报告 released/允许同资源替换；未知/失败保留真实状态。此处只说明需要的事实，不预定新 DTO 名称。停止播放、停止该次合成、取消 mic/ASR、service foreground stop、selected work stop 继续分离；[M4 contract](../../../spec/backend/shared-voice-input.md#L5) 已禁止 mic-start 顺带停播放/思考/work。断开客户端不应停云 work；断连后的旧音频与晚回调则必须失效。

## Canonical attribution：manual 与 voice-origin auto 的工程差别

[CompanionMessage](../../../../packages/contracts/src/companion.ts#L49) 只有 id/role/text/createdAt/inputId/taskId；[MessageCommand](../../../../packages/contracts/src/companion.ts#L129) 只有 commandId/text，[state validator](../../../../plugins/state-sqlite/src/validation.ts#L101) 拒绝多余字段。不能直接塞 voice:true/source/captureId。

实际 ID 链如下（不同含义不可互换）：

1. [voice dispatch](../../../../plugins/text-client/src/client/voice-input.tsx#L354) 冻结 commandId+text；[web transport](../../../../plugins/text-client/src/client/voice-web.ts#L89) 和普通 typing 共用 [submitIntent](../../../../plugins/text-client/src/client/client.ts#L182)，经相同 text outbox 发送，并未保留 canonical voice 标记。
2. [SQLite acceptMessage](../../../../plugins/state-sqlite/src/state.ts#L359) 产生随机 **user message.id**，其 **user.inputId=commandId**；receipt.messageId=这个 canonical id。
3. [runtime.message](../../../../packages/companion-runtime/src/runtime.ts#L681) 给 Harness 的 accept.id 是 **user message.id**；不是 commandId、captureId 或 clientId。
4. [Harness outputFor](../../../../plugins/harness-cortico/src/harness.mjs#L103) 产生 `inputIds=inputs.map(id)`；[eligible/round](../../../../plugins/harness-cortico/src/harness.mjs#L237) 可以包含多个输入；[onRoundEnd](../../../../plugins/harness-cortico/src/harness.mjs#L328) 只在 Core 接受完整 assistant 文本后 publish。它不是逐 token canonical 输出。
5. [runtime publish](../../../../packages/companion-runtime/src/runtime.ts#L1039) 保存 assistant.inputId=`output.inputIds[0] ?? null`，taskId另存。多输入的其余 IDs 在 canonical projection 丢失。[message event](../../../../plugins/state-sqlite/src/state.ts#L399) 也仅发 messageId/inputId/taskId/role，不含 modality 或完整 attribution。

| 候选激活方式 | 可复用的当前事实 | 新增工程/必须明确的语义 |
| --- | --- | --- |
| 显式朗读选中的 committed assistant message | canonical message.id/role/text 与当前 target，点击就是输出意图。无需推断用户输入 modality。 | 消费方必须捕获 Agent+service/client binding+message，不让任意旧文本/新 target 取代选择；读整段遇预算如何呈现须可见。此动作不写用户消息、不调用 Core 新推理。 |
| 仅本活跃输入 surface 的 voice-origin 自动回复 | 语音 submit 时本地知道 commandId，可用 receipt 或 canonical user.inputId 关联到 user.id，再关联 assistant.inputId；这可做**有界、连接存活期间**的候选关联。 | 现有 voice-submit 返回的是 outcome，成功后清 attempted；需要明确保留到哪一输出消费边界、何时 retire，并解决 reply 比 receipt 早/丢失、snapshot 裁剪、多个回复、typed+voice batch、stop 和重复事件。首 inputId 不足以声称“所有相关语音输入”的完整归因。不能用 ID 前缀/文本相等替代。 |
| 服务级/跨 surface 的 voice-origin 自动回复 | 当前 canonical 无 modality/client output destination。 | 需要在既有 canonical owner/契约中明确 provenance 与输出授权归属，且保持 command 去重/immutable payload；不能新增 parallel transcript store 或广播后让每个 client 自行朗读。这里未选择这项范围。 |
| 所有新 assistant 回复自动说 | 不需要 voice 分类。 | 仍要明确唯一输出目的地、活跃边界、工作完成/notice 是否可播、autoplay、首次加载与 reconnect 基线；普通 snapshot delta 不是自动发声许可。 |

为不扩大 canonical schema，最小工程候选是 **显式朗读已提交 assistant message → 当前明确选择的 surface/device**。若用户更重视说一句就回应的连续感，可选 **voice-origin auto**，但应先界定混合输入与仅 origin-live-surface 的窄语义，或补足既有 canonical attribution；不能先承诺可靠跨客户端 auto 再靠首 inputId 拼凑。

## Magpie/MiMo：已知、未知与可借鉴机制

已定位参考来源：[parent voice-entry](../../11-06-unified-companion-architecture/research/voice-entry.md#L126)、本机 [providers.py](</home/kingBZ/DeepSeek-WorkSpace/astrbot/astrbot_plugin_magpie/providers.py#L244>)、[sync_plan.py](</home/kingBZ/DeepSeek-WorkSpace/astrbot/astrbot_plugin_magpie/sync_plan.py#L51>)，以及公开 AstrBot pinned commit `61335414433db721b3f7ecc93f90deafe0a59d78` 的 [MiMo TTS][tts] / [common][common]；Magpie pinned `12a9970d6ed9dca2943de519f9339923a56d3960` 的 [speech][speech] / [native][native]。本机参考没有运行；公开源码不证明本机部署 exact SHA。

| 事项 | 已核实事实 | 未核实/不得外推 |
| --- | --- | --- |
| 目录角色 | 父研究独立 `dsh-pet-source-research` UA GET `/v1/models?kind=all` 历史200/19 rows，其中 `xiaomi/mimo-v2.5-tts` 和 `xiaomi/mimo-v2.5-tts-voicedesign`；自有身份 rows 当时没有 serves/kind。AstrBot UA 得到的补充 speech 标记是其定制分支。 | 没有本轮新 GET、TTS 权限或声音效果证明；不模仿 AstrBot UA，不依赖它的 discovery switch。 |
| 可借目录 seam | [M4 classifier](../../../../plugins/asr-magpie/src/config.ts#L69) 已有 metadata-first、冲突→unknown、bounded ASR/TTS token 分类；[normalizeAsrCatalog](../../../../plugins/asr-magpie/src/config.ts#L115) 只接受 ASR。 | 可以复用同一事实分类机制，但不能让 ASR provider 开始返回 TTS、把 catalog success 当 synthesis verified；未知 protocol 不可选。 |
| Logical ID → route | [sync_plan](</home/kingBZ/DeepSeek-WorkSpace/astrbot/astrbot_plugin_magpie/sync_plan.py#L87>) 保留 exposed full ID，native wire 剥 vendor，base=`gateway/v1/magpie/native/<encoded vendor>/v1`；common 追加 `/chat/completions`。实例为 `xiaomi/mimo-v2.5-tts` → native/xiaomi/v1/chat/completions，body model=`mimo-v2.5-tts`。 | group MiMo 被参考明确拒绝；voiceclone 需参考音频也被拒绝。不要用标准 speech endpoint 或 full exposed model 冒充 native wire。 |
| 普通 TTS payload | pinned TTS 发送 model/messages/audio；非空 seed_text 作 user content；朗读文字作为 **assistant content**，前置可选 `<style>…</style>`；audio.format（参考wav），普通 TTS 带 voice（参考mimo_default）。 | seed/style/dialect 的效果、支持 voice 列表、风格和语言质量未测。旧 language/rate 字段无已验证 MiMo 映射。 |
| Voice-design | 参考同样是 TTS 请求；name 含 voicedesign 时**不发 audio.voice**，用 seed user 文本描述声音。[sync_plan](</home/kingBZ/DeepSeek-WorkSpace/astrbot/astrbot_plugin_magpie/sync_plan.py#L100>) 为其设中文 seed 描述。 | 未发现“先创建可持久 voice id 再复用”的流程、返回音色管理 API、引用音频或 voice clone；不要命名成这些功能。是否本片纳入 expressive design 是额外范围，catalog存在不等于应默认启用。 |
| Response/codec | pinned `get_audio` await 完整 post/json，读取 `choices[0].message.audio.data`，base64 decode 后按指定扩展名存临时文件；没有 stream:true、音频 delta、词级时间或 PCM descriptor。 | 参考没有校验 WAV subtype/rate/channels/frames，不能照抄成已验证音频。本地网关实际 WAV header、PCM格式、最大时长、畸形响应与大小仍未知。 |
| 标准 speech route | pinned Magpie `/v1/audio/speech` 转发 model/input/voice/format等，流式 copy/flush原始音频或SSE；未给 content-type 默认audio/mpeg。 | 路由存在不代表已验证的 MiMo native 与之相同；不假定返回24kHz PCM。 |
| Native auth/cancel | pinned native 用 request-derived context `NewRequestWithContext`，关 body，保留供应商路径；限制 native 到 API-key provider，拒绝受 model/account/spend 限制的 gateway key，路径不越 provider host。 | 当前本机 patch/账号权限不能仅靠目录确定。HTTP abort/body close 可证明本地 transport 停止/清理，不能证明远端计算或计费已停；未发现 MiMo TTS独立 cancel/status/idempotency API。 |
| AstrBot delegate drain | [providers](</home/kingBZ/DeepSeek-WorkSpace/astrbot/astrbot_plugin_magpie/providers.py#L345>) 计数 active users，retired delegate 等调用结束再 terminate；pinned adapter terminate 仅 `client.aclose()`。 | 是 drain 参考，没有 task signal、每 utterance cancel 回执或 remote-cancel 证明。不要移植第二个 provider lifetime manager。 |

**旧nonstream codec候选（现由最新streaming design替代）：** 明确请求已验证候选的 wav，限制 native response 字节/base64 decoded/container/PCM总预算，严格解码并验证 RIFF/WAVE 的实际 fmt/data/bounds/alignment，得到合法 s16le/实际 sampleRate/channels/frames 后再走现有 media；不支持的编码明确失败。若需要转码/重采样、支持 mp3 或增量播放器，应作为证据不足时的另一个范围，不把它伪装成 descriptor 变化。base64只在 provider-required native codec 内存在；不进入64KiB control JSON/SSE/history或80KiB Main聚合。网络返回 JSON 比 decoded audio 多约4/3及封装，须单独有界，不能套用 M4 ASR 64KiB响应上限，也不能扩大全局 control parser。

### 现有 authority、Key 与取消可复用处

[M4 fixed-purpose native transport](../../../../apps/companion-service/src/voice-client.ts#L23) 已实现 own target、own `asr-api-key` credential lease、独立 UA、redirect:error、bounded JSON reader、deadline/abort、redactor、close join pending+broker drain；[M4 slot](../../../../apps/companion-service/src/voice-controller.ts#L123) 按 provider ref+完整normalized URL/path+authMode绑定 process key，target/auth换则失效、model-only可保留。M5 应复用同一 kernel/config/credential/source-authority机制与目标绑定规则，但 **TTS key不得自动借ASR/text/DSH/AstrBot**，provider Key与service bearer/播放设备权限也独立；确切 key名和API归后续设计，不在此猜。

[M4 provider binding](../../../../packages/companion-runtime/src/voice-providers.ts#L98) 已 fence owner/revision/policy/selection，disposer join原 native calls；[shared desktop retirement](../../../spec/backend/desktop-companion.md#L55) 要求 source/Main drain 后才替换。输出需要接入相同的 captured client/Agent/service epoch/source/provider revision/playback epoch 边界，不能只比 provider generation：同一 owner也可能已换连接。旧 speech controller 没有 companion disconnect listener，不能自动获得此保证。

## 初次候选边界与验收探针（现以最新design为准；均未执行）

最小候选是 ordinary removable output feature + ordinary Magpie synthesis source + 每个选定 surface 的独立 device owner。共享服务计算、客户端播音；手动选择已提交 assistant message，产生声音动作不再向 Core 发 message/推理。不增加 Agent、registry、queue或持久音频库；旧queue=4只描述旧实现，不是新增队列的理由。保留provider/设备/逻辑输出owner三者边界，实时 token 朗读、full duplex、barge-in、echo、lip-sync/played-prefix、voiceclone/持久设计音色均不由这个候选建立。

| 探针 | 后续可证明的验收事实 |
| --- | --- |
| Controlled native peer | 精确 route/bare model/messages/audio；普通 TTS 带voice、design省略voice；完整JSON/base64、有界合法 WAV →真实 PCM描述与 binary media；坏base64/WAV、unknown subtype、奇数字节、rate/channels/frames/size不符都失败且不播。无真实上游调用。 |
| Actual supervisor/media | 使用真实 TaskSupervisor/TaskMediaPeer/permission/config，不只是 mock成功。测credit/sequence/owner/task/reference篡改、consumer/provider撤销、CAS/target变更、response过大/超时；旧bytes被抛弃，敏感值不进入投影。 |
| Gated stop/drain | 故意延迟 fetch/read cancel、media pump、task settled、AudioContext.close和release ACK。立即停止节点/撤 epoch；停止中保持stopping/unknown，实际清理后才released/替换，失败不静默成功。远端计算取消另列未知。 |
| Message/target identity | manual点击固定message/target；回复早于receipt、HTTP丢失、snapshot被裁剪、同一message重投事件不重复播；target A→B、断线重连/进程重启不播旧音频；同provider owner的新connection不能接收旧结果。 |
| Auto专项（仅若选） | typed、voice、review后修改、二者交错/同round多inputIds、多个assistant回复、work completion/notice；验证所选归因规则与唯一destination，另一个client不跟读，重连不补播。不能仅以“首inputId碰巧匹配”验收跨input来源语义。 |
| Web/Electron实际消费 | 点真实control，验证AudioContext.resume/blocked/failed/started/ended、Pet唯一owner、web单owner、source.stop与close实际settle，navigation不创建第二player。控制浏览器设备路径不等于物理人耳听见；浏览器autoplay拒绝必须可见。 |
| Core/work/ASR隔离 | 合成与播放过程中继续输入、ASR、长期work；stop音频不触发foreground/work/mic stop，work身份与单次effect保持。反向service stop的音频策略仅按冻结需求断言；不改M4 mic-start。 |
| 分层验收记录 | focused/root checks、生产Main/preload/web/device-path受控探针、独立服务/Core/Docker连续性；真实Magpie TTS请求与物理播音需另行明确授权范围，分别记录模型/格式/平台，不能用本报告或fixture声称passed/latency/full-duplex。 |

## 产品决策已关闭

最初研究的manual/voice-origin/全部新回复、目的地与长回复覆盖问题已由 [PRD O7/O8/O9](../prd.md#L25) 关闭：启用真实optional插件后，每条committed正式assistant自动播报，仅Pet出声，长正式回复也按原文/顺序完整处理。无需再问这三项或补input modality。修订只将必要技术选择落入design/implement：普通固定voice的真PCM streaming、有限canonical文本segments、端到端背压/独立watchdog、whole fence与真实stream/device drain；Parent整合PRD/contexts与最新最终summary，未获后续明确批准不实施。

[tts]: https://raw.githubusercontent.com/AstrBotDevs/AstrBot/61335414433db721b3f7ecc93f90deafe0a59d78/astrbot/core/provider/sources/mimo_tts_api_source.py
[common]: https://raw.githubusercontent.com/AstrBotDevs/AstrBot/61335414433db721b3f7ecc93f90deafe0a59d78/astrbot/core/provider/sources/mimo_api_common.py
[speech]: https://raw.githubusercontent.com/yetone/magpie/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/speech.go
[native]: https://raw.githubusercontent.com/yetone/magpie/12a9970d6ed9dca2943de519f9339923a56d3960/internal/gateway/native.go

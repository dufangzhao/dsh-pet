# 共享语音输出：桌面自动朗读的前端/UX 现状与候选

只读研究，2026-11-11（第五版，用户决定 O7/R23/O8/O9 之后）。未改产品代码、未构建、未安装、未开浏览器/设备、未调真实模型。需求见[子 PRD](../prd.md)（O7/O8/O9）与 [R23](../../../../11-06-unified-companion-architecture/prd.md#L35)；provider/协议归 GPT，当前 MiMo 官方证据见 [mimo-tts-current.md](mimo-tts-current.md)。本文只回答**界面现在有什么、自动朗读接在哪、哪些状态必须可见**。不新造 DTO。

## 版本说明：四轮决定都已收敛；本版只做事实修正

- 第一版建议"先做手动朗读"，已被 O7 覆盖。
- 第二版把"多端目的地"列为待拍板，已被 **O8 覆盖**：首版只让桌面桌宠出声。
- 第三版把">4000 / 整段 2MiB 明确拒绝"当成首片产品限制，已被 **O9 覆盖**。
- 第四版把"必须先切 part 才能读长回复"写得太硬，本版按官方文档修正：ordinary MiMo 已支持**真低延迟 streaming**（24kHz PCM16LE mono），所以"整段合成完才播"**不是首片产品硬规则**，"必须分段"也不是。底层走流式还是文本 part 由 GPT 定，UX 对两者提同样要求。

## 结论

**自动朗读的触发条件今天就能精确判定，不需要新字段：每条已提交的 `role='assistant'` 消息。** 思考与 delta 从不成为消息；工具回执与任务结果落成 `role='notice'`。O7 的排除清单是**结构上已满足**的。

**首版唯一的产品缺口不是"要不要自动"，而是"启用"必须是真的插件启停**，不是把旧的试听开关改个标签。现有 `speechEnabled` 是配置布尔、默认 `true`，provider 恒被 admit——它**冒充不了**插件生命周期。这条归 GPT 设计接口，本文只记录界面必须反映的事实。

**默认 off 应作为 final review 建议**：新的自动能力不能继承旧的"默认 true 试听"状态，否则升级即自动出声。

**O9 改变了一处既有事实的定位**：今天的播放器是**整段缓冲**（`new Uint8Array(session.bytes)` → 单个 `AudioBuffer`，[playback.ts:114-122](../../../../../../apps/desktop/src/renderer/speech-output/playback.ts#L114-L122)），`SPEECH_OUTPUT_MAX_BYTES` 直接等于 2 MiB 流上限（[speech-output.ts:16](../../../../../../packages/contracts/src/speech-output.ts#L16)）。这**不是**产品规则，而是**当前实现的物理上限**。O9 要求长回复完整朗读，所以"超长就拒绝"必须从产品行为里删掉。

**而且"整段合成完才开始播"同样不是首片产品硬规则。** 官方文档（2026-07-15/17）已明确 ordinary `mimo-v2.5-tts` 支持真低延迟 streaming：`stream:true` + `audio.format:pcm16`，SSE 里 base64 音频，输出为 **24kHz PCM16LE mono**，见 [MiMo TTS 证据](mimo-tts-current.md#L12-L13)。这与本仓契约恰好对得上——`SPEECH_OUTPUT_SAMPLE_RATE = 24000`（[speech-output.ts:15](../../../../../../packages/contracts/src/speech-output.ts#L15)），descriptor 收 `pcm-s16le`、8000–96000Hz、mono/stereo（[speech-output.ts:146-149](../../../../../../packages/contracts/src/speech-output.ts#L146-L149)）。所以首片**不必**先假设"整段合成完才播"，也**不必**为了长回复先去切 part。

## 一、现有事实（源码可查）

| 事项 | 现状 | 含义 |
| --- | --- | --- |
| 合成入口 | `speak({text, utteranceId})`，[speech-output.ts:121](../../../../../../packages/contracts/src/speech-output.ts#L121) | 不绑定 message id，`utteranceId` 自由（≤128），**无幂等语义** |
| 唯一调用点 | 设置台试听，[use-speech-output.ts:247](../../../../../../apps/desktop/src/renderer/console/minimal-ui/use-speech-output.ts#L247) | 产品内**没有**"回复→朗读"接线 |
| 控制器视野 | `SpeechOutputController` 不 import companion/snapshot | 它**看不到回复**；自动触发必须由 Main 侧喂入 |
| 播放器 | `SpeechOutputPlaybackOwner` 只在桌宠根挂一次，[App.tsx:914](../../../../../../apps/desktop/src/renderer/pet/App.tsx#L914) | 桌宠是唯一 owner；控制台不挂播放器（符合 O5） |
| 音频投递 | 字节只发桌宠窗口，[index.ts:366-372](../../../../../../apps/desktop/src/main/index.ts#L366-L372)；`changed` 才广播两窗 | 控制台能看状态、收不到字节 |
| 两窗同一 preload | console 与 pet 都用同一个 `preload`，[index.ts:85-87](../../../../../../apps/desktop/src/main/index.ts#L85-L87)、[index.ts:475-476](../../../../../../apps/desktop/src/main/index.ts#L475-L476) | 控制台**有** `petSpeechOutput`；但见第四节对 Web 的纠正 |
| 现有开关 | `speechEnabled` 在 profile Config，默认 **true**，[application.ts:43](../../../../../../packages/contracts/src/application.ts#L43)；Config 存**本机**（[file-store.ts:22-31](../../../../../../packages/host-kernel/src/config/file-store.ts#L22-L31)） | 是**配置布尔**，不是插件生命周期；默认开 |
| 插件是否可选 | speech provider 恒在 `localRoles` 内被 admit，[index.ts:190](../../../../../../apps/desktop/src/main/index.ts#L190) | 今天没有"语音输出插件级启停"，只有设置开关 |
| 真插件启停 | `PluginManager.enable/disable`，[plugin-manager.ts:253](../../../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L253)、[:425](../../../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L425)；`disable` 走 `stop()` → `deactivating` → `disabled`，卸载 capabilities | 生命周期**已存在**，可直接承载 O8 的"真插件"；`desiredActive` 是它自己的持久状态 |
| 控制台插件入口 | 插件页已有启用/停用与重试，[plugins.tsx:163-175](../../../../../../apps/desktop/src/renderer/console/pages/plugins.tsx#L163-L175)；动作经 `runPluginAction` | **现成入口**，不需要新页面 |
| 关闭的副作用 | `!soundEnabled \|\| !speechEnabled` → `speech.stop()`，[index.ts:291](../../../../../../apps/desktop/src/main/index.ts#L291) | 停播放，**不碰** Core/任务 |
| 播放态 | `phase: idle\|synthesizing\|playing\|error`，[speech-output.ts:90](../../../../../../packages/contracts/src/speech-output.ts#L90) | **没有 `stopping` 阶段**；`stopNow` 直接置 `idle`（[speech-output-controller.ts:576-581](../../../../../../apps/desktop/src/main/speech-output-controller.ts#L576-L581)） |
| 桌宠可见性 | `PET_STATES` 无 `speaking`，[pet-prototype.ts:12](../../../../../../packages/contracts/src/pet-prototype.ts#L12)；`petStateOf` 不读语音快照 | 播放时角色仍 `replying`/`idle`，嘴不动 |
| 停止入口 | 桌宠菜单"停止"=`stopForeground`，[App.tsx:854](../../../../../../apps/desktop/src/renderer/pet/App.tsx#L854)，仅 `agent.status==='busy'` 出现 | 朗读中它不出现，停不了播放 |
| 托盘 | "停止本地播放"=`speech.stop()`，[index.ts:489-497](../../../../../../apps/desktop/src/main/index.ts#L489-L497) | 桌宠外唯一停播放入口 |
| 控制台停止 | 声音卡片"停止播放"，[speech-settings.tsx:280-289](../../../../../../apps/desktop/src/renderer/console/minimal-ui/speech-settings.tsx#L280-L289) | 已有，在"人格 → 声音" |
| 服务端音频 | service/server 中 speech 出现 **0 次** | 无服务端音频路由，无播放端登记 |
| 文本上限 | `SPEECH_OUTPUT_MAX_TEXT=4000`；旧 speech 层将 `MEDIA_MAX_STREAM_BYTES` 借用为整段音频上限，[speech-output.ts:13-16](../../../../../../packages/contracts/src/speech-output.ts#L13-L16) | Kernel 的2MiB流缓冲与旧 speech 的2MiB整段限制是两个事实。后者需要为O9拆开，不能据相同数值推断底层总流容量，也不能谎称旧播放器已经不限整段大小。 |
| 播放缓冲 | 整段收齐后一次性建 `AudioBuffer`，[playback.ts:114-122](../../../../../../apps/desktop/src/renderer/speech-output/playback.ts#L114-L122) | 这是**当前实现**的形态，不是首片产品规则；官方 MiMo 已支持 24kHz PCM16 流式，改为边收边播是技术选择，**尚未实现** |
| 队列 | 4 槽，超限 `quota-exceeded`，[speech-output-controller.ts:240](../../../../../../apps/desktop/src/main/speech-output-controller.ts#L240) | 已有唯一队列，不要再建 |
| 格式 | 只收 `pcm-s16le`，8000–96000Hz | Magpie 实际输出格式未知 |
| 现有 provider | `pet.builtin-speech`(音调)、`pet.system-tts`(Windows) | `providers()` 不过滤状态，Linux 上仍列出但 `active:false`；**Magpie TTS provider 不存在** |
| 播放证据 | `playing` 需 `reportPlayback('started')`，[speech-output-controller.ts:549-560](../../../../../../apps/desktop/src/main/speech-output-controller.ts#L549-L560) | `started` 只证明缓冲开始，不证明可闻 |
| 设置副作用 | `saveSettings` 调 `stopNow()`，[speech-output-controller.ts:609](../../../../../../apps/desktop/src/main/speech-output-controller.ts#L609) | 调音量/换声会掐掉当前朗读 |

## 二、"最终正式回复"如何判定（保留证据）

O7 要求只读最终正式回复。**今天不需要新字段，也不需要文本启发式：**

1. **思考与 delta 从不成为消息。** harness output tap 明确 `externalizes: () => false`，注释写着"token events are not presented to a client"，[harness.mjs:330-331](../../../../../../plugins/harness-cortico/src/harness.mjs#L330-L331)。流式 token 不进历史，"朗读 draft"结构上不可能。
2. **正式回复只有一条落库路径：`role:'assistant'`。** `publish` → [runtime.ts:1045](../../../../../../packages/companion-runtime/src/runtime.ts#L1045)。两个来源都算正式回复：模型 `onRoundEnd` 的 `round.text`（[harness.mjs:332-337](../../../../../../plugins/harness-cortico/src/harness.mjs#L332-L337)）与 `say` 工具的 `args.text`（[harness.mjs:183-185](../../../../../../plugins/harness-cortico/src/harness.mjs#L183-L185)）。两者互斥：输出含 `function_call` 时 `round.text` 不设置，[harness.mjs:245](../../../../../../plugins/harness-cortico/src/harness.mjs#L245)。
3. **notice 是分开的 role。** `admission-*`（[runtime.ts:711-716](../../../../../../packages/companion-runtime/src/runtime.ts#L711-L716)）、`work-result-*`（[runtime.ts:873-877](../../../../../../packages/companion-runtime/src/runtime.ts#L873-L877)）。任务 stdout/stderr 在 `CompanionTask` 字段，从不是 assistant。
4. **结论**：过滤条件就是 `role === 'assistant'`。`say` 的文本是**正式回答**，不是"原始 tool 材料"；`start_work`/`list_work` 的回执才是原始材料且不进 assistant。

三个必须处理的边界：

- **一轮可能有多条正式回复。** `rounds` 是 soft 8/hard 12，[harness.mjs:326](../../../../../../plugins/harness-cortico/src/harness.mjs#L326)，且 `say` 无"每轮一次"守卫。触发单位是**每条已提交的 assistant 消息**，不是"每轮一条"——O7 已明确不许把多条折叠成猜的"最后一条"。
- **事件不带正文。** SSE message 事件只有 `{messageId, inputId, taskId, role}`，[state.ts:399-408](../../../../../../plugins/state-sqlite/src/state.ts#L399-L408)；必须回读快照才有 text。
- **刷新是合并的。** Main 以 120ms 合并，[companion-client-controller.ts:567-573](../../../../../../apps/desktop/src/main/companion-client-controller.ts#L567-L573)，一次快照可能带来多条新回复。必须按游标逐条判定。

**推论**：自动触发必须由 **Main 侧**判定"新增了哪些 assistant 消息"，再喂给 `SpeechOutputController`；渲染层比 UI 差异会因卸载/隐藏/重连而漏或重复。

## 三、真实插件启停 vs 设置布尔（O8 的核心要求）

O8 要求"真 source + 生命周期启停"，并明确旧默认 true 不能当授权。三者关系必须分清：

| 机制 | 今天有什么 | 能否冒充 O8 的启用 |
| --- | --- | --- |
| 设置布尔 `speechEnabled` | profile Config 字段，默认 true | **不能**。它只是偏好，provider 照样被 admit，插件仍在跑 |
| 插件生命周期 | `enable/disable` + `desiredActive`，[plugin-manager.ts:253](../../../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L253)/[:425](../../../../../../packages/host-kernel/src/runtime/plugin-manager.ts#L425) | **这才是** O8 要的：`disable` 会 `deactivating → disabled` 并卸载 capability |
| 试听开关 | 同一 `speechEnabled` 驱动试听按钮 | 旧语义；升级后不能自动变成"自动朗读已开" |

界面含义（不新增页面）：

- **入口用既有的**：插件页的启用/停用（[plugins.tsx:163](../../../../../../apps/desktop/src/renderer/console/pages/plugins.tsx#L163)）就是真启停，已有 busy/失败/重试处理；"人格 → 声音"卡片继续承担音色/音量配置。
- **两处必须说清不同**：插件页显示"已停用"，声音卡片里的试听/配置就该说明"语音输出插件已停用，无法试听"，而不是把设置项置灰了事。
- **默认 off**：新能力首次出现时 `desiredActive=false`。旧 `speechEnabled=true` 只保留给"这台机器是否允许出声"的偏好，**不得**在升级后触发自动朗读。两者不要共用同一默认值。
- **禁用即围栏**：`disable` 后不得合成、不得播放、迟到音频丢弃；`stop()` 已做清队列+停当前+围栏（`epoch++`）。

## 四、三处必须纠正的事实

**纠正 1：端 = 桌面应用（Pet + 控制台），不是每个窗口。**
Parent 的"各客户端独立"指桌面应用整体，不是"每窗口一个端"。上一版把单机两窗写成"双响"是错的：O5/O8 明确**只有桌宠一个 owner**，控制台不挂播放器，所以同一台机器**不会**双响。上一版那句"独立每端在单机上直接双响"作废。

**纠正 2：独立 Web 不注入 Electron preload，所以不能说 Web 已有桥。**
`petSpeechOutput` 由 desktop preload 注入；Web 由服务提供，加载的是 `client.js`（[server.ts:271-275](../../../../../../apps/companion-service/src/server.ts#L271-L275)），**没有任何 Electron preload**，`plugins/text-client` 里也搜不到 `petSpeechOutput`。上一版说"控制台已有桥所以 Web 也有"是混用——**控制台有桥不等于 Web 有桥**。本片段 Web 保持纯文字，符合 O5/S5。

**纠正 3：隐藏桌宠当前仍会继续播放，不能写"隐藏就无声"。**
`syncPet` 只 `hide()`（[index.ts:144-146](../../../../../../apps/desktop/src/main/index.ts#L144-L146)），不销毁窗口；`backgroundThrottling:false`（[pet-window.ts:169](../../../../../../apps/desktop/src/main/windows/pet-window.ts#L169)）；`SpeechPlaybackOwner` 不看 `visibilityState`（播放器里 0 处引用）。所以**隐藏状态下音频照常播**。上一版"关掉或隐藏就没有声音"是错的。

三种情形要分开，不能合成一句"无声"：

| 情形 | 今天实际发生 | 首版建议 |
| --- | --- | --- |
| **hide**（`visible=false`） | 窗口还在、渲染器活着、**继续播放** | 允许继续播（用户只是不想看见角色）；界面别声称"已静音" |
| **实际 close / 窗口销毁** | `dispose()` → `window.destroy()`（[pet-window.ts:466-478](../../../../../../apps/desktop/src/main/windows/pet-window.ts#L466-L478)）；渲染器没了，音频无接收方 | 播放自然终止；**不要**把它报成"播放失败"，那是设备端消失 |
| **禁用插件** | `disable` → capability 卸载 | 必须主动停合成/播放并围栏；这是唯一的"用户意图静音" |

## 五、启用/关闭、停止播放、停止工作：四件事不能合并

| 动作 | 现状 | 真实影响 | 之后下一条回复 |
| --- | --- | --- | --- |
| 禁用插件 | `PluginManager.disable` | 停合成+停播放+围栏 | **不再播** |
| 关闭音效/偏好 | `speechEnabled=false` → `stop()` | 停当前、清队列 | 不播（偏好关） |
| 停播放 | 托盘 / 声音卡片 / 未来行内 | 停当前、清队列；`phase` 直接 `idle` | **仍会播**（插件仍启用） |
| 停前台回合 | 桌宠菜单"停止"=`stopForeground` | 只打断回合，不释放音频 | 与音频无关 |
| 停后台任务 | 对话页任务行，按 taskId | 只停这一条 | 无关 |

**"停播放"与"禁用插件"的差别在自动策略下变得可感知**：停播放后下一条还会响，禁用则不会。两个按钮必须分开，文案要说出这个差别——否则用户会反复点"停止"却仍被朗读。

## 六、长回复：一条消息 = 一个朗读意图（O9）

**产品规则（用户已定）**：长回复也要完整朗读；保留完整原文与顺序；**不截断、不摘要、不换说法**。一条正式回复始终是**一个逻辑朗读意图 / 一个 FIFO 条目**。

**底层怎么实现不是产品规则，UX 不预设。** 官方 MiMo 文档（2026-07-15/17）已确认 ordinary `mimo-v2.5-tts` 支持真低延迟 streaming（`stream:true`、`audio.format:pcm16`、24kHz PCM16LE mono），见 [MiMo TTS 证据](mimo-tts-current.md#L12-L13)。所以"整段合成完才开始播"只是**当前播放器**的形态（[playback.ts:114-122](../../../../../../apps/desktop/src/renderer/speech-output/playback.ts#L114-L122)），**不是首片产品硬规则**；"必须先把文本切成 part"也不是。

两种底层路径都能满足 O9，UX 对两者提出同样的要求：

| 路径 | 今天 | 对本 UX 的影响 |
| --- | --- | --- |
| 流式合成/边收边播 | 契约已收 24kHz `pcm-s16le`（[speech-output.ts:15](../../../../../../packages/contracts/src/speech-output.ts#L15)/[:146-149](../../../../../../packages/contracts/src/speech-output.ts#L146-L149)），但播放器仍整段缓冲 | 首字节更早，**"准备"阶段会变短**；仍要有准备/朗读/停止/未完成四类可见事实 |
| 有界文本 part 顺序合成 | 未实现 | 准备/朗读可能在一条回复内反复切换，但**UI 仍只显示"这一条"**，不暴露 part |

必须保持的语义（写成行为契约，不写 DTO，也不指定底层）：

| 关注点 | 要求 | 理由 |
| --- | --- | --- |
| 意图单位 | 一条消息一个逻辑意图；队列**按消息计数**，不按 part、不按 chunk | 否则 4 槽队列会被一条长回复吃光，后续短回复全被拒 |
| 顺序与完整性 | 按原文顺序播完全部内容；不跳段、不去重、不重排、不改写 | O9 要求保留完整原文与顺序 |
| 正文不变 | 只朗读 canonical 文本本身；**不得**启用会改写文本的选项 | voicedesign 的 `optimize_text_preview` 默认 false，**绝不为 O9 打开**；它会把广播文本重写/生成，直接违反"不换说法" |
| 峰值内存 | 常驻音频有界，播完即释放 | 2 MiB 是**流缓冲**上限，不是整条回复的允许体积 |
| 停止 | 停当前正在播的，**并阻止所有尚未开始的部分**；不留半条 | 停止必须作用在"整条回复"这一层 |
| 失败 | 中途失败 → **本条标记未完成**，不继续跳段、不声称读完 | 最容易被做错的一条 |
| 完成判定 | provider自然完成是必要条件；还要完整接收音频、实际播放到尾端并确认释放，才可报本条播放完成 | `finish_reason:stop` 只证明正常生成结束；`length`/`content_filter`、播放失败或资源未释放均不等于完整播放，也不证明用户实际听见 |
| 重试 | 失败不自动重新合成；是否重试由用户显式动作 | 避免付费重复合成与重复出声 |
| 后续消息 | 本条失败不影响下一条新正式消息按开关正常朗读 | 失败是局部的，不是全局熔断 |

**UI 不暴露内部管线**：不显示 requestId、segment/part 编号、chunk、"第 2/5 段"这类实现细节。用户看到的是**一条回复**的 准备 → 朗读 → 停止/已释放 → 未完成/失败。若显示进度，只能以"整条回复"为单位。

**音色与流式的边界**：ordinary TTS 用预置音色，`mimo_default` 依 provider/集群而定——**一次朗读应冻结一个明确选定的音色**，不能在播放中途漂移。voicedesign/clone 目前的"流式"只是**生成完一次性返回的兼容结果**，不能当低延迟流式承诺。

**未实现/未验证**（必须在实施 review 里明确标注，归 GPT 核）：
- Magpie native 路由对 SSE/刷新/取消的**透传**是否可用——正在核，**未验证**。
- 实际音频 chunk、格式与时序——**文档能力不等于本地推理或播放证据**，需单独授权的短实测。
- 若最终选文本 part：分段点规则（不切坏 Unicode/代理对）、按消息计数的队列共存、失败事实的表达、总时长/总字节/并发上限——**全部未定**。
- 流式的首字节/idle/总时长 deadline 与消费者背压如何区分——**未定**。
- 不确定请求后**不得**静默回退到非流式或重新合成——需明确策略。

## 七、可见状态（现有事实与必须补齐的契约分开）

| 状态 | 依据 | 界面 |
| --- | --- | --- |
| 插件已停用 | `desiredActive=false` / `state='disabled'` | 声音卡片说明"语音输出插件已停用"，试听不可用；不假装是配置问题 |
| 不可用 | 无可选 provider（或全部 `active:false`）/ 偏好关 | 禁用 + 真实原因 + 去插件页 |
| 排队 | `queued > 0` 且非本条 | "已排队" |
| 合成中 | `phase==='synthesizing'` | "正在准备声音" |
| 播放中 | `phase==='playing'` 且 `current.utteranceId===本条` | "播放中" + 停止 |
| 停止/已释放 | 旧idle/空current不足以证明释放；新契约须来自实际task/media/player清理确认 | 释放未确认时不报idle成功；释放确认也不等于正文播放完整 |
| 失败 | `phase==='error'` + `reason` | 复用 6 类原因文案（[speech-settings.tsx:15-22](../../../../../../apps/desktop/src/renderer/console/minimal-ui/speech-settings.tsx#L15-L22)），可重试；文字保留 |
| 长回复未完成 | **契约暂无此事实** | 如实说"这条没有读完"；资源可以已经释放，但不能把释放当作整条播放完成，两种事实分别表达 |

**没有 `stopping` 播放阶段**——契约只有四态（[speech-output.ts:90](../../../../../../packages/contracts/src/speech-output.ts#L90)），`stopNow` 直接置 `idle`。所以不能把"正在停止播放"当成一个会持续存在的生命周期状态来展示。区别要分清：声音卡片里的 `form.stopping` 只是**这次 stop 请求在途**的按钮 busy 标记（[speech-settings.tsx:284](../../../../../../apps/desktop/src/renderer/console/minimal-ui/speech-settings.tsx#L284)），请求返回即结束；它不等于"音频正在释放"。若确实需要跨请求的"正在释放音频"状态，须由 GPT 增补并给出证据——**UI 不能自己编一个契约里没有的阶段**。

两条诚实线：`started` 不等于"用户听见了"（静音、无输出设备、窗口隐藏都可能无声），所以不给消息加"已朗读"标记、不写历史；`lastUtterance` 在 `speak()` 入口就写入（[speech-output-controller.ts:225](../../../../../../apps/desktop/src/main/speech-output-controller.ts#L225)），早于开关/provider 检查，**不是播放证据**。

## 八、UI 只承诺可验证的东西（音色/音量）

契约里真实存在、可验证的是 `voice`（自由字符串，≤256）与 `volume`（0–100），[speech-output.ts:37-39](../../../../../../packages/contracts/src/speech-output.ts#L37-L39)；`volume` 在播放器里直接映射为 `gain`（[playback.ts:134](../../../../../../apps/desktop/src/renderer/speech-output/playback.ts#L134)），是真实生效的。

**`rate` 不要做伪映射。** 旧 Windows 系统朗读把 `rate`(-10..10) 直接赋给 SAPI 的 `Rate`（[system-speech.ps1:23](../../../../../../plugins/system-tts/src/system-speech.ps1#L23)），那是 SAPI 自己的标度；Magpie 的 TTS 未必有等价参数，语义也不同。**首版不要声称"语速可调"**，除非 provider 真的支持并验证过。要么隐藏该项，要么标明"仅对当前 provider 有效"——不要把一个旧 provider 的标度当成产品能力。

**官方文档里的"自然语言 style 控制"不等于数字 `rate` 已支持。** MiMo 文档提到可用可选的 user content 提供 style/context（那段内容本身不被朗读），也提到 `finish_reason` 与 `optimize_text_preview` 等；这些**都不是**本仓 `rate: -10..10` 的语义。不能因为文档有"风格"字样就推断数字语速可用，也不能把 style 文本塞进正文（那会违反"不改写"）。两者若要做，都是独立的新能力，不在本片段。

同理，"音色"应说成"**provider 支持的音色标识**"，不是"任意音色可切换"；ordinary TTS 用预置音色，`mimo_default` 依 provider/集群而定，**一次朗读要冻结一个明确选定的音色**。

## 九、M4 复用：只复用位置，不合并保存域

- **输入设置是 ASR 专属**：`VoiceSettings` 字段是"结束方式 / 转写提供者 / 网关地址 / 转写模型 / 目录 / 鉴权 / 密钥"，[voice-settings.tsx:302-505](../../../../../../plugins/text-client/src/client/voice-settings.tsx#L302-L505)，**没有一个输出字段**。
- **输出设置是另一套**：`speechProvider/speechVoice/speechRate/speechVolume` 在 profile 里，经 `saveSettings` 走自己的 CAS。
- **不要把 TTS 塞进 `VoiceSettings` 弹窗**：会让"保存语音设置"同时改输入与输出，破坏 M4 已验证的独立草稿/CAS。
- **位置可复用**：`VoiceInput` 与输入框并排（[conversation.tsx:346](../../../../../../apps/desktop/src/renderer/console/pages/conversation.tsx#L346)）、消息列表在上方；行内播放态/停止放这里不需要新布局。
- 输入在"开始 → 语音输入"弹窗（[start.tsx:60](../../../../../../apps/desktop/src/renderer/console/pages/start.tsx#L60)），输出在"人格 → 声音"卡片（[persona.tsx:251](../../../../../../apps/desktop/src/renderer/console/pages/persona.tsx#L251)）；这个不对称不必在本片段修复。

## 十、最小验收

1. 插件启用后，一条新的正式回复（`say` 或 `onRoundEnd`）在桌宠窗口自动出声；声音卡片与桌宠同时显示播放中（同一份快照）。
2. **不朗读**：思考/流式 token、notice（`admission-*`、`work-result-*`）、任务 stdout/stderr、工具回执。
3. 一轮两条正式回复 = 两次朗读，各自可停；不拼接、不遗漏。
4. 重连、刷新、翻历史、重新启用都**不补播**；只有基线之后新提交的回复才响。
5. **真插件启停**：插件页停用后不再合成/播放，声音卡片说明是"插件已停用"而非配置错误；重新启用需显式动作。
6. **默认 off**：升级后旧的 `speechEnabled=true` 不触发自动朗读。
7. 停播放但插件仍启用：下一条回复**仍会**朗读——两个动作可区分且文案说清。
8. **隐藏桌宠**：音频继续（不谎称静音）；**窗口真正销毁**：播放自然终止，不报"播放失败"。
9. 失败诚实：provider 停用/合成失败/播放失败显示对应原因，不换声线、不报成功、文字保留。
10. 草稿与语音预览不被读、写、提交；队列满（4 槽）说明"这一条没排上"，不静默丢弃。
11. 不出现契约里没有的"正在停止"状态；不承诺未经 provider 验证的语速。
12. 控制台不创建第二个播放器；Web 保持纯文字（无 TTS 播放）。
13. **长回复完整朗读（O9）**：超过旧 4000 字 / 2 MiB 的正式回复仍完整播出，覆盖原文全部字符且顺序一致；**不截断、不摘要、不改写**。
14. **一条消息一个意图**：长回复只占**一个**队列位，后续短回复不会被它挤掉；UI 不出现分段编号、chunk 或 requestId。
15. **整条停止**：朗读长回复中途停止，当前正在播的与所有尚未开始的内容都不再出声；不留半条继续播。
16. **中途失败诚实**：中途失败时本条显示"未完成"，**不跳段、不声称读完**；失败不自动重合成；下一条新正式消息仍按开关正常朗读。
17. **完成判定**：provider正常生成、完整接收、播放到尾端与实际释放分别有证据；`length`/`content_filter`、失败或未释放都不得显示整条播放完成，更不能推断用户听见。
18. **不预设底层**：无论流式还是文本 part，用户看到的都只是"这一条"的准备/朗读/停止/未完成；不因底层变化而改文案或暴露结构。

> 第 13–18 条目前**全部未实现**，底层走流式还是文本 part 由 GPT 技术设计定（两者都可满足）。它们描述目标行为，不是既有能力。第 13 条替换了上一版"超长回复明确拒绝"的验收——那条已被 O9 覆盖。

## 十一、技术 handoff（简短，归 GPT）

- **H1 触发方**：`SpeechOutputController` 看不到回复；需 Main 侧按游标判定新增 `role='assistant'` 消息后调用 `speak`，以 message id 作幂等键。
- **H2 真插件 source**：需要一个可 `enable/disable` 的语音输出 source（不是设置布尔）；`disable` 必须释放合成/播放并围栏。是否复用现有 `pet.system-tts` 形态或新建 Magpie source，归 GPT。
- **H3 Magpie 编码**：官方 ordinary MiMo 文档确认 streaming 输出为 **24kHz PCM16LE mono**（`stream:true`、`audio.format:pcm16`、SSE base64），与本仓 `SPEECH_OUTPUT_SAMPLE_RATE=24000`、`pcm-s16le`、8000–96000Hz 契约相容（[MiMo 证据](mimo-tts-current.md#L12-L13)）。仍需核：Magpie native 是否透传 SSE/刷新/取消；voicedesign/clone 的"流式"只是生成完一次性返回，**不能**当低延迟流式。非 PCM 情况仍需 provider 内有界解码；平台不能再 `win32-x64` 独占。
- **H4 停止阶段**：契约只有四态，无持续性的"正在停止/正在释放"。请求在途的 busy 标记不构成生命周期状态；若确需跨请求的释放态，须由 GPT 增补并给出证据。
- **H5 长回复（O9，归 GPT）**：官方 ordinary MiMo 已支持 `stream:true` + `audio.format:pcm16`（24kHz PCM16LE mono，[MiMo 证据](mimo-tts-current.md#L12-L13)），本仓契约恰好是 24kHz `pcm-s16le`（`speech-output.ts:15`/`:146-149`）。所以**优先核流式透传**，而不是默认"切 part"或"整段 WAV"。仍需 GPT 确认：Magpie native 路由对 SSE/刷新/取消的透传、首字节/idle/总时长 deadline 与背压的区分、有界帧/总生成量、以及"整条停止"在流式下的实现。若最终选文本 part，则另需分段点规则（不切坏 Unicode）、按消息计数的队列共存、"未完成"事实的表达。旧speech层的4000文本/2MiB整段限制需按O9调整；Kernel的2MiB流缓冲仍单独保留，不可把两者混成同一限制。
- **H6 参数诚实**：`voice`/`volume` 可承诺；`rate` 不得把旧 SAPI 标度当通用能力。

## 十二、非目标

不新增页面、路由、设计体系或通用队列（O9 的 part 是**一条消息内部**的分段，不是新的通用队列或第二播放器）；不做 Web 播放、跨设备目的地选择（O8）；音频不走控制 JSON/历史；不把 full-duplex、barge-in、未经实测的低延迟指标或口型同步当成本次已承诺；流式PCM属于待定技术实现，不是已经跑通的能力；不重开 Magpie/local/cloud；不在规划阶段跑真实 TTS 或设备测试。

## 十三、冻结

以上为 UX 证据与候选，不构成实施批准。默认 off 作为 final review 建议。

**尚未实现/未验证，须在实施 review 中逐项确认**：长回复完整朗读（O9 全部行为，底层走流式还是文本 part 未定）、`role='assistant'` 触发接线、真插件 source 启停、Magpie native 对 MiMo streaming 的透传与实际 chunk/格式/时序、中途失败的"本条未完成"事实、契约缺失的释放态。文档能力不等于本地推理或播放证据。本文不含 DTO 与实现方案，待 GPT 技术设计定稿后进实施 review。

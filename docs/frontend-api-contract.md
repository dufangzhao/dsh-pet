# 设置前端与后端契约映射

本文是设置预览与插件贡献页面的统一接入说明：现有调用以当前工作区源码为准，新增需求标为“待开发”。
当前 [HTML 预览](../qa/minimal-settings-preview/index.html) 与 [本地交互](../qa/minimal-settings-preview/preview.js) 尚未连接真实桌宠；本文不实现后端。
既有运行语义见 [应用契约指南](../.trellis/spec/shared/plugin-application-contracts.md)，具体请求类型以文内链接的 contracts 为准。

## 固定入口与共同规则

[窗口声明](../apps/desktop/src/renderer/bridges.d.ts) 与 [实际 preload](../apps/desktop/src/preload/index.ts) 已提供以下限定入口：

| 简写 | 固定窗口入口 | 现有类型 |
|---|---|---|
| A | `window.petApplication` | [ApplicationBridge](../packages/contracts/src/application.ts) |
| M | `window.petModels` | [ModelConnectionBridge](../packages/contracts/src/model-connection.ts) |
| D | `window.petDemo` | [DemoBridge](../packages/contracts/src/demo.ts) |
| C | `window.petConsole` | [ConsoleBridge](../packages/contracts/src/console.ts) |
| 设置入口 | `window.petSettings.open()` | `Promise<Result<null>>`，只打开设置窗 |

- 窗口声明中的桥可缺失；此时显示不可用，不能用预览样例替代宿主数据。
- 下文方法均返回 `Promise<Result<T>>`，表中只写成功值类型 `T`；订阅方法返回退订函数。
- [Result](../packages/contracts/src/errors.ts)：`{ok:true,value:T} 或 {ok:false,error:KernelError}`；错误只有 code、messageKey、retryable。
- [OwnerRef](../packages/contracts/src/ids.ts)：`{pluginId,instanceId,generation}`，取自当前宿主快照；载荷中的 owner 本身不授予权限。
- 配置 CAS 使用读取所得 `expectedRevision`；0 表示创建首条记录，旧 revision 得到 conflict，保留草稿并由用户决定重读。
- A 的 profile 保存提交完整 `ApplicationPreferences`；前端 patch 必须与宿主基线合并，不能覆盖其他未改字段。
- `profile.revision` 是已保存版本；`prompt.state=saved/pending/applied/error` 与 `prompt.appliedRevision` 是人格提示词的真实应用状态。
- 保存成功不能推断已应用；插件配置以 [ConfigSave](../packages/contracts/src/config.ts) 的 changeMode=immediate/reload/restart/null 报告生效方式。
- 生命周期／安全动作外层 ok=true 时先采纳返回快照，再检查 operationError；它非空表示动作未达成，状态仍可能已改变。
- 传输中断或 unavailable 等结果不明时重读，不宣称成功、回滚或完全未执行，也不自动重试写操作。
- 确认框取消／Esc 不发变更请求；明确拒绝审批才提交 approved:false。录音取消与登录取消使用各自限定方法。
- 本文不新增 HTTP 服务、任意 IPC 调用或通用命令入口；`runPageAction` 仅用于宿主已声明的同 owner 页面动作。

## 设置外壳与插件贡献页面

设置窗口和导航外壳目前由宿主提供；插件可以贡献设置分栏。当前HTML是独立预览，页面出现/消失只演示目标行为，不代表已经加载运行时插件。

已有链路：插件清单声明 panel JSON → 激活时 contribute → PluginManager登记活跃owner贡献 → applicationPages投影 → ApplicationSnapshot.pages → 设置外壳按清单生成导航。停用、故障或卸载撤回贡献；页面消失后选择返回插件管理，旧owner generation的动作不再有效。

证据：[页面投影](../apps/desktop/src/main/application-pages.ts)、[侧栏生成与选中处理](../apps/desktop/src/renderer/console/app-views.ts)、[设置外壳消费页面](../apps/desktop/src/renderer/console/console-app.tsx)、[插件生命周期](../packages/host-kernel/src/runtime/plugin-manager.ts)。当前通用页面支持Schema配置与宿主声明动作；特色React视图仍编入宿主，不支持任意插件JS/DOM注入。

| 状态或动作 | 设置分栏与运行行为 |
|---|---|
| 启用提供设置页的插件 | 插件激活并注册自身页面后，宿主快照加入该页，侧栏出现一次。纯能力插件未声明页面时不增加分栏。 |
| 停用该插件 | 撤回页面/动作，停止该owner的任务和订阅；若用户正在该页，回到插件管理；配置保留。 |
| 再次启用 | 使用新的活跃owner重新注册，读取保留配置，不复用失效世代动作。 |
| 关闭插件内的语音功能 | 仅关闭输入功能并结束其录音，插件本身仍启用，设置页保留。 |
| 移除独立权限与数据页 | 主导航不再显示；来源/权限信息可在插件详情按需呈现，敏感审批仍由宿主负责。底层安全校验和现有接口不随页面删除。 |

语音当前仍分为 pet.page-voice（页面）、pet.asr-local（ASR）、pet.voice-chat（流程）。后两者的启停或profile.voiceEnabled变化尚未绑定页面撤回。正式实现应让用户启用的“语音输入”功能插件拥有该页面贡献，沿用统一插件模型和现有页面投影；底层能力提供者仍可独立，必要的内置视图映射/来源校验需随归属迁移。不得用隐藏固定菜单代替运行时贡献和owner清理。

预览使用 voicePluginEnabled 演示插件生命周期，voiceEnabled保留为功能开关。正式接入分别读取 ConsolePlugin.state 与有效ApplicationSnapshot.pages，不新增第二份前端插件注册真相或把这两个值合成一个开关。

## 界面功能与宿主职责

| 页面 | 操作／设置组 | 现有 owner 与接入点 | 新预览的缺口 |
|---|---|---|---|
| 开始 | 模型连接、获取／测试／保存并开始、显示隐藏、界面配色 | M；A profile；前端 theme owner | 样例服务／模型不能代替宿主目录；主题继续本地保存 |
| 人设 | 通用、行为互动、显示、音效、人格模板 | A profile 的名字、语言、style、单份 prompt | 习惯、显示、音效、模板库待开发 |
| 装扮 | 形象、配色、服装、一个装扮包导入、脱下 | A profile 的内置 figure/palette/size 与窗口偏好 | 自定义装扮包目录／导入／应用、服装待开发 |
| 对话 | 刷新、更早历史、文字发送、开始录音 | A 的统一历史；D 的发送和唯一录音会话 | 不增加第二历史、附件、新会话或逐条删除 |
| 语音输入 | 输入开关、识别设置、开始／结束识别／取消 | A voiceEnabled；D；C 保存 ASR／voice 配置 | 系统输入与静音结束识别无等价现有契约 |
| 插件 | 运行状态、停止全部、启停／卸载、配置 | C 的当前插件 owner、配置 schema／revision | 没有安装、商店、更新或重启命令 |
| 插件详情/宿主安全 | 审批、来源信任、预设、内置恢复、审计 | C 的精确 owner／任务／摘要范围 | 全数据清除／导出不可用 |
| 关于 | 名称、版本、许可、技术信息 | C 快照的 app 元数据；静态许可信息 | 不增加更新、遥测或诊断上传 |

### 开始：模型连接与桌宠

| 操作 | 固定方法与请求 | 成功值 |
|---|---|---|
| 读取连接 | M.getSnapshot() | ModelConnectionSnapshot：revision、services、endpoints、active、paused、凭据存储可用性 |
| 获取模型 | M.getModels({id,key?}) | ModelCatalogResult：id、models |
| 测试当前草稿 | M.testSelected({id,model,key?,reasoningEffort?}) | ModelDraftTestOutcome：id、model、test |
| 保存并开始 | M.saveAndStart({id,model,expectedRevision,key?,reasoningEffort?}) | ModelConnectionOutcome：snapshot、test |
| 测试已保存在用连接 | M.testConnection() | ModelConnectionOutcome |
| 暂停／继续 | M.setPaused({paused}) | ModelConnectionSnapshot |
| 浏览器登录／查询／取消 | M.startSignIn()／getSignInState()／cancelSignIn() | ModelSignInStatus：phase、signedIn、reason |
| 打开服务页 | M.openServicePage({id}) | null；服务地址由宿主限定 |
| 显示／隐藏桌宠 | A.saveProfile({expectedRevision,data})，只改变完整对象中的 visible | ApplicationSnapshot；desktop.available/shown 分别报告可用性和显示状态 |

获取模型与草稿测试不保存 Key／配置、不激活；临时 Key 只供本次任务使用，缺省使用已保存凭据。
服务或 Key 改变后撤销旧目录／诊断的有效性；reasoningEffort 为 default/low/medium/high。
保存并开始先保存，再诊断与激活；测试失败不回滚已保存配置。Result.ok、test.ok、snapshot.active 必须分别呈现。
浏览器授权只改变相应认证流程，不另建一套连接字段；登录取消也不等于撤销已保存的其他连接。

### 人设与内置装扮：同一份 profile

[应用契约](../packages/contracts/src/application.ts) 当前字段为：

| 字段组 | 已有字段／取值 |
|---|---|
| 通用人设 | petName、userName：1–40 字符；replyLanguage：zh-CN/en；style：quiet/natural/lively |
| 人格提示词 | personaPrompt：1–16384；当前只存一份有效文本，没有模板库 |
| 内置外观 | figure：minimal/round；palette：morning/lavender/pine/orange；size：small/normal/large |
| 窗口与输入 | visible、alwaysOnTop、draggable、reducedMotion、voiceEnabled：boolean |

读取 A.getSnapshot()→ApplicationSnapshot，并用 A.onChanged(listener) 触发重读；保存 A.saveProfile({expectedRevision,data})→ApplicationSnapshot。
[useApplication](../apps/desktop/src/renderer/console/use-application.ts) 保留未保存草稿，后台刷新不覆盖正文；CAS 冲突不自动覆盖。
名字／prompt 的显式保存与宿主 prompt 应用状态分开；不能把前端“已保留草稿”显示成“已应用”。
现有 schema 禁止额外字段；新习惯不能直接塞入 JsonObject，也不能把 wake 译成 style 或把 self 译成权限 preset。

### 对话与语音：一个历史、一个采集会话

请求见 [ApplicationBridge](../packages/contracts/src/application.ts) 与 [DemoBridge](../packages/contracts/src/demo.ts)。

| 操作 | 固定方法与请求 | 成功值 |
|---|---|---|
| 刷新统一历史 | A.getSnapshot() | ApplicationSnapshot：history、cursor、historyBefore、historyHasEarlier |
| 加载更早 | A.getHistory?({before?:number,limit:number}) | ApplicationHistoryPage：items、cursor、before、more |
| 发送文字 | D.sendText({text}) | null；结果及阶段变化从快照／事件读取 |
| 读取语音状态 | D.getSnapshot()；D.onChanged(listener) | DemoSnapshot；订阅返回退订函数 |
| 开始录音 | D.beginRecording() | DemoCaptureTicket：token、sampleRate=16000、maxSamples、chunkSamples=1600 |
| 确认采集就绪 | D.captureReady({token,sampleRate}) | null |
| 推送音频 | D.pushAudio({token,sequence},payload:Uint8Array) | null |
| 结束并识别 | D.finishRecording({token,frames}) | null；不直接返回最终识别文字 |
| 报告采集失败 | D.reportCaptureError({token,reason})，reason=denied/missing/format/failed | null |
| 明确取消 | D.cancel() | DemoSnapshot |
| 保存识别模型 | C.saveConfig({owner:asrOwner,expectedRevision:asrRevision,data:{model:modelId}}) | ConfigSave |
| 保存识别后发送 | C.saveConfig({owner:voiceOwner,expectedRevision:voiceRevision,data:{mode,autoSend}}) | ConfigSave；mode=demo/deepseek |

统一历史按数值 cursor 升序展示；limit 为 1–200，现有 hook 每次 50；预览 before:int-1 不是请求值。
聊天窗口把同一历史中的用户文字、桌宠回复和互动事件混排：用户靠右、桌宠带头像靠左、轻触/抚摸/提起/放下等事件居中。后续真实接入仍从 A.getSnapshot() 和 A.onChanged 读取并按记录身份追加；设置台与桌宠气泡不能各自生成第二份历史。等待/流式状态取 DemoSnapshot.phase，失败不伪装为回复；输入法确认不发送、Shift+Enter 换行、发送成功才清理草稿，跨页保留未发送文字。更早记录前插时保留当前阅读位置，新记录仅在原本接近底部时跟随。当前 HTML 中的示例回复/互动仅演示页面，不代表宿主已记录或模型已响应。
文字发送上限 2000；宿主拒绝时保留草稿，不本地生成用户／回复记录；getHistory 缺失就禁用更早分页。
[语音配置 owner](../apps/desktop/src/renderer/console/use-demo-settings.ts) 与 revision 来自 DemoSnapshot.settings；两份现有配置均立即生效。
DemoSnapshot 还提供模型缓存／streaming、preparedModelId、canRecord/canSend、phase、transcript、错误及 maxRecordingSeconds。
语音输入页按系统内置插件规划：引擎、模型、麦克风、可修改的说话按键和识别结果属于同一产品入口，复用现有采集/识别能力与唯一录音会话。当前后端仍是已有插件组合，新的内置插件设置/服务控制/按键契约尚待实现。旧 engine=local/system 和 afterSpeech 选择已从本轮页面移除，不再映射为用户收音模式设置。
[useDemo](../apps/desktop/src/renderer/console/use-demo.ts) 跨页保留同一采集；结束由 ended 回调只提交一次 finish。
主动取消才调用 D.cancel；窗口关闭／采集失败清理本地设备并保留宿主错误；voiceEnabled=false 会禁止新录音并取消已有语音意图。
录音上限取宿主 maxRecordingSeconds，不能把预览的 20 秒写成后端固定承诺。


### 系统内置语音输入插件：待开发契约

产品级入口为一个系统内置插件，插件页提供启用/停用与设置入口，插件生命周期决定设置分栏是否存在；页面内的voiceEnabled只决定是否允许语音输入，关闭功能不撤回设置页。已有 pet.asr-local、pet.voice-chat、DemoBridge 和唯一 useDemo 采集所有者应复用，不能在新页面另建并行录音器。当前插件页条目只是预览中的产品结构。

| 逻辑操作 | 输入/快照字段提案 | 返回/生效要求 |
|---|---|---|
| 读取设置与能力 | enabled、engineId、modelId、microphoneId、speechKeyCode、revision；引擎/模型/设备目录及平台可用性 | 列表与有效值来自宿主，当前 funasr/whisper/system/api 四类及麦克风示例只用于页面预览，不代表已访问设备或启用宿主能力。 |
| 保存设置 | 当前owner、expectedRevision和完整设置候选 | 返回保存后的有效设置；按键冲突、设备不存在、模型不可用必须明确返回错误并保留原设置。 |
| 启动/停止识别服务 | 当前插件owner及已选引擎/模型 | 返回实际服务阶段与错误；不把 PluginManager 启停或录音 begin/finish 冒充识别服务控制。当前没有等价的固定服务控制接口。 |
| 更改说话按键 | 一个物理键 code，默认 AltLeft；界面先捕获草稿再保存 | 正式全局注册由系统内置插件的受控能力持有，返回实际可用性/冲突；取消不保存，旧绑定仅在新绑定成功后替换。 |
| 输入音量、识别结果 | 同一采集会话的电平、partial/final transcript、阶段与错误 | 来自真实音频与识别事件；当前预览电平为0、不打开麦克风、不生成假的识别文本。 |

按键行为固定且同时生效，不提供 captureMode/holdOnly/toggleOnly 等用户设置，也不在页面展示收音方案：

- 空闲时首次 keydown 立即开始同一录音会话，不为等待长按判定而截掉开头。
- 持续按住后 keyup 结束；短按抬起后继续录音，再次 keydown 结束。预览用250ms作为内部判定常量，正式值由插件契约固定，用户不可调。
- 忽略按键自动重复；一次结束只提交一次 finish。取消、服务停止、输入关闭应结束当前会话；换页不创建第二会话。
- 更改按键对话框中的键只用于捕获新绑定；页面文字输入不触发录音。当前预览键监听仅在语音页面生效，正式全局按键能力仍待开发。
- 已删除收音方式选择、按住时才打开麦克风及其蓝牙耳机相关行为；不为这些已移除功能保留设置开关。

#### 引擎、模型与麦克风目录补充（待开发）

| 引擎ID / 页面选择 | 模型与设置 | 宿主需要提供 |
|---|---|---|
| funasr / FunASR（本机识别） | 固定SenseVoiceSmall INT8；参考模型约228 MB，支持中/英/日/韩/粤语 | 模型描述符、真实缓存状态、进度/错误、安装/重试、识别服务阶段。 |
| whisper / Whisper（本机识别） | 固定Whisper small INT8；参考模型约358 MB，支持多语言 | 独立于FunASR的缓存状态；选择引擎确定相应模型，不构造未经确认的多版本列表。 |
| system / Windows 自带 | 模型与识别语言由Windows管理，不显示本地下载 | 平台支持、系统识别器是否安装、缺语言包/权限等错误。不能把本地模型下载接口用于系统引擎。 |
| api / 转写接口（OpenAI兼容） | 接口地址、自由填写模型名、可选Key | 地址/模型有效性、独立凭据引用与keySaved，实际转写请求与错误；不承诺远端模型发现。 |

本地模型状态至少区分absent/working/ready/error，返回done/total/detail。模型下载入口仅为后续逻辑契约，不是现有DemoBridge的已实现方法；资源由宿主受控目录管理和校验，页面不能传任意落盘路径。当前HTML下载只推进本地演示进度，不请求网络或创建模型文件。

转写接口地址以受控HTTP/HTTPS基址配置，正式适配在用户结束录音后提交到兼容的audio/transcriptions端点；Key由既有凭据所有者保存，状态不返回明文，留空沿用/清除须明确约定。当前“启动”只做本地地址和模型名校验、切换接口预览状态，不是连接成功证明。

麦克风目录返回真实deviceId/label/默认项和所选ID。预览的default/built-in/headset是示例，正式接入不能硬编码；保留已选但暂时失联的设备并显示不可用，而非悄悄换设备。设备刷新应随devicechange自动更新，状态至少有未收音/收音中/被拒绝/出错及detail；音量是同一采集所有者的实时电平，不是增益滑杆。当前设备列表为示例，电平为0，不请求权限或打开麦克风。

### 插件、权限与数据：精确 owner 和真实回执

方法见 [ConsoleBridge](../packages/contracts/src/console.ts)，数据见 [配置契约](../packages/contracts/src/config.ts) 与 [安全契约](../packages/contracts/src/security.ts)。

| 操作 | 固定方法与请求 | 成功值 |
|---|---|---|
| 刷新运行状态 | C.getSnapshot() | ConsoleSnapshot：host、plugins、contributions、app |
| 停止全部 | C.stopAll()，无 taskIds 参数 | HostStatus |
| 启用／停用／卸载 | C.runPluginAction({owner,action:enable/disable/uninstall}) | ConsolePluginChange：snapshot、operationError |
| 读取配置 | C.inspectConfig(owner) | ConfigInspection：definition、snapshot；未保存记录为 null |
| 保存配置 | C.saveConfig({owner,expectedRevision,data:JsonObject}) | ConfigSave：snapshot、changeMode |
| 读取安全状态 | C.getSecurity()；C.onSecurityChanged(listener) | ConsoleSecuritySnapshot；订阅返回退订函数 |
| 确认／撤销来源信任 | C.setTrust({owner,expectedDigest,approved}) | ConsoleSecurityChange |
| 切换权限预设 | C.setPermissionPreset({owner,preset:ask/deny/local}) | ConsoleSecurityChange |
| 同意／拒绝当前审批 | C.answerApproval({requestId,owner,taskId,permissionDigest,approved}) | ConsoleSecurityChange |
| 恢复内置组件 | C.restoreBuiltin({pluginId,expectedDigest}) | ConsoleSecurityChange |
| 翻页／刷新审计 | C.getAudit({offset:number,limit:number}) | ConsoleAuditPage：entries、total、dropped |

插件行使用当前 owner／lifecycle／protected 决定动作；预览 plugin:web-search 等字符串不是完整 OwnerRef。
配置由 definition.schema/defaults/fields 驱动；预览回复模式仅为一份配置示例，不是所有插件的固定字段。
读取缺记录不创建默认；保存失败保留 dirty draft，冲突需显式重读。放弃／返回是草稿操作，不调用后端“撤销保存”。
changeMode 的 reload/restart 是所需生效方式，不代表宿主已执行重载／重启；当前没有对应新增命令。
ConsoleSecurityChange={snapshot,security,operationError}；[生命周期动作](../apps/desktop/src/renderer/console/use-plugin-actions.ts) 与 [安全动作](../apps/desktop/src/renderer/console/use-security-actions.ts) 都先采用快照再判断动作结果。
来源信任为 sessionOnly，与权限预设分开；local 拒绝网络，不能据此宣称云服务就绪；恢复内置不自动信任／启用。
审批绑定当前 requestId、owner、taskId、permissionDigest；来源／恢复摘要取自宿主描述，旧请求不能批准新任务。
审计只有 owner/taskId/kind/targetHash/event/source/errorCode 等元数据；预览 before/after 字符串不是审计分页 API。
全数据清除／导出仍不可用；旧 D.clearHistory 仅属历史能力，不能替代清除所有数据。旧 Key 方法也不新增为第二套连接通路。

### 关于

C.getSnapshot() 返回 app.name/version/electron/node/platform；预览 0.0.0、45、24 等均应替换成宿主值。
现有 app 类型没有 license 字段；许可继续读取构建／归属静态信息，不发明许可查询接口。

## 语音输出插件与自定义TTS（待开发）

内置说话是可停用的内置插件，不属于受保护的应用核心。当前默认声音只在HTML里用短音节拟声演示，不是能读出文字的真实TTS。语音输入（ASR）、模型回复（文本生成）和语音输出必须分开；停用声音提供者不删除文字气泡或停止模型回复。

现有统一插件SDK已提供ProviderDeclaration、PluginTask.signal和media输入/输出；现有能力清单尚无语音输出、音频格式描述或生产播放所有者。参见[能力契约](../packages/contracts/src/capability.ts)、[统一插件SDK](../packages/plugin-sdk/src/index.ts)、[媒体传输](../packages/contracts/src/media.ts)、[显式提供者解析](../packages/host-kernel/src/runtime/capability-registry.ts)。以下仅为后续逻辑契约，不是已注册能力或桥。

| 逻辑项 | 提案与责任 |
|---|---|
| 共用能力 | 一个中立语音输出能力（例如speech.output@1），内置拟声与用户TTS实现同一接口，仍是统一插件模型。通过features区分拟声/TTS及支持的语音参数，不另建TTS插件SDK。 |
| 请求 | 文本、消息/话段ID、语言、provider范围内的voiceId及支持的options；任务带取消信号。不要把语音输入开关voiceEnabled作为声音输出开关。 |
| 结果 | JSON只返回音频描述与media引用；音频字节通过现有media通道。codec/sampleRate/channels/分片顺序必须在正式契约里明确，不能把字节转JSON数组或base64。 |
| 提供者选择 | 使用稳定selector{pluginId,instanceId,providerId}和voiceId。执行时绑定当前OwnerRef世代；插件停用/缺失则不可用，不自动回退到默认或其他提供者。 |
| 配置 | 提供者提供声线目录、支持的音高/语速范围和配置schema。云TTS的端点/模型与凭据仍走插件配置/凭据服务，状态只返回keySaved，不在气泡或偏好里保存明文Key。 |
| 播放 | 宿主/前端共用一个受控播放器，按话段顺序播放；声音任务独立于回复文本任务。文本保留，语音失败单独显示。 |
| 停止与停用 | 取消当前/排队合成，关闭media流并停止播放；拒收旧generation的迟到音频。停用内置说话不撤回人设/气泡页面，也不关闭语音输入插件。 |
| 页面贡献 | 自定义TTS可声明自己的配置页，沿用插件页面贡献规则。人设音效中的声音选择器显示已注册提供者/声线；未实现的自定义提供者不预放假条目。 |

当前预览里builtin/soft属于同一个“内置说话”插件。停用后保留选择并标记不可用，试听禁用，可前往插件管理重新启用；文字和气泡预览照常展示。真实自定义TTS、媒体播放和能力注册仍待整体迁移实现。

## 桌宠气泡预览与接入边界

设置HTML中的气泡工作台仅演示产品样式/交互。参考Coopanion的共用主气泡（说话/选择/输入/状态）及无尾用户气泡结构，保留本项目角色和黑白主题；不复制参考实现/角色。思考只显示状态点，不展示推理内容。

| 场景 | 前端责任与后续接入 |
|---|---|
| 说话与逐字显示 | 接收已允许外显的完整话段，再逐字呈现；不是直接展示模型原始token流。显现停止只完成/停止展示，不自行宣称已取消模型任务。 |
| 状态 | 使用宿主允许公开的任务摘要/阶段。对话、选项、输入优先于背景状态；不同时叠多层思考泡泡。 |
| 选项/应用对话 | 沿用ApplicationSnapshot.dialog及answer({id,step,choice,text?})，绑定当前owner/对话状态；pending时避免重复提交，错误保留当前选择。 |
| 输入 | 只有前端草稿，发送走既有统一对话入口；Enter/Shift+Enter/IME语义明确，不为气泡建立第二套历史/录音所有者。 |
| 用户气泡 | 从同一实际用户事件投影，控制堆叠/溢出/淡出；预览本地文字不写真实记录。 |
| 错误 | 使用同一对话几何与可恢复动作，不把示例重试当后端成功。 |
| 布局 | 根据桌宠锚点、气泡尺寸和视口边界定位，限制窄窗/长文溢出并支持减少动画。关闭/返回焦点不启动外部应用。 |

生产桌宠当前PetBubble仍是文本显示；新的样式、动作与输出提供者接线只在整套前端确认后整体迁入。

## 仅本地 UI 与现有主题 owner

| 行为 | 前端责任 |
|---|---|
| 导航、习惯／模板页签、自定义分组展开、Key 显隐 | 只改视图／草稿，不发业务请求 |
| 预览明暗／pose、选择图片缩略图、取消文件选择 | 保持会话内预览；不当作真实桌宠效果回执 |
| 输入计数、范围值显示、模板新建／复制／重置草稿 | 校验并保留用户输入；持久化库另属待开发 |
| 声音试听 | 当前用浏览器 AudioContext 合成示例；失败显示不可试听，不证明宿主音效已实现 |
| 确认框取消、配置返回／放弃 | 不提交变更；不能伪造后端取消或回滚结果 |
| 界面明暗、内置／自定义配色 | 复用 [theme owner](../apps/desktop/src/renderer/console/theme.ts)，无新增后端 |

主题只有 pet.console.theme 一份本地记录：StoredTheme={selectedId,mode,custom}，方案保留 light/dark 两份 palette。
使用 readThemeState／writeThemeState／subscribeTheme；写入并读回核对才报告已保存，ThemeWriteResult={ok,error?}。
previewPalette 不落盘，离开编辑器调用 resetPreview；六色预览接线时保留现有 36 token、另一外观和自定义方案，不能新增影子存储。

## 新设置字段组：待开发，以下是 UI 取值而非已注册请求

| 组 | 当前 UI 字段／值 | 接入要求 |
|---|---|---|
| 走动／回应 | roam=free/calm/off；wake=none/poke/all/custom | 确认行为含义与应用时机，不能套用旧 style |
| 自定义回应 | wakePoke/wakePat/wakeThrow/wakeDrop：boolean | custom 时使用；不扩大现有 interact 的允许动作集合 |
| 自主配置 | self=off/default/any/custom；selfFigure/selfPalette/selfRoam/selfSnore/selfSize/selfBubble/selfFont/selfSound/selfTheme/selfHover/selfUser | 独立定义可改项目与真实授权，不把 any 解释为绕过宿主权限 |
| 悬停／双击 | hover ⊆ chat/voice/roam/theme/sound/dress/hide，最多 6 项；doubleClickTyping：boolean | 只配置入口可见性／手势，不自动执行入口动作 |
| 显示开关 | statusBubble/saidBubble/hideInFullscreen/rememberPosition：boolean | 定义真实窗口／气泡行为与持久化 |
| 显示数值 | bubbleFontSize=80–160，步长5；bubbleSpeed=50–200，步长10；glow=0–16 | 当前显示百分比／效果值，正式单位和生效口径待契约确认 |
| 帧率 | frameRate=60/120/144/unlimited；lockFps：boolean | 需真实渲染 owner 支持，选择值不代表测得帧率 |
| 音效总开关／类别 | soundEnabled；soundMove/soundTouch/soundFace/soundSnore/soundTalk/soundUi：boolean | 总开关控制音效区；说话类别控制说话声区，打呼噜类别控制呼噜时长；关闭后隐藏并保留原值；与语音输入 voiceEnabled 分开 |
| 呼噜／说话声 | snoreSeconds=0–30；speakingSound=builtin/soft | 声音资源和 0 秒含义待正式确认；不另设静音声源，关闭说话或总音效即可 |
| 音高／语速 | speechPitchLevel/speechSpeedLevel=low/mid/high/custom；speechPitch=200–700，步长10；speechSpeed=6–20，步长1 | 当前仅合成试听值，正式声音引擎、单位／预设映射待定义 |
| 模板库 | personaTemplate、personaTemplateName、personaPrompt；内置 default/warm/lively/rational；新建／复制／重置／保存 | 库持久化、选择／应用与单份 personaPrompt 保存分开建模 |

新字段应扩展经确认的配置 schema 与迁移规则，保持应用偏好一个权威 owner；正式类型／方法名尚待契约确定。
模板变量 {{petName}}／{{userName}} 目前只是预览文本提案；替换时机、未知变量处理与最终有效 prompt 口径均待确认。
保存模板库不等于应用模板；应用时仍需真实 profile CAS 和人格提示词应用回执，不能仅凭切换模板显示成功。

## 装扮包：待开发的逻辑操作

一次导入一个包；一个包包含一个基础形象及其专属配色／服装集合。下表是逻辑输入输出提案，尚无注册方法名、IPC、HTTP 路由或正式类型。

| 逻辑操作 | 请求口径（提案） | 响应口径（提案） |
|---|---|---|
| 读取装扮目录 | 读取当前可用包，无配置写入 | 包记录含 packageId、packageRevision、name、基础形象、包内 palettes／clothing 的 ID 与显示信息；资源引用形式待定 |
| 导入一个包 | 用户明确选中的单一包；正式文件格式、传输载体和边界待定 | 校验完成后返回可列入目录的包记录及其 revision；失败返回明确错误，不宣称已导入，也不自动应用 |
| 应用装扮组合 | 当前 profile 的 expectedRevision，加下述完整选择元组 | 返回同一 profile owner 的新保存版本／选择及真实应用结果；尚未应用要如实显示，应用回执正式形状待定义 |

应用选择必须同时包含：

- packageId：选中的包；packageRevision：本次目录所见该包版本，独立于 profile CAS revision。
- paletteId：该包声明的配色ID，未制作时为null；clothingId：该包声明的服装ID，null表示空服装或脱下。
- 四项绑定同一个包；不同包的配色／服装不能混用，包变化或版本过期应拒绝旧选择并重读。
- 切换基础形象就是切换所属包，其配色／服装一起重建；不做三次独立图片导入。
- 导入与应用分开；当前页面导入后选中新包只是本地预览。正式接入若导入后应用，应再提交同一包的完整选择。取消不提交，导入校验失败保留原目录/选择，应用失败分别报告保存与实际应用结果。

现有 figure/palette 是封闭枚举，不能直接写自定义 packageId 或资源 ID；正式接入需版本化 schema 与旧记录迁移。
迁移应将旧内置 figure/palette 映射到内置包／选项，保持 profile 一个 owner；不得创建另一份外观偏好存储。
现有 prompt.appliedRevision 只证明人格提示词应用，不能冒充装扮已渲染；真实装扮应用回执需另行定义。
当前预览 JSON 为 desktop-pet-outfit-preview、version=1，含 name/image/palettes/clothing，图片仅为包内 data URI。
它只供本地演示：未定义正式宿主包格式、资产持久化或生产导入接口；目录／导入／应用三项均仍待开发。

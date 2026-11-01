# 设置前端与后端契约映射

本文是八页设置预览的统一接入说明：现有调用以当前工作区源码为准，新增需求标为“待开发”。
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

## 八页功能总表

| 页面 | 操作／设置组 | 现有 owner 与接入点 | 新预览的缺口 |
|---|---|---|---|
| 开始 | 模型连接、获取／测试／保存并开始、显示隐藏、界面配色 | M；A profile；前端 theme owner | 样例服务／模型不能代替宿主目录；主题继续本地保存 |
| 人设 | 通用、行为互动、显示、音效、人格模板 | A profile 的名字、语言、style、单份 prompt | 习惯、显示、音效、模板库待开发 |
| 装扮 | 形象、配色、服装、一个装扮包导入、脱下 | A profile 的内置 figure/palette/size 与窗口偏好 | 自定义装扮包目录／导入／应用、服装待开发 |
| 对话 | 刷新、更早历史、文字发送、开始录音 | A 的统一历史；D 的发送和唯一录音会话 | 不增加第二历史、附件、新会话或逐条删除 |
| 语音输入 | 输入开关、识别设置、开始／结束识别／取消 | A voiceEnabled；D；C 保存 ASR／voice 配置 | 系统输入与静音结束识别无等价现有契约 |
| 扩展 | 运行状态、停止全部、启停／卸载、配置 | C 的当前插件 owner、配置 schema／revision | 没有安装、商店、更新或重启命令 |
| 权限与数据 | 审批、来源信任、预设、内置恢复、审计 | C 的精确 owner／任务／摘要范围 | 全数据清除／导出不可用 |
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
文字发送上限 2000；宿主拒绝时保留草稿，不本地生成用户／回复记录；getHistory 缺失就禁用更早分页。
[语音配置 owner](../apps/desktop/src/renderer/console/use-demo-settings.ts) 与 revision 来自 DemoSnapshot.settings；两份现有配置均立即生效。
DemoSnapshot 还提供模型缓存／streaming、preparedModelId、canRecord/canSend、phase、transcript、错误及 maxRecordingSeconds。
预览 engine=local/system 不等于 modelId；当前只确认本地 ASR 模型通路，系统语音输入待开发。
afterSpeech=manual/auto/keep 也不是 autoSend 的枚举：静音后识别待开发，autoSend 仅表示识别完成后发送。
“只留下文字”可对应 autoSend=false 的意图，但正式接线前须确定与手动结束选项的独立关系；不要静默丢掉其中一个设置。
[useDemo](../apps/desktop/src/renderer/console/use-demo.ts) 跨页保留同一采集；结束由 ended 回调只提交一次 finish。
主动取消才调用 D.cancel；窗口关闭／采集失败清理本地设备并保留宿主错误；voiceEnabled=false 会禁止新录音并取消已有语音意图。
录音上限取宿主 maxRecordingSeconds，不能把预览的 20 秒写成后端固定承诺。

### 扩展、权限与数据：精确 owner 和真实回执

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
配置由 definition.schema/defaults/fields 驱动；预览 mode/autoSend 仅为一份配置示例，不是所有插件的固定字段。
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
| 呼噜／说话声 | snoreSeconds=0–30；speakingSound=builtin/soft/silent | 声音资源和 0 秒含义待正式确认；静音禁用试听 |
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

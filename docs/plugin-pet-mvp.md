# 插件化桌宠 MVP

2026-11-03：权限按用户指令改为默认允许，气泡已按所给暗色参考配套明暗版本并加入动效；当前设计与验收见[气泡设计说明](pet-bubble-design.md)。

本轮由用户明确授权，从独立前端预览进入原生应用与后端实现。视觉基准保留在[设置预览](../qa/minimal-settings-preview/index.html)，控件意图见[接口对照](frontend-api-contract.md)。本文维护实际模块归属、扩展方式和验证状态。

## 统一插件模型

宿主提供窗口、可信桥、插件生命周期、任务、配置、权限、凭据和媒体传输。插件声明能力与页面贡献；内置只表示随应用提供，不代表不可停用。界面读取真实活跃贡献，不维护另一套插件注册表。

| 模块       | 权威所有者与实现                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 桌宠界面   | 原生透明窗口与Pet渲染器；悬停/焦点才显示工具，控件按真实矩形参与命中，透明区域仍穿透。                               |
| 偏好与人格 | pet.profile + ConfigService；完整候选与expectedRevision保存，版本1迁移至2，保存和人格实际生效分开。                  |
| 模型连接   | 现有模型连接控制器与LLM提供者；凭据只经CredentialBroker，测试结果与在用状态分开。                                    |
| 语音采集   | 设置渲染器中的唯一useDemo采集所有者；设置窗口启动时隐藏加载，关闭设置只隐藏，任务结束/退出才释放设备。               |
| 说话按键   | pet.talk-key通过input.talkKey能力观察配置的单个物理键；任务取消与插件代次绑定。                                      |
| ASR        | speech.asr提供者：本地SenseVoice/Whisper、WindowsSAPI、兼容转写接口。模型和服务状态来自真实后端。                    |
| 对话与记录 | 既有Core/agent与统一历史；打字、桌宠按钮和语音汇入同一链路，不在页面造回复或第二份记录。                             |
| 语音输出   | speech.output能力：pet.builtin-speech拟声、pet.system-tts真实系统语音及用户提供者；只有Pet根节点挂载一个播放所有者。 |
| 设置分栏   | 活跃插件贡献页面；语音输入页已归pet.voice-chat，停用后撤页，过期owner动作失效。                                      |
| 主题       | 现有设置主题控制器保留唯一存储，经受限petPresentation桥投影到Pet；Pet不维护独立配色存储。                            |

## 交互与生命周期

空闲时不显示普通文字气泡。悬停或键盘焦点显示对话、麦克风和真实说话键。对话打开单行输入，必要时增长至六行；Enter发送，Shift+Enter换行，输入法确认不发送。新回复、任务、错误与交互对话按实际事件显示，普通消息可关闭或到时收起。首次引导与敏感审批不伪装成空闲消息。

按键首次按下即开始采集；长按松开结束，短按松开保持录音，再按结束；自动重复不触发。PET不打开第二个麦克风，而是发送固定requestRecording命令给同一采集所有者。录音前的授权等待不计入实际录音倒计时。导航不重建会话；功能关闭、插件停用、owner失效会取消所属工作。

语音文本写入同一Core记录，提交回复文本后才启动独立语音输出任务。提供者合成与实际播放分别拥有可取消任务；关闭输出、停用提供者或更改世代会停止排队、合成和播放，文字仍保留。所选提供者缺失时返回不可用，绝不自动回退。

## 扩展语音提供者

新增插件声明speech.output@1并实现synthesize：输入包含utteranceId、text、language、voice和rate；输出是codec/sampleRate/channels/frames及media引用，音频字节走已有media通道。具体类型、预算与校验见[语音输出契约](../packages/contracts/src/speech-output.ts)，示例实现见[拟声插件](../plugins/builtin-speech/src/index.ts)和[Windows系统语音插件](../plugins/system-tts/src/index.ts)。

稳定选择保存pluginId/instanceId/providerId；执行时绑定完整owner generation。提供者声明自己需要的网络、凭据或固定worker权限，宿主负责授权与播放，页面不能发送任意命令或写路径。Windows系统语音用固定PowerShell脚本和JSON标准输入，不拼接用户文本到命令行。

## 配置边界

声音开关、提供者和消费者播放参数保存在同一profile记录，通过语音输出桥投影。人设页面“说话”不创建第二份开关。音效总开关是更上层的门控。配置只新增受限type:[基础类型,null]支持，不开放任意联合Schema或脚本。普通RPC保持有限预算；无deadline的runtime.invoke通过null预算绑定owner取消，必须带taskId、调用方signal与物理工作完成约束，避免输入监听被传输层偷偷截成30秒。

兼容转写接口支持插件明确声明的OpenAI、Groq、SiliconFlow HTTPS来源；未声明来源在保存前拒绝，不能以“兼容”为名放宽网络权限。WhisperSmall资源按固定清单校验并原子发布；未安装不会显示已就绪。

## 当前交付边界与证据

旧版profile在角色启动前，经源码校验、已声明migrateConfig和ConfigService迁移事务升级；校验与CAS成功后才提交。正常配置已从schema1/revision34迁至schema2/revision35，Core和页面就绪，未重置原偏好，迁移不访问凭据库。启动方式：在项目根目录运行`pnpm --filter @pet/desktop start --show-settings`。

- 已保存预览检查点70f3c0f，原生最小样式基础来自隔离版本7a32e3b。
- 语音输出23项、语音输入46项、Pet渲染153项针对性检查通过；完整工作区类型、测试、QA、lint、格式与构建通过。
- 真实WindowsTTS生成6.12秒非静音PCM；真实公开WAV已通过SenseVoice和WindowsSAPI识别，物理键监听可启动和取消。
- [原生报告](../qa/plugin-pet-mvp/report.json)已验证完整语音—对话—实际播放回执、主题同步、声音关闭、插件撤页与重启保留。按键监听已通过32秒以上原生运行，协议回归覆盖无隐式超时与owner取消。
- 未安装Whisper、没有云Key/未声明端点时展示真实不可用。测试不使用付费生成接口或读取用户密钥。
- 当前角色只开放已有消费者的日常设置；自主改配置策略、漫游/锁帧等高级角色能力和完整用户装扮包生命周期仍是后续扩展，界面不宣称已生效。

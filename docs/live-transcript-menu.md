# 实时转写气泡与紧凑菜单

## 实时识别

录音开始后，支持中间结果的本地引擎在同一个intent、voice-chat编排与ASR任务内持续接收PCM。主进程用有界队列和事件唤醒传输，不轮询、不建立第二个录音器。partial是当前完整假设，可修订前文，仍保持recording和麦克风租约；只有用户结束录音才end输入，final再进入Core一次。

SenseVoice复用已加载识别器，每秒真实识别一次当前前缀；Paraformer复用单一online stream。Whisper、WindowsSAPI与云批量转写仍在录音结束后识别，不伪造partial，也不提前消耗它们的识别任务预算。

桌宠的“实时识别”气泡即时显示完整文本，不使用回复逐字动画，也不受普通状态/说话气泡开关抑制。长文可滚动，用户向上阅读时不强制跟随；最终结果以“识别结果”保留片刻，回复不会把它覆盖。关闭、取消或owner变代会清理相应输入，旧轮结果不能混入新录音。

实现：[Main会话](../apps/desktop/src/main/demo-controller.ts)、[本地识别流](../plugins/asr-local/src/stream-session.ts)、[转写投影](../apps/desktop/src/renderer/pet/demo-status.ts)。

## 右键菜单

视觉参考用户所给216×165面板，暗浅同几何，保留自有蓝色头像与真实名字。标题栏为暂停/继续、设置、退出；六格依次为聊天、语音功能开关、暗浅主题、音效、隐藏与装扮。头像中的更多入口保留停止、引导、继续提示和关闭。

每个开关只显示宿主回执。声音与可见性保存同一profile CAS；暂停调用已有Core.run；语音start/stop仅新增可信Pet的固定无参数入口，设置、下载和凭据仍由Console控制。语音开关在实际profile快照采纳后才解除pending，避免快速操作重复旧状态。

主题继续由唯一Console主题控制器持久保存。Pet发固定appearance命令，主进程要求精确id与新发布快照才确认成功，失败或超时不会假改按钮。装扮入口通过固定导航目的地选中已有插件贡献页面，不自行猜页面id。

实现：[菜单](../apps/desktop/src/renderer/pet/PetMenu.tsx)、[主题命令](../apps/desktop/src/main/presentation-controller.ts)、[固定导航](../apps/desktop/src/main/settings-open-request.ts)。

## 验证

完整pnpm check通过。实际Electron验收确认明暗菜单216×165及所有控制动作；公开WAV在录音未结束时产生7个不同识别假设，气泡与当前原文一致且保持recording；结束后final保留，即使普通气泡开关关闭也可检查，同一轮只有一个语音输入和一个Core回复。

Node额外验证SenseVoice/Paraformer在EOF前产生真实partial，取消时不产生final；来源代次、20秒累计预算、麦克风租约、自动发送一次与关闭清理均有回归。证据见[原生报告与截图](../qa/live-transcript-menu/README.md)。测试使用公开WAV虚拟设备与离线脚本回复，不调用付费服务。

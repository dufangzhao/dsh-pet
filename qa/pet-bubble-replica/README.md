# 气泡复刻与默认允许验收

设计与路由证据统一见[气泡设计说明](../../docs/pet-bubble-design.md)。以下均为自有Electron实际界面截图。

- [暗色输入框](composer-dark.png) / [浅色输入框](composer-light.png)：252×71，同一textarea展开与草稿。
- [暗色选项气泡](choices-dark.png) / [浅色选项气泡](choices-light.png)：普通交互保留真实动作。
- [实际回复气泡](reply-dark.png)。
- [视觉与动效原生报告](report.json)：精确尺寸、头像无框、递增真实回复、收起立即inert、减少动画。
- [默认允许语音报告](default-allow-voice.json)：公开WAV→ASR→统一对话→系统TTS实际播放，检查全程授权待办为空，没有自动答应弹窗。

语音验收使用隔离配置、公开WAV虚拟设备和明确标注的离线脚本回复，不调用付费模型，不替代物理设备测试。

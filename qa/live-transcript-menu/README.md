# 实时转写与紧凑菜单验收

当前设计与边界见[实现说明](../../docs/live-transcript-menu.md)。以下为真实Electron或实际本地ASR公开音频验证。

- [原生报告](report.json)：暗浅菜单216×165，实际主题/暂停/音效/隐藏/装扮/聊天/语音开关，录音中多个真实hypothesis、final检查和单次Core回复。
- [实时识别](live-transcript.png) / [最终结果](final-transcript.png)
- [暗色菜单](menu-dark.png) / [浅色菜单](menu-light.png)
- [实际worker公开WAV结果](worker-report.json)：SenseVoice与Paraformer EOF前输出，以及取消不产生final。

识别内容是引擎真实返回，可能修订或包含错误；截图正用于用户检查，不替换成预写正确文本。验收隔离配置、虚拟公开WAV输入，无付费API或用户密钥读取。

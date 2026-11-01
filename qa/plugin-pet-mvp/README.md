# 原生插件桌宠MVP验收

完整设计与交付边界见[实现指南](../../docs/plugin-pet-mvp.md)。本目录保存真实Electron验收证据；可用[原生探针](../probes/plugin-pet-mvp-native.mjs)复现。

- [验收结果](report.json)：公开WAV采集、SenseVoice识别、统一历史、实际TTS播放回执、主题投影、关闭声音无刷新循环、插件撤页、32秒以上按键监听和重启保留。
- [紧凑输入气泡](pet-composer.png)
- [原生设置](settings.png)
- [正常配置升级](normal-profile.json)：schema升级后原记录revision34→35、Core就绪；只保存状态元数据。

验收使用隔离配置与公开WAV虚拟设备，并通过真实应用授权；回复明确使用离线脚本模式，不调用付费模型接口。本报告不等同于真实物理麦克风或云ASR服务测试。

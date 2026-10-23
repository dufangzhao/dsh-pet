---
status: accepted
date: 2026-10-24
source: 用户在Q10选择A
---

# 桌面底座采用Electron与TypeScript

桌面应用采用Electron + TypeScript，配合已确认的独立运行、Windows首发和统一插件模型。优先利用Web界面与JS/TS生态来实现设置台、受控UI贡献点和插件宿主连接。

相较Tauri/Rust路线，该选择减少与候选Node插件生态的额外桥接；相较Windows原生.NET界面路线，更便于丰富Web界面与后续平台复用。接受捆绑Chromium的包体与常驻资源成本，并通过任务隔离、按需加载和测量治理，而非假设选择框架就自然流畅。

## 尚未冻结

- Electron/Node/TypeScript的具体版本与支持周期。
- 设置台的React/Vue等UI框架、组件库与状态管理。
- 插件框架的具体发行线、版本和运行隔离。
- 原生辅助能力使用C#、Rust、Node原生组件或其他适配方式。

必须验证原生库、音频、透明窗、多屏/缩放、凭据API、打包与更新的版本兼容。此决定不表示已安装依赖、已创建应用骨架或已通过性能/安全测试。

相关：[Electron运行边界草案](../12-electron-runtime-boundaries.md) · [总体架构](../05-architecture-overview.md)

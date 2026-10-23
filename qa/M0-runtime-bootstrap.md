# M0 运行时探针记录

日期：2026-10-24；环境见[M0基线](M0-00-environment.md)。探针：[Electron主进程](probes/runtime-main.cjs)、[Node模式子进程](probes/runtime-worker.cjs)。只用公开合成字符串做safeStorage回环，不使用或保存任何真实Key。只读取F24键态一次，不注入输入、不记录键盘内容。

## 首轮：失败（探针元数据读取缺陷）

命令：`pnpm exec electron qa/probes/runtime-main.cjs`，清除ELECTRON_RUN_AS_NODE与替代目录环境覆盖。exit 1。

错误：`ERR_PACKAGE_PATH_NOT_EXPORTED`，Koffi的exports不允许 `koffi/package.json`；子进程错误输出显示内置Node为24.22.0。模块require与user32函数绑定已执行到元数据读取前，但未完成报告，不算完整通过。

处理：改用Koffi公开版本字段（先核对已安装声明），不更换依赖版本、不绕过失败。随后独立重跑并追加结果。

## 第二轮：通过（最小加载与回环）

同一命令 exit 0，stderr为空。实际报告如下；探针增加了精确版本及功能存在性断言，未来失败不只输出false后成功退出。

| 项目 | 观测 |
| --- | --- |
| Electron主进程 | 45.0.0；Node24.22.0；Chromium156.0.8078.48 |
| Node模式子进程 | Electron45.0.0、Node24.22.0、modules150、N-API10、win32-x64 |
| Koffi | 3.3.1加载成功；GetAsyncKeyState返回number |
| sherpa wrapper / binary | 均1.13.8；OfflineRecognizer与OnlineRecognizer构造器存在 |
| safeStorage | 异步available=true，公开合成字符串加密解密回环一致 |

未覆盖：模型实际推理、键态连续轮询与长短按、多屏/焦点/穿透、插件生命周期、真实凭据命名空间。首轮是探针缺陷，不是换版本的依据；没有为绕开失败更换任何依赖。

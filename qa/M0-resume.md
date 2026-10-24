# M0 暂停交接

日期：2026-10-24。M0未完成，不进入M1。

## 已提交与验证

- `34066cb`：M0-01骨架。指定DeepSeek实现，主会话审查；14包类型检查、测试空跑、lint、format与frozen-lockfile安装通过。
- `73d20ba`：M0-02精确版本及最小运行时探针、M0窗口桥准备。14个原型状态测试通过；真实Electron45.0.0主进程启动Node模式子进程，Koffi3.3.1与sherpa wrapper/binary1.13.8加载成功；safeStorage异步回环通过。详见[版本](versions.md)、[探针记录](M0-runtime-bootstrap.md)。

## 暂停原因

K3任务 `b5a79c62-7a2c-46f7-9c0c-5726b4f5ab7a` 未完成即失败、无原因/交付；检查windows与pet renderer范围均无文件。一次用户重试询问等待600秒超时，未获得批准，不能视作同意。见[异常记录](M0-06-dispatch-failure.md)。

## 保留但未验收/未提交的草稿

- [asr-download.mjs](probes/asr-download.mjs)、[其测试](probes/asr-download.test.mjs)：DeepSeek支持任务 `c81c1a56-9a65-4e6e-b84e-750fdf0c0209` 的交付；现有84测试通过，但主会话审查不合格。
- [主会话回归测试](probes/asr-review-regressions.test.mjs)：3个安全场景目前全部失败，待用于返修验证；不纳入“已通过”的代码提交。
- 模型与公开样本在忽略的 `.cache/asr-models/`，12文件/477,645,710字节，主会话已离线验证哈希；未加载模型识别。不要提交这些权重或音频。

## 用户确认继续之后

1. 读取本记录及[下载审查要求](M0-04-download-review.md)。按用户授权，使用原 `factory-g/kimi-k3` 路由重试M0-06；不自行替换模型。前端仍只允许windows与pet目录，契约见[冻结桥](M0-06-bridge.md)。
2. 用原DeepSeek路由交回下载脚本修正R1/R2/R3及附属问题；主会话审查全部diff，原有和新回归均通过才提交。原子不覆盖发布不能退回rename覆盖式方案。
3. 主会话继续M0-03的Cordis依赖/清理/失败回滚实验；M0-04实际识别两候选样本；M0-05长短按状态机、真实轮询抖动/CPU/快速轻点验证。
4. 主会话实现窗口preload/IPC/构建入口并与K3集成，真实测焦点、穿透、拖拽、多屏/DPI；当前main入口仍为空，不是可启动桌宠。
5. 全部M0结论记入qa；未覆盖或失败给用户选项，不进入有未通过依赖的M1工作包。

## 约束

主分支main、本地作者kingBZ，仍无远程且不推送。子代理同时<=3、互斥写入；关键后端与安全由主会话负责，前端由K3。无真实Key、无付费调用、无麦克风采集、无用户数据上传、无Coopanion代码/素材复制。模型权重不入库。

# M0 开工环境与基线

记录日期：2026-10-24（Asia/Taipei）。证据等级：本机命令读取；不是产品功能验证。

## 仓库

- 工作目录：`C:/Users/ASUS/Documents/DeepSeek-WorkSpace/Projects/桌宠`。
- 分支 `main`；开工基线 `67a8b50`；初始 `git status --short --branch` 只有 `## main`，工作区干净。
- `git remote -v` 无输出；本次不创建远程、不推送。
- 本地提交身份：`kingBZ <774714494@qq.com>`。
- 两条指定子代理路由已用 `list_subagent_models` 确认可用：`workbuddy-subscription/deepseek-v4.1-flash`、`factory-g/kimi-k3`，不替换模型。

## 工具与硬件

| 项目 | 实测值 |
| --- | --- |
| Node | v24.18.0 |
| pnpm | 11.24.0 |
| Git | 2.56.0.windows.2 |
| 系统 | Microsoft Windows 11 Home，10.0.26200，64-bit |
| CPU | Intel Core i5-11400H，6核12线程 |
| 可见内存 | 16,509,764 KiB |
| 独立GPU | RTX 3050 Ti Laptop GPU，约4GiB，驱动32.0.15.6607 |
| 其他显示适配器 | Intel UHD Graphics；GameViewer Virtual Display Adapter |

复核命令：`node --version`、`pnpm --version`、`git --version`、`git status --short --branch`、`git remote -v`、`git log -3 --oneline`、`git config --local --get user.name`、`git config --local --get user.email`。Windows信息使用 `Get-CimInstance Win32_OperatingSystem/Win32_Processor/Win32_VideoController`，未读取设备序列号。

## 文档阅读与冲突处理

已按用户顺序完整阅读：[导航](../docs/README.md)、[实现计划](../docs/19-implementation-plan.md)、[PRD](../docs/18-voice-chat-mvp-prd.md)、13份ADR、插件契约/生命周期/Electron边界、安全/测试策略、ASR双路径与云端研究、Coopanion两份参考评审、[术语](../CONTEXT.md)。另读根说明、许可和技术预研。

历史草案中的听写首版、待选UI/存储/更新等表述已由 ADR-0013、PRD与实现计划第2节覆盖；实施时以新决定为准，不实现跨应用文字输入。研究材料中的历史描述保留其时点，不冒充新决策。

## 未覆盖

此记录没有证明Electron启动、原生模块加载、模型识别、键态轮询、窗口穿透/拖拽、多屏/DPI、真实麦克风或云服务可用；这些分别进入M0验证或后续里程碑。无付费调用、无Key、无个人录音。

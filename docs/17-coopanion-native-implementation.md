# Coopanion Windows原生实现：对Q18的补充核验

状态：固定v0.2.8提交 3dd0892c2d70a026253ab980af392302b88ff8b1 的源码静态审阅，2026-10-24。未运行或安装项目，未实际操作用户电脑。Q18仍未选择，Coopanion仍仅作参考。

## 结论先看

Coopanion用 **Node/TypeScript + Koffi调用Win32**，而非C#。电脑操作在独立引擎子进程中执行，按键状态读取则在World/Core路径。它证明Node原生适配是值得评估的路线，但没有直接替我们完成安全的跨应用听写。

需要修正原预研两点：按住说话需要观测按下/松开，不一定非要键盘钩子；Node方案也可以放工作进程，不能只拿“在Electron主进程里直接调用”来与C#辅助进程比较。

## 1. 进程和运行时

```text
Electron应用
  └─ fork Core（应用运行时的Node模式）
       ├─ 说话键：Koffi → GetAsyncKeyState → 周期轮询按下/松开
       └─ CUA调度：按需fork独立引擎 → IPC请求/取消/回执
             └─ Koffi → Win32 DLL
                  ├─ GDI BitBlt：截图
                  ├─ SendInput：键盘、文字、鼠标按钮
                  ├─ SetCursorPos：移动光标
                  └─ EnumWindows等：窗口列表与聚焦
```

- [Core启动](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/app/core-host.cjs#L74-L89)与[运行环境](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/app/core-env.cjs#L1-L9)明确使用应用运行时的Node模式，设置ELECTRON_RUN_AS_NODE=1。
- [CUA子进程](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/cua.ts#L198-L212)通过fork、IPC与任务ID转发请求/回执；不能据此声称它绑定的是用户额外安装的Node。
- 子进程有助于隔离故障，但不自动解决原生模块的运行时兼容，也不是安全沙箱。
- 原生键态读取仍发生在World/Core，不应把所有原生调用都描述为已独立隔离。

## 2. 全局按键：轮询，不是钩子

[Windows键态读取](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L124-L129)用GetAsyncKeyState的高位判断当前是否按下；[watchHotkey](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L237-L252)用定时器比较状态变化；[World参数](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/world.ts#L98-L107)把周期设为30ms。

这是源码配置值，不是实测延迟。周期轮询可以表达按下/松开和连续轻点识别，因此“按住说话必须键盘钩子”不准确。但它不是低级键盘钩子的拦截机制，仍需验证短按漏检、调度抖动、CPU消耗和目标软件快捷键冲突。

我们已选的“一键长按/轻点”是产品交互，底层可用轮询、钩子或适合的输入监听方案实现；不能由交互选择自动推导出必须使用某个库。Coopanion默认[LeftAlt*2](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/asr/hotkey.ts#L31-L44)是轻点后再按住，不等于本项目的单键双用状态机；只参考机制，不照搬默认交互。

## 3. 文字、鼠标和截图

| 需求 | 实际路径 | 对本项目的含义 |
| --- | --- | --- |
| 文字输入 | SendInput + KEYEVENTF_UNICODE | 发送事件不等于目标输入框已经正确收到 |
| 鼠标 | SetCursorPos移动，SendInput发按钮/滚轮 | 全局原生输入，不等于后台语义控件操作 |
| 截图 | GDI BitBlt / GetDIBits | 可参考后续屏幕能力；不是听写首闭环必须实现的功能 |
| 窗口 | EnumWindows、GetForegroundWindow、GetWindowThreadProcessId等 | 能找到顶层窗口，不能单凭此辨别同窗不同输入框或密码框 |

依据：[原生接口绑定](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L15-L83) · [截图/SendInput检查](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L100-L153) · [文字实现](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L174-L194) · [窗口实现](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine/win32.ts#L197-L248)。

所查Windows引擎的完整261行未见UIA控件树、IsPassword或输入框文本回读；范围仅限这条实现路径，不声称全仓绝对不存在这些能力。

## 4. 三个不能照搬的听写行为

1. **LF变成Enter**：其通用文字函数将文本中的LF转换成回车按键。对于终端、聊天软件或提交型输入框，这可能产生发送/执行，而不只是插入。我们的听写输入策略须独立处理全文控制字符，不能只去掉结尾换行。
2. **窗口不等于输入目标**：同一浏览器窗口可以有多个输入框。每句写入前复核目标不能只比较窗口标题/前台HWND；需要匹配的控件识别/验证，不能确认时保留预览。
3. **主动聚焦不等于安全恢复**：Coopanion有恢复/激活窗口的通用操作工具；我们的已选策略是用户切换目标后停写，不应自动抢回原窗口继续输入。

这些不是对Coopanion用途的否定：它的通用电脑Agent与我们的逐句听写有不同的交互目标。

## 5. 取消与用户介入

[引擎任务代码](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/src/cua/engine-child.ts#L182-L239)接收cancel消息，长文本按grapheme分组，在组间检查取消或用户活动。发送计数是发送层证据，不是输入框回读证据。

已开始的点击、拖动、按键序列并非每一步都中断。不能承诺停止按钮能撤回已发出的系统事件。我们的回执要区分未发送、部分发送、已发未验证和结果未知；不能把全部异常简单标成“没有写入”。

## 6. 更公平地比较实现路线

| 路线 | 优势 | 需要补足/验证 |
| --- | --- | --- |
| Node/TS + Koffi工作进程 | 主体语言统一，可调用Win32；Coopanion有该架构参考 | UIA/控件语义、密码框、目标绑定与回读需要另做；固定运行时与原生包验证；不能把出进程当免ABI风险 |
| C#/.NET辅助进程 | 有System.Windows.Automation/FlaUI等现成UIA封装，可集中实现Win32和目标检测 | 多一种语言与发布运行时；IPC、目标软件兼容仍须测试；不是“绝不受Electron升级影响” |
| Rust辅助进程 | 可形成原生适配层，发布结构可控 | 开发工具链与库覆盖/成本仍需验证，不因语言就自然更小、更快或更安全 |

Koffi路线不必依赖uiohook/libuiohook；LGPL分发义务是选用具体依赖时的问题，不是所有Node方案必然携带的限制。C#有现成UIA封装是依据事实的优势，“.NET最成熟”没有在本项目做过比较验证，不作为结论。

## 7. 更新后的建议（待Q18选择）

优先固定text.input等能力契约，不把语言写进听写流程。Node与C#都能作为统一插件模型中的实现。

建议先安排一个受控的最小对照验证：在相同输入目标、同样样本与安全约束下，检查按键状态、普通/密码输入框、光标插入、选区、同窗换框、切窗、中文/混说文本、取消与回执，再选择一条主实现。对照原型需在用户允许进入验证阶段后执行，当前只做文档。

若更重视统一TS，Node/Koffi可先作为候选；若更重视直接利用UIA封装，C#仍是合理候选。不能根据“参考项目用了什么”就推断我们的兼容矩阵必定通过，也不承诺维护两套正式引擎。

## 证据与限制

- [包清单](https://github.com/Pal-AI-Lab/Coopanion/blob/3dd0892c2d70a026253ab980af392302b88ff8b1/packages/cortico-world-desktop-pet/package.json#L60-L75)固定Koffi 3.3.1、sherpa-onnx-node 1.13.8、Electron开发依赖44.4.4；这些是该提交的配置，不是本项目版本选择。
- 未下载构建产物、未启动进程、未注入任何输入、未测量性能。
- 未复制AGPL产品实现代码。依据[仅作参考决策](adr/0006-reference-coopanion-without-fork.md)，只借鉴机制和公开API用法。
- 完整结构化观察见[原生实现证据](../research/coopanion-native-implementation.json)；原选型资料见[技术预研](16-technical-recommendations-prep.md)。

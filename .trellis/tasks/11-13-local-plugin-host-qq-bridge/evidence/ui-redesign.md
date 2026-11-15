# 设置台 UI 重构（2026-11-15）

## 结果

设置台从「一个开始页堆所有插件卡」改为分组侧栏：

- 连接：开始、对话
- 助手：人格、外观、桌宠
- 插件：模型、QQ、本地宿主、语音
- 恢复入口（底部）：插件、权限、关于

开始页只保留「连接服务」。模型、QQ、本地宿主、语音、桌宠各自有独立页面；本地宿主的每个 QQ 源使用独立卡片，宿主与来源动作使用图标按钮。说明性小字已删除，仅保留状态、字段提示、错误与停止宿主的危险提示。

## 主要改动

- 新 `console/nav.ts`：页面清单、分组、图标；旧 `shared/console-views.ts` 保留为唯一来源的重导出。
- `minimal-ui/shell.tsx`：按组渲染侧栏标题与分隔；980px 以下收成图标轨。
- `minimal-ui/icons.tsx`：新增自绘线性 SVG（sliders、plug、unplug、refresh、power、stop、external-link、eye/eye-off、key、check、x、chevron、server、model、qq、chat、cat、sun/moon）。
- `minimal-ui/controls.tsx`：`IconButton`（label 必填、variant/busy/focus）、`Button icon`、`Card testId`、`Field hint`。
- `pages/start.tsx`：仅连接卡；地址与令牌 missing 分开；令牌说明缩短；已连接时隐藏重复的「已保存」行；模型与桌宠组件导出供独立页使用。
- 新 `pages/{model,qq,local-host,pet,voice-settings}.tsx`。
- `local-host/**`：每源独立 Card、图标按钮、精简文案。
- `app-views.ts`：恢复入口补入「权限」。
- 测试：`app-pages` 新增独立页 smoke；`settings-shell` 新增分组断言；两个浏览器脚本先点击对应 `nav-*` 再跑原断言。

## 验证（实际执行）

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @pet/desktop typecheck` | exit 0 |
| `pnpm --filter @pet/desktop test -- --run` | exit 0，121 files / 1135 tests |
| `pnpm --filter @pet/desktop build` | exit 0（仅既有 chunk 大小提示） |
| `local-host.browser.mjs` | exit 0，25 项 |
| `qq-status.browser.mjs` | exit 0，7 项 |
| 根 `pnpm lint` / `pnpm format:check` | exit 0 / exit 0 |

## 截图

[截图目录](../../../../qa/fixtures/local-host/evidence/ui-redesign-20261115-2040/)：开始页、本地宿主页、来源卡、模型页、QQ 页、980px 图标侧栏。截图为真实 console 构建产物 + 测试桩桥，不是真实 IPC/宿主进程或真实 QQ。

## 第二轮反馈与 Windows 修复

preview8 将独立本地接入页合并进 QQ 页，插件管理改为按功能模块分组、内部组件默认折叠，语音输入（ASR）与语音输出（TTS）分成两页，TTS 从人格页移出。两页的网关卡读取提供者实际配置与 readiness；不声明网关健康探测，也没有新增强制能力依赖。

preview9 再按用户反馈把卡片改为「QQ 客户端接入」，来源名称集中维护为「SnowLuma / NapCat（OneBot v11）」与「官方 QQ 机器人」，不暗示已经探测或安装客户端。用户实际 Windows 测试定位的启动脚本错误及修复证据见 [Windows 启动回归](windows-startup-fix.md)。

最终验证：`pnpm -r typecheck` exit0；desktop 121 files / 1144 tests passed；local-host 9 files / 39 passed + 1 Windows-only skip；lint/format exit0。第二轮浏览器回归仍为25/25与7/7；命名修正另有组件测试，不能把截图或 Linux 测试当作 Windows 实机通过。

## 限制

用户已经实际运行 Windows preview8，并遇到已定位的 PowerShell 注释故障。修复后的 preview9 仍待 Windows 启动/重连/停止复测；真实 QQ/模型联合验收另行进行。用户随后授权本阶段提交、GitHub 推送与合并，交接以阶段进度和最终发布回执为准。

# M0-06 · 第二轮进程缩放与可访问样式补验

结论：**三档隔离进程渲染通过，不代表物理多屏/系统DPI或OS鼠标输入通过**。本轮不修改系统DPI/电源设置、不移动真实鼠标、不注入OS键盘。

## 方法

[验收脚本](probes/desktop-e2e.mjs)从锁定Electron包的安装目录选择exe，不使用环境替代路径、不隐式下载；实际进程读回Electron45.0.0、Node24.22.0、win32-x64并断言。CLI只允许1/1.25/1.5三档；后两档用force-device-scale-factor。webContents网页zoom必须为1。

每档：真实五状态按钮、隔离桥、非法参数拒绝、原生穿透标志读回、键盘按钮、IPC拖拽生命周期、实际窗口越界恢复、弹窗拒绝；追加computed-style文字与悬停对比、44px目标、12px字、气泡非视觉隐藏、可见焦点、合成错误通知布局。最后关闭自有应用。合成通知只检查CSS布局，不替代React错误链路。

## 观测

| 请求DPR | 实际DPR | CSS视口 | webZoom | 启动焦点 | 脚本结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 380×420 | 1 | 保持 | 通过，9组检查 |
| 1.25 | 1.25 | 383×424 | 1 | 保持 | 通过，9组检查 |
| 1.5 | 1.5 | 380×420 | 1 | 保持 | 通过，9组检查 |

每档consoleErrors和remoteRequests均为空。完整数据含时间、窗口元数据、构建文件哈希、颜色合成两种背景与截图路径，见[结果](V-06-scale-results.json)。

重要限制：125%有少量窗口取整差异；强制DPR时Electron返回的screen.bounds与workArea并不完全同口径（原值未修饰保留）。所以仅用它证明本进程渲染/布局，不把它当真实混合DPI坐标正确性的证据。CSS视口缩小与devicePixelRatio改变也不等价，不能再用380/1.5等式代替实际读回。

## 截图

[150%错误通知布局](../.cache/m0-06-scale-1_5/notice-layout-fixture.png)已由主会话读取并人工核对：核心气泡、状态按钮、退出和通知均可见。截图在忽略缓存，未入Git；每次重跑会更新缓存，历史测量和构建哈希以本报告JSON为准。

## 复现

```sh
pnpm check
node qa/probes/desktop-e2e.mjs 1
node qa/probes/desktop-e2e.mjs 1.25
node qa/probes/desktop-e2e.mjs 1.5
```

没有授权/实测的真实鼠标和物理键盘不由这些自动化结果代替；M0整体仍未最终完成，不进入M1。

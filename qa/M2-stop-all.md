# M2 一键停止宿主命令

已实现TaskSupervisor.cancelAll与DesktopHost.stopAll。取消调用时已有任务，不停用插件或关闭宿主，之后可运行新任务。未结束的工作继续计入pendingWork。

设置窗通过petConsole.stopAll调用，返回最新HostStatus；其它窗口不能调用。不增加通用IPC入口。

验证：3项任务回归、1项新增预加载回归；真实Electron设置窗验证来源与参数，真实worker验证批量取消、预算保留及后续任务可用。

全量1096项测试、QA120通过/1既有权限跳过、严格探针及10条原生流程通过。结果：[真实worker停止](M2-stop-all-runtime-results.json)、[设置窗命令权限](M2-console-host-results.json)。

这是M2-08的宿主命令，托盘菜单与按钮尚待前端实现。

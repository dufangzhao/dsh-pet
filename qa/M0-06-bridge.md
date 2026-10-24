# M0-06 窗口原型接口冻结

这是验证专用接口，不是提前实现M1或冻结正式插件SDK。正式角色功能仍须在M2-07进入可停用的角色插件；原型的模拟状态不代表录音/识别/对话已实现。

## 写入分工

- 主会话：contracts中的原型类型、preload桥、主进程IPC处理/来源参数校验、启动与构建集成、QA实测。
- DeepSeek（前端）：`apps/desktop/src/main/windows/**` 与 `apps/desktop/src/renderer/pet/**`，含这些目录内的单元测试。不得改包清单、预加载或契约；缺依赖报告主会话。
- QA探针与数据由主会话在 `qa/probes/` 与 `qa/` 保留，下载数据/截图只写忽略的 `.cache/`。这补充M0表中省略的可复现验证代码路径，不改变产品决策。

## 渲染器接口

`window.pet` 类型为[PetPrototypeBridge](../packages/contracts/src/pet-prototype.ts)，暴露version=1、getSnapshot、setInteraction、beginDrag、endDrag、previewState、quit、onSnapshot。所有调用返回显式ok/error；订阅返回解除函数。没有通用send/invoke，也不向渲染器传IpcRendererEvent。通道名由[契约](../packages/contracts/src/pet-prototype.ts)中的PET_IPC固定，DeepSeek（前端）不注册IPC。

## DeepSeek（前端） 主窗口导出约定

入口 `apps/desktop/src/main/windows/pet-window.ts` 导出 `createPetWindow(options)`。

- options：`preloadPath: string`，`rendererPath: string`，`onSnapshot: (snapshot: PetSnapshot) => void`。路径是主会话提供的绝对构建产物路径，不能由渲染器指定。
- 返回 controller：`window: BrowserWindow`，`getSnapshot(): PetSnapshot`，`setInteraction(interactive: boolean): void`，`beginDrag(): void`，`endDrag(): void`，`setState(state: PetState): void`，`dispose(): void`。
- 状态变化通过onSnapshot回调，由主会话广播固定事件；初始状态idle。
- renderer入口：`apps/desktop/src/renderer/pet/index.html` 引用本目录main.tsx；使用React，样式可用Tailwind（已安装@tailwindcss/vite）。不使用远端字体/图片或Coopanion资产。

## 行为和安全

透明、无边框、置顶；contextIsolation=true、sandbox=true、nodeIntegration=false；默认ignoreMouseEvents(true, {forward:true})，ready-to-show使用showInactive。仅角色/明确按钮的实际命中区请求interactive=true，空白区域恢复穿透。拖拽坐标从主进程screen.getCursorScreenPoint获取，不信任renderer给坐标；所有几何使用DIP，结束、失焦/关闭时释放计时器。多屏负坐标、不同scaleFactor、移除屏幕后可见恢复必须考虑；不能仅以模拟几何测试宣称真机多屏通过。

主会话校验IPC sender/frame与本地文件URL、参数个数及类型；禁止新窗口、外部导航和未授权权限。只有显式用户退出操作才调用quit；不拦截用户其他应用键盘。原型不采集麦克风、不调用云端、不读Key。

验收：类型检查+单元测试+构建；真实Electron截图；点击/拖拽/穿透/不抢焦点分别有证据，不以IPC返回成功代替OS行为已验证。

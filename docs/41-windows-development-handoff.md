# 在 Windows 继续开发

更新：2026-11-18。面向新的 Windows x64 开发机。桌面客户端在 Windows 运行；可以连接已有远端 Agent 服务，也可以在本机运行 Windows Agent 服务。不要把服务器上的 `node_modules`、Electron、二进制依赖或 `.companion-data` 复制过来。

## 当前代码状态

仓库：<https://github.com/dufangzhao/dsh-pet>。当前开发分支为 `main`；`feat/local-plugin-host-qq-bridge` 已合并进 `main`，不要再切回该分支。拉取后先确认工作树干净。

接手前按顺序读：

- [AGENTS.md](../AGENTS.md) 与 [项目基线](../.trellis/spec/shared/project-baseline.md)
- Windows 服务与打包桌面验收：[11-16-windows-service-deployment](../.trellis/tasks/archive/2026-11/11-16-windows-service-deployment/evidence/windows-service-acceptance.md)
- QQ 接入与后续工作：[11-13-local-plugin-host-qq-bridge 进度](../.trellis/tasks/11-13-local-plugin-host-qq-bridge/progress.md)
- Windows 服务的运行方式与限制：[Windows Agent 服务](42-windows-agent-service.md)

## 准备环境

安装 Git for Windows、Node.js **26.13.0 或兼容的更新版本**，并使用 **pnpm 11.24.0**。Windows 自带的 **64 位 Windows PowerShell 5.1** 必须可用；原生目录与进程辅助脚本由它执行，开发终端可以使用 PowerShell 7。

在 PowerShell 运行：

```powershell
node --version
npm install --global pnpm@11.24.0
pnpm --version
git clone https://github.com/dufangzhao/dsh-pet.git
Set-Location dsh-pet
git switch main
git pull --ff-only
pnpm install --frozen-lockfile --ignore-scripts
```

项目不自动执行第三方安装脚本。Electron 需要单独下载当前锁定的 Windows 运行时：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
node .\node_modules\electron\install.js
pnpm --filter @pet/desktop build
pnpm --filter @pet/desktop start
```

本机实测该安装脚本会报 `TypeError: fetch failed`。若同样失败，可手动取用锁定版本（`node_modules/electron/package.json` 的 `version`）的 `electron-v<version>-win32-x64.zip`，先与 `node_modules/electron/checksums.json` 中的 SHA256 核对，再解压到 `node_modules/electron/dist` 并写入 `path.txt` 为 `electron.exe`；不要跳过校验，也不要把未校验的二进制放进仓库。

后续修改桌面代码后可以运行 `pnpm dev`，它会重建并启动桌面应用。

开发模式使用独立的 `.cache/pet-prototype-profile`。便携测试包使用 Windows 应用数据目录，两者不会自动共享连接配置或密钥。首次打开开发版需重新输入服务地址和访问令牌。

## 连接已有服务

若服务只监听服务器回环地址，在另一个 PowerShell 窗口保持 SSH 隧道：

```powershell
ssh -N -L 4121:127.0.0.1:4121 <用户名>@<服务器地址>
```

开始页服务地址填 `http://127.0.0.1:4121`；令牌从自己已有的安全位置取得，不提交到仓库。模型网关地址属于服务端配置：其中 `127.0.0.1` 指服务所在机器，不能据此认为 Windows 本机已经运行 Magpie。

## Windows 本机 Agent 服务

服务可以在 Windows x64 上原生启动并服务浏览器文本客户端，使用项目 Node：

```powershell
node apps/companion-service/local.mjs start
node apps/companion-service/local.mjs status
node apps/companion-service/local.mjs stop
```

默认端口 `4120`、数据目录 `<仓库>/.companion-data/agent`。模型模式、Magpie 连接、插件可用性和平台限制见 [Windows Agent 服务](42-windows-agent-service.md)。

## 已验与未完成

- Windows Agent 服务通过脚本模式与本地 Magpie 模型模式验收，消息在重启后保留。
- 重建的 preview.11 通过打包桌面生命周期 5/5 检查；桌宠、设置页和 Edge 共享同一段 Agent 对话（7/7），桌面退出后 Edge 仍能继续。
- 同一份 preview.11 在 Windows 桌面和 Edge 上通过任务取消、桌面退出后继续完成、Edge 下载与 Windows 原生保存（5/5）。
- `pet.cloud-exec` 与 `pet.qq-media-codec` 在 Windows 上按设计不可用，因此本机执行任务和 QQ 媒体不会假装成功。
- 真实 QQ 收发还需要授权测试对象；固定 Linux codec 镜像需要在 Linux 主机准备；物理麦克风 ASR 与扬声器 TTS 需要可用的 MiMo 路由和设备试跑。详见 11-13 的进度记录。

常用检查：

```powershell
pnpm -r typecheck
pnpm lint
pnpm format:check
pnpm companion:build
pnpm --filter @pet/desktop test -- --run
```

完整 `pnpm check` 在 Windows 不会全绿：`plugins/cloud-exec` 与 `plugins/qq-media-codec` 只声明 Linux 平台，且 `cloud-exec` 需要 Docker 与非提权用户无法创建的符号链接；这些失败不代表桌面验证结果。桌面套件对并发敏感，必要时加 `--maxWorkers=4`。

## 不随 Git 搬迁的内容

源码、锁文件、Trellis 规格与阶段记录随 Git 交接。ZIP 分发包、`node_modules`、构建产物、私有 Agent 数据、用户聊天、录音、账号密钥和模型权重不入库。继续使用已有远端 Agent 时不必移动其数据库；需要迁移服务数据时按已有的停止服务、完整备份与身份校验流程单独处理。

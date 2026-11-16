# 在 Windows 继续开发

本页面向新的 Windows x64 开发机器。使用本机 PowerShell；桌面客户端在 Windows 运行，已有的持续 Agent 服务可以继续留在 Linux 服务器，不需要把服务数据复制到开发机。

## 代码与阶段入口

仓库：<https://github.com/dufangzhao/dsh-pet>。本阶段工作分支是 `feat/local-plugin-host-qq-bridge`；推送并合并完成后从 `main` 继续。当前实现、验证证据与剩余人工验收集中在 [Trellis 阶段记录](../.trellis/tasks/11-13-local-plugin-host-qq-bridge/progress.md)。先读 [AGENTS.md](../AGENTS.md)、[项目基线](../.trellis/spec/shared/project-baseline.md)和对应层的规范，避免把历史 Demo 指南当作当前服务架构。

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

后续修改桌面代码后可以运行 `pnpm dev`，它会重建并启动桌面应用。不要复制服务器上的 Linux `node_modules`、Electron、二进制依赖或整个 `.companion-data` 到 Windows；在 Windows 重新安装对应平台的依赖。

开发模式使用独立的 `.cache/pet-prototype-profile`。便携测试包使用 Windows 应用数据目录，两者不会自动共享连接配置或密钥。首次打开开发版需重新输入服务地址和访问令牌。

## 连接已有服务

若服务只监听服务器回环地址，在另一个 PowerShell 窗口保持 SSH 隧道：

```powershell
ssh -N -L 4121:127.0.0.1:4121 <用户名>@<服务器地址>
```

开始页服务地址填 `http://127.0.0.1:4121`；令牌从自己已有的安全位置取得，不提交到仓库。模型网关地址属于服务端配置：其中 `127.0.0.1` 指服务所在机器，不能据此认为 Windows 本机已经运行 Magpie。

## 本阶段已实现与待验证

- QQ 页面合并平台状态与客户端接入管理。客户端条目标为 SnowLuma / NapCat（OneBot v11）和官方 QQ 机器人；这些名称表示兼容接入方式，不代表桌宠已经安装、启动或登录外部 QQ 客户端。
- 插件管理按功能模块分组；说话键、采样等内部组件默认折叠。语音输入（ASR）与语音输出（TTS）各有独立设置入口。
- QQ 接入进程独立于桌面窗口。关闭 GUI 不等于停止 QQ 接入；升级前从 QQ 页显式停止旧进程，重新启动后按界面要求补入临时密钥。
- Windows preview8 的启动失败已定位到目录初始化脚本中错误的 `//` 注释。修复使用 PowerShell 的 `#`，保持原有 owner/DACL/reparse 校验；程序故障不再统一当作权限不足。
- 修复后的源码已在本机 Windows 11 x64（build 26200）完成一次真机验收：开发版桌面启动、三类来源在真实界面中授权并让带认证的 OneBot peer 进入 ready、关闭 GUI 后独立进程继续应答、重开 GUI 附着到同一宿主身份与密钥且启动幂等、显式停止后 peer 关闭。证据见 [Windows 设备验收](../.trellis/tasks/11-13-local-plugin-host-qq-bridge/evidence/windows-device-acceptance.md)。这次跑的是开发版，不是打包后的 preview9 ZIP；用的是受控回环 peer，没有真实 QQ、模型、ASR 或 TTS 调用。
- 因此下面的针对性检查已经在本机跑过；仍待确认的是打包 ZIP 自身的启动路径，以及真实账号与语音模型的联调。

```powershell
pnpm --filter @pet/local-host exec vitest run src/windows-private-directory.test.ts
pnpm --filter @pet/desktop typecheck
pnpm --filter @pet/desktop test -- --run
pnpm lint
pnpm format:check
```

第一条会在 Windows 真正创建并校验临时私有目录和文件；同一用例在 Linux 跳过。桌面套件对并发敏感：默认并发下 `shared-voice-host` 与 `shared-companion-host` 偶尔超过 5 秒插件激活预算而失败，单跑该文件或加 `--maxWorkers=4` 即全绿，这是机器被压满所致，不是产品缺陷。完整 `pnpm check` 还包含服务端与 Docker 相关的集成检查，运行条件见 [QQ 验收记录](../qa/companion-qq-acceptance.md)。在 Windows 上它不会全绿：`plugins/cloud-exec` 与 `plugins/qq-media-codec` 只声明了 Linux 平台，且 `cloud-exec` 需要 Docker 与非提权用户无法创建的符号链接，所以这些失败不代表桌面验证结果。

## 在 Windows 本机运行 Agent 服务

服务现在可以在 Windows x64 上启动并服务浏览器文本客户端。用 `node apps/companion-service/local.mjs start|status|stop` 管理；默认端口 4120、数据目录 `<仓库>/.companion-data/agent`。可用能力与平台限制见 [Windows Agent 服务](42-windows-agent-service.md)。

打包产品的生命周期已在本机用重建的 preview 包跑通（启动、关 GUI 后独立进程继续、重开附着、显式停止）；原始 preview9 ZIP 构建于 Linux 且哈希无法在本机复现，重建包不冒充原包。


## 不随 Git 搬迁的内容

源码、锁文件、Trellis 规格与阶段记录随 Git 交接。ZIP 分发包、`node_modules`、构建产物、私有 Agent 数据、用户聊天、录音、账号密钥和模型权重不入库。继续使用已有远端 Agent 时不必移动其数据库；需要迁移服务数据时按已有的停止服务、完整备份与身份校验流程单独处理。

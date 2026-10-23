# M0-02 · 精确版本基线

核查日期：2026-10-24。基于 M0-01 提交 `34066cb`；环境见[基线](M0-00-environment.md)。版本由公开npm元数据、实际安装清单和锁文件核验，不从参考项目版本推断兼容性。

| 组件 | 精确选择 | 核查时latest | 理由/状态 |
| --- | --- | --- | --- |
| Electron | 45.0.0 | 45.0.0 | 开工时当前稳定版；替代参考44.4.4；原生/窗口兼容另测 |
| TypeScript | 6.0.3 | 7.0.2 | typescript-eslint 8.72.0 peer为>=4.8.4 <6.1.0，保留兼容版本 |
| React / react-dom | 19.3.1 | 19.3.1 | 两包同版，React + TS界面基线 |
| Tailwind / @tailwindcss/vite | 4.3.3 | 4.3.3 | 插件peer支持已锁Vite 8 |
| sherpa-onnx-node | 1.13.8 | 2.0.0 | 先保持参考版本，避免同时更换Electron与ASR大版本 |
| sherpa-onnx-win-x64 | 1.13.8 | 不以latest替代 | wrapper的^范围在workspace overrides中精确固定 |
| Koffi | 3.3.1 | 3.3.3 | 先验证参考版本的Win32键态轮询 |
| @deepseek-ai/cordis | 4.0.5 | 4.0.5 | DSH维护发行线；发布包已确认包含类型声明 |
| Vite / Vitest | 8.3.5 / 5.0.5 | 同选择 | M0-01已验证；不是产品功能完成 |
| ESLint / typescript-eslint | 10.13.0 / 8.72.0 | 同选择 | 与TS6.0.3组合已验证 |
| Prettier | 3.9.10 | 同选择 | M0-01格式基线 |
| @types/node | 24.19.2 | 同选择 | 开发Node24类型；不推断Electron内置Node版本 |
| @types/react / @types/react-dom | 19.3.0 | 同选择 | React19.3类型 |
| esbuild | 0.28.2 | 0.28.2 | 验证代码与受沙箱限制的CJS preload打包 |
| @playwright/test | 1.64.1 | 1.64.1 | 本机Electron原型自动化；不下载额外浏览器 |

## 安装与执行政策

根与包清单使用精确版本，开发基础工具使用精确catalog；提交pnpm锁文件。M0验证依赖暂集中在根，桌面React和host-kernel Cordis同时在所属包声明；正式插件接入时再声明自身依赖。

`pnpm install --ignore-scripts`已实测通过（15个workspace项目，exit 0）。workspace保持 `onlyBuiltDependencies: []`。Koffi未运行构建脚本，优先测试已校验的预编译平台包。esbuild使用平台包，若需额外脚本先审阅。

已阅读Electron 45.0.0的安装入口：它没有postinstall，首次require会触发下载；本次改为显式执行已审阅的 `node node_modules/electron/install.js`，使用包内checksums.json，清除镜像/替代目录/远端校验和环境覆盖，固定win32-x64。二进制版本读回与运行结果随后另记；npm安装成功不代表二进制已下载或原生兼容通过。

Node开发机24.18.0、pnpm11.24.0。根engines按计划保留>=22，但Electron安装器要求>=22.12、ESLint工具要求22.13以上或24；推荐复现使用已验证的Node24.18.0，不声称所有Node22小版本均可开发。

## 凭据API版本结论

Electron45文档提供 `isAsyncEncryptionAvailable`、`encryptStringAsync`、`decryptStringAsync`；同步版本已弃用、计划46删除。M1-06采用异步接口，运行可用性必须实际测试。Windows DPAPI不能防同一用户下的其他程序；此处不宣称安全沙箱。

## 一手来源

- [Electron npm](https://registry.npmjs.org/electron/45.0.0) · [Electron45 safeStorage](https://raw.githubusercontent.com/electron/electron/v45.0.0/docs/api/safe-storage.md)。旧stable网页路径返回404，版本判断以npm稳定标签为依据，不用404页面证明版本。
- [Cordis4.0.5](https://registry.npmjs.org/@deepseek-ai%2fcordis/4.0.5) · [发布包文件清单](https://unpkg.com/@deepseek-ai/cordis@4.0.5/?meta)。
- [sherpa1.13.8](https://registry.npmjs.org/sherpa-onnx-node/1.13.8) · [Koffi3.3.1](https://registry.npmjs.org/koffi/3.3.1)。
- [React19.3.1](https://registry.npmjs.org/react/19.3.1) · [Tailwind4.3.3](https://registry.npmjs.org/tailwindcss/4.3.3) · [typescript-eslint8.72.0](https://registry.npmjs.org/typescript-eslint/8.72.0)。

## 本机复验

`pnpm -r typecheck`、`pnpm -r test`（除原型状态校验外仍为空包）、`pnpm lint`、`pnpm format:check`均通过。Electron下载exit 0；主进程/子进程版本、Koffi/sherpa最小加载和safeStorage回环见[运行时记录](M0-runtime-bootstrap.md)，首次探针缺陷及修正均保留。

## 验证门槛

本工作包只固定可复现版本。Cordis生命周期、sherpa两个模型实际出字、Koffi键态/漏检/CPU、窗口行为分别归M0-03至M0-06；未获得相应证据不得标记通过。不使用真实付费接口，没有Key。

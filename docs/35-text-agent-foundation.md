# 独立文字 Agent 服务

这一版提供独立于 Electron/DSH 的文字服务。浏览器面对一个持续存在的 Agent；后台任务使用独立监督作用域，状态、明确保存的偏好和产物可在重连、服务重启及受支持的 Harness 更换后读取。现有桌面 Demo 保留原启动方式和数据，本服务不导入它的历史或凭据。

## 启动

服务端使用 Linux、Node **26.13.0 或更新版本**、pnpm 11.24.0。执行代码还需要可访问的 Docker daemon，以及已由操作者准备、包含 Node 的镜像。插件不会自动拉镜像，也不会回退到宿主机执行。

在仓库根目录安装并构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm companion:build
```

设置独立数据目录和访问令牌后启动：

```sh
export COMPANION_DATA_DIR="$PWD/.companion-data"
export COMPANION_TOKEN='替换为至少24字节的随机访问令牌'
# 选择已准备好的 Node 镜像；未设置时仍可文字交互，执行提供者不启用。
export COMPANION_EXEC_IMAGE='node:26-bookworm-slim'
pnpm companion:start
```

默认地址是 `http://127.0.0.1:4120`。在页面输入同一访问令牌，即可开始文字交流。默认 `scripted` 模式使用真实 Cortico Core 和确定性脚本，界面会标明“离线脚本回复，未调用模型”。可以输入“请创建一个文件”体验真实服务端文件执行；镜像缺失时会显示失败，不会伪造产物。

| 环境变量 | 含义 |
| --- | --- |
| `COMPANION_DATA_DIR` | 独立持久目录；生产部署使用明确的绝对路径 |
| `COMPANION_TOKEN` | 必填，24–512字节；仅通过 Authorization 请求头发送 |
| `COMPANION_HOST` / `COMPANION_PORT` | 监听地址，默认 `127.0.0.1` / `4120` |
| `COMPANION_ORIGIN` | 浏览器公开访问的 origin，例如 TLS 反代域名 |
| `COMPANION_EXEC_IMAGE` | 明确指定的本地镜像引用；保存后下次启动可以沿用 |
| `COMPANION_MODE` | `scripted` 或 `model`，默认前者 |
| `COMPANION_MODEL` | 模型模式必填的模型标识 |
| `COMPANION_MODEL_BASE_URL` | 支持 OpenAI Responses 的 API base URL，例如网关的 `/v1` |
| `COMPANION_MODEL_API_KEY` | 操作者通过环境或密钥管理设施注入的模型凭据 |
| `COMPANION_NAME` / `COMPANION_PERSONA` | 显式设置 Agent 名称/人设；由原有 ConfigService CAS 保存 |

模型模式不会静默切换成脚本。模型凭据经现有 CredentialBroker、来源插件权限和任务作用域借用，不写入插件配置或建立明文凭据回退。原生 Responses transport 的参数、取消信号和部分生成错误保持原样。支持 HTTPS API 和回环地址上的 HTTP 测试服务；具体账号、网关与模型兼容性需要操作者实际验证。

## 使用与运行语义

- 长任务先返回受理回执。仍可继续输入；Cortico 在下一推理步接收新的输入，不需要等整个任务完成。
- 每个任务有自己的停止按钮。`cancel-requested` 表示已请求停止，最终状态依据执行器的实际结算。完成与停止竞争时，已完成的事实保留。
- 文件执行使用 Node ES modules（`import`、顶层 `await`），不是宿主 shell。输入文件和输出路径均为任务相对路径。文件/日志/时间/内存/CPU/PID 有明确上限，当前最多4个并发执行，无隐藏任务队列。
- 浏览器通过认证的 fetch SSE 订阅变化；令牌不在 URL、localStorage 或产物链接中。断线时保留最后确认内容，并将非终态任务标成状态未知；重连从快照及游标对账。
- 页面展示有界的最近消息和任务，省略较早记录或详情时有标记。完整已保留任务可通过 `GET /api/tasks/<id>` 查询；当前界面不是完整历史检索或任务看板。

## 数据与恢复

| 目录 | 所有者与作用 |
| --- | --- |
| `configuration/` | 现有 FileConfigStore：配置及 revision，CAS 单一写入路径 |
| `state/state.sqlite` | SQLite 状态插件：稳定 identity、messages、facts、tasks、artifacts、commands、events |
| `plugin-data/pet.cloud-exec/jobs/` | 隔离工作目录、保留产物及宿主专用 `.records/` 执行记录 |
| `plugin-data/pet.harness-cortico/projections/` | 可重建的 Cortico 私有运行投影，不是产品状态的另一个主库 |

使用同一数据根时只运行一个服务实例；SQLite 的实际独占锁会拒绝另一写入者。备份应在服务停止后覆盖整个数据根。执行器的 `jobs` 布局是此参考服务的固定存储约定，修改目录布局需要明确迁移，不会静默覆盖配置。

正常关闭会等待真实工作清理。服务被强制终止后，容器可能继续运行；下次启动会读取持久执行记录，核对完整 owner/job/execution 标识、容器 ID 与挂载，再停止或检查原容器。已完成的结果和产物可恢复，不重复运行原代码；没有完成证据时保持 `unknown`。同一状态的后续核对仍可补入已验证产物和退出码。无法确认归属或清理时拒绝新执行。

这不提供服务离线期间的独立硬截止、聚合磁盘配额、自动保留期清理、多实例 HA 或透明迁移活进程。部署时由进程管理器负责重启；持久目录不能随服务计算实例一起丢弃。

## 云端部署

最直接的参考部署是在 Linux 主机上运行 Node 服务和 Docker daemon，将数据放在独立持久卷上。服务源码/依赖位于应用目录，状态根独立于应用更新目录。示例进程管理文件见 [systemd unit](deploy/companion.service.example)；反向代理示例见 [Caddy 配置](deploy/companion.Caddyfile.example)。两者是可审阅模板，开发过程没有安装系统服务或发布公网站点。

- 操作者准备 Node 镜像并授予服务账号必要的 Docker 访问权限。只有服务控制面能访问 daemon；工作容器不挂载 Docker socket、服务配置或凭据。
- 工作容器默认无网络、非 root、只读根文件系统，只有自己的工作目录及只读代码文件进入容器。
- 默认回环监听适合本机或 SSH 转发。公网入口使用 TLS 反代，并将 `COMPANION_ORIGIN` 配为实际域名；SSE 需要关闭代理缓冲。
- 如果服务本身放进容器，执行工作目录须在服务和 Docker host 上使用一致的绝对挂载路径。本版没有宣称接受任意远程 Docker 文件路径映射。

## 扩展边界

所有新增实现仍使用同一 `definePlugin` / manifest / PluginManager 模型：

| 模块 | 契约 |
| --- | --- |
| [状态插件](../plugins/state-sqlite/src/index.ts) | `companion.state@1`，原子状态/事件及命令去重 |
| [执行插件](../plugins/cloud-exec/src/index.ts) | `execution.javascript@1` 的 `execute` / `reconcile` |
| [Cortico 适配器](../plugins/harness-cortico/src/index.ts) | `companion.harness@1`，实例化时绑定受控产品端口 |
| [文字客户端](../plugins/text-client/src/index.ts) | `text-client` panel，静态 UI 与真实 HTTP/SSE 协议 |
| [运行时组合](../packages/companion-runtime/src/runtime.ts) | 复用 TaskSupervisor、权限、配置与插件生命周期；维持产品状态归属 |

程序化组合入口为 `createCompanionService(options)` 与 `CompanionPluginHost.create({dataDirectory,plugins})`。默认应用装配当前参考实现；扩展需要声明真实能力、权限和生命周期，而非假定任意第三方框架自动兼容。

管理接口 `POST /api/harness` 使用已注册的 `pluginId/providerId`，当前有 `pet.harness-cortico/cortico` 与明确标注的 `pet.harness-fixture/fixture`。后者只提供确定性文字/上下文验证，不执行模型工具。切换要求安全边界，原实例未确认排空时不会激活替代者。普通文字界面不暴露这些执行会话控制。

## 验证与当前范围

```sh
pnpm check
pnpm test:companion:core
PET_CLOUD_EXEC_IMAGE=<已准备镜像> pnpm test:companion
PET_CLOUD_EXEC_IMAGE=<已准备镜像> PET_CLOUD_EXEC_DOCKER_TEST=1 pnpm --filter @pet/cloud-exec test
```

[验收记录](../qa/companion-acceptance.md)区分包级测试、实际 HTTP/SQLite/Docker、浏览器操作与未执行的外部验证。测试使用临时独立数据、控制的模型协议服务和实际容器，不调用付费模型。

后续按既定范围接入语音/全双工、Live2D、完整管理界面、QQ/哔哩哔哩、语义记忆和第二个真实 Harness。本次没有迁移旧桌面数据，没有真实账号发布，也没有将本地验收包装成付费云部署。

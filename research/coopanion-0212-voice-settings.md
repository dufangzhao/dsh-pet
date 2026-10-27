# Coopanion 语音与设置流程调研

2026-10-27。本轮仅调研，前后端产品实现均未修改。实现基线为 `669da39`；文件版本和核对范围见[证据索引](coopanion-0212-voice-settings.evidence.json)。

## 结论

1. 国内模型来源优先使用 ModelScope，可以继续复用现有 sherpa-onnx-node，无需为接入 FunASR 先引入 Python/PyTorch。
2. Coopanion 安装版确实将 SenseVoice 标作 FunASR，并优先从 ModelScope 获取对应 ONNX 文件；实际推理调用 sherpa-onnx-node。它没有把 ModelScope 下载当作云端 ASR API。
3. 下一阶段应先补配置首次保存与受控设置桥，再让 DeepSeek 实现真实表单；随后复用已缓存模型接通录音与识别。现有界面、配置持久化、公开样本推理分别有证据，尚未构成真实语音对话闭环。

## 版本与方法

| 依据 | 版本与范围 | 能支持的结论 |
| --- | --- | --- |
| 用户安装包 | Coopanion 0.2.12；只读 resources/app | 安装版的代码声明、调用链、模型来源与默认规则 |
| 本地参考源码 | 0.2.10，提交 4afc70898ac1065dd4559d891a2ce0bebd1261f8，观察时工作区干净 | 首页、语音页的组织与接线设计；不冒充 0.2.12 实际渲染状态 |
| 既有识别台架 | 本项目 Electron45、sherpa wrapper/native 1.13.8 | 两个固定模型对公开样本的既有加载与非空输出 |
| 官方资料与专家 | AI Engineer、Backend Architect 的只读核对 | 模型来源、平台支持、许可边界及下一步接口建议 |

安装版版本及许可来自[安装包清单](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/package.json#L2>)。本地参考源码许可证仍为 AGPL-3.0-or-later；遵守[只参考、不二开约定](../docs/adr/0006-reference-coopanion-without-fork.md)，不复制其产品代码、素材、图标或文案。

本轮没有导航或修改运行中的 Coopanion，没有读取其用户配置、Key 或聊天内容，没有录音、重下权重或调用付费识别。REA 6.4.0 生成了补充静态分析；其完整图超出文件工具读取预算，未计入已审阅范围。本报告结论来自列明的逐文件核对与官方资料，不代表全应用或全部运行行为均已验证。

## 安装版的语音机制

### 引擎、模型和下载平台

| 名称 | 在安装版中的含义 | 对本项目的启示 |
| --- | --- | --- |
| FunASR | 设置值 funasr，映射 SenseVoiceSmall | 名称需要同时说明具体模型与运行方式 |
| ModelScope | 模型文件的首选下载镜像 | 下载无需云 ASR Key；下载流与音频发送流分开 |
| sherpa-onnx-node | 当前进程内的本地推理绑定 | 复用已经验证的 Windows CPU 路径 |
| Whisper | 另一种本地整句模型 | 不因此替换本项目已有的原生流式 Paraformer |
| system / api | Windows 识别器 / OpenAI 兼容转写服务 | 本地、系统与云端要分别展示数据去向和验证状态 |

[引擎定义与语言选择](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/config.ts#L131>)和[实际识别器装配](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/world.ts#L644>)相互印证：funasr 交给 SENSEVOICE，后者由 OfflineRecognizer.createAsync 加载。

未指定有效引擎时，安装版按应用语言选择：简繁中文、英文、日文和韩文默认走 FunASR；其他语言走 Whisper。显式配置优先。这是[默认规则](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/config.ts#L143>)，不是本轮对用户当前配置的读取。默认引擎字段本身为空，见[默认配置](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/config.ts#L290>)。

### 模型下载与完整性

[模型清单](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/runtime/store.ts#L45>)给 SenseVoice 固定了文件大小和 SHA-256，来源顺序是 ModelScope、Hugging Face。[ModelSlot.install](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/runtime/store.ts#L232>)逐文件尝试来源，下载到临时文件，校验 SHA-256 后改名；失败清理该临时文件，转向下一来源。RuntimeStore 确实[绑定了这些清单](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/runtime/store.ts#L281>)。

需要保留一个差异：[已存在文件的 has 判定](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/runtime/store.ts#L221>)只比较存在与大小，不能把 ready 状态当作每次重新完成哈希验证。本项目应保留既有加载前固定哈希校验；未来国内来源宜固定仓库修订，再匹配同一哈希，不依赖可变分支名。

镜像间回退只用于取得同一份已固定产物，不能演变为本地识别失败后自动向云端发送录音。

### 整句与流式

[安装版识别配置](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/asr/sherpa.ts#L62>)声明 SenseVoice 的临时重识别间隔为500ms，Whisper 配置为只处理结束的整句；二者均创建 OfflineRecognizer。本轮未实测安装版的实时转写行为。SenseVoice 的临时结果策略不能称为模型原生流式。

[本地加载代码](<C:/Users/ASUS/AppData/Local/Programs/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/asr/sherpa.ts#L168>)选择 CPU，默认两线程，并将 PCM 转为 JS 自有 Float32Array。这与本项目此前解决 Electron 外部缓冲问题的方向一致；不应恢复不兼容的 sherpa.readWave 路径。

## 值得借鉴的界面流程

以下布局依据明确标为 0.2.10 参考源码；安装版语音配置项另由 0.2.12 的配置声明核对。未制作新页面或改写现有 UI。

| 流程 | 源码观察 | 本项目建议 |
| --- | --- | --- |
| 首次使用 | [首页](../Coopanion/console/features/home/index.ts#L50)先呈现模型接入，再是桌宠、主题与其他功能入口 | 开始页指出缺少的能力并链接相应设置，不重新加入全局工具栏 |
| 模型接入 | 同页显示当前服务、测试操作、其他厂商、模型名和密码型 Key 输入框 | 配置保存、凭据保存、连通测试、开始运行分别对应真实后端能力 |
| 语音入口 | [语音页](../Coopanion/console/features/voice/index.ts#L12)挂载桌宠 World 的独立 voice 面板 | 普通用户不必先进入插件树；本项目仍由宿主渲染受限 Schema，不直接执行插件前端代码 |
| 普通与高级 | 非常用模型入口可进入高级模式；[模型状态封装](../Coopanion/console/features/home/model.ts#L13)独立于页面 | 普通页保留关键字段，CPU线程、分句等高级项按需展开 |
| 模型状态 | 下载 absent/working/ready/error 与识别器 stopped/starting/running/error 是两组状态 | 分别显示下载、加载、录音和转写状态，不用一个“已启用”涵盖全部 |

语音普通区建议包含：本地/云端、识别模型、语言、麦克风、模型状态、必要修复入口；高级区容纳线程与分句参数。保存操作放在对应字段组末尾，保留既有键盘焦点、减弱动态和最小窗口要求。

本项目已确认的说话键是同一键的长按/轻点两种行为。安装版的 hold/toggle/always 是另一种设置模型，不直接替换既有需求；250ms初值和既有保留项仍按[实施计划](../docs/19-implementation-plan.md#L19)处理。

## 本地模型选择建议

| 项目候选 | 国内来源 | 必要文件总量 | 能力 |
| --- | --- | --- | --- |
| SenseVoiceSmall INT8 | [ModelScope 转换镜像](https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/files)，修订73eca47697f980daa3d16112404174b6b950b514 | 239,549,735字节，约228.45MiB | 中英日韩粤整句识别 |
| 流式 Paraformer INT8 | [ModelScope 转换镜像](https://modelscope.cn/models/pengzhendong/sherpa-onnx-streaming-paraformer-bilingual-zh-en/files)，修订c9d662eca7ca87765078148501659faa24e842ed | 237,202,501字节，约226.21MiB | 中英原生流式 |

这两组已在项目缓存中有对应候选，首轮接线无需重新下载。SenseVoice 的必要文件大小和摘要已与[固定修订的公开元数据](https://modelscope.cn/api/v1/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/repo/files?Revision=73eca47697f980daa3d16112404174b6b950b514&Recursive=true)核对；本轮没有重新全量哈希缓存或重跑推理。旧台架[记录](../qa/V-03.md#L15)有真实非空输出，但样本不同，不能据此比较准确率或最终决定默认模型。

[sherpa 官方安装说明](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html)列出 Windows x64 和预编译 Node 绑定，无需先安装 Python/CMake/C++ 编译环境。本轮建议保持已固定的1.13.8，不因下载平台更换运行框架。

权重许可与引擎代码许可分开核对。[SenseVoice 官方说明](https://github.com/QwenAudio/SenseVoice#license)明确官方权重可按模型协议商用，同时保留署名及模型命名要求；社区转换与打包产物还需核对各自条款。不能只依据 ModelScope 的 Apache 标签推定全部权利，具体协议见[FunASR MODEL_LICENSE](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)。

## 开发表单前的后端缺口

两位专家分工为 ASR 研究与配置接口审查；下述首次保存缺口也已由主会话逐文件复核，未执行新用例或修改实现。

1. [initialize](../packages/host-kernel/src/config/service.ts#L141)只尝试默认候选；必填字段没有默认值时不创建记录。
2. [get](../packages/host-kernel/src/config/service.ts#L121)把无记录归为 not-ready；[save](../packages/host-kernel/src/config/service.ts#L171)拒绝 revision 小于1，又要求旧记录存在，无法保存用户首次填写的合法配置。
3. [底层CAS](../packages/host-kernel/src/config/store.ts#L12)已经支持以 null 表示“原记录不存在”，并插入 revision1。缺口位于服务入口，无需重建存储框架。
4. [控制台契约](../packages/contracts/src/console.ts#L13)尚无配置读写桥；当前[无参处理器](../apps/desktop/src/main/console-request.ts#L3)直接包装返回值，接 Result 时须避免双层 Result。

建议草案（未实现、未冻结）：

| 接口 | 最小语义 |
| --- | --- |
| inspectConfig | 返回纯数据定义与有效快照；仅确实没有记录时成功返回 snapshot=null，读取不隐式写盘 |
| saveConfig | 接收完整候选与 expectedRevision；0在服务锁内映射底层null CAS，已有记录拒绝覆盖 |
| 独立凭据写入 | 如需真实 Key 输入，走宿主凭据通道，不混入普通配置保存 |

错误、旧Schema、坏文件不能伪装成空配置。已有记录仍遵守版本比较和原子提交；保存返回的 changeMode 仅为生效提示，不自动启用、重载或证明模型可运行。

设置写入只接受当前设置窗口主 frame 与固定 URL。请求使用完整 OwnerRef，校验当前世代后投影稳定二字段身份；允许未启动插件的首次配置。凭据引用保留现有 format:credential-ref 与已声明 keyId 的 enum，不能把“引用已选”显示为“Key已存在/已验证”。

## 重启后的实施顺序

1. 重新检查会话可用子代理模型，恢复 DeepSeek 后再启动前端，使用当前可用的最高推理档；不沿用失效的旧路由名。
2. 主会话补配置 inspect、首次创建和设置桥，冻结 contracts/preload；先测首配、并发CAS、坏记录、旧世代和错窗口。
3. DeepSeek实现 Schema 表单，覆盖必填、枚举、嵌套、数组、草稿、保存失败与冲突；首次配置不能再依赖完整默认值。
4. 复用 SenseVoice 缓存完成16kHz单声道自有PCM到ASR worker的真实定稿链路，再接已有 Paraformer；首个切片可手动结束，不标为完整PRD通过。
5. 后续完成麦克风权限、按键/静音、取消与晚到丢弃、对话和真实服务接线。录音、模型推理、对话流式响应必须分别实测；真实付费调用仍需用户提供Key并同意。

详细可交互对照页面仍待后续，前端开发本轮暂停；未采集真实麦克风音频，不宣称已完成语音闭环或全部M0/M2验收。

# 第三方材料与许可边界

本项目自有代码与原创文档采用[MIT许可证](LICENSE)。该声明不重新授权第三方代码、字体、模型权重、声音、角色、美术、商标或被引用的原始材料。

## 当前仓库

- 调研文档与JSON中的第三方资料、短摘录、文件路径和链接用于研究溯源；原始材料依其各自权利与许可。
- [既有可视化研究报告](research/report/ai-desktop-pet-research-20261023.html)由visual-explainer工具生成，其中内嵌的第三方渲染脚本/样式不因根目录MIT声明而被重新许可。该文件是研究交付物，不作为产品运行时代码复用；若未来要随产品分发，先核验工具包及内嵌资源许可并保留必要声明。
- Coopanion官方截图只用于本地研究缓存，未作为产品资产纳入版本；文档中的外部截图链接不表示再分发授权。
- 已建立M0工程与验证依赖，精确版本见[版本基线](qa/versions.md)，完整依赖图见[pnpm锁文件](pnpm-lock.yaml)。Electron、React、Tailwind、Cordis、Koffi、Vite、Vitest、esbuild等直接依赖声明MIT；TypeScript、sherpa-onnx-node、Playwright声明Apache-2.0。分发前仍须生成完整传递依赖及NOTICE清单，不能只凭此摘要完成发行许可验收。
- 未把Coopanion或其他桌宠项目的产品源码、素材、图片或文案复制进来。
- ASR验证模型与公开样本仅下载到忽略缓存，不入库、不随产品分发。[验证清单](qa/M0-asr-fixtures.json)记录固定来源、修订及哈希；SenseVoice权重遵循其独立FunASR模型协议1.1，不因引擎Apache-2.0或本项目MIT而重新许可；Paraformer转换仓库模型卡标Apache-2.0，但正式分发仍须复核上游及附带资源。

## 后续引入要求

1. 固定来源、版本/提交、许可证、适用NOTICE和用途，建立第三方清单。
2. 代码与模型权重分别核验；模型转换、压缩或微调不自动清除原始许可义务。
3. 声音参考录音、克隆结果、角色形象和商标独立核验，不由代码许可证覆盖。
4. 现行Coopanion的AGPL产品代码不得直接改标MIT；其MIT的Cortico子项目也不授权复制AGPL桌宠World或受限素材。
5. 如果考虑旧版本MIT快照，需要单独固定代码与当时许可，检查后续差异和第三方内容；不能据此把当前版本整体视作MIT。
6. 独立第三方插件不因遵守SDK就自动采用MIT；兼容、分发和产品内安装政策另行制定。

以上是工程合规边界，不替代具体分发场景的法律审查。

## 智能体底层与加载器

- Cortico 0.2.7：MIT，Copyright (c) 2026 Phantivia，发布提交 cb9ddbd685bcccba1f29905098648f46a79b3862。保留随包 LICENSE；来源 https://github.com/Pal-AI-Lab/Cortico 。此依赖不包含 Coopanion 产品代码或角色资产。
- tsx 4.23.15：MIT，作者 privatenumber，用于 Cortico TypeScript/ESM 加载。保留随包许可；来源 https://github.com/privatenumber/tsx 。

## Historical Start design lab assets

The isolated review presentation uses morphicons2.0.2 (MIT, Copyright2026Guillermo) for SVG state transitions, with original24-unit glyph data. It adds one runtime package and no transitive runtime dependencies. Three restrained Uiverse affordances are adapted to semantic controls and project tokens: [alexruix switch](https://uiverse.io/alexruix/silent-otter-72), [Maximinodotpy input](https://uiverse.io/Maximinodotpy/thin-sheep-13), [cssbuttons-io button](https://uiverse.io/cssbuttons-io/wonderful-baboon-62). Their individual pages each supply an MIT notice naming the author. Full notices are retained in [the lab asset notices](apps/desktop/src/renderer/console/start-designs/asset-notices.txt). Morphicons supplies animation, not the glyph family; no Lucide runtime package or Coopanion product asset is included.

## 网站来源控件基础（2026-10-30）

采用 Uiverse 作者 **andrew-demchenk0** 的已发表控件代码作为基础，固定来自官方 [uiverse-io/galaxy](https://github.com/uiverse-io/galaxy) 提交 `adbd2adde0a299a3956ea288fb444ec01891ca41`。它们是同作者、共同描边/投影语言的组件组合，不声称官方完整设计系统。

- 核心：[按钮 afraid-squid-51](https://uiverse.io/andrew-demchenk0/afraid-squid-51)、[输入 polite-stingray-67](https://uiverse.io/andrew-demchenk0/polite-stingray-67)、[开关 empty-penguin-100](https://uiverse.io/andrew-demchenk0/empty-penguin-100)。
- 补充采用的原件：[选项组 stupid-seahorse-9](https://uiverse.io/andrew-demchenk0/stupid-seahorse-9)、[表单面板 afraid-cougar-9](https://uiverse.io/andrew-demchenk0/afraid-cougar-9)。
- 原 HTML/CSS 与作者注释保留在 [site-ui/upstream](apps/desktop/src/renderer/console/site-ui/upstream/)，完整 [MIT 许可](apps/desktop/src/renderer/console/site-ui/upstream/LICENSE.md) 为 Copyright (c) 2023 Uiverse.io。具体出处与适配范围见 [来源清单](apps/desktop/src/renderer/console/site-ui/source-manifest.json)。命名空间、中文标签、语义/键盘、流式尺寸、深色与状态反馈属于适配；菜单和软件外壳布局属于沿用这套基础的本地补充。

图标采用 Morphicons 网站支持的 **Tabler outline** 资源：17 个实际 SVG 与 IconNode 数据固定在 Tabler 提交 `ed177a085b652fe04ec4f37ced867c94621e7840`，[原始图标](apps/desktop/src/renderer/console/site-ui/assets/icons/)附 [MIT 许可](apps/desktop/src/renderer/console/site-ui/assets/TABLER-LICENSE.txt)，Copyright (c) 2020-2026 Paweł Kuna。形变使用已安装的 morphicons 2.0.2，附其 [MIT 许可](apps/desktop/src/renderer/console/site-ui/assets/MORPHICONS-LICENSE.txt)，Copyright (c) 2026 Guillermo。这次采用的字形不是项目自绘数据。

## LobeHub provider icons

The settings model selector uses13 selected SVGs from @lobehub/icons-static-svg1.101.0, MIT, Copyright(c)2023LobeHub. Source: https://github.com/lobehub/lobe-icons. Exact package integrity and service mapping are in [the icon manifest](apps/desktop/src/renderer/console/vendor-icons/manifest.json); the full [MIT notice](apps/desktop/src/renderer/console/vendor-icons/LICENSE.txt) accompanies them. Provider names and marks identify their respective services. No runtime icon dependency is installed.

# 简约桌宠设置预览

打开 [index.html](index.html)，或双击项目根目录的 [Preview-Minimal-Settings.cmd](../../Preview-Minimal-Settings.cmd)。[开始页宽版预览](screenshots/start-pet-wide.png) · [开始页主题区](screenshots/start-interface-theme.png) · [浏览器检查记录](screenshots/browser-report.json)。

已完成开始、人设、装扮、对话、语音输入、插件、关于七个默认入口。Chrome验证1200/880两种宽度下14个默认页面场景，以及1142×804的模型控件、原生下拉、确认弹窗、焦点、多行输入、明暗主题与本地草稿；0页面异常、0远端请求，浏览器存储未写入。开始页采用项目自己的宽版桌宠预览与主题卡片，只参考Coopanion的内容排布。

选定基础：[micaelgomestavares / dull-walrus-66](https://uiverse.io/micaelgomestavares/dull-walrus-66)，Uiverse Forms 的 Favorites 排序第6（2026-10-31）。它本身是登录表单；本预览把其视觉规则扩展到桌宠设置，没有移植登录业务。

来源原件：[HTML](source/original.html)、[CSS](source/original.css)、[元数据](source/source.json)、[MIT](source/LICENSE.md)。CSS从原站公开SoftwareSourceCode元数据提取。保留白色表面、20px面板/10px字段圆角、浅灰输入边框、黑色主按钮、蓝色焦点。

按钮沿用 [micaelgomestavares 表单原件](https://uiverse.io/micaelgomestavares/dull-walrus-66) 的素色规则：黑底主操作、白底细边框次操作、10px 圆角和轻微底色反馈。辅助说明小字已移除，仅保留标题、标签、数值与必要结果状态。

页面结构、开关、分段选择、列表和设置组合是按同一视觉语言制作的本地扩展。图标复用项目已有Tabler outline；[简约形象](assets/pet-minimal.svg)与[圆头形象](assets/pet-round.svg)按项目PetAvatar的几何与默认配色导出，用作静态示例，不引入外部角色。

服务下拉的选中项与7个选项保留真实品牌图标，复用已有 [LobeHub 图标清单](../../apps/desktop/src/renderer/console/vendor-icons/manifest.json)（1.101.0，[MIT](../../apps/desktop/src/renderer/console/vendor-icons/LICENSE.txt)）。服务与设置下拉使用原生可定制select，在Chrome156验证展开画面、窄窗边界、键盘选择、Esc与外部关闭；没有增加JS菜单状态或图标副本。[展开效果](screenshots/provider-open-1200.png) · [下拉检查记录](screenshots/dropdown-report.json)。

人设页顶部切换“习惯设置 / 人格模板”。习惯包括通用、行为互动、显示和音效；内置默认说话声位于音效区。人格模板支持独立草稿、新建、复制、重置与本次预览内保留，试听为独立合成音演示。[人设验证记录](screenshots/persona-report.json) · [习惯](screenshots/persona-1200.png) · [人格模板](screenshots/persona-templates-1200.png) · [音效](screenshots/persona-sound.png)。

装扮采用上方大预览框与下方形象/配色/服装缩略图行，仅一个“导入装扮包”按钮。一份包绑定三类内容，切换形象同步切换该包的配色与服装，未制作的内容留空；单文件包导入只在本次页面中预览。音效按“播放音效→说话”逐级展开，删除重复的念出气泡文字开关。[装扮效果](screenshots/appearance-assets-1200.png) · [装扮验证](screenshots/appearance-report.json)。

[前端与后端接口对照](../../docs/frontend-api-contract.md)统一记录现有契约、待开发能力和本地UI行为，供定稿后接入使用。

语音输入按系统内置插件规划，页面完整展示FunASR、Whisper、Windows自带、OpenAI兼容转写接口四类引擎；两个固定本地模型的大小/语言/下载状态、接口地址/模型/Key按引擎显示。麦克风可选择系统默认与示例设备，并展示未收音状态和电平；另有可修改的说话按键与识别结果。模型下载只演示本地进度。按住和短按两种固定手势同时演示，不显示收音模式设置；按键、服务和录音只改变本地预览状态。[语音检查记录](screenshots/voice-report.json)。

“权限与数据”独立分栏已移除。语音输入设置页随插件页的启用/停用出现或撤回；页面内的语音功能开关关闭后仍保留配置入口。相关生命周期演示见[页面贡献检查记录](screenshots/plugin-pages-report.json)，运行时归属和现有能力边界见接口文档。

开始页桌宠区域的“气泡预览”提供回复、思考、逐字显示、选项、输入、错误和长文本七种场景，支持深浅场景和左/中/右锚点。沿用项目自己的角色，参考Coopanion的共用主气泡/用户气泡结构；表层显现不是模型原始流。插件页新增可停用的“内置说话”，停用会禁用声源/试听且保留文本。[气泡与说话插件检查记录](screenshots/bubble-report.json)。

当前仅制作独立的HTML前端预览与本地演示交互，不接入真实桌宠、不调用服务商或麦克风，也不写入应用配置。接入草稿已隔离保存，等整套页面调整定稿后再统一迁移并实现对应后端。

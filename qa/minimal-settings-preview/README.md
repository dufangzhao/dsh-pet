# 简约桌宠设置预览

打开 [index.html](index.html)，或双击项目根目录的 [Preview-Minimal-Settings.cmd](../../Preview-Minimal-Settings.cmd)。[原件与三页对照图](screenshots/minimal-settings-overview.png) · [浏览器检查记录](screenshots/browser-report.json)。

已完成开始、装扮、语音输入三页的外观与本地交互；其余侧栏入口保留位置并指向范围说明。实际Chrome在1200/880两种宽度下验证了三页互斥、字段边界、图片加载、Provider/Key显示、角色/大小切换、本地草稿与滚动位置，6张页面截图，0页面异常、0远端请求，浏览器存储未写入。

选定基础：[micaelgomestavares / dull-walrus-66](https://uiverse.io/micaelgomestavares/dull-walrus-66)，Uiverse Forms 的 Favorites 排序第6（2026-10-31）。它本身是登录表单；本预览把其视觉规则扩展到桌宠设置，没有移植登录业务。

来源原件：[HTML](source/original.html)、[CSS](source/original.css)、[元数据](source/source.json)、[MIT](source/LICENSE.md)。CSS从原站公开SoftwareSourceCode元数据提取。保留白色表面、20px面板/10px字段圆角、浅灰输入边框、黑色主按钮、蓝色焦点。

页面结构、开关、分段选择、列表和设置组合是按同一视觉语言制作的本地扩展。图标复用项目已有Tabler outline；[简约形象](assets/pet-minimal.svg)与[圆头形象](assets/pet-round.svg)按项目PetAvatar的几何与默认配色导出，用作静态示例，不引入外部角色。

本阶段仅作界面预览，使用示例内容与浏览器本地交互，不修改应用默认、不连接后台，也不保存真实资料。

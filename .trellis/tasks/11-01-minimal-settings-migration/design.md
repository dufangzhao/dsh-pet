# 先定稿前端，再统一接入

当前只维护qa/minimal-settings-preview/index.html、style.css、preview.js与本地素材。原生HTML控件保留键盘与焦点行为，一份临时草稿状态，不调用服务商、麦克风、真实插件管理或应用保存接口。按钮只表达本地预览，不制造连接、保存或审批成功回执。

应用迁移代码已保存到隔离分支7a32e3b；当前预览不能import该分支下runtimeCSS或依赖其组件。功能/状态能力清单保留在capability-map.md供定稿后使用。

后续整体迁移时才启用runtime-ui-contract.md中的接缝和原有所有者。现在不修改应用默认页、Main/preload、运行时配置或后端。

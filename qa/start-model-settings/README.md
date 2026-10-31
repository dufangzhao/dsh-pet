# 开始页模型设置验收

开始页现在集中服务商、模型名/获取模型、思考强度和测试连接。获取使用当前填写的 Key；留空时使用该服务商已保存的凭据。测试也针对当前草稿。保存并开始沿用原配置版本检查，持久化模型与自动/低/中/高思考强度；是否激活仍由真实探测回执决定。参考 Coopanion 保持只读。

`pnpm check` 全部通过，原始输出见 [workspace-check.log](workspace-check.log)。[隔离 Electron 验收记录](report.json)通过七项真实窗口流程：模型列表、未保存草稿的高强度测试、认证失败、Key 编辑后的晚到结果、服务商切换、强度保存但拒绝探测不激活、保存后复用原凭据。测试保留真实权限对话，使用受控服务端返回，没有使用线上账户。

[宽窗模型配置](start-controls-1200.png) · [窄窗模型配置](start-controls-880.png)。[验收脚本](../probes/start-model-settings-e2e.mjs)与[受控响应](../probes/fixtures/start-model-settings-main.mjs)均可复现。

简约外观预览中的“下一步：装扮桌宠”和“去语音输入”两个跳转按钮已经删除，[预览](../minimal-settings-preview/index.html)仍保持其外观稿定位。

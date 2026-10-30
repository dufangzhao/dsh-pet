# Writer A：Precision 与 Folio 的实际差别

结论：两家不是同一套模板换 CSS。元素层级、控件种类、挑选服务的方式、开关的构造、状态的表达、导航形状都不一样；两边都只借 headless 的 model 与两个适配器，没有一个 pb-* 组件，也没有一个 StartSlot。

## 具体对照

| 位置 | Precision（仪器面板） | Folio（稿纸） |
| --- | --- | --- |
| 窗口外壳 | 深色标题条 + 读数带 + 底部状态栏；直角、一根线框、点阵网格 | 天头书名行 + 页码 + 地脚；纸色底、左侧装订暗纹、细规则 |
| 导航 | 顶部挡位 tablist（role=tab / aria-selected），一次一个分区 | 左侧目次（ol + 中文序号 + 勾形当前位置 + 实线下划线），天头跟着报「几 · 页名」 |
| 字体 | system-ui 无衬线 + 等宽（机位号、值、状态码），13px/1.45，密 | 本机宋体系衬线（Songti/STSong/SimSun/Source Han Serif）+ 斜体补充，15.5px/1.75，宽 |
| 挑服务 | 原生 \`<select>\` 下拉（每 option 写平台与状态，未接入的 disabled）+ 搜索行 + \`<table>\` 行（序号/服务/端点标识/此刻，当前行 aria-current 与左侧实心规） | 文字索引 \`<ol>\`：条目是一行排印文字（勾形 + 名称 + 引绳 + 状态语），第二行是等宽端点与平台；当前条目打 ✓ 并加实线；没有下拉、没有表格、没有卡片 |
| 附加筛选 | 一行一事的 role=switch 插销（只看接得进来的） | 用搜索文字筛，另加一条勾选「只看接得进来的」式的记号行 |
| 字段 | 上标签 / 一根框线输入 / 下面一行读数（mono 值、mono Key），失败时框线变红加粗 | 名称在左、值在右，只有一根下划线；焦点让这根线加粗变色，失败时下划线变红并补一句 |
| 动作 | 描边按钮（1px 框、按下换底色）、唯一实心 primary、行内 ghost 下划线词、danger；等待是转圈记号 + aria-busy | 纯文字动作词：没有框没有底色，只有一根下划线；实心=加粗+2px 双线；等待是三个点依次亮（steps 动画）+ aria-busy |
| 开关/选定 | role=switch 的插销行（开/关另用文字写一遍） | 真 checkbox / radio 的「✓」记号行（暂时不回应、夜灯、桌面可见、挡位三挡） |
| 状态与回执 | dl/dt/dd 读数行（键 + 等宽值），保存回执是三条事实分开：写进本机 / 本次探测 / 现在在用 | 骑缝单据：名称 + 引绳 + 右对齐值；保存回执是一张「存根」齿口纸条（纸色深一档、上下虚线） |
| 桌宠预览 | 点阵视口 + 裁切规线，角色可戳可挪；下方 dt/dd 遥测（状态/神情/形态/说话/录音）；说话是行内输入 + 实心发送；便签是菜单区 | 图版插页 + 四角裁切规线；气泡排成带左侧规线的引文；三行勾选（不回应 / 夜灯 / 桌面留着它）；「写给它」与「念一句」都是文字动作；便签是夹在页间斜放的小纸条 |
| 配色 36 格 | 两栏：左栏挡位 radio + 方案下拉 + 名称 + 色带 + 四个动作；右栏五组小表，每组「标签 + 变量名 / 取色器 / 大写十六进制」 | 四开色表：一组一标题（细实线），每格是「色块 + 名称与变量名 + 手写体十六进制 + 取色器」，认不出的那格下划线变红并附一句「没写进草稿」 |
| 控件样张 | 挡位「控件板」；动作/输入/一行一事/目录行四块，虚线框分组，data-sample | 目次「伍 · 控件样张」；文字动作/划线字段/勾选记号/骑缝单据/索引条目五块 |

## 保住的真实能力

保存并开始、测试连接、浏览器登录与取消、去申请 Key、换平台、管理模型扩展、重新读取、暂时不回应、桌面显示/隐藏、装扮、语音设置、说话（会话所有者）、录音（录音所有者、剩多少秒、取消）、右键便签与菜单键、戳与拖动、夜灯；配色 36 格编辑、方案名、三挡、挑方案、保存、另存自定义、撤销未保存试色、二次确认删除 —— 全部走 StartModel 与 useFamilyPreview / useFamilyTheme，不新建存储、不开第二条会话、不抢麦克风、不伪造回执。

## 呈现种子

- \`PRECISION_SEED\`：中性仪器灰 + 钢青强调（浅/黑各一份）。
- \`FOLIO_SEED\`：米纸 + 墨 + 褐红批注（浅/黑各一份，夜读仍是纸）。
- 换家族只贴自己根节点的变量；一旦在这一家里做了配色动作，种子让位给本机记录（页脚明写「呈现种子 / 本机记录」），从不覆盖用户偏好。

## locator 约定

家族根：\`sf-precision\` / \`sf-folio\`。共享动作 id 与旧版一致，QA 可以同一套脚本走两家：
\`start-status\`、\`start-paused\`、\`start-notice\`、\`start-error\`、\`start-provider\`、\`model-provider-search\`、\`model-provider-count\`、\`model-pick-<id>\`、\`start-connect-form\`、\`model-input\`、\`key-input\`、\`model-save\`、\`model-test\`、\`model-signin\`、\`model-signin-cancel\`、\`model-getkey\`、\`model-region\`、\`model-manage\`、\`model-refresh\`、\`model-receipt\`、\`start-pet\`、\`pet-stage\`、\`pet-poke\`、\`pet-pause\`、\`pet-hide\`、\`pet-show\`（Folio 是 \`pet-visible\` 一条勾选）、\`pet-dress\`、\`pet-voice\`、\`pet-composer-input\`、\`pet-composer-send\`、\`pet-mic-toggle\`、\`pet-light-toggle\`、\`pet-menu\`、\`start-theme\`、\`theme-mode-<x>\`、\`theme-scheme-select\`、\`theme-name\`、\`theme-token-<key>\`、\`theme-hex-<key>\`、\`theme-save\`、\`theme-copy\`（Folio 同名）、\`theme-undo\`、\`theme-delete\`。
家族自己的：\`px-panel-<id>\`、\`px-board\`、\`fl-leaf-<id>\`、\`fl-specimen\`。

## 交付文件

- apps/desktop/src/renderer/console/style-families/precision.tsx / precision.css
- apps/desktop/src/renderer/console/style-families/folio.tsx / folio.css（含 \`FOLIO_FAMILY\` 描述子）
- 焦点测试：precision.test.tsx、folio.test.tsx（共用存根 stub-model.ts）
- 校验：tsc 无错（这几份）、eslint 无告警、prettier 通过、16 条本族断言全绿（含「不许出现 pb-* / sc-*」「样张不与整窗同屏」「testid 落在真实按钮上」）。

## 已知限制（一次说清）

- 没有新建字体、没有下载任何东西：衬线走本机宋体系，缺失时落回 Georgia/serif。
- 两家都不写存储、不发请求、不接 IPC 路由；所有"能不能按"取 behavior.ts 的判断反面。
- 未做原生 1200/880 截图（父级负责）：CSS 在 940px 以下已把分屏/两栏收成单列，目次改横排，并全量遵守 prefers-reduced-motion。

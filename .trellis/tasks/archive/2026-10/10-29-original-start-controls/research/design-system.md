# 原创设计系统与外壳（饲养台 / pet bench）

结论：Start 的呈现层已经换成一套自己的控件与外壳，不是复刻控件换皮。控件、外壳、令牌、样板台各自一个文件，五个版式与两处工作室共用同一批 import。

## 一、这套产品的样子

主题是「桌面上活着的家伙」，控制面因此是**饲养台**，不是 SaaS 表单：三样东西反复出现，其余一律不加。

1. **板底搁置**：每块可点/可填的板底下有一道 2px 实边。按下去板面沉到这道边上（位移 2px、阴影收掉）。按下反馈是手感，不是换色。
2. **切角铭牌**：字段铭牌与状态牌右上角切掉一格，像抽屉上的金属牌。只用在牌类上，大面板不用。
3. **方销**：开关的销、瓦片右下角的销都是 2px 圆角的方块。全套没有一处胶囊、没有一处滑动轨道。

- **字型**（全部本机已有，不下载）：标题/导航/铭牌 = Bahnschrift SemiCondensed → Segoe UI Variable Display → 微软雅黑 UI；正文 = 微软雅黑 UI 优先（中文才是主角），等宽 = Cascadia Mono（Key、模型名、十六进制值走等宽，少一位看得出来）。
- **色**：颜色值由界面配色的 36 格词表落地，控件层只写语义映射与结构。默认方案 青港：瓷灰底 + 梅子信号 + 铜扣边界；明确不再是旧薄荷 #00a870。三套内置值见 [palettes.json](./palettes.json)。
- **记号**：品牌标记 = 切角牌 + 一枚肉垫（apps/desktop/src/renderer/console/icons.tsx 的 BrandMark），与导航同一格、同一 1.6 线宽。

## 二、文件与所有权（本轮冻结）

| 文件 | 内容 |
| --- | --- |
| [kit.tsx](../../../../apps/desktop/src/renderer/console/original-ui/kit.tsx) | 七个控件：Button / Field / Toggle / Status / Notice / Tile / Disclosure |
| [kit.css](../../../../apps/desktop/src/renderer/console/original-ui/kit.css) | 控件形状 + 样板台布局，不写具体色值（厂商井格的白底除外） |
| [design-tokens.css](../../../../apps/desktop/src/renderer/console/original-ui/design-tokens.css) | 结构令牌（字体、密度、切角、按压、时长、焦点）+ 语义色映射 |
| [control-board.tsx](../../../../apps/desktop/src/renderer/console/original-ui/control-board.tsx) | 真实状态样板台（能真点真填，无假后端） |
| [settings-shell.tsx](../../../../apps/desktop/src/renderer/console/settings-shell.tsx) / [.css](../../../../apps/desktop/src/renderer/console/settings-shell.css) | 外壳：侧栏/导航/页面头/分节/两轨行/底部常驻运行与主题栏 |
| [console-app.tsx](../../../../apps/desktop/src/renderer/console/console-app.tsx) | 只动 chrome：运行栏、主题单选板、导航插槽、回执槽、对话框脚部按钮 |
| [icons.tsx](../../../../apps/desktop/src/renderer/console/icons.tsx) | 导航字形 + 自家 BrandMark / Cat / Paw / Hide / Moon |
| [kit.test.tsx](../../../../apps/desktop/src/renderer/console/original-ui/kit.test.tsx) / [settings-shell.test.tsx](../../../../apps/desktop/src/renderer/console/settings-shell.test.tsx) | 输出回归（原生属性、禁用、关联、播报），不测像素 |
| theme.ts / theme-studio / sections / variants / use-start-model | 分别归 C（配色所有者）与 B（模型接线与版式）；我不写 |

## 三、控件契约（给 B/C 的接口，已实现）

导入：console 根目录用 ./original-ui/kit.js，start-designs 下用 ../original-ui/kit.js，variants 下用 ../../original-ui/kit.js。kit.tsx 自带两条 CSS import，消费者不用再导样式。

- **Button**：原生 button props + variant('primary'|'neutral'|'quiet'|'danger') + size('normal'|'small') + busy + leading。busy 时真的 disabled 并带 aria-busy 与板内等待记号；type 默认 button。
- **Field**：label / hint / error / className + children。children 给节点＝整块板子是 <label>（一格一个控件，浏览器隐式关联）；给函数＝拿 {inputId, labelId, describedBy, invalid} 自己接（单选组、色值+十六进制）。**hint 与 error 都在 label 之外**，所以可访问名称只有 label 那一句；函数模式把它们串进 aria-describedby。裸控件类：.pb-input / .pb-select / .pb-input--bad。
- **Toggle**：label / hint / pressed / onChange(next:boolean) / className，其余原生 checkbox props 全透传到 <input>（data-testid 直接进真控件，没有第二套命名）。内部 <input type="checkbox" role="switch"> 铺满方板，空格、Tab、读屏都是浏览器行为；板上「开/关」是 aria-hidden 的辅助字。
- **Status**：tone('neutral'|'on'|'off'|'ok'|'warn'|'danger') + children。灯 + 文字，文字永远在场。取代 pk-pill / StatusBadge 呈现。
- **Notice**：tone('neutral'|'ok'|'warn'|'danger') + live(默认 true) + action + children。live 时 danger→role=alert，其余→role=status；live=false 时不带 role。取代 start-result / 行内错误段的呈现；外壳内的行错误用 .pb-row__error。
- **Tile**：原生 button props + selected + leading + note。默认 aria-pressed；一组必须单选时直接传 role="radio" 与 aria-checked。取代胶囊芯片行。
- **Disclosure**：label / hint / open / onOpenChange / defaultOpen / children → 原生 details/summary。React 的 details 不认 defaultOpen 这个 prop，所以本套把它落成 open 初值（否则控制台会报未知 prop，且展开态不可控）。

主题三态这类互斥选择用 kit.css 里的单选板（不导组件，直接写原生 radio）：
<span class="pb-choice" role="radiogroup" aria-labelledby=…> → <label class="pb-choice__option"><input type=radio …/><span class="pb-choice__text">浅色</span></label>。选中那档自己落成强调板。

## 四、外壳与 QA 锚点

对外名字保持不变：SettingsShell / SettingsSection / SettingsRow / SettingsRows / SettingsNavItem / SettingsRowControl / SettingsPillTone。data-rail 只有 **expanded / collapsed** 两种值。

- 锚点：settings-shell、settings-sidebar、settings-main、settings-content，另有 settings-nav、settings-notice、settings-skip。
- 全场唯一动作保持唯一：start-guide（标题右侧那颗）、model-pause（底部运行栏那颗）；导航仍是真实 button + aria-current="page"，无锚点、无 hash。
- class：pb-shell / pb-rail / pb-nav / pb-main / pb-sheet / pb-rows / pb-row / pb-run / pb-modes；折叠时文字仍在 DOM（读屏与 title 拿得到），只是 clip 掉不占位。
- 已删除且不留兼容层：.pk-settings*、.pk-rows/.pk-row*、.pk-sheet*、.pk-pill*、.console-segmented*、.console-run*、.console-theme、.pk-settings__recording（换成 .pb-strip）。probe 按上面这套改。

## 五、五个版式怎么保持一致

版式只决定摆放，不决定控件：状态、厂商目录、模型表单、桌宠预览、配色工作室各只有一份，全部经 kit 的七个控件画出来；分节与行用外壳的 SettingsSection/SettingsRow，所以顶轨、搁置、切角、密度在 bench/switchboard/spine/stage/workspaces 里是同一份 CSS。窄到 880×600 时先收正文外边距与行的两轨（.pb-row--stack），不缩控件、不掉 44px 点击区。

## 六、来源与许可账

| 材料 | 用途 | 结论 |
| --- | --- | --- |
| Morphicons 2.0.2（MIT, Guillermo） | 已在 apps/desktop 依赖里；MorphIcon 接受 IconNode（lucide 风格 [tag,attrs] 数组）或裸 d 字符串 | 本轮**没有新增任何图标运行时到 Start**：外壳与样板台用自家 24 格字形。两态形变（play/pause、eye/hide、sun/moon、mic/stop）随时可以喂这些数据；注意 morph 需要两端拓扑相近，子路径数差得多时先用 fitIcon 或改成同拓扑的两条 path，否则会看到 Procrustes 把缺口读成旋转 |
| Uiverse 三例（MIT，作者面板已核） | 仅作“可交互控件能做到什么程度”的参考：button wonderful-baboon-62 / input thin-sheep-13 / switch silent-otter-72（原始件留在 archive 任务 research/materials） | **未采纳其 CSS，也未移植其形状**。本套的按压方式（板底搁置塌陷）、字段（切角铭牌压板沿）、开关（方形插销板 + 文字辅助）都是自己的结构；旧胶囊与滑轨明确不用 |
| @pet/ui-kit | 仍提供 Dialog / Toast（本轮范围外的共享层） | Start 的呈现不再出现 pk-button / pk-field / pk-input / pk-pill / pk-sheet；console-app 的对话框脚部已换成 kit 的 Button |
| 字型 | Bahnschrift / Segoe UI Variable / 微软雅黑 UI / PingFang SC / Cascadia Mono | 全部系统已有，零下载、零内嵌 |

对比度：三套内置 × 明暗共 6 份配色，逐格按相对亮度校过（正文类 >=4.5:1，边界/焦点/选中 >=3:1），无 LOW 项。

## 七、状态与未过项（收口时如实）

- 已过：tsc --noEmit 干净；vitest 桌面渲染层 23 个测试文件里 22 个通过（kit 12、shell 14 全绿，start-designs 的 contracts/behavior/controls 全绿）。
- **未过且不属于我 scope**：pages/app-pages.test.tsx 的 4 条开始页断言——它们仍按旧名字找 暂未连接 / theme-editor / pet-preview__floor / 留空沿用已保存的 Key，而这些字符串属于 B 的 sections/use-start-model/预览与 C 的 theme-studio 改名范围。我没有替他们改断言。
- 未做：没有跑 build / 原生 / Electron 截图（按要求交给父）；样板台还没有挂载点——OriginalControlBoard 无 props，需要父在 lab 或一个 chrome 入口里挂一次（testid: original-control-board），我没有改 lab.tsx 的权利。
- 残留旧皮肤：pages/start.css 仍写着 --pk-* 取色的旧胶囊与芯片规则；theme-editor.tsx 仍是 pk-sheet（C 已另交 OriginalThemeStudio）。两处都在别人名下，等他们收。
- Toast / Dialog 外观仍是 @pet/ui-kit 的共享层（PRD 未列入本轮禁项，也不是 Start 呈现的控件）；若要一并换成这套语言，需要新的授权范围。

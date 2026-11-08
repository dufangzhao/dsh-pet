# M2 Phase 3.4 commit plan — user approved

用户于2026-11-08明确选择「按计划提交、留档并继续」，授权下面两批本地工作提交及随后归档/日志，继续已批准的人格记忆阶段；不push、不amend。实际hash由收尾记录登记。

仅刷新本文件；未add/commit/archive/journal，未改其它文档/产品/dist，未build/test/启动服务或模型。QA已freeze并关闭owned实例；当前任务仍in_progress，最终metadata/状态同步和独立Core/Docker门禁由parent负责。

## Git快照、来源与提交前条件

- Branch `feat/shared-desktop-agent-entry`，HEAD/base `feat/companion-model-text-loop`均为 `5f777269aa677676e4e5b5f5d1746e26df7ec639`；本阶段尚无commit，index为空。
- 最近风格：`5f77726 chore: record Magpie model stage journal`、`ae0a2ba chore(task): repair archived model-stage references`、`471b205 chore(task): archive 11-08-companion-model-text-loop`、`6c49a21 fix(companion): support live Magpie Responses streams`、`0be35b1 test(companion): record model API and browser acceptance evidence`。采用英文conventional commits。
- 最终inventory为141 dirty=50 tracked modified+91 untracked（含本计划）；拟纳入140文件（feature86+QA/docs54），唯一公开dirty排除是下一阶段研究1文件。`M`=修改、`A`=untracked，均未stage。Tracked删除为0，历史88文件已恢复，不制造恢复提交。
- 来源已识别：e0负责contracts/Main/preload/native client/profile API、共享protocol/ModelDialog最小导出、SecretRedactor及tests；DeepSeek负责renderer共享source接线、历史保留与两文件sidebar修复；parent/QA负责工具、证据、文档/spec。九点review修复是具体时序/授权/回执问题，不写成泛架构加固；source-only review不当运行证明。
- BUILD0 `pnpm check` job `bash-6d64f6380f1342a8`已parent collected exit0：32项目types/tests/rootQA/lint/format/production build，desktop931/service34/text162。BUILD1是针对sidebar的types/lint/format/desktop build及真实native复验，desktop build `bash-33119f738b214cdc` collected0；不声称BUILD1重跑过整套root gate。
- 已撤去未跟踪的CSS镜像测试；它不是baseline用户测试、不产生tracked删除，不在任何提交。删除前renderer603只能作为历史focused数字，不写成最终unit603；BUILD0 renderer598亦保留原时点。真实native geometry/keyboard/accessibility检查保留。
- **已由parent完成：**独立Core4与真实Docker/service18（0 skips、0真实模型调用）门禁 job `bash-82388c723f0f4a25`已collect exit0；最终lint/format/diff/context8+8 job `bash-cee997e85db74fa0` exit0。PRD D1–D7、实施步骤、指南与QA状态已按选定Linux组合证据同步，Windows设备验证保留单独边界。最后all-untracked/index清单再次核对后，等待一次本阶段提交确认。

## 最终QA证据及范围

唯一最终map是 `research/native-coverage.md`，用户入口为 `qa/companion-desktop-acceptance.md`。已逐项核对其exact safe清单41项（38个QA文件+3份task research）存在且全部纳入第二批；不copy整个截图目录。38个QA文件组成：1个验收入口、15个probes/fixtures、12张safe图、10份JSON。其中1图+1JSON是BUILD0历史sidebar缺陷，其余通过报告保留各自subset/build身份，不宣称一次 `--full`执行。

- BUILD1 visual `038fb5fe` / job `bash-d16c673107ea4eb1` exit0：880×600 rail67/67无横溢出、36×36刷新按钮、center hit、aria/title和2次键盘/点击事件；1200×800 rail225/225、完整横向label/隐藏icon。模型footer/无密钥输入/Escape还焦、pet computed CSS和bitmap alpha再次通过。旧0c3ca455 exit0仅记录测量、status=layout-defect-observed，不能作pass；修正前后各自图/JSON均保留。
- 新wire `wire-e689cb86` / job `bash-f717acc5236d44df` exit0：观察真实浏览器自己请求的snapshot并比对agent/message/input IDs及两desktop projections，没有伪造页面/响应。它补齐D1浏览器wire证据，不宣称浏览器task/artifact IDs另行采样。
- 新preservation / job `bash-0b5739e5484e4384` exit0：实际FileConfigStore旧格式history/persona与FileCiphertextStore合成opaque vault bytes在真实共享startup/connection/exit前后逐字节相同；未激活legacy角色/未导入。真实SSE loss、保留确认时间、手动重连通过，62个隔离desktop regular files的generated-token raw/URL/base64/JSON形式扫描无命中。合成vault不声称可解密，Linux不冒充Windows profile/audio组合。
- 既有baseline/DOM/business/source/chooser保持BUILD0子集证据：三端各一次消息、selected stop不影响另一Docker任务、desktop退出后任务完成与同profile重连恢复；native GTK真实PID/title/transient、保存及Escape取消。Business恢复产物19bytes/SHA `f5e6f701596d0ce93c767295349f0222309ec99d103553afdb901c80ff29c36b`，chooser独立产物13bytes/SHA `2ea339fc5c85e28977487e83235700b9181c5b8c7c3d2ef4951da263568f9767`；不是同一artifact的恢复→native-save单次链。Business的recovered图只显示对话上部；缺失当次runner hash不以后来文件补填。
- Native未逐个重复全部畸形/oversize/late-handler/download/rename竞态；matrix明确相应unit/HTTP/source/controlled-hook层级。Foreground语义的独立Core4/真实Docker-service18门禁已由parent采集exit0；Windows音频/设备、profile/page/avatar admission、pointer/topmost/DPI/compositor及OS sandbox未由Linux建立。无真实model/3425调用，原4120停用、资料保留。

QA实际linux-x64/Electron45生产Main/preload/两真实窗口，独立loopback scripted服务及已有Docker镜像。私有Electron原SHA `b36c3ce9b423098a7854f4912f730b0654b41ae183818f887b8f1cd0a90725eb`，RPATH补丁后 `bcf2b3e430c49265f6da8b81b2f28032e0434155e1e7c4d8d7edfaf449b024dc`，另有私有GTK/GSettings资源；worker精简环境不放宽，`--no-sandbox`仅QA条件。不得写未改ELF通过或Windows/OS sandbox通过。全部owned实例closed，保留与无关既有Xvfb/container的区别。

## Generated admission与BUILD0/BUILD1

此前已读generator/diff：admitted新增 `DESKTOP_COMPANION_PLUGIN_ID`；新pet.companion-client manifest1074bytes/dist1800bytes；8个旧ESM各+105bytes来自新增contracts desktop-companion.ts常量段；asr-worker CJS另+500bytes含新profile/desktop模块初始化。11个变化admission条目的SHA/bytes已只读核实与冻结产物相同；不是旧插件人工功能修改，也未放宽Linux平台/security。

本次再次只读hash确认BUILD1的Main/preload/worker/admission均与BUILD0一致，分别为 `aba668e8964fb9a7c4e5aaf371ef26f3bb39488f7bf02c5df7f3159dbc687328`、`946293e69aca1db17b65b0c1e8b55b3a9c53a14926c1a67db8e63d5a576baed7`、`b1300cbe4c1780829301695996a527e2386906c8852ae5b2d46d4e9296cc8551`、`f216f50344bb5b4412588fffac4c55901c9173fa0abce933976c3b4d48c7bcbb`。只console renderer的两产品文件变动，最终JS/CSS hash在038fb5fe报告；不把BUILD0 business/source/chooser改称BUILD1复跑，不提交忽略的dist，不重build。

## 1. `feat(desktop): connect pet and console to the shared Agent service` — 86文件

Contracts→普通source→Main/preload→renderer、共享wire/ModelDialog、redactor缺陷及回归/spec保持一个可构建单元。两文件sidebar修复已在此批：console-app.tsx与minimal-ui/foundation.css。拆开会留下缺export/dependency/bridge的中间状态；QA/docs随后接续，无需合并两批。

```text
A .trellis/spec/backend/desktop-companion.md
M .trellis/spec/backend/index.md
M .trellis/spec/backend/model-connections.md
M .trellis/spec/frontend/index.md
A .trellis/spec/frontend/shared-desktop-entry.md
M .trellis/spec/shared/project-baseline.md
M apps/companion-service/src/model-client.test.ts
M apps/companion-service/src/model-client.ts
A apps/companion-service/src/profile.test.ts
M apps/companion-service/src/server.ts
M apps/desktop/package.json
M apps/desktop/scripts/builtin-admission.ts
M apps/desktop/src/main/builtin-admission.json
A apps/desktop/src/main/companion-artifact.test.ts
A apps/desktop/src/main/companion-artifact.ts
A apps/desktop/src/main/companion-client-controller.test.ts
A apps/desktop/src/main/companion-client-controller.ts
A apps/desktop/src/main/companion-client-host.ts
A apps/desktop/src/main/companion-client-request.ts
A apps/desktop/src/main/companion-client-types.ts
M apps/desktop/src/main/console-plugin-request.test.ts
M apps/desktop/src/main/console-plugin-request.ts
M apps/desktop/src/main/demo-tray.ts
M apps/desktop/src/main/desktop-host.ts
M apps/desktop/src/main/index.ts
A apps/desktop/src/main/local-presentation-controller.ts
A apps/desktop/src/main/shared-application-state.test.ts
A apps/desktop/src/main/shared-application-state.ts
A apps/desktop/src/main/shared-companion-host.test.ts
A apps/desktop/src/main/shared-composition-policy.ts
A apps/desktop/src/preload/companion-bridge.ts
M apps/desktop/src/preload/index.ts
M apps/desktop/src/renderer/bridges.d.ts
M apps/desktop/src/renderer/console/console-app.test.ts
M apps/desktop/src/renderer/console/console-app.tsx
M apps/desktop/src/renderer/console/minimal-ui/foundation.css
M apps/desktop/src/renderer/console/pages/app-pages.test.tsx
M apps/desktop/src/renderer/console/pages/appearance.tsx
M apps/desktop/src/renderer/console/pages/conversation.tsx
M apps/desktop/src/renderer/console/pages/persona.tsx
M apps/desktop/src/renderer/console/pages/plugins.test.tsx
M apps/desktop/src/renderer/console/pages/plugins.tsx
M apps/desktop/src/renderer/console/pages/start.tsx
A apps/desktop/src/renderer/console/palettes.ts
A apps/desktop/src/renderer/console/test-state.ts
M apps/desktop/src/renderer/pet/App.tsx
M apps/desktop/src/renderer/pet/PetComposer.tsx
M apps/desktop/src/renderer/pet/PetMenu.tsx
M apps/desktop/src/renderer/pet/PetTools.tsx
A apps/desktop/src/renderer/pet/bubble-lifetime.ts
M apps/desktop/src/renderer/pet/pet-menu.test.tsx
M apps/desktop/src/renderer/pet/pet-mvp.test.tsx
M apps/desktop/src/renderer/pet/pet.css
M apps/desktop/src/renderer/pet/pet.test.tsx
M apps/desktop/src/renderer/pet/use-pet-settings.ts
A apps/desktop/src/renderer/shared/commands.ts
A apps/desktop/src/renderer/shared/companion-state.test.ts
A apps/desktop/src/renderer/shared/companion-state.ts
A apps/desktop/src/renderer/shared/console-views.ts
A apps/desktop/src/renderer/shared/use-companion.test.ts
A apps/desktop/src/renderer/shared/use-companion.ts
A apps/desktop/src/renderer/shared/use-local-presentation.ts
A packages/contracts/src/companion-profile.ts
A packages/contracts/src/desktop-companion.ts
M packages/contracts/src/index.ts
M packages/host-kernel/src/credentials/redactor.ts
A plugins/companion-client/package.json
A plugins/companion-client/plugin.json
A plugins/companion-client/src/index.ts
A plugins/companion-client/tsconfig.json
M plugins/text-client/build.mjs
M plugins/text-client/package.json
M plugins/text-client/src/client/app.tsx
M plugins/text-client/src/client/guards.ts
M plugins/text-client/src/client/main.tsx
A plugins/text-client/src/client/model.css
M plugins/text-client/src/client/model.tsx
M plugins/text-client/src/client/protocol.ts
M plugins/text-client/src/client/sse.ts
M plugins/text-client/src/client/styles.css
A plugins/text-client/src/model-ui.ts
A plugins/text-client/src/protocol.ts
A plugins/text-client/tests/exports.test.mjs
M plugins/text-client/tests/render.test.mjs
A plugins/text-client/tests/targeted.test.mjs
M pnpm-lock.yaml
```

## 2. `test(desktop): record shared Agent native acceptance and operator guidance` — 54文件

当前task/parent研究与关联、指南、完整exact safe QA清单；所有图/JSON按native-coverage的最终选定范围列名，旧sidebar缺陷明确为历史diagnosis，不和BUILD1通过混同。

```text
A .trellis/tasks/11-06-unified-companion-architecture/research/shared-desktop-entry.md
M .trellis/tasks/11-06-unified-companion-architecture/task.json
A .trellis/tasks/11-08-shared-desktop-agent-entry/check.jsonl
A .trellis/tasks/11-08-shared-desktop-agent-entry/commit-plan.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/design.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/implement.jsonl
A .trellis/tasks/11-08-shared-desktop-agent-entry/implement.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/implementation-contract.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/prd.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/progress.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/research/backend-review.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/research/desktop-ux.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/research/native-acceptance-plan.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/research/native-coverage.md
A .trellis/tasks/11-08-shared-desktop-agent-entry/task.json
A docs/36-shared-desktop-agent.md
A qa/companion-desktop-acceptance.md
A qa/fixtures/companion-desktop/connection-dom.mjs
A qa/fixtures/companion-desktop/display.mjs
A qa/fixtures/companion-desktop/evidence/038fb5fe-minimum-sidebar.png
A qa/fixtures/companion-desktop/evidence/038fb5fe-model-minimum-window.png
A qa/fixtures/companion-desktop/evidence/038fb5fe-visual-results.json
A qa/fixtures/companion-desktop/evidence/038fb5fe-wide-sidebar.png
A qa/fixtures/companion-desktop/evidence/0c3ca455-minimum-sidebar.png
A qa/fixtures/companion-desktop/evidence/0c3ca455-sidebar-results.json
A qa/fixtures/companion-desktop/evidence/2e1bdea1-model-minimum-window.png
A qa/fixtures/companion-desktop/evidence/2e1bdea1-visual-results.json
A qa/fixtures/companion-desktop/evidence/b371ae95-business-results.json
A qa/fixtures/companion-desktop/evidence/b371ae95-recovered-task.png
A qa/fixtures/companion-desktop/evidence/b371ae95-shared-conversation.png
A qa/fixtures/companion-desktop/evidence/b371ae95-shared-pet.png
A qa/fixtures/companion-desktop/evidence/b937ea94-chooser-after-save-click.png
A qa/fixtures/companion-desktop/evidence/b937ea94-chooser-before-input.png
A qa/fixtures/companion-desktop/evidence/b937ea94-chooser-path-entered.png
A qa/fixtures/companion-desktop/evidence/b937ea94-chooser-results.json
A qa/fixtures/companion-desktop/evidence/baseline-results.json
A qa/fixtures/companion-desktop/evidence/dom-results.json
A qa/fixtures/companion-desktop/evidence/preservation-results.json
A qa/fixtures/companion-desktop/evidence/source-lifecycle-results.json
A qa/fixtures/companion-desktop/evidence/wire-e689cb86-results.json
A qa/fixtures/companion-desktop/evidence/wire-e689cb86.png
A qa/fixtures/companion-desktop/fault-proxy.mjs
A qa/fixtures/companion-desktop/lifecycle.mjs
A qa/fixtures/companion-desktop/native-chooser.mjs
A qa/fixtures/companion-desktop/service.mjs
A qa/fixtures/companion-desktop/target-dom.mjs
A qa/fixtures/companion-desktop/visuals.mjs
A qa/probes/companion-desktop-chooser.mjs
A qa/probes/companion-desktop-native.mjs
A qa/probes/companion-desktop-preservation.mjs
A qa/probes/companion-desktop-source.mjs
A qa/probes/companion-desktop-visual.mjs
A qa/probes/companion-desktop-wire.mjs
A qa/probes/companion-desktop-work.mjs
```

## 明确排除与pending bookkeeping

下一阶段研究，不碰不提交（唯一公开dirty排除）：

```text
A .trellis/tasks/11-06-unified-companion-architecture/research/controlled-persona-memory.md
```

- Unknown/unrecognized dirty当前为0；每个公开dirty已归入上述两批或唯一排除，目录没有替代文件清单。Privateignored内容不在Git清单，绝不额外force/add。提交前再核all-untracked与index，只stage明确路径。
- 原宿主HOME图及非final图/诊断JSON已由parent/QA整理进ignored private，本助手未读/删/移，不公开其路径或重新纳入。`.companion-data/`、`/tmp` profiles/令牌/raw诊断、私有Electron/GTK/库/ZIP、缓存/dist/node_modules均排除，不读取token核实安全。
- 当前task保持 `in_progress`、`completedAt=null`、`commit=null`，parent architecture保持planning；批准与最后验证/metadata留档前不archive/finish/自动journal，不重复M1记录。
- 本轮不改workspace journal/index或其它文档。最终独立Core/Docker结果与metadata/QA状态同步由parent维护，之后一次展示上述messages及exact范围进行显式审批。工作提交生成后才登记真实hash；后续archive/link-fix/journal排在work commits之后，不push/amend，不声称一次性full acceptance。

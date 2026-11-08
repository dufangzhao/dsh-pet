# Phase 3.4 本地提交计划（用户已批准）

用户于2026-11-08明确选择「按计划本地提交」，授权以下两批；不push、不amend。实际提交hash由后续进度记录登记。

仅制定计划；本助手未 add/commit/push/archive、未运行构建或测试，仅写本文件。按 workflow Phase 3.4 分类与列单；用户的本轮代理改动识别授权适用于 GPT/DeepSeek/parent 的本阶段修改。

## 实际 Git 快照

- 工作目录 `/home/kingBZ/DeepSeek-WorkSpace/dsh-pet`；分支 `feat/companion-model-text-loop`。
- HEAD 与 base `feat/text-agent-foundation` 均为 `29c4ade0b583f676fede8078d2e6dab42d461d60`；尚无本阶段提交。
- 最近五条：`29c4ade chore: record journal validation`、`5eba652 chore: record journal`、`6fee797 chore(task): archive 11-07-text-agent-foundation`、`9d86962 test: make desktop and ASR path fixtures portable`、`8fc76f7 feat(companion): add the text-first agent foundation`。沿用英文 conventional commit 风格。
- 写计划前 `git status --porcelain=v1 --untracked-files=all`：47 个 tracked modified、54 个 untracked，共101文件；index为空。注释清理使state.ts回到基线，当前46M+55未跟踪；下列清单包含本计划，当前共101文件：提交1为81，提交2为20。`M`=已有文件修改，`A`=当前untracked，非已暂存。
- `apps/desktop` 当前无 dirty/diff，故本清单没有 desktop generated admission 文件。如最终桌面构建产生新差异，必须先读实际 diff：仅当 admission 的 contracts 指纹/自动生成内容确由本轮 contracts 变化引起时，再把精确路径及原因补入提交1并更新数量；不得按人工改动或“生成物都忽略”草率归类。

## 提交前条件与已有证据

1. 已满足：parent已采集最终 `pnpm check` job `bash-9821f701ec754ac8`，完整exit0。前端155 package tests、25 fixture DOM及最终真实服务浏览器25项已分别记录，不倒填早期数字。
2. 最终真实应用浏览器证据源：`.trellis/tasks/11-08-companion-model-text-loop/research/real-api-acceptance.md`（A–L合计25项、10张图、构建指纹、产物sha256）；`qa/screenshots/companion-model/report.json` 本身只含A–K的21项和9图，L的4项及第10图由上述记录与 `qa/probes/companion-model-switch-revision.mjs` 补充，不能宣称该JSON单独覆盖25项。
3. 后端来源审阅见 `research/backend-review.md`；其“未独立跑测试/直接transport证据缺口”是历史审阅边界。后续 `qa/probes/companion-model-transport.test.mjs` 的1项通过记录在 `qa/companion-model-acceptance.md` 与任务 progress 中，不改写历史报告为独立运行证据。
4. 已满足：parent已同步PRD/实施步骤/QA状态，在progress顶部增加权威handoff；所有预览实例已停止并收集。历史检查点保留，A2保持pending-live，其余工程AC按证据勾选。真实API结果统一引用research/real-api-acceptance.md，不用早期包内记录替代。
5. 已满足：parent删除state.ts的过时直接采纳注释，未改运行逻辑；正确插件工作目录重建后，JS/CSS摘要与已验收产物完全相同（job bash-dfad7ba45a9a4652 exit0）。不为注释清理重复大门禁。
6. 已有受控HTTP/SSE peer、真实服务/SQLite/Core/Docker/浏览器与下载字节证据不等于真实模型智能。真实Magpie/上游URL、模型、独立鉴权及明确的有界调用授权尚缺，A2真实provider实用任务验收保持 **pending-live**。真实公网/反代部署、浏览器重启后旧表单、长负载SSE、真实付费计费/远端取消亦未由本轮浏览器证明；已有unit/HTTP重启测试与这些实测范围分开记录。

## 1. `feat(companion): add replaceable Magpie model connections and settings` — 81文件

完整feature、共享类型、默认插件、后端/前端、对应回归、接线、spec及任务设计记录一并提交。拆开contracts/runtime/service/插件/UI会留下无法构建或无法消费的中间状态，故保持一个feature单元；不需要与独立QA证据提交合并。

根配置与workspace接线（4）：parent已认可截图排除和私有数据lint/format排除；lock只新增本地workspace引用，无新增外部下载依赖。

```text
M .gitignore
M .prettierignore
M eslint.config.mjs
M pnpm-lock.yaml
```

Contracts与runtime（14）：

```text
A packages/contracts/src/companion-model.ts
M packages/contracts/src/companion.ts
M packages/contracts/src/index.ts
M packages/companion-runtime/src/core-plugin.ts
A packages/companion-runtime/src/fixture-model.ts
M packages/companion-runtime/src/index.ts
A packages/companion-runtime/src/model-connection-types.ts
A packages/companion-runtime/src/model-connections.test.ts
A packages/companion-runtime/src/model-connections.ts
A packages/companion-runtime/src/model-description.ts
A packages/companion-runtime/src/model-view.test.ts
A packages/companion-runtime/src/model-view.ts
M packages/companion-runtime/src/plugin-host.ts
M packages/companion-runtime/src/runtime.ts
```

服务与回归（10）：

```text
M apps/companion-service/build.mjs
M apps/companion-service/package.json
A apps/companion-service/src/main.test.ts
M apps/companion-service/src/main.ts
M apps/companion-service/src/model-client.test.ts
M apps/companion-service/src/model-client.ts
A apps/companion-service/src/model-controller.test.ts
A apps/companion-service/src/model-controller.ts
M apps/companion-service/src/server.ts
M apps/companion-service/src/service.ts
```

默认连接插件、Cortico声明、实际快照预算修复（13）：

```text
M plugins/harness-cortico/plugin.json
M plugins/harness-cortico/src/harness.d.mts
A plugins/model-connection-magpie/README.md
A plugins/model-connection-magpie/build.mjs
A plugins/model-connection-magpie/package.json
A plugins/model-connection-magpie/plugin.json
A plugins/model-connection-magpie/src/index.test.ts
A plugins/model-connection-magpie/src/index.ts
A plugins/model-connection-magpie/tsconfig.json
M plugins/state-sqlite/src/state.test.ts
M plugins/state-sqlite/src/state.ts
M plugins/state-sqlite/src/types.ts
M plugins/state-sqlite/src/validation.ts
```

前端实现、fixture与包内回归（16）：

```text
M plugins/text-client/research/text-client.md
M plugins/text-client/src/client/app.tsx
M plugins/text-client/src/client/chat.tsx
M plugins/text-client/src/client/client.ts
M plugins/text-client/src/client/guards.ts
A plugins/text-client/src/client/model-form.ts
A plugins/text-client/src/client/model.tsx
M plugins/text-client/src/client/protocol.ts
M plugins/text-client/src/client/styles.css
M plugins/text-client/tests/client.test.mjs
M plugins/text-client/tests/fixture-server.mjs
M plugins/text-client/tests/fixtures.mjs
M plugins/text-client/tests/guards.test.mjs
M plugins/text-client/tests/integration.test.mjs
A plugins/text-client/tests/model-form.test.mjs
M plugins/text-client/tests/render.test.mjs
```

部署说明与可执行spec（8）：

```text
M docs/35-text-agent-foundation.md
M docs/deploy/companion.Caddyfile.example
M .trellis/spec/backend/companion-service.md
M .trellis/spec/backend/index.md
A .trellis/spec/backend/model-connections.md
M .trellis/spec/frontend/index.md
A .trellis/spec/frontend/model-settings.md
M .trellis/spec/shared/project-baseline.md
```

任务与阶段设计留档（16）：父任务两处仅记录R20/R21及child关联；当前任务保持未完成。

```text
M .trellis/tasks/11-06-unified-companion-architecture/prd.md
M .trellis/tasks/11-06-unified-companion-architecture/task.json
A .trellis/tasks/11-08-companion-model-text-loop/check.jsonl
A .trellis/tasks/11-08-companion-model-text-loop/commit-plan.md
A .trellis/tasks/11-08-companion-model-text-loop/design.md
A .trellis/tasks/11-08-companion-model-text-loop/implement.jsonl
A .trellis/tasks/11-08-companion-model-text-loop/implement.md
A .trellis/tasks/11-08-companion-model-text-loop/implementation-contract.md
A .trellis/tasks/11-08-companion-model-text-loop/prd.md
A .trellis/tasks/11-08-companion-model-text-loop/progress.md
A .trellis/tasks/11-08-companion-model-text-loop/research/backend-review.md
A .trellis/tasks/11-08-companion-model-text-loop/research/integration-review.md
A .trellis/tasks/11-08-companion-model-text-loop/research/model-configuration.md
A .trellis/tasks/11-08-companion-model-text-loop/research/model-ux.md
A .trellis/tasks/11-08-companion-model-text-loop/research/real-api-integration-plan.md
A .trellis/tasks/11-08-companion-model-text-loop/task.json
```

## 2. `test(companion): record model API and browser acceptance evidence` — 20文件

在feature后提交可复现探针、隔离启动器、验证记录及最终图像；保留network/synthetic/real-provider证据边界。

脚本与记录（9）：

```text
A .trellis/tasks/11-08-companion-model-text-loop/research/real-api-acceptance.md
M plugins/text-client/research/verification.md
A plugins/text-client/tests/browser/model-dialog.browser.mjs
M qa/companion-acceptance.md
A qa/companion-model-acceptance.md
A qa/fixtures/companion-service/model-preview.mjs
A qa/probes/companion-model-browser-acceptance.mjs
A qa/probes/companion-model-switch-revision.mjs
A qa/probes/companion-model-transport.test.mjs
```

最终截图与结构化报告（11）：

```text
A qa/screenshots/companion-model/a-initial-dialog.png
A qa/screenshots/companion-model/b-saved-scripted.png
A qa/screenshots/companion-model/d-verified-network.png
A qa/screenshots/companion-model/g-synthetic.png
A qa/screenshots/companion-model/h-readonly-ingress.png
A qa/screenshots/companion-model/i-model-chat.png
A qa/screenshots/companion-model/i-task-artifacts.png
A qa/screenshots/companion-model/j-390-keyboard.png
A qa/screenshots/companion-model/k-closed-state.png
A qa/screenshots/companion-model/l-switch-different-revision.png
A qa/screenshots/companion-model/report.json
```

## Pending-live、bookkeeping与执行边界

- 当前 `task.json` 已为 `status=in_progress`、`completedAt=null`、`commit=null`；两次工程提交后仍保持in_progress/completedAt=null。commit字段如以后登记只能写实际已生成hash，不能预填或用它表示真实provider已验收。PRD A2继续未勾选；其余AC按证据逐项判断。父架构任务也不完成。
- 本批把任务设计、阶段进度、review、QA证据随工作提交保留在原active目录；`commit-plan.md` 是审批快照，未来执行结果追加在progress，不把“待审批”误当已提交。
- 当前 `.trellis/workspace/` 无dirty，故此次两提交没有workspace文件，也没有第三个自动bookkeeping提交。每阶段留档已由当前任务progress/QA承担；parent若还需journal，应先列出真实开发者journal/index精确路径和差异，在两个work commits之后另行纳入明确范围，内容写“工程/浏览器完成，A2 pending-live”，只引用实际hash；不运行默认自动commit的脚本来绕过审批。
- 不运行 `task.py finish`、`task.py archive` 或 `trellis-finish-work` 的归档/journal步骤。archive会写completed并搬目录，finish会清active pointer；两者都与当前pending-live不符。仅在真实provider条件满足且AC证据齐全后再处理完成/归档。
- 私有 `.companion-data/`（原profile/token、retained runtime、browser工具等）、`/tmp`连接文件/临时profile以及忽略的 `plugins/text-client/tests/browser/screenshots/` 绝不入库。`git check-ignore`确认 `.companion-data/` 与插件本地截图目录受排除；`/tmp`位于仓库外；`git ls-files -- .companion-data tmp`无输出。提交中仅保留已列的QA最终图像与非secret证据，不提交dist/node_modules。
- **未识别dirty：当前无。** 101个原dirty均归本轮已识别范围；desktop生成变化尚未出现，不能预授权任何新路径。提交前重新核对all-untracked状态与本单；新增/变化来源未知的dirty单列待核，不用目录级或全量add。
- 以上前置结果与记录同步后，parent一次展示两条message、这101个精确路径和新增差异（若有），依Phase3.4请求一次审批。确认后才逐批显式pathspec暂存与本地commit；不amend、不push、不归档。本计划本身不授予提交权限。

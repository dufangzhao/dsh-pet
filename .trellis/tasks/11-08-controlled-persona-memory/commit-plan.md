# M3 Phase 3.4 commit plan — user approved

用户于2026-11-09明确选择「按计划提交、留档并继续」，授权下列125个文件的两批本地工作提交及随后归档/Session25日志，继续已批准的语音／平台阶段。不push、不amend；实际hash由收尾记录登记。

仅刷新本文件；未stage/commit/archive/journal，未改产品/其它docs/dist，未build/test/启动服务/模型/agents，未读旧用户profile或private证据。用户持续授权实施与阶段留档，本M3具体commit确认仍待一次展示；当前任务不因本计划而自动完成。

## 实际Git、来源与数量

- Branch `feat/controlled-persona-memory`；HEAD/base `feat/shared-desktop-agent-entry` = `cab4d79de6830de3f2149c194dd850dedf75da84`；本阶段无commit，index为空。
- 最近风格：`cab4d79 chore: record shared desktop Agent stage journal`、`d14f160 chore(task): repair archived desktop-stage references`、`40e422f chore(task): archive 11-08-shared-desktop-agent-entry`、`8321cfa test(desktop): record shared Agent native acceptance and operator guidance`、`ec441f8 feat(desktop): connect pet and console to the shared Agent service`。沿用英文conventional commits。
- 当前125 dirty=50 tracked modified+75 untracked（含计划）。拟纳入全部125文件：feature63、QA/operator/task62；14个失败/中间候选诊断已完整保留到Git忽略的私有目录。`M`=修改、`A`=untracked，均未stage；逐个枚举，不用目录代替清单。
- 来源：e0 shared/backend/statev2/显式迁移/Harness/HTTP/Main/protocol及回归；DeepSeek单一persona-memory form/web+desktop、长名name class/title+foundation约束、空白editor显示校验分离、web profile read owner/实际App夹具；parent三条unused lint注释清理、guide37/spec/集成；a23独立v1/controlledpeer/旧三probe五seed及harnessPorts透传、全QA。均为本阶段已识别改动，无已知用户改动。
- parent `research/controlled-persona-memory.md`、PRD R20/child关联属于M3，明确纳入第二批；M2留档不重复。组件fixture、实际服务/native、诊断图各按层级记录，不称泛架构加固。

## 真实门禁与最终构建身份

| 实际执行 | 结论与边界 |
| --- | --- |
| `7dd7a603539f45e2` 原pnpm check | types/all packages通过desktop933/service49/text204，之后rootQA因旧wrapper丢profile参数失败；绝不能写原命令单次exit0。 |
| 透传修复 + `4cb53391190140aa` | wrapper仅forward `harnessPorts(source, profile)`，单生命周期case通过；rootQA139pass/4显式镜像skip，随后发现3unused browser comments。 |
| `57e8a432a0344f09` | parent仅删3注释后lint/format/production build exit0已收集；这是分段续跑。 |
| `8ce0f15275af495e` | e0新增2个Config失败边界后完整service51/51；不拿旧49替代51。 |
| `41d48e00976b4103` | parent独立Core4 +真实Docker/service18，0skip，collected0；controlled peers，无live model。rootQA默认4skip不写成实际Docker通过。 |
| 最终target `ca391612b4af4cca` | UI lint/format/text-client+desktop build exit0。旧候选cb684/2327构建后仍暴露前端gap，未被叫作finalUI。 |
| 最终actualUI b76ad918 + A4 replay d8df84e0 | 实际UI/HTTP均exit0、inputsUnchanged、owned实例closed；不是重新跑整套root，也不是把BUILD0 UI重命名为最终build。 |

本轮只读hash再次核实6个后端产物与BUILD0及最终actualUI报告完全一致：service main `50cadd5d…`、migrate `2b7f7995…`、desktop Main `ba2ee474…`、preload `3a348e07…`、worker `b1300cbe…`、admission `c8fad4e8…`。最终web bundle/console JS+CSS有其新hash，见QA入口Build identity段；BUILD0功能报告保留原指纹/时点，未改写。初始16组件DOM为controlled transport；新增rail真实CSS几何和web App/HTTP夹具是支持回归，不代替实际service/Main/native结果。本助手未跑任何门禁。

## 实际证据、最终白名单与限制

唯一QA入口 `qa/fixtures/companion-persona-memory/acceptance.md` 已更新A1–A8及最终Exact QA staging whitelist。已机械解析并核对45个QA文件存在，第二批QA集合与其**完全相同**：22脚本（含4旧QA文件的限定修改）、1验收入口、9JSON、13safe PNG。13图已由QA逐张read_image审阅，本助手没有重看或打开排除的诊断；完整exactpaths见第二批。

- BUILD0 migration/natural/work-result：合成v1显式built migrate/真实旧state源码排他writer/完整root备份/rollback/ABA和旧receipt；实际Core+controlled Responses七个自然请求正反例；真实Docker→Core work-result tool拒绝且memory不写。旧writer是cab4d79 state-source配当前dependencies，不称安装好的旧release。nonterminal迁移row不当活worker，occupied-backup拒绝不当copy中段故障覆盖。
- forms8a88真实web/Electron/Main/preload，own-pending、provenance、captured forget在跨端correction后conflict、键盘/布局、disabled Harness saved-not-applied。Retarget时旧socket已经关闭，release后未向open socket交付，证明取消/无B污染；不声称旧response到renderer，也不拿它代替A4丢回执。
- worker05e6为28秒范围内实际独立Docker任务；owner persona/memory apply不发推理、connector/credential版本不变；current-turn remember/Core继续，task/execution/job/container/最终artifact身份保持、单效果一次。persistencec1c0在无name/persona启动override的真实重启和Harness替换后保留完整长值/人格/id，下一active context完整并在forget后移除；不称历史/模型知识全擦除。
- replayd8df是真实已commit HTTP响应hold→客户端abort/drop→同IDduplicate/cursor不增、correct/forget/recreate/改payload conflict、服务重启后旧upsert/forget replay仍不复活且无新events。
- 最终b76：12/80 code-point名字在880/1100均无rail/footer/run横溢（rail67/67、225/225），title保留全名/ellipsis；初始空白及save后空白quiet+disabled、有效输入keyboard save/reset；真实desktop→web完整persona和applied刷新，dirty旧CAS409，显式rebase新CAS成功（profile revisions3→4→5→6）。Pet CSS透明且无persona roots，bitmap139615透明/7394opaque/12591partial；getter#000000不冒充alpha测量。最终quiet图在memory字段上方，saved-blank图显示字段，初始quiet行为依据DOM断言，不从未展示区域截图猜测。
- 白名单保留BUILD0 rail4图和rail-f4 measurement作**真实缺陷历史**：即便probe执行成功，也不称旧布局通过。b76六图才是最终UI；失败或非最终两轮构建的JSON/重复图全部排除。五次QA假设失败（origin label、90秒超30限、inactive shell、getter alpha、异步applied即刻检查）保留原事实但原始诊断不提交，不把它们修改为pass。
- 平台仍实际Linux Electron45/Xvfb+私有RPATH/GTK，electronSHA `bcf2b3e430c49265f6da8b81b2f28032e0434155e1e7c4d8d7edfaf449b024dc`；worker精简环境未放宽，--no-sandbox不证明OS sandbox，未改ELF/Windows device/compositor不能称通过。自然含义/模型选key仍model-dependent，忘记仅active facts/context权限，不擦history/logs/backups。无新live model预算，原4120/用户资料/token保持停用/原状。

## Generated admission

相对base唯一变化为pet.asr-local worker70495→70696bytes（+201），SHA `00c0597e0647ab31b01113f8007d42c5686180e9149430be7b2769fed912e211`；实际新contracts companion-memory模块init及barrel调用造成CJS重建影响。已只读核对指纹/bytes，不是人工ASR功能修改或放宽platform；最终UI后admission仍与BUILD0相同。不提交忽略的worker/dist，不重新生成。

## 1. `feat(companion): add controlled persona and revisioned memory management` — 63文件

statev2/显式migration、DTO/API/Main/Harness真实应用、单一共享UI、source-backed spec和支持回归一个可构建单元，避免中间writer/协议/表单不一致；第二批独立QA/docs可后接，无需合并两批。

```text
M .trellis/spec/backend/companion-service.md
M .trellis/spec/backend/desktop-companion.md
M .trellis/spec/backend/index.md
A .trellis/spec/backend/persona-memory.md
M .trellis/spec/frontend/index.md
A .trellis/spec/frontend/persona-memory.md
M .trellis/spec/frontend/shared-desktop-entry.md
M apps/companion-service/build.mjs
A apps/companion-service/src/migrate.test.ts
A apps/companion-service/src/migrate.ts
M apps/companion-service/src/model-controller.test.ts
A apps/companion-service/src/persona-memory.test.ts
M apps/companion-service/src/profile.test.ts
M apps/companion-service/src/server.ts
M apps/companion-service/src/service.ts
M apps/desktop/src/main/builtin-admission.json
M apps/desktop/src/main/companion-client-controller.test.ts
M apps/desktop/src/main/companion-client-controller.ts
M apps/desktop/src/main/companion-client-request.ts
M apps/desktop/src/renderer/console/console-app.tsx
M apps/desktop/src/renderer/console/minimal-ui/foundation.css
M apps/desktop/src/renderer/console/pages/app-pages.test.tsx
M apps/desktop/src/renderer/console/pages/persona.tsx
M apps/desktop/src/renderer/shared/use-companion.ts
M packages/companion-runtime/src/fixture-harness.ts
A packages/companion-runtime/src/persona-memory.ts
M packages/companion-runtime/src/runtime.ts
A packages/contracts/src/companion-memory.ts
M packages/contracts/src/companion-profile.ts
M packages/contracts/src/companion.ts
M packages/contracts/src/desktop-companion.ts
M packages/contracts/src/index.ts
M plugins/harness-cortico/src/boundary.mjs
M plugins/harness-cortico/src/harness.d.mts
M plugins/harness-cortico/src/harness.mjs
M plugins/harness-cortico/src/index.ts
M plugins/harness-cortico/src/scripted.mjs
M plugins/harness-cortico/tests/harness.test.mjs
M plugins/state-sqlite/plugin.json
A plugins/state-sqlite/src/database.ts
M plugins/state-sqlite/src/index.ts
A plugins/state-sqlite/src/memory.ts
M plugins/state-sqlite/src/state.test.ts
M plugins/state-sqlite/src/state.ts
M plugins/state-sqlite/src/types.ts
M plugins/state-sqlite/src/validation.ts
M plugins/text-client/build.mjs
M plugins/text-client/package.json
M plugins/text-client/src/client/app.tsx
M plugins/text-client/src/client/client.ts
M plugins/text-client/src/client/guards.ts
A plugins/text-client/src/client/memory-form.ts
A plugins/text-client/src/client/persona-memory.css
A plugins/text-client/src/client/persona-memory.tsx
M plugins/text-client/src/client/protocol.ts
M plugins/text-client/src/client/styles.css
A plugins/text-client/src/persona-memory-ui.ts
A plugins/text-client/tests/browser/persona-memory.browser.mjs
A plugins/text-client/tests/browser/rail-width.browser.mjs
A plugins/text-client/tests/browser/web-profile-read.browser.mjs
A plugins/text-client/tests/management.test.mjs
A plugins/text-client/tests/memory-form.test.mjs
A plugins/text-client/tests/persona-memory-render.test.mjs
```

## 2. `test(companion): record persona memory acceptance and migration guidance` — 62文件

parent/当前task records、guide37、45个正式白名单QA文件。旧三probe五处新seed读真实memory/fact CAS与mutation.receipt；独立v1 ledger payload原样保留，wrapper只透传profile，controlledClient holdResponses0–12且默认两次不变。脚本和safe证据只列完整文件，不整体add目录。

```text
M .trellis/tasks/11-06-unified-companion-architecture/prd.md
A .trellis/tasks/11-06-unified-companion-architecture/research/controlled-persona-memory.md
M .trellis/tasks/11-06-unified-companion-architecture/task.json
A .trellis/tasks/11-08-controlled-persona-memory/check.jsonl
A .trellis/tasks/11-08-controlled-persona-memory/commit-plan.md
A .trellis/tasks/11-08-controlled-persona-memory/design.md
A .trellis/tasks/11-08-controlled-persona-memory/implement.jsonl
A .trellis/tasks/11-08-controlled-persona-memory/implement.md
A .trellis/tasks/11-08-controlled-persona-memory/implementation-contract.md
A .trellis/tasks/11-08-controlled-persona-memory/prd.md
A .trellis/tasks/11-08-controlled-persona-memory/progress.md
A .trellis/tasks/11-08-controlled-persona-memory/research/acceptance-plan.md
A .trellis/tasks/11-08-controlled-persona-memory/research/backend-review.md
A .trellis/tasks/11-08-controlled-persona-memory/research/persona-memory-ux.md
A .trellis/tasks/11-08-controlled-persona-memory/research/qa-preparation.md
A .trellis/tasks/11-08-controlled-persona-memory/task.json
A docs/37-persona-and-memory.md
A qa/fixtures/companion-persona-memory/acceptance.md
A qa/fixtures/companion-persona-memory/evidence/78fc4075-desktop-minimum-keyboard.png
A qa/fixtures/companion-persona-memory/evidence/78fc4075-saved-not-applied.png
A qa/fixtures/companion-persona-memory/evidence/78fc4075-web-narrow-keyboard.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-dirty-profile-rebase.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-long-name-1100.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-long-name-880.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-pet-alpha.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-quiet-blank.png
A qa/fixtures/companion-persona-memory/evidence/7a920da3-build1-saved-blank.png
A qa/fixtures/companion-persona-memory/evidence/80ae4af1-rail-max-1100.png
A qa/fixtures/companion-persona-memory/evidence/80ae4af1-rail-max-880.png
A qa/fixtures/companion-persona-memory/evidence/80ae4af1-rail-normal-1100.png
A qa/fixtures/companion-persona-memory/evidence/80ae4af1-rail-normal-880.png
A qa/fixtures/companion-persona-memory/evidence/build1-ui-b76ad918-fd40-42ee-87f7-9dad1d853082.json
A qa/fixtures/companion-persona-memory/evidence/forms-8a88ec41-27ec-4e53-a46b-c9aca7f408bd.json
A qa/fixtures/companion-persona-memory/evidence/migration-c5686569-a340-4a39-97a8-ad64c58e23de.json
A qa/fixtures/companion-persona-memory/evidence/natural-38dc0176-07bb-447f-9ba7-feceab36b4a3.json
A qa/fixtures/companion-persona-memory/evidence/persistence-c1c0f4a9-6353-43f0-877f-d4fd1369362d.json
A qa/fixtures/companion-persona-memory/evidence/rail-f4b660f6-da7b-4d76-b177-b590b30f9ff7.json
A qa/fixtures/companion-persona-memory/evidence/replay-d8df84e0-7ba7-4140-8942-cc1b3d1d90b8.json
A qa/fixtures/companion-persona-memory/evidence/work-result-8b93cc49-dd55-4765-8f12-1e57386a88b8.json
A qa/fixtures/companion-persona-memory/evidence/worker-05e6bdd3-b9db-41a2-acab-c32f24190a47.json
A qa/fixtures/companion-persona-memory/form-observers.mjs
A qa/fixtures/companion-persona-memory/migrate-child.mjs
A qa/fixtures/companion-persona-memory/natural-cases.mjs
A qa/fixtures/companion-persona-memory/response-gate.mjs
A qa/fixtures/companion-persona-memory/v1-fixture.mjs
A qa/fixtures/companion-persona-memory/v1-writer.mjs
M qa/fixtures/companion-service/controlled-client.mjs
A qa/probes/companion-persona-memory-build1-ui.mjs
A qa/probes/companion-persona-memory-controlled-client.test.mjs
A qa/probes/companion-persona-memory-forms.mjs
A qa/probes/companion-persona-memory-migration.mjs
A qa/probes/companion-persona-memory-natural.mjs
A qa/probes/companion-persona-memory-persistence.mjs
A qa/probes/companion-persona-memory-rail.mjs
A qa/probes/companion-persona-memory-replay.mjs
A qa/probes/companion-persona-memory-run.mjs
A qa/probes/companion-persona-memory-v1-fixture.mjs
A qa/probes/companion-persona-memory-work-result.mjs
A qa/probes/companion-persona-memory-worker.mjs
M qa/probes/companion-service-lifecycle.test.mjs
M qa/probes/companion-service-recovery.test.mjs
M qa/probes/companion-service.test.mjs
```

## 本地保留的中间诊断

14个失败或中间候选诊断已由parent逐个核对绝对源/目标、确认无目标覆盖并验证Git忽略后转入私有诊断目录；逐文件SHA未变，未删除证据，也未处理用户文件。它们不再出现在公开dirty清单，不进入任何工作提交；最终QA入口保留失败原因和真实通过记录。

## 剩余parent检查与执行边界

- 当前未识别/来源不明产品dirty为0；所有公开dirty有明确纳入或排除。最终批准前再核all-untracked/status/index与本表，不用all-add；若QA稍后私有整理排除文件，按实际清单刷新数量，不把忽略数据force入库。
- Parent已完成C1–C8 adjudication、PRD/task/progress/guide37与frontend spec同步；最终QA白名单冻结、全部owned实例关闭。最后lint/format/diff/context10+10 job bash-34805613283f475d exit0；当前task仅等待具体工作提交确认及随后归档，保持in_progress/completedAt=null/commit=null。
- `.companion-data/`、node_modules/dist、/tmp roots/backups/原始stderr、tokens/用户旧profile/HOME风险图与私有工具均排除；报告引用hash/路径不是提交那些数据的许可，不读取密钥“验证安全”。原M2数据与4120不动。
- 本轮仅刷新commit-plan，未改其它文件或重跑测试/build。两条message与以上exactpaths最终一次展示后再取得本阶段具体commit确认；无该确认不stage/commit，不push/amend。真实work hash只在实际提交后登记，后续archive/link-fix/journal排在工作提交之后，不重复M2、不创建下一child。

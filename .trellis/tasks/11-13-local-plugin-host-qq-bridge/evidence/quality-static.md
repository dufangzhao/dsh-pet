# 静态预验收（read-only whole-project）— 11-13-local-plugin-host-qq-bridge

> 子 agent `trellis-check`，仅静态只读预验收，不写任何产品文件。生成时间见文末。

## 结论先行

真实 Root 递归 `pnpm -r typecheck` 在本次 checkpoint **绿（exit 0）**；`pnpm lint` **红（exit 1，19 errors / 5 files）**，
`pnpm format:check` **红（exit 1，8 files）**；`git diff --check`（unstaged + cached）**绿（0 / 0）**。
**11 个失败文件全部是本 task 新增的 untracked 文件，tracked（M/D）文件本次零失败** —— 归因证据见 §3。
这是「按 Parent 分配最窄 fix」的清单，不是验收通过：G3 远端 file preparing / context-only notice 仍挂，静态预检不能称产品 complete。

> **最新状态（第二轮窄静态修复，2026-11-15 02:06–02:14，见 §0）**：本 agent 独占的 7 个文件已收口，owned `eslint` / `prettier --check` 均为 **0**。第一轮 §2/§3 数字是**修复前快照**，保留作复核基线；Root 全量 `pnpm lint` / `pnpm format:check` 在 DeepSeek 的 G3 收口前仍将为红，本轮未重跑（不趁中间态、不重跑同一中间错误）。

---

## 0. 第二轮：窄静态修复（本 agent 独占，2026-11-15 02:06–02:14）

### 授权与边界

- Parent 02:06 指令：独占修 `apps/desktop/tests/browser/local-host.browser.mjs`（lint）＋ 6 个 Prettier-only 文件，共 7 个现有格式文件 + browser lint；**不改业务 UI 行为**。
- **未触碰**（DeepSeek 8869f01f 唯一写权、正在 diagnostic）：`apps/companion-service/src/qq-local-host.test.ts`、`apps/companion-service/src/qq-local-host.ts`、`packages/local-host/src/qq-agent-link.ts`、`packages/local-host/src/qq-input-projection.ts`。本次未写这 4 个文件中的任何一个；`qq-local-host.test.ts` mtime 已到 02:13:47 仍在被 DeepSeek 改（SHA 由本轮 02:10 快照 `8647e2b4…` 变为 `c2e1f378…`），属其中间态，非本 agent 改动；另 3 个 mtime 仍为 11-14 17:23。
- 未 `--fix` 整个 repo；未改 5 个审批快照（SHA 复核一致）；未写 runtime pin 文件 / `apps/desktop/dist`（mtime 仍 11-07）；未起 GUI（Playwright `local-host.browser.mjs`）或 hostkernel（`composition.test.ts` 起 daemon）测试。`tsc --noEmit` / `vitest run` / `eslint` / `prettier` 均不产出 dist。

### 两处 targeted 语义编辑（仅 `local-host.browser.mjs`）

1. 第 20 行沿用**该文件既有惯例** `/* global window */` → `/* global window, document */`：消 4 处 `no-undef(document)`（Playwright `page.waitForFunction`/`evaluate` 浏览器回调），不扩大全 repo globals、不改 eslint 配置。
2. 第 396 行裸表达式 `window.__hostSwap;`：先读语义 —— 它是第 315 行 `window.__hostSwap = () => {...}` 的**普通函数属性**（非 getter），只读不调用，无任何副作用；其上方注释声称「只改 revision，不换宿主」但代码什么也没触发。按「若无作用删除，不 void 掩盖」删除整段 no-op `page.evaluate`，并把注释改为如实描述。**未用 `void` 掩盖、未新增任何调用**；测试可观测行为不变（原本就是空操作，`waitForTimeout(300)` 与断言保持原样）。

### 精确命令与 exit

| # | 命令 | exit / 结果 |
| --- | --- | --- |
| 1 | `pnpm exec prettier --write <7 owned files>` | **0**，7 文件全部重写 |
| 2 | `pnpm exec eslint <7 owned files>` | **0**（无输出） |
| 3 | `pnpm exec prettier --check <7 owned files>` | **0**，`All matched files use Prettier code style!` |
| 4 | `pnpm exec prettier --config ./.prettierrc.json --stdin-filepath <f> < before/<f> \| cmp -s - <f>`（6 个 format-only） | 6× **PURE_OK**：当前文件与 `prettier(原始文件)` **逐字节相同** |
| 5 | `prettier(原始 browser.mjs)` vs 当前 `diff -u` | 23 行 / 2 hunk，**仅上述两处语义编辑**，无其它差异 |
| 6 | `git diff --no-index --check /dev/null <f>`（7 个 untracked） | 7× **WS_OK**，无空白错误（补上 `git diff --check` 不覆盖 untracked 的缺口） |
| 7 | `pnpm --filter @pet/desktop typecheck` = `tsc --noEmit -p tsconfig.json` | **0** |
| 8 | `pnpm --filter @pet/desktop test src/renderer/console/local-host/local-host-view.test.ts src/renderer/console/local-host/local-host-card.test.tsx` | **0**；2 files / **37 tests** / 0 failed（`renderToStaticMarkup` 纯函数，无 jsdom/Electron/GUI） |
| 9 | `sha256sum <5 approval artifacts>` | 与 `task.json` `reviewedArtifactsSha256` 逐项一致 |
| 10 | `git status --porcelain=v1 \| cut -c1-2 \| sort \| uniq -c` | 仍 **61 M / 8 D / 39 ??**，无新增仓库文件 |

### counts：旧报告 → 新状态

- lint 19 errors / 5 files → **本组 5 errors（全在 `browser.mjs`）清零**；按 01:57 快照计剩余 **14 errors / 4 files**，全在 DeepSeek 独占 G3：`qq-local-host.test.ts` 6、`qq-local-host.ts` 1、`qq-agent-link.ts` 6、`qq-input-projection.ts` 1（其中 `qq-local-host.test.ts` 在改，计数/行号为旧快照，须以其当前内容重验）。
- format 8 files → **本组 7 files 清零**；剩余 **1 file** = `qq-local-host.test.ts`（DeepSeek 在改）。
- 11 个失败文件 → **本组 7 个已收口并验证 0**，4 个待 G3。
- Root 全量 `pnpm lint` / `pnpm format:check` / `pnpm typecheck` **本轮未重跑**（避免在 DeepSeek 中间态上产生误导快照）；typecheck 第一轮 exit 0，本轮仅做 desktop 窄验。最终 G3 done 后仅需对 4 个 G3 文件 + 全量做增量重验。

### diff 语义无变化（证据链）

- 6 个 format-only 文件：当前文件与 `prettier(原始)` 逐字节相同（命令 4，6× PURE_OK）→ 仅格式化，零手工语义改动。
- `browser.mjs`：与 `prettier(原始)` 的差异压缩为 2 hunk（命令 5），即上面两处 targeted 编辑；删除的是可证伪的 no-op 裸读，未 `void` 掩盖、未新增调用。
- 7 个文件 `prettier --check`=0、`eslint`=0、`git diff --no-index --check` 无空白错误；desktop typecheck=0；37 个相关纯函数/静态渲染单测全过。
- 审批快照 SHA、git status 计数、`apps/desktop/dist` 均未变。

### 剩余待 G3 lint/format 路径（交 Parent 转 DeepSeek 8869f01f）

- `apps/companion-service/src/qq-local-host.test.ts`：6 prefer-const（01:57 旧快照，在改，须重验）+ format。
- `apps/companion-service/src/qq-local-host.ts:729` `prefer-const(handle)`（let 先声明后单次赋值，改 const 前确认闭包时序）。
- `packages/local-host/src/qq-agent-link.ts:24,27` 未用类型导入 `LocalHostSourceBinding` / `QQAccountRef`；`:115,402` `no-control-regex`（有意消毒 `/[\u0000-\u001f\u007f]/`，建议定点 disable+注释或配置放行）；`:482,848` `prefer-const(connected,handle)`。
- `packages/local-host/src/qq-input-projection.ts:39` `no-control-regex`（同类消毒）。
- 本次不趁 `qq-local-host.test.ts` 中间态改它的 fsSpy/diagnostic 文件。

### 本轮日志（`/tmp/trellis-static-precheck/`）

`fix-prettier-write.log/.exit`、`fix-eslint.log/.exit`、`fix-prettier-check.log/.exit`、`fix-pure-prettier-proof.log`、`browser-original-formatted.mjs`、`fix-browser-semantic.diff`、`fix-whitespace.log`、`fix-desktop-typecheck.log/.exit`、`fix-vitest.log/.exit`、`fix-approval-sha.log`、`before/`（8 个原始文件 + SHA256）。jobIDs：typecheck `bash-79f7e8cc38424889`、vitest `bash-903dd59bac0f4cec`（均 completed 已 collect）。

---


## 1. 变化清单（含新 untracked）

- tracked：`61 M + 8 D = 69`（`git diff --name-only HEAD`）。删除集中在 `apps/companion-service/src/qq-*.ts` 旧 io/socket/native-types 等。
- untracked：`git status` 显示 **39 条 `??`**（含目录折叠），展开为 **166 个文件**（`git ls-files --others --exclude-standard`）。
- 新增 3 个 workspace：`packages/local-host/`、`plugins/local-agent-link/`、`plugins/local-host-bridge/`；另有任务目录 `.trellis/tasks/11-13-…/`、`apps/desktop/src/local-host/`、`apps/desktop/src/renderer/console/local-host/`、`qa/fixtures/local-host/`、`qa/probes/companion-local-host-*.mjs` 及新源码/测试。
- 完整三份清单已落盘：`/tmp/trellis-static-precheck/{git-status.txt,diff-name-only.txt,untracked.txt}`。

## 2. 检查结果（Root `package.json` 的 3 scripts + git diff --check）

| 命令 | 实际脚本 | exit | checkpoint（+08:00） | 完整日志 |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | `pnpm -r typecheck`（44/45 项目带脚本，44 个全 `Done`，含 3 个新包） | **0** | 01:57:14–01:58:48 | `/tmp/trellis-static-precheck/typecheck.log` |
| `pnpm lint` | `eslint .` | **1** | 01:57:14–01:57:59 | `/tmp/trellis-static-precheck/lint.log` |
| `pnpm format:check` | `prettier --check .` | **1** | 01:57:14–01:58:09 | `/tmp/trellis-static-precheck/format-check.log` |
| `git diff --check` / `git diff --cached --check` | — | **0 / 0** | 01:57 | `…/git-diff-check.log`、`…/git-diff-cached-check.log` |

- 环境：Node v26.13.0 / pnpm 11.24.0，依赖已装且健康。未调用 `pnpm check`（避免 tests/build/Native 冲突）；未 install / build / test / `--write` / `--fix` / cache 写；未改任何产品文件。
- 各 job 的 `.exit` 标记：`typecheck=0, lint=1, format-check=1, git-diff-check=0, git-diff-cached-check=0`。
- `format:check` 命中文件的只读 diff（`prettier <file> | diff -u`，无 `--write`）保存在 `/tmp/trellis-static-precheck/format-diffs.log`（213 行），可复核每处具体改动。

### 作用域事实（解释「为何有些东西没被查到」）

- `.prettierignore` 排除 `.trellis/`、`qa/`、`docs/`、`research/`、`CONTEXT.md` 等 → 新 spec `backend/local-plugin-host.md` 与全部任务 `.md/.jsonl` **不在** `prettier --check` 范围内，其「可能缺空格」不影响本次退出码。
- `eslint.config.mjs` 忽略 `qa/**` 但 lint 根下全部 `**/*.ts|tsx|mts|cts|js|mjs|cjs`；`no-undef` 来自 `js.configs.recommended`，`.mjs` 仅注入 `globals.node`。
- `git diff --check` 只覆盖 tracked 变更，**不覆盖任何 untracked 新文件**；其 0 不能证明新文件无空白问题。
- 审批快照 SHA256 实测与 `task.json` 的 `reviewedArtifactsSha256` 逐项一致（prd / design / implement / implement.jsonl / check.jsonl），未被 prettier 改写；按约束不得为 prettier 重写。`task.json` 的 `reasoningEffort:max` 与 DeepSeek/Hy4 偏好未改。

## 3. 失败分类（file / line / rule / owner；baseline vs 本 task 新引入）

**归因（只凭证据）**：把 11 个失败路径同时比对 `untracked.txt` 与 `diff-name-only.txt` —— 11 个全部命中 `untracked.txt`（`git-status.txt` 中为 `??`），`diff-name-only.txt` **0 命中**。故当前观测到的 19 lint + 8 format 失败 **100% 本 task 新引入、0% baseline-existing**；tracked 的 61 M / 8 D 文件本次检查无任何 lint / format / typecheck 报错。未 clean-checkout HEAD 重跑（只读约束），因此不对 baseline 的「整体绿/红」另作断言 —— 仅限本次观测数据。

### Lint — 19 errors / 5 files

| 文件（owner / gate） | 行:列 | 规则 | 说明 |
| --- | --- | --- | --- |
| `apps/companion-service/src/qq-local-host.test.ts` **（G3，Parent/DeepSeek 8869f01f 正在改，见 §4）** | 383:7 / 384:5 / 385:5 / 386:7 / 386:39 / 715:7 | `prefer-const`（`service`,`kernel`,`sources`,`agent`,`peer`,`view`） | **旧快照行号，已失效**；另见下方 format |
| `apps/companion-service/src/qq-local-host.ts`（G3 服务桥） | 729:5 | `prefer-const`（`handle`） | 现为 `let handle: TaskHandle; handle = …` 先声明后单次赋值；改 `const` 前请确认闭包/赋值时序 |
| `packages/local-host/src/qq-agent-link.ts`（G2/G3 daemon 包） | 24:8 / 27:8 | `no-unused-vars`（`LocalHostSourceBinding`,`QQAccountRef` 类型导入） | 直接删除即可 |
| 同上 | 115:5 / 402:9 | `no-control-regex` | 有意的控制字符消毒 `/[\u0000-\u001f\u007f]/`，非缺陷；建议定点 `eslint-disable` 并注明理由，或配置层放行 |
| 同上 | 482:21 / 848:7 | `prefer-const`（`connected`,`handle`） | 机械改动 |
| `packages/local-host/src/qq-input-projection.ts`（G2/G3 daemon 包） | 39:58 | `no-control-regex` | 同上，同类消毒正则 |
| `apps/desktop/tests/browser/local-host.browser.mjs`（G6/G7 浏览器探针） | 348:13 / 358:13 / 419:13 / 447:13 | `no-undef`（`document`） | Playwright `page.waitForFunction`/`evaluate` 回调里的浏览器全局；需 scope 级 `/* global document */` 或为 `**/tests/browser/**` 注入 browser globals |
| 同上 | 396:7 | `no-unused-expressions` | `window.__hostSwap;` 裸表达式，疑似未完成/遗留语句，建议 owner 复核而非直接压制 |

### Format — 8 files（`prettier --check .` 列出，全部 untracked）

| 文件（owner / gate） | 性质（来自 `format-diffs.log`） |
| --- | --- |
| `apps/companion-service/src/qq-local-host.test.ts`（G3，在改） | 新加的 config-spy / ioTrace 诊断块（约 575–620 行）未格式化；**§4 快照问题** |
| `apps/desktop/src/local-host/composition.test.ts`（G6 desktop） | **整段 test 被写成压缩单行**（`async()=>{`、分号连写、无空格），最严重，需重排 |
| `apps/desktop/src/renderer/console/local-host/local-host-card.tsx`（G6 UX） | 属性换行 / `<p>` 单行折行 |
| `apps/desktop/src/renderer/console/local-host/local-host-section.tsx`（G6 UX） | `void run(...)` 多行参数折行 |
| `apps/desktop/src/renderer/console/local-host/local-host-view.test.ts`（G6 UX） | 对象字面量 / `expect(...)` 折行 |
| `apps/desktop/src/renderer/console/local-host/local-source-draft.ts`（G6 UX） | 三元表达式折行 |
| `apps/desktop/src/renderer/console/local-host/local-source-form.tsx`（G6 UX） | `disabled={…}` 多行折行 |
| `apps/desktop/tests/browser/local-host.browser.mjs`（G6/G7 探针） | 对象字面量 / `locator(...)` 长串折行（与 lint 同文件） |

其中 `qq-local-host.test.ts`、`local-host.browser.mjs` 同时命中 lint + format；其余 6 个仅 format。合计 **11 个不同文件**。

## 4. 关键 checkpoint：`qq-local-host.test.ts` 正在被编辑，本次结果不可当最终集

- 三项检查都在 01:57:14–01:58:48 读取了该文件；该文件 mtime 为 **01:58:42**（检查进行中被改）。
- 证据：lint 在 01:57:59 报 `service/kernel/sources/agent/peer` 于 383–386；而 02:00 读取同文件 378–391 行已是 `ioTrace` / `loopMaxMs` / `syncLstat20Ms` 的 eventloop/线程池诊断，`let service` 移到 391 行 —— 行号与内容均已变化。
- 因此该文件的 6 个 `prefer-const` 行号、1 个 format 命中、以及 typecheck 绿，**都是 01:58:42 之前的旧快照**；当前工作树内容未重验。按约束本次**不碰该文件**（Parent 独占 G3 诊断，勿趁机改 / 勿 `--fix`）。G3 done 后仅需对此文件做增量重验。

## 5. 范围与不能归因 / 不能下的结论

1. 未 clean-checkout HEAD 重跑 → 不能断言 baseline 当时 `eslint .`/`prettier --check .` 整体为绿；只能断言「本次观测失败全部落在新文件」。
2. `qq-local-host.test.ts` 结果为旧快照（§4），不可作为最终失败集。
3. `git diff --check` 的 0 不覆盖 untracked → 不能据此说 166 个新文件无空白问题。
4. `.trellis/spec/backend/local-plugin-host.md` 的排版不在 prettier 范围；审批快照 SHA 已核对一致、不得为 prettier 重写；其文字质量不属本次退出码结论。
5. 静态检查 ≠ 产品 complete：G3 远端 file preparing / context-only notice 未过（DeepSeek 正查 `FileConfigStore.read` ~900ms 与 eventloop/线程池）；最终 Windows 新包待 G3 全绿，旧 r2Win 非 final；G5 55/55、G6 Linux r3 GUI / Main fresh-bridge 12pins 已过的背景不构成本次静态结论。
6. 本次未跑 `pnpm check`、tests / build / native / GUI（按要求排除）→ 对构建、测试、运行时的绿红**零断言**；不重跑同一中间错误，最终 G3 done 后仅对受影响文件增量重验。

---

### 文末记录

- **时间**：2026-11-15T01:55–02:02+08:00；检查 checkpoint `typecheck 01:57:14–01:58:48`、`lint 01:57:14–01:57:59`、`format:check 01:57:14–01:58:09`、`git diff --check 01:57`；SHA/只读 diff 复核 02:00–02:01。
- **命令**：`git status --porcelain=v1`、`git diff --name-only HEAD`、`git ls-files --others --exclude-standard`、`git diff --check`、`git diff --cached --check`、`pnpm typecheck`(=`pnpm -r typecheck`)、`pnpm lint`(=`eslint .`)、`pnpm format:check`(=`prettier --check .`)、`sha256sum <5 artifacts>`、`prettier <file> | diff -u`（只读）。
- **exit**：typecheck **0**，lint **1**，format:check **1**，git diff --check **0**，git diff --cached --check **0**。
- **完整日志 / 证据**：`/tmp/trellis-static-precheck/` → `typecheck.log`、`lint.log`、`format-check.log`、`format-diffs.log`、`git-diff-check.log`、`git-diff-cached-check.log`、`git-status.txt`、`diff-name-only.txt`、`untracked.txt` 及各自 `.exit`。
- **失败文件（11）**：`apps/companion-service/src/qq-local-host.test.ts`、`apps/companion-service/src/qq-local-host.ts`、`packages/local-host/src/qq-agent-link.ts`、`packages/local-host/src/qq-input-projection.ts`、`apps/desktop/tests/browser/local-host.browser.mjs`、`apps/desktop/src/local-host/composition.test.ts`、`apps/desktop/src/renderer/console/local-host/local-host-card.tsx`、`…-section.tsx`、`…-view.test.ts`、`local-source-draft.ts`、`local-source-form.tsx`。
- **不能归因 / 不下结论的部分**：baseline 整体历史绿红（未 checkout 重跑）；`qq-local-host.test.ts` 的旧快照行号（文件 01:58:42 被改，须 G3 后重验）；untracked 空白问题未被 `git diff --check` 覆盖；`.trellis/` 文档排版不在 prettier 范围；构建/测试/运行时状态未检查；产品 completeness 不由静态预检判定。

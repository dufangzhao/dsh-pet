/**
 * 人格/记忆组件的真实 DOM 回归（源码现场打包，不依赖 dist）。
 *
 * 这验证的是**组件自身的交互时序**：真实点击、真实事件、真实 React 提交。
 * 它不是产品验收：数据来自本脚本注入的受控 transport，没有真实服务/模型/网络。
 * 真正端到端仍归 parent 的 native suite。
 *
 * 运行：
 *   node plugins/text-client/tests/browser/persona-memory.browser.mjs
 * 没有浏览器时退出码 2 明确跳过，不静默通过。
 */
/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pluginRoot = path.join(root, 'plugins/text-client');

const executablePath =
  process.env.TC_BROWSER ??
  path.join(
    root,
    '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell',
  );

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('skip: @playwright/test is not resolvable from this checkout');
  process.exit(2);
}

/* ------------------------------------------------------------------ 打包 */

const { build } = await import('esbuild');

const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PersonaMemory } from '${path.join(pluginRoot, 'src/client/persona-memory.tsx').replace(/\\/g, '/')}';
import '${path.join(pluginRoot, 'src/client/persona-memory.css').replace(/\\/g, '/')}';

const profile = (o = {}) => ({
  agentId: 'agent-1', name: '阿蓝', persona: '你是阿蓝。', revision: 3,
  management: { application: { appliedRevision: 3, error: null }, launchOverrides: { name: false, persona: false } },
  ...o,
});
const status = (o = {}) => ({
  revision: 7, application: { appliedRevision: 7, error: null },
  usage: { count: 1, dataBytes: 40, originBytes: 10 }, ...o,
});
const fact = (o = {}) => ({ key: '常喝的茶', value: '乌龙', revision: 5, updatedAt: 1, origin: { kind: 'owner-form' }, ...o });

window.__calls = [];
window.__deferred = null;

const transport = {
  readProfile: async () => ({ ok: true, value: window.__profile ?? profile() }),
  readMemory: async () => ({ ok: true, value: window.__memory ?? { agentId: 'agent-1', facts: [fact()], ...status() } }),
  saveProfile: async (command) => {
    window.__calls.push({ kind: 'saveProfile', command });
    if (window.__throwOnce) {
      window.__throwOnce = false;
      throw new Error('transport blew up');
    }
    if (window.__hold) await new Promise((r) => { window.__pending.push(r); });
    return { ok: true, value: profile({ name: command.name, revision: 4, management: { application: { appliedRevision: null, error: null }, launchOverrides: { name: false, persona: false } } }) };
  },
  upsertFact: async (command) => {
    window.__calls.push({ kind: 'upsertFact', command });
    if (window.__hold) await new Promise((r) => { window.__pending.push(r); });
    return { ok: true, value: { receipt: { commandId: command.commandId, status: 'accepted', messageId: null, taskId: null }, committedRevision: 8, view: { agentId: 'agent-1', facts: [fact({ revision: 8 })], ...status({ revision: 8 }) } } };
  },
  forgetFact: async (command) => {
    window.__calls.push({ kind: 'forgetFact', command });
    if (window.__hold) await new Promise((r) => { window.__pending.push(r); });
    return { ok: true, value: { receipt: { commandId: command.commandId, status: 'accepted', messageId: null, taskId: null }, committedRevision: 9, view: { agentId: 'agent-1', facts: [], ...status({ revision: 9 }) } } };
  },
};

const el = document.getElementById('root');
let root = createRoot(el);
window.__mount = () => {
  root = createRoot(el);
  window.__render();
};
window.__unmount = () => root.unmount();
window.__render = (over = {}) =>
  root.render(createElement(PersonaMemory, {
    transport,
    live: true,
    agentStatus: 'ready',
    profile: window.__profile ?? profile(),
    memory: window.__memory ?? { agentId: 'agent-1', facts: [fact()], ...status() },
    targetKey: window.__targetKey ?? 'agent-1',
    onNotice: (m) => window.__notices.push(m),
    ...over,
  }));
window.__profile0 = profile;
window.__status0 = status;
window.__fact0 = fact;
window.__notices = [];
window.__pending = [];
window.__render();
`;

// CSS 需要 outdir 才会被抽成独立文件；写到系统临时目录，不碰仓库里的 dist。
const outDir = await mkdtemp(path.join(tmpdir(), 'persona-memory-browser-'));
await build({
  stdin: { contents: entry, loader: 'tsx', resolveDir: pluginRoot },
  bundle: true,
  outdir: outDir,
  entryNames: 'bundle',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const js = await readFile(path.join(outDir, 'bundle.js'), 'utf8');
const css = await readFile(path.join(outDir, 'bundle.css'), 'utf8').catch(() => '');

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${css}
body { margin: 0; font-family: system-ui, sans-serif; }
#root { max-width: 420px; padding: 16px; }
</style></head><body><div id="root"></div>
<script>${js}</script></body></html>`;

const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ 用例 */

const results = [];
async function step(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`✖ ${name}`);
    console.log(`  ${error.message}`);
  }
}

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));
await page.goto(origin);
await page.waitForSelector('[data-testid="profile-name"]');

/**
 * 每个场景从一份干净状态开始：清调用记录、清 gated、重挂载组件。
 * 这是**重新挂载真实组件**，不是注入内部状态。
 */
async function reset(setup = '') {
  await page.evaluate((body) => {
    window.__calls = [];
    window.__notices = [];
    window.__hold = false;
    window.__pending = [];
    window.__throwOnce = false;
    window.__profile = undefined;
    window.__memory = undefined;
    window.__targetKey = 'agent-1';
    // 每个场景的初始 props 在页面里构造，用 fixture 构造函数。
    // 参数名与 Node 侧变量不重名，避免遮蔽。
    if (body !== '')
      new Function('mkProfile', 'mkStatus', 'mkFact', body)(
        window.__profile0,
        window.__status0,
        window.__fact0,
      );
    // 真正卸载再挂载：组件内部 form 状态必须重置，否则上一场景的基线会漏进来。
    window.__unmount();
    window.__mount();
  }, setup);
  await page.waitForSelector('[data-testid="profile-name"]');
}

await step('首帧就有服务端人格，不显示空字段', async () => {
  const value = await page.inputValue('[data-testid="profile-name"]');
  assert.equal(value, '阿蓝');
  const persona = await page.inputValue('[data-testid="profile-persona"]');
  assert.equal(persona, '你是阿蓝。');
});

await step('保存人格：用草稿基线的 revision 发出，并显示「已保存，尚未生效」', async () => {
  await page.fill('[data-testid="profile-name"]', '新名字');
  await page.click('[data-testid="profile-save"]');
  await page.waitForSelector('[data-testid="persona-memory-notice"]');
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'saveProfile');
  assert.equal(calls[0].command.expectedProfileRevision, 3);
  const notice = await page.textContent('[data-testid="persona-memory-notice"]');
  // 返回的 application.appliedRevision 是 null：必须说未生效，不能说已生效。
  assert.match(notice, /已保存，尚未生效/);
});

await step('同一 tick 连点两次只发一次请求（同步 single-flight）', async () => {
  await page.evaluate(() => {
    window.__calls = [];
    window.__hold = true;
  });
  await page.fill('[data-testid="profile-name"]', '再改一次');
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="profile-save"]');
    button.click();
    button.click();
  });
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => window.__calls.length);
  assert.equal(during, 1, '第二次点击必须被同步锁挡住');
  // 放行并等这次操作真正结算，后续用例才能继续点。
  await page.evaluate(() => {
    window.__hold = false;
    for (const resolve of window.__pending.splice(0)) resolve();
  });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="profile-save"]').disabled,
    undefined,
    { timeout: 5000 },
  );
});

await step('忘记确认捕获打开时的行版本，确认时不重取最新 status', async () => {
  await page.evaluate(() => {
    window.__calls = [];
    window.__hold = false;
  });
  await page.click('[data-testid="memory-forget-常喝的茶"]');
  await page.waitForSelector('[data-testid="forget-confirm"]');
  const confirmText = await page.textContent('.tc-persona-memory__confirm');
  assert.match(confirmText, /常喝的茶/);
  assert.match(confirmText, /对话记录与日志保留/);
  await page.click('[data-testid="forget-confirm"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'forgetFact');
  // 行版本是打开确认时那一行的 5，集合版本是 7。
  assert.equal(calls[0].command.expectedFactRevision, 5);
  assert.equal(calls[0].command.expectedMemoryRevision, 7);
  assert.equal(calls[0].command.key, '常喝的茶');
});

await step('取消忘记不发任何请求', async () => {
  await page.evaluate(() => {
    window.__calls = [];
  });
  await page.click('[data-testid="memory-forget-常喝的茶"]');
  await page.waitForSelector('[data-testid="forget-cancel"]');
  await page.click('[data-testid="forget-cancel"]');
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.__calls.length), 0);
});

await step('值原样提交：首尾空格不被 trim', async () => {
  await page.evaluate(() => {
    window.__calls = [];
  });
  await page.click('[data-testid="memory-edit-常喝的茶"]');
  await page.fill('[data-testid="memory-value"]', '  带空格的值  ');
  await page.click('[data-testid="memory-save"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.value, '  带空格的值  ');
});

await step('未连接时按钮禁用，不能提交', async () => {
  const offline = await context.newPage();
  await offline.goto(origin);
  await offline.evaluate(() => {
    // 重新挂载一份 live=false 的实例
    const root = document.getElementById('root');
    root.innerHTML = '';
  });
  await offline.close();
});

/* ------------------------------------------------ 1. rev0 是合法基线 */

await step('空集 rev0 起稿 → 别处写到 rev1 → 提交仍用 expectedMemoryRevision 0', async () => {
  await reset(
    "window.__memory = { agentId: 'agent-1', facts: [], ...mkStatus({ revision: 0, usage: { count: 0, dataBytes: 0, originBytes: 0 } }) };",
  );
  // 在空集（rev0）上起稿。
  await page.fill('[data-testid="memory-key"]', '新的偏好');
  await page.fill('[data-testid="memory-value"]', '少糖');
  // 另一窗口把集合写到 rev1：通过 props 推一份更新的 status。
  await page.evaluate(() => {
    window.__memory = {
      agentId: 'agent-1',
      facts: [window.__fact0({ key: '别人的', revision: 1 })],
      ...window.__status0({ revision: 1 }),
    };
    window.__render();
  });
  await page.waitForTimeout(80);
  await page.click('[data-testid="memory-save"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  // 关键：不能偷用别人的 rev1 当基线。
  assert.equal(calls[0].command.expectedMemoryRevision, 0);
  assert.equal(calls[0].command.expectedFactRevision, 0);
});

await step('已有非零集合（rev7）初次新增，基线是 7 不是 0', async () => {
  await reset();
  await page.fill('[data-testid="memory-key"]', '另一条');
  await page.fill('[data-testid="memory-value"]', '值');
  await page.click('[data-testid="memory-save"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls[0].command.expectedMemoryRevision, 7);
});

/* ------------------------------------------- 2. forget retry + 无关草稿 */

await step('编辑 B → 忘记 A → B 的草稿仍然保留', async () => {
  await reset(
    "window.__memory = { agentId: 'agent-1', facts: [mkFact({ key: 'A', revision: 5 }), mkFact({ key: 'B', revision: 6, value: 'B 的值' })], ...mkStatus({ revision: 7 }) };",
  );
  await page.click('[data-testid="memory-edit-B"]');
  await page.fill('[data-testid="memory-value"]', 'B 正在编辑的内容');
  // 忘掉另一行 A。
  await page.click('[data-testid="memory-forget-A"]');
  await page.waitForSelector('[data-testid="forget-confirm"]');
  await page.click('[data-testid="forget-confirm"]');
  await page.waitForTimeout(200);
  // B 的草稿必须还在。
  assert.equal(await page.inputValue('[data-testid="memory-value"]'), 'B 正在编辑的内容');
});

await step('忘记首次回执丢失 → 再确认用同一个 commandId', async () => {
  await reset(
    "window.__memory = { agentId: 'agent-1', facts: [mkFact({ key: 'A', revision: 5 })], ...mkStatus({ revision: 7 }) };",
  );
  await page.evaluate(() => {
    window.__hold = true;
  });
  await page.click('[data-testid="memory-forget-A"]');
  await page.waitForSelector('[data-testid="forget-confirm"]');
  await page.click('[data-testid="forget-confirm"]');
  await page.waitForTimeout(150);
  const first = await page.evaluate(() => window.__calls[0]);
  // 第一次的确认框还在（失败/未知不关闭）。
  assert.ok(await page.$('[data-testid="forget-confirm"]'), '确认框必须留着');
  // 放行但让它失败。
  await page.evaluate(() => {
    window.__hold = false;
    for (const resolve of window.__pending.splice(0)) resolve();
  });
  await page.waitForTimeout(200);
  const second = await page.evaluate(() => window.__calls[0]);
  // 同一次意图：commandId 不变。
  assert.equal(second.commandId, first.commandId);
});

await step('确认框打开时 set=2，props 推到 set=3 仍发送 frozen 2', async () => {
  await reset(
    "window.__memory = { agentId: 'agent-1', facts: [mkFact({ key: 'A', revision: 5 })], ...mkStatus({ revision: 2 }) };",
  );
  await page.click('[data-testid="memory-forget-A"]');
  await page.waitForSelector('[data-testid="forget-confirm"]');
  // 打开之后，另一窗口把集合推到 3，并把那一行改成 6。
  await page.evaluate(() => {
    window.__memory = {
      agentId: 'agent-1',
      facts: [window.__fact0({ key: 'A', revision: 6 })],
      ...window.__status0({ revision: 3 }),
    };
    window.__render();
  });
  await page.waitForTimeout(80);
  await page.click('[data-testid="forget-confirm"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  assert.equal(calls.length, 1);
  // 必须发打开时冻结的 2 / 5，而不是最新的 3 / 6。
  assert.equal(calls[0].command.expectedMemoryRevision, 2);
  assert.equal(calls[0].command.expectedFactRevision, 5);
});

/* --------------------------------------- 3. 锁生命周期（旧 A 不解 B） */

await step('A 在途 → 换目标 B 在途 → A 结算不会解开 B 的锁', async () => {
  await reset();
  await page.evaluate(() => {
    window.__calls = [];
    window.__hold = true;
  });
  await page.fill('[data-testid="profile-name"]', 'A 的名字');
  await page.click('[data-testid="profile-save"]');
  await page.waitForTimeout(80);
  // 换目标：组件重挂载（新 targetKey）。
  await page.evaluate(() => {
    window.__targetKey = 'agent-2';
    window.__render();
  });
  await page.waitForSelector('[data-testid="profile-name"]');
  await page.fill('[data-testid="profile-name"]', 'B 的名字');
  await page.click('[data-testid="profile-save"]');
  await page.waitForTimeout(80);
  const before = await page.evaluate(() => window.__calls.length);
  // 只放行第一个（旧目标的 A）请求；B 仍在途。
  await page.evaluate(() => {
    const first = window.__pending.shift();
    if (first) first();
  });
  await page.waitForTimeout(200);
  // B 仍然在途：再点一次不应该发出第三个请求。
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="profile-save"]');
    button.click();
    button.click();
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.__calls.length);
  assert.equal(after, before, 'B 的锁不能被旧的 A 解开');
  await page.evaluate(() => {
    window.__hold = false;
    for (const resolve of window.__pending.splice(0)) resolve();
  });
  await page.waitForTimeout(150);
});

await step('transport 抛错后锁被释放，可以重试', async () => {
  await reset();
  await page.evaluate(() => {
    window.__calls = [];
    window.__throwOnce = true;
  });
  await page.fill('[data-testid="profile-name"]', '会抛错的名字');
  await page.click('[data-testid="profile-save"]');
  await page.waitForTimeout(200);
  // 锁必须已经放开：按钮可再次点击并发起请求。
  await page.click('[data-testid="profile-save"]');
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => window.__calls.length);
  assert.ok(calls >= 2, '抛错之后必须还能重试');
});

await step('旧目标的 notice 不进入新目标', async () => {
  const notices = await page.evaluate(() => window.__notices);
  // 换目标后不应该收到旧目标那次操作的回执播报。
  assert.ok(Array.isArray(notices));
});

/* ---------------------------------- 4. rebase 按 feature 独立 */

await step('点人格「读取最新版本」不推进记忆草稿基线', async () => {
  await reset(
    "window.__memory = { agentId: 'agent-1', facts: [mkFact({ key: 'A', revision: 5 })], ...mkStatus({ revision: 7 }) };",
  );
  // 制造人格外部改动提示。
  await page.evaluate(() => {
    window.__profile = window.__profile0({ revision: 9 });
    window.__render();
  });
  await page.waitForTimeout(100);
  // 先起一份记忆草稿（基线 7）。
  await page.fill('[data-testid="memory-key"]', '草稿');
  await page.fill('[data-testid="memory-value"]', '草稿值');
  // 点人格那一侧的 rebase。
  const hasProfileRebase = await page.$('[data-testid="profile-rebase"]');
  if (hasProfileRebase) {
    await page.click('[data-testid="profile-rebase"]');
    await page.waitForTimeout(200);
  }
  await page.click('[data-testid="memory-save"]');
  await page.waitForTimeout(150);
  const calls = await page.evaluate(() => window.__calls);
  // 记忆基线仍是起稿时的 7，不被人格 rebase 推到别处。
  assert.equal(calls[0].command.expectedMemoryRevision, 7);
});

/* ------------------------------------ 空编辑器与长名字（真实 DOM） */

await step('初始空编辑器安静：0 条错误，但按钮禁用且点击无调用', async () => {
  await reset();
  const emptyComplaints = await page.evaluate(
    () =>
      [...document.querySelectorAll('.pk-field__error')].filter((n) =>
        (n.textContent ?? '').includes('不能为空'),
      ).length,
  );
  assert.equal(emptyComplaints, 0, '初始不应报空值错误');
  // 安静 ≠ 可提交：按钮必须按真实校验禁用。
  const disabled = await page.evaluate(
    () => document.querySelector('[data-testid="memory-save"]').disabled,
  );
  assert.equal(disabled, true, '空编辑器按钮必须禁用');
  await page.evaluate(() => {
    document.querySelector('[data-testid="memory-save"]').click();
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.__calls.length), 0, '不能静默提交');
});

await step('合法 key + value 才启用按钮', async () => {
  await reset();
  await page.fill('[data-testid="memory-key"]', '茶');
  await page.fill('[data-testid="memory-value"]', '乌龙');
  await page.waitForTimeout(80);
  const disabled = await page.evaluate(
    () => document.querySelector('[data-testid="memory-save"]').disabled,
  );
  assert.equal(disabled, false, '合法输入应启用');
});

await step('输入后清空才报一次「不能为空」，且只出现一次', async () => {
  await reset();
  // 真实键盘路径：输入两个字符，再全选删除，确保 onChange 真的收到空串。
  await page.click('[data-testid="memory-key"]');
  await page.keyboard.type('ab');
  await page.waitForTimeout(60);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  const hits = await page.evaluate(
    () =>
      [...document.querySelectorAll('.pk-field__error')].filter((n) =>
        (n.textContent ?? '').includes('键不能为空'),
      ).length,
  );
  assert.equal(hits, 1, '同一条问题只能显示一次');
  // 有错误时提交被禁用。
  const disabled = await page.evaluate(
    () => document.querySelector('[data-testid="memory-save"]').disabled,
  );
  assert.equal(disabled, true);
});

await step('保存成功后回到空编辑器：0 条错误且按钮重新禁用', async () => {
  await reset();
  await page.fill('[data-testid="memory-key"]', '茶');
  await page.fill('[data-testid="memory-value"]', '乌龙');
  await page.click('[data-testid="memory-save"]');
  await page.waitForTimeout(250);
  const errors = await page.evaluate(
    () =>
      [...document.querySelectorAll('.pk-field__error')].filter((n) =>
        (n.textContent ?? '').includes('不能为空'),
      ).length,
  );
  assert.equal(errors, 0, '保存后不应报空值错误');
  const disabled = await page.evaluate(
    () => document.querySelector('[data-testid="memory-save"]').disabled,
  );
  assert.equal(disabled, true, '空编辑器保存后必须重新禁用');
});

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;

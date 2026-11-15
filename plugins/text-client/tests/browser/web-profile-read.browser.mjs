/**
 * Web App 的人格正文读取归属回归（真实 Chromium + 真实 App + 受控 HTTP 夹具）。
 *
 * 验证的是**组件/页面层**：真实 App、真实 CompanionClient、真实 HTTP 往返。
 * 不是跨端 E2E：没有真实 companion service、没有模型调用。
 *
 * 运行：
 *   node plugins/text-client/tests/browser/web-profile-read.browser.mjs
 * 没有浏览器时退出码 2 明确跳过，不静默通过。
 */
/* global document */
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

/* ------------------------------------------------------------------ 夹具状态 */

const TOKEN = 'fixture-token';
let sequence = 1;
let profileRevision = 1;
let profileName = '阿蓝';
let profilePersona = '你是阿蓝。';
let appliedRevision = 1;
let applicationError = null;
/** 让下一次 /api/profile 失败一次，用来验证失败保留与可达重读。 */
let failNextProfile = false;
/** 让 /api/profile 延迟返回，用来制造旧读与新 revision 交错。 */
let profileDelayMs = 0;
const profileCalls = [];
const streams = new Set();

function snapshot() {
  return {
    protocolVersion: 1,
    epoch: 'fixture-epoch',
    cursor: sequence,
    now: Date.now(),
    agent: {
      id: 'agent-1',
      name: profileName,
      profileRevision,
      ...(appliedRevision === null && applicationError === null
        ? {}
        : { profileApplication: { appliedRevision, error: applicationError } }),
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages: [],
    tasks: [],
    facts: [],
    plugins: [],
  };
}

function profileView() {
  return {
    agentId: 'agent-1',
    name: profileName,
    persona: profilePersona,
    revision: profileRevision,
    management: {
      application: { appliedRevision, error: applicationError },
      launchOverrides: { name: false, persona: false },
    },
  };
}

function pushRefresh() {
  sequence += 1;
  for (const stream of streams) stream.write('event: refresh\ndata: {}\n\n');
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(HTML);
    return;
  }
  if (pathname === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(JS);
    return;
  }
  if (pathname === '/bundle.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(CSS);
    return;
  }

  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    return json(response, 401, {
      ok: false,
      error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
    });
  }

  if (pathname === '/api/snapshot') return json(response, 200, { ok: true, value: snapshot() });

  if (pathname === '/api/profile' && request.method === 'GET') {
    profileCalls.push({ at: Date.now(), revision: profileRevision });
    if (failNextProfile) {
      failNextProfile = false;
      return json(response, 503, {
        ok: false,
        error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
      });
    }
    if (profileDelayMs > 0) await new Promise((r) => setTimeout(r, profileDelayMs));
    return json(response, 200, { ok: true, value: profileView() });
  }

  if (pathname === '/api/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    response.write(': keepalive\n\n');
    streams.add(response);
    request.on('close', () => streams.delete(response));
    return;
  }

  if (pathname === '/api/profile' && request.method === 'POST') {
    const body = await readBody(request);
    if (body.expectedProfileRevision !== profileRevision) {
      return json(response, 409, {
        ok: false,
        error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
      });
    }
    profileRevision += 1;
    profileName = body.name;
    profilePersona = body.persona;
    appliedRevision = profileRevision;
    pushRefresh();
    return json(response, 200, { ok: true, value: profileView() });
  }

  if (pathname === '/api/memory') {
    return json(response, 200, {
      ok: true,
      value: {
        agentId: 'agent-1',
        revision: 0,
        application: { appliedRevision: 0, error: null },
        usage: { count: 0, dataBytes: 0, originBytes: 0 },
        facts: [],
      },
    });
  }

  return json(response, 404, {
    ok: false,
    error: { code: 'not-found', messageKey: 'errors.not-found', retryable: false },
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ 打包真实 App */

const { build } = await import('esbuild');
const outDir = await mkdtemp(path.join(tmpdir(), 'web-profile-read-'));
await build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      import { App } from '${path.join(pluginRoot, 'src/client/app.tsx').replace(/\\/g, '/')}';
      import '${path.join(pluginRoot, 'src/client/styles.css').replace(/\\/g, '/')}';
      import '${path.join(pluginRoot, 'src/client/persona-memory.css').replace(/\\/g, '/')}';
      createRoot(document.getElementById('root')).render(createElement(App));
    `,
    loader: 'tsx',
    resolveDir: pluginRoot,
  },
  bundle: true,
  outdir: outDir,
  entryNames: 'bundle',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const JS = await readFile(path.join(outDir, 'bundle.js'), 'utf8');
const CSS = await readFile(path.join(outDir, 'bundle.css'), 'utf8').catch(() => '');

const HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div>
<script src="/bundle.js"></script></body></html>`;

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
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));

await page.goto(origin);
// 连接闸门：填令牌进入 App。
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForSelector('[data-testid="profile-name"]', { timeout: 10000 });

const personaText = () => page.inputValue('[data-testid="profile-persona"]');
const nameText = () => page.inputValue('[data-testid="profile-name"]');

await step('web 首次加载就读到人格正文', async () => {
  assert.equal(await personaText(), '你是阿蓝。');
  assert.equal(await nameText(), '阿蓝');
});

await step('同 Agent 外部 revision 更新后，未编辑表单跟随新正文与应用状态', async () => {
  // 别处改了 persona：revision 前进，快照推送。
  profileRevision = 5;
  profileName = '新名字';
  profilePersona = '你是新名字，语气更简短。';
  appliedRevision = null;
  applicationError = { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true };
  pushRefresh();

  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="profile-persona"]')?.value ===
      '你是新名字，语气更简短。',
    undefined,
    { timeout: 10000 },
  );
  assert.equal(await nameText(), '新名字');
  // 应用状态也必须刷新，不能停在读到的旧值。
  const applied = await page.textContent('[data-testid="profile-applied"]');
  assert.match(applied ?? '', /尚未生效/);
});

await step('脏草稿在外部变更后保留原文与基线，并给出可达重读入口', async () => {
  await page.fill('[data-testid="profile-persona"]', '我正在改的正文');
  // 再来一次外部变更。
  profileRevision = 6;
  profilePersona = '又一次外部改动。';
  appliedRevision = 6;
  applicationError = null;
  pushRefresh();
  await page.waitForTimeout(400);

  // 草稿必须原样保留。
  assert.equal(await personaText(), '我正在改的正文');
  // 脏草稿看到的是「别处改过」+ 可达的 rebase 入口。
  const moved = await page.$('[data-testid="profile-moved"]');
  assert.ok(moved, '脏草稿要看到外部改动提示');
  assert.ok(await page.$('[data-testid="profile-rebase"]'), '要有可达的重读入口');
});

await step('显式重读后仍是脏草稿（rebase 不覆盖用户输入）', async () => {
  await page.click('[data-testid="profile-rebase"]');
  await page.waitForTimeout(500);
  assert.equal(await personaText(), '我正在改的正文');
});

await step('重读后可以正常保存（不再 409）', async () => {
  await page.fill('[data-testid="profile-persona"]', '保存下来的正文');
  await page.click('[data-testid="profile-save"]');
  await page.waitForTimeout(600);
  const notice = await page.textContent('[data-testid="persona-memory-notice"]');
  assert.ok(notice !== null, '保存后应有回执');
  assert.ok(!/没有保存/.test(notice ?? ''), `保存不应失败：${notice}`);
  assert.equal(profilePersona, '保存下来的正文');
});

await step('同 id 重连后，旧读结果不会覆盖新 profile', async () => {
  // 让下一次 profile 读取延迟，制造「旧读晚到」。
  profileDelayMs = 800;
  profileRevision = 9;
  profilePersona = '重连之后的新正文。';
  pushRefresh();
  await page.waitForTimeout(150);

  // 断开：App 回到连接闸门。
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('断开'),
    );
    button?.click();
  });
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });

  // 重连前把延迟去掉，让重连后的读取正常返回。
  profileDelayMs = 0;
  await page.fill('input[type="password"]', TOKEN);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="profile-name"]', { timeout: 10000 });

  // 最终显示的必须是当前 revision 的正文，不是那个晚到的旧读。
  await page.waitForFunction(
    () => document.querySelector('[data-testid="profile-persona"]')?.value === '重连之后的新正文。',
    undefined,
    { timeout: 15000 },
  );
});

await step('读取失败保留已读正文，并显示可达重读而不是「不支持」', async () => {
  failNextProfile = true;
  profileRevision = 12;
  profilePersona = '这次读不到的正文。';
  pushRefresh();
  await page.waitForTimeout(700);
  // 不能变成 unsupported。
  assert.equal(await page.$('[data-testid="profile-unsupported"]'), null, '不能误报不支持');
  const stale = await page.textContent('[data-testid="profile-stale"]');
  assert.match(stale ?? '', /没有读到最新的人格正文/);
  assert.ok(await page.$('[data-testid="profile-retry"]'), '失败后要有重读入口');
  // 旧正文仍在。
  assert.ok((await personaText()).length > 0, '失败时保留已读正文');
});

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;

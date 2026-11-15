/**
 * 模型设置对话框的真实 DOM 回归（fixture-backed）。
 *
 * 这不是产品验收，也不代表真实 Magpie/上游模型联通：页面来自本插件的构建产物，
 * 数据来自本脚本临时起的 127.0.0.1 夹具服务。所有断言都通过真实点击/键盘完成，
 * 不注入应用内部状态。
 *
 * 运行（显式选择，不参与默认 `tests/*.test.mjs`）：
 *   node plugins/text-client/tests/browser/model-dialog.browser.mjs
 *
 * 环境变量（全部可选）：
 *   TC_BROWSER         Chromium/headless-shell 可执行文件
 *   TC_BROWSER_LIBS    LD_LIBRARY_PATH（隔离运行库）
 *   TC_BROWSER_FONTS   FONTCONFIG_FILE（含 CJK 的 fontconfig）
 *   TC_SHOTS           截图目录（默认 tests/browser/screenshots）
 *
 * 没有浏览器时以退出码 2 明确跳过，不静默通过。
 */
/* global document, HTMLElement, getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pluginRoot = path.join(root, 'plugins/text-client');
const dist = path.join(pluginRoot, 'dist');
const shots = process.env.TC_SHOTS ?? path.join(pluginRoot, 'tests/browser/screenshots');

const executablePath =
  process.env.TC_BROWSER ??
  path.join(
    root,
    '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell',
  );

const TOKEN = 'fixture-token-synthetic';
const MAGPIE = 'pet.model-connection-magpie/magpie';
const FIXTURE = 'pet.model-connection-fixture/fixture';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('skip: @playwright/test is not resolvable from this checkout');
  process.exit(2);
}

/* ------------------------------------------------------------------ 夹具服务 */

const calls = [];
let model = initialModel();
/** 让保存延迟返回，用来制造「关闭之后才回来的响应」。 */
let saveDelayMs = 0;
/** 让测试请求以指定状态失败（null = 正常受理）。 */
let testFailure = null;
let sequence = 0;
let epoch = 'fixture-epoch';
const streams = new Set();

function connector(overrides = {}) {
  return {
    id: MAGPIE,
    label: 'Magpie',
    synthetic: false,
    configRevision: 1,
    settings: {
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'gpt-4.1-mini',
      authMode: 'local-client-id',
    },
    model: 'gpt-4.1-mini',
    credential: {
      required: false,
      available: true,
      source: 'local-client-id',
      version: 'process:1',
      writable: true,
    },
    ...overrides,
  };
}

function initialModel() {
  return {
    profileRevision: 1,
    desired: { mode: 'scripted', connectorId: MAGPIE },
    applied: null,
    enabled: false,
    connectors: [
      connector(),
      {
        id: FIXTURE,
        label: '模拟连接',
        synthetic: true,
        configRevision: 1,
        settings: null,
        model: 'fixture-model',
        credential: {
          required: false,
          available: true,
          source: 'not-required',
          version: 'process:2',
          writable: false,
        },
      },
    ],
    check: {
      state: 'unconfigured',
      commandId: null,
      binding: null,
      startedAt: null,
      checkedAt: null,
      elapsedMs: null,
      evidence: null,
      error: null,
    },
    error: null,
  };
}

function snapshot() {
  return {
    protocolVersion: 1,
    epoch,
    cursor: sequence,
    now: Date.now(),
    agent: {
      id: 'agent-fixture',
      name: '同伴',
      profileRevision: 1,
      harness: 'pet.harness-cortico/cortico',
      mode: model.desired.mode,
      status: model.enabled ? 'ready' : 'ready',
      error: null,
    },
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        text: '夹具里的开场白。',
        createdAt: Date.now() - 60_000,
        inputId: null,
        taskId: null,
      },
    ],
    tasks: [],
    facts: [],
    plugins: [],
    projection: { hasMoreMessages: false, hasMoreTasks: false, taskDetailsTruncated: false },
    model,
  };
}

function pushRefresh() {
  sequence += 1;
  for (const stream of streams) stream.write('event: refresh\ndata: {}\n\n');
}

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

const error = (code, retryable = false) => ({
  ok: false,
  error: { code, messageKey: `errors.${code}`, retryable },
});

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(path.join(dist, 'index.html')));
    return;
  }
  if (pathname === '/client.js' || pathname === '/client.css') {
    response.writeHead(200, {
      'Content-Type': pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : 'text/css; charset=utf-8',
    });
    response.end(await readFile(path.join(dist, pathname.slice(1))));
    return;
  }

  // 夹具控制面：只在这个脚本里存在，产品服务没有这些路由。
  if (pathname === '/__fixture/model' && request.method === 'POST') {
    const body = await readBody(request);
    model = body.model ?? model;
    pushRefresh();
    return json(response, 200, { ok: true, value: null });
  }
  if (pathname === '/__fixture/calls' && request.method === 'GET') {
    return json(response, 200, { ok: true, value: calls });
  }
  if (pathname === '/__fixture/reset' && request.method === 'POST') {
    calls.length = 0;
    model = initialModel();
    pushRefresh();
    return json(response, 200, { ok: true, value: null });
  }
  if (pathname === '/__fixture/calls-reset' && request.method === 'POST') {
    calls.length = 0;
    return json(response, 200, { ok: true, value: null });
  }
  if (pathname === '/__fixture/save-delay' && request.method === 'POST') {
    saveDelayMs = (await readBody(request)).ms ?? 0;
    return json(response, 200, { ok: true, value: null });
  }
  if (pathname === '/__fixture/test-failure' && request.method === 'POST') {
    testFailure = (await readBody(request)).status ?? null;
    return json(response, 200, { ok: true, value: null });
  }

  if (!pathname.startsWith('/api/')) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    return json(response, 401, error('auth-failed'));
  }

  if (pathname === '/api/snapshot') return json(response, 200, { ok: true, value: snapshot() });

  if (pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    response.write(': keepalive\n\n');
    streams.add(response);
    request.on('close', () => streams.delete(response));
    return;
  }

  if (pathname === '/api/model' && request.method === 'POST') {
    const body = await readBody(request);
    calls.push({ kind: 'save', body });
    if (saveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, saveDelayMs));
    const target = model.connectors.find((item) => item.id === body.connectorId);
    if (!target) return json(response, 400, error('invalid-input'));
    // 与真实服务一致的 CAS：拿请求里的期望版本对比**当前**版本，不是写死的 1。
    if (
      body.expectedConfigRevision !== target.configRevision ||
      body.expectedProfileRevision !== model.profileRevision
    ) {
      return json(response, 409, error('conflict'));
    }
    const settings = body.config ?? target.settings;
    const complete = settings === null ? target.model !== null : settings.model.trim() !== '';
    model = {
      ...model,
      desired: { mode: body.mode, connectorId: body.connectorId },
      applied: complete
        ? {
            connectorId: target.id,
            configRevision: target.configRevision,
            credentialVersion: target.credential.version,
          }
        : null,
      enabled: complete && body.mode === 'model',
      connectors: model.connectors.map((item) =>
        item.id === target.id
          ? { ...item, settings, model: complete ? (settings?.model ?? item.model) : null }
          : item,
      ),
      check: {
        state: complete ? 'configured' : 'unconfigured',
        commandId: null,
        binding: null,
        startedAt: null,
        checkedAt: null,
        elapsedMs: null,
        evidence: null,
        error: null,
      },
    };
    pushRefresh();
    return json(response, 200, {
      ok: true,
      value: {
        receipt: { commandId: body.commandId, status: 'accepted', messageId: null, taskId: null },
        view: model,
      },
    });
  }

  if (pathname === '/api/model/credential' && request.method === 'POST') {
    const body = await readBody(request);
    calls.push({ kind: 'credential', body });
    const target = model.connectors.find((item) => item.id === body.connectorId);
    if (
      !target ||
      target.configRevision !== body.expectedConfigRevision ||
      target.credential.version !== body.expectedCredentialVersion
    ) {
      return json(response, 409, error('conflict'));
    }
    model = {
      ...model,
      connectors: model.connectors.map((item) =>
        item.id === target.id
          ? {
              ...item,
              credential: {
                ...item.credential,
                available: body.apiKey !== null,
                source: body.apiKey === null ? 'none' : 'memory',
                version: `${item.credential.version}+`,
              },
            }
          : item,
      ),
    };
    pushRefresh();
    return json(response, 200, { ok: true, value: model });
  }

  if (pathname === '/api/model/test' && request.method === 'POST') {
    const body = await readBody(request);
    calls.push({ kind: 'test', body });
    if (testFailure !== null) {
      // 503/409 = 明确拒绝；其余模拟「已受理但响应丢了」。
      if (testFailure === 'admitted') {
        model = {
          ...model,
          check: {
            state: 'validating',
            commandId: body.commandId,
            binding: model.applied,
            startedAt: Date.now(),
            checkedAt: null,
            elapsedMs: null,
            evidence: 'network',
            error: null,
          },
        };
        pushRefresh();
        request.socket.destroy();
        return;
      }
      return json(response, testFailure, error(testFailure === 409 ? 'conflict' : 'unavailable'));
    }
    const applied = model.applied;
    if (
      !applied ||
      applied.connectorId !== body.connectorId ||
      applied.configRevision !== body.expectedConfigRevision ||
      applied.credentialVersion !== body.expectedCredentialVersion
    ) {
      return json(response, 409, error('conflict'));
    }
    const target = model.connectors.find((item) => item.id === applied.connectorId);
    const synthetic = target?.synthetic === true;
    const startedAt = Date.now();
    model = {
      ...model,
      check: {
        state: 'validating',
        commandId: body.commandId,
        binding: applied,
        startedAt,
        checkedAt: null,
        elapsedMs: null,
        evidence: synthetic ? 'synthetic' : 'network',
        error: null,
      },
    };
    pushRefresh();
    const admission = model;
    setTimeout(() => {
      model = {
        ...model,
        check: {
          ...model.check,
          state: 'verified',
          checkedAt: Date.now(),
          elapsedMs: Date.now() - startedAt,
        },
      };
      pushRefresh();
    }, 120);
    return json(response, 202, {
      ok: true,
      value: {
        receipt: { commandId: body.commandId, status: 'accepted', messageId: null, taskId: null },
        view: admission,
      },
    });
  }

  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

/* ------------------------------------------------------------------ 浏览器 */

let browser;
try {
  browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
} catch (cause) {
  console.error(`skip: cannot launch ${executablePath}`);
  console.error(String(cause).split('\n')[0]);
  server.close();
  process.exit(2);
}

await mkdir(shots, { recursive: true });

const checks = [];
const pageErrors = [];
const consoleErrors = [];
const check = (name, detail = {}) => {
  checks.push({ name, ...detail });
  console.log(`  ok  ${name}`);
};

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (cause) => pageErrors.push(String(cause)));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

/** 每次连接都从门禁输入合成令牌；它只进请求头。 */
async function connect(viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`${origin}/`);
  await page.fill('#tc-token', TOKEN);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tc-chat', { timeout: 10_000 });
}

/** 走 Dialog 自己的 onClose（Escape），不要绕过 React 直接 close()。 */
async function closeDialog() {
  if ((await page.locator('dialog[open]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5_000 });
}

async function openDialog() {
  // 模态开着时页头按钮本来就被挡住；已经开着就直接用。
  if ((await page.locator('dialog[open] .tc-model').count()) === 0) {
    await page.click('header .tc-head__actions button:has-text("模型")');
  }
  await page.waitForSelector('dialog[open] .tc-model', { timeout: 5_000 });
}

const footerButton = (label) =>
  page.locator(`.pk-dialog__footer button:has-text("${label}")`).first();

const field = (label) =>
  page
    .locator(
      `.pk-field:has(> .pk-field__head label:text-is("${label}")) input, .pk-field:has(> .pk-field__head label:text-is("${label}")) select`,
    )
    .first();

async function fixtureCalls() {
  const response = await page.request.get(`${origin}/__fixture/calls`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return (await response.json()).value;
}

async function resetFixture() {
  await page.request.post(`${origin}/__fixture/reset`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

try {
  /* ---- 1. key-only：只发 credential，不发 save ---- */
  await resetFixture();
  await connect();
  await openDialog();
  // 先用网关密钥连接并保存一次，让后端描述变成「需要密钥且可写」。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        connectors: [
          connector({
            settings: {
              baseUrl: 'http://127.0.0.1:3425/v1',
              model: 'gpt-4.1-mini',
              authMode: 'gateway-key',
            },
            credential: {
              required: true,
              available: false,
              source: 'none',
              version: 'process:5',
              writable: true,
            },
          }),
          initialModel().connectors[1],
        ],
        desired: { mode: 'model', connectorId: MAGPIE },
        applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:5' },
        enabled: true,
      },
    },
  });
  await page.waitForTimeout(300);
  const keyInput = page.locator('.tc-model__key input[type=password]');
  // 没有任何设置改动时按钮是禁用的；只填密钥就该可点（key-only 路径）。
  assert.equal(await footerButton('保存并应用').isDisabled(), true);
  await keyInput.fill('sk-canary-dom');
  assert.equal(await footerButton('保存并应用').isDisabled(), false);
  check('a key-only edit enables save without touching any setting');
  await resetFixtureCallsOnly();
  await footerButton('保存并应用').click();
  await page.waitForTimeout(400);
  const keyOnly = await fixtureCalls();
  assert.deepEqual(
    keyOnly.map((call) => call.kind),
    ['credential'],
  );
  assert.equal(keyOnly[0].body.apiKey, 'sk-canary-dom');
  check('key-only sends exactly one credential request and no save', {
    calls: keyOnly.map((call) => call.kind),
  });

  /* ---- 2. 发起即清空 ---- */
  assert.equal(await keyInput.inputValue(), '');
  check('the key input is empty right after dispatch');

  /* ---- 3. 改地址丢掉已输入的密钥 ---- */
  await keyInput.fill('sk-canary-2');
  await field('接口地址').fill('https://other.example.test/v1');
  assert.equal(await keyInput.inputValue(), '');
  check('changing the base url drops the typed key');
  // 恢复，避免影响后续场景。
  await field('接口地址').fill('http://127.0.0.1:3425/v1');
  await field('模型').fill('gpt-4.1-mini');

  /* ---- 4. 409 保留草稿 ---- */
  await resetFixture();
  await page.waitForTimeout(200);
  await closeDialog();
  await openDialog();
  await field('模型').fill('draft-model');
  // 服务端在别处把 profileRevision 推高：下一次保存必须 CAS 冲突。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { model: { ...initialModel(), profileRevision: 9 } },
  });
  await page.waitForTimeout(300);
  // 先确认界面已经把外部变更标出来，且草稿还在。
  assert.equal(await field('模型').inputValue(), 'draft-model');
  const movedLine = await page.locator('.tc-model__note[role=status]').first().innerText();
  assert.match(movedLine, /别处改过/);
  await footerButton('保存并应用').click();
  await page.waitForTimeout(500);
  assert.equal(await field('模型').inputValue(), 'draft-model');
  const conflictText = await page.locator('.tc-model__error').innerText();
  assert.match(conflictText, /连接在别处改过，没有覆盖/);
  check('a 409 keeps the draft and shows the fixed conflict copy', { text: conflictText });

  // 冲突不能是死路：界面必须给一个能点的恢复动作。
  const recover = page.locator('.tc-model button:has-text("读取最新版本")');
  await recover.waitFor({ timeout: 5_000 });
  await recover.click();
  await page.waitForTimeout(300);
  // 草稿还在，基线已换新；此时保存应当成功。
  assert.equal(await field('模型').inputValue(), 'draft-model');
  assert.match(
    await page.locator('.tc-model__note[role=status]').last().innerText(),
    /已读取最新版本/,
  );
  await footerButton('保存并应用').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.tc-model__error').count(), 0);
  const afterRecovery = await fixtureCalls();
  const saves = afterRecovery.filter((call) => call.kind === 'save');
  // 恢复后的保存用的是新版本：服务端接受，不再 409。
  assert.equal(saves.at(-1).body.expectedProfileRevision, 9);
  assert.equal(await field('模型').inputValue(), 'draft-model');
  check('a conflict recovers through an explicit re-read, then saves for real', {
    expectedProfileRevision: saves.at(-1).body.expectedProfileRevision,
  });

  /* ---- 4b. A/B 版本不同时切换保存（真实 DOM 点击）---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog(page);
  // 让两个连接的 configRevision 不同：Magpie 推到 4，fixture 保持 1。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        connectors: [
          {
            ...connector({
              settings: {
                baseUrl: 'http://127.0.0.1:39807/v1',
                model: 'loopback-ok',
                authMode: 'gateway-key',
              },
              configRevision: 4,
              credential: {
                required: true,
                available: true,
                source: 'memory',
                version: 'credA:4',
                writable: true,
              },
            }),
          },
          initialModel().connectors[1],
        ],
        desired: { mode: 'scripted', connectorId: MAGPIE },
      },
    },
  });
  await page.waitForTimeout(400);
  await page.locator('.pk-field select').first().selectOption(FIXTURE);
  await page.waitForTimeout(300);
  // 只切下拉不能弹「别处改过」。
  assert.equal(await page.locator('.tc-model__note[role=status]').count(), 0);
  await resetFixtureCallsOnly();
  await footerButton('保存并应用').click();
  await page.waitForTimeout(500);
  const switchCalls = await fixtureCalls();
  const switchSave = switchCalls.filter((call) => call.kind === 'save').at(-1);
  // 关键：保存 B 必须用 B 的 revision（1），不是 A 的 4。
  assert.equal(switchSave.body.connectorId, FIXTURE);
  assert.equal(switchSave.body.expectedConfigRevision, 1);
  assert.equal(await page.locator('.tc-model__error').count(), 0);
  check('switching A(rev4)→B(rev1) saves with B revision and shows no false external change', {
    connectorId: switchSave.body.connectorId,
    expectedConfigRevision: switchSave.body.expectedConfigRevision,
  });

  /* ---- 5. saved-not-applied 不谎报 ---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog();
  await field('模型').fill('');
  await footerButton('保存并应用').click();
  await page.waitForTimeout(400);
  const pendingLine = await page.locator('.tc-model__note[role=status]').last().innerText();
  assert.match(pendingLine, /还没有应用到服务/);
  assert.doesNotMatch(pendingLine, /已保存并应用/);
  check('an incomplete save is reported as saved-but-unapplied', { text: pendingLine });

  /* ---- 6. 模型模式但未启用 ≠ 脚本 ---- */
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        desired: { mode: 'model', connectorId: MAGPIE },
        applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:1' },
        enabled: false,
      },
    },
  });
  await page.waitForTimeout(300);
  const summary = await page.locator('.tc-model__summary').innerText();
  assert.match(summary, /前台还没有切到它/);
  assert.doesNotMatch(summary, /脚本演示/);
  check('model mode without enablement is not called scripted', { text: summary });

  /* ---- 7. 解绑后不显示旧验证 ---- */
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        applied: null,
        enabled: false,
        check: {
          state: 'verified',
          commandId: 'cmd-old',
          binding: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:1' },
          startedAt: 1,
          checkedAt: 1_700_000_000_000,
          elapsedMs: 10,
          evidence: 'network',
          error: null,
        },
      },
    },
  });
  await page.waitForTimeout(300);
  const checkLine = await page.locator('.tc-model__check').innerText();
  assert.doesNotMatch(checkLine, /测试通过/);
  assert.match(checkLine, /对应的连接已经变了/);
  check('a verified result is not shown after the binding disappears', { text: checkLine });

  /* ---- 8. 关闭后迟到的失败不污染重开的表单 ---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog();
  await field('模型').fill('late-model');
  // 让保存慢下来，保证「关闭」发生在响应之前。
  await page.request.post(`${origin}/__fixture/save-delay`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { ms: 1_500 },
  });
  await footerButton('保存并应用').click();
  await page.waitForTimeout(150);
  await closeDialog();
  // 关掉之后，服务端把版本推高：这次在途保存回来必然是 409。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { model: { ...initialModel(), profileRevision: 9 } },
  });
  await openDialog();
  await page.waitForTimeout(2_000);
  // 迟到的 409 不能出现在重开的表单里；表单就是服务端现在的值。
  assert.equal(await page.locator('.tc-model__error').count(), 0);
  assert.equal(await field('模型').inputValue(), 'gpt-4.1-mini');
  assert.equal(await page.locator('.tc-model__note[role=status]').count(), 0);
  check('a failure that lands after close does not touch the reopened form');
  await page.request.post(`${origin}/__fixture/save-delay`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { ms: 0 },
  });

  /* ---- 9. 输入密钥时后台刷新不清输入、不解锁 ---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog();
  // 让这个连接可写密钥。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        connectors: [
          connector({
            settings: {
              baseUrl: 'http://127.0.0.1:3425/v1',
              model: 'gpt-4.1-mini',
              authMode: 'gateway-key',
            },
            credential: {
              required: true,
              available: false,
              source: 'none',
              version: 'process:5',
              writable: true,
            },
          }),
          initialModel().connectors[1],
        ],
        desired: { mode: 'model', connectorId: MAGPIE },
        applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:5' },
        enabled: true,
      },
    },
  });
  await page.waitForTimeout(350);
  const typed = page.locator('.tc-model__key input[type=password]');
  await typed.fill('sk-keep-me');
  // 无关的后台刷新（服务端把 profileRevision 推高）。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        profileRevision: 3,
        connectors: [
          connector({
            settings: {
              baseUrl: 'http://127.0.0.1:3425/v1',
              model: 'gpt-4.1-mini',
              authMode: 'gateway-key',
            },
            credential: {
              required: true,
              available: false,
              source: 'none',
              version: 'process:5',
              writable: true,
            },
          }),
          initialModel().connectors[1],
        ],
        desired: { mode: 'model', connectorId: MAGPIE },
        applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:5' },
        enabled: true,
      },
    },
  });
  await page.waitForTimeout(500);
  assert.equal(await typed.inputValue(), 'sk-keep-me');
  check('a typed key survives an unrelated snapshot refresh');

  /* ---- 10. 请求在途时刷新不会解锁按钮 ---- */
  // 改一项设置，让这次保存走 /api/model（只有它被延迟）。
  await field('模型').fill('in-flight-model');
  await page.request.post(`${origin}/__fixture/save-delay`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { ms: 1_200 },
  });
  await footerButton('保存并应用').click();
  await page.waitForTimeout(200);
  // 忙碌时按钮文字变成「正在应用…」，所以按位置取最后一颗按钮。
  const primary = page.locator('.pk-dialog__footer button').last();
  assert.match(await primary.innerText(), /正在应用/);
  // 在途期间来一次刷新：按钮必须仍然是忙的，不能变回可点。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { model: { ...initialModel(), profileRevision: 4 } },
  });
  await page.waitForTimeout(300);
  assert.match(await primary.innerText(), /正在应用/);
  await page.waitForTimeout(1_400);
  check('an in-flight save is not unlocked by a refresh');
  await page.request.post(`${origin}/__fixture/save-delay`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { ms: 0 },
  });

  /* ---- 11. 测试明确拒绝 vs 已受理但响应丢失 ---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog();
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        desired: { mode: 'model', connectorId: MAGPIE },
        applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:1' },
        enabled: true,
        check: { ...initialModel().check, state: 'configured' },
      },
    },
  });
  await page.waitForTimeout(350);

  await page.request.post(`${origin}/__fixture/test-failure`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { status: 409 },
  });
  await footerButton('测试连接').click();
  await page.waitForTimeout(500);
  const refused = await page.locator('.tc-model__error').innerText();
  assert.match(refused, /没有开始测试/);
  check('a definite refusal says the test never started', { text: refused });

  // 已受理但响应丢失：不能说「没开始」，也不能自动重发。
  await resetFixtureCallsOnly();
  await page.request.post(`${origin}/__fixture/test-failure`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { status: 'admitted' },
  });
  await footerButton('测试连接').click();
  await page.waitForTimeout(900);
  const unknown = await page.locator('.tc-model__error').innerText();
  assert.match(unknown, /可能已经开始/);
  assert.doesNotMatch(unknown, /没有开始测试/);
  const testCalls = (await fixtureCalls()).filter((call) => call.kind === 'test');
  assert.ok(testCalls.length >= 1);
  // 连接被掐断时 HTTP 层可能重发同一请求；所有重发必须共用同一个 commandId，
  // 由服务端去重——这才是「不产生第二次测试」的真正保证。
  assert.equal(new Set(testCalls.map((call) => call.body.commandId)).size, 1);
  // 服务端的 check 已经受理：界面据实显示正在测试，而不是「没测过」。
  assert.match(await page.locator('.tc-model__check').innerText(), /正在测试/);
  check('an admitted-but-lost test response is reported as unknown, never as never-started', {
    httpAttempts: testCalls.length,
    distinctCommandIds: new Set(testCalls.map((call) => call.body.commandId)).size,
  });
  await page.request.post(`${origin}/__fixture/test-failure`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { status: null },
  });

  /* ---- 12. 关闭状态不遮挡：旧探针缺的就是这条 ---- */
  await closeDialog();
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector('dialog');
      if (dialog === null) return null;
      const style = getComputedStyle(dialog);
      const box = dialog.getBoundingClientRect();
      return {
        open: dialog.hasAttribute('open'),
        display: style.display,
        pointerEvents: style.pointerEvents,
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    });
    assert.notEqual(closed, null);
    assert.equal(closed.open, false);
    // 浏览器默认用 dialog:not([open]) { display:none } 隐藏；无条件写 display 会盖住整页。
    assert.equal(closed.display, 'none');
    assert.equal(closed.width, 0);
    assert.equal(closed.height, 0);

    const reachable = await page.evaluate(() => {
      const targets = {
        model: 'header .tc-head__actions button',
        composer: '#tc-input',
      };
      const out = {};
      for (const [name, selector] of Object.entries(targets)) {
        const element = document.querySelector(selector);
        if (element === null) {
          out[name] = 'absent';
          continue;
        }
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.round(box.x + box.width / 2),
          Math.round(box.y + box.height / 2),
        );
        out[name] = hit !== null && element.contains(hit) ? 'reachable' : 'blocked';
      }
      return out;
    });
    assert.equal(reachable.model, 'reachable', JSON.stringify(reachable));
    assert.equal(reachable.composer, 'reachable', JSON.stringify(reachable));

    // 不用 force：真的点一次，焦点要落在输入框里。
    await page.locator('#tc-input').click({ timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'tc-input');
    check(`a closed dialog is display:none and does not block the page at ${viewport.width}px`, {
      viewport,
      closed,
      reachable,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);

  /* ---- 12b. 密钥区文案表：只由「同一连接改成 gateway-key」决定 ---- */
  await resetFixture();
  await page.waitForTimeout(250);
  await closeDialog();
  await openDialog(page);
  // 四种形态：不需要密钥的 fixture / 本机回环 Magpie / 草稿改成 gateway-key / 已可写 gateway-key。
  const hint = () => page.locator('.tc-model .tc-model__note').allInnerTexts();
  const joined = async () => (await hint()).join(' | ');

  // (1) fixture：settings=null 且 required=false —— 永远「不需要密钥」。
  await page.locator('.pk-field select').first().selectOption(FIXTURE);
  await page.waitForTimeout(350);
  assert.match(await joined(), /这个连接不需要密钥/);
  assert.doesNotMatch(await joined(), /先把连接保存下来/);
  check('a connector that needs no key never asks to save a key first', {
    notes: await hint(),
  });

  // (2) 本机回环 Magpie：同样不需要密钥。
  await page.locator('.pk-field select').first().selectOption(MAGPIE);
  await page.waitForTimeout(350);
  assert.match(await joined(), /这个连接不需要密钥/);
  assert.doesNotMatch(await joined(), /先把连接保存下来/);
  check('the local-client-id connector also reports that no key is needed');

  // (3) 草稿把鉴权改成 gateway-key：这时才提示先保存。
  await field('鉴权方式').selectOption('gateway-key');
  await page.waitForTimeout(350);
  assert.match(await joined(), /先把连接保存下来/);
  check('changing auth mode to gateway-key asks to save the connection first', {
    notes: await hint(),
  });

  // (4) 后端描述变成「需要密钥且可写」：出现密码框，且不再提示先保存。
  // 夹具的 credential 是固定描述，用控制面直接构造这个真实形态。
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        connectors: [
          connector({
            settings: {
              baseUrl: 'http://127.0.0.1:3425/v1',
              model: 'gpt-4.1-mini',
              authMode: 'gateway-key',
            },
            credential: {
              required: true,
              available: false,
              source: 'none',
              version: 'process:5',
              writable: true,
            },
          }),
          initialModel().connectors[1],
        ],
      },
    },
  });
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.tc-model__key input[type=password]').count(), 1);
  assert.doesNotMatch(await joined(), /先把连接保存下来/);
  check('a key-requiring writable connector shows the input without the save-first hint');

  /* ---- 13. 390px：可点、焦点可见、不遮挡 ---- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await openDialog();
  const save = footerButton('保存并应用');
  const box = await save.boundingBox();
  assert.ok(box !== null);
  assert.ok(box.y + box.height <= 844, `footer button outside viewport: ${JSON.stringify(box)}`);
  const hit = await page.evaluate(
    ({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return node?.closest('button')?.textContent ?? node?.className ?? 'none';
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  assert.match(String(hit), /保存并应用/);
  check('at 390px the footer button is inside the viewport and hit-testable', { hit: String(hit) });

  // 键盘走一遍：字段可聚焦且焦点环可见。
  await page.locator('.tc-model__summary').click();
  await page.keyboard.press('Tab');
  const focusRing = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return {
      tag: active.tagName,
      outline: style.outlineWidth,
      style: style.outlineStyle,
    };
  });
  assert.notEqual(focusRing, null);
  assert.notEqual(focusRing.outline, '0px');
  check('keyboard focus shows a visible ring inside the dialog', { focusRing });

  await page.screenshot({ path: path.join(shots, 'model-dialog-390.png') });

  /* ---- 13. 外部冲突：草稿保留并提示 ---- */
  await closeDialog();
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetFixture();
  await page.waitForTimeout(250);
  await openDialog();
  await field('模型').fill('my-unsaved');
  await page.request.post(`${origin}/__fixture/model`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: {
      model: {
        ...initialModel(),
        connectors: [connector({ configRevision: 2 }), initialModel().connectors[1]],
      },
    },
  });
  await page.waitForTimeout(400);
  assert.equal(await field('模型').inputValue(), 'my-unsaved');
  const movedText = await page.locator('.tc-model__note[role=status]').first().innerText();
  assert.match(movedText, /别处改过/);
  check('an external revision change keeps the draft and says so', { text: movedText });

  await page.screenshot({ path: path.join(shots, 'model-dialog-1280.png') });

  assert.deepEqual(pageErrors, []);
  check('no uncaught page errors', { pageErrors });
} catch (cause) {
  // 失败时留下现场：DOM 片段与截图，便于判断是脚本问题还是产品问题。
  const dump = await page
    .evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      return dialog === null ? 'no open dialog' : dialog.outerHTML.slice(0, 4000);
    })
    .catch(() => 'page unavailable');
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  console.error(`\nFAILED: ${String(cause).split('\n')[0]}`);
  console.error(`open dialog:\n${dump}`);
  throw cause;
} finally {
  await context.close();
  await browser.close();
  for (const stream of streams) stream.end();
  await new Promise((resolve) => server.close(resolve));
}

/** 只清调用记录，不动模型状态。 */
async function resetFixtureCallsOnly() {
  await page.request.post(`${origin}/__fixture/calls-reset`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

console.log(`\n${checks.length} checks passed (fixture-backed DOM; not a live model connection)`);

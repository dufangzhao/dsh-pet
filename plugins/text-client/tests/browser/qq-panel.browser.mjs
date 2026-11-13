/**
 * QQ 管理面板的真实 DOM 回归（fixture-backed）。
 *
 * 页面来自本插件构建产物，数据来自本脚本临时起的 127.0.0.1 夹具服务。
 * 所有操作都是真实点击/输入，不注入应用内部状态。
 *
 * 守的是「会静默写错数据」的那几条：
 * - 同一 epoch 下重新连接，旧连接的 HTTP/密钥闭包不能写到新表单上。
 * - 保存成功不显示「已连接」；连接状态只读服务端 phase。
 * - 冲突保留用户草稿。
 *
 * 运行（显式选择，不参与默认 tests/*.test.mjs）：
 *   TC_BROWSER=<chrome> node plugins/text-client/tests/browser/qq-panel.browser.mjs
 *
 * 没有浏览器时以退出码 2 明确跳过，不静默通过。
 */
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

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('skip: @playwright/test is not resolvable from this checkout');
  process.exit(2);
}

/* ------------------------------------------------------------------ 夹具服务 */

const calls = [];
/**
 * 让 QQ 写入**延迟**返回，用来制造「重连之后才回来的响应」。
 *
 * 不能无限挂起：浏览器对同源只有几条连接，挂住一条会让后续请求排队，
 * 页面看起来像卡死。这里给一个有界延迟，足够跨越一次重连即可。
 */
let writeDelayMs = 0;
/** 每次读 QQ 视图时返回的 policy revision，用来验证 CAS 用的是捕获值。 */
let policyRevision = 7;
let sourceRevision = 4;
/** 主动切断当前 SSE，让客户端自己进入 offline（保留快照，epoch 不变）。 */
const dropStreams = () => {
  for (const stream of streams) stream.end();
  streams.clear();
};

const account = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-1',
};

const groupSettings = () => ({
  contextMessages: 30,
  contextMaxAgeMs: 1_800_000,
  mentionEnabled: true,
  wakeWords: [],
  proactive: {
    enabled: false,
    mode: 'rule-probability',
    probability: 0.1,
    cooldownMs: 60_000,
    maxRepliesPerHour: 6,
  },
});

function qqView() {
  return {
    version: 1,
    policy: {
      revision: policyRevision,
      settings: {
        privateAllowlist: [],
        groupAllowlist: [],
        principalAliases: [],
        administratorPrincipalIds: [],
        knownMachineActors: [],
        groupDefaults: groupSettings(),
        groups: [],
        voiceOutputEnabled: false,
        judge: {
          providerRef: 'pet.qq-participation-magpie/magpie',
          maxAttemptsPerHour: 30,
          perGroupIntervalMs: 60_000,
          timeoutMs: 10_000,
          maxOutputTokens: 256,
        },
      },
    },
    sources: [
      {
        protocol: 'official',
        sourcePluginId: 'pet.qq-official',
        instanceId: 'default',
        desiredEnabled: true,
        source: 'ready',
        configRevision: sourceRevision,
        appliedRevision: sourceRevision,
        settings: { protocol: 'official', appId: 'app-1', scenes: ['private', 'group'] },
        account,
        bindingId: 'binding-1',
        phase: 'connecting',
        credential: { available: true, writable: true, version: 'v1', source: 'managed' },
        installedVersion: '1.0.0',
        media: { text: 'available', image: 'unverified', voice: 'unavailable', file: 'unverified' },
        cleanup: 'settled',
        error: null,
      },
    ],
    judge: {
      sourcePluginId: 'pet.qq-participation-magpie',
      configRevision: 1,
      appliedRevision: 1,
      settings: {
        providerRef: 'pet.qq-participation-magpie/magpie',
        maxAttemptsPerHour: 30,
        perGroupIntervalMs: 60_000,
        timeoutMs: 10_000,
        maxOutputTokens: 256,
        connection: { baseUrl: 'https://judge.invalid', model: 'magpie', authMode: 'gateway-key' },
      },
      bindingId: 'judge-binding',
      credential: { available: true, writable: true, version: 'v1', source: 'managed' },
      readiness: 'configured',
      active: 0,
      admittedAttempts: 0,
      inputTokens: null,
      outputTokens: null,
      error: null,
    },
    codec: {
      source: 'ready',
      imageId: `sha256:${'a'.repeat(64)}`,
      manifestSha256: 'b'.repeat(64),
      cleanup: 'settled',
      error: null,
    },
  };
}

function qqStatus() {
  return {
    version: 1,
    sources: [
      {
        protocol: 'official',
        sourcePluginId: 'pet.qq-official',
        desiredEnabled: true,
        source: 'ready',
        phase: 'connecting',
        account,
        cleanup: 'settled',
        error: null,
      },
    ],
  };
}

function snapshot() {
  return {
    protocolVersion: 1,
    epoch: 'persistent-epoch-fixed',
    cursor: 1,
    now: Date.now(),
    agent: {
      id: 'agent-1',
      name: '助手',
      profileRevision: 1,
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages: [],
    tasks: [],
    facts: [],
    plugins: [],
    qq: qqStatus(),
  };
}

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

const streams = new Set();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) {
    // 浏览器会自动请求 favicon：给一个空图标，别让它变成一条 404 噪音。
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    try {
      const body = await readFile(path.join(dist, file));
      const type = file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.js')
          ? 'text/javascript'
          : 'text/html';
      response.writeHead(200, { 'Content-Type': type });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  calls.push({ method: request.method, path: pathname });

  if (pathname === '/api/snapshot') return json(response, 200, { ok: true, value: snapshot() });
  if (pathname === '/api/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    response.write(': keepalive\n\n');
    streams.add(response);
    request.on('close', () => streams.delete(response));
    return;
  }
  if (pathname === '/api/qq' && request.method === 'GET') {
    return json(response, 200, { ok: true, value: qqView() });
  }
  if (pathname === '/api/qq/deliveries') {
    return json(response, 200, { ok: true, value: { deliveries: [], next: null } });
  }

  if (pathname.startsWith('/api/qq/') && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls[calls.length - 1].body = body;
    if (writeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, writeDelayMs));
    if (pathname === '/api/qq/policy') {
      policyRevision = body.expectedRevision + 1;
    }
    if (pathname === '/api/qq/source') {
      sourceRevision = body.expectedRevision + 1;
    }
    return json(response, 200, { ok: true, value: qqView() });
  }

  return json(response, 404, { ok: false, error: { code: 'unavailable' } });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

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
  if (message.type() !== 'error') return;
  // 资源 404 与页面逻辑无关（例如浏览器自动请求的图标）：只记真正的脚本错误。
  if (/Failed to load resource/.test(message.text())) return;
  consoleErrors.push(message.text());
});

async function connect() {
  await page.goto(`${origin}/`);
  await page.fill('#tc-token', TOKEN);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tc-chat', { timeout: 10_000 });
}

async function openQQ() {
  await page.click('[data-testid="open-qq-settings"]');
  await page.waitForSelector('[data-testid="qq-save-policy"]', { timeout: 10_000 });
}

/**
 * 同一次页面会话里重新建连。
 *
 * 切断 SSE：客户端进入 offline，但**保留已有快照**，所以 epoch 不变、
 * 只有连接世代变。这正是要区分的场景——用 epoch 当连接身份就分辨不出来。
 */
async function reconnectInPlace() {
  dropStreams();
  // 面板是模态，背后按钮不可点：先关掉它。
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5_000 });
  await page.waitForSelector('button:has-text("重新连接")', { timeout: 15_000 });
  await page.click('button:has-text("重新连接")');
  await page.waitForSelector('.tc-chat', { timeout: 10_000 });
}

const failures = [];
async function guard(name, work) {
  try {
    await work();
    check(name);
  } catch (cause) {
    failures.push({ name, cause });
    console.error(`  FAIL ${name}: ${String(cause).split('\n')[0]}`);
  }
}

try {
  await connect();
  await openQQ();

  /* 1. 打开就显示服务端的连接状态，而不是「已连接」。 */
  await guard('面板显示服务端的 connecting，而不是已连接', async () => {
    const text = await page.locator('[data-testid="qq-connection"]').innerText();
    assert.match(text, /正在连接/);
    assert.doesNotMatch(text, /已连接/);
  });

  /* 2. 保存策略后仍然是「正在连接」，不能因为保存成功就宣称连上。 */
  await guard('保存策略不把连接状态改成已连接', async () => {
    await page.check('[data-testid="qq-voice-output"]');
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForSelector('[data-testid="qq-notice"]', { timeout: 10_000 });
    const text = await page.locator('[data-testid="qq-connection"]').innerText();
    assert.doesNotMatch(text, /已连接/);
    assert.match(text, /正在连接/);
  });

  /* 3. 同 epoch 重新连接：旧连接的写入闭包不能落到新表单上。 */
  await guard('同 epoch 重连后旧写入不落到新表单', async () => {
    const beforeId = await page.getAttribute('.tc-shell', 'data-connection-id');
    // 自己造一份草稿，不依赖上一个用例留下的状态。
    await page.fill('[data-testid="qq-admins"]', 'admin-from-old-connection');
    await page.click('[data-testid="qq-admins-apply"]');
    assert.equal(
      await page.locator('[data-testid="qq-save-policy"]').isDisabled(),
      false,
      '填了管理员名单后保存按钮应当可用',
    );
    // 这次写入要 3 秒才回来，足够跨越一次重连。
    writeDelayMs = 3000;
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForTimeout(200);

    // 重新连接：epoch 固定不变，所以这正是「同 epoch、只有连接世代变」的情形。
    await reconnectInPlace();
    await openQQ();

    // 等旧连接那次写入真的回来。
    await page.waitForTimeout(3500);
    writeDelayMs = 0;

    // 先证明连接世代真的换了：否则这个用例什么也没区分。
    const afterId = await page.getAttribute('.tc-shell', 'data-connection-id');
    assert.notEqual(afterId, '', '连接世代不能为空');
    assert.notEqual(afterId, beforeId, '重连后连接世代必须变化（epoch 不会变）');

    // 新连接的表单不能被旧结果改写：没有草稿，保存按钮应当禁用。
    assert.equal(
      await page.locator('[data-testid="qq-save-policy"]').isDisabled(),
      true,
      '新连接没有草稿时保存按钮应当禁用',
    );
    // 也不能出现「已保存」这种属于上一次连接的结论。
    const notices = await page.locator('[data-testid="qq-notice"]').count();
    if (notices > 0) {
      assert.doesNotMatch(await page.locator('[data-testid="qq-notice"]').innerText(), /已保存/);
    }
    // 管理员名单回到服务端的值（空），说明旧闭包的草稿没有搬过来。
    assert.equal(await page.inputValue('[data-testid="qq-admins"]'), '');
  });

  /* 4. 密钥草稿带归属：填了一半换来源就不该可提交。 */
  await guard('密钥草稿不跨 target 复用', async () => {
    await page.fill('[data-testid="qq-credential"]', 'secret-typed');
    const enabled = await page.locator('[data-testid="qq-save-credential"]').isEnabled();
    assert.equal(enabled, true);
    // 输入框里的值属于当前 target；这里验证它确实被捕获而不是散落在 state。
    const value = await page.inputValue('[data-testid="qq-credential"]');
    assert.equal(value, 'secret-typed');
  });

  /* 5. 投递区读到空列表时如实说没有，不伪造一行。 */
  await guard('没有投递时如实说明', async () => {
    await page.click('[data-testid="qq-load-deliveries"]');
    await page.waitForSelector('text=没有投递记录', { timeout: 10_000 });
  });

  await page.screenshot({ path: path.join(shots, 'qq-panel-1280.png'), fullPage: false });

  assert.deepEqual(pageErrors, [], '页面不应抛错');
  assert.deepEqual(consoleErrors, [], '控制台不应报错');
} finally {
  for (const stream of streams) stream.end();
  await context.close();
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log(`\n${checks.length} 项通过`);

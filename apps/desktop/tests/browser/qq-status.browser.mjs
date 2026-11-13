/**
 * 桌面 QQ 只读卡的真实 DOM 回归。
 *
 * 加载真实的 console 构建产物，注入一个只读的 `window.petCompanion` 桩，
 * 然后真实点击「打开 Web 管理」，检查它到底传了什么。
 *
 * 这不是产品验收：没有真实服务、没有真实 QQ。它验证的是渲染层自己的契约——
 * 传的是渲染时捕获的 connectionId，且换连接之后旧结果不落到新界面。
 *
 * 运行（显式选择）：
 *   TC_BROWSER=<chrome> node apps/desktop/tests/browser/qq-status.browser.mjs
 *
 * 没有浏览器时以退出码 2 明确跳过，不静默通过。
 */
/* global window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dist = path.join(root, 'apps/desktop/dist/renderer/console');

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
  console.error('skip: @playwright/test is not resolvable');
  process.exit(2);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;
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
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

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

const failures = [];
const check = (name) => console.log(`  ok  ${name}`);
async function guard(name, work) {
  try {
    await work();
    check(name);
  } catch (cause) {
    failures.push({ name, cause });
    console.error(`  FAIL ${name}: ${String(cause).split('\n')[0]}`);
  }
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (cause) => pageErrors.push(String(cause)));

/**
 * 注入桩桥：记录每次调用的参数，并按脚本决定 openWeb 什么时候返回。
 *
 * 快照里的 qq 状态由 `qqSources()` 给，测试中途可以改，用来模拟「服务端状态变了」。
 */
await page.addInitScript(() => {
  const state = {
    calls: [],
    connectionId: 'conn-A',
    qqSources: [
      {
        protocol: 'official',
        sourcePluginId: 'pet.qq-official',
        desiredEnabled: true,
        source: 'ready',
        phase: 'connecting',
        account: {
          protocol: 'official',
          sourcePluginId: 'pet.qq-official',
          instanceId: 'default',
          accountId: 'app-1',
        },
        cleanup: 'settled',
        error: null,
      },
    ],
    holdOpen: 0,
    releaseOpen: null,
    // 真实宿主每次状态变化都会推进 revision；桩也必须推进，
    // 否则渲染层的 adopt 栅栏（只接受更新的 revision）会正确地把它们拒掉。
    revision: 1,
  };
  window.__qqTest = state;

  const snapshot = () => ({
    protocolVersion: 1,
    epoch: 'persistent-epoch',
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
    ...(state.qqSources === undefined ? {} : { qq: { version: 1, sources: state.qqSources } }),
  });

  const listeners = new Set();
  const push = () => {
    for (const listener of listeners) listener();
  };

  window.petCompanion = {
    version: 1,
    getState: async () => ({
      ok: true,
      value: {
        version: 1,
        revision: state.revision,
        source: 'ready',
        baseUrl: 'http://127.0.0.1:4120',
        configRevision: 1,
        connectionId: state.connectionId,
        phase: 'live',
        confirmedAt: Date.now(),
        snapshot: snapshot(),
        pending: [],
        error: null,
      },
    }),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openWeb: async (input) => {
      state.calls.push({ kind: 'openWeb', input });
      if (state.holdOpen > 0) {
        await new Promise((resolve) => {
          state.releaseOpen = resolve;
        });
      }
      return { ok: true, value: null };
    },
  };
  // 测试用它模拟「服务端换了连接」。
  window.__qqPush = push;
  window.__qqSetConnection = (id) => {
    state.connectionId = id;
    state.revision += 1;
    push();
  };
});

await page.goto(`${origin}/`);
await page.waitForSelector('[data-testid="qq-open-web"]', { timeout: 15_000 });

try {
  await guard('卡片显示服务端的 connecting，不是已连接', async () => {
    const text = await page.locator('[data-testid="qq-source-official"]').innerText();
    assert.match(text, /正在连接/);
    assert.doesNotMatch(text, /已连接/);
    assert.match(text, /app-1/);
  });

  await guard('点击传的是渲染时捕获的 connectionId', async () => {
    await page.click('[data-testid="qq-open-web"]');
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => window.__qqTest.calls);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, { connectionId: 'conn-A' });
  });

  await guard('换连接后点击传新的 connectionId', async () => {
    await page.evaluate(() => window.__qqSetConnection('conn-B'));
    await page.waitForTimeout(800);
    await page.click('[data-testid="qq-open-web"]');
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => window.__qqTest.calls);
    assert.equal(calls.at(-1).input.connectionId, 'conn-B');
  });

  await guard('等待中的点击不阻塞按钮再次可用（busy 会复位）', async () => {
    await page.evaluate(() => {
      window.__qqTest.holdOpen = 1;
    });
    await page.click('[data-testid="qq-open-web"]');
    // 请求还挂着：按钮进入 busy（aria-busy + disabled）。
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('[data-testid="qq-open-web"]').isDisabled(),
      true,
      '在途时按钮应当禁用',
    );
    await page.evaluate(() => {
      window.__qqTest.holdOpen = 0;
      window.__qqTest.releaseOpen?.();
    });
    await page.waitForSelector('[data-testid="qq-open-web"]:not([disabled])', { timeout: 5_000 });
  });

  await guard('协议为空时如实说，不显示空列表', async () => {
    await page.evaluate(() => {
      window.__qqTest.qqSources = [];
      window.__qqTest.revision += 1;
      window.__qqPush();
    });
    await page.waitForSelector('[data-testid="qq-empty"]', { timeout: 5_000 });
    const text = await page.locator('[data-testid="qq-empty"]').innerText();
    assert.match(text, /没有启用任何 QQ 协议/);
    // 空列表时不应还留着上一次的来源行。
    assert.equal(await page.locator('[data-testid="qq-source-official"]').count(), 0);
  });

  await guard('没有连接时打开按钮禁用', async () => {
    await page.evaluate(() => {
      window.__qqTest.connectionId = null;
      window.__qqTest.revision += 1;
      window.__qqPush();
    });
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator('[data-testid="qq-open-web"]').isDisabled(),
      true,
      '没有 connectionId 时按钮必须禁用',
    );
    // 恢复连接，后面的用例还要用。
    await page.evaluate(() => {
      window.__qqTest.connectionId = 'conn-A';
      window.__qqTest.revision += 1;
      window.__qqPush();
    });
    await page.waitForTimeout(600);
  });

  await guard('服务没有 qq 字段时整张卡不出现', async () => {
    await page.evaluate(() => {
      window.__qqTest.qqSources = undefined;
      window.__qqTest.revision += 1;
      window.__qqPush();
    });
    await page.waitForTimeout(600);
    // 整张卡都不该存在：不是「隐藏按钮」，而是连外壳都不渲染。
    assert.equal(await page.locator('#qq-card').count(), 0, '没有 qq 字段时不应渲染 QQ 卡片');
    assert.equal(await page.locator('[data-testid="qq-sources"]').count(), 0);
    assert.equal(await page.locator('[data-testid="qq-empty"]').count(), 0);
  });

  assert.deepEqual(pageErrors, [], '页面不应抛错');
} finally {
  await context.close();
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log(`\n${failures.length === 0 ? '全部通过' : ''}`);

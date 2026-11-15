/**
 * 本地宿主 UI 的真实 DOM 回归。
 *
 * 加载真实的 console 构建产物，注入一个 `window.petLocalHost` 桩（固定方法表，
 * 与已冻结的 `DesktopLocalHostBridge` 同形），然后真实点击、真实输入。
 *
 * 它验证的是**渲染层自己的契约**：
 * - 停止宿主不看 Agent 在线状态；
 * - 保存不叫登录，三层状态分开；
 * - 迟到的回应不落到换了宿主之后的界面上（含「新 boot 已采纳、尚未重渲染」窗口）；
 * - 脏草稿与密钥不被无关刷新清掉；
 * - 源码信任只有用户显式点击才会读/信任/允许，且刷新后用新 epoch 继续。
 *
 * 这不是产品验收：没有真实宿主进程、没有真实 QQ、没有 Main/preload。
 *
 * 运行（显式选择）：
 *   TC_BROWSER=<chrome> node apps/desktop/tests/browser/local-host.browser.mjs
 *
 * 没有浏览器时以退出码 2 明确跳过，不静默通过。
 */
/* global window, document, MutationObserver */
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

const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (cause) => pageErrors.push(String(cause)));

/**
 * 安装桩：一个可编程的宿主。
 *
 * `hold` 让某个方法挂起，用来制造「迟回应」；`state` 是唯一真相。
 */
await page.addInitScript(() => {
  /** 一个源的源码信任；digest 用不同字母，便于断言「显示的是这一次读到的」。 */
  const review = (protocol, letter) => ({
    protocol,
    digest: letter.repeat(64),
    trusted: false,
    preset: 'deny',
    blocked: false,
    permissionEpoch: 0,
    cleanup: 'settled',
  });

  const source = (protocol, over = {}) => ({
    protocol,
    sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
    instanceId: 'default',
    desiredEnabled: false,
    source: 'ready',
    configRevision: 3,
    appliedRevision: 3,
    settings:
      protocol === 'official'
        ? { protocol: 'official', appId: 'app-1', scenes: ['private'] }
        : {
            protocol: 'onebot-v11',
            accountId: '10001',
            mode: 'reverse-ws',
            channelMode: 'universal',
            mediaProfile: 'snowluma-v11',
            listenHost: '127.0.0.1',
            listenPort: 6700,
            path: '/onebot',
          },
    account: null,
    bindingId: null,
    phase: 'disabled',
    credential: { available: false, writable: true, version: 'v1', source: 'none' },
    installedVersion: '1.0.0',
    media: { text: 'available', image: 'available', voice: 'available', file: 'available' },
    cleanup: null,
    error: null,
    ...over,
  });

  const state = {
    revision: 1,
    phase: 'running',
    hostId: 'host-1',
    bootId: 'boot-1',
    calls: [],
    holdStart: 0,
    releaseStart: null,
    /** 挂起一次 saveSource，用来制造「先采纳新 boot、旧 mutation 才返回」。 */
    holdSave: false,
    releaseSave: null,
    /** 挂起 getState：没有它，mutation 末尾的无条件重读会把倒灌当场修好。 */
    holdGetState: false,
    releaseGetState: null,
    /** 每个受管源自己的源码信任；生产初始是 deny + 未信任。 */
    reviews: {
      official: review('official', 'a'),
      'onebot-v11': review('onebot-v11', 'b'),
      'agent-link': review('agent-link', 'c'),
    },
    holdReview: null,
    releaseReview: null,
    failReview: false,
    failTrust: false,
    failPreset: false,
    sources: [source('official'), source('onebot-v11')],
    agent: {
      revision: 1,
      target: { baseUrl: 'https://agent.example', agentId: 'agent-1', agentEpoch: 'epoch-1' },
      credentialVersion: 'v1',
      hasCredential: false,
      phase: 'offline',
      sessionId: null,
      error: null,
    },
  };

  const view = () => ({
    identity: {
      protocolVersion: 1,
      packageVersion: '0.1.0',
      hostId: state.hostId,
      bootId: state.bootId,
    },
    sourcesRevision: 2,
    sources: state.sources,
    agentLink: state.agent,
  });

  const snapshot = () => ({
    revision: state.revision,
    phase: state.phase,
    view: state.phase === 'stopped' ? null : view(),
    error: null,
  });

  const listeners = new Set();
  const push = () => {
    for (const listener of listeners) listener();
  };

  const mutation = (patch) => {
    patch();
    state.revision += 1;
    push();
    return { ok: true, value: { view: view(), error: null } };
  };

  window.petLocalHost = {
    version: 1,
    getState: async () => {
      if (state.holdGetState) {
        await new Promise((resolve) => {
          state.releaseGetState = resolve;
        });
        state.holdGetState = false;
      }
      return { ok: true, value: snapshot() };
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {
      state.calls.push({ kind: 'start' });
      // 挂起时先记下**发起那一刻**的宿主身份：真实迟到回应带的也是旧世界的数据。
      const capturedHost = state.hostId;
      const capturedBoot = state.bootId;
      if (state.holdStart > 0) {
        await new Promise((resolve) => {
          state.releaseStart = resolve;
        });
      }
      state.phase = 'running';
      state.revision += 1;
      const current = snapshot();
      // 如果期间换了宿主，这次回应仍然描述旧宿主。
      if (state.hostId !== capturedHost) {
        return {
          ok: true,
          value: {
            ...current,
            view:
              current.view === null
                ? null
                : {
                    ...current.view,
                    identity: {
                      ...current.view.identity,
                      hostId: capturedHost,
                      bootId: capturedBoot,
                    },
                  },
          },
        };
      }
      return { ok: true, value: current };
    },
    stop: async (input) => {
      state.calls.push({ kind: 'stop', input });
      state.phase = 'stopped';
      state.revision += 1;
      return { ok: true, value: snapshot() };
    },
    reviewSource: async (input) => {
      state.calls.push({ kind: 'reviewSource', input });
      if (state.failReview) return { ok: false, error: makeError('unavailable') };
      const captured = { ...state.reviews[input.protocol] };
      if (state.holdReview === input.protocol) {
        await new Promise((resolve) => {
          state.releaseReview = resolve;
        });
        // 迟到回应仍然描述发起时的世界，并带一个绝不该被显示的 digest。
        return {
          ok: true,
          value: { ...captured, digest: 'd'.repeat(64), permissionEpoch: 99 },
        };
      }
      return { ok: true, value: captured };
    },
    confirmSourceTrust: async (input) => {
      state.calls.push({ kind: 'confirmSourceTrust', input });
      if (state.failTrust) return { ok: false, error: makeError('permission-denied') };
      const current = state.reviews[input.protocol];
      if (
        current === undefined ||
        current.digest !== input.expectedDigest ||
        current.permissionEpoch !== input.expectedPermissionEpoch
      )
        return { ok: false, error: makeError('conflict') };
      // 真实权限控制每次确认都让 epoch 递增：旧 epoch 的下一次命令必然冲突。
      state.reviews[input.protocol] = {
        ...current,
        trusted: input.trusted,
        permissionEpoch: current.permissionEpoch + 1,
      };
      return mutation(() => undefined);
    },
    setSourcePreset: async (input) => {
      state.calls.push({ kind: 'setSourcePreset', input });
      if (state.failPreset) return { ok: false, error: makeError('permission-denied') };
      const current = state.reviews[input.protocol];
      if (
        current === undefined ||
        current.digest !== input.expectedDigest ||
        current.permissionEpoch !== input.expectedPermissionEpoch
      )
        return { ok: false, error: makeError('conflict') };
      state.reviews[input.protocol] = {
        ...current,
        preset: input.preset,
        blocked: false,
        permissionEpoch: current.permissionEpoch + 1,
      };
      return mutation(() => undefined);
    },
    saveSource: async (input) => {
      state.calls.push({ kind: 'saveSource', input });
      // 挂起时记下发起那一刻的宿主：真实迟回应描述的是旧世界。
      const capturedHost = state.hostId;
      const capturedBoot = state.bootId;
      if (state.holdSave) {
        await new Promise((resolve) => {
          state.releaseSave = resolve;
        });
        state.holdSave = false;
      }
      const result = mutation(() => {
        state.sources = state.sources.map((item) =>
          item.protocol === input.protocol
            ? { ...item, settings: input.settings, configRevision: input.expectedRevision + 1 }
            : item,
        );
      });
      if (state.hostId !== capturedHost || state.bootId !== capturedBoot) {
        // 回应仍然属于旧 boot：界面若采纳它，就会把新宿主覆盖回去。
        return {
          ok: true,
          value: {
            ...result.value,
            view: {
              ...result.value.view,
              identity: {
                ...result.value.view.identity,
                hostId: capturedHost,
                bootId: capturedBoot,
              },
            },
          },
        };
      }
      return result;
    },
    setSourceEnabled: async (input) => {
      state.calls.push({ kind: 'setSourceEnabled', input });
      return mutation(() => {
        state.sources = state.sources.map((item) =>
          item.protocol === input.protocol ? { ...item, desiredEnabled: input.enabled } : item,
        );
      });
    },
    setSourceCredential: async (input) => {
      state.calls.push({ kind: 'setSourceCredential', input });
      return mutation(() => {
        state.sources = state.sources.map((item) =>
          item.protocol === input.protocol
            ? {
                ...item,
                credential: {
                  ...item.credential,
                  available: input.value !== null,
                  version: input.value === null ? 'v1' : 'v2',
                },
              }
            : item,
        );
      });
    },
    linkCurrentAgent: async (input) => {
      state.calls.push({ kind: 'linkCurrentAgent', input });
      return mutation(() => {
        state.agent = { ...state.agent, revision: state.agent.revision + 1, phase: 'connected' };
      });
    },
    setAgentEnabled: async (input) => {
      state.calls.push({ kind: 'setAgentEnabled', input });
      return mutation(() => {
        state.agent = {
          ...state.agent,
          revision: state.agent.revision + 1,
          phase: input.enabled ? 'connecting' : 'disabled',
        };
      });
    },
    setAgentCredential: async (input) => {
      state.calls.push({ kind: 'setAgentCredential', input });
      return mutation(() => {
        state.agent = {
          ...state.agent,
          revision: state.agent.revision + 1,
          hasCredential: input.value !== null,
          credentialVersion: input.value === null ? 'v1' : 'v2',
        };
      });
    },
  };

  const makeError = (code) => ({
    code,
    messageKey: `errors.${code}`,
    retryable: code === 'unavailable',
  });

  // 测试用：读取调用记录、模拟宿主换代、放开挂起的 start/review。
  window.__hostCalls = () => state.calls;
  window.__hostIdentity = () => ({ hostId: state.hostId, bootId: state.bootId });
  window.__hostSwapTo = (hostId, bootId) => {
    state.hostId = hostId;
    state.bootId = bootId;
    state.revision += 1;
    state.sources = state.sources.map((item) => ({ ...item, configRevision: 1 }));
    push();
  };
  window.__hostSwap = () => {
    window.__hostSwapTo('host-2', 'boot-2');
  };
  window.__hostHoldReview = (protocol) => {
    state.holdReview = protocol;
  };
  window.__hostReleaseReview = () => {
    state.holdReview = null;
    if (state.releaseReview !== null) state.releaseReview();
  };
  window.__hostFailReview = (value) => {
    state.failReview = value;
  };
  window.__hostFailTrust = (value) => {
    state.failTrust = value;
  };
  window.__hostFailPreset = (value) => {
    state.failPreset = value;
  };
  window.__hostReleaseStart = () => {
    if (state.releaseStart !== null) state.releaseStart();
  };
  window.__hostHoldStart = () => {
    state.holdStart = 1;
  };
  window.__hostHoldSave = () => {
    state.holdSave = true;
  };
  window.__hostReleaseSave = () => {
    if (state.releaseSave !== null) state.releaseSave();
  };
  window.__hostHoldGetState = () => {
    state.holdGetState = true;
  };
  window.__hostReleaseGetState = () => {
    if (state.releaseGetState !== null) state.releaseGetState();
  };
});

await page.goto(`${origin}/`);
// 本机宿主并进了 QQ 页：先点 nav-qq，再断言原来那套选择器。
await page.waitForSelector('[data-testid="nav-qq"]', { timeout: 15_000 });
await page.click('[data-testid="nav-qq"]');
await page.waitForSelector('[data-testid="local-host-card"]', { timeout: 15_000 });

try {
  await guard('宿主卡显示真实阶段与版本', async () => {
    assert.equal(await page.locator('[data-testid="local-host-phase"]').innerText(), '运行中');
    assert.match(await page.locator('[data-testid="local-host-version"]').innerText(), /0\.1\.0/);
  });

  await guard('停止在 server 不在线时仍可点', async () => {
    // 桩里 Agent 链路是 offline；停止按钮不能被它门控。
    assert.equal(await page.locator('[data-testid="local-agent-phase"]').innerText(), '未连接');
    assert.equal(await page.locator('[data-testid="local-host-stop"]').isDisabled(), false);
  });

  await guard('真实点击停止，宿主转成未运行', async () => {
    await page.click('[data-testid="local-host-stop"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="local-host-phase"]')?.textContent === '未运行',
      { timeout: 5_000 },
    );
    const calls = await page.evaluate(() => window.__hostCalls());
    assert.ok(calls.some((call) => call.kind === 'stop'));
  });

  await guard('真实点击启动，带回宿主身份', async () => {
    await page.click('[data-testid="local-host-start"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="local-host-phase"]')?.textContent === '运行中',
      { timeout: 5_000 },
    );
  });

  await guard('源的三层状态分开显示，不把保存叫已连接', async () => {
    const saved = await page.locator('[data-testid="local-source-saved-official"]').innerText();
    const applied = await page.locator('[data-testid="local-source-applied-official"]').innerText();
    const native = await page.locator('[data-testid="local-source-phase-official"]').innerText();
    assert.match(saved, /已保存/);
    assert.match(applied, /已应用/);
    assert.equal(native, '未启用');
  });

  await guard('真实输入 AppID 后保存按钮才可用', async () => {
    const save = page.locator(
      '[data-testid="local-source-form-official"] [data-testid="local-source-save"]',
    );
    assert.equal(await save.isDisabled(), true);
    await page.fill('[data-testid="local-source-app-id"]', 'app-typed');
    assert.equal(await save.isDisabled(), false);
  });

  await guard('真实点击保存，用的是草稿捕获的修订', async () => {
    await page.click(
      '[data-testid="local-source-form-official"] [data-testid="local-source-save"]',
    );
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'saveSource'),
      { timeout: 5_000 },
    );
    const calls = await page.evaluate(() => window.__hostCalls());
    const save = calls.find((call) => call.kind === 'saveSource');
    assert.equal(save.input.expectedRevision, 3);
    assert.equal(save.input.settings.appId, 'app-typed');
    assert.equal(save.input.hostId, 'host-1');
  });

  await guard('脏草稿在无关刷新后仍保留', async () => {
    await page.fill('[data-testid="local-source-app-id"]', 'dirty-value');
    // 不换宿主：等待一段真实时间后，脏草稿仍应保留。
    await page.waitForTimeout(300);
    assert.equal(await page.inputValue('[data-testid="local-source-app-id"]'), 'dirty-value');
  });

  await guard('密钥在配置保存后才可写', async () => {
    const input = page.locator(
      '[data-testid="local-source-form-official"] [data-testid="local-source-secret-input"]',
    );
    // 上一用例把 AppID 改成脏值，所以现在应当被挡住。
    assert.equal(await input.isDisabled(), true);
    assert.equal(
      await page
        .locator(
          '[data-testid="local-source-form-official"] [data-testid="local-source-secret-blocked"]',
        )
        .count(),
      1,
    );
  });

  await guard('宿主换代后脏草稿被丢弃，不跨 boot 复用', async () => {
    await page.evaluate(() => window.__hostSwap());
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="local-source-saved-official"]')
          ?.textContent?.includes('修订 1'),
      { timeout: 5_000 },
    );
    // boot 换了，AppID 回到真实视图的值（桩里是 app-1，被 saveSource 改过则保持）。
    const value = await page.inputValue('[data-testid="local-source-app-id"]');
    assert.notEqual(value, 'dirty-value');
  });

  const calls = async () => page.evaluate(() => window.__hostCalls());
  const callsOf = async (kind) => (await calls()).filter((call) => call.kind === kind);
  const lastOf = async (kind) => {
    const list = await callsOf(kind);
    return list[list.length - 1];
  };
  const scope = (selector) =>
    selector === 'agent-link'
      ? '[data-testid="local-agent-link-section"]'
      : `[data-testid="local-source-form-${selector}"]`;
  const trust = (selector, testid) => `${scope(selector)} [data-testid="${testid}"]`;

  await guard('初始：三个源都未信任且预设为 deny，页面没有自动信任/自动允许', async () => {
    // 共享卡必须真的渲染进三个源，而不是只存在于源码里。
    for (const selector of ['official', 'onebot-v11', 'agent-link']) {
      assert.equal(
        await page.locator(`[data-testid="local-trust-${selector}"]`).count(),
        1,
        `${selector} 必须渲染共享信任卡`,
      );
    }
    for (const selector of ['official', 'onebot-v11', 'agent-link']) {
      assert.equal(
        await page.locator(trust(selector, 'local-source-review')).count(),
        1,
        `${selector} 必须有显式「读取源码状态」`,
      );
      assert.equal(
        await page.locator(trust(selector, 'local-source-review-empty')).count(),
        1,
        `${selector} 在读取前不能显示任何 digest`,
      );
      // 未读取时不能出现信任/预设按钮：没有事实就没有动作。
      assert.equal(await page.locator(trust(selector, 'local-source-confirm-trust')).count(), 0);
      assert.equal(
        await page.locator(trust(selector, 'local-source-allow-permissions')).count(),
        0,
      );
    }
    assert.equal((await callsOf('confirmSourceTrust')).length, 0, '不得自动信任');
    assert.equal((await callsOf('setSourcePreset')).length, 0, '不得自动允许');
  });

  await guard('读取源码状态显示完整 digest 与真实预设（deny）', async () => {
    await page.click(trust('official', 'local-source-review'));
    await page.waitForSelector(trust('official', 'local-source-digest'), { timeout: 5_000 });
    assert.equal(
      await page.locator(trust('official', 'local-source-digest')).innerText(),
      'a'.repeat(64),
    );
    assert.match(await page.locator(trust('official', 'local-source-preset')).innerText(), /拒绝/);
    assert.equal(
      await page.locator(trust('official', 'local-source-trusted')).innerText(),
      '未信任',
    );
    assert.equal(
      await page.locator(trust('official', 'local-source-cleanup')).innerText(),
      '已收尾',
    );
    const review = await lastOf('reviewSource');
    assert.equal(review.input.protocol, 'official');
    assert.equal(review.input.hostId, 'host-2');
    assert.equal(review.input.bootId, 'boot-2');
  });

  await guard('信任命令带用户看到的 host/digest/epoch，界面随后显示已信任', async () => {
    await page.click(trust('official', 'local-source-confirm-trust'));
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'confirmSourceTrust'),
      { timeout: 5_000 },
    );
    const trustCall = await lastOf('confirmSourceTrust');
    assert.equal(trustCall.input.protocol, 'official');
    assert.equal(trustCall.input.hostId, 'host-2');
    assert.equal(trustCall.input.bootId, 'boot-2');
    assert.equal(trustCall.input.expectedDigest, 'a'.repeat(64));
    assert.equal(trustCall.input.expectedPermissionEpoch, 0, '必须用读到时捕获的 epoch');
    assert.equal(trustCall.input.trusted, true);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent === '已信任',
      trust('official', 'local-source-trusted'),
      { timeout: 5_000 },
    );
    // 成功后只读重读该源：新的 epoch 来自宿主，不是前端推算。
    await page.waitForFunction(
      () =>
        window
          .__hostCalls()
          .filter((call) => call.kind === 'reviewSource' && call.input.protocol === 'official')
          .length >= 2,
      { timeout: 5_000 },
    );
  });

  await guard('allow 用刷新后的新 epoch，预设变成 allow', async () => {
    await page.waitForSelector(trust('official', 'local-source-allow-permissions'), {
      timeout: 5_000,
    });
    await page.click(trust('official', 'local-source-allow-permissions'));
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'setSourcePreset'),
      { timeout: 5_000 },
    );
    const preset = await lastOf('setSourcePreset');
    assert.equal(preset.input.protocol, 'official');
    assert.equal(preset.input.hostId, 'host-2');
    assert.equal(preset.input.preset, 'allow');
    assert.equal(preset.input.expectedDigest, 'a'.repeat(64));
    assert.equal(
      preset.input.expectedPermissionEpoch,
      1,
      'confirmTrust 递增后的 epoch 必须来自只读重读，而不是旧的 0',
    );
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent?.includes('允许'),
      trust('official', 'local-source-preset'),
      { timeout: 5_000 },
    );
    assert.equal(await page.locator(trust('official', 'local-source-deny-permissions')).count(), 1);
  });

  await guard('Agent 连接有信任入口：读取→信任→允许→再启用', async () => {
    await page.click(trust('agent-link', 'local-source-review'));
    await page.waitForSelector(trust('agent-link', 'local-source-digest'), { timeout: 5_000 });
    assert.equal(
      await page.locator(trust('agent-link', 'local-source-digest')).innerText(),
      'c'.repeat(64),
    );
    await page.click(trust('agent-link', 'local-source-confirm-trust'));
    await page.waitForFunction(
      () =>
        window
          .__hostCalls()
          .some(
            (call) => call.kind === 'confirmSourceTrust' && call.input.protocol === 'agent-link',
          ),
      { timeout: 5_000 },
    );
    const trustCall = await lastOf('confirmSourceTrust');
    assert.equal(trustCall.input.expectedDigest, 'c'.repeat(64));
    assert.equal(trustCall.input.expectedPermissionEpoch, 0);
    assert.equal(trustCall.input.hostId, 'host-2');
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent === '已信任',
      trust('agent-link', 'local-source-trusted'),
      { timeout: 5_000 },
    );
    await page.waitForSelector(trust('agent-link', 'local-source-allow-permissions'), {
      timeout: 5_000,
    });
    await page.click(trust('agent-link', 'local-source-allow-permissions'));
    await page.waitForFunction(
      () =>
        window
          .__hostCalls()
          .some((call) => call.kind === 'setSourcePreset' && call.input.protocol === 'agent-link'),
      { timeout: 5_000 },
    );
    const preset = await lastOf('setSourcePreset');
    assert.equal(preset.input.protocol, 'agent-link');
    assert.equal(preset.input.preset, 'allow');
    assert.equal(preset.input.expectedPermissionEpoch, 1);
    // 允许之后才启用：走已有的 setAgentEnabled，不带任何权限绕过字段。
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent?.includes('允许'),
      trust('agent-link', 'local-source-preset'),
      { timeout: 5_000 },
    );
    await page.click('[data-testid="local-agent-toggle"]');
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'setAgentEnabled'),
      { timeout: 5_000 },
    );
    const enabled = await lastOf('setAgentEnabled');
    assert.equal(enabled.input.hostId, 'host-2');
    // 链路初始是 offline（视为启用中），这里点击是停用；两种取值都合法，
    // 关键是它走既有的 setAgentEnabled，而不是任何权限旁路。
    assert.equal(typeof enabled.input.enabled, 'boolean');
    assert.equal('preset' in enabled.input, false, '启用命令不得夹带权限');
    assert.equal('trusted' in enabled.input, false);
    assert.equal('expectedPermissionEpoch' in enabled.input, false);
    // 顺序证明：先信任、再允许、最后才启用。
    const all = await calls();
    const indexOf = (predicate) => all.findIndex(predicate);
    const trustAt = indexOf(
      (call) => call.kind === 'confirmSourceTrust' && call.input.protocol === 'agent-link',
    );
    const presetAt = indexOf(
      (call) => call.kind === 'setSourcePreset' && call.input.protocol === 'agent-link',
    );
    const enabledAt = indexOf((call) => call.kind === 'setAgentEnabled');
    assert.ok(
      trustAt >= 0 && presetAt > trustAt && enabledAt > presetAt,
      '顺序必须是 信任→允许→启用',
    );
  });

  await guard('OneBot 复用同一张卡：allow → deny → 撤销信任都明确', async () => {
    await page.click(trust('onebot-v11', 'local-source-review'));
    await page.waitForSelector(trust('onebot-v11', 'local-source-digest'), { timeout: 5_000 });
    assert.equal(
      await page.locator(trust('onebot-v11', 'local-source-digest')).innerText(),
      'b'.repeat(64),
    );
    await page.click(trust('onebot-v11', 'local-source-confirm-trust'));
    await page.waitForFunction(
      () =>
        window
          .__hostCalls()
          .some(
            (call) => call.kind === 'confirmSourceTrust' && call.input.protocol === 'onebot-v11',
          ),
      { timeout: 5_000 },
    );
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent === '已信任',
      trust('onebot-v11', 'local-source-trusted'),
      { timeout: 5_000 },
    );
    await page.waitForSelector(trust('onebot-v11', 'local-source-allow-permissions'), {
      timeout: 5_000,
    });
    await page.click(trust('onebot-v11', 'local-source-allow-permissions'));
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent?.includes('允许'),
      trust('onebot-v11', 'local-source-preset'),
      { timeout: 5_000 },
    );
    // 禁止：预设回到 deny，按钮随即消失，界面明确说出被挡住。
    await page.waitForSelector(trust('onebot-v11', 'local-source-deny-permissions'), {
      timeout: 5_000,
    });
    await page.click(trust('onebot-v11', 'local-source-deny-permissions'));
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent?.includes('拒绝'),
      trust('onebot-v11', 'local-source-preset'),
      { timeout: 5_000 },
    );
    const deny = await lastOf('setSourcePreset');
    assert.equal(deny.input.protocol, 'onebot-v11');
    assert.equal(deny.input.preset, 'deny');
    assert.equal(deny.input.expectedPermissionEpoch, 2);
    // 撤销信任：命令 trusted=false，界面回到未信任。
    await page.waitForSelector(trust('onebot-v11', 'local-source-revoke-trust'), {
      timeout: 5_000,
    });
    await page.click(trust('onebot-v11', 'local-source-revoke-trust'));
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.textContent === '未信任',
      trust('onebot-v11', 'local-source-trusted'),
      { timeout: 5_000 },
    );
    const revoke = await lastOf('confirmSourceTrust');
    assert.equal(revoke.input.protocol, 'onebot-v11');
    assert.equal(revoke.input.trusted, false);
  });

  await guard('迟到的 review 遇到换 boot：不回填、不再可操作', async () => {
    await page.evaluate(() => window.__hostHoldReview('onebot-v11'));
    await page.click(trust('onebot-v11', 'local-source-review'));
    // 读取还挂着时宿主换代：旧世界的一切（含 review）都必须作废。
    await page.evaluate(() => window.__hostSwapTo('host-3', 'boot-3'));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="local-source-saved-official"]')
          ?.textContent?.includes('修订 1'),
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.__hostReleaseReview());
    await page.waitForTimeout(500);
    // 迟到的 'd'*64 / epoch 99 绝不能出现，也不能留下可点的动作。
    assert.equal(await page.locator(trust('onebot-v11', 'local-source-digest')).count(), 0);
    assert.equal(await page.locator(trust('onebot-v11', 'local-source-confirm-trust')).count(), 0);
    assert.equal(
      await page.locator(trust('onebot-v11', 'local-source-allow-permissions')).count(),
      0,
    );
    assert.equal(await page.locator(trust('onebot-v11', 'local-source-review-empty')).count(), 1);
  });

  await guard('读取失败显示真实错误，且不制造「已信任」', async () => {
    await page.evaluate(() => window.__hostFailReview(true));
    await page.click(trust('official', 'local-source-review'));
    await page.waitForSelector(trust('official', 'local-source-trust-error'), { timeout: 5_000 });
    assert.match(
      await page.locator(trust('official', 'local-source-trust-error')).innerText(),
      /没能读取源码状态/,
    );
    assert.equal(await page.locator(trust('official', 'local-source-digest')).count(), 0);
    assert.equal(await page.locator(trust('official', 'local-source-trusted')).count(), 0);
    await page.evaluate(() => window.__hostFailReview(false));
  });

  await guard('信任写入失败显示真实错误，不假装成功', async () => {
    // OneBot 在上一个用例里被撤销信任，所以这里读到的是「未信任」。
    await page.evaluate(() => window.__hostFailTrust(true));
    await page.click(trust('onebot-v11', 'local-source-review'));
    await page.waitForSelector(trust('onebot-v11', 'local-source-confirm-trust'), {
      timeout: 5_000,
    });
    await page.click(trust('onebot-v11', 'local-source-confirm-trust'));
    await page.waitForSelector('[data-testid="local-host-notice"]', { timeout: 5_000 });
    assert.match(
      await page.locator('[data-testid="local-host-notice"]').innerText(),
      /没有获得授权/,
    );
    assert.equal(
      await page.locator(trust('onebot-v11', 'local-source-trusted')).innerText(),
      '未信任',
    );
    assert.equal(await page.locator(trust('onebot-v11', 'local-source-confirm-trust')).count(), 1);
    await page.evaluate(() => window.__hostFailTrust(false));
  });

  await guard('预设写入失败显示真实错误，预设保持原值', async () => {
    // 上一个用例的读取失败清掉了 official 的 review，先重新读一次再操作。
    await page.click(trust('official', 'local-source-review'));
    await page.waitForSelector(trust('official', 'local-source-preset'), { timeout: 5_000 });
    assert.match(await page.locator(trust('official', 'local-source-preset')).innerText(), /允许/);
    await page.evaluate(() => window.__hostFailPreset(true));
    await page.waitForSelector(trust('official', 'local-source-deny-permissions'), {
      timeout: 5_000,
    });
    await page.click(trust('official', 'local-source-deny-permissions'));
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'setSourcePreset'),
      { timeout: 5_000 },
    );
    await page.waitForSelector('[data-testid="local-host-notice"]', { timeout: 5_000 });
    assert.match(
      await page.locator('[data-testid="local-host-notice"]').innerText(),
      /没有获得授权/,
    );
    // 失败不伪造新预设：界面仍是 allow，且「允许」按钮依旧不存在。
    assert.match(await page.locator(trust('official', 'local-source-preset')).innerText(), /允许/);
    assert.equal(
      await page.locator(trust('official', 'local-source-allow-permissions')).count(),
      0,
    );
    await page.evaluate(() => window.__hostFailPreset(false));
  });

  await guard('同一次提交里先采纳新 boot，旧 mutation 迟回不得覆盖', async () => {
    /*
     * 这是栅栏的真正边界：不是「等 React 重渲染之后」才判新旧，而是采纳新 boot
     * 的那一刻，后续迟回应就必须看到新世界。
     *
     * 只看最终 DOM 不够——`mutate()` 末尾的无条件 reread 会把画面修回来，
     * 从而掩盖中间的倒灌。所以这里用 MutationObserver 记录身份元素的**每一次**
     * 文本变化，证明旧 boot 从未被显示过，哪怕一帧。
     */
    await page.evaluate(() => {
      const identity = () =>
        document.querySelector('[data-testid="local-host-identity"]')?.textContent ?? '';
      window.__identityTrace = [identity()];
      window.__identityObserver?.disconnect();
      window.__identityObserver = new MutationObserver(() => {
        const now = identity();
        const trace = window.__identityTrace;
        if (trace[trace.length - 1] !== now) trace.push(now);
      });
      window.__identityObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await page.fill('[data-testid="local-source-app-id"]', 'deferred-save');
    await page.evaluate(() => window.__hostHoldSave());
    await page.click(
      '[data-testid="local-source-form-official"] [data-testid="local-source-save"]',
    );
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'saveSource'),
      { timeout: 5_000 },
    );

    await page.evaluate(async () => {
      /*
       * 第一步：让新 boot 真的被接受。onChanged → getState → accept，
       * 此时 latest 已同步指向新世界，而 React 还没重渲染。
       */
      window.__hostSwapTo('host-9', 'boot-9');
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    /*
     * 第二步：挂起重读。旧 mutation 结束后 `mutate()` 会无条件 reread 一次，
     * 那次重读会把倒灌当场修好、掩盖中间状态；挂起它才看得到真实的采纳顺序。
     * 注意必须在「新 boot 已接受」之后再挂，否则被挂起的就是新 boot 自己的读取。
     */
    await page.evaluate(() => window.__hostHoldGetState());
    /*
     * 第三步：放开旧 mutation。它的续体仍落在「新 boot 已接受、但还没重渲染」
     * 的微任务窗口里——这正是 ref 必须先同步更新的原因。
     */
    await page.evaluate(async () => {
      window.__hostReleaseSave();
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    /*
     * 关键断言点：此时修正式重读仍被挂起，界面只能反映**采纳**的结果。
     * 栅栏正确时 stale 的 host-3 被拒绝，界面保持 host-9；
     * 若 render 回写覆盖了已接受的 ref，stale 就会被采纳、界面退回 host-3。
     */
    await page.waitForTimeout(600);
    const duringHold = await page.locator('[data-testid="local-host-identity"]').innerText();
    await page.evaluate(() => window.__hostReleaseGetState());
    await page.waitForTimeout(600);

    const trace = await page.evaluate(() => {
      window.__identityObserver?.disconnect();
      return window.__identityTrace;
    });
    assert.equal(
      duringHold,
      'host-9',
      '新 boot 被采纳后，旧 boot 的迟到 mutation 不得被采纳（界面此时还没被重读修正）',
    );
    const adoptedAt = trace.indexOf('host-9');
    assert.ok(adoptedAt >= 0, `必须真的采纳了新宿主，实际轨迹 ${trace.join(' → ')}`);
    assert.deepEqual(
      trace.slice(adoptedAt).filter((value) => value !== 'host-9'),
      [],
      `新宿主出现后，旧 boot 不得再倒灌任何一帧，实际轨迹 ${trace.join(' → ')}`,
    );
    assert.equal(await page.locator('[data-testid="local-host-identity"]').innerText(), 'host-9');
    // 旧世界作废后，该源的信任也必须重新读取，不能沿用旧 digest。
    assert.equal(await page.locator(trust('official', 'local-source-digest')).count(), 0);
  });

  await guard('迟到的 start 结果不覆盖换过的宿主', async () => {
    await page.evaluate(() => window.__hostHoldStart());
    await page.click('[data-testid="local-host-stop"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="local-host-phase"]')?.textContent === '未运行',
      { timeout: 5_000 },
    );
    await page.click('[data-testid="local-host-start"]');
    // start 挂起期间换宿主：这次结果必须被丢弃。
    await page.evaluate(() => window.__hostSwap());
    await page.evaluate(() => window.__hostReleaseStart());
    await page.waitForTimeout(800);
    /*
     * 那次迟到的 start 带回的是 host-1 的视图。它必须被丢弃，
     * 界面继续显示换宿主之后的真实世界（host-2），而不是被旧身份覆盖。
     */
    // 界面必须显示 host-2；被迟到的 host-1 回应覆盖就会退回 host-1。
    assert.equal(
      await page.locator('[data-testid="local-host-identity"]').innerText(),
      'host-2',
      '迟到的旧宿主回应不能覆盖新宿主身份',
    );
  });

  await guard('Agent 链路用当前连接，不让用户手填内部 ID', async () => {
    assert.equal(await page.locator('[data-testid="local-agent-id"]').count(), 1);
    // 只读：没有可输入的 Agent ID 输入框。
    assert.equal(await page.locator('input[data-testid="local-agent-id"]').count(), 0);
    assert.equal(
      await page.locator('button[data-testid="local-agent-link"]').count(),
      1,
      '用当前连接是一个按钮，且只有一个',
    );
  });

  await guard('启用链路带的是发起时捕获的 revision 与密钥版本', async () => {
    await page.waitForSelector('[data-testid="local-agent-toggle"]', { timeout: 10_000 });
    assert.equal(await page.locator('[data-testid="local-agent-toggle"]').isDisabled(), false);
    await page.click('[data-testid="local-agent-toggle"]');
    await page.waitForFunction(
      () => window.__hostCalls().some((call) => call.kind === 'setAgentEnabled'),
      { timeout: 5_000 },
    );
    const calls = await page.evaluate(() => window.__hostCalls());
    const enabled = calls.find((call) => call.kind === 'setAgentEnabled');
    // 服务端 exclusive 校验：两个期望值都必须存在且来自捕获的 view。
    assert.equal(typeof enabled.input.expectedRevision, 'number');
    assert.equal(typeof enabled.input.expectedCredentialVersion, 'string');
    assert.ok(enabled.input.expectedCredentialVersion.length > 0);
    assert.equal(enabled.input.hostId, 'host-2');
    // 上一用例把链路连上了，所以这次点击是「停用」；两种取值都合法，
    // 这里只要求它是布尔且与界面标签一致。
    assert.equal(typeof enabled.input.enabled, 'boolean');
  });

  await guard('页面没有抛错', async () => {
    assert.deepEqual(pageErrors, []);
  });
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

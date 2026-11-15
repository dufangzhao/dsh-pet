/**
 * 语音输入组件的真实 DOM 回归（真实 Chromium + 受控 transport/sampler）。
 *
 * 验证的是组件行为：状态推进、20 秒文案可达、预览可编辑、取消不提交、
 * 目标切换后旧结果不落地。不是跨端 E2E：没有真实麦克风、没有真实服务。
 *
 * 运行：
 *   node plugins/text-client/tests/browser/voice-input.browser.mjs
 * 没有浏览器时退出码 2 明确跳过。
 */
/* global document, window */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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

/* ------------------------------------------------------------------ 页面夹具 */

const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div>
<script src="/harness.js"></script>
<script src="/bundle.js"></script></body></html>`;

/** 受控 transport：每次调用都记下来，结果由用例决定。 */
const HARNESS = `
window.__calls = [];
window.__events = [];
window.__captures = {};
window.__makeDeferred = (name) => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  window.__deferred[name] = { resolve, reject, promise };
  return promise;
};
`;

/** 页面内夹具：受控 transport（每个目标一份）+ 每次采集一份 released 门。 */
const PAGE_SCRIPT = `
import { createElement, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceInput, useVoiceInput } from 'PLUGIN/src/client/voice-input.tsx';
import { VoiceSettings } from 'PLUGIN/src/client/voice-settings.tsx';
import 'PLUGIN/src/client/voice-input.css';
import 'PLUGIN/src/client/styles.css';

const record = (tag, kind, captureId) => window.__events.push({ tag, kind, captureId });
const ok = (value) => ({ ok: true, value });
const result = () => window.__result;

/** 每个目标一份会话：换目标就换一份，旧会话的 ACK 仍回旧的那一份。 */
function makeTransport(tag) {
  return {
    read: async () => {
      window.__calls.push('read');
      return ok(window.__view);
    },
    begin: async (input) => {
      window.__calls.push('begin:' + input.finishMode);
      record(tag, 'begin', input.captureId);
      return ok({ ...window.__ticket, captureId: input.captureId, finishMode: input.finishMode });
    },
    ready: async (_ticket, sampleRate) => {
      window.__calls.push('ready:' + sampleRate);
      return ok(null);
    },
    push: async (_ticket, bytes) => {
      window.__calls.push('push:' + bytes.byteLength);
      return window.__pushOutcome ?? ok(null);
    },
    finish: async (ticket, summary) => {
      window.__calls.push('finish:' + summary.frames + ':' + summary.samples);
      record(tag, 'finish', ticket.captureId);
      if (window.__holdFinish) await window.__makeDeferred('finish');
      if (window.__throwFinish) throw new Error('host threw');
      return window.__finishOutcome ?? ok(result());
    },
    released: async (ticket) => {
      window.__calls.push('released');
      record(tag, 'released', ticket.captureId);
      if (window.__throwAck) throw new Error('ack threw');
      return window.__releaseOutcome ?? ok(null);
    },
    cancel: async (ticket) => {
      window.__calls.push('cancelCapture');
      record(tag, 'cancel', ticket.captureId);
      if (window.__holdCancel) await window.__makeDeferred('cancel');
    },
    recover: async (ticket) => {
      window.__calls.push('recover');
      record(tag, 'recover', ticket.captureId);
      return window.__recoverOutcome ?? ok(result());
    },
    submit: async (commandId, text) => {
      window.__calls.push('submit:' + text);
      record(tag, 'submit', commandId);
      return window.__submitOutcome ?? 'accepted';
    },
  };
}

const sampler = {
  unavailableReason: () => window.__samplerUnavailable,
  start: (input) => {
    const captureId = input.ticket.captureId;
    window.__calls.push('sampler:start');
    record('sampler', 'start', captureId);
    // 每次采集一份独立的 released 门：旧采集的释放不会动到新采集。
    let resolve, reject;
    const released = new Promise((res, rej) => { resolve = res; reject = rej; });
    released.catch(() => {});
    window.__captures[captureId] = { captureId, resolve, reject, released };
    window.__lastCaptureId = captureId;
    window.__sampler = {
      ...input,
      // 与真实采样器一致：push 被拒就是这一路采集失败，由它回调 onFailed。
      onPush: (frame) => input.onPush(frame).catch(() => input.onFailed('failed')),
    };
    if (window.__autoRelease) queueMicrotask(() => resolve());
    window.__handle = {
      finish: async () => {
        window.__calls.push('sampler:finish');
        if (window.__samplerFinishFails) throw new Error('capture not ready');
        return { frames: 1, samples: 16000 };
      },
      cancel: async () => {
        window.__calls.push('sampler:cancel');
      },
      released,
    };
    return window.__handle;
  },
};

function Harness(props) {
  const targetKey = props?.targetKey ?? 'k1';
  const transport = useMemo(() => makeTransport(targetKey), [targetKey]);
  const controller = useVoiceInput({
    transport,
    sampler,
    workletUrl: 'w.js',
    live: true,
    targetKey,
  });
  window.__controller = controller;
  return createElement(VoiceInput, { controller });
}

window.__mount = (props) => {
  window.__root = createRoot(document.getElementById('root'));
  window.__root.render(createElement(Harness, props ?? {}));
};
window.__unmount = () => { window.__root?.unmount(); window.__root = null; };
window.__setTarget = (targetKey) => window.__root.render(createElement(Harness, { targetKey }));
window.__settleRelease = (captureId, outcome) => {
  const entry = window.__captures[captureId];
  if (!entry) throw new Error('no capture ' + captureId);
  if (outcome === 'fail') entry.reject(new Error('close failed'));
  else entry.resolve();
};
window.__defaults = {
  view: VIEW,
  ticket: TICKET,
  result: RESULT,
};
window.__reset = (over) => {
  window.__calls = [];
  window.__events = [];
  window.__captures = {};
  window.__deferred = {};
  window.__view = over?.view ?? window.__defaults.view;
  window.__ticket = over?.ticket ?? window.__defaults.ticket;
  window.__result = over?.result ?? window.__defaults.result;
  window.__submitOutcome = over?.submitOutcome;
  window.__pushOutcome = undefined;
  window.__recoverOutcome = undefined;
  window.__finishOutcome = undefined;
  window.__releaseOutcome = undefined;
  window.__autoRelease = over?.holdRelease !== true;
  window.__samplerUnavailable = over?.samplerUnavailable ?? null;
  window.__holdFinish = false;
  window.__throwFinish = false;
  window.__throwAck = false;
  window.__holdCancel = false;
  window.__samplerFinishFails = false;
  window.__unmount();
  window.__mount(over?.props ?? {});
};
window.__view = window.__defaults.view;
window.__ticket = window.__defaults.ticket;
window.__result = window.__defaults.result;
window.__autoRelease = true;
window.__samplerUnavailable = null;
window.__mount({});
window.__openSettings = () => {
  window.__unmount();
  window.__settingsWrites = [];
  window.__settingsView = JSON.parse(JSON.stringify(window.__defaults.view));
  const provider = window.__settingsView.providers[0];
  provider.credential.writable = true;
  const actions = {
    saveFeature: async (command) => {
      window.__settingsWrites.push({ kind: 'feature', command });
      const current = window.__settingsView;
      if (command.expectedRevision !== current.feature.configRevision) return { ok: false, error: '版本冲突' };
      window.__settingsView = { ...current, feature: { ...current.feature, ...command, configRevision: current.feature.configRevision + 1 } };
      window.__renderSettings();
      return { ok: true, error: null, view: window.__settingsView };
    },
    saveProvider: async (command) => {
      window.__settingsWrites.push({ kind: 'provider', command });
      const current = window.__settingsView;
      const provider = current.providers[0];
      if (command.expectedRevision !== provider.configRevision) return { ok: false, error: '版本冲突' };
      window.__settingsView = { ...current, providers: [{ ...provider, settings: command.settings, configRevision: provider.configRevision + 1 }] };
      window.__renderSettings();
      return { ok: true, error: null, view: window.__settingsView };
    },
    writeCredential: async (command) => {
      window.__settingsWrites.push({ kind: 'credential', command });
      const current = window.__settingsView;
      const provider = current.providers[0];
      if (command.expectedRevision !== provider.configRevision || command.expectedCredentialVersion !== provider.credential.version) return { ok: false, error: '版本冲突' };
      window.__settingsView = { ...current, providers: [{ ...provider, credential: { ...provider.credential, version: 'key-next' } }] };
      window.__renderSettings();
      return { ok: true, error: null, view: window.__settingsView };
    },
    readCatalog: async () => ({ ok: true, catalog: {
      providerRef: provider.providerRef, bindingId: provider.bindingId,
      candidates: [{ modelRef: 'xiaomi/mimo-' + 'long-'.repeat(20) + 'asr', label: '长模型名称'.repeat(16),
        role: 'asr', classification: 'known-name', protocol: 'mimo-native', selectable: true, reason: null }],
    } }),
  };
  window.__root = createRoot(document.getElementById('root'));
  window.__renderSettings = () => window.__root.render(createElement(VoiceSettings, {
    open: true, live: true, view: window.__settingsView, actions, onClose: () => {},
  }));
  window.__renderSettings();
};
`;

const outDir = await mkdtemp(path.join(tmpdir(), 'voice-input-dom-'));
const { build } = await import('esbuild');
await writeFile(path.join(outDir, 'harness.js'), HARNESS, 'utf8');
const pageScript = PAGE_SCRIPT.replaceAll('PLUGIN', path.join(pluginRoot).replace(/\\/g, '/'))
  .replace('VIEW', JSON.stringify(view()))
  .replace('TICKET', JSON.stringify(ticket()))
  .replace('RESULT', JSON.stringify(result()));
await build({
  stdin: { contents: pageScript, loader: 'tsx', resolveDir: pluginRoot },
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

function view(over = {}) {
  const provider = {
    providerRef: 'pet.asr-magpie/magpie',
    label: 'Magpie',
    synthetic: false,
    source: 'ready',
    configRevision: 3,
    settings: {
      baseUrl: 'https://gw.example/v1',
      modelRef: 'xiaomi/mimo-v2.5-asr',
      finishMode: 'send',
    },
    bindingId: 'binding-1',
    credential: { available: true, writable: false, version: '1', source: 'memory' },
    readiness: 'configured',
    reason: null,
    ...(over.provider ?? {}),
  };
  return {
    version: 1,
    feature: {
      source: 'ready',
      configRevision: 3,
      providerRef: 'pet.asr-magpie/magpie',
      finishMode: 'send',
      ...(over.feature ?? {}),
    },
    providers: [provider],
  };
}

function ticket(over = {}) {
  return {
    version: 1,
    captureId: 'cap-1',
    clientId: 'c1',
    agentId: 'a1',
    serviceEpoch: 'e1',
    bindingId: 'binding-1',
    finishMode: 'send',
    expiresAt: 1,
    encoding: 'f32le',
    sampleRate: 16000,
    channels: 1,
    chunkSamples: 1600,
    maxSamples: 320000,
    ...over,
  };
}

function result(over = {}) {
  return {
    ticket: ticket(),
    phase: 'final',
    samples: 16000,
    cleanup: 'settled',
    outcome: { kind: 'final', text: '你好' },
    error: null,
    completedAt: 1,
    ...over,
  };
}

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

const server = (await import('node:http')).createServer((request, response) => {
  const url = request.url;
  if (url === '/' || url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
    return;
  }
  if (url === '/harness.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(HARNESS);
    return;
  }
  if (url === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(JS);
    return;
  }
  if (url === '/bundle.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    response.end(CSS);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: {
    ...process.env,
    HOME: path.join(outDir, 'home'),
    XDG_CONFIG_HOME: path.join(outDir, 'config'),
    XDG_CACHE_HOME: path.join(outDir, 'cache'),
    XDG_DATA_HOME: path.join(outDir, 'data'),
  },
});
const context = await browser.newContext({ viewport: { width: 880, height: 600 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));
await page.goto(origin);
await page.waitForSelector('[data-testid="voice-start"]', { timeout: 10000 });

const calls = () => page.evaluate(() => window.__calls.slice());
const text = (testId) => page.textContent(`[data-testid="${testId}"]`);

await step('初始状态：可以开始，20 秒上限在开始前就可读到', async () => {
  const hint = await text('voice-hint');
  assert.match(hint ?? '', /20 秒/);
  assert.match(hint ?? '', /发送/);
  const start = await page.$('[data-testid="voice-start"]');
  assert.ok(start);
  // aria-describedby 必须指向那句提示，否则读屏用户看不到 20 秒。
  const describedBy = await start.getAttribute('aria-describedby');
  assert.ok(describedBy, '开始按钮要关联 20 秒说明');
  assert.ok(await page.$(`#${describedBy}`));
});

await step('不安全的浏览器环境在申请服务票据前禁用录音', async () => {
  await page.evaluate(() =>
    window.__reset({
      samplerUnavailable: '浏览器录音需要 HTTPS 或本机回环地址（localhost/127.0.0.1）。',
    }),
  );
  await page.waitForSelector('[data-testid="voice-reason"]');
  assert.match((await text('voice-reason')) ?? '', /HTTPS/);
  assert.ok(await page.isDisabled('[data-testid="voice-start"]'));
  assert.equal(
    (await calls()).some((item) => item.startsWith('begin:') || item === 'sampler:start'),
    false,
  );
  await page.evaluate(() => window.__reset({}));
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="voice-start"]')?.disabled,
  );
});

await step('开始录音：状态变成准备中，再进录音', async () => {
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  assert.equal(await page.locator('[data-testid="voice-finish"]').count(), 0, 'arming 只给取消');
  // 让采样器 ready。
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-state"]')?.textContent?.includes('正在录音'),
    undefined,
    { timeout: 5000 },
  );
  assert.ok((await calls()).includes('sampler:start'));
});

await step('每一帧都要宿主确认：push 失败立刻变成失败，不假装收下', async () => {
  await page.evaluate(() => {
    window.__calls.length = 0;
    window.__pushOutcome = {
      ok: false,
      error: { code: 'invalid-input', messageKey: 'errors.invalid-input', retryable: false },
    };
    window.__sampler?.onPush(new Float32Array(1600));
  });
  await page.waitForSelector('[data-testid="voice-error"]', { timeout: 5000 });
  assert.match((await text('voice-error')) ?? '', /录音中断/);
  assert.ok((await calls()).includes('push:6400'));
  // 失败之后可以重来。
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.evaluate(() => {
    window.__pushOutcome = undefined;
    window.__calls.length = 0;
  });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
});

await step('录音时不能再次开始（没有重复入口）', async () => {
  assert.equal(await page.$('[data-testid="voice-start"]'), null);
});

await step('结束：转写后按 send 模式直接提交一次', async () => {
  await page.click('[data-testid="voice-finish"]');
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
  const all = await calls();
  assert.equal(all.filter((item) => item.startsWith('finish:')).length, 1);
  assert.equal(all.filter((item) => item.startsWith('submit:')).length, 1);
  // 提交完回到 idle，可以再来一次。
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
});

await step('review 模式：结果进可编辑预览，改完才发送', async () => {
  await page.evaluate(() =>
    window.__reset({
      view: {
        ...window.__defaults.view,
        feature: { ...window.__defaults.view.feature, finishMode: 'review' },
      },
      result: {
        ...window.__defaults.result,
        ticket: { ...window.__defaults.result.ticket, finishMode: 'review' },
      },
    }),
  );
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  const hint = await text('voice-hint');
  assert.match(hint ?? '', /预览/);

  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-preview"]', { timeout: 8000 });
  assert.equal(await page.inputValue('[data-testid="voice-preview"]'), '你好');
  // 还没提交。
  assert.equal((await calls()).filter((item) => item.startsWith('submit:')).length, 0);

  await page.fill('[data-testid="voice-preview"]', '你好呀');
  await page.click('[data-testid="voice-send"]');
  await page.waitForFunction(() => window.__calls.includes('submit:你好呀'), undefined, {
    timeout: 8000,
  });
});

await step('取消：不上传、不提交，并通知服务端取消采集', async () => {
  await page.evaluate(() => window.__reset({}));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-cancel"]');
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });

  const all = await calls();
  assert.ok(all.includes('sampler:cancel'));
  assert.equal(
    all.some((item) => item.startsWith('finish:')),
    false,
  );
  assert.equal(all.filter((item) => item.startsWith('submit:')).length, 0);
});

await step('结果未知：保留文本与提示，不重复发送', async () => {
  await page.evaluate(() => window.__reset({ submitOutcome: 'uncertain' }));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-notice"]', { timeout: 8000 });
  const notice = await text('voice-notice');
  assert.match(notice ?? '', /不会重复发送/);
  // 文本仍在预览里，可以原样重试。
  assert.equal(await page.inputValue('[data-testid="voice-preview"]'), '你好');
});

await step('没有识别到语音：给提示，不提交空消息', async () => {
  await page.evaluate(() =>
    window.__reset({
      result: { ...window.__defaults.result, phase: 'empty', outcome: { kind: 'no-speech' } },
    }),
  );
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-error"]', { timeout: 8000 });
  assert.match((await text('voice-error')) ?? '', /没有识别到语音/);
  assert.equal((await calls()).filter((item) => item.startsWith('submit:')).length, 0);
});

await step('结束与取消都要在设备真的放开后才 ACK 释放', async () => {
  // 结束路径：released 必须出现在 finish 之前，Main 才不会一直等一个不会来的确认。
  await page.evaluate(() => window.__reset({}));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
  const finished = await calls();
  const at = (name) => finished.findIndex((item) => item.startsWith(name));
  assert.ok(at('released') >= 0, '结束要 ACK 真实释放');
  assert.ok(at('released') < at('finish:'), 'ACK 必须先于上传');

  // 取消路径：同样要 ACK，且不能上传。
  await page.evaluate(() => window.__reset({}));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-cancel"]');
  await page.waitForFunction(() => window.__calls.includes('released'), undefined, {
    timeout: 5000,
  });
  const cancelled = await calls();
  assert.equal(
    cancelled.some((item) => item.startsWith('finish:')),
    false,
  );
  assert.ok(cancelled.includes('cancelCapture'));
});

await step('转写响应丢失：读同一个票据，不重传音频', async () => {
  await page.evaluate(() =>
    window.__reset({
      // 上传结果未知：服务可能已经转写完成，只是响应没回来。
      result: window.__defaults.result,
    }),
  );
  await page.evaluate(() => {
    window.__finishOutcome = {
      ok: false,
      error: { code: 'network', messageKey: 'errors.network', retryable: true },
    };
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForFunction(() => window.__calls.includes('recover'), undefined, {
    timeout: 8000,
  });
  const recovered = await calls();
  // 只读一次同一个票据：没有第二次上传，也没有重新开始采集。
  assert.equal(recovered.filter((item) => item.startsWith('finish:')).length, 1);
  assert.equal(recovered.filter((item) => item === 'recover').length, 1);
  assert.equal(recovered.filter((item) => item === 'sampler:start').length, 1);
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
});

await step('未配置模型：说清原因，开始按钮不可用', async () => {
  await page.evaluate(() =>
    window.__reset({
      view: {
        ...window.__defaults.view,
        providers: [
          {
            ...window.__defaults.view.providers[0],
            readiness: 'unconfigured',
            reason: 'model-unconfigured',
          },
        ],
      },
    }),
  );
  await page.waitForSelector('[data-testid="voice-reason"]', { timeout: 5000 });
  assert.match((await text('voice-reason')) ?? '', /还没有选择转写模型/);
  assert.ok(await page.isDisabled('[data-testid="voice-start"]'));
});

await step('采样器还没确认释放：0 ACK、0 上传，也不能开始第二次', async () => {
  await page.evaluate(() => {
    // 让 released 挂住：这是「context.close() 还没结算」的真实形状。
    window.__reset({ holdRelease: true });
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  // 给异步路径足够的时间走完它不该走的部分。
  await page.waitForTimeout(500);
  const held = await calls();
  assert.equal(held.includes('released'), false, '未确认释放就不能 ACK');
  assert.equal(
    held.some((item) => item.startsWith('finish:')),
    false,
    '未确认释放就不能上传',
  );
  assert.equal(
    held.some((item) => item.startsWith('submit:')),
    false,
  );
  assert.equal(await page.$('[data-testid="voice-start"]'), null, '释放未结算时不给第二次入口');

  // 迟到的清理兑现之后，才 ACK 并允许重来。
  await page.evaluate(() => window.__settleRelease(window.__lastCaptureId));
  await page.waitForFunction(() => window.__calls.includes('released'), undefined, {
    timeout: 5000,
  });
  const after = await calls();
  assert.equal(after.filter((item) => item === 'released').length, 1);
  assert.ok(
    after.some((item) => item.startsWith('finish:')),
    '释放确认后才上传',
  );
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
});

await step('释放被拒绝：不 ACK、不上传，界面说清未确认而不是干净', async () => {
  await page.evaluate(() => window.__reset({ holdRelease: true }));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  // close 失败：采样器的 released 直接 reject。
  await page.evaluate(() => window.__settleRelease(window.__lastCaptureId, 'fail'));
  await page.click('[data-testid="voice-cancel"]');

  await page.waitForSelector('[data-testid="voice-error"]', { timeout: 8000 });
  const error = await text('voice-error');
  assert.match(error ?? '', /没有确认放开/);
  const failed = await calls();
  assert.equal(failed.includes('released'), false, '释放失败不能 ACK 成功');
  assert.equal(
    failed.some((item) => item.startsWith('finish:')),
    false,
  );
  // 失败不是干净：仍然没有第二次入口。
  assert.ok(await page.isDisabled('[data-testid="voice-start"]'));
});

await step('ACK 被宿主拒绝：不上传，也不冒充干净', async () => {
  await page.evaluate(() => {
    window.__reset({});
    window.__releaseOutcome = {
      ok: false,
      error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
    };
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-error"]', { timeout: 8000 });
  assert.match((await text('voice-error')) ?? '', /释放没有送达/);
  const all = await calls();
  assert.ok(all.includes('released'));
  assert.equal(
    all.some((item) => item.startsWith('finish:')),
    false,
    'ACK 失败不得上传',
  );
  assert.ok(await page.isDisabled('[data-testid="voice-start"]'));
});

await step('第一次恢复还在转写：显式「再读一次」拿到终态，仍只有 1 上传 1 提交', async () => {
  await page.evaluate(() => {
    window.__reset({});
    // 上传结果未知 → 自动恢复一次；第一次恢复仍是 transcribing。
    window.__finishOutcome = {
      ok: false,
      error: { code: 'network', messageKey: 'errors.network', retryable: true },
    };
    window.__recoverOutcome = {
      ok: true,
      value: { ...window.__defaults.result, phase: 'transcribing', outcome: null, samples: 0 },
    };
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-recover"]', { timeout: 8000 });
  const pending = await calls();
  assert.equal(pending.filter((item) => item === 'recover').length, 1);
  assert.equal(
    pending.some((item) => item.startsWith('submit:')),
    false,
  );

  // 转写完成之后，显式再读一次拿到终态。
  await page.evaluate(() => {
    window.__recoverOutcome = { ok: true, value: window.__defaults.result };
  });
  await page.click('[data-testid="voice-recover"]');
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
  const done = await calls();
  assert.equal(done.filter((item) => item.startsWith('finish:')).length, 1, '只有一次上传');
  assert.equal(done.filter((item) => item.startsWith('submit:')).length, 1, '只提交一次');
  assert.equal(done.filter((item) => item === 'sampler:start').length, 1, '没有重新录音');
});

await step('宿主抛错：不永久 busy，可以重来', async () => {
  await page.evaluate(() => {
    window.__reset({});
    // finish 抛异常：上传可能已到达服务，按未知走恢复。
    window.__throwFinish = true;
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');
  await page.waitForFunction(() => window.__calls.includes('recover'), undefined, {
    timeout: 8000,
  });
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
  // 锁真的放开了：能开始下一次。
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  assert.ok(!(await page.isDisabled('[data-testid="voice-start"]')));
});

await step('ASR 进行中取消：设备已 ACK，不误报未释放、不 submit、不补 ACK', async () => {
  await page.evaluate(() => {
    window.__reset({});
    // 上传挂住：此时设备早已释放并 ACK，界面停在「正在转写」。
    window.__holdFinish = true;
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  // 转写态出现即代表设备释放与 ACK 都已完成。
  await page.waitForFunction(() => window.__calls.includes('finish:1:16000'), undefined, {
    timeout: 8000,
  });
  const before = await calls();
  assert.equal(before.filter((item) => item === 'released').length, 1, '正常结束只 ACK 一次');

  // 转写中的取消必须是用户可到达的真实按钮。
  await page.getByTestId('voice-cancel').click();
  await page.evaluate(() => window.__deferred.finish.resolve());
  await page.waitForTimeout(400);

  const after = await calls();
  // 关键回归：设备已经真正释放，取消不得把它误报成「未释放」。
  assert.equal(after.filter((item) => item === 'released').length, 1, '已 ACK 的设备不再补 ACK');
  assert.equal(
    after.some((item) => item.startsWith('submit:')),
    false,
    '取消之后不提交',
  );
  assert.equal(
    after.some((item) => item === 'sampler:cancel'),
    false,
    '设备已停，不再 cancel',
  );
  assert.ok(
    after.some((item) => item === 'cancelCapture'),
    '仍要 fence 服务端的 ASR',
  );
  assert.equal(await page.$('[data-testid="voice-error"]'), null, '不得报设备未释放');
  // 取消之后可以立刻重来：cleanup 已经确认过。
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
});

await step('ACK 抛错：释放本地 operation 锁，0 ASR、0 提交', async () => {
  await page.evaluate(() => {
    window.__reset({});
    window.__throwAck = true;
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');

  await page.waitForSelector('[data-testid="voice-error"]', { timeout: 8000 });
  assert.match((await text('voice-error')) ?? '', /释放没有送达/);
  const all = await calls();
  assert.equal(
    all.some((item) => item.startsWith('finish:')),
    false,
    'ACK 抛错不得上传',
  );
  assert.equal(
    all.some((item) => item.startsWith('submit:')),
    false,
  );
  // 清理确认失败时不允许新的设备操作；上传抛错后可恢复的锁路径由上一个用例验证。
  assert.ok(await page.isDisabled('[data-testid="voice-start"]'));
  assert.equal(all.filter((item) => item.startsWith('begin:')).length, 1);
});

await step('旧目标 release 失败不覆盖新目标：旧 ACK 只回旧会话', async () => {
  await page.evaluate(() => {
    window.__reset({ holdRelease: true });
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  const oldCapture = await page.evaluate(() => window.__lastCaptureId);

  // 取消（设备还没放开）后立刻换目标：新目标有自己的采集。
  await page.evaluate(() => window.__controller.cancel());
  await page.evaluate(() => window.__setTarget('k2'));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });

  // 旧设备的清理现在才失败：它只属于旧连接。
  await page.evaluate((id) => window.__settleRelease(id, 'fail'), oldCapture);
  await page.waitForTimeout(400);

  const events = await page.evaluate(() => window.__events.slice());
  const oldReleases = events.filter((item) => item.kind === 'released');
  assert.equal(oldReleases.length, 0, '旧设备释放失败不能发送成功 ACK');
  // 新目标仍是可开始的干净状态：旧失败没有把错误按到它头上。
  assert.equal(await page.$('[data-testid="voice-error"]'), null);
  assert.ok(await page.$('[data-testid="voice-start"]'));
  assert.ok(!(await page.isDisabled('[data-testid="voice-start"]')));

  // 新目标照常工作，且用的仍是新会话。
  await page.evaluate(() => {
    window.__calls.length = 0;
    window.__autoRelease = true;
  });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  await page.click('[data-testid="voice-finish"]');
  await page.waitForFunction(() => window.__calls.includes('submit:你好'), undefined, {
    timeout: 8000,
  });
  const fresh = await page.evaluate(() => window.__events.slice());
  assert.ok(
    fresh.some((item) => item.tag === 'k2' && item.kind === 'released'),
    '新目标用自己的会话 ACK',
  );
  assert.equal(
    fresh.filter((item) => item.tag === 'k1' && item.kind === 'released').length,
    0,
    '失败的旧会话没有成功 ACK',
  );
});

await step('旧目标 release 成功但迟到：不覆盖新目标的状态', async () => {
  await page.evaluate(() => {
    window.__reset({ holdRelease: true });
  });
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 5000 });
  await page.evaluate(() => window.__sampler?.onReady(16000));
  const oldCapture = await page.evaluate(() => window.__lastCaptureId);

  await page.evaluate(() => window.__controller.cancel());
  await page.evaluate(() => window.__setTarget('k2'));
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });

  // 旧设备的清理成功兑现，但发生在新目标之后：不许把新界面打回/清空。
  await page.evaluate((id) => window.__settleRelease(id), oldCapture);
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => window.__controller.state);
  assert.equal(state.phase, 'idle', '旧 release 成功不得改写新目标的状态');
  assert.equal(state.release, 'settled');
  assert.ok(await page.$('[data-testid="voice-start"]'));
});

await step('最小视口 880×600：没有横向溢出，控件仍可达', async () => {
  const overflow = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="voice-input"]');
    return section ? section.scrollWidth - section.clientWidth : -1;
  });
  assert.ok(overflow <= 0, `不应横向溢出：${overflow}`);
  const box = await page.locator('[data-testid="voice-start"]').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, '按钮要真的可点');
  assert.ok(box.y + box.height <= 600, '按钮要在视口内');
});

await step(
  '异常 arming finish 先 fence，真实 release 后才 ACK，host cancel 不阻塞清理',
  async () => {
    await page.evaluate(() => {
      window.__reset({ holdRelease: true });
      window.__samplerFinishFails = true;
      window.__holdCancel = true;
    });
    await page.waitForSelector('[data-testid="voice-start"]');
    await page.click('[data-testid="voice-start"]');
    await page.waitForSelector('[data-testid="voice-cancel"]');
    assert.equal(await page.locator('[data-testid="voice-finish"]').count(), 0);
    await page.evaluate(() => window.__controller.finish());
    await page.waitForFunction(() => window.__calls.includes('cancelCapture'));
    assert.equal((await calls()).includes('released'), false);
    await page.evaluate(() => window.__settleRelease(window.__lastCaptureId));
    await page.waitForSelector('[data-testid="voice-error"]');
    const all = await calls();
    assert.equal(all.filter((item) => item === 'released').length, 1);
    assert.equal(
      all.some((item) => item.startsWith('finish:') || item.startsWith('submit:')),
      false,
    );
    assert.ok(all.indexOf('cancelCapture') < all.indexOf('released'));
    await page.evaluate(() => window.__deferred.cancel.resolve());
    assert.equal(await page.isDisabled('[data-testid="voice-start"]'), false);
  },
);

for (const [code, copy] of [
  ['auth-failed', '身份验证失败'],
  ['rate-limited', '请求过于频繁'],
  ['audio-format', '录音格式不可用'],
]) {
  for (const recovery of [false, true]) {
    await step(`${recovery ? '恢复' : '结束'}保留终态 ${code}，不伪装成待转写`, async () => {
      await page.evaluate(
        ({ code, recovery }) => {
          window.__reset({});
          const failed = {
            ...window.__defaults.result,
            phase: 'failed',
            outcome: null,
            error: { code, messageKey: 'errors.' + code, retryable: false },
          };
          if (recovery) {
            window.__finishOutcome = {
              ok: false,
              error: { code: 'network', messageKey: 'errors.network', retryable: true },
            };
            window.__recoverOutcome = { ok: true, value: failed };
          } else window.__finishOutcome = { ok: true, value: failed };
        },
        { code, recovery },
      );
      await page.waitForSelector('[data-testid="voice-start"]');
      await page.click('[data-testid="voice-start"]');
      await page.waitForSelector('[data-testid="voice-cancel"]');
      await page.evaluate(() => window.__sampler.onReady(16000));
      await page.click('[data-testid="voice-finish"]');
      await page.waitForSelector('[data-testid="voice-error"]');
      assert.match((await text('voice-error')) ?? '', new RegExp(copy));
      assert.equal(await page.evaluate(() => window.__controller.state.error.code), code);
      assert.equal(
        (await calls()).some((item) => item.startsWith('submit:')),
        false,
      );
      assert.equal((await calls()).filter((item) => item === 'recover').length, recovery ? 1 : 0);
      assert.equal(await page.isDisabled('[data-testid="voice-start"]'), false);
    });
  }
}

await step('设置的 feature/provider/key 各自保留其他脏草稿与捕获的 CAS', async () => {
  await page.evaluate(() => window.__openSettings());
  await page.waitForSelector('[data-testid="voice-settings-model"]');
  await page.fill('[data-testid="voice-settings-model"]', 'xiaomi/mimo-edited-asr');
  await page.selectOption('[data-testid="voice-settings-mode"]', 'review');
  await page.click('[data-testid="voice-settings-save-mode"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="voice-settings-notice"]')?.textContent === '已保存。',
  );
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-edited-asr',
  );
  await page.fill('[data-testid="voice-settings-key"]', 'synthetic-key');
  await page.click('[data-testid="voice-settings-save-key"]');
  await page.waitForFunction(() =>
    window.__settingsWrites.some((item) => item.kind === 'credential'),
  );
  assert.equal(await page.inputValue('[data-testid="voice-settings-key"]'), '');
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-edited-asr',
  );
  await page.selectOption('[data-testid="voice-settings-mode"]', 'send');
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(
    () => window.__settingsView.providers[0].settings.modelRef === 'xiaomi/mimo-edited-asr',
  );
  assert.equal(await page.inputValue('[data-testid="voice-settings-mode"]'), 'send');
  await page.fill('[data-testid="voice-settings-model"]', 'xiaomi/mimo-local-asr');
  await page.evaluate(() => {
    const current = window.__settingsView;
    window.__settingsView = {
      ...current,
      feature: { ...current.feature, configRevision: 8 },
      providers: [
        {
          ...current.providers[0],
          configRevision: 20,
          settings: { ...current.providers[0].settings, modelRef: 'xiaomi/mimo-external-asr' },
        },
      ],
    };
    window.__renderSettings();
  });
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="voice-settings-notice"]')?.textContent === '版本冲突',
  );
  assert.equal(
    await page.evaluate(() => window.__settingsWrites.at(-1).command.expectedRevision),
    4,
  );
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-local-asr',
  );
  await page.click('[data-testid="voice-settings-save-mode"]');
  await page.waitForFunction(() => window.__settingsWrites.at(-1).kind === 'feature');
  assert.equal(
    await page.evaluate(() => window.__settingsWrites.at(-1).command.expectedRevision),
    4,
  );
  await page.click('[data-testid="voice-settings-rebase"]');
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-local-asr',
  );
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(
    () => window.__settingsView.providers[0].settings.modelRef === 'xiaomi/mimo-local-asr',
  );
  assert.equal(
    await page.evaluate(() => window.__settingsWrites.at(-1).command.expectedRevision),
    20,
  );
});

await step('880×600 长目录 ID 在对话框内，读取/选择/保存均可达', async () => {
  await page.click('[data-testid="voice-settings-read-catalog"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-settings-candidate"]')?.options.length === 2,
  );
  const widths = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return [
      dialog,
      dialog.querySelector('.pk-dialog__content'),
      dialog.querySelector('.tc-voice-settings'),
    ].map((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  });
  for (const value of widths) assert.ok(value.scroll <= value.client + 1, JSON.stringify(widths));
  await page.selectOption('[data-testid="voice-settings-candidate"]', { index: 1 });
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(() =>
    window.__settingsView.providers[0].settings.modelRef.includes('long-'),
  );
  console.log('  dialog widths:', JSON.stringify(widths));
});

await browser.close();
await new Promise((resolve) => server.close(resolve));
assert.equal(path.dirname(outDir), tmpdir());
assert.ok(path.basename(outDir).startsWith('voice-input-dom-'));
await rm(outDir, { recursive: true });

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;

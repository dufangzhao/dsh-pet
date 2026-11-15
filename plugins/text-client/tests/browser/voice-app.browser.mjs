/**
 * Web App 的语音接线回归（真实 Chromium + 真实 App/CompanionClient/HTTP 夹具）。
 *
 * 验证的是**页面层接线**：真实 App 里语音控件真的在、真的调 `/api/voice/*`、
 * 真的把最终文本走既有消息入口，且打字草稿不被覆盖。音频由受控 transport 夹具
 * 提供（真实浏览器里没有可用的 16k 设备，也不该在这里开麦克风）。
 *
 * 不是 production E2E：没有真实 companion service、没有真实 ASR、没有识别质量。
 *
 * 运行：
 *   node plugins/text-client/tests/browser/voice-app.browser.mjs
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
const streams = new Set();
const voiceCalls = [];
const messages = [];
let finishMode = 'send';
let asrText = '你好';
let asrFailure = null;
let uploads = 0;
/** 已保存的模型：空串代表「还没选」，目录仍然可读。 */
let savedModel = 'xiaomi/mimo-v2.5-asr';
/** 目录失败时给一个真实错误码；null 表示正常返回候选。 */
let catalogFailure = null;
let catalogReads = 0;
/** 第二个提供者：用来证明换提供者后旧候选不会被带过去。 */
let twoProviders = false;

function snapshot() {
  return {
    protocolVersion: 1,
    epoch: 'fixture-epoch',
    cursor: sequence,
    now: Date.now(),
    agent: {
      id: 'agent-1',
      name: '阿蓝',
      profileRevision: 1,
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages: messages.map((message) => ({ ...message })),
    tasks: [],
    facts: [],
    plugins: [],
  };
}

function providerView(ref, label, bindingId, modelRef) {
  return {
    providerRef: ref,
    label,
    synthetic: false,
    source: 'ready',
    configRevision: 5,
    settings: {
      baseUrl: 'http://127.0.0.1:3425/v1',
      modelRef,
      authMode: 'local-client-id',
      protocol: 'mimo-native',
    },
    bindingId,
    credential: {
      available: true,
      writable: false,
      version: '1',
      source: 'local-client-id',
    },
    readiness: modelRef === '' ? 'unconfigured' : 'configured',
    reason: modelRef === '' ? 'model-unconfigured' : null,
  };
}

function voiceView() {
  return {
    version: 1,
    feature: {
      source: 'ready',
      configRevision: 3,
      providerRef: 'pet.asr-magpie/magpie',
      finishMode,
    },
    providers: twoProviders
      ? [
          providerView('pet.asr-magpie/magpie', 'Magpie', 'binding-1', savedModel),
          providerView('pet.asr-alt/alt', 'Alt ASR', 'binding-2', ''),
        ]
      : [providerView('pet.asr-magpie/magpie', 'Magpie', 'binding-1', savedModel)],
  };
}

let ticket = null;
function issueTicket(body) {
  ticket = {
    version: 1,
    captureId: body.captureId,
    clientId: body.clientId,
    agentId: body.agentId,
    serviceEpoch: 'service-epoch',
    bindingId: body.bindingId,
    finishMode: body.finishMode,
    encoding: 'f32le',
    sampleRate: 16000,
    channels: 1,
    chunkSamples: 1600,
    maxSamples: 320000,
    expiresAt: Date.now() + 120000,
  };
  return ticket;
}

function result(over = {}) {
  return {
    ticket,
    phase: 'final',
    samples: 1600,
    cleanup: 'settled',
    outcome: { kind: 'final', text: asrText },
    error: null,
    completedAt: Date.now(),
    ...over,
  };
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function failure(code) {
  return {
    ok: false,
    error: { code, messageKey: `errors.${code}`, retryable: code !== 'invalid-input' },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  if (process.env.VOICE_DEBUG) console.log('REQ', request.method, pathname);

  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(HTML);
    return;
  }
  if (pathname === '/bundle.js' || pathname === '/bundle.css') {
    response.writeHead(200, {
      'content-type': pathname.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : 'text/css; charset=utf-8',
    });
    response.end(pathname.endsWith('.js') ? JS : CSS);
    return;
  }
  if (pathname === '/voice-capture-worklet.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(WORKLET);
    return;
  }

  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    return json(response, 401, failure('auth-failed'));
  }

  if (pathname === '/api/snapshot') return json(response, 200, { ok: true, value: snapshot() });

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

  if (pathname === '/api/voice' && request.method === 'GET') {
    voiceCalls.push('read');
    return json(response, 200, { ok: true, value: voiceView() });
  }

  if (pathname === '/api/voice/settings' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    voiceCalls.push(`settings:${body.finishMode}`);
    finishMode = body.finishMode;
    return json(response, 200, { ok: true, value: voiceView() });
  }

  if (pathname === '/api/voice/provider' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    voiceCalls.push(`provider:${body.settings.modelRef}`);
    savedModel = body.settings.modelRef;
    return json(response, 200, { ok: true, value: voiceView() });
  }

  // 目录只接受已保存绑定的 providerRef/bindingId；别的组合一个候选都不给。
  if (pathname === '/api/voice/catalog' && request.method === 'GET') {
    catalogReads += 1;
    voiceCalls.push(`catalog:${url.searchParams.get('providerRef')}`);
    if (
      url.searchParams.get('providerRef') !== 'pet.asr-magpie/magpie' ||
      url.searchParams.get('bindingId') !== 'binding-1'
    )
      return json(response, 200, failure('conflict'));
    if (catalogFailure !== null) return json(response, 200, failure(catalogFailure));
    return json(response, 200, {
      ok: true,
      value: {
        providerRef: 'pet.asr-magpie/magpie',
        bindingId: 'binding-1',
        candidates: [
          {
            modelRef: 'xiaomi/mimo-v2.5-asr',
            label: 'MiMo ASR',
            role: 'asr',
            classification: 'known-name',
            protocol: 'mimo-native',
            selectable: true,
            reason: null,
          },
          {
            modelRef: 'other/audio-asr-v1',
            label: 'Other ASR',
            role: 'asr',
            classification: 'known-name',
            protocol: null,
            selectable: false,
            reason: 'unsupported-protocol',
          },
        ],
      },
    });
  }

  if (pathname === '/api/voice/captures' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    voiceCalls.push(`begin:${body.finishMode}`);
    return json(response, 201, { ok: true, value: issueTicket(body) });
  }

  if (pathname.endsWith('/audio') && request.method === 'POST') {
    uploads += 1;
    // 真实边界：这里是二进制 f32le，不是 JSON。
    const body = await readBodyBuffer(request);
    voiceCalls.push(`upload:${body.byteLength}`);
    if (asrFailure !== null) return json(response, 200, failure(asrFailure));
    return json(response, 200, { ok: true, value: result({ samples: body.byteLength / 4 }) });
  }

  if (pathname.startsWith('/api/voice/captures/') && request.method === 'GET') {
    voiceCalls.push('recover');
    return json(response, 200, { ok: true, value: result() });
  }

  if (pathname.endsWith('/cancel') && request.method === 'POST') {
    voiceCalls.push('cancel');
    return json(response, 200, { ok: true, value: result({ phase: 'cancelled', outcome: null }) });
  }

  if (pathname === '/api/messages' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    messages.push({
      id: `m${messages.length + 1}`,
      role: 'user',
      text: body.text,
      createdAt: Date.now(),
      inputId: body.commandId,
      taskId: null,
    });
    sequence += 1;
    for (const stream of streams) stream.write('event: refresh\ndata: {}\n\n');
    return json(response, 200, {
      ok: true,
      value: { commandId: body.commandId, status: 'accepted', messageId: null, taskId: null },
    });
  }

  return json(response, 404, failure('not-found'));
});

async function readBody(request) {
  return (await readBodyBuffer(request)).toString('utf8');
}
async function readBodyBuffer(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ 打包真实 App */

const { build } = await import('esbuild');
const outDir = await mkdtemp(path.join(tmpdir(), 'voice-app-dom-'));
await build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { createRoot } from 'react-dom/client';
      import { App } from '${path.join(pluginRoot, 'src/client/app.tsx').replace(/\\/g, '/')}';
      import '${path.join(pluginRoot, 'src/client/styles.css').replace(/\\/g, '/')}';
      import '${path.join(pluginRoot, 'src/client/voice-input.css').replace(/\\/g, '/')}';
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

/**
 * worklet 是**真的那一份**：从 audio-capture 源码 bundle 出来，服务按同源固定
 * 路径托管（与生产 static map 同一个文件名）。不在这里写一个假处理器。
 */
await build({
  entryPoints: [path.join(root, 'plugins/audio-capture/src/capture-worklet.ts')],
  outfile: path.join(outDir, 'worklet.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
});
const WORKLET = await readFile(path.join(outDir, 'worklet.js'), 'utf8');

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
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // 合成音频设备：没有真人麦克风，也不代表识别质量。
    '--use-fake-device-for-media-stream',
    // headless-shell 没有可应答的权限弹窗；这个开关只替代「点允许」这一步。
    // 权限**判定**本身仍走应用自己的 getUserMedia 结果，原生套件才验真实弹窗流程。
    '--use-fake-ui-for-media-stream',
  ],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));

await page.goto(origin);
await page.fill('input[type="password"]', TOKEN);
await page.click('button[type="submit"]');
await page.waitForSelector('[data-testid="voice-input"]', { timeout: 10000 });

/** 这一段证明设备→帧→上传→消息的接线，不证明权限弹窗行为。 */
await step('App 里真的有语音控件，20 秒上限在点之前可读', async () => {
  const hint = await page.textContent('[data-testid="voice-hint"]');
  assert.match(hint ?? '', /20 秒/);
  const describedBy = await page
    .locator('[data-testid="voice-start"]')
    .getAttribute('aria-describedby');
  assert.ok(describedBy);
  assert.ok(await page.$(`#${describedBy}`));
});

await step('语音与打字是两个值：语音入口不动 composer 草稿', async () => {
  await page.fill('#tc-input', '我自己写的话');
  // 语音控件在 composer 之外：它不读写那份草稿。
  const draft = await page.inputValue('#tc-input');
  assert.equal(draft, '我自己写的话');
  assert.equal(await page.locator('#tc-input').count(), 1);
});

await step('合成设备真实走完 开始→帧→结束→上传→一条消息', async () => {
  await page.click('[data-testid="voice-start"]');
  await page
    .waitForSelector('[data-testid="voice-finish"]', { timeout: 15000 })
    .catch(async (e) => {
      console.log('  calls:', JSON.stringify(voiceCalls));
      console.log('  body:', (await page.textContent('body')).slice(0, 400));
      throw e;
    });
  // 等真的出帧：录满上限会自动结束，所以这里主动在出帧后点结束。
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-state"]')?.textContent?.includes('正在录音'),
    undefined,
    { timeout: 15000 },
  );
  await page.waitForTimeout(600); // 让 worklet 至少交出一帧
  await page.click('[data-testid="voice-finish"]');

  await page
    .waitForFunction(() => document.body.textContent.includes('你好'), undefined, {
      timeout: 20000,
    })
    .catch(async (e) => {
      console.log('  calls:', JSON.stringify(voiceCalls));
      console.log('  uploads:', uploads, 'messages:', JSON.stringify(messages));
      console.log(
        '  voice:',
        (await page.textContent('[data-testid="voice-input"]')).slice(0, 300),
      );
      throw e;
    });
  assert.equal(uploads, 1, '只上传一次');
  assert.ok(
    voiceCalls.some((call) => call.startsWith('upload:') && call !== 'upload:0'),
    '有真实音频字节',
  );
  assert.equal(messages.length, 1, '只产生一条消息');
  assert.equal(messages[0].text, '你好');
  // 打字草稿没被语音覆盖，也没有被清空。
  assert.equal(await page.inputValue('#tc-input'), '我自己写的话');
  // 结束之后回到可以再来一次的状态。
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 5000 });
});

await step('取消：不上传、不提交，草稿仍在', async () => {
  const before = { uploads, messages: messages.length };
  await page.click('[data-testid="voice-start"]');
  await page.waitForSelector('[data-testid="voice-cancel"]', { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-state"]')?.textContent?.includes('正在录音'),
    undefined,
    { timeout: 15000 },
  );
  await page.waitForTimeout(300);
  await page.click('[data-testid="voice-cancel"]');
  await page.waitForSelector('[data-testid="voice-start"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  assert.equal(uploads, before.uploads, '取消不上传');
  assert.equal(messages.length, before.messages, '取消不提交');
  assert.ok(voiceCalls.includes('cancel'));
  assert.equal(await page.inputValue('#tc-input'), '我自己写的话');
});

await step('设置里读得到真实视图；保存结束方式会打 /api/voice/settings', async () => {
  await page.click('[data-testid="open-voice-settings"]');
  await page.waitForSelector('[data-testid="voice-settings-model"]', { timeout: 5000 });
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-v2.5-asr',
  );
  // 桌面之外也不该出现密钥输入：视图说 writable=false。
  assert.equal(await page.locator('[data-testid="voice-settings-key"]').count(), 0);
  await page.selectOption('[data-testid="voice-settings-mode"]', 'review');
  await page.click('[data-testid="voice-settings-save-mode"]');
  await page.waitForFunction(() => document.body.textContent.includes('已保存'), undefined, {
    timeout: 5000,
  });
  assert.ok(voiceCalls.includes('settings:review'));
});

await step('读取模型：真实候选、只改草稿、保存后才是新模型', async () => {
  // 这一份视图有两个提供者：下面用它证明换绑定会丢掉旧候选。
  twoProviders = true;
  await page.click('[data-testid="voice-settings-save-mode"]');
  await page.waitForSelector('[data-testid="voice-settings-provider"]', { timeout: 5000 });
  const before = catalogReads;
  await page.click('[data-testid="voice-settings-read-catalog"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="voice-settings-catalog"]')
        ?.textContent?.includes('2 个'),
    undefined,
    { timeout: 5000 },
  );
  assert.equal(catalogReads, before + 1, '读目录只打一次 /api/voice/catalog');
  const options = await page.locator('[data-testid="voice-settings-candidate"] option').all();
  assert.ok(options.length >= 3, '空选项 + 两个候选');
  // 不支持的协议按后端 projector 的话显示，且不可选；不按名字自己判。
  const unsupported = page.locator(
    '[data-testid="voice-settings-candidate"] option[value="other/audio-asr-v1"]',
  );
  assert.equal(await unsupported.isDisabled(), true);
  assert.match((await unsupported.textContent()) ?? '', /不支持该协议/);

  const providerWrites = voiceCalls.filter((call) => call.startsWith('provider:')).length;
  await page.selectOption('[data-testid="voice-settings-candidate"]', 'xiaomi/mimo-v2.5-asr');
  // 选候选只改草稿：还没保存就不该发 provider 请求。
  assert.equal(
    await page.inputValue('[data-testid="voice-settings-model"]'),
    'xiaomi/mimo-v2.5-asr',
  );
  assert.equal(
    voiceCalls.filter((call) => call.startsWith('provider:')).length,
    providerWrites,
    '选择不发请求',
  );
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(() => document.body.textContent.includes('已保存'), undefined, {
    timeout: 5000,
  });
  assert.ok(voiceCalls.includes('provider:xiaomi/mimo-v2.5-asr'), '明确保存才写回');
});

await step('空模型也能读目录：不把「还没选」当成不能发现', async () => {
  savedModel = '';
  // 保存一次空模型，让界面按服务端规范化后的值重铺。
  await page.fill('[data-testid="voice-settings-model"]', '');
  await page.click('[data-testid="voice-settings-save"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="voice-settings-model"]')?.value === '',
    undefined,
    { timeout: 5000 },
  );
  const before = catalogReads;
  await page.click('[data-testid="voice-settings-read-catalog"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="voice-settings-catalog"]')
        ?.textContent?.includes('2 个'),
    undefined,
    { timeout: 5000 },
  );
  assert.equal(catalogReads, before + 1, '空模型仍可读已保存绑定的目录');
});

await step('目录失败不当成空成功，也不保留旧列表', async () => {
  catalogFailure = 'auth-failed';
  await page.click('[data-testid="voice-settings-read-catalog"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="voice-settings-catalog"]')
        ?.textContent?.includes('没有读到目录'),
    undefined,
    { timeout: 5000 },
  );
  const text = await page.textContent('[data-testid="voice-settings-catalog"]');
  assert.match(text ?? '', /没有读到目录/);
  // 旧候选被清掉：选择框回到空选项，不再假装这是当前结果。
  const options = await page.locator('[data-testid="voice-settings-candidate"] option').count();
  assert.equal(options, 1, '失败后没有残留候选');
  catalogFailure = null;
});

await step('有未保存的网关草稿时不能拿新草稿去读目录', async () => {
  const before = catalogReads;
  const button = page.locator('[data-testid="voice-settings-read-catalog"]');
  await page.fill('[data-testid="voice-settings-base-url"]', 'http://127.0.0.1:9999/v1');
  assert.equal(await button.isDisabled(), true, '草稿未保存时读取按钮不可用');
  // 说明写在选择框的可访问描述里，用户读得到为什么点不了。
  const describedBy = await page
    .locator('[data-testid="voice-settings-candidate"]')
    .getAttribute('aria-describedby');
  assert.ok(describedBy);
  assert.match((await page.textContent(`#${describedBy}`)) ?? '', /先保存/);
  // 恢复成已保存的值：按钮重新可用，且刚才一次请求都没发。
  await page.fill('[data-testid="voice-settings-base-url"]', 'http://127.0.0.1:3425/v1');
  assert.equal(await button.isDisabled(), false);
  assert.equal(catalogReads, before, '未保存草稿没有触发任何目录请求');
});

await step('换提供者：旧目录结果不填新提供者的选择框', async () => {
  // 先让服务端真的有两个提供者，再读一次目录，然后切到另一个提供者。
  await page.click('[data-testid="voice-settings-read-catalog"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="voice-settings-catalog"]')
        ?.textContent?.includes('2 个'),
    undefined,
    { timeout: 5000 },
  );
  twoProviders = true;
  // 保存结束方式会触发 voice.reload()，视图随之带上第二个提供者。
  await page.click('[data-testid="voice-settings-save-mode"]');
  await page.waitForSelector('[data-testid="voice-settings-provider"]', { timeout: 5000 });
  await page.selectOption('[data-testid="voice-settings-provider"]', 'pet.asr-alt/alt');
  assert.equal(
    await page.locator('[data-testid="voice-settings-candidate"] option').count(),
    1,
    '换提供者后没有旧候选',
  );
  const text = await page.textContent('[data-testid="voice-settings-catalog"]');
  assert.match(text ?? '', /还没有读取目录/);
  twoProviders = false;
});

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;

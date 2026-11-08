/**
 * 真实 API 浏览器联调（frontend，A–H）。
 *
 * 服务是 parent 启动的真实 companion service；网关是 parent 的受控 HTTP/SSE
 * 协议 peer，**不是真 Magpie/上游模型**。所有断言都通过真实 DOM 输入/点击完成。
 *
 * 运行：
 *   LD_LIBRARY_PATH=<browser libs> FONTCONFIG_FILE=<fonts.conf> \
 *   node qa/probes/companion-model-browser-acceptance.mjs
 *
 * 环境变量：
 *   COMPANION_CONNECTION  必填，连接文件路径
 *   COMPANION_SHOTS       截图目录（默认 qa/screenshots/companion-model）
 *   COMPANION_BROWSER     Chromium 可执行文件
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = process.env.COMPANION_SHOTS ?? path.join(root, 'qa/screenshots/companion-model');

const connectionFile = process.env.COMPANION_CONNECTION;
if (!connectionFile) {
  console.error('COMPANION_CONNECTION must point at the service connection.json');
  process.exit(2);
}

const executablePath =
  process.env.COMPANION_BROWSER ??
  path.join(
    root,
    '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell',
  );

const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
const { url: serviceUrl, token, gatewayBaseUrl, gatewayKey, readonlyUrl } = connection;
const model = connection.model;
const unsupportedModel = connection.unsupportedModel;
const hangingModel = connection.hangingModel;
const statsUrl = connection.statsUrl;
for (const [name, value] of Object.entries({ serviceUrl, token, gatewayBaseUrl, statsUrl })) {
  assert.equal(typeof value, 'string', `${name} missing from connection file`);
  assert.ok(value.length > 0, `${name} empty`);
}

// 每次运行一个随机前缀：commandId 与任务标题都不与历史运行冲突。
const runId = randomUUID().slice(0, 8);

const report = { startedAt: new Date().toISOString(), runId, serviceUrl, checks: [], screenshots: [] };
const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const redact = (value) => String(value).split(token).join('[redacted]').split(gatewayKey).join('[redacted]');

function check(name, detail = {}) {
  report.checks.push({ name, ...detail });
  console.log(`  ok  ${name}`);
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function waitFor(predicate, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** 网关侧计数：这是「是否真的打了上游」的唯一硬证据。 */
async function stats() {
  const response = await fetch(statsUrl);
  assert.equal(response.status, 200);
  return response.json();
}

async function api(route, init = {}, base = serviceUrl) {
  const response = await fetch(base + route, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return { status: response.status, body: await response.json() };
}

async function snapshot() {
  const { status, body } = await api('/api/snapshot');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  return body.value;
}

function assertCjkFont() {
  const result = spawnSync('fc-list', [':lang=zh', 'family'], { encoding: 'utf8' });
  if (result.error !== undefined) throw new Error(`cannot inspect fonts: ${result.error.message}`);
  const families = new Set(
    (result.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (families.size === 0)
    throw new Error('no CJK font available; set FONTCONFIG_FILE to a fontconfig with Noto CJK');
  return [...families].slice(0, 3);
}

/** 页面上可见元素的右边界不得超过视口。 */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [];
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1)
        offenders.push({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(box.left),
          right: Math.round(box.right),
        });
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth,
      offenders: offenders.slice(0, 8),
    };
  });
}

await mkdir(shots, { recursive: true });
const cjkFonts = assertCjkFont();
report.cjkFonts = cjkFonts;
console.log(`中文字体：${cjkFonts.join(', ')}`);
console.log(`runId=${runId}`);

const browser = await chromium.launch({
  executablePath,
  chromiumSandbox: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  acceptDownloads: true,
});

const shot = async (page, name) => {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(path.relative(root, file));
  return file;
};

const footer = (page, label) =>
  page.locator(`.pk-dialog__footer button:has-text("${label}")`).first();
const field = (page, label) =>
  page
    .locator(
      `.pk-field:has(> .pk-field__head label:text-is("${label}")) input, .pk-field:has(> .pk-field__head label:text-is("${label}")) select`,
    )
    .first();

async function openDialog(page) {
  // 判据用 dialog[open]：.tc-model 在重渲染的瞬间可能还没挂上，
  // 那时去点页头按钮会被刚打开的同名对话框拦住。
  if ((await page.locator('dialog[open]').count()) === 0) {
    await page.click('header .tc-head__actions button:has-text("模型")');
  }
  await page.waitForSelector('dialog[open] .tc-model', { timeout: 15_000 });
}

async function closeDialog(page) {
  if ((await page.locator('dialog[open]').count()) === 0) return;
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10_000 });
}

/** 用键盘输入令牌连接；token 只进请求头。 */
async function connect(page, base = serviceUrl) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#tc-token').waitFor({ state: 'visible' });
  await page.locator('#tc-token').click();
  await page.keyboard.type(token, { delay: 1 });
  await page.keyboard.press('Enter');
  await page.locator('.tc-chat').waitFor({ timeout: 30_000 });
  await waitFor(
    async () => (await page.locator('.tc-conn').innerText()).includes('已连接'),
    'never reached live',
    30_000,
  );
}

/** COMPANION_ONLY=J 只跑指定段（逗号分隔），便于小步重跑。 */
const only = (process.env.COMPANION_ONLY ?? '')
  .split(',')
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const want = (segment) => only.length === 0 || only.includes(segment);
const skip = (segment) => {
  if (want(segment)) return false;
  console.log(`  --  ${segment} skipped (COMPANION_ONLY=${only.join(',')})`);
  return true;
};

const tryCatch = async (name, body) => {
  try {
    await body();
  } catch (error) {
    report.checks.push({ name, failed: redact(error.message) });
    console.error(`  FAIL ${name}: ${redact(error.message)}`);
    throw error;
  }
};

try {
  const page = await context.newPage();
  page.on('pageerror', (error) => diagnostics.pageErrors.push(redact(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(redact(message.text()));
  });
  page.on('requestfailed', (request) =>
    diagnostics.failedRequests.push(redact(`${request.method()} ${request.url()}`)),
  );

  // ---- A. 初始无配置 ----
  if (!skip('A')) await tryCatch('A 初始无配置', async () => {
    console.log('\nA. 初始无配置');
    const before = await stats();
    report.statsBaseline = before.calls.length;
    await connect(page);
    const view = (await api('/api/model')).body.value;
    assert.equal(view.desired.mode, 'scripted');
    assert.equal(view.applied, null);
    assert.equal(view.enabled, false);
    assert.equal(view.check.state, 'unconfigured');
    check('初始 view 是 scripted + 未应用 + 未测试', {
      mode: view.desired.mode,
      applied: view.applied,
      check: view.check.state,
    });

    await page.click('header .tc-head__actions button:has-text("模型")');
    await page.waitForSelector('dialog[open] .tc-model');
    const summary = await page.locator('.tc-model__summary').innerText();
    assert.match(summary, /脚本回复/);
    assert.doesNotMatch(summary, /已就绪|已应用/);
    const options = await page.locator('.pk-field select').first().locator('option').allInnerTexts();
    assert.equal(options.length >= 2, true);
    check('对话框摘要说明脚本模式，连接列表含多个连接', { summary, options });
    await shot(page, 'a-initial-dialog');
  });

  // ---- B. 保存零调用 ----
  if (!skip('B')) await tryCatch('B 保存零模型请求', async () => {
    console.log('\nB. 保存并应用（scripted）');
    const before = await stats();
    await field(page, '接口地址').fill(gatewayBaseUrl);
    await field(page, '模型').fill(model);
    await field(page, '鉴权方式').selectOption('gateway-key');
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(800);

    const after = await stats();
    assert.equal(after.calls.length, before.calls.length, 'save must not call the gateway');
    const view = (await api('/api/model')).body.value;
    assert.equal(view.desired.mode, 'scripted');
    const magpie = view.connectors.find((item) => !item.synthetic);
    assert.equal(magpie.settings.baseUrl, gatewayBaseUrl);
    assert.equal(magpie.credential.required, true);
    assert.equal(magpie.credential.writable, true);
    check('保存只写配置：网关 0 调用，配置已生效、密钥必填且可写', {
      callsDelta: after.calls.length - before.calls.length,
      baseUrl: magpie.settings.baseUrl,
    });
    await shot(page, 'b-saved-scripted');
  });

  // ---- C. 只填密钥可提交（key-only）----
  if (!skip('C')) await tryCatch('C key-only', async () => {
    console.log('\nC. 只填密钥');
    const before = await stats();
    const keyInput = page.locator('.tc-model__key input[type=password]');
    await keyInput.fill(gatewayKey);
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(800);
    assert.equal(await keyInput.inputValue(), '');
    const after = await stats();
    assert.equal(after.calls.length, before.calls.length);
    const view = (await api('/api/model')).body.value;
    const magpie = view.connectors.find((item) => !item.synthetic);
    assert.equal(magpie.credential.available, true);
    assert.equal(magpie.credential.source, 'memory');
    check('key-only 只写密钥、输入立即清空、网关 0 调用', {
      source: magpie.credential.source,
      cleared: true,
    });
  });

  // ---- D. 真实 test：恰好一次上游请求 ----
  if (!skip('D')) await tryCatch('D 真实测试计数', async () => {
    console.log('\nD. 测试连接');
    await field(page, '服务模式').selectOption('model');
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(800);
    const applied = (await api('/api/model')).body.value.applied;
    assert.notEqual(applied, null, 'mode switch must apply');

    const before = await stats();
    await footer(page, '测试连接').click();
    await waitFor(
      async () => (await api('/api/model')).body.value.check.state === 'verified',
      'the check never settled',
      40_000,
    );
    const after = await stats();
    const view = (await api('/api/model')).body.value;
    assert.equal(view.check.evidence, 'network');
    assert.equal(after.calls.length - before.calls.length, 1, 'exactly one gateway request');
    assert.equal(after.calls.at(-1).model, model);
    assert.equal(after.calls.at(-1).stream, true);
    check('测试真实走 HTTP/SSE，恰好 1 次 peer 请求，evidence=network', {
      callsDelta: after.calls.length - before.calls.length,
      call: after.calls.at(-1),
      elapsedMs: view.check.elapsedMs,
    });
    await shot(page, 'd-verified-network');
  });

  // ---- E. 同 commandId 不重发 ----
  if (!skip('E')) await tryCatch('E 同 ID 不重发', async () => {
    console.log('\nE. 同 commandId 不重发');
    const view = (await api('/api/model')).body.value;
    const applied = view.applied;
    const before = await stats();
    const commandId = `${runId}-dup-test`;
    const first = await api('/api/model/test', {
      method: 'POST',
      body: JSON.stringify({
        commandId,
        connectorId: applied.connectorId,
        expectedConfigRevision: applied.configRevision,
        expectedCredentialVersion: applied.credentialVersion,
      }),
    });
    assert.equal(first.status, 202);
    await waitFor(
      async () => (await api('/api/model')).body.value.check.state !== 'validating',
      'the check never settled',
      40_000,
    );
    const second = await api('/api/model/test', {
      method: 'POST',
      body: JSON.stringify({
        commandId,
        connectorId: applied.connectorId,
        expectedConfigRevision: applied.configRevision,
        expectedCredentialVersion: applied.credentialVersion,
      }),
    });
    assert.equal(second.body.value.receipt.status, 'duplicate');
    await page.waitForTimeout(1_000);
    const after = await stats();
    assert.equal(after.calls.length - before.calls.length, 1, 'duplicate must not resend');
    check('同一 commandId 的第二次测试是 duplicate，网关仍只有 1 次', {
      receipt: second.body.value.receipt.status,
      callsDelta: after.calls.length - before.calls.length,
    });
  });

  // ---- F. 错误模型 / 挂起模型 ----
  if (!skip('F')) await tryCatch('F 错误模型与挂起模型', async () => {
    console.log('\nF. 错误模型 / 挂起模型');
    // 错误模型：网关 400 → check failed / unavailable，界面不谎报通过。
    let view = (await api('/api/model')).body.value;
    let magpie = view.connectors.find((item) => !item.synthetic);
    await api('/api/model', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-save-err`,
        expectedProfileRevision: view.profileRevision,
        connectorId: magpie.id,
        expectedConfigRevision: magpie.configRevision,
        mode: 'model',
        config: { baseUrl: gatewayBaseUrl, model: unsupportedModel, authMode: 'gateway-key' },
      }),
    });
    view = (await api('/api/model')).body.value;
    magpie = view.connectors.find((item) => !item.synthetic);
    const failedTest = await api('/api/model/test', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-test-err`,
        connectorId: magpie.id,
        expectedConfigRevision: magpie.configRevision,
        expectedCredentialVersion: magpie.credential.version,
      }),
    });
    assert.equal(failedTest.status, 202, JSON.stringify(failedTest.body));
    await waitFor(
      async () => (await api('/api/model')).body.value.check.state === 'failed',
      'the failing check never settled',
      40_000,
    );
    view = (await api('/api/model')).body.value;
    assert.notEqual(view.check.error, null);
    check('错误模型得到 failed + 固定错误码，不谎报通过', {
      code: view.check.error.code,
    });

    // 挂起模型：15s 服务端期限 → timeout，界面如实说超时。
    view = (await api('/api/model')).body.value;
    magpie = view.connectors.find((item) => !item.synthetic);
    await api('/api/model', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-save-hang`,
        expectedProfileRevision: view.profileRevision,
        connectorId: magpie.id,
        expectedConfigRevision: magpie.configRevision,
        mode: 'model',
        config: { baseUrl: gatewayBaseUrl, model: hangingModel, authMode: 'gateway-key' },
      }),
    });
    view = (await api('/api/model')).body.value;
    magpie = view.connectors.find((item) => !item.synthetic);
    const started = Date.now();
    const hang = await api('/api/model/test', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-test-hang`,
        connectorId: magpie.id,
        expectedConfigRevision: magpie.configRevision,
        expectedCredentialVersion: magpie.credential.version,
      }),
    });
    assert.equal(hang.status, 202, JSON.stringify(hang.body));
    await waitFor(
      async () => (await api('/api/model')).body.value.check.state === 'failed',
      'the hanging check never settled',
      60_000,
    );
    const elapsed = Date.now() - started;
    view = (await api('/api/model')).body.value;
    assert.equal(view.check.error.code, 'timeout');
    check('挂起模型按服务端 15s 期限超时，未被无限等待', {
      code: view.check.error.code,
      elapsedMs: view.check.elapsedMs,
      wallClockMs: elapsed,
    });

    // 恢复成可用的 loopback-ok，供后续聊天段使用。
    view = (await api('/api/model')).body.value;
    magpie = view.connectors.find((item) => !item.synthetic);
    await api('/api/model', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-save-ok`,
        expectedProfileRevision: view.profileRevision,
        connectorId: magpie.id,
        expectedConfigRevision: magpie.configRevision,
        mode: 'model',
        config: { baseUrl: gatewayBaseUrl, model, authMode: 'gateway-key' },
      }),
    });
  });

  // ---- G. synthetic 标记 ----
  if (!skip('G')) await tryCatch('G synthetic 标记', async () => {
    console.log('\nG. synthetic 连接');
    await closeDialog(page);
    const view = (await api('/api/model')).body.value;
    const fixture = view.connectors.find((item) => item.synthetic);
    assert.notEqual(fixture, undefined);
    const saved = await api('/api/model', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-save-fixture`,
        expectedProfileRevision: view.profileRevision,
        connectorId: fixture.id,
        expectedConfigRevision: fixture.configRevision,
        mode: 'model',
      }),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const applied = (await api('/api/model')).body.value.applied;
    const admitted = await api('/api/model/test', {
      method: 'POST',
      body: JSON.stringify({
        commandId: `${runId}-test-fixture`,
        connectorId: applied.connectorId,
        expectedConfigRevision: applied.configRevision,
        expectedCredentialVersion: applied.credentialVersion,
      }),
    });
    assert.equal(admitted.status, 202, JSON.stringify(admitted.body));
    await waitFor(
      async () => (await api('/api/model')).body.value.check.state === 'verified',
      'the synthetic check never settled',
      40_000,
    );
    const checked = (await api('/api/model')).body.value.check;
    assert.equal(checked.evidence, 'synthetic');

    // 界面上必须写「模拟」，不能只说测试通过。
    await openDialog(page);
    await waitFor(
      async () => (await page.locator('.tc-model__check').innerText()).includes('模拟'),
      'the dialog never showed the synthetic label',
      20_000,
    );
    const line = await page.locator('.tc-model__check').innerText();
    assert.match(line, /模拟检查通过，未连接真实模型/);
    check('synthetic 结论明确标注未连接真实模型', { line });
    await shot(page, 'g-synthetic');
  });

  // ---- H. 只读入口 ----
  if (!skip('H')) await tryCatch('H 只读入口', async () => {
    console.log('\nH. 只读入口');
    await closeDialog(page);
    const view = (await api('/api/model')).body.value;
    const magpie = view.connectors.find((item) => !item.synthetic);
    // 只读入口：能读、能配置，但凭据不可写且写入 403。
    const readonlyView = await api('/api/model', {}, readonlyUrl);
    assert.equal(readonlyView.status, 200);
    const readonlyMagpie = readonlyView.body.value.connectors.find((item) => !item.synthetic);
    assert.equal(readonlyMagpie.credential.writable, false);
    const rejected = await api(
      '/api/model/credential',
      {
        method: 'POST',
        body: JSON.stringify({
          connectorId: readonlyMagpie.id,
          expectedConfigRevision: readonlyMagpie.configRevision,
          expectedCredentialVersion: readonlyMagpie.credential.version,
          apiKey: null,
        }),
      },
      readonlyUrl,
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error.code, 'permission-denied');
    check('只读入口可读、凭据不可写、写入 403', {
      writable: readonlyMagpie.credential.writable,
      status: rejected.status,
    });

    // 真实浏览器：只读入口的界面不提供密码框。
    const readonlyPage = await context.newPage();
    readonlyPage.on('pageerror', (error) => diagnostics.pageErrors.push(redact(error.message)));
    await connect(readonlyPage, readonlyUrl);
    await openDialog(readonlyPage);
    // 上一步可能停在 synthetic 连接上（settings=null）；先选回 Magpie，
    // 才能验「需要密钥但入口不可写」这条路径。
    await readonlyPage
      .locator('.pk-field select')
      .first()
      .selectOption(magpie.id);
    await readonlyPage.waitForTimeout(400);
    await waitFor(
      async () => (await readonlyPage.locator('.tc-model__key input').count()) === 0,
      'the readonly ingress still offered a key input',
      20_000,
    );
    assert.equal(await readonlyPage.locator('.tc-model__key input[type=password]').count(), 0);
    // 凭据说明是对话框里的某一段，不是固定第一段（草稿提示可能排在前面）。
    const dialogText = await readonlyPage.locator('dialog[open] .tc-model').innerText();
    assert.match(dialogText, /不允许在这里写密钥/);
    assert.match(dialogText, /宿主/);
    check('只读入口界面不出现密钥输入框，只给宿主注入说明', {
      matched: '不允许在这里写密钥',
    });
    await shot(readonlyPage, 'h-readonly-ingress');
    await readonlyPage.close();
    assert.equal(magpie.credential.writable, true);
  });

  // ---- I. 模型模式聊天 + start_work ----
  if (!skip('I')) await tryCatch('I 模型聊天与任务', async () => {
    console.log('\nI. 模型模式聊天');
    await closeDialog(page);
    // G 段切到 synthetic 时服务端已按设计回收 Magpie 的密钥；这里重新填。
    const view = (await api('/api/model')).body.value;
    const magpie = view.connectors.find((item) => !item.synthetic);
    await openDialog(page);
    await page.locator('.pk-field select').first().selectOption(magpie.id);
    await page.waitForTimeout(300);
    await field(page, '服务模式').selectOption('model');
    await field(page, '接口地址').fill(gatewayBaseUrl);
    await field(page, '模型').fill(model);
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(700);
    await page.locator('.tc-model__key input[type=password]').fill(gatewayKey);
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(800);
    // 保存 + 写密钥是两次独立 CAS；等权威快照把绑定与启用状态落定再断言。
    await waitFor(
      async () => {
        const current = (await api('/api/model')).body.value;
        return current.applied !== null && current.enabled;
      },
      'the model binding never became applied+enabled',
      30_000,
    );
    await closeDialog(page);

    // 普通聊天：peer 明确标注是回环、不是真实模型。
    const composer = page.locator('#tc-input');
    const beforeCalls = (await stats()).calls.length;
    // 历史消息会保留：必须等**新增**的那条回复，否则会立刻拿旧消息通过。
    const baseReplies = await page.locator('.tc-msg--assistant').count();
    await composer.click();
    await page.keyboard.type(`${runId} 请简短回复一句`);
    await page.keyboard.press('Enter');
    await waitFor(
      async () => (await page.locator('.tc-msg--assistant').count()) > baseReplies,
      'no new assistant reply arrived',
      60_000,
    );
    const lastReply = await page.locator('.tc-msg--assistant .tc-msg__text').last().innerText();
    assert.match(lastReply, /回环|未真实模型/);
    const chatCalls = (await stats()).calls.length - beforeCalls;
    assert.equal(chatCalls >= 1, true);
    check('模型模式聊天拿到 peer 回复，文本明确标注回环未真实模型', {
      calls: chatCalls,
      reply: lastReply.slice(0, 60),
    });
    await shot(page, 'i-model-chat');

    // 「联调报表」触发 peer 按真实 ingress envelope 发 start_work。
    const beforeTasks = (await snapshot()).tasks.length;
    const agentBefore = (await snapshot()).agent;
    await composer.click();
    await page.keyboard.type(`${runId} 联调报表`);
    await page.keyboard.press('Enter');
    await waitFor(
      async () => (await snapshot()).tasks.length > beforeTasks,
      'no task was created by the peer',
      90_000,
    );
    const created = await snapshot();
    const task = created.tasks[0];
    report.task = { id: task.id, title: task.title };
    check('peer 按 ingress envelope 创建了任务', { id: task.id, title: task.title });
    await waitFor(
      async () => {
        const list = (await snapshot()).tasks;
        const one = list.find((item) => item.id === task.id);
        return one && ['completed', 'failed', 'cancelled', 'interrupted'].includes(one.status);
      },
      'the task never settled',
      180_000,
    );
    const settled = (await snapshot()).tasks.find((item) => item.id === task.id);
    assert.equal(settled.status, 'completed', JSON.stringify(settled));
    assert.equal(settled.exitCode, 0);
    const names = settled.artifacts.map((item) => item.name).sort();
    assert.deepEqual(names, ['items.csv', 'summary.md']);
    check('任务成功，产物恰为 summary.md 与 items.csv', { names, exitCode: settled.exitCode });

    // 下载两份产物，核对字节。
    const downloaded = {};
    for (const artifact of settled.artifacts) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.locator(`.tc-task__artifacts button:has-text("${artifact.name}")`).click(),
      ]);
      const file = await download.path();
      const bytes = await readFile(file);
      downloaded[artifact.name] = { bytes, sha: sha256(bytes) };
    }
    const summary = downloaded['summary.md'].bytes.toString('utf8');
    assert.match(summary, /25/);
    const csv = downloaded['items.csv'].bytes.toString('utf8').trim().split('\n');
    assert.equal(csv.length >= 4, true);
    const total = csv
      .slice(1)
      .map((line) => Number(line.split(',')[1]))
      .reduce((sum, value) => sum + value, 0);
    assert.equal(total, 25);
    check('下载产物字节正确：summary.md 含总计 25，items.csv 合计 25', {
      summarySha: downloaded['summary.md'].sha.slice(0, 12),
      csvSha: downloaded['items.csv'].sha.slice(0, 12),
      total,
    });
    await shot(page, 'i-task-artifacts');

    // 切回脚本再切回模型：identity 与任务、产物不变。
    await openDialog(page);
    await field(page, '服务模式').selectOption('scripted');
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(900);
    await field(page, '服务模式').selectOption('model');
    await footer(page, '保存并应用').click();
    await page.waitForTimeout(900);
    await closeDialog(page);

    const afterSwitch = await snapshot();
    assert.equal(afterSwitch.agent.id, agentBefore.id);
    assert.equal(afterSwitch.agent.name, agentBefore.name);
    const stillThere = afterSwitch.tasks.find((item) => item.id === task.id);
    assert.equal(stillThere.status, 'completed');
    assert.deepEqual(
      stillThere.artifacts.map((item) => item.name).sort(),
      ['items.csv', 'summary.md'],
    );
    check('模式来回切换后 agent identity、任务与产物都保留', {
      agentId: afterSwitch.agent.id,
      taskStatus: stillThere.status,
    });
    report.artifacts = Object.fromEntries(
      Object.entries(downloaded).map(([name, value]) => [name, value.sha]),
    );
  });

  // ---- K. 关闭状态不遮挡 ----
  await tryCatch('K 关闭状态不遮挡', async () => {
    console.log('\nK. 关闭状态');
    await closeDialog(page);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      // 关闭态必须是 display:none 且没有可测量的盒子。
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
      assert.equal(closed.display, 'none');
      assert.equal(closed.width, 0);
      assert.equal(closed.height, 0);
      // 关闭后页面上真正要用的东西必须能命中（不做 force 点击）。
      const reachable = await page.evaluate(() => {
        const targets = {
          模型按钮: 'header .tc-head__actions button',
          输入框: '#tc-input',
          任务条: '.tc-tasks',
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
      assert.equal(reachable.模型按钮, 'reachable', JSON.stringify(reachable));
      assert.equal(reachable.输入框, 'reachable', JSON.stringify(reachable));

      // 真点一次：打开对话框再关掉，输入框仍然可用。
      await openDialog(page);
      await closeDialog(page);
      await page.locator('#tc-input').click({ timeout: 5_000 });
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'tc-input');
      check(`关闭态 ${viewport.width}px：display:none、无盒子、输入与模型按钮可真实点击`, {
        viewport,
        closed,
        reachable,
      });
    }
    await shot(page, 'k-closed-state');
  });

  // ---- J. 390px 键盘 ----
  if (!skip('J')) await tryCatch('J 390px 键盘', async () => {
    console.log('\nJ. 390px');
    // 单独重跑 J 时页面可能还停在门禁或别的视口：先确保已连接。
    if ((await page.locator('.tc-chat').count()) === 0) await connect(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const wide = await overflow(page);
    assert.deepEqual(wide.offenders, []);
    await openDialog(page);
    const primary = footer(page, '保存并应用');
    const box = await primary.boundingBox();
    assert.notEqual(box, null);
    assert.ok(box.y + box.height <= 844, `footer outside viewport: ${JSON.stringify(box)}`);
    const hit = await page.evaluate(
      ({ x, y }) => {
        const node = document.elementFromPoint(x, y);
        return node?.closest('button')?.textContent ?? 'none';
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    assert.match(String(hit), /保存并应用/);
    check('390px 下对话框按钮在视口内且可命中', { hit: String(hit) });

    // Tab 走一遍：每个可聚焦元素都要有可见焦点环。
    await page.locator('.tc-model__summary').click();
    const rings = [];
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return null;
        const style = getComputedStyle(active);
        return {
          tag: active.tagName,
          name: active.getAttribute('aria-label') ?? active.textContent?.slice(0, 12) ?? '',
          outline: `${style.outlineWidth} ${style.outlineStyle}`,
          shadow: style.boxShadow !== 'none',
        };
      });
      rings.push(ring);
    }
    const withoutRing = rings.filter(
      (ring) => ring === null || (ring.outline.startsWith('0px') && !ring.shadow),
    );
    assert.deepEqual(withoutRing, []);
    check('键盘 Tab 顺序下每个焦点都有可见焦点环', { count: rings.length });
    await shot(page, 'j-390-keyboard');
  });

  report.diagnostics = diagnostics;
  assert.deepEqual(diagnostics.pageErrors, []);
  check('无未捕获页面错误', { pageErrors: diagnostics.pageErrors.length });
} finally {
  await context.close();
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(root, 'qa/screenshots/companion-model/report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(`\n${report.checks.length} checks passed (real service + controlled protocol peer)`);

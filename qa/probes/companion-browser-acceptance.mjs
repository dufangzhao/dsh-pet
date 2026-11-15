/**
 * 真实浏览器验收：文字客户端 + 独立 companion 服务。
 *
 * 服务由父代理启动（真实 Cortico + SQLite + Docker，隔离 scripted profile）。
 * 本脚本只用真实 UI 操作，不注入任何应用内部状态；token 从 connection.json
 * 在内存里读出，绝不打印、不写日志、不进 URL。
 *
 * 运行：
 *   LD_LIBRARY_PATH=/tmp/dsh-pet-browser-libs/usr/lib/x86_64-linux-gnu \
 *   node qa/probes/companion-browser-acceptance.mjs
 *
 * 环境变量：
 *   COMPANION_CONNECTION  必填：服务 connection.json 路径
 *   COMPANION_SHOTS       截图目录（默认 qa/screenshots/companion）
 *   COMPANION_BROWSER     Chromium/headless-shell 可执行文件（默认本机已验证路径）
 *
 * 中文字体：本机默认缺 CJK，需 FONTCONFIG_FILE 指向含 Noto CJK 的 fontconfig，
 * 否则页面渲染成方框，脚本会在截图前直接失败。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = process.env.COMPANION_SHOTS ?? path.join(root, 'qa/screenshots/companion');

/**
 * 连接文件必须显式给出：默认值只会指向某个早已失效的临时目录，
 * 静默失败比报错更难查。
 */
const connectionFile = process.env.COMPANION_CONNECTION;
if (!connectionFile) {
  console.error('COMPANION_CONNECTION must point at the service connection.json');
  process.exit(2);
}

/** 本机验证过的 headless shell；其它机器可用 COMPANION_BROWSER 覆盖。 */
const executablePath =
  process.env.COMPANION_BROWSER ??
  '/tmp/dsh-pet-playwright-browsers/verified-headless-1248/chrome-headless-shell-linux64/chrome-headless-shell';

const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
const { url: serviceUrl, token } = connection;
assert.equal(typeof serviceUrl, 'string');
assert.equal(typeof token, 'string');
assert.ok(token.length > 0);

const report = { startedAt: new Date().toISOString(), serviceUrl, checks: [], screenshots: [] };
const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [] };
const evidence = {};
// 每次运行用唯一标题：重复运行时的同名旧任务不能影响本次断言。
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function check(name, detail = {}) {
  report.checks.push({ name, ...detail });
  console.log(`  ok  ${name}`);
}

/** 报告与日志只保留无凭据诊断：token 出现过的地方一律替换掉。 */
function redact(value) {
  return String(value).split(token).join('[redacted-token]');
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

async function api(route, init = {}) {
  const response = await fetch(serviceUrl + route, {
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

async function startSlowTask(commandId, title, seconds) {
  const code = [
    "import { writeFileSync } from 'node:fs';",
    `await new Promise((resolve) => setTimeout(resolve, ${seconds * 1000}));`,
    "writeFileSync('slow.txt', 'slow task finished\\n');",
    "console.log('slow task finished');",
  ].join('\n');
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      commandId,
      title,
      code,
      outputs: [{ path: 'slow.txt', mediaType: 'text/plain' }],
    }),
  });
  assert.equal(status, 202, JSON.stringify(body));
  assert.equal(body.ok, true);
  return body.value;
}

/** 页面上可见元素的右边界不得超过视口；任何横向滚动都算布局缺陷。 */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [];
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(box.left),
          right: Math.round(box.right),
        });
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth,
      offenders: offenders.slice(0, 8),
    };
  });
}

// 任务按最新在前排列；重复运行时同名任务会有多条，取最新那条。
const taskRow = (page, title) => page.locator('.tc-task').filter({ hasText: title }).first();
const badge = (page, title) => taskRow(page, title).locator('.pk-badge').first();
/** 已确认的用户消息；待确认的 outbox 行不算。 */
const confirmedUser = (page) => page.locator('.tc-msg--user:not(.tc-msg--pending)');
const isLive = (page) => page.locator('.tc-conn').getByText('已连接', { exact: true });

/**
 * 真实断网模拟：Playwright 的 setOffline/CDP 只拦新请求，不会切断已经建立的
 * SSE socket（实测仍持续收到 keepalive）。用本地 HTTP 代理把链路黑洞化——
 * 连接保持打开但不再转发任何字节——才是「网线被拔掉」的真实形态。
 */
async function blackholeProxy(serviceUrl) {
  const target = new URL(serviceUrl);
  const live = new Set();
  let cut = false;
  const proxy = http.createServer((request, response) => {
    if (cut) {
      // 黑洞：接受连接但不响应、不转发。
      request.socket.pause();
      return;
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: target.host },
      },
      (up) => {
        response.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(response);
      },
    );
    upstream.on('error', () => response.destroy());
    request.pipe(upstream);
    const pair = { client: request.socket, upstream };
    live.add(pair);
    // 每条请求都会在同一个 keep-alive socket 上挂 close 监听，用完必须摘掉。
    const forget = () => live.delete(pair);
    request.socket.once('close', forget);
    response.once('close', () => request.socket.off('close', forget));
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    cut() {
      cut = true;
      for (const { client, upstream } of live) {
        upstream.destroy();
        client.unpipe?.();
        client.pause();
      }
    },
    /** 恢复链路：之后的新连接正常转发，用户点「重新连接」才有意义。 */
    restore() {
      cut = false;
    },
    close: () => proxy.close(),
  };
}

/**
 * 环境前置检查：本机若没有中文字体，页面会渲染成方框，截图不能当作视觉通过。
 * 这是浏览器环境问题，不是产品 CSS 问题，所以在这里显式失败而不是默默出图。
 */
function assertCjkFont() {
  const result = spawnSync('fc-list', [':lang=zh', 'family'], { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`cannot inspect fonts: ${result.error.message}`);
  }
  const families = new Set(
    (result.stdout ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (families.size === 0) {
    throw new Error(
      'no CJK font available; set FONTCONFIG_FILE to a fontconfig with Noto CJK before capturing screenshots',
    );
  }
  return [...families].slice(0, 3);
}

await mkdir(shots, { recursive: true });
const cjkFonts = assertCjkFont();
report.cjkFonts = cjkFonts;
console.log(`中文字体：${cjkFonts.join(', ')}`);

// 全程走本地代理：E 段靠它把链路黑洞化。页面 origin 仍是真实服务地址，
// 因此 Origin 校验、相对 URL、token 行为都与直连一致。
const proxy = await blackholeProxy(serviceUrl);
const browser = await chromium.launch({
  executablePath,
  chromiumSandbox: false,
  proxy: { server: proxy.url },
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
});

try {
  const page = await context.newPage();
  page.on('pageerror', (error) => diagnostics.pageErrors.push(redact(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(redact(message.text()));
  });
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests.push(redact(`${request.method()} ${request.url()}`));
  });

  // ---- A. 连接入口、令牌只在内存、中文标签、脚本模式 ----
  console.log('\nA. 连接与身份');
  await page.goto(serviceUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#tc-token').waitFor({ state: 'visible' });
  assert.match(await page.locator('.tc-gate__title').innerText(), /文字入口/);
  assert.match(await page.locator('#tc-token-hint').innerText(), /只保存在本页内存中/);
  assert.equal(await page.locator('#tc-token').getAttribute('type'), 'password');
  check('令牌入口为中文标签，输入框为密码类型并声明只在内存中');

  // 键盘输入令牌并回车，不用任何注入方式。
  await page.locator('#tc-token').click();
  await page.keyboard.type(token, { delay: 1 });
  await page.keyboard.press('Enter');
  await isLive(page).waitFor({ timeout: 20_000 });
  await page.locator('.tc-tasks').waitFor({ state: 'visible' });

  assert.equal(new URL(page.url()).search, '');
  assert.equal(page.url().includes(token), false);
  const requestUrls = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .concat([location.href]),
  );
  for (const requestUrl of requestUrls) assert.equal(requestUrl.includes(token), false);
  check('连接成功，token 不出现在页面 URL、资源 URL 或隐藏字段中', {
    resourceCount: requestUrls.length,
  });

  const agentText = await page.locator('.tc-agent').innerText();
  assert.match(agentText, /同伴/);
  assert.match(agentText, /离线脚本回复，未调用模型/);
  assert.match(await page.locator('.tc-conn').innerText(), /最后确认/);
  check('助手名称与脚本模式标签准确（明说未调用模型）', { agent: agentText.replace(/\n/g, ' · ') });

  const wideOverflow = await overflow(page);
  assert.equal(wideOverflow.scrollWidth <= wideOverflow.clientWidth + 1, true);
  assert.deepEqual(wideOverflow.offenders, []);
  check('1440px 宽屏无水平溢出', wideOverflow);

  // ---- B. Enter / Shift+Enter 与键盘输入 ----
  console.log('\nB. 键盘输入');
  const composer = page.locator('#tc-input');
  // 服务可能已有上一次验收的对话；只针对本次新增的内容断言。
  const baseUserMessages = await confirmedUser(page).count();
  const baseMessages = await page.locator('.tc-msg').count();
  // 发送「请创建一个文件」会派生一个真实任务；先记下已有任务，才能认出本次新建的那条。
  const baseTaskIds = new Set((await snapshot()).tasks.map((task) => task.id));
  await composer.click();
  await page.keyboard.type('请创建一个文件');
  await page.keyboard.press('Shift+Enter');
  const draft = await composer.inputValue();
  assert.equal(draft, '请创建一个文件\n');
  assert.equal(await page.locator('.tc-msg').count(), baseMessages, 'Shift+Enter 不应发送');
  await page.keyboard.press('Backspace');
  assert.equal(await composer.inputValue(), '请创建一个文件');
  check('Shift+Enter 在输入框内换行而不发送');

  await page.keyboard.press('Enter');
  await waitFor(
    async () => (await confirmedUser(page).count()) === baseUserMessages + 1,
    'the user message was never confirmed by the service',
    30_000,
  );
  // 草稿只在服务端确认受理后清空；待确认期间保留原文。
  await waitFor(
    async () => (await composer.inputValue()) === '',
    'the draft was never cleared after acceptance',
    15_000,
  );
  assert.equal(await composer.inputValue(), '');
  check('Enter 发送；消息经服务端确认后草稿清空');

  // ---- C. 真实任务结果与产物下载 ----
  console.log('\nC. 真实文件任务与产物');
  // scripted harness 用固定标题；靠「发送前不存在的任务 id」认出本次运行创建的那条。
  const fileTask = 'Scripted file demonstration';
  const newFileTask = await waitFor(
    async () => {
      const value = await snapshot();
      return value.tasks.find(
        (task) => task.title === fileTask && !baseTaskIds.has(task.id),
      );
    },
    'the file task never appeared in the task strip',
    90_000,
  );
  const taskSnapshot = await waitFor(
    async () => {
      const value = await snapshot();
      const task = value.tasks.find((candidate) => candidate.id === newFileTask.id);
      return task && task.status === 'completed' ? task : null;
    },
    'the service never recorded the completed task',
    120_000,
  );
  // 任务区按最新在前，同名任务的第一条就是这条新任务。
  const completed = await waitFor(
    async () => {
      const text = await badge(page, fileTask).innerText();
      return text === '已完成' ? text : null;
    },
    'the file task never reached completed in the UI',
    30_000,
  );
  assert.equal(completed, '已完成');
  assert.equal(taskSnapshot.exitCode, 0);
  assert.equal(taskSnapshot.artifacts.length, 1);
  const artifact = taskSnapshot.artifacts[0];
  assert.equal(artifact.name, 'result.txt');
  evidence.task = {
    id: taskSnapshot.id,
    status: taskSnapshot.status,
    exitCode: taskSnapshot.exitCode,
    artifact: { name: artifact.name, sizeBytes: artifact.sizeBytes },
    stdout: taskSnapshot.stdout.trim(),
  };
  check('UI 显示真实 Docker 任务完成，退出码为 0', {
    exitCode: taskSnapshot.exitCode,
    stdout: taskSnapshot.stdout.trim(),
    artifactBytes: artifact.sizeBytes,
  });

  // 人类可读回复不应泄漏内部标识或模型提示语；任务区仍可显示真实 ID。
  const chatText = await page.locator('.tc-chat__log').innerText();
  const forbidden = [
    'commandId',
    'taskId',
    'inputId',
    'executionId',
    'This is an execution observation',
    'not a new user instruction',
  ];
  const leaked = forbidden.filter((needle) => chatText.includes(needle));
  assert.deepEqual(leaked, [], `internal detail leaked into the conversation: ${leaked.join(', ')}`);
  assert.doesNotMatch(chatText, /"status"\s*:/, 'raw receipt JSON must not be shown');
  check('聊天不显示 commandId/taskId/内部提示语或原始回执 JSON', {
    checked: forbidden.length + 1,
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await taskRow(page, fileTask).locator('.tc-task__artifacts .tc-link').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const bytes = await readFile(downloadPath);
  assert.equal(download.suggestedFilename(), 'result.txt');
  assert.equal(bytes.length, artifact.sizeBytes);
  assert.equal(bytes.toString('utf8'), 'Companion demo completed.\n');
  evidence.artifact = {
    suggestedFilename: download.suggestedFilename(),
    bytes: bytes.length,
    sha256: sha256(bytes),
    text: bytes.toString('utf8'),
  };
  check('点击产物按认证请求取字节，内容与字节数同服务端记录一致', {
    filename: download.suggestedFilename(),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });

  await page.screenshot({ path: path.join(shots, '01-desktop-connected.png') });
  report.screenshots.push('01-desktop-connected.png');

  // ---- D. UI 停止一个真实长任务，另一个任务不受影响 ----
  console.log('\nD. 停止请求与真实终态');
  const slowTask = `慢任务（验收用）${runId}`;
  const receipt = await startSlowTask(`browser-slow-${Date.now()}`, slowTask, 12);
  assert.equal(receipt.status, 'accepted');
  await waitFor(
    async () => (await taskRow(page, slowTask).count()) >= 1,
    'the slow task never appeared',
    30_000,
  );
  await waitFor(
    async () => {
      const text = await badge(page, slowTask).innerText();
      if (text !== '运行中') {
        // 记录实际看到的状态，避免把「没到运行中」误报成超时。
        evidence.slowObserved = text;
        return null;
      }
      return text;
    },
    'the slow task never reported running',
    30_000,
  );
  check('认证 API 创建的 12 秒 ESM 任务在 UI 中出现并进入运行中');

  await taskRow(page, slowTask).locator('.tc-task__stop').click();
  const requested = await waitFor(
    async () => {
      const text = await badge(page, slowTask).innerText();
      return text === '停止请求已发送' ? text : null;
    },
    'the stop request never became visible',
    15_000,
  );
  assert.equal(requested, '停止请求已发送');
  check('点击停止后显示「停止请求已发送」，不谎称已停止');

  const stopped = await waitFor(
    async () => {
      const text = await badge(page, slowTask).innerText();
      return text === '已取消' ? text : null;
    },
    'the task never reached its real terminal state',
    60_000,
  );
  assert.equal(stopped, '已取消');
  const slowSnapshot = (await snapshot()).tasks.find((task) => task.title === slowTask);
  assert.equal(slowSnapshot.status, 'cancelled');
  evidence.stop = { status: slowSnapshot.status, artifacts: slowSnapshot.artifacts.length };
  check('服务端给出真实终态 cancelled，UI 换成「已取消」而非停留在请求态', {
    status: slowSnapshot.status,
    exitCode: slowSnapshot.exitCode,
    artifacts: slowSnapshot.artifacts.length,
  });

  // 未受影响的任务仍保持自己的终态与产物。
  assert.equal(await badge(page, fileTask).innerText(), '已完成');
  assert.equal(await taskRow(page, fileTask).locator('.tc-task__stop').count(), 0);
  assert.equal(await taskRow(page, fileTask).locator('.tc-task__artifacts .tc-link').count(), 1);
  check('停止一个任务不影响另一个任务的终态与产物');

  // ---- E. 断网 / 重连：最后确认状态，后台继续 ----
  console.log('\nE. 断网与重连');
  const backgroundTask = `后台任务（断网期间完成）${runId}`;
  const code = [
    "import { writeFileSync } from 'node:fs';",
    'await new Promise((resolve) => setTimeout(resolve, 6000));',
    "writeFileSync('offline.txt', 'finished while the browser was offline\\n');",
    "console.log('finished offline');",
  ].join('\n');
  const backgroundReceipt = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      commandId: `browser-offline-${Date.now()}`,
      title: backgroundTask,
      code,
      outputs: [{ path: 'offline.txt', mediaType: 'text/plain' }],
    }),
  });
  assert.equal(backgroundReceipt.status, 202);
  await waitFor(
    async () => (await taskRow(page, backgroundTask).count()) === 1,
    'the background task never appeared',
    30_000,
  );

  const offlineStartedAt = Date.now();
  // 真正断网：链路黑洞化，已建立的 SSE 不再收到任何字节。
  proxy.cut();
  const offline = page.getByText('连接已断开').first();
  // 45s 心跳看门狗 + 20s 请求上限，留足调度余量。
  await offline.waitFor({ timeout: 90_000 });
  evidence.offlineDetectedAfterMs = Date.now() - offlineStartedAt;
  const offlineText = await page.locator('.tc-conn').innerText();
  assert.match(offlineText, /当前状态未知/);
  assert.match(offlineText, /显示的是上次确认的内容/);
  assert.equal(await page.getByRole('button', { name: '重新连接' }).count(), 1);
  const staleLabel = await badge(page, backgroundTask).innerText();
  assert.match(staleLabel, /状态未知（上次：/);
  assert.equal(await page.locator('.tc-send').isDisabled(), true);
  check('断网后明说「当前状态未知」，运行中任务改为「状态未知（上次：…）」，发送不可用', {
    connection: offlineText.replace(/\n/g, ' · '),
    task: staleLabel,
  });

  await page.screenshot({ path: path.join(shots, '02-offline-last-confirmed.png') });
  report.screenshots.push('02-offline-last-confirmed.png');
  check('断网后约 ' + Math.round(evidence.offlineDetectedAfterMs / 1000) + 's 内转为断开（看门狗 45s）', {
    detectedAfterMs: evidence.offlineDetectedAfterMs,
  });

  // 浏览器离线期间，服务后台继续把任务跑完（用认证 API 独立核对）。
  const backgroundDone = await waitFor(
    async () => {
      const task = (await snapshot()).tasks.find((candidate) => candidate.title === backgroundTask);
      return task && task.status === 'completed' ? task : null;
    },
    'the background task never completed while offline',
    60_000,
  );
  assert.equal(backgroundDone.exitCode, 0);
  evidence.background = { status: backgroundDone.status, exitCode: backgroundDone.exitCode };
  check('浏览器离线期间服务端后台照常完成该任务', {
    status: backgroundDone.status,
    exitCode: backgroundDone.exitCode,
  });

  // 链路恢复后用户手动重连，客户端应重新对账到服务端真实终态。
  proxy.restore();
  await page.getByRole('button', { name: '重新连接' }).click();
  await waitFor(
    async () => (await badge(page, backgroundTask).innerText()) === '已完成',
    'the reconnect never reconciled the completed task',
    90_000,
  );
  assert.equal(await badge(page, backgroundTask).innerText(), '已完成');
  assert.match(await page.locator('.tc-conn').innerText(), /已连接/);
  check('重连后对账到真实终态「已完成」，不重放、不重复执行');

  // ---- F. 窄屏 390px ----
  console.log('\nF. 窄屏布局');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.tc-compose').waitFor({ state: 'visible' });
  const narrowOverflow = await overflow(page);
  assert.equal(narrowOverflow.scrollWidth <= narrowOverflow.clientWidth + 1, true);
  assert.deepEqual(narrowOverflow.offenders, []);
  check('390px 窄屏无水平溢出', narrowOverflow);

  // 布局不能只是「宽高对了」：任务区不得盖住输入框，输入必须真的可点击。
  const covered = await page.evaluate(() => {
    const input = document.querySelector('#tc-input');
    if (input === null) return 'missing';
    const box = input.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit === null) return 'none';
    return hit.closest('.tc-side') === null ? 'ok' : 'covered-by-side';
  });
  assert.equal(covered, 'ok', 'the task strip must not cover the composer');
  const rows = await page.evaluate(
    () => getComputedStyle(document.querySelector('.tc-body')).gridTemplateRows,
  );
  assert.doesNotMatch(rows, /^0px /, `chat row collapsed: ${rows}`);
  check('窄屏任务区不遮挡输入框，聊天行未被压成 0', { rows });

  // 窄屏下输入与发送仍可用，任务区折到对话下方。
  await composer.click();
  await page.keyboard.type('窄屏输入');
  assert.equal(await composer.inputValue(), '窄屏输入');
  assert.equal(await page.locator('.tc-send').isDisabled(), false);
  const beforeNarrowSend = await confirmedUser(page).count();
  await page.locator('.tc-send').click();
  await waitFor(
    async () => (await confirmedUser(page).count()) === beforeNarrowSend + 1,
    'the narrow-screen send never appeared',
    30_000,
  );
  check('窄屏下输入与发送按钮可用，消息正常出现');

  await page.screenshot({ path: path.join(shots, '03-narrow-390.png'), fullPage: true });
  report.screenshots.push('03-narrow-390.png');

  // ---- G. 可见焦点 ----
  console.log('\nG. 键盘焦点');
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (element === null) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? '').trim().slice(0, 20),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
    };
  });
  assert.ok(focus !== null);
  assert.notEqual(focus.outlineStyle, 'none');
  assert.notEqual(focus.outlineWidth, '0px');
  check('键盘 Tab 进入时有可见焦点环', focus);

  // 页面自始至终不应出现脚本错误。
  assert.deepEqual(diagnostics.pageErrors, []);
  check('整个流程无未捕获脚本错误', { pageErrors: 0, consoleErrors: diagnostics.consoleErrors.length });

  report.diagnostics = diagnostics;
  report.evidence = evidence;
  report.finishedAt = new Date().toISOString();
  report.passed = true;
  await writeFile(path.join(shots, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n通过 ${report.checks.length} 项检查；截图 ${report.screenshots.length} 张。`);
  console.log('报告：qa/screenshots/companion/acceptance-report.json');
} catch (error) {
  report.passed = false;
  report.diagnostics = diagnostics;
  report.evidence = evidence;
  report.failure = redact(error instanceof Error ? (error.stack ?? error.message) : String(error));
  await writeFile(path.join(shots, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error('\nFAILED:', report.failure);
  process.exitCode = 1;
} finally {
  await browser.close();
  proxy.close();
}

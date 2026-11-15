/**
 * 真实 service 的 QQ Web 验收。
 *
 * 与 `qq-panel.browser.mjs` 不同：这里**没有夹具服务**。脚本用真实的
 * `createCompanionService` 起一个 Node 服务（scripted 模式、临时数据目录、
 * 合成 token），由它托管已构建的 text-client 页面，然后真实点击。
 *
 * 所以这些断言走的是：真实页面 → 真实 HTTP → 真实 Config/State。
 * 仍然没有 QQ 账号、没有真实模型、没有 4120、没有真实密钥。
 *
 * 运行（显式选择）：
 *   TC_BROWSER=<chrome> node plugins/text-client/tests/browser/qq-service.browser.mjs
 *
 * 没有浏览器时以退出码 2 明确跳过。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const shots =
  process.env.TC_SHOTS ?? path.join(root, 'plugins/text-client/tests/browser/screenshots');

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

const TOKEN = 'synthetic-qq-acceptance-token';

/** 临时数据目录：解析成真实路径，退出时按真实路径删。 */
const created = await mkdtemp(path.join(tmpdir(), 'pet-qq-acceptance-'));
const dataDirectory = await realpath(created);

let service;
let browser;
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

try {
  const { createCompanionService } =
    await import('../../../../apps/companion-service/src/service.ts');
  service = await createCompanionService({
    dataDirectory,
    token: TOKEN,
    port: 0,
    mode: 'scripted',
    // 不传 model/QQ 凭据：这条验收只碰本地 policy/source 配置。
  });
  const origin = service.url.replace(/\/$/, '');
  console.log(`service ${origin}`);

  browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (cause) => pageErrors.push(String(cause)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/Failed to load resource/.test(message.text())) return;
    consoleErrors.push(message.text());
  });

  /** 用页面自己的 token 直接打真实 HTTP：读服务端事实，不经 UI 推断。 */
  const api = async (method, pathname, body) => {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };

  await page.goto(`${origin}/`);
  await page.fill('#tc-token', TOKEN);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tc-chat', { timeout: 20_000 });

  await guard('顶栏有 QQ 入口（真实快照带 qq 状态）', async () => {
    await page.waitForSelector('[data-testid="open-qq-settings"]', { timeout: 10_000 });
  });

  await page.click('[data-testid="open-qq-settings"]');
  await page.waitForSelector('[data-testid="qq-save-policy"]', { timeout: 20_000 });

  await guard('打开面板读到真实的 default、且是 disabled 而不是已连接', async () => {
    const text = await page.locator('[data-testid="qq-connection"]').innerText();
    // 真实 default：没有配置过任何来源，所以不可能是「已连接」。
    assert.doesNotMatch(text, /已连接/);
    const view = await api('GET', '/api/qq');
    assert.equal(view.status, 200);
    assert.equal(view.body.ok, true);
    const source = view.body.value.sources.find((item) => item.protocol === 'official');
    assert.ok(source, '真实视图里应当有 official 来源');
    assert.equal(source.desiredEnabled, false);
    assert.equal(source.phase, 'disabled');
  });

  await guard('保存 policy 后来源仍是 disabled，不假连接', async () => {
    await page.check('[data-testid="qq-voice-output"]');
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForSelector('[data-testid="qq-notice"]', { timeout: 15_000 });
    // 界面不能因为保存成功就说连上了。
    const text = await page.locator('[data-testid="qq-connection"]').innerText();
    assert.doesNotMatch(text, /已连接/);
    // 服务端事实：policy 真的存了，来源仍然 disabled。
    const view = await api('GET', '/api/qq');
    assert.equal(view.body.value.policy.settings.voiceOutputEnabled, true);
    const source = view.body.value.sources.find((item) => item.protocol === 'official');
    assert.equal(source.desiredEnabled, false);
    assert.equal(source.phase, 'disabled');
  });

  await guard('source settings 保存走真实 CAS，refill 拿到新 revision', async () => {
    const before = await api('GET', '/api/qq');
    const source = before.body.value.sources.find((item) => item.protocol === 'official');
    await page.fill('[data-testid="qq-app-id"]', 'synthetic-app-id');
    await page.click('[data-testid="qq-save-source"]');
    await page.waitForTimeout(800);
    const after = await api('GET', '/api/qq');
    const next = after.body.value.sources.find((item) => item.protocol === 'official');
    assert.equal(next.settings.appId, 'synthetic-app-id');
    assert.ok(
      next.configRevision > source.configRevision,
      `configRevision 应当前进：${source.configRevision} -> ${next.configRevision}`,
    );
  });

  await guard('外部改同一 policyRevision 制造真实 409，草稿保留且可 refetch', async () => {
    const before = await api('GET', '/api/qq');
    const revision = before.body.value.policy.revision;
    // 先在页面上制造一份脏草稿（管理员现在是 raw 输入 + 应用）。
    await page.fill('[data-testid="qq-admins"]', 'draft-admin');
    await page.click('[data-testid="qq-admins-apply"]');
    // 再用真实 HTTP 从外部推进 policy：这次写入用当前 revision。
    // 外部写入必须真的改一个值：保存同样的内容不会推进 revision，
    // 那样构造出来的不是冲突，而是幂等重放。
    const external = await api('POST', '/api/qq/policy', {
      expectedRevision: revision,
      settings: { ...before.body.value.policy.settings, voiceOutputEnabled: false },
    });
    assert.equal(external.status, 200);
    const mid = await api('GET', '/api/qq');
    assert.ok(
      mid.body.value.policy.revision > revision,
      `外部写入应当推进 revision：${revision} -> ${mid.body.value.policy.revision}`,
    );
    // 页面上的保存仍然拿着旧 revision → 真实 409。
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForTimeout(800);
    const notice = await page.locator('[data-testid="qq-notice"]').innerText();
    console.log('DBG 409 notice:', JSON.stringify(notice));
    console.log('DBG 409 failure:', await page.locator('[data-testid="qq-failure"]').count());
    // 两段 CAS 下 conflict 不等于零副作用，所以只说「版本冲突/未确认全部完成」。
    assert.match(notice, /版本冲突|未确认全部完成/);
    // 草稿还在：没有被静默丢弃。
    assert.equal(await page.inputValue('[data-testid="qq-admins"]'), 'draft-admin');
    // 显式 rebase 之后拿到的是真实新 view。
    await page.click('[data-testid="qq-rebase"]');
    await page.waitForTimeout(500);
    assert.equal(await page.inputValue('[data-testid="qq-admins"]'), 'draft-admin');
    const after = await api('GET', '/api/qq');
    assert.ok(after.body.value.policy.revision > revision);
  });

  await guard('合成密钥草稿绑定 target，保存后不残留明文', async () => {
    // 上一个用例从外部推进了 policy；credential 用的是**来源自己的**
    // configRevision，这里重新打开面板拿一份干净基线，避免把跨用例的过期
    // 基线误读成产品缺陷。
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 5_000 });
    await page.click('[data-testid="open-qq-settings"]');
    await page.waitForSelector('[data-testid="qq-save-policy"]', { timeout: 15_000 });
    await page.fill('[data-testid="qq-credential"]', 'synthetic-secret-value');
    assert.equal(await page.inputValue('[data-testid="qq-credential"]'), 'synthetic-secret-value');
    await page.click('[data-testid="qq-save-credential"]');
    await page.waitForTimeout(1200);

    // 发起即离场：输入框不能还留着密钥。
    assert.equal(await page.inputValue('[data-testid="qq-credential"]'), '');
    // 真实视图报告已配置（但这不是「已连接」）。
    const view = await api('GET', '/api/qq');
    const source = view.body.value.sources.find((item) => item.protocol === 'official');

    assert.equal(source.credential.available, true);
    assert.equal(source.phase, 'disabled');
  });

  await guard('judge 两段 CAS 部分失败后重读真实 view，草稿与基线不被谎报', async () => {
    // 先确认当前真实 revision，再让页面拿着一份脏草稿去保存 judge。
    const before = await api('GET', '/api/qq');
    await page.fill('[data-testid="qq-judge-attempts"]', '11');
    const dirty = await page.inputValue('[data-testid="qq-judge-attempts"]');
    assert.equal(dirty, '11');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1500);
    // 无论这次两段 CAS 是全成、半成还是全败，界面都必须以真实 view 为准：
    // 不能把「可能已写入」说成「完全没保存」，也不能自动把草稿清掉。
    const after = await api('GET', '/api/qq');
    assert.equal(after.status, 200);
    assert.equal(
      await page.inputValue('[data-testid="qq-judge-attempts"]'),
      dirty,
      '保存后草稿值必须还在（重读只换基线，不改内容）',
    );
    const notice = await page
      .locator('[data-testid="qq-notice"]')
      .innerText()
      .catch(() => '');
    // 不许出现「完全没有保存」这种在部分提交下不成立的断言。
    assert.doesNotMatch(notice, /没有保存：/);
    void before;
  });

  /* ---- judge：从 local 切到 gateway-key，密钥入口必须能出现且不崩 ---- */
  await guard('judge 从 local-client-id 切到 gateway-key 后密钥可写且不崩', async () => {
    // 先把鉴权方式改成 local-client-id 并保存：此时 credential.writable=false，
    // 密钥入口不显示。
    await page.selectOption('[data-testid="qq-judge-auth"]', 'local-client-id');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    assert.equal(
      await page.locator('[data-testid="qq-judge-key"]').count(),
      0,
      'local-client-id 下不该有密钥输入框',
    );

    // 再切到 gateway-key：writable 变 true，密钥入口出现。
    // 这一路必须经过真实的 React 渲染，不能直接调函数。
    await page.selectOption('[data-testid="qq-judge-auth"]', 'gateway-key');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1500);
    console.log(
      'DBG judge cred:',
      await page
        .locator('[data-testid="qq-judge-credential"]')
        .innerText()
        .catch(() => 'NONE'),
    );
    console.log('DBG key count:', await page.locator('[data-testid="qq-judge-key"]').count());
    console.log('DBG panel alive:', await page.locator('[data-testid="qq-save-policy"]').count());
    await page.waitForSelector('[data-testid="qq-judge-key"]', { timeout: 15_000 });
    // 面板还在（没有因为 undefined.trim 崩掉）。
    assert.equal(await page.locator('[data-testid="qq-save-policy"]').count(), 1);

    // 真实逐键输入，写入按钮从禁用到可用。
    const key = page.locator('[data-testid="qq-judge-key"]');
    await key.fill('');
    for (const ch of 'synthetic-judge-key') await key.press(ch);
    assert.equal(await key.inputValue(), 'synthetic-judge-key');
    assert.equal(await page.locator('[data-testid="qq-judge-write-key"]').isDisabled(), false);
  });

  /* ---- judge：改连接 → 保存 → 写密钥；未保存 B 时 key 零请求 ---- */
  await guard('judge 改连接保存成功后才能写密钥', async () => {
    // 先确保是 gateway-key 且已保存。
    await page.selectOption('[data-testid="qq-judge-auth"]', 'gateway-key');
    await page.fill('[data-testid="qq-judge-base-url"]', 'http://127.0.0.1:9/judge-a');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    await page.waitForSelector('[data-testid="qq-judge-key"]', { timeout: 15_000 });

    // 再改 URL 但**不保存**：此时屏幕上是一个服务端不存在的 target。
    await page.fill('[data-testid="qq-judge-base-url"]', 'http://127.0.0.1:9/judge-unsaved');
    await page.fill('[data-testid="qq-judge-key"]', 'should-not-be-sent');
    const before = await api('GET', '/api/qq');
    await page.click('[data-testid="qq-judge-write-key"]');
    await page.waitForTimeout(800);
    // 未保存的 target：一个请求都不该发出去，密钥没变。
    const after = await api('GET', '/api/qq');
    assert.equal(
      after.body.value.judge.credential.version,
      before.body.value.judge.credential.version,
      '未保存的 target 不该写入密钥',
    );
    // 并且要明说先保存连接。
    const notice = await page
      .locator('[data-testid="qq-notice"]')
      .innerText()
      .catch(() => '');
    assert.match(notice, /先保存连接/);
  });

  await guard('judge 保存后密钥可写成功，且不需要关掉重开', async () => {
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    await page.fill('[data-testid="qq-judge-key"]', 'synthetic-judge-key');
    await page.click('[data-testid="qq-judge-write-key"]');
    await page.waitForTimeout(1000);
    const view = await api('GET', '/api/qq');
    // 服务端报告密钥已配置：这是真实写入，不是界面自己说的。
    assert.equal(view.body.value.judge.credential.available, true);
  });

  await guard('judge 冲突后能直接 rebase 继续，不用关重开', async () => {
    const before = await api('GET', '/api/qq');
    // 外部推进 judge 的 configRevision。
    const external = await api('POST', '/api/qq/judge', {
      expectedPolicyRevision: before.body.value.policy.revision,
      expectedConfigRevision: before.body.value.judge.configRevision,
      settings: { ...before.body.value.judge.settings, maxAttemptsPerHour: 7 },
    });
    assert.equal(external.status, 200);
    // 页面拿旧基线保存 → 冲突。
    await page.fill('[data-testid="qq-judge-attempts"]', '9');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    // 不关面板，直接 rebase。
    await page.click('[data-testid="qq-rebase"]');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('[data-testid="qq-save-judge"]').count(), 1);
    // rebase 之后能再次保存成功。
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    const after = await api('GET', '/api/qq');
    assert.equal(after.body.value.policy.settings.judge.maxAttemptsPerHour, 9);
  });

  await guard('judge 保存不丢无关的未保存 policy 草稿', async () => {
    // 先在 allowlist 上留一份未保存的编辑。
    await page.fill('[data-testid="qq-private-allowlist"]', 'keep-me');
    await page.click('[data-testid="qq-private-allowlist-apply"]');
    await page.waitForTimeout(200);
    // 再改 judge 并保存。
    await page.fill('[data-testid="qq-judge-attempts"]', '12');
    await page.click('[data-testid="qq-save-judge"]');
    await page.waitForTimeout(1200);
    // allowlist 的草稿必须还在（judge 只占 policy.judge 子集）。
    assert.equal(await page.inputValue('[data-testid="qq-private-allowlist"]'), 'keep-me');
  });

  await guard('公开 fact 走真实 owner HTTP 保存并可读回，同键 private 仍在', async () => {
    // 先在管理界面建一条 private 事实（默认 scope）。
    const memory = await api('GET', '/api/memory');
    const base = memory.body.value.revision;
    const upsert = await api('POST', '/api/facts', {
      commandId: `fact-private-${Date.now()}`,
      expectedMemoryRevision: base,
      expectedFactRevision: 0,
      key: 'shared-key',
      value: '私有值',
    });
    assert.equal(upsert.status, 200);
    // 再显式建一条同 key 的公开事实。
    const after = await api('GET', '/api/memory');
    const pub = await api('POST', '/api/facts', {
      commandId: `fact-public-${Date.now()}`,
      expectedMemoryRevision: after.body.value.revision,
      expectedFactRevision: 0,
      key: 'shared-key',
      value: '公开值',
      audience: { kind: 'public' },
    });
    assert.equal(pub.status, 200);
    // 读回：同 key 的两条并存，scope 各自正确。
    const read = await api('GET', '/api/memory');
    const rows = read.body.value.facts.filter((fact) => fact.key === 'shared-key');
    assert.equal(rows.length, 2, '同键的私有与公开必须是两行');
    // 私有那条的真实 scope 是 owner-private（不是「没有 audience」）。
    assert.ok(rows.some((fact) => fact.audience?.kind === 'owner-private'));
    assert.ok(rows.some((fact) => fact.audience?.kind === 'public'));
  });

  await guard('投递与 principal 分页在真实服务上可读', async () => {
    const deliveries = await api('GET', '/api/qq/deliveries?limit=32');
    assert.equal(deliveries.status, 200);
    assert.equal(deliveries.body.ok, true);
    assert.ok(Array.isArray(deliveries.body.value.deliveries));
    const principals = await api('GET', '/api/qq/principals?limit=32');
    assert.equal(principals.status, 200);
    assert.ok(Array.isArray(principals.body.value.principals));
  });

  await guard('材料读取口在真实服务上存在且受认证门禁', async () => {
    // 没有 token：必须被拒，不能因为「没有这个材料」就放行。
    const anonymous = await fetch(`${origin}/api/materials/text-does-not-exist`);
    assert.equal(anonymous.status, 401);
    // 带 token 但不存在的 id：明确的失败，不是空正文。
    const missing = await api('GET', '/api/materials/text-does-not-exist');
    assert.equal(missing.body.ok, false);
    assert.ok(missing.body.error, '不存在的材料要给出明确错误');
  });

  await guard('投递详情可读（真实 service 上无记录也不伪造）', async () => {
    const list = await api('GET', '/api/qq/deliveries?limit=32');
    assert.equal(list.status, 200);
    const page_ = list.body.value;
    assert.ok(Array.isArray(page_.deliveries));
    if (page_.deliveries.length > 0) {
      const detail = await api(
        'GET',
        `/api/qq/deliveries/${encodeURIComponent(page_.deliveries[0].id)}`,
      );
      assert.equal(detail.status, 200);
      assert.ok(Array.isArray(detail.body.value.parts), '详情必须带 parts，不能只有摘要');
    }
    // 不存在的投递：明确失败。
    const absent = await api('GET', '/api/qq/deliveries/delivery-does-not-exist');
    assert.equal(absent.body.ok, false);
  });

  await guard('名单逐键输入可用，尾逗号不被吃掉', async () => {
    // 前面的用例推进过 policy revision；先显式 rebase，避免拿过期基线保存。
    if ((await page.locator('[data-testid="qq-rebase"]').count()) > 0) {
      await page.click('[data-testid="qq-rebase"]');
      await page.waitForTimeout(500);
    }
    const field = page.locator('[data-testid="qq-private-allowlist"]');
    await field.fill('');
    // 一个字符一个字符地敲，模拟真实输入。
    for (const ch of 'user-1,user-2,') await field.press(ch);
    // 输入过程中原文必须保留：尾逗号不能被 onChange 吃掉。
    assert.equal(await field.inputValue(), 'user-1,user-2,');
    await page.click('[data-testid="qq-private-allowlist-apply"]');
    await page.waitForTimeout(200);
    // 名单改动还在草稿里：要保存 policy 才会进真实 Config。
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForTimeout(800);
    const view = await api('GET', '/api/qq');
    const list = view.body.value.policy.settings.privateAllowlist;
    assert.deepEqual(
      list.map((entry) => entry.senderId),
      ['user-1', 'user-2'],
    );
  });

  await guard('别名可绑定到 principal 并保存', async () => {
    if ((await page.locator('[data-testid="qq-rebase"]').count()) > 0) {
      await page.click('[data-testid="qq-rebase"]');
      await page.waitForTimeout(500);
    }
    await page.selectOption('[data-testid="qq-alias-scene"]', 'private');
    await page.fill('[data-testid="qq-alias-sender"]', 'qq-user-9');
    await page.fill('[data-testid="qq-alias-principal"]', 'person-9');
    await page.click('[data-testid="qq-alias-add"]');
    await page.waitForTimeout(300);
    await page.click('[data-testid="qq-save-policy"]');
    await page.waitForTimeout(800);
    const view = await api('GET', '/api/qq');
    const aliases = view.body.value.policy.settings.principalAliases;
    const found = aliases.find((entry) => entry.actor.senderId === 'qq-user-9');
    assert.ok(found, '别名应当写进真实 policy');
    assert.equal(found.principalId, 'person-9');
  });

  await page.screenshot({ path: path.join(shots, 'qq-service-1280.png'), fullPage: false });
  console.log(`screenshot ${path.join(shots, 'qq-service-1280.png')}`);

  assert.deepEqual(pageErrors, [], '页面不应抛错');
  assert.deepEqual(consoleErrors, [], '控制台不应报错');
} finally {
  if (browser) await browser.close();
  if (service) await service.close();
  await rm(dataDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

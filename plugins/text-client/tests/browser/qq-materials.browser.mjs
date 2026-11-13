/**
 * 真实 service 的材料读取验收（独立脚本）。
 *
 * 为什么不和 `qq-service.browser.mjs` 放一起：那条脚本要先跑十几个 QQ 配置
 * 用例，页面处于「已连接 + 多次重连」的状态；材料用例需要从干净的 default
 * 开始，否则失败原因会混在一起、分不清是产品还是测试自身。
 *
 * 数据用 `qa/fixtures/companion-qq/seed-material-view.ts`：它走真实
 * `runtime.message` → 真实 owner terminal grant → 真实 Store 写入，
 * 不是伪造 grant，也不声称这是模型生成长文。
 *
 * 运行：
 *   TC_BROWSER=<chrome> node plugins/text-client/tests/browser/qq-materials.browser.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const TOKEN = 'synthetic-material-acceptance-token';
const created = await mkdtemp(path.join(tmpdir(), 'pet-material-'));
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
  const { seedMaterialView } =
    await import('../../../../qa/fixtures/companion-qq/seed-material-view.ts');
  service = await createCompanionService({
    dataDirectory,
    token: TOKEN,
    port: 0,
    mode: 'scripted',
  });
  const origin = service.url.replace(/\/$/, '');
  console.log(`service ${origin}`);

  // 先种材料，再打开页面：页面一进来就能看到这两条消息。
  const seeded = await seedMaterialView(service);
  console.log(`seeded doc=${seeded.documentMessageId} file=${seeded.fileMessageId}`);

  browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (cause) => pageErrors.push(String(cause)));

  await page.goto(`${origin}/`);
  await page.waitForSelector('#tc-token', { timeout: 20_000 });
  await page.fill('#tc-token', TOKEN);
  assert.equal(await page.inputValue('#tc-token'), TOKEN, '提交前令牌必须在输入框里');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tc-chat', { timeout: 20_000 });

  await guard('消息里出现文本文档与二进制附件', async () => {
    await page.waitForSelector('[data-testid="material-document"]', { timeout: 20_000 });
    assert.equal(await page.locator(`[data-testid="material-${seeded.file.id}"]`).count(), 1);
  });

  await guard('点「查看全文」看到真实正文，不是那条说明', async () => {
    await page.click(`[data-testid="material-view-${seeded.document.id}"]`);
    await page.waitForSelector('[data-testid="material-fulltext"]', { timeout: 20_000 });
    const body = await page.locator('.tc-msg__fulltext-body').innerText();
    assert.equal(body, seeded.fullText, '页面里的正文必须和写进 Store 的字节一致');
    assert.notEqual(body, seeded.notice, '不能把消息里的说明当成正文');
  });

  await guard('下载二进制材料拿到真实字节', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.click(`[data-testid="material-download-${seeded.file.id}"]`),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(
      createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
      seeded.binarySha256,
      '下载的字节必须和写进 Store 的一致',
    );
  });

  await page.screenshot({ path: path.join(shots, 'qq-materials-1280.png'), fullPage: false });
  console.log(`screenshot ${path.join(shots, 'qq-materials-1280.png')}`);
  assert.deepEqual(pageErrors, [], '页面不应抛错');
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

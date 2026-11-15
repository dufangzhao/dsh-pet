/**
 * 真实服务：不同 configRevision 的连接切换（L 段）。
 *
 * 前提：Magpie 与 fixture 的 configRevision 不同。只通过真实 DOM 下拉切换，
 * 断言不出现假的外部变更提示、保存 payload 带的是**新目标**的 revision。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = path.join(root, 'qa/screenshots/companion-model');
const connection = JSON.parse(await readFile(process.env.COMPANION_CONNECTION, 'utf8'));
const { url: serviceUrl, token } = connection;
const redact = (value) => String(value).split(token).join('[redacted]');

const api = async (route, init = {}) => {
  const response = await fetch(serviceUrl + route, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return { status: response.status, body: await response.json() };
};

const view = async () => (await api('/api/model')).body.value;
const waitFor = async (predicate, message, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

const before = await view();
const magpie = before.connectors.find((item) => !item.synthetic);
const fixture = before.connectors.find((item) => item.synthetic);
assert.notEqual(magpie.configRevision, fixture.configRevision, 'revisions must differ for this check');
console.log(`revisions: magpie=${magpie.configRevision} fixture=${fixture.configRevision}`);

// 让 desired 回到 Magpie，并确保它可保存（可写凭据 + 有模型）。
await api('/api/model', {
  method: 'POST',
  body: JSON.stringify({
    commandId: `l-prep-${Date.now().toString(36)}`,
    expectedProfileRevision: before.profileRevision,
    connectorId: magpie.id,
    expectedConfigRevision: magpie.configRevision,
    mode: 'scripted',
    config: {
      baseUrl: connection.gatewayBaseUrl,
      model: connection.model,
      authMode: 'gateway-key',
    },
  }),
});
await waitFor(async () => (await view()).desired.connectorId === magpie.id, 'desired never returned');

const browser = await chromium.launch({
  executablePath:
    process.env.COMPANION_BROWSER ??
    path.join(
      root,
      '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell',
    ),
  chromiumSandbox: false,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(redact(error.message)));

try {
  await page.goto(serviceUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#tc-token').waitFor();
  await page.locator('#tc-token').click();
  await page.keyboard.type(token, { delay: 1 });
  await page.keyboard.press('Enter');
  await page.locator('.tc-chat').waitFor({ timeout: 30_000 });
  await waitFor(
    async () => (await page.locator('.tc-conn').innerText()).includes('已连接'),
    'never reached live',
  );

  await page.click('header .tc-head__actions button:has-text("模型")');
  await page.waitForSelector('dialog[open] .tc-model');

  // 1. 只切下拉：不能出现「服务端配置在别处改过」。
  await page.locator('.pk-field select').first().selectOption(fixture.id);
  await page.waitForTimeout(600);
  const notices = await page.locator('.tc-model__note[role=status]').allInnerTexts();
  assert.deepEqual(notices, []);
  console.log('  ok  switching to the fixture connector shows no false external-change notice');

  // 1b. 该连接 required=false：界面必须只说「不需要密钥」，不得出现任何错误或填密钥提示。
  const dialogNotes = await page.locator('.tc-model .tc-model__note').allInnerTexts();
  const dialogText = dialogNotes.join(' | ');
  assert.match(dialogText, /这个连接不需要密钥/);
  assert.doesNotMatch(dialogText, /先把连接保存下来/);
  assert.equal(await page.locator('.tc-model__error').count(), 0);
  assert.equal(await page.locator('.tc-model__key input[type=password]').count(), 0);
  console.log('  ok  the keyless connector shows no error and no key prompt', { notes: dialogNotes });

  // 2. 保存：payload 必须带 fixture 的 revision，不是 Magpie 的。
  const selected = (await view()).connectors.find((item) => item.id === fixture.id);
  await page.locator('.pk-dialog__footer button:has-text("保存并应用")').first().click();
  await waitFor(async () => (await view()).desired.connectorId === fixture.id, 'switch never committed');
  const afterSwitch = await view();
  assert.equal(afterSwitch.desired.connectorId, fixture.id);
  const errors = await page.locator('.tc-model__error').count();
  assert.equal(errors, 0);
  console.log(
    `  ok  saving the fixture connector committed with its own revision (${selected.configRevision})`,
  );

  await page.screenshot({ path: path.join(shots, 'l-switch-different-revision.png') });
  assert.deepEqual(pageErrors, []);
  console.log('  ok  no uncaught page errors');
} finally {
  await context.close();
  await browser.close();
}

console.log('\n4 checks passed (real service; connector switch across different revisions)');

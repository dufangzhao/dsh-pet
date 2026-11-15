import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { waitForFault } from './fault-proxy.mjs';

// The send is a real DOM action. Target B is selected through the existing trusted console bridge.
export async function targetDomCase(page, first, proxyA, second, proxyB, step = () => {}) {
  const readState = async () => {
    const result = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(result.ok, true);
    return result.value;
  };
  const connect = async (baseUrl, token) => {
    const state = await readState();
    const result = await page.evaluate((input) => window.petCompanion.connect(input), {
      expectedRevision: state.configRevision, baseUrl, token,
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.phase, 'live');
    return result.value;
  };
  step('target-connect-a');
  const a = await connect(proxyA.url, first.token);
  await page.getByTestId('nav-conversation').click();
  const input = page.getByTestId('conversation-input');
  const send = page.getByTestId('conversation-send');
  await expect(send).toBeDisabled();
  const oldText = `QA old ${randomUUID()}`;
  const newText = `QA new ${randomUUID()}`;
  await input.fill(oldText);
  await expect(send).toBeEnabled();
  const beforeA = proxyA.count('/api/messages');
  const beforeB = proxyB.count('/api/messages');
  step('target-inflight-a-to-b');
  const held = proxyA.arm('/api/messages', 'hold');
  await send.click();
  await waitForFault(held.observed, 'A command receipt'); // A really serialized the receipt.
  const b = await connect(proxyB.url, second.token);
  assert.notEqual(b.connectionId, a.connectionId);
  await expect(page.getByRole('heading', { name: `与 ${second.name} 对话` })).toBeVisible();
  held.release();
  await expect(input).toHaveValue(oldText);
  assert.equal(proxyA.count('/api/messages'), beforeA + 1);
  assert.equal(proxyB.count('/api/messages'), beforeB);

  // A fresh action in B must work and route exactly once to B, never back to A.
  step('target-current-b-send');
  await input.fill(newText);
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(async () => (await second.snapshot()).messages.some((message) => message.text === newText),
    { timeout: 30000 }).toBe(true);
  assert.equal(proxyA.count('/api/messages'), beforeA + 1);
  assert.equal(proxyB.count('/api/messages'), beforeB + 1);
  const aSnapshot = await first.snapshot();
  const bSnapshot = await second.snapshot();
  assert.equal(aSnapshot.messages.filter((message) => message.text === oldText).length, 1);
  assert.equal(bSnapshot.messages.filter((message) => message.text === oldText).length, 0);
  assert.equal(bSnapshot.messages.filter((message) => message.text === newText).length, 1);
  return ['actual-dom-inflight-target-switch-and-current-target-send'];
}

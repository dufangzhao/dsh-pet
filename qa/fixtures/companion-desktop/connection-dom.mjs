import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { waitForFault } from './fault-proxy.mjs';

// Runs against the production console page, Main/preload and actual loopback service.
// The network gate holds a real snapshot response; no window bridge is replaced.
export async function connectionDomCase(page, service, proxy, step = () => {}) {
  const address = page.getByTestId('start-address');
  const ask = page.getByTestId('start-ask-token');
  const token = page.getByTestId('start-token');
  const moved = page.getByTestId('start-address-moved');
  const readState = async () => {
    const result = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(result.ok, true);
    return result.value;
  };
  await address.waitFor({ state: 'visible' });
  await expect.poll(async () => (await readState()).source).toBe('ready');
  assert.equal((await readState()).configRevision, 1, 'isolated source must start at revision 1');
  await page.evaluate(() => {
    const record = { falsePrompts: 0, active: true };
    const observer = new MutationObserver((mutations) => {
      if (!record.active) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && (node.matches('[data-testid="start-address-moved"]') ||
              node.querySelector('[data-testid="start-address-moved"]'))) record.falsePrompts++;
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__companionQaPrompt = { record, observer };
  });

  // The first connect really commits rev2. Observe the form while Main is waiting on HTTP.
  step('connection-first-cas');
  await address.fill(proxy.url);
  await ask.click();
  await token.fill(service.token);
  const held = proxy.arm('/api/snapshot', 'hold');
  await page.getByTestId('start-connect').click();
  await waitForFault(held.observed, 'initial snapshot');
  await expect(token).toHaveCount(0);
  held.release();
  await expect.poll(async () => (await readState()).phase, { timeout: 30000 }).toBe('live');
  assert.equal((await readState()).configRevision, 2);
  await expect(moved).toHaveCount(0);

  // Both explicit cancel and leaving the actual page must discard an unsubmitted token.
  step('token-cancel-and-retarget');
  await ask.click();
  await token.fill(service.token);
  await page.getByTestId('start-cancel-token').click();
  await expect(token).toHaveCount(0);
  await ask.click();
  await expect(token).toHaveValue('');
  await token.fill(service.token);
  await page.getByTestId('nav-conversation').click();
  await page.getByTestId('nav-start').click();
  await ask.click();
  await expect(token).toHaveValue('');

  // Retargeting while a token is typed must clear that input before a different target is used.
  await token.fill(service.token);
  await address.fill(service.url);
  await expect(token).toHaveValue('');
  await address.fill(proxy.url);
  await expect(token).toHaveValue('');

  // The same saved address, with a different token, must use the new revision 2 baseline.
  // The deliberately invalid second token tests the real auth failure, not a fake success.
  step('connection-same-address-new-token');
  await token.fill(`${service.token}x`);
  const previous = await readState();
  await page.getByTestId('start-connect').click();
  await expect(token).toHaveCount(0);
  await expect.poll(async () => {
    const state = await readState();
    return state.connectionId !== previous.connectionId && state.phase === 'offline' && state.error?.code === 'auth-failed';
  }, { timeout: 30000 }).toBe(true);
  assert.equal((await readState()).configRevision, 2);
  await expect(moved).toHaveCount(0);

  // Restore real authentication on the same endpoint before the independent Config edit.
  await ask.click();
  await token.fill(service.token);
  await page.getByTestId('start-connect').click();
  await expect.poll(async () => (await readState()).phase, { timeout: 30000 }).toBe('live');
  assert.equal((await readState()).configRevision, 2);
  await expect(page.getByTestId('start-identity')).toBeVisible();
  await expect(moved).toHaveCount(0);
  const falsePrompts = await page.evaluate(() => {
    const state = window.__companionQaPrompt;
    state.record.active = false;
    state.observer.disconnect();
    delete window.__companionQaPrompt;
    return state.record.falsePrompts;
  });
  assert.equal(falsePrompts, 0, 'own connection changes must not flash an external-change alert');

  // Exercise the existing source-owned generic Config CAS, not a fabricated UI state.
  step('connection-external-cas');
  const changed = await page.evaluate(async ({ baseUrl }) => {
    const host = await window.petConsole.getSnapshot();
    if (!host.ok) return host;
    const client = host.value.plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
    if (!client) throw new Error('client source missing');
    return window.petConsole.saveConfig({ owner: client.owner, expectedRevision: 2, data: { baseUrl } });
  }, { baseUrl: service.url });
  assert.equal(changed.ok, true);
  assert.equal(changed.value.snapshot.revision, 3);
  await expect.poll(async () => (await readState()).configRevision, { timeout: 30000 }).toBe(3);
  await expect(moved).toBeVisible();
  await expect(address).toHaveValue(proxy.url);
  return ['connection-form-revision-and-real-external-cas', 'token-cleared-in-flight-close-and-retarget'];
}

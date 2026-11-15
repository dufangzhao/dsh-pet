import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Uses only the actual console facade and its real source owner/security snapshots.
export async function sourceLifecycleCase(page, service, proxy) {
  const state = async () => {
    const result = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(result.ok, true); return result.value;
  };
  const client = async () => page.evaluate(async () => {
    const result = await window.petConsole.getSnapshot();
    if (!result.ok) throw new Error('Host snapshot failed');
    const source = result.value.plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
    if (!source) throw new Error('Client source absent');
    return source;
  });
  const agentId = (await service.snapshot()).agent.id;
  await expect.poll(() => proxy.streamCount(), { timeout: 15000 }).toBe(1);
  const original = await state();
  const beforeMessages = proxy.count('/api/messages');
  const active = await client();
  assert.equal(active.state, 'active');
  const disabled = await page.evaluate((owner) => window.petConsole.runPluginAction({ owner, action: 'disable' }), active.owner);
  assert.equal(disabled.ok, true); assert.equal(disabled.value.operationError, null);
  await expect.poll(() => proxy.streamCount(), { timeout: 15000 }).toBe(0);
  await expect.poll(async () => (await state()).source, { timeout: 15000 }).toBe('disabled');
  const stale = await page.evaluate((connectionId) => window.petCompanion.sendMessage({
    connectionId, commandId: crypto.randomUUID(), text: 'should-not-send',
  }), original.connectionId);
  assert.equal(stale.ok, false);
  assert.equal(proxy.count('/api/messages'), beforeMessages);
  assert.equal((await service.snapshot()).agent.id, agentId);

  const stopped = await client();
  const enabled = await page.evaluate((owner) => window.petConsole.runPluginAction({ owner, action: 'enable' }), stopped.owner);
  assert.equal(enabled.ok, true); assert.equal(enabled.value.operationError, null);
  await expect.poll(async () => (await state()).source, { timeout: 15000 }).toBe('ready');
  const ready = await state();
  const rebound = await page.evaluate((input) => window.petCompanion.connect(input), {
    expectedRevision: ready.configRevision, baseUrl: proxy.url, token: service.token,
  });
  assert.equal(rebound.ok, true); assert.equal(rebound.value.phase, 'live');
  assert.notEqual(rebound.value.connectionId, original.connectionId);
  await expect.poll(() => proxy.streamCount(), { timeout: 15000 }).toBe(1);
  const security = await page.evaluate(() => window.petConsole.getSecurity());
  assert.equal(security.ok, true);
  const record = security.value.plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
  assert.ok(record?.trusted && record.digest);
  const revoked = await page.evaluate((input) => window.petConsole.setTrust(input), {
    owner: record.owner, expectedDigest: record.digest, approved: false,
  });
  assert.equal(revoked.ok, true); assert.equal(revoked.value.operationError, null);
  await expect.poll(() => proxy.streamCount(), { timeout: 15000 }).toBe(0);
  await expect.poll(async () => (await state()).source, { timeout: 15000 }).not.toBe('ready');
  const denied = await page.evaluate((input) => window.petCompanion.connect(input), {
    expectedRevision: (await state()).configRevision, baseUrl: proxy.url, token: service.token,
  });
  assert.equal(denied.ok, false);
  assert.equal(proxy.count('/api/messages'), beforeMessages);
  assert.equal((await service.snapshot()).agent.id, agentId);
  return ['real-source-disable-reenable-revoke-drains-sse-and-denies-stale-send'];
}

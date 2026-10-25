import { expect, it, vi } from 'vitest';
import { HOST_IPC, type HostStatus } from '@pet/contracts';
import { HostStatusRequests } from './host-request.js';
const status: HostStatus = {
  version: 1,
  runtime: 'ready',
  installedPlugins: 0,
  activePlugins: 0,
  unreadyPlugins: 0,
  pendingRestartPlugins: 0,
  runningTasks: 0,
  pendingWork: 0,
};
const source = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///pet.html',
  expectedUrl: 'file:///pet.html',
};
it('only accepts the fixed zero-argument status method', () => {
  const read = vi.fn(() => status),
    handler = new HostStatusRequests(read);
  expect(handler.handle(source, HOST_IPC.status, [])).toEqual({ ok: true, value: status });
  expect(handler.handle(source, 'host:v1:execute', [])).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(handler.handle(source, HOST_IPC.status, [{}])).toMatchObject({ ok: false });
  expect(read).toHaveBeenCalledTimes(1);
});
it.each([
  { senderId: 2 },
  { senderId: 0, expectedId: 0 },
  { mainFrame: false },
  { frameUrl: 'https://evil.invalid/' },
  { frameUrl: 'file:///pet.html?other' },
  { expectedUrl: 'https://evil.invalid/', frameUrl: 'https://evil.invalid/' },
])('refuses untrusted frame sources without reading host data (%j)', (change) => {
  const read = vi.fn(() => status);
  expect(
    new HostStatusRequests(read).handle({ ...source, ...change }, HOST_IPC.status, []),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(read).not.toHaveBeenCalled();
});
it('enforces a per-second request budget and resets it', () => {
  let now = 0;
  const handler = new HostStatusRequests(
    () => status,
    () => now,
  );
  for (let i = 0; i < 60; i++) expect(handler.handle(source, HOST_IPC.status, []).ok).toBe(true);
  expect(handler.handle(source, HOST_IPC.status, [])).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  now = 1000;
  expect(handler.handle(source, HOST_IPC.status, []).ok).toBe(true);
});
it('does not leak exception details', () => {
  const handler = new HostStatusRequests(() => {
    throw new Error('private-path-or-key');
  });
  const result = handler.handle(source, HOST_IPC.status, []);
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('private');
});

import { expect, it, vi } from 'vitest';
import { handleConsoleRequest } from './console-request.js';
const source = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
};
it('returns a snapshot from the owned console main frame', async () => {
  const read = vi.fn(() => ({ version: 1 }));
  expect(await handleConsoleRequest(source, [], read)).toEqual({ ok: true, value: { version: 1 } });
  expect(read).toHaveBeenCalledOnce();
});
it('accepts an asynchronous open action without returning a window object', async () => {
  expect(await handleConsoleRequest(source, [], async () => null)).toEqual({
    ok: true,
    value: null,
  });
});
it('rejects request arguments before the action', async () => {
  const action = vi.fn();
  expect(await handleConsoleRequest(source, ['path'], action)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(action).not.toHaveBeenCalled();
});
it('rejects other windows, subframes, changed files and remote pages', async () => {
  const action = vi.fn();
  for (const changed of [
    { senderId: 8 },
    { mainFrame: false },
    { frameUrl: 'file:///plugin/index.html' },
    { frameUrl: 'https://example.com', expectedUrl: 'https://example.com' },
  ])
    expect(await handleConsoleRequest({ ...source, ...changed }, [], action)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  expect(action).not.toHaveBeenCalled();
});
it('does not return a native failure message to the page', async () => {
  const result = await handleConsoleRequest(source, [], () => {
    throw new Error('PRIVATE_INTERNAL_PATH');
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INTERNAL_PATH');
});

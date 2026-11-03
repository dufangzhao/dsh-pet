import { expect, it, vi } from 'vitest';
import type { SettingsDestination } from '@pet/contracts';
import { handleSettingsOpenRequest } from './settings-open-request.js';
const source = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///pet/index.html',
  expectedUrl: 'file:///pet/index.html',
};
it('waits for the existing Console to open before navigating to a fixed destination', async () => {
  let finish = () => {};
  const opened = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const open = vi.fn(() => opened),
    navigate = vi.fn();
  const waiting = handleSettingsOpenRequest(source, [{ view: 'appearance' }], open, navigate);
  expect(open).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  finish();
  expect(await waiting).toEqual({ ok: true, value: null });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ view: 'appearance' });
});
it('keeps the current view when no destination is supplied', async () => {
  const open = vi.fn(),
    navigate = vi.fn();
  expect(await handleSettingsOpenRequest(source, [], open, navigate)).toEqual({
    ok: true,
    value: null,
  });
  expect(open).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
});
it.each<SettingsDestination>([
  'start',
  'persona',
  'appearance',
  'conversation',
  'voice',
  'plugins',
  'about',
])('accepts the existing %s destination', async (view) => {
  const navigate = vi.fn();
  expect(await handleSettingsOpenRequest(source, [{ view }], () => {}, navigate)).toEqual({
    ok: true,
    value: null,
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ view });
});
it('rejects untrusted senders before opening or navigating', async () => {
  const open = vi.fn(),
    navigate = vi.fn();
  for (const changed of [
    { senderId: 8 },
    { mainFrame: false },
    { frameUrl: 'file:///plugin/index.html' },
    { frameUrl: 'https://example.com', expectedUrl: 'https://example.com' },
  ])
    expect(
      await handleSettingsOpenRequest(
        { ...source, ...changed },
        [{ view: 'voice' }],
        open,
        navigate,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(open).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
it('accepts only zero arguments or one exact destination object', async () => {
  const open = vi.fn(),
    navigate = vi.fn();
  const getter = Object.defineProperty({}, 'view', {
    enumerable: true,
    get() {
      throw new Error('do not invoke');
    },
  });
  for (const args of [
    [undefined],
    [null],
    ['voice'],
    [[]],
    [{}],
    [{ view: 'unknown' }],
    [{ view: 'voice', url: 'x' }],
    [{ view: 'voice' }, {}],
    [getter],
  ])
    expect(await handleSettingsOpenRequest(source, args, open, navigate)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(open).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
it('returns fixed failure when opening or navigating fails', async () => {
  const fail = () => {
    throw new Error('PRIVATE_NATIVE_PATH');
  };
  const navigate = vi.fn();
  const failedOpen = await handleSettingsOpenRequest(source, [{ view: 'voice' }], fail, navigate);
  expect(navigate).not.toHaveBeenCalled();
  const failedNavigate = await handleSettingsOpenRequest(
    source,
    [{ view: 'voice' }],
    () => {},
    fail,
  );
  for (const result of [failedOpen, failedNavigate]) {
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_PATH');
  }
});

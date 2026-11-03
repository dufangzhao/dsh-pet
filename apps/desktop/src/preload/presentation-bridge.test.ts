import { expect, it, vi } from 'vitest';
import { PRESENTATION_IPC, type PetPresentationTheme, type Result } from '@pet/contracts';
import { createPresentationBridge } from './presentation-bridge.js';
const theme: PetPresentationTheme = {
  appearance: 'dark',
  colors: {
    surface: '#121212',
    surfaceQuiet: '#242424',
    ink: '#eeeeee',
    inkQuiet: '#bbbbbb',
    line: '#666666',
    field: '#242424',
    primary: '#99aaff',
    onPrimary: '#121212',
  },
};
it('exposes a frozen fixed bridge and forwards only its declared calls', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: null }));
  const bridge = createPresentationBridge(
    invoke,
    () => () => {},
    () => () => {},
  );
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge).sort()).toEqual([
    'completeAppearance',
    'getSnapshot',
    'onAppearanceRequested',
    'onChanged',
    'publishTheme',
    'setAppearance',
    'version',
  ]);
  await bridge.getSnapshot();
  await bridge.publishTheme(theme);
  await bridge.setAppearance({ appearance: 'light' });
  await bridge.completeAppearance({ id: 'request-1', applied: true });
  expect(invoke.mock.calls).toEqual([
    [PRESENTATION_IPC.snapshot],
    [PRESENTATION_IPC.publish, theme],
    [PRESENTATION_IPC.setAppearance, { appearance: 'light' }],
    [PRESENTATION_IPC.completeAppearance, { id: 'request-1', applied: true }],
  ]);
});
it('rejects wrong arity and request shapes before IPC', async () => {
  const invoke = vi.fn();
  const bridge = createPresentationBridge(
    invoke,
    () => () => {},
    () => () => {},
  );
  const call = (
    method: 'getSnapshot' | 'publishTheme' | 'setAppearance' | 'completeAppearance',
    ...args: unknown[]
  ) => (bridge[method] as (...args: unknown[]) => Promise<Result<unknown>>)(...args);
  const results = [
    await call('getSnapshot', 'extra'),
    await call('publishTheme'),
    await call('publishTheme', theme, {}),
    await call('setAppearance'),
    await call('setAppearance', { appearance: 'system' }),
    await call('setAppearance', { appearance: 'dark', key: 'x' }),
    await call('setAppearance', { appearance: 'dark' }, {}),
    await call('completeAppearance', { id: 'x', applied: 1 }),
    await call('completeAppearance', { id: '', applied: true }),
    await call('completeAppearance', { id: 'x', applied: true, extra: true }),
    await call('completeAppearance', { id: 'x', applied: true }, {}),
  ];
  for (const result of results)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).not.toHaveBeenCalled();
});
it('filters appearance events, copies valid payloads and disposes both subscriptions', () => {
  let changed = () => {};
  let requested = (_request: unknown) => {};
  const offChanged = vi.fn(),
    offRequested = vi.fn();
  const bridge = createPresentationBridge(
    vi.fn(),
    (callback) => {
      changed = callback;
      return offChanged;
    },
    (callback) => {
      requested = callback;
      return offRequested;
    },
  );
  const onChanged = vi.fn(),
    onRequested = vi.fn();
  const stopChanged = bridge.onChanged(onChanged),
    stopRequested = bridge.onAppearanceRequested(onRequested);
  for (const value of [
    null,
    { id: 'x', appearance: 'system' },
    { id: 'x', appearance: 'dark', extra: 1 },
    { id: '', appearance: 'dark' },
  ])
    requested(value);
  expect(onRequested).not.toHaveBeenCalled();
  const value = { id: 'x', appearance: 'dark' };
  requested(value);
  value.id = 'changed';
  expect(onRequested).toHaveBeenCalledExactlyOnceWith({ id: 'x', appearance: 'dark' });
  changed();
  expect(onChanged).toHaveBeenCalledOnce();
  stopChanged();
  stopRequested();
  expect(offChanged).toHaveBeenCalledOnce();
  expect(offRequested).toHaveBeenCalledOnce();
  for (const method of [bridge.onChanged, bridge.onAppearanceRequested]) {
    const call = method as (...args: unknown[]) => unknown;
    expect(() => call()).toThrow(TypeError);
    expect(() => call(() => {}, 'extra')).toThrow(TypeError);
  }
});
it('maps a transport failure to a fixed error for new requests', async () => {
  const bridge = createPresentationBridge(
    async () => {
      throw new Error('PRIVATE_TRANSPORT');
    },
    () => () => {},
    () => () => {},
  );
  for (const result of [
    await bridge.setAppearance({ appearance: 'dark' }),
    await bridge.completeAppearance({ id: 'x', applied: false }),
  ]) {
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT');
  }
});

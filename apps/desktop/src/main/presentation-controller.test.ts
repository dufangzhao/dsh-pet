import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PetAppearanceRequest, PetPresentationTheme } from '@pet/contracts';
import type { DemoRequestSource } from './demo-request.js';
import { handlePresentationRequest, PresentationController } from './presentation-controller.js';

const source: DemoRequestSource = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
  role: 'console',
};
const pet: DemoRequestSource = { ...source, role: 'pet' };
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
const controllers: PresentationController[] = [];
function setup() {
  const changed = vi.fn();
  const dispatch = vi.fn<(request: PetAppearanceRequest) => void>();
  const controller = new PresentationController(changed, dispatch);
  controllers.push(controller);
  const request = () => {
    const call = dispatch.mock.lastCall;
    if (!call) throw new Error('Expected appearance request');
    return call[0];
  };
  return { controller, changed, dispatch, request };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.ownerClosed();
  vi.useRealTimers();
});

it('returns the published snapshot only after a fresh matching publication and exact receipt', async () => {
  const { controller, dispatch, request, changed } = setup();
  const waiting = handlePresentationRequest(
    pet,
    'setAppearance',
    [{ appearance: 'dark' }],
    controller,
  );
  const settled = vi.fn();
  void waiting.then(settled);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(request().appearance).toBe('dark');
  expect(await handlePresentationRequest(source, 'publish', [theme], controller)).toEqual({
    ok: true,
    value: { version: 1, theme },
  });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(
    await handlePresentationRequest(
      source,
      'completeAppearance',
      [{ id: request().id, applied: true }],
      controller,
    ),
  ).toEqual({ ok: true, value: null });
  expect(await waiting).toEqual({ ok: true, value: { version: 1, theme } });
  expect(changed).toHaveBeenCalledOnce();
  const snapshot = controller.snapshot();
  if (snapshot.theme) snapshot.theme.colors.surface = '#ffffff';
  expect(controller.snapshot().theme).toEqual(theme);
});

it('keeps a pending request through stale or pet-window receipts and rejects concurrent changes', async () => {
  const { controller, dispatch, request } = setup();
  const waiting = controller.setAppearance({ appearance: 'dark' });
  expect(await controller.setAppearance({ appearance: 'light' })).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(controller.completeAppearance({ id: 'old-request', applied: true })).toMatchObject({
    ok: false,
    error: { code: 'stale-owner' },
  });
  expect(
    await handlePresentationRequest(
      pet,
      'completeAppearance',
      [{ id: request().id, applied: true }],
      controller,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(await handlePresentationRequest(pet, 'publish', [theme], controller)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  expect(dispatch).toHaveBeenCalledOnce();
  controller.publish(theme);
  controller.completeAppearance({ id: request().id, applied: true });
  expect(await waiting).toMatchObject({ ok: true });
});

it.each(['already-published', 'wrong-appearance'] as const)(
  'rejects a positive receipt with %s state',
  async (kind) => {
    const { controller, request } = setup();
    controller.publish(theme);
    const waiting = controller.setAppearance({ appearance: 'dark' });
    if (kind === 'wrong-appearance') controller.publish({ ...theme, appearance: 'light' });
    expect(controller.completeAppearance({ id: request().id, applied: true })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'conflict' } });
  },
);

it('returns unavailable when the owner cannot persist or apply the request', async () => {
  const { controller, request } = setup();
  const waiting = controller.setAppearance({ appearance: 'dark' });
  controller.publish(theme);
  expect(controller.completeAppearance({ id: request().id, applied: false })).toEqual({
    ok: true,
    value: null,
  });
  expect(await waiting).toMatchObject({ ok: false, error: { code: 'unavailable' } });
});

it('bounds the receipt wait to five seconds and clears pending work on owner close', async () => {
  vi.useFakeTimers();
  const { controller, request } = setup();
  const waiting = controller.setAppearance({ appearance: 'dark' });
  const oldId = request().id;
  const settled = vi.fn();
  void waiting.then(settled);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await waiting).toMatchObject({ ok: false, error: { code: 'timeout' } });
  const next = controller.setAppearance({ appearance: 'light' });
  expect(request().id).not.toBe(oldId);
  expect(controller.completeAppearance({ id: oldId, applied: true })).toMatchObject({
    ok: false,
    error: { code: 'stale-owner' },
  });
  controller.ownerClosed();
  expect(await next).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not keep a busy request when dispatch fails', async () => {
  const controller = new PresentationController(
    () => {},
    () => {
      throw new Error('PRIVATE_HOST');
    },
  );
  for (let i = 0; i < 2; i++) {
    const result = await controller.setAppearance({ appearance: 'dark' });
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_HOST');
  }
});

it('does not expose a native publication failure through IPC', async () => {
  const controller = new PresentationController(
    () => {
      throw new Error('PRIVATE_NATIVE_PATH');
    },
    () => {},
  );
  const result = await handlePresentationRequest(source, 'publish', [theme], controller);
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_PATH');
});

describe('presentation IPC boundary', () => {
  it('rejects unknown windows, subframes, changed files and remote URLs', async () => {
    const { controller, dispatch } = setup();
    for (const changed of [
      { senderId: 8 },
      { mainFrame: false },
      { frameUrl: 'file:///plugin/index.html' },
      { expectedUrl: 'https://example.com', frameUrl: 'https://example.com' },
    ]) {
      expect(
        await handlePresentationRequest(
          { ...source, ...changed },
          'setAppearance',
          [{ appearance: 'dark' }],
          controller,
        ),
      ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('validates exact argument counts and shapes before invoking the owner', async () => {
    const { controller, dispatch } = setup();
    for (const args of [
      [],
      [undefined],
      ['dark'],
      [{ appearance: 'system' }],
      [{ appearance: 'dark', path: 'x' }],
      [{ appearance: 'dark' }, {}],
    ])
      expect(
        await handlePresentationRequest(source, 'setAppearance', args, controller),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    for (const args of [
      [],
      [{ id: 'x', applied: 1 }],
      [{ id: '', applied: true }],
      [{ id: 'x', applied: true, extra: true }],
    ])
      expect(
        await handlePresentationRequest(source, 'completeAppearance', args, controller),
      ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(
      await handlePresentationRequest(source, 'snapshot', ['extra'], controller),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(
      await handlePresentationRequest(
        source,
        'publish',
        [{ ...theme, colors: { ...theme.colors, line: 'red' } }],
        controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(await handlePresentationRequest(source, 'snapshot', [], controller)).toEqual({
      ok: true,
      value: { version: 1, theme: null },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

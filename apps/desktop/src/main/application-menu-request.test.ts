import { expect, it, vi } from 'vitest';
import { makeError } from '@pet/contracts';
import { handleApplicationRequest } from './application-request.js';
import type { ApplicationController } from './application-controller.js';
const source = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///pet.html',
  expectedUrl: 'file:///pet.html',
};
it('forwards an exact pause request and preserves the Core failure receipt', async () => {
  const result = { ok: false as const, error: makeError('not-ready', false) };
  const setPaused = vi.fn(async () => result);
  const controller = { setPaused } as unknown as ApplicationController;
  expect(await handleApplicationRequest(source, 'paused', [{ paused: true }], controller)).toEqual(
    result,
  );
  expect(setPaused).toHaveBeenCalledWith(true);
  for (const args of [
    [],
    [{ paused: 'yes' }],
    [{ paused: false, action: 'exec' }],
    [{ paused: true }, 1],
  ])
    expect(await handleApplicationRequest(source, 'paused', args, controller)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(setPaused).toHaveBeenCalledTimes(1);
  expect(
    await handleApplicationRequest(
      { ...source, senderId: 2 },
      'paused',
      [{ paused: false }],
      controller,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(setPaused).toHaveBeenCalledTimes(1);
});

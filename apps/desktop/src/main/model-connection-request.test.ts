import { describe, it, expect, vi } from 'vitest';
import { handleModelConnectionRequest } from './model-connection-request.js';
import type { ModelConnectionController } from './model-connection-controller.js';
const source = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
};
function setup() {
  const getModels = vi.fn(async (id: string) => ({
      ok: true,
      value: { id, models: ['fixture-model'] },
    })),
    testSelected = vi.fn(async () => ({
      ok: true,
      value: { id: 'deepseek', model: 'fixture-model', test: { ok: true, elapsedMs: 1 } },
    })),
    saveAndStart = vi.fn(async () => ({ ok: false, error: { code: 'not-ready' } }));
  return {
    controller: { getModels, testSelected, saveAndStart } as unknown as ModelConnectionController,
    getModels,
    testSelected,
    saveAndStart,
  };
}
describe('fixed Start model-query request boundary', () => {
  it('forwards only the selected ID and optional draft Key for model discovery', async () => {
    const f = setup();
    expect(
      (
        await handleModelConnectionRequest(
          source,
          'models',
          [{ id: 'deepseek', key: 'FIXTURE_KEY' }],
          f.controller,
        )
      ).ok,
    ).toBe(true);
    expect(f.getModels).toHaveBeenCalledWith('deepseek', 'FIXTURE_KEY');
    expect(f.saveAndStart).not.toHaveBeenCalled();
  });
  it.each([
    { args: [] },
    { args: [{ id: 'deepseek', url: 'https://untrusted.example' }] },
    { args: [{ id: 'deepseek', key: 'invalid' + String.fromCharCode(10) }] },
    { args: [{ id: 'deepseek' }, {}] },
  ])('rejects malformed catalog arguments: %j', async ({ args }) => {
    const f = setup();
    expect(await handleModelConnectionRequest(source, 'models', args, f.controller)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
    expect(f.getModels).not.toHaveBeenCalled();
  });
  it('requires the exact trusted console source before credential-bearing operations', async () => {
    const f = setup();
    expect(
      await handleModelConnectionRequest(
        { ...source, frameUrl: source.frameUrl + '?other' },
        'models',
        [{ id: 'deepseek' }],
        f.controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(f.getModels).not.toHaveBeenCalled();
  });
  it('validates the selected model and finite reasoning effort for a nonmutating test', async () => {
    const f = setup();
    const value = { id: 'deepseek', model: 'fixture-model', reasoningEffort: 'high' };
    expect(
      (await handleModelConnectionRequest(source, 'testSelected', [value], f.controller)).ok,
    ).toBe(true);
    expect(f.testSelected).toHaveBeenCalledWith(value);
    expect(
      await handleModelConnectionRequest(
        source,
        'testSelected',
        [{ ...value, reasoningEffort: 'unbounded' }],
        f.controller,
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(f.testSelected).toHaveBeenCalledOnce();
  });
  it('forwards reasoning effort only through the existing revisioned save request', async () => {
    const f = setup();
    await handleModelConnectionRequest(
      source,
      'save',
      [{ id: 'deepseek', model: 'fixture-model', expectedRevision: 2, reasoningEffort: 'medium' }],
      f.controller,
    );
    expect(f.saveAndStart).toHaveBeenCalledWith(
      'deepseek',
      'fixture-model',
      2,
      undefined,
      'medium',
    );
  });
});

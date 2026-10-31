import { describe, it, expect, vi } from 'vitest';
import { DEMO_PLUGIN_IDS, modelService, makeError } from '@pet/contracts';
import { CredentialBroker, MemoryCiphertextStore, TaskSupervisor } from '@pet/host-kernel';
import { ModelConnectionController } from './model-connection-controller.js';
import type { DesktopHost } from './desktop-host.js';
import type { ApplicationController } from './application-controller.js';
async function fixture(allowed = true) {
  const owner = { pluginId: DEMO_PLUGIN_IDS.cloud, instanceId: 'default', generation: 1 };
  const life = new AbortController();
  const tasks = new TaskSupervisor({
    isActive: () => true,
    isLive: () => true,
    signal: () => life.signal,
  });
  const credentials = new CredentialBroker({
    store: new MemoryCiphertextStore(),
    cipher: {
      encrypt: async (s) => new TextEncoder().encode(s),
      decrypt: async (b) => ({ plaintext: new TextDecoder().decode(b), shouldReEncrypt: false }),
    },
    authorize: async () => ({ isValid: () => true, close: () => {} }),
  });
  const endpoint = modelService('deepseek')!;
  credentials.issueClient(owner, [endpoint.secretKey]);
  await credentials.setSecret(owner, endpoint.secretKey, 'SAVED_QUERY_FIXTURE_KEY');
  const save = vi.fn(),
    select = vi.fn(),
    changed = vi.fn(),
    close = vi.fn();
  const get = vi.fn(async () => ({
    ok: true,
    value: {
      revision: 3,
      data: { models: { deepseek: 'saved-model' }, reasoningEfforts: { deepseek: 'low' } },
    },
  }));
  const authorize = vi.fn(async () =>
    allowed
      ? { ok: true, value: { signal: new AbortController().signal, isValid: () => true, close } }
      : { ok: false, error: makeError('permission-denied') },
  );
  const host = {
    credentials,
    tasks,
    configs: { get, save },
    manager: {
      get: () => ({
        owner,
        manifest: { permissions: [{ kind: 'credentials', keys: [endpoint.secretKey] }] },
      }),
      isActive: () => true,
      capabilities: { select },
    },
    getPackage: () => ({ manifest: { id: DEMO_PLUGIN_IDS.cloud }, origin: 'local', files: [] }),
    describeTrust: () => ({ trusted: true, digest: 'fixture' }),
    verifyTrust: async () => true,
    permissionControl: { confirmTrust: () => {} },
    permissions: { authorize },
  } as unknown as DesktopHost;
  const catalogFetch = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ data: [{ id: 'fetched-one' }, { id: 'fetched-two' }] })),
  );
  const connectionTest = vi.fn(async () => ({ ok: true, elapsedMs: 4, model: 'draft-model' }));
  const controller = new ModelConnectionController(
    host,
    {} as ApplicationController,
    changed,
    async () => {},
    catalogFetch,
    connectionTest,
  );
  return {
    controller,
    host,
    credentials,
    tasks,
    save,
    select,
    changed,
    close,
    authorize,
    catalogFetch,
    connectionTest,
    endpoint,
  };
}
describe('selected-provider read-only model controls', () => {
  it('queries with the typed key without overwriting the saved credential or active configuration', async () => {
    const f = await fixture();
    const before = await f.host.configs.get({
      pluginId: DEMO_PLUGIN_IDS.cloud,
      instanceId: 'default',
    });
    expect(await f.controller.getModels('deepseek', 'DRAFT_QUERY_FIXTURE_KEY')).toEqual({
      ok: true,
      value: { id: 'deepseek', models: ['fetched-one', 'fetched-two'] },
    });
    expect(f.catalogFetch).toHaveBeenCalledOnce();
    const [url, init] = f.catalogFetch.mock.calls[0]!;
    expect(String(url)).toBe(
      f.endpoint.baseUrl + (f.endpoint.baseUrl.endsWith('/') ? 'models' : '/models'),
    );
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer DRAFT_QUERY_FIXTURE_KEY');
    expect(init?.method).toBe('GET');
    expect(
      await f.host.configs.get({ pluginId: DEMO_PLUGIN_IDS.cloud, instanceId: 'default' }),
    ).toEqual(before);
    expect(
      await f.credentials.withSecretForHost(
        { pluginId: DEMO_PLUGIN_IDS.cloud, instanceId: 'default', generation: 1 },
        [f.endpoint.secretKey],
        f.endpoint.secretKey,
        { taskId: 'verify', signal: new AbortController().signal },
        async (key) => key,
      ),
    ).toBe('SAVED_QUERY_FIXTURE_KEY');
    expect(f.save).not.toHaveBeenCalled();
    expect(f.select).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('uses the same stored credential when no draft key is supplied', async () => {
    const f = await fixture();
    expect((await f.controller.getModels('deepseek')).ok).toBe(true);
    expect(new Headers(f.catalogFetch.mock.calls[0]![1]?.headers).get('authorization')).toBe(
      'Bearer SAVED_QUERY_FIXTURE_KEY',
    );
  });
  it('does not fetch when network permission is denied', async () => {
    const f = await fixture(false);
    const r = await f.controller.getModels('deepseek', 'DRAFT_QUERY_FIXTURE_KEY');
    expect(r).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(f.catalogFetch).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('tests the selected draft model and effort without saving or changing the active provider', async () => {
    const f = await fixture();
    const r = await f.controller.testSelected({
      id: 'deepseek',
      model: 'draft-model',
      key: 'DRAFT_QUERY_FIXTURE_KEY',
      reasoningEffort: 'high',
    });
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'deepseek',
        model: 'draft-model',
        test: { ok: true, elapsedMs: 4, model: 'draft-model' },
      },
    });
    expect(f.connectionTest).toHaveBeenCalledWith(
      f.endpoint,
      'draft-model',
      'DRAFT_QUERY_FIXTURE_KEY',
      expect.any(AbortSignal),
      'high',
    );
    expect(f.catalogFetch).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.select).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
  });
  it('does not expose an upstream model ID that reflects the supplied Key', async () => {
    const f = await fixture();
    f.catalogFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'DRAFT_QUERY_FIXTURE_KEY' }] })),
    );
    const r = await f.controller.getModels('deepseek', 'DRAFT_QUERY_FIXTURE_KEY');
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(r)).not.toContain('DRAFT_QUERY_FIXTURE_KEY');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { CredentialBroker } from './credential-broker.js';
import { MemoryCiphertextStore } from './ciphertext-store.js';
const owner = { pluginId: 'test.catalog', instanceId: 'default', generation: 1 };
const task = () => ({ taskId: 'catalog-query', signal: new AbortController().signal });
function setup(allowed = true) {
  const store = new MemoryCiphertextStore(),
    close = vi.fn();
  const cipher = {
    encrypt: vi.fn(async (text: string) => new TextEncoder().encode(text)),
    decrypt: vi.fn(async (bytes: Uint8Array) => ({
      plaintext: new TextDecoder().decode(bytes),
      shouldReEncrypt: false,
    })),
  };
  const authorize = vi.fn(async () => (allowed ? { isValid: () => true, close } : null));
  return {
    broker: new CredentialBroker({ store, cipher, authorize }),
    store,
    cipher,
    authorize,
    close,
  };
}
describe('host credential borrowing for selected-provider queries', () => {
  it('initializes the first host query and reuses that client for later normal runtime access', async () => {
    const { broker, cipher } = setup();
    expect(
      await broker.withSecretForHost(
        owner,
        ['key'],
        'key',
        task(),
        async (key) => key === 'DRAFT_CATALOG_KEY',
        'DRAFT_CATALOG_KEY',
      ),
    ).toBe(true);
    expect(await broker.hasSecret(owner, 'key')).toBe(false);
    expect(cipher.encrypt).not.toHaveBeenCalled();
    const runtimeClient = broker.clientForHost(owner, ['key']);
    await broker.setSecret(owner, 'key', 'SAVED_CATALOG_KEY');
    expect(await runtimeClient.withSecret('key', task(), async (key) => key)).toBe(
      'SAVED_CATALOG_KEY',
    );
  });
  it('uses a one-operation draft key without persisting it or replacing the existing client', async () => {
    const { broker, cipher, close } = setup();
    const client = broker.issueClient(owner, ['key']);
    await broker.setSecret(owner, 'key', 'SAVED_CATALOG_KEY');
    cipher.encrypt.mockClear();
    cipher.decrypt.mockClear();
    const value = await broker.withSecretForHost(
      owner,
      ['key'],
      'key',
      task(),
      async (key) => key === 'DRAFT_CATALOG_KEY',
      'DRAFT_CATALOG_KEY',
    );
    expect(value).toBe(true);
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(cipher.decrypt).not.toHaveBeenCalled();
    expect(broker.redactor.contains('DRAFT_CATALOG_KEY')).toBe(true);
    expect(await client.withSecret('key', task(), async (key) => key)).toBe('SAVED_CATALOG_KEY');
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('resolves the saved key when the query has no supplied key', async () => {
    const { broker } = setup();
    broker.issueClient(owner, ['key']);
    await broker.setSecret(owner, 'key', 'SAVED_CATALOG_KEY');
    expect(await broker.withSecretForHost(owner, ['key'], 'key', task(), async (key) => key)).toBe(
      'SAVED_CATALOG_KEY',
    );
  });
  it('keeps credential authorization and declared-key checks for a supplied key', async () => {
    const { broker, authorize } = setup(false);
    broker.issueClient(owner, ['key']);
    const op = vi.fn(async () => true);
    await expect(
      broker.withSecretForHost(owner, ['key'], 'key', task(), op, 'DRAFT_CATALOG_KEY'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(authorize).toHaveBeenCalledOnce();
    expect(op).not.toHaveBeenCalled();
    await expect(
      broker.withSecretForHost(owner, ['key'], 'undeclared', task(), op, 'DRAFT_CATALOG_KEY'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('refuses stale host generations without invalidating the current plugin client', async () => {
    const { broker } = setup();
    broker.issueClient(owner, ['key']);
    const current = { ...owner, generation: 2 };
    const client = broker.issueClient(current, ['key']);
    await broker.setSecret(current, 'key', 'SAVED_CATALOG_KEY');
    await expect(
      broker.withSecretForHost(
        owner,
        ['key'],
        'key',
        task(),
        async () => true,
        'DRAFT_CATALOG_KEY',
      ),
    ).rejects.toMatchObject({ code: 'stale-owner' });
    expect(await client.withSecret('key', task(), async (key) => key)).toBe('SAVED_CATALOG_KEY');
  });
  it('aborts an in-flight supplied-key query when its registered owner is revoked', async () => {
    const { broker } = setup();
    broker.issueClient(owner, ['key']);
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const result = broker.withSecretForHost(
      owner,
      ['key'],
      'key',
      task(),
      async (_, signal) => {
        entered();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return true;
      },
      'DRAFT_CATALOG_KEY',
    );
    await ready;
    broker.revoke(owner);
    await expect(result).rejects.toMatchObject({ code: 'stale-owner' });
  });
});

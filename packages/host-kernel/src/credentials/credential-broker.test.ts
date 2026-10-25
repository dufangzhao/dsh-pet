import { describe, expect, it, vi } from 'vitest';
import {
  CredentialBroker,
  type CredentialAuthorizationLease,
  type CredentialAuthorizer,
  type CredentialOwner,
} from './credential-broker.js';
import { MemoryCiphertextStore } from './ciphertext-store.js';
import type { DecryptedSecret, SecretCipher } from './secret-cipher.js';

const a: CredentialOwner = { pluginId: 'test.alpha', instanceId: 'default', generation: 1 };
const b: CredentialOwner = { pluginId: 'test.beta', instanceId: 'default', generation: 1 };
const task = (signal = new AbortController().signal) => ({ taskId: 'task-1', signal });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(authorize?: CredentialAuthorizer) {
  const store = new MemoryCiphertextStore();
  const plaintexts = new Map<number, string>();
  let token = 0;
  const cipher: SecretCipher = {
    encrypt: vi.fn(async (text) => {
      plaintexts.set(++token, text);
      return new Uint8Array([token]);
    }),
    decrypt: vi.fn(async (bytes) => ({
      plaintext: plaintexts.get(bytes[0] ?? 0) ?? 'invalid',
      shouldReEncrypt: false,
    })),
  };
  const close = vi.fn();
  const lease: CredentialAuthorizationLease = { isValid: () => true, close };
  const auth = authorize ?? vi.fn(async () => lease);
  const broker = new CredentialBroker({ store, cipher, authorize: auth });
  return { store, cipher, broker, close, auth };
}

describe('credential namespace and generation', () => {
  it('binds each client to its own namespace without a namespace argument', async () => {
    const { broker } = fixture();
    await broker.setSecret(a, 'api-key', 'alpha-public-fixture');
    await broker.setSecret(b, 'api-key', 'beta-public-fixture');
    const ca = broker.issueClient(a, ['api-key']),
      cb = broker.issueClient(b, ['api-key']);
    expect(await ca.withSecret('api-key', task(), async (value) => value)).toBe(
      'alpha-public-fixture',
    );
    expect(await cb.withSecret('api-key', task(), async (value) => value)).toBe(
      'beta-public-fixture',
    );
    expect(Object.isFrozen(ca)).toBe(true);
  });
  it('separates instances of the same plugin', async () => {
    const { broker } = fixture();
    const second = { ...a, instanceId: 'second' };
    await broker.setSecret(a, 'key', 'first');
    await broker.setSecret(second, 'key', 'second');
    expect(await broker.issueClient(a, ['key']).withSecret('key', task(), async (v) => v)).toBe(
      'first',
    );
    expect(
      await broker.issueClient(second, ['key']).withSecret('key', task(), async (v) => v),
    ).toBe('second');
  });
  it('denies undeclared keys before touching storage or authorizer', async () => {
    const { broker, store, auth } = fixture();
    const read = vi.spyOn(store, 'read');
    await expect(
      broker.issueClient(a, ['allowed']).withSecret('other', task(), async (v) => v),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(read).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
  });
  it('defaults to deny without an authorizer', async () => {
    const f = fixture();
    const broker = new CredentialBroker({ store: f.store, cipher: f.cipher });
    await expect(
      broker.issueClient(a, ['key']).withSecret('key', task(), async (v) => v),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('revokes old clients and never reuses an enabled generation', async () => {
    const { broker } = fixture();
    await broker.setSecret(a, 'key', 'fixture');
    const old = broker.issueClient(a, ['key']);
    broker.revoke(a);
    await expect(old.withSecret('key', task(), async (v) => v)).rejects.toMatchObject({
      code: 'stale-owner',
    });
    expect(() => broker.issueClient(a, ['key'])).toThrow();
    const next = broker.issueClient({ ...a, generation: 2 }, ['key']);
    broker.revoke(a);
    expect(await next.withSecret('key', task(), async (v) => v)).toBe('fixture');
  });
  it('rejects malformed identities and path-like aliases', async () => {
    const { broker } = fixture();
    expect(() => broker.issueClient({ ...a, generation: 0 }, ['key'])).toThrow();
    await expect(broker.setSecret(a, '../key', 'fixture')).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(broker.setSecret(a, 'key', '')).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('credential cancellation and approval lifetime', () => {
  it('does not open approval if cancellation wins before its microtask', async () => {
    const f = fixture();
    const ac = new AbortController();
    const result = f.broker
      .issueClient(a, ['key'])
      .withSecret('key', task(ac.signal), async () => true);
    ac.abort();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.auth).not.toHaveBeenCalled();
  });
  it('rejects pre-cancelled operations before approval', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.broker.issueClient(a, ['key']).withSecret('key', task(controller.signal), async (v) => v),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.auth).not.toHaveBeenCalled();
  });
  it('cancels pending approval promptly and closes a late lease', async () => {
    const pending = deferred<CredentialAuthorizationLease | null>();
    const closed = deferred<void>();
    const close = vi.fn(() => closed.resolve());
    const f = fixture(async () => pending.promise);
    const ac = new AbortController();
    const result = f.broker
      .issueClient(a, ['key'])
      .withSecret('key', task(ac.signal), async (v) => v);
    await Promise.resolve();
    ac.abort();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    pending.resolve({ isValid: () => true, close });
    await closed.promise;
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('drops decrypted output when its owner is disabled', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture');
    const pending = deferred<DecryptedSecret>();
    const entered = deferred<void>();
    f.cipher.decrypt = vi.fn(async () => {
      entered.resolve();
      return pending.promise;
    });
    const operation = vi.fn(async () => true);
    const result = f.broker.issueClient(a, ['key']).withSecret('key', task(), operation);
    await entered.promise;
    f.broker.revoke(a);
    await expect(result).rejects.toMatchObject({ code: 'stale-owner' });
    pending.resolve({ plaintext: 'not-deliverable', shouldReEncrypt: false });
    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();
  });
  it('rejects results after cancellation while the callback is running', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture');
    const pending = deferred<string>();
    const entered = deferred<void>();
    const ac = new AbortController();
    let received: AbortSignal | undefined;
    const result = f.broker
      .issueClient(a, ['key'])
      .withSecret('key', task(ac.signal), async (_secret, signal) => {
        received = signal;
        entered.resolve();
        return pending.promise;
      });
    await entered.promise;
    ac.abort();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(received?.aborted).toBe(true);
    pending.resolve('late');
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('checks a revocable lease before result delivery without authorizing twice', async () => {
    let valid = true;
    const close = vi.fn();
    const authorize = vi.fn(async () => ({ isValid: () => valid, close }));
    const f = fixture(authorize);
    await f.broker.setSecret(a, 'key', 'fixture');
    await expect(
      f.broker.issueClient(a, ['key']).withSecret('key', task(), async () => {
        valid = false;
        return 'late';
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('sanitizes callback failures and preserves known-secret redaction', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture-secret-123');
    await expect(
      f.broker.issueClient(a, ['key']).withSecret('key', task(), async (secret) => {
        throw new Error(secret);
      }),
    ).rejects.toMatchObject({
      code: 'internal',
      message: 'Credential operation refused: internal',
    });
    expect(f.broker.redactor.redact(new Error('Bearer fixture-secret-123'))).toBe(
      '[REDACTED diagnostic]',
    );
    expect(f.close).toHaveBeenCalledTimes(1);
  });
});

describe('ciphertext binding and storage failure', () => {
  it('does not deliver a pending old value after the credential is deleted', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture');
    const original = f.cipher.decrypt;
    const entered = deferred<void>();
    const release = deferred<void>();
    f.cipher.decrypt = async (bytes) => {
      const value = await original(bytes);
      entered.resolve();
      await release.promise;
      return value;
    };
    const callback = vi.fn(async () => true);
    const result = f.broker.issueClient(a, ['key']).withSecret('key', task(), callback);
    void result.catch(() => {});
    await entered.promise;
    await f.broker.deleteSecret(a, 'key');
    release.resolve();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(callback).not.toHaveBeenCalled();
  });
  it('does not hide an encryption-format migration signal', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture');
    const original = f.cipher.decrypt;
    f.cipher.decrypt = async (bytes) => ({ ...(await original(bytes)), shouldReEncrypt: true });
    const callback = vi.fn(async () => true);
    await expect(
      f.broker.issueClient(a, ['key']).withSecret('key', task(), callback),
    ).rejects.toMatchObject({ code: 'not-ready' });
    expect(callback).not.toHaveBeenCalled();
  });
  it('rejects a ciphertext copied into a different namespace', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'alpha');
    const bytes = await f.store.read(JSON.stringify([a.pluginId, a.instanceId, 'key']));
    if (!bytes) throw new Error('missing fixture');
    await f.store.write(JSON.stringify([b.pluginId, b.instanceId, 'key']), bytes);
    await expect(
      f.broker.issueClient(b, ['key']).withSecret('key', task(), async (v) => v),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('fails closed on encryption failure without storing plaintext', async () => {
    const f = fixture();
    const write = vi.spyOn(f.store, 'write');
    f.cipher.encrypt = vi.fn(async () => {
      throw new Error('private-secret');
    });
    await expect(f.broker.setSecret(a, 'key', 'private-secret')).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(write).not.toHaveBeenCalled();
  });
  it('serializes writes and recovers the queue after a failed write', async () => {
    const f = fixture();
    const write = vi.spyOn(f.store, 'write');
    write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(f.broker.setSecret(a, 'key', 'first')).rejects.toMatchObject({
      code: 'unavailable',
    });
    await f.broker.setSecret(a, 'key', 'second');
    const c = f.broker.issueClient(a, ['key']);
    expect(await c.withSecret('key', task(), async (v) => v)).toBe('second');
    await f.broker.deleteSecret(a, 'key');
    await expect(c.withSecret('key', task(), async (v) => v)).rejects.toMatchObject({
      code: 'not-ready',
    });
  });
});
describe('credential broker shutdown', () => {
  it('invalidates clients and rejects new management/client operations', async () => {
    const f = fixture();
    await f.broker.setSecret(a, 'key', 'fixture');
    const client = f.broker.issueClient(a, ['key']);
    f.broker.dispose();
    f.broker.dispose();
    await expect(client.withSecret('key', task(), async () => true)).rejects.toMatchObject({
      code: 'stale-owner',
    });
    await expect(f.broker.setSecret(a, 'key', 'next')).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(() => f.broker.issueClient({ ...a, generation: 2 }, ['key'])).toThrow();
  });
  it('does not commit encryption which finishes after shutdown', async () => {
    const f = fixture();
    const entered = deferred<void>();
    const pending = deferred<Uint8Array>();
    f.cipher.encrypt = async () => {
      entered.resolve();
      return pending.promise;
    };
    const write = vi.spyOn(f.store, 'write');
    const result = f.broker.setSecret(a, 'key', 'fixture');
    void result.catch(() => {});
    await entered.promise;
    f.broker.dispose();
    pending.resolve(new Uint8Array([1]));
    await expect(result).rejects.toMatchObject({ code: 'unavailable' });
    await f.broker.drainWrites();
    expect(write).not.toHaveBeenCalled();
  });
});

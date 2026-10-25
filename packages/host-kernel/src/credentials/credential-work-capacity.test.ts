import { expect, it, vi } from 'vitest';
import { CredentialBroker } from './credential-broker.js';
import { MemoryCiphertextStore } from './ciphertext-store.js';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('retains a 32-use budget while cancelled native decrypt promises remain pending', async () => {
  const owner = { pluginId: 'test.crypto-budget', instanceId: 'default', generation: 1 };
  const gate = deferred<void>();
  let entered = deferred<void>();
  const physical: Array<Promise<{ plaintext: string; shouldReEncrypt: boolean }>> = [];
  const decrypt = vi.fn((bytes: Uint8Array) => {
    const work = gate.promise.then(() => ({
      plaintext: Buffer.from(bytes).toString('utf8'),
      shouldReEncrypt: false,
    }));
    physical.push(work);
    entered.resolve();
    return work;
  });
  const authorize = vi.fn(async () => ({ isValid: () => true, close() {} }));
  const broker = new CredentialBroker({
    cipher: { encrypt: async (text) => Buffer.from(text), decrypt },
    store: new MemoryCiphertextStore(),
    authorize,
  });
  await broker.setSecret(owner, 'key', 'PUBLIC_CRYPTO_BUDGET');
  const client = broker.issueClient(owner, ['key']);
  const extraScope = new AbortController();
  let extra: Promise<boolean> | undefined;
  try {
    for (let i = 0; i < 32; i++) {
      entered = deferred<void>();
      const scope = new AbortController();
      const use = client.withSecret(
        'key',
        { taskId: 'task-' + i, signal: scope.signal },
        async () => true,
      );
      await entered.promise;
      scope.abort();
      await expect(use).rejects.toMatchObject({ code: 'cancelled' });
    }
    expect(decrypt).toHaveBeenCalledTimes(32);
    entered = deferred<void>();
    extra = client.withSecret(
      'key',
      { taskId: 'extra', signal: extraScope.signal },
      async () => true,
    );
    const outcome = await Promise.race([
      extra.then(
        () => ({ kind: 'success' }),
        (error) => ({ kind: 'error', code: (error as { code: string }).code }),
      ),
      entered.promise.then(() => ({ kind: 'native-work-started' })),
    ]);
    expect(outcome).toEqual({ kind: 'error', code: 'quota-exceeded' });
    expect(authorize).toHaveBeenCalledTimes(32);
    expect(decrypt).toHaveBeenCalledTimes(32);
  } finally {
    extraScope.abort();
    gate.resolve();
    await Promise.all(physical);
    await extra?.catch(() => {});
    broker.dispose();
  }
});

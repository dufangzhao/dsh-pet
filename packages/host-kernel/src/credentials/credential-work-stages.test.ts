import { expect, it, vi } from 'vitest';
import { CredentialBroker, CREDENTIAL_MAX_USES } from './credential-broker.js';
import { MemoryCiphertextStore } from './ciphertext-store.js';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
for (const stage of ['approval', 'read', 'callback'] as const)
  it('retains actual credential work and restores capacity at ' + stage, async () => {
    const owner = { pluginId: 'test.stage-budget', instanceId: 'default', generation: 1 },
      gate = deferred<void>();
    let entered = deferred<void>(),
      starts = 0;
    const hold = <T>(value: T): Promise<T> => {
      starts++;
      entered.resolve();
      return gate.promise.then(() => value);
    };
    const store = new MemoryCiphertextStore();
    if (stage === 'read') {
      const read = store.read.bind(store);
      vi.spyOn(store, 'read').mockImplementation((key) => read(key).then((value) => hold(value)));
    }
    const closed = vi.fn(),
      authorize = vi.fn(() =>
        stage === 'approval'
          ? hold({ isValid: () => true, close: closed })
          : Promise.resolve({ isValid: () => true, close: closed }),
      );
    const broker = new CredentialBroker({
      cipher: {
        encrypt: async (text) => Buffer.from(text),
        decrypt: async (bytes) => ({
          plaintext: Buffer.from(bytes).toString('utf8'),
          shouldReEncrypt: false,
        }),
      },
      store,
      authorize,
    });
    await broker.setSecret(owner, 'key', 'PUBLIC_STAGE_FIXTURE');
    const client = broker.issueClient(owner, ['key']),
      extraScope = new AbortController();
    let extra: Promise<boolean> | undefined;
    const operation = vi.fn(() => (stage === 'callback' ? hold(true) : Promise.resolve(true)));
    try {
      for (let i = 0; i < CREDENTIAL_MAX_USES; i++) {
        entered = deferred<void>();
        const scope = new AbortController();
        const using = client.withSecret(
          'key',
          { taskId: 'task-' + i, signal: scope.signal },
          operation,
        );
        await entered.promise;
        scope.abort();
        await expect(using).rejects.toMatchObject({ code: 'cancelled' });
      }
      expect(broker.diagnostics().pendingUses).toBe(CREDENTIAL_MAX_USES);
      entered = deferred<void>();
      extra = client.withSecret('key', { taskId: 'extra', signal: extraScope.signal }, operation);
      const outcome = await Promise.race([
        extra.then(
          () => ({ kind: 'success' }),
          (error) => ({ kind: 'error', code: (error as { code: string }).code }),
        ),
        entered.promise.then(() => ({ kind: 'extra-work' })),
      ]);
      expect(outcome).toEqual({ kind: 'error', code: 'quota-exceeded' });
      expect(starts).toBe(CREDENTIAL_MAX_USES);
      expect(authorize).toHaveBeenCalledTimes(CREDENTIAL_MAX_USES);
      gate.resolve();
      await broker.drainUses();
      expect(broker.diagnostics().pendingUses).toBe(0);
      expect(broker.diagnostics().pendingWork).toBe(0);
      expect(
        await client.withSecret(
          'key',
          { taskId: 'after-settlement', signal: new AbortController().signal },
          async () => true,
        ),
      ).toBe(true);
    } finally {
      extraScope.abort();
      gate.resolve();
      await extra?.catch(() => {});
      await broker.drainUses();
      broker.dispose();
    }
  });

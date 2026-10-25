/**
 * M1-06 重加密修复契约测试（doc29「重加密修复」一节）。
 *
 * 这里只钉住 \`CredentialBroker.repairSecret\` 的文档化契约：宿主控制面方法，按现有
 * 全局写队列/键世代读取旧密文、异步解密、校验原 envelope 的 namespace/keyId/secret
 * 形状、登记宿主脱敏表，并且只在 cipher 报告 \`shouldReEncrypt\` 时才重新封装并原子替换。
 *
 * 全部凭据都是公开合成字符串，密码学部分是内存 fake：\`legacy:\` 前缀的密文表示需要
 * 重加密的旧格式，\`current:\` 前缀表示当前格式。所有等待都由显式 deferred 或已经发生的
 * 事件驱动，没有定时器，也不假设某个 Promise 需要几轮微任务才结算。
 *
 * 全绿只说明 broker 符合这份契约，不是 Windows safeStorage 真机证据。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CredentialBroker,
  CredentialError,
  MemoryCiphertextStore,
  type CredentialNamespace,
  type SecretCipher,
} from '@pet/host-kernel';

/** 公开合成标识：不出现任何真实插件或真实凭据。 */
const alpha: CredentialNamespace = { pluginId: 'test.repair', instanceId: 'default' };
const beta: CredentialNamespace = { pluginId: 'test.other', instanceId: 'default' };
const KEY = 'api-key';
const SECRET = 'synthetic-repair-plaintext-0001';

const LEGACY = 'legacy:';
const CURRENT = 'current:';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RepairOutcome = 'repaired' | 'current';
interface RepairSurface {
  repairSecret(
    owner: CredentialNamespace,
    keyId: string,
    signal?: AbortSignal,
  ): Promise<RepairOutcome>;
}

function locatorOf(owner: CredentialNamespace, keyId: string): string {
  return JSON.stringify([owner.pluginId, owner.instanceId, keyId]);
}

function envelopeOf(owner: CredentialNamespace, keyId: string, secret: string): string {
  return JSON.stringify({
    version: 1,
    owner: { pluginId: owner.pluginId, instanceId: owner.instanceId },
    keyId,
    secret,
  });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** 把一次调用收敛成固定的 CredentialError，避免测试里散落 try/catch。 */
async function refusalOf(run: () => Promise<unknown>): Promise<CredentialError> {
  const outcome = await run().then(
    (value): { refused: false; value: unknown } => ({ refused: false, value }),
    (error: unknown): { refused: true; error: unknown } => ({ refused: true, error }),
  );
  if (!outcome.refused) throw new Error('expected the operation to be refused');
  if (!(outcome.error instanceof CredentialError)) {
    throw new Error('expected a CredentialError refusal, received a different failure');
  }
  return outcome.error;
}

function fixture() {
  const store = new MemoryCiphertextStore();
  const decrypt = vi.fn(
    async (ciphertext: Uint8Array): Promise<{ plaintext: string; shouldReEncrypt: boolean }> => {
      const text = decoder.decode(ciphertext);
      if (text.startsWith(LEGACY)) {
        return { plaintext: text.slice(LEGACY.length), shouldReEncrypt: true };
      }
      if (text.startsWith(CURRENT)) {
        return { plaintext: text.slice(CURRENT.length), shouldReEncrypt: false };
      }
      throw new Error('synthetic ciphertext rejected');
    },
  );
  const encrypt = vi.fn(async (plaintext: string): Promise<Uint8Array> =>
    encoder.encode(CURRENT + plaintext),
  );
  const cipher: SecretCipher = { encrypt, decrypt };
  const close = vi.fn();
  const authorize = vi.fn(async () => ({ isValid: () => true, close }));
  const broker = new CredentialBroker({ store, cipher, authorize });
  const repair = (owner: CredentialNamespace, keyId: string, signal?: AbortSignal) =>
    (broker as unknown as RepairSurface).repairSecret(owner, keyId, signal);
  const raw = (owner: CredentialNamespace, keyId: string) => store.read(locatorOf(owner, keyId));
  const textOf = (bytes: Uint8Array | null): string | null =>
    bytes ? decoder.decode(bytes) : null;
  const seedRaw = async (owner: CredentialNamespace, keyId: string, text: string) => {
    await store.write(locatorOf(owner, keyId), encoder.encode(text));
  };
  const seed = (owner: CredentialNamespace, keyId: string, secret: string, reEncrypt: boolean) =>
    seedRaw(owner, keyId, (reEncrypt ? LEGACY : CURRENT) + envelopeOf(owner, keyId, secret));
  return {
    broker,
    store,
    cipher,
    encrypt,
    decrypt,
    authorize,
    close,
    repair,
    raw,
    textOf,
    seed,
    seedRaw,
  };
}

type Fixture = ReturnType<typeof fixture>;

/** 让 decrypt 停在半途，用于驱动取消/失效时序；settled 在底层解密真正结算后触发。 */
function gateDecrypt(f: Fixture) {
  const entered = deferred();
  const release = deferred();
  const settled = deferred();
  const original = f.cipher.decrypt;
  f.cipher.decrypt = vi.fn(async (ciphertext: Uint8Array) => {
    entered.resolve();
    await release.promise;
    const value = await original(ciphertext);
    settled.resolve();
    return value;
  });
  return { entered, release, settled };
}

describe('credential repair: current and repaired outcomes', () => {
  it('reports current without writing when the cipher needs no migration', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, false);
    const before = await f.raw(alpha, KEY);
    const write = vi.spyOn(f.store, 'write');

    expect(await f.repair(alpha, KEY)).toBe('current');

    expect(f.encrypt).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it('re-wraps a legacy secret and keeps ordinary withSecret working afterwards', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const before = await f.raw(alpha, KEY);
    const client = f.broker.issueClient({ ...alpha, generation: 1 }, [KEY]);
    await expect(
      client.withSecret(
        KEY,
        { taskId: 'task-1', signal: new AbortController().signal },
        async (v) => v,
      ),
    ).rejects.toMatchObject({ code: 'not-ready' });

    expect(await f.repair(alpha, KEY)).toBe('repaired');

    const after = await f.raw(alpha, KEY);
    if (!after) throw new Error('repair left no ciphertext');
    expect(after).not.toEqual(before);
    const rewritten = f.textOf(after) ?? '';
    expect(rewritten.startsWith(CURRENT)).toBe(true);
    expect(JSON.parse(rewritten.slice(CURRENT.length))).toEqual({
      version: 1,
      owner: { pluginId: alpha.pluginId, instanceId: alpha.instanceId },
      keyId: KEY,
      secret: SECRET,
    });
    expect(f.encrypt).toHaveBeenCalledTimes(1);

    expect(
      await client.withSecret(
        KEY,
        { taskId: 'task-1', signal: new AbortController().signal },
        async (value) => value,
      ),
    ).toBe(SECRET);
  });

  it('registers the repaired plaintext with the host redactor', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    expect(f.broker.redactor.redact(new Error('Bearer ' + SECRET))).toBe('Bearer ' + SECRET);

    await f.repair(alpha, KEY);

    expect(f.broker.redactor.redact(new Error('Bearer ' + SECRET))).toBe('[REDACTED diagnostic]');
    expect(f.broker.redactor.redact('unrelated diagnostic text')).toBe('unrelated diagnostic text');
  });
});

describe('credential repair: missing, malformed and failing input', () => {
  it('reports not-ready for a missing record and creates nothing', async () => {
    const f = fixture();
    const write = vi.spyOn(f.store, 'write');

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'not-ready' });

    expect(f.decrypt).not.toHaveBeenCalled();
    expect(f.encrypt).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toBeNull();
  });

  it('refuses malformed identifiers before touching storage', async () => {
    const f = fixture();
    const read = vi.spyOn(f.store, 'read');

    expect(await refusalOf(() => f.repair(alpha, '../key'))).toMatchObject({
      code: 'invalid-input',
    });
    expect(
      await refusalOf(() => f.repair({ pluginId: 'Not A Plugin', instanceId: 'default' }, KEY)),
    ).toMatchObject({ code: 'invalid-input' });

    expect(read).not.toHaveBeenCalled();
  });

  // doc29 只固定「坏 envelope 是固定错误」：结构不可解析/版本不符算 unavailable，
  // 字段齐全但绑定形状不符（缺 secret、secret 非字符串）算 permission-denied。
  const malformed = [
    { name: 'unparseable JSON', body: 'not-json', code: 'unavailable' },
    { name: 'a JSON array', body: '[]', code: 'unavailable' },
    { name: 'JSON null', body: 'null', code: 'unavailable' },
    {
      name: 'an unknown envelope version',
      body: JSON.stringify({ version: 2, owner: alpha, keyId: KEY, secret: SECRET }),
      code: 'unavailable',
    },
    {
      name: 'a missing secret field',
      body: JSON.stringify({ version: 1, owner: alpha, keyId: KEY }),
      code: 'permission-denied',
    },
    {
      name: 'a non-string secret',
      body: JSON.stringify({ version: 1, owner: alpha, keyId: KEY, secret: 42 }),
      code: 'permission-denied',
    },
    {
      name: 'a missing owner object',
      body: JSON.stringify({ version: 1, keyId: KEY, secret: SECRET }),
      code: 'unavailable',
    },
  ];
  it.each(malformed)(
    'refuses $name without overwriting the stored ciphertext',
    async ({ body, code }) => {
      const f = fixture();
      await f.seedRaw(alpha, KEY, LEGACY + body);
      const before = await f.raw(alpha, KEY);

      expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code });

      expect(f.encrypt).not.toHaveBeenCalled();
      expect(await f.raw(alpha, KEY)).toEqual(before);
    },
  );

  it('refuses an envelope bound to a different keyId without overwriting it', async () => {
    const f = fixture();
    await f.seedRaw(alpha, KEY, LEGACY + envelopeOf(alpha, 'other-key', SECRET));
    const before = await f.raw(alpha, KEY);

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  it('refuses an envelope bound to a different namespace without overwriting it', async () => {
    const f = fixture();
    await f.seedRaw(alpha, KEY, LEGACY + envelopeOf(beta, KEY, SECRET));
    const before = await f.raw(alpha, KEY);

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({
      code: 'permission-denied',
    });

    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  const badSecrets = [
    { name: 'an empty secret', secret: '' },
    { name: 'a secret with a control character', secret: 'has\u0000nul' },
  ];
  it.each(badSecrets)(
    'refuses $name without overwriting the stored ciphertext',
    async ({ secret }) => {
      const f = fixture();
      await f.seedRaw(alpha, KEY, LEGACY + envelopeOf(alpha, KEY, secret));
      const before = await f.raw(alpha, KEY);

      expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({
        code: 'permission-denied',
      });

      expect(f.encrypt).not.toHaveBeenCalled();
      expect(await f.raw(alpha, KEY)).toEqual(before);
    },
  );

  it('does not overwrite the ciphertext when decryption fails', async () => {
    const f = fixture();
    await f.seedRaw(alpha, KEY, LEGACY + envelopeOf(alpha, KEY, SECRET));
    const before = await f.raw(alpha, KEY);
    f.cipher.decrypt = vi.fn(async () => {
      throw new Error('native decrypt failure');
    });

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  it('does not overwrite the ciphertext when re-encryption fails', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const before = await f.raw(alpha, KEY);
    f.cipher.encrypt = vi.fn(async () => {
      throw new Error('native encrypt failure');
    });

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    expect(await f.raw(alpha, KEY)).toEqual(before);
    const client = f.broker.issueClient({ ...alpha, generation: 1 }, [KEY]);
    await expect(
      client.withSecret(
        KEY,
        { taskId: 'task-1', signal: new AbortController().signal },
        async (v) => v,
      ),
    ).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('does not overwrite the ciphertext when the store read fails', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const before = await f.raw(alpha, KEY);
    vi.spyOn(f.store, 'read').mockRejectedValueOnce(new Error('io failure'));

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  it('reports a store write failure instead of claiming the repair succeeded', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    vi.spyOn(f.store, 'write').mockRejectedValueOnce(new Error('io failure'));

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    // 只断言内存 fake 的实际落盘结果；doc29 明确不承诺真实 I/O 失败一定未落盘。
    expect(f.textOf(await f.raw(alpha, KEY))).toBe(LEGACY + envelopeOf(alpha, KEY, SECRET));
  });
});

describe('credential repair: ticket lifetime', () => {
  it('rejects a pre-cancelled repair before reading storage', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const controller = new AbortController();
    controller.abort();
    const read = vi.spyOn(f.store, 'read');

    expect(await refusalOf(() => f.repair(alpha, KEY, controller.signal))).toMatchObject({
      code: 'cancelled',
    });

    expect(read).not.toHaveBeenCalled();
    expect(f.encrypt).not.toHaveBeenCalled();
  });

  it('abandons an in-flight repair when the signal aborts mid-decrypt', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const before = await f.raw(alpha, KEY);
    const gate = gateDecrypt(f);
    const controller = new AbortController();

    const result = f.repair(alpha, KEY, controller.signal);
    await gate.entered.promise;
    controller.abort();
    gate.release.resolve();

    expect(await refusalOf(() => result)).toMatchObject({ code: 'cancelled' });
    await gate.settled.promise;
    await f.broker.drainWrites();
    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  it('invalidates an in-flight repair ticket when a newer setSecret arrives', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const gate = gateDecrypt(f);

    const result = f.repair(alpha, KEY);
    await gate.entered.promise;
    const set = f.broker.setSecret(alpha, KEY, 'synthetic-newer-value');
    gate.release.resolve();

    expect(await refusalOf(() => result)).toMatchObject({ code: 'cancelled' });
    await set;
    await f.broker.drainWrites();

    const stored = f.textOf(await f.raw(alpha, KEY)) ?? '';
    expect(stored.startsWith(CURRENT)).toBe(true);
    expect(JSON.parse(stored.slice(CURRENT.length))).toMatchObject({
      keyId: KEY,
      secret: 'synthetic-newer-value',
    });
  });

  it('invalidates an in-flight repair ticket when a newer deleteSecret arrives', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const gate = gateDecrypt(f);

    const result = f.repair(alpha, KEY);
    await gate.entered.promise;
    const removed = f.broker.deleteSecret(alpha, KEY);
    gate.release.resolve();

    expect(await refusalOf(() => result)).toMatchObject({ code: 'cancelled' });
    await removed;
    await f.broker.drainWrites();

    expect(await f.raw(alpha, KEY)).toBeNull();
  });

  it('invalidates an in-flight repair ticket when a newer repair arrives', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const gate = gateDecrypt(f);

    const stale = f.repair(alpha, KEY);
    await gate.entered.promise;
    const fresh = f.repair(alpha, KEY);
    gate.release.resolve();

    expect(await refusalOf(() => stale)).toMatchObject({ code: 'cancelled' });
    expect(await fresh).toBe('repaired');
    expect(f.encrypt).toHaveBeenCalledTimes(1);
    expect(f.textOf(await f.raw(alpha, KEY))?.startsWith(CURRENT)).toBe(true);
  });

  it('does not commit a repair that settles after dispose', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const before = await f.raw(alpha, KEY);
    const gate = gateDecrypt(f);

    const result = f.repair(alpha, KEY);
    await gate.entered.promise;
    f.broker.dispose();
    gate.release.resolve();

    // doc29 只说 dispose 令 ticket 失效，未固定具体错误码：两种生命周期码都算失效。
    const refusal = await refusalOf(() => result);
    expect(['cancelled', 'unavailable']).toContain(refusal.code);
    await gate.settled.promise;
    await f.broker.drainWrites();
    expect(f.encrypt).not.toHaveBeenCalled();
    expect(await f.raw(alpha, KEY)).toEqual(before);
  });

  it('refuses repair after dispose without touching storage', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    f.broker.dispose();
    const read = vi.spyOn(f.store, 'read');

    expect(await refusalOf(() => f.repair(alpha, KEY))).toMatchObject({ code: 'unavailable' });

    expect(read).not.toHaveBeenCalled();
    expect(f.encrypt).not.toHaveBeenCalled();
  });
});

describe('credential repair: mutual exclusion with ordinary use', () => {
  it('keeps ordinary withSecret at not-ready while a repair is in flight', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const client = f.broker.issueClient({ ...alpha, generation: 1 }, [KEY]);
    const gate = gateDecrypt(f);

    const result = f.repair(alpha, KEY);
    await gate.entered.promise;
    const blocked = await refusalOf(() =>
      client.withSecret(
        KEY,
        { taskId: 'task-1', signal: new AbortController().signal },
        async (v) => v,
      ),
    );
    expect(blocked).toMatchObject({ code: 'not-ready' });
    expect(f.authorize).not.toHaveBeenCalled();

    gate.release.resolve();
    expect(await result).toBe('repaired');
    expect(
      await client.withSecret(
        KEY,
        { taskId: 'task-1', signal: new AbortController().signal },
        async (value) => value,
      ),
    ).toBe(SECRET);
  });

  it('queues a repair behind a still-pending setSecret and repairs the committed value', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    const encryptEntered = deferred();
    const encryptRelease = deferred();
    f.cipher.encrypt = vi.fn(async (plaintext: string) => {
      encryptEntered.resolve();
      await encryptRelease.promise;
      return encoder.encode(CURRENT + plaintext);
    });

    const set = f.broker.setSecret(alpha, KEY, 'synthetic-first-value');
    await encryptEntered.promise;
    const repair = f.repair(alpha, KEY);
    // 普通使用在写队列占用期间同步失败关闭，不排队等待。
    expect(
      await refusalOf(() =>
        f.broker
          .issueClient({ ...alpha, generation: 1 }, [KEY])
          .withSecret(
            KEY,
            { taskId: 'task-1', signal: new AbortController().signal },
            async (v) => v,
          ),
      ),
    ).toMatchObject({ code: 'not-ready' });
    encryptRelease.resolve();
    await set;

    // 更早的 setSecret 不会撤销更晚登记的 repair ticket：repair 在写队列里排到它之后，
    // 读到的是已经提交的当前格式密文，因此只报告 current 且不再写一次。
    expect(await repair).toBe('current');
    const [decrypted] = f.decrypt.mock.calls[0] ?? [];
    if (!decrypted) throw new Error('repair never read the ciphertext');
    expect(f.textOf(decrypted)?.startsWith(CURRENT)).toBe(true);
    expect(f.cipher.encrypt).toHaveBeenCalledTimes(1);
    const stored = f.textOf(await f.raw(alpha, KEY)) ?? '';
    expect(JSON.parse(stored.slice(CURRENT.length))).toMatchObject({
      keyId: KEY,
      secret: 'synthetic-first-value',
    });
  });
});

describe('credential repair: host-only surface', () => {
  it('never exposes repair or other management methods on the plugin client', () => {
    const f = fixture();
    const client = f.broker.issueClient({ ...alpha, generation: 1 }, [KEY]);

    expect(typeof (f.broker as unknown as RepairSurface).repairSecret).toBe('function');
    expect(Object.keys(client)).toEqual(['withSecret']);
    expect(Object.getPrototypeOf(client)).toBe(Object.prototype);
    expect(Object.isFrozen(client)).toBe(true);
    expect('repairSecret' in client).toBe(false);
    expect('setSecret' in client).toBe(false);
    expect('deleteSecret' in client).toBe(false);
  });

  it('does not leak native failures or secret text through repair refusals', async () => {
    const f = fixture();
    await f.seed(alpha, KEY, SECRET, true);
    f.cipher.decrypt = vi.fn(async () => {
      throw new Error('native-path-C:/private/marker ' + SECRET);
    });

    const refusal = await refusalOf(() => f.repair(alpha, KEY));

    expect(refusal).toBeInstanceOf(CredentialError);
    expect(refusal.code).toBe('unavailable');
    expect(refusal.message).toBe('Credential operation refused: unavailable');
    expect(refusal.message).not.toContain(SECRET);
    expect(String(refusal.stack ?? '')).not.toContain('native-path-C:/private/marker');
    expect((refusal as { cause?: unknown }).cause).toBeUndefined();
  });

  it('does not leak a bound secret through an envelope refusal', async () => {
    const f = fixture();
    await f.seedRaw(alpha, KEY, LEGACY + envelopeOf(beta, KEY, SECRET));

    const refusal = await refusalOf(() => f.repair(alpha, KEY));

    expect(refusal.code).toBe('permission-denied');
    expect(refusal.message).toBe('Credential operation refused: permission-denied');
    expect(refusal.message).not.toContain(SECRET);
    expect(f.broker.redactor.redact(new Error('Bearer ' + SECRET))).toBe('Bearer ' + SECRET);
  });
});

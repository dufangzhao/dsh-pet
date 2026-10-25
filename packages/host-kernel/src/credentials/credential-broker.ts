import type { CiphertextStore } from './ciphertext-store.js';
import { SecretRedactor } from './redactor.js';
import { MAX_CIPHERTEXT_BYTES, type SecretCipher } from './secret-cipher.js';

export interface CredentialNamespace {
  readonly pluginId: string;
  readonly instanceId: string;
}
export interface CredentialOwner extends CredentialNamespace {
  readonly generation: number;
}
export interface CredentialTask {
  readonly taskId: string;
  readonly signal: AbortSignal;
}
export interface CredentialAuthorizationRequest extends CredentialTask {
  readonly owner: CredentialOwner;
  readonly keyId: string;
}
export interface CredentialAuthorizationLease {
  isValid(): boolean;
  close(): void;
  readonly signal?: AbortSignal;
}
export type CredentialAuthorizer = (
  request: CredentialAuthorizationRequest,
) => Promise<CredentialAuthorizationLease | null>;
export type CredentialErrorCode =
  | 'invalid-input'
  | 'permission-denied'
  | 'stale-owner'
  | 'cancelled'
  | 'not-ready'
  | 'unavailable'
  | 'internal';
export class CredentialError extends Error {
  constructor(readonly code: CredentialErrorCode) {
    super('Credential operation refused: ' + code);
    this.name = 'CredentialError';
  }
}
export interface CredentialClient {
  withSecret<T>(
    keyId: string,
    task: CredentialTask,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}
interface Session {
  readonly owner: CredentialOwner;
  readonly keys: ReadonlySet<string>;
  readonly abort: AbortController;
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function localId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
    !forbidden.has(value)
  );
}
function namespace(value: CredentialNamespace): CredentialNamespace {
  if (
    !value ||
    typeof value.pluginId !== 'string' ||
    value.pluginId.length > 128 ||
    !/^[a-z](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.pluginId) ||
    value.pluginId.includes('..') ||
    !localId(value.instanceId)
  ) {
    throw new CredentialError('invalid-input');
  }
  return Object.freeze({ pluginId: value.pluginId, instanceId: value.instanceId });
}
function namespaceKey(owner: CredentialNamespace): string {
  return JSON.stringify([owner.pluginId, owner.instanceId]);
}
function locator(owner: CredentialNamespace, keyId: string): string {
  return JSON.stringify([owner.pluginId, owner.instanceId, keyId]);
}
function secretText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= 16 * 1024 &&
    Buffer.from(value, 'utf8').toString('utf8') === value &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
function leaseValid(lease: CredentialAuthorizationLease): boolean {
  try {
    return !lease.signal?.aborted && lease.isValid() === true;
  } catch {
    return false;
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new CredentialError('cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (!signal.aborted) resolve(value);
      },
      () => {
        signal.removeEventListener('abort', abort);
        if (!signal.aborted) reject(new CredentialError('unavailable'));
      },
    );
  });
}

/** Host-only authority. Never expose this object or its management methods in a plugin SDK. */
export class CredentialBroker {
  readonly #sessions = new Map<string, Session>();
  readonly #generations = new Map<string, number>();
  readonly #keyEpochs = new Map<string, AbortController>();
  readonly #pendingWrites = new Map<string, number>();
  #writes: Promise<void> = Promise.resolve();
  #disposed = false;
  readonly redactor: SecretRedactor;

  constructor(
    readonly dependencies: {
      cipher: SecretCipher;
      store: CiphertextStore;
      authorize?: CredentialAuthorizer;
      redactor?: SecretRedactor;
    },
  ) {
    this.redactor = dependencies.redactor ?? new SecretRedactor();
  }

  async setSecret(owner: CredentialNamespace, keyId: string, secret: string): Promise<void> {
    if (this.#disposed) throw new CredentialError('unavailable');
    const ns = namespace(owner);
    if (!localId(keyId) || !secretText(secret)) throw new CredentialError('invalid-input');
    try {
      this.redactor.add(secret);
    } catch {
      throw new CredentialError('unavailable');
    }
    return this.mutateKey(locator(ns, keyId), async () => {
      try {
        const payload = JSON.stringify({ version: 1, owner: ns, keyId, secret });
        const encrypted = await this.dependencies.cipher.encrypt(payload);
        if (
          !(encrypted instanceof Uint8Array) ||
          encrypted.byteLength === 0 ||
          encrypted.byteLength > MAX_CIPHERTEXT_BYTES
        )
          throw new CredentialError('unavailable');
        if (this.#disposed) throw new CredentialError('unavailable');
        await this.dependencies.store.write(locator(ns, keyId), Uint8Array.from(encrypted));
      } catch {
        throw new CredentialError('unavailable');
      }
    });
  }

  async deleteSecret(owner: CredentialNamespace, keyId: string): Promise<void> {
    if (this.#disposed) throw new CredentialError('unavailable');
    const ns = namespace(owner);
    if (!localId(keyId)) throw new CredentialError('invalid-input');
    return this.mutateKey(locator(ns, keyId), async () => {
      try {
        await this.dependencies.store.remove(locator(ns, keyId));
      } catch {
        throw new CredentialError('unavailable');
      }
    });
  }

  /** Called by the host manager exactly once for a newly enabled generation. */
  issueClient(owner: CredentialOwner, declaredKeys: readonly string[]): CredentialClient {
    if (this.#disposed) throw new CredentialError('unavailable');
    const ns = namespace(owner);
    if (
      !Number.isSafeInteger(owner.generation) ||
      owner.generation < 1 ||
      !Array.isArray(declaredKeys) ||
      declaredKeys.length > 128 ||
      declaredKeys.some((key) => !localId(key)) ||
      new Set(declaredKeys).size !== declaredKeys.length
    )
      throw new CredentialError('invalid-input');
    const id = namespaceKey(ns);
    if (owner.generation <= (this.#generations.get(id) ?? 0))
      throw new CredentialError('stale-owner');
    this.#sessions.get(id)?.abort.abort();
    const session: Session = {
      owner: Object.freeze({ ...ns, generation: owner.generation }),
      keys: new Set(declaredKeys),
      abort: new AbortController(),
    };
    this.#generations.set(id, owner.generation);
    this.#sessions.set(id, session);
    return Object.freeze({
      withSecret: <T>(
        key: string,
        task: CredentialTask,
        operation: (secret: string, signal: AbortSignal) => Promise<T>,
      ) => this.use(session, key, task, operation),
    });
  }

  revoke(owner: CredentialOwner): void {
    const ns = namespace(owner);
    const id = namespaceKey(ns);
    const current = this.#sessions.get(id);
    if (current?.owner.generation !== owner.generation) return;
    current.abort.abort();
    this.#sessions.delete(id);
  }

  /** Invalidates access immediately. An atomic disk commit already begun may finish. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const session of this.#sessions.values()) session.abort.abort();
    for (const epoch of this.#keyEpochs.values()) epoch.abort();
    this.#sessions.clear();
    this.#generations.clear();
    this.#keyEpochs.clear();
    if (!this.dependencies.redactor) this.redactor.clear();
  }

  /** The host may await this behind its own shutdown deadline; no false forced-I/O claim. */
  async drainWrites(): Promise<void> {
    await this.#writes;
  }

  private mutateKey(key: string, operation: () => Promise<void>): Promise<void> {
    this.#keyEpochs.get(key)?.abort();
    this.#keyEpochs.set(key, new AbortController());
    this.#pendingWrites.set(key, (this.#pendingWrites.get(key) ?? 0) + 1);
    return this.serializeWrite(operation).finally(() => {
      const remaining = (this.#pendingWrites.get(key) ?? 1) - 1;
      if (remaining) this.#pendingWrites.set(key, remaining);
      else this.#pendingWrites.delete(key);
    });
  }

  private serializeWrite(operation: () => Promise<void>): Promise<void> {
    const current = this.#writes.then(() => {
      if (this.#disposed) throw new CredentialError('unavailable');
      return operation();
    });
    this.#writes = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private live(session: Session): boolean {
    return (
      !this.#disposed &&
      !session.abort.signal.aborted &&
      this.#sessions.get(namespaceKey(session.owner)) === session
    );
  }

  private check(
    session: Session,
    signal: AbortSignal,
    lease?: CredentialAuthorizationLease,
    keySignal?: AbortSignal,
  ): void {
    if (!this.live(session)) throw new CredentialError('stale-owner');
    if (signal.aborted || keySignal?.aborted) throw new CredentialError('cancelled');
    if (lease && !leaseValid(lease)) throw new CredentialError('permission-denied');
    if (!this.live(session)) throw new CredentialError('stale-owner');
    if (signal.aborted || keySignal?.aborted) throw new CredentialError('cancelled');
  }

  private async use<T>(
    session: Session,
    keyId: string,
    task: CredentialTask,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (
      !localId(keyId) ||
      !task ||
      !localId(task.taskId) ||
      !(task.signal instanceof AbortSignal) ||
      typeof operation !== 'function'
    )
      throw new CredentialError('invalid-input');
    this.check(session, task.signal);
    if (!session.keys.has(keyId)) throw new CredentialError('permission-denied');
    const authorize = this.dependencies.authorize;
    if (!authorize) throw new CredentialError('permission-denied');
    const key = locator(session.owner, keyId);
    if (this.#pendingWrites.has(key)) throw new CredentialError('not-ready');
    let epoch = this.#keyEpochs.get(key);
    if (!epoch) {
      epoch = new AbortController();
      this.#keyEpochs.set(key, epoch);
    }
    const keySignal = epoch.signal;
    const signal = AbortSignal.any([task.signal, session.abort.signal, keySignal]);
    let lease: CredentialAuthorizationLease | null = null;
    let leaseClosed = false;
    const close = (value: CredentialAuthorizationLease): void => {
      if (leaseClosed) return;
      leaseClosed = true;
      try {
        value.close();
      } catch {
        throw new CredentialError('internal');
      }
    };
    try {
      const pending = Promise.resolve().then(() => {
        this.check(session, task.signal, undefined, keySignal);
        return authorize(
          Object.freeze({ owner: session.owner, keyId, taskId: task.taskId, signal }),
        );
      });
      // A cancelled approval can resolve late; consume no operation and close its lease.
      void pending.then(
        (value) => {
          if (value && (signal.aborted || !this.live(session))) {
            try {
              close(value);
            } catch {
              /* Already cancelled: never leak native detail. */
            }
          }
        },
        () => {},
      );
      lease = await abortable(pending, signal);
      this.check(session, task.signal, undefined, keySignal);
      if (
        !lease ||
        typeof lease.isValid !== 'function' ||
        typeof lease.close !== 'function' ||
        !leaseValid(lease)
      )
        throw new CredentialError('permission-denied');
      const useSignal = lease.signal ? AbortSignal.any([signal, lease.signal]) : signal;
      const ciphertext = await abortable(
        this.dependencies.store.read(locator(session.owner, keyId)),
        useSignal,
      );
      this.check(session, task.signal, lease, keySignal);
      if (!ciphertext) throw new CredentialError('not-ready');
      if (
        !(ciphertext instanceof Uint8Array) ||
        ciphertext.byteLength === 0 ||
        ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
      )
        throw new CredentialError('unavailable');
      const decrypted = await abortable(
        this.dependencies.cipher.decrypt(Uint8Array.from(ciphertext)),
        useSignal,
      );
      this.check(session, task.signal, lease, keySignal);
      if (!decrypted || typeof decrypted.shouldReEncrypt !== 'boolean')
        throw new CredentialError('unavailable');
      if (decrypted.shouldReEncrypt) throw new CredentialError('not-ready');
      const plaintext = decrypted.plaintext;
      if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext, 'utf8') > 64 * 1024)
        throw new CredentialError('unavailable');
      let payload: unknown;
      try {
        payload = JSON.parse(plaintext) as unknown;
      } catch {
        throw new CredentialError('unavailable');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new CredentialError('unavailable');
      const record = payload as Record<string, unknown>;
      const storedOwner = record['owner'];
      if (
        record['version'] !== 1 ||
        record['keyId'] !== keyId ||
        !storedOwner ||
        typeof storedOwner !== 'object' ||
        Array.isArray(storedOwner)
      )
        throw new CredentialError('unavailable');
      const stored = storedOwner as Record<string, unknown>;
      if (
        Object.keys(record).sort().join(',') !== 'keyId,owner,secret,version' ||
        Object.keys(stored).sort().join(',') !== 'instanceId,pluginId' ||
        stored['pluginId'] !== session.owner.pluginId ||
        stored['instanceId'] !== session.owner.instanceId ||
        !secretText(record['secret'])
      )
        throw new CredentialError('permission-denied');
      const secret = record['secret'];
      this.redactor.add(secret);
      this.check(session, task.signal, lease, keySignal);
      let result: T;
      try {
        result = await abortable(
          Promise.resolve().then(() => {
            this.check(session, task.signal, lease ?? undefined, keySignal);
            return operation(secret, useSignal);
          }),
          useSignal,
        );
      } catch {
        this.check(session, task.signal, lease, keySignal);
        throw new CredentialError('internal');
      }
      this.check(session, task.signal, lease, keySignal);
      return result;
    } catch (error) {
      this.check(session, task.signal, lease ?? undefined, keySignal);
      if (error instanceof CredentialError) throw error;
      throw new CredentialError('unavailable');
    } finally {
      if (lease && typeof lease.close === 'function') close(lease);
    }
  }
}

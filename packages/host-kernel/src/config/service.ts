import {
  makeError,
  type ConfigInspection,
  type ConfigSnapshot,
  type ConfigSave,
  type JsonObject,
  type OwnerRef,
  type PluginManifest,
  type Result,
} from '@pet/contracts';
import { freezeJson, instanceKey, type InstanceIdentity } from '../runtime/identity.js';
import { ownerFrom } from '../runtime/worker-protocol.js';
import { prepareConfigDefinition, type PreparedConfigDefinition } from './schema.js';
import { configIdentity, type ConfigStore, type StoredConfig } from './store.js';
export type { ConfigSnapshot, ConfigSave } from '@pet/contracts';
export type ConfigMigrator = (source: {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly data: JsonObject;
  readonly signal: AbortSignal;
}) => Promise<unknown>;
export interface ConfigMigration {
  readonly preview: ConfigSnapshot;
  commit(signal?: AbortSignal): Promise<Result<ConfigSnapshot>>;
  rollback(signal?: AbortSignal): Promise<Result<ConfigSnapshot>>;
  discard(): void;
}
export interface ConfigClient {
  get(): Promise<Result<ConfigSnapshot>>;
}
interface Definition {
  identity: InstanceIdentity;
  prepared: PreparedConfigDefinition;
}
const failure = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const snap = (record: StoredConfig): ConfigSnapshot =>
  freezeJson(
    structuredClone({
      pluginId: record.pluginId,
      instanceId: record.instanceId,
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      data: record.data,
    }),
  );
export class ConfigService {
  readonly #definitions = new Map<string, Definition>();
  readonly #locks = new Map<string, Promise<void>>();
  #pending = 0;
  #migrations = 0;
  #closed = false;
  readonly #lifetime = new AbortController();
  readonly #releases = new Set<() => void>();
  constructor(
    private readonly store: ConfigStore,
    private readonly live: (owner: OwnerRef) => boolean = () => false,
  ) {}
  register(identity: InstanceIdentity, manifest: PluginManifest): Result<PreparedConfigDefinition> {
    const id = configIdentity(identity);
    if (!id || id.pluginId !== manifest.id || this.#closed) return failure('invalid-input');
    const credentials =
      manifest.permissions?.filter((p) => p.kind === 'credentials').flatMap((p) => p.keys) ?? [];
    const prepared = prepareConfigDefinition(
      manifest.config ?? {
        version: 1,
        schema: { type: 'object', additionalProperties: false, properties: {} },
      },
      credentials,
    );
    if (!prepared.ok) return prepared;
    this.#definitions.set(instanceKey(id), { identity: id, prepared: prepared.value });
    return prepared;
  }
  definition(identity: InstanceIdentity): PreparedConfigDefinition | null {
    const id = configIdentity(identity);
    return id ? (this.#definitions.get(instanceKey(id))?.prepared ?? null) : null;
  }
  private async locked<T>(
    identity: InstanceIdentity,
    work: (definition: Definition, signal: AbortSignal) => Promise<Result<T>>,
    signal?: AbortSignal,
  ): Promise<Result<T>> {
    const id = configIdentity(identity);
    if (!id || this.#closed) return failure('not-ready');
    const key = instanceKey(id),
      definition = this.#definitions.get(key);
    if (!definition) return failure('not-ready');
    if (this.#pending >= 128) return failure('quota-exceeded');
    this.#pending++;
    const scope = signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal;
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((r) => {
      release = r;
    });
    this.#locks.set(key, tail);
    try {
      await previous;
      if (scope.aborted) return failure('cancelled');
      if (this.#closed || this.#definitions.get(key) !== definition) return failure('not-ready');
      return await work(definition, scope);
    } catch {
      return failure('unavailable');
    } finally {
      this.#pending--;
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
  inspect(identity: InstanceIdentity): Promise<Result<ConfigInspection>> {
    // Windows replacement must not overlap this host's open read handles.
    return this.locked<ConfigInspection>(identity, async (definition) => {
      const value = await this.store.read(definition.identity);
      if (
        this.#closed ||
        this.#definitions.get(instanceKey(definition.identity)) !== definition ||
        (value !== null &&
          (value.schemaVersion !== definition.prepared.version ||
            !definition.prepared.validate(value.data).ok))
      )
        return failure('not-ready');
      const { version, schema, defaults, fields } = definition.prepared;
      return {
        ok: true,
        value: freezeJson({
          definition: { version, schema, defaults, fields },
          snapshot: value === null ? null : snap(value),
        }),
      };
    });
  }
  async get(identity: InstanceIdentity): Promise<Result<ConfigSnapshot>> {
    const inspected = await this.inspect(identity);
    if (!inspected.ok) return inspected;
    return inspected.value.snapshot
      ? { ok: true, value: inspected.value.snapshot }
      : failure('not-ready');
  }
  initialize(identity: InstanceIdentity, signal?: AbortSignal): Promise<Result<ConfigSnapshot>> {
    return this.locked(
      identity,
      async (definition, signal) => {
        const existing = await this.store.read(definition.identity);
        if (existing) {
          if (
            existing.schemaVersion !== definition.prepared.version ||
            !definition.prepared.validate(existing.data).ok
          )
            return failure('not-ready');
          return { ok: true, value: snap(existing) };
        }
        const candidate = definition.prepared.validate(definition.prepared.defaults);
        if (!candidate.ok) return failure('not-ready');
        if (signal?.aborted) return failure('cancelled');
        const row: StoredConfig = {
          format: 1,
          ...definition.identity,
          schemaVersion: definition.prepared.version,
          revision: 1,
          data: candidate.value,
        };
        if (!(await this.store.compareAndSet(definition.identity, null, row, signal)))
          return failure('not-ready');
        return { ok: true, value: snap(row) };
      },
      signal,
    );
  }
  save(
    identity: InstanceIdentity,
    input: unknown,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<Result<ConfigSave>> {
    const id = configIdentity(identity),
      definition = id && this.#definitions.get(instanceKey(id));
    if (!id || !definition || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      return Promise.resolve(failure('invalid-input'));
    const validated = definition.prepared.validate(input);
    if (!validated.ok) return Promise.resolve(validated);
    return this.locked(
      id,
      async (current, signal) => {
        if (current !== definition) return failure('not-ready');
        const previous = await this.store.read(id);
        if (signal.aborted) return failure('cancelled');
        if (
          previous &&
          (previous.schemaVersion !== current.prepared.version ||
            !current.prepared.validate(previous.data).ok)
        )
          return failure('not-ready');
        if ((previous?.revision ?? 0) !== expectedRevision) return failure('conflict');
        const changeMode = current.prepared.changeMode(previous?.data ?? {}, validated.value);
        if (previous && changeMode === null)
          return { ok: true, value: { snapshot: snap(previous), changeMode: null } };
        const value: StoredConfig = {
          format: 1,
          ...id,
          schemaVersion: current.prepared.version,
          revision: expectedRevision + 1,
          data: validated.value,
        };
        if (!(await this.store.compareAndSet(id, previous?.revision ?? null, value, signal)))
          return failure('conflict');
        return { ok: true, value: { snapshot: snap(value), changeMode } };
      },
      signal,
    );
  }
  async prepareMigration(
    identity: InstanceIdentity,
    migrate: ConfigMigrator,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Result<ConfigMigration>> {
    const id = configIdentity(identity),
      definition = id && this.#definitions.get(instanceKey(id));
    const timeout = options.timeoutMs ?? 5000;
    if (
      !id ||
      !definition ||
      typeof migrate !== 'function' ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 30000
    )
      return failure('invalid-input');
    if (this.#closed || this.#migrations >= 16) return failure('quota-exceeded');
    if (options.signal?.aborted) return failure('cancelled');
    this.#migrations++;
    let retained = false;
    try {
      const previous = await this.store.read(id);
      if (!previous || previous.schemaVersion >= definition.prepared.version)
        return failure('not-ready');
      const lifetime = new AbortController();
      const signal = AbortSignal.any([
        this.#lifetime.signal,
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let detach = () => {};
      const work = Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('Cancelled');
        return migrate(
          Object.freeze({
            fromVersion: previous.schemaVersion,
            toVersion: definition.prepared.version,
            data: freezeJson(structuredClone(previous.data)),
            signal,
          }),
        );
      });
      const raced = await new Promise<
        { kind: 'done'; value: unknown } | { kind: 'cancelled' | 'timeout' | 'failed' }
      >((resolve) => {
        timer = setTimeout(() => {
          resolve({ kind: 'timeout' });
          lifetime.abort();
        }, timeout);
        const abort = () => resolve({ kind: 'cancelled' });
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        detach = () => signal.removeEventListener('abort', abort);
        void work.then(
          (value) => resolve({ kind: 'done', value }),
          () => resolve({ kind: 'failed' }),
        );
      });
      if (timer) clearTimeout(timer);
      detach();
      lifetime.abort();
      if (raced.kind !== 'done') {
        if (raced.kind === 'timeout' || raced.kind === 'cancelled') {
          retained = true;
          void work
            .finally(() => {
              this.#migrations--;
            })
            .catch(() => {});
        }
        return failure(
          raced.kind === 'timeout'
            ? 'timeout'
            : raced.kind === 'cancelled'
              ? 'cancelled'
              : 'internal',
        );
      }
      const candidate = definition.prepared.validate(raced.value);
      if (!candidate.ok) return failure('invalid-input');
      if (
        this.#closed ||
        options.signal?.aborted ||
        this.#definitions.get(instanceKey(id)) !== definition
      )
        return failure('cancelled');
      const target: StoredConfig = {
        format: 1,
        ...id,
        schemaVersion: definition.prepared.version,
        revision: previous.revision + 1,
        data: candidate.value,
      };
      let state: 'prepared' | 'committed' | 'rolled-back' = 'prepared';
      let released = false;
      let committedRevision: number | undefined;
      retained = true;
      const release = () => {
        if (!released) {
          released = true;
          this.#migrations--;
          this.#releases.delete(release);
        }
      };
      this.#releases.add(release);
      const transaction: ConfigMigration = {
        preview: snap(target),
        commit: (signal) =>
          this.locked(
            id,
            async (current, signal) => {
              if (released || state !== 'prepared' || current !== definition)
                return failure('not-ready');
              if (!(await this.store.compareAndSet(id, previous.revision, target, signal)))
                return failure('not-ready');
              state = 'committed';
              committedRevision = target.revision;
              return { ok: true, value: snap(target) };
            },
            signal,
          ),
        rollback: (signal) =>
          this.locked(
            id,
            async (_current, signal) => {
              if (released || state !== 'committed' || committedRevision === undefined)
                return failure('not-ready');
              const restored: StoredConfig = { ...previous, revision: committedRevision + 1 };
              if (!(await this.store.compareAndSet(id, committedRevision, restored, signal)))
                return failure('not-ready');
              state = 'rolled-back';
              release();
              return { ok: true, value: snap(restored) };
            },
            signal,
          ),
        discard: release,
      };
      return { ok: true, value: Object.freeze(transaction) };
    } catch {
      return failure('unavailable');
    } finally {
      if (!retained) this.#migrations--;
    }
  }
  issueClient(value: OwnerRef): ConfigClient {
    const owner = ownerFrom(value);
    const valid = () => {
      if (!owner || this.#closed) return false;
      try {
        return this.live(owner);
      } catch {
        return false;
      }
    };
    return Object.freeze({
      get: async (): Promise<Result<ConfigSnapshot>> => {
        if (!owner || !valid()) return failure('stale-owner');
        const result = await this.get({ pluginId: owner.pluginId, instanceId: owner.instanceId });
        return valid() ? result : failure('stale-owner');
      },
    });
  }
  close(): void {
    this.#closed = true;
    this.#lifetime.abort();
    for (const release of [...this.#releases]) release();
  }
  diagnostics() {
    return {
      definitions: this.#definitions.size,
      pendingOperations: this.#pending,
      migrations: this.#migrations,
    };
  }
}

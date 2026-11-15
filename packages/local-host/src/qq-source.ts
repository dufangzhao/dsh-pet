import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import {
  isQQAccountRef,
  isQQCredentialCommand,
  isQQSourceSettings,
  isQQSourceSettingsCommand,
  makeError,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  sameQQAccount,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type QQAccountRef,
  type QQCredentialCommand,
  type QQOfficialSettings,
  type QQOneBotSettings,
  type QQProtocol,
  type QQSourceSettings,
  type QQSourceSettingsCommand,
  type QQSourceView,
} from '@pet/contracts';
import {
  KernelFault,
  SecretRedactor,
  type TaskHandle,
  type TaskSupervisor,
} from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import type {
  OfficialDriverStatus,
  OfficialIo,
  OfficialMessageEvent,
  OfficialQqDriver,
  OfficialQqPorts,
} from '@pet/qq-official';
import type {
  OneBotDriverStatus,
  OneBotFrame,
  OneBotIo,
  OneBotQqDriver,
  OneBotQqPorts,
  OneBotResponse,
} from '@pet/qq-onebot';
import type { CompanionPluginHost } from '@pet/companion-runtime/plugin-host';
import type { LocalPluginKernel, LocalQQSourceId } from './kernel.js';
import { LOCAL_QQ_CONTROL_ID } from './qq-control.js';
import {
  qqSourceId as sourceId,
  qqSourceTarget as targetOf,
  qqSourceAccount as accountOf,
  qqSourceProtocol,
} from './qq-source-identity.js';
import {
  createAuthorizedOfficialIo,
  createAuthorizedOneBotIo,
  type CapturedQqBinding,
  type OfficialIoTestHooks,
} from './qq-native/index.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' as const });
const field = (protocol: QQProtocol): 'officialEnabled' | 'onebotEnabled' =>
  protocol === 'official' ? 'officialEnabled' : 'onebotEnabled';
const errorOf = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
interface Slot {
  target: string;
  revision: number;
  version: string;
  value: string | undefined;
}
interface Prepared {
  settings: QQSourceSettings;
  revision: number;
  version: string;
}
interface SourceRecord {
  readonly owner: OwnerRef;
  readonly context: PluginContext;
  readonly settings: QQSourceSettings;
  readonly revision: number;
  readonly credentialVersion: string;
  readonly permissionEpoch: number;
  readonly abort: AbortController;
  readonly signal: AbortSignal;
  readonly bindingId: string;
  driver: OfficialQqDriver | OneBotQqDriver | undefined;
  root: TaskHandle | undefined;
  running: boolean;
  status: OfficialDriverStatus | OneBotDriverStatus | undefined;
  connection: { id: string; signal: AbortSignal } | undefined;
  cleanup: QQSourceView['cleanup'];
  error: KernelError | null;
}
export interface LocalCapturedSourceBase {
  readonly account: QQAccountRef;
  readonly owner: OwnerRef;
  readonly configRevision: number;
  readonly credentialVersion: string;
  readonly permissionEpoch: number;
  readonly connectionId: string;
  readonly selfId?: string;
  readonly signal: AbortSignal;
  check(): Promise<void>;
}
export type LocalCapturedSource = LocalCapturedSourceBase &
  (
    | { readonly protocol: 'official'; readonly driver: OfficialQqDriver }
    | { readonly protocol: 'onebot-v11'; readonly driver: OneBotQqDriver }
  );
export interface LocalSourcesView {
  readonly revision: number;
  readonly sources: readonly QQSourceView[];
}
export interface LocalSourceMutation {
  readonly view: LocalSourcesView;
  readonly error: KernelError | null;
}
export interface LocalSourceExpectation {
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
}
export interface QQSourceKernel {
  readonly host: CompanionPluginHost;
  checkConfigSource?(pluginId: LocalQQSourceId): void;
  setEnabled(pluginId: LocalQQSourceId, enabled: boolean): Promise<void>;
  runFor(
    pluginId: LocalQQSourceId,
    work: Parameters<TaskSupervisor['run']>[1],
    options?: Parameters<TaskSupervisor['run']>[2],
  ): TaskHandle;
  review?(pluginId: LocalQQSourceId): { cleanup: QQSourceView['cleanup'] };
}
export interface QQSourceIntent {
  read(): Promise<{ revision: number; officialEnabled: boolean; onebotEnabled: boolean }>;
  save?(
    value: { officialEnabled: boolean; onebotEnabled: boolean },
    expectedRevision: number,
  ): Promise<void>;
}
export interface LocalQQSourceOptions {
  readonly onOfficial: (
    event: OfficialMessageEvent,
    source: LocalCapturedSourceBase,
  ) => Promise<void>;
  readonly onOneBot: (
    event: Exclude<OneBotFrame, OneBotResponse>,
    source: LocalCapturedSourceBase,
  ) => Promise<void>;
  readonly beforeEvent?: (source: LocalCapturedSourceBase) => Promise<void>;
  readonly beforeStart?: () => void;
  readonly changed?: () => void;
  readonly officialTest?: OfficialIoTestHooks;
  readonly onebotTest?: { readonly onListening: (address: AddressInfo) => void };
  readonly officialFactory?: (
    host: CompanionPluginHost,
    binding: CapturedQqBinding<QQOfficialSettings>,
  ) => OfficialIo;
  readonly onebotFactory?: (
    host: CompanionPluginHost,
    binding: CapturedQqBinding<QQOneBotSettings>,
  ) => OneBotIo;
}

/** Host-private source lifecycle; server participant policy, State and grants stay elsewhere. */
export class QQSourceCore {
  private readonly generation = randomUUID();
  private readonly slots = new Map<QQProtocol, Slot>();
  private readonly prepared = new Map<QQProtocol, Prepared>();
  private readonly records = new Map<QQProtocol, SourceRecord>();
  private readonly failures = new Map<QQProtocol, KernelError>();
  private readonly cleanup = new Map<QQProtocol, QQSourceView['cleanup']>();
  private readonly busy = new Set<QQProtocol>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly redactor = new SecretRedactor();
  private readonly offCommit: () => void;
  private observerFailures = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    readonly kernel: QQSourceKernel,
    readonly options: LocalQQSourceOptions,
    private readonly intent: QQSourceIntent,
    private readonly requireOperationCheck: boolean,
  ) {
    this.offCommit = kernel.host.onConfigurationCommit((commit) => {
      if (commit.instanceId === 'default' && commit.pluginId === LOCAL_QQ_CONTROL_ID) {
        for (const protocol of ['official', 'onebot-v11'] as const) {
          if (commit.data[field(protocol)] !== false) continue;
          const record = this.records.get(protocol);
          if (record) this.fence(record);
        }
        this.notify();
        return;
      }
      const protocol =
        commit.pluginId === QQ_OFFICIAL_PLUGIN_ID
          ? 'official'
          : commit.pluginId === QQ_ONEBOT_PLUGIN_ID
            ? 'onebot-v11'
            : null;
      if (!protocol || commit.instanceId !== 'default') return;
      if (isQQSourceSettings(commit.data) && commit.data.protocol === protocol)
        this.slot(commit.data, commit.revision);
      else {
        const slot = this.slots.get(protocol);
        if (slot && commit.revision >= slot.revision) {
          slot.value = undefined;
          slot.version = this.version();
          slot.revision = commit.revision;
        }
        this.failures.set(protocol, makeError('invalid-input', false));
      }
      const record = this.records.get(protocol);
      if (record && record.revision !== commit.revision) this.fence(record);
      this.notify();
    });
  }
  private version(): string {
    return `${this.generation}:${randomUUID()}`;
  }
  private notify(): void {
    try {
      this.options.changed?.();
    } catch {
      this.observerFailures++;
    }
  }
  diagnostics(): { observerFailures: number; pending: number } {
    return { observerFailures: this.observerFailures, pending: this.operations.size };
  }
  private slot(settings: QQSourceSettings, revision: number): Slot {
    let slot = this.slots.get(settings.protocol);
    if (slot && revision < slot.revision) throw new KernelFault('conflict');
    const target = targetOf(settings);
    if (!slot || slot.target !== target) {
      slot = { target, revision, version: this.version(), value: undefined };
      this.slots.set(settings.protocol, slot);
    } else slot.revision = revision;
    return slot;
  }
  private async configured(
    protocol: QQProtocol,
  ): Promise<{ settings: QQSourceSettings; revision: number }> {
    this.kernel.checkConfigSource?.(sourceId(protocol));
    const result = await this.kernel.host.configs.get(identity(sourceId(protocol)));
    if (
      !result.ok ||
      !isQQSourceSettings(result.value.data) ||
      result.value.data.protocol !== protocol
    )
      throw new KernelFault(result.ok ? 'invalid-input' : result.error.code);
    return { settings: structuredClone(result.value.data), revision: result.value.revision };
  }
  private desired(): Promise<{
    revision: number;
    officialEnabled: boolean;
    onebotEnabled: boolean;
  }> {
    return this.intent.read();
  }
  private exclusive<T>(protocol: QQProtocol, operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.busy.has(protocol)) return Promise.reject(new KernelFault('conflict'));
    this.busy.add(protocol);
    const work = (async () => {
      try {
        return await operation();
      } finally {
        this.busy.delete(protocol);
        this.notify();
      }
    })();
    this.operations.add(work);
    void work.then(
      () => this.operations.delete(work),
      () => this.operations.delete(work),
    );
    return work;
  }
  async initialize(): Promise<void> {
    if (this.closed) throw new KernelFault('not-ready');
    for (const protocol of ['official', 'onebot-v11'] as const) {
      const config = await this.configured(protocol);
      this.slot(config.settings, config.revision);
    }
    // Persisted desired intent remains visible; new process trust/key must be explicitly restored.
    this.notify();
  }
  containsSecret(value: unknown): boolean {
    return this.redactor.containsValue(value);
  }
  markFailure(protocol: QQProtocol, error: unknown): void {
    this.failures.set(protocol, errorOf(error));
    this.notify();
  }
  summary(protocol: QQProtocol): {
    account: QQAccountRef | null;
    cleanup: QQSourceView['cleanup'];
  } {
    const record = this.records.get(protocol);
    return {
      account: record ? accountOf(record.settings) : null,
      cleanup: record?.cleanup ?? this.cleanup.get(protocol) ?? 'settled',
    };
  }
  needsRetire(protocol: QQProtocol): boolean {
    const record = this.records.get(protocol);
    return Boolean(record && (record.signal.aborted || (record.root && !record.running)));
  }
  beginDisable(protocol: QQProtocol): {
    readonly hadRecord: boolean;
    settle(): Promise<void>;
    fail(error: unknown): void;
  } {
    const record = this.records.get(protocol);
    if (record) this.fence(record);
    return {
      hadRecord: !!record,
      settle: async () => {
        await record?.root?.settled;
        if (record && this.records.get(protocol) === record) this.records.delete(protocol);
        this.cleanup.set(protocol, 'settled');
      },
      fail: (error) => {
        this.cleanup.set(protocol, 'failed');
        this.markFailure(protocol, error);
      },
    };
  }
  private fence(record: SourceRecord): void {
    record.abort.abort();
    record.cleanup = 'pending';
    this.cleanup.set(record.settings.protocol, 'pending');
  }
  /** Service activation prepares its real context before invoking the same protocol ports. */
  async prepareSource(context: PluginContext): Promise<void> {
    const protocol = qqSourceProtocol(context.owner.pluginId);
    if (!protocol || context.owner.instanceId !== 'default' || context.signal.aborted)
      throw new KernelFault('stale-owner');
    if (!this.kernel.host.verifySource(context.owner.pluginId))
      throw new KernelFault('package-changed');
    const current = await this.configured(protocol);
    const slot = this.slot(current.settings, current.revision);
    this.prepared.set(protocol, { ...current, version: slot.version });
    try {
      this.prepare(context, protocol);
    } finally {
      this.prepared.delete(protocol);
    }
  }
  private record(context: PluginContext, protocol: QQProtocol): SourceRecord {
    const current = this.records.get(protocol);
    if (current) {
      if (
        current.context !== context ||
        current.owner.generation !== context.owner.generation ||
        current.signal.aborted
      )
        throw new KernelFault('stale-owner');
      return current;
    }
    return this.prepare(context, protocol);
  }
  private prepare(context: PluginContext, protocol: QQProtocol): SourceRecord {
    const pending = this.prepared.get(protocol);
    if (
      !pending ||
      context.owner.pluginId !== sourceId(protocol) ||
      context.owner.instanceId !== 'default' ||
      context.signal.aborted ||
      this.records.has(protocol) ||
      !isDeepStrictEqual(context.config, pending.settings)
    )
      throw new KernelFault('stale-owner');
    const policy = this.kernel.host.permissionControl.inspect(identity(context.owner.pluginId));
    if (!policy || policy.blocked || policy.preset === 'deny')
      throw new KernelFault('permission-denied');
    const abort = new AbortController();
    const record: SourceRecord = {
      owner: { ...context.owner },
      context,
      settings: pending.settings,
      revision: pending.revision,
      credentialVersion: pending.version,
      permissionEpoch: policy.epoch,
      abort,
      signal: AbortSignal.any([context.signal, abort.signal]),
      bindingId: `local-qq-${randomUUID()}`,
      driver: undefined,
      root: undefined,
      running: false,
      status: undefined,
      connection: undefined,
      cleanup: 'settled',
      error: null,
    };
    this.records.set(protocol, record);
    return record;
  }
  private async check(record: SourceRecord): Promise<void> {
    const protocol = record.settings.protocol;
    const current = this.kernel.host.manager.get(identity(record.owner.pluginId));
    const policy = this.kernel.host.permissionControl.inspect(identity(record.owner.pluginId));
    if (
      this.closed ||
      record.signal.aborted ||
      this.records.get(protocol) !== record ||
      !current ||
      current.owner.generation !== record.owner.generation ||
      !this.kernel.host.manager.isActive(record.owner)
    )
      throw new KernelFault('stale-owner');
    if (!this.kernel.host.verifySource(record.owner.pluginId))
      throw new KernelFault('package-changed');
    if (
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== record.permissionEpoch
    )
      throw new KernelFault('permission-denied');
    const slot = this.slots.get(protocol);
    if (
      !slot ||
      slot.version !== record.credentialVersion ||
      slot.target !== targetOf(record.settings)
    )
      throw new KernelFault('stale-owner');
    const config = await this.configured(protocol);
    if (
      config.revision !== record.revision ||
      record.signal.aborted ||
      this.records.get(protocol) !== record
    )
      throw new KernelFault('stale-owner');
  }
  private binding<S extends QQSourceSettings>(
    record: SourceRecord,
    settings: S,
  ): CapturedQqBinding<S> {
    const slot = this.slot(settings, record.revision);
    return {
      owner: record.owner,
      signal: record.signal,
      settings,
      configRevision: record.revision,
      credentialVersion: record.credentialVersion,
      credential: slot.value ?? '',
      requireOperationCheck: this.requireOperationCheck,
      check: () => this.check(record),
    };
  }
  private bind(
    record: SourceRecord,
    driver: OfficialQqDriver | OneBotQqDriver,
  ): () => Promise<void> {
    if (record.driver || record.signal.aborted) throw new KernelFault('conflict');
    record.driver = driver;
    return async () => {
      this.fence(record);
      if (this.records.get(record.settings.protocol) === record)
        this.records.delete(record.settings.protocol);
    };
  }
  private capture(
    record: SourceRecord,
    connectionId: string,
    signal: AbortSignal,
  ): LocalCapturedSourceBase {
    const account = accountOf(record.settings);
    if (!account || !connectionId) throw new KernelFault('not-ready');
    const joined = AbortSignal.any([record.signal, signal]);
    const selfId =
      record.settings.protocol === 'official'
        ? record.status && 'selfId' in record.status
          ? record.status.selfId
          : null
        : record.settings.accountId;
    return {
      account,
      owner: { ...record.owner },
      configRevision: record.revision,
      credentialVersion: record.credentialVersion,
      permissionEpoch: record.permissionEpoch,
      connectionId,
      ...(selfId ? { selfId } : {}),
      signal: joined,
      check: async () => {
        await this.check(record);
        if (
          joined.aborted ||
          record.status?.connectionId !== connectionId ||
          record.status.phase !== 'ready'
        )
          throw new KernelFault('stale-owner');
      },
    };
  }
  officialPorts(context: PluginContext): OfficialQqPorts {
    const record = this.record(context, 'official');
    return {
      authorizedOfficial: (settings) => {
        if (!isDeepStrictEqual(settings, record.settings)) throw new KernelFault('conflict');
        const binding = this.binding(record, settings);
        const io = this.options.officialFactory
          ? this.options.officialFactory(this.kernel.host, binding)
          : createAuthorizedOfficialIo(this.kernel.host, binding, this.options.officialTest);
        return {
          media: io.media,
          openGateway: async (signal) => {
            const peer = await io.openGateway(signal);
            try {
              await this.check(record);
              if (peer.signal.aborted) throw new KernelFault('stale-owner');
              record.connection = { id: peer.id, signal: peer.signal };
              return peer;
            } catch (error) {
              await peer.close();
              await peer.settled;
              throw error;
            }
          },
          send: (request, signal) => io.send(request, signal),
          upload: (request, signal) => io.upload(request, signal),
          close: () => io.close(),
        };
      },
      observer: {
        onStatus: (status) => {
          if (this.records.get('official') === record && !record.signal.aborted) {
            record.status = status;
            record.error = status.error;
            this.notify();
          }
        },
        onEvent: async (event, id, signal) => {
          const source = this.capture(record, id, signal);
          await source.check();
          await this.options.beforeEvent?.(source);
          if (record.settings.protocol !== 'official') throw new KernelFault('stale-owner');
          if (
            !record.settings.scenes.includes(event.t === 'C2C_MESSAGE_CREATE' ? 'private' : 'group')
          )
            return;
          await this.options.onOfficial(event, source);
          await source.check();
        },
      },
      bind: (driver) => this.bind(record, driver),
    };
  }
  onebotPorts(context: PluginContext): OneBotQqPorts {
    const record = this.record(context, 'onebot-v11');
    return {
      authorizedOneBot: (settings) => {
        if (!isDeepStrictEqual(settings, record.settings)) throw new KernelFault('conflict');
        const binding = this.binding(record, settings);
        const io = this.options.onebotFactory
          ? this.options.onebotFactory(this.kernel.host, binding)
          : createAuthorizedOneBotIo(this.kernel.host, binding, this.options.onebotTest);
        return {
          nextPeer: async (signal) => {
            const peer = await io.nextPeer(signal);
            try {
              await this.check(record);
              if (peer.signal.aborted) throw new KernelFault('stale-owner');
              record.connection = { id: peer.id, signal: peer.signal };
              return peer;
            } catch (error) {
              await peer.close();
              await peer.settled;
              throw error;
            }
          },
          close: () => io.close(),
        };
      },
      observer: {
        onStatus: (status) => {
          if (this.records.get('onebot-v11') === record && !record.signal.aborted) {
            record.status = status;
            record.error = status.error;
            this.notify();
          }
        },
        onEvent: async (event, id, signal) => {
          const source = this.capture(record, id, signal);
          await source.check();
          await this.options.onOneBot(event, source);
          await source.check();
        },
      },
      bind: (driver) => this.bind(record, driver),
    };
  }
  captureSource(account: QQAccountRef): LocalCapturedSource {
    if (!isQQAccountRef(account)) throw new KernelFault('invalid-input');
    const record = this.records.get(account.protocol);
    const captured = record && accountOf(record.settings);
    if (
      this.closed ||
      !record?.driver ||
      !record.status ||
      record.status.phase !== 'ready' ||
      !record.status.connectionId ||
      !record.connection ||
      record.connection.id !== record.status.connectionId ||
      record.connection.signal.aborted ||
      record.signal.aborted ||
      !captured ||
      !sameQQAccount(account, captured)
    )
      throw new KernelFault('not-ready');
    const policy = this.kernel.host.permissionControl.inspect(identity(record.owner.pluginId));
    const slot = this.slots.get(account.protocol);
    if (
      !this.kernel.host.manager.isActive(record.owner) ||
      !this.kernel.host.verifySource(record.owner.pluginId) ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== record.permissionEpoch ||
      !slot ||
      slot.version !== record.credentialVersion ||
      slot.target !== targetOf(record.settings)
    )
      throw new KernelFault('permission-denied');
    const base = this.capture(record, record.status.connectionId, record.connection.signal);
    return account.protocol === 'official'
      ? { ...base, protocol: 'official', driver: record.driver as OfficialQqDriver }
      : { ...base, protocol: 'onebot-v11', driver: record.driver as OneBotQqDriver };
  }
  private async start(protocol: QQProtocol, expected?: LocalSourceExpectation): Promise<void> {
    if (!(await this.desired())[field(protocol)]) throw new KernelFault('conflict');
    const current = await this.configured(protocol);
    const slot = this.slot(current.settings, current.revision);
    if (
      expected &&
      (current.revision !== expected.expectedConfigRevision ||
        slot.version !== expected.expectedCredentialVersion)
    )
      throw new KernelFault('conflict');
    const existing = this.records.get(protocol);
    if (existing?.root && existing.running && !existing.signal.aborted) {
      try {
        await this.check(existing);
        return;
      } catch {
        /* Retire stale source before any replacement. */
      }
    }
    if (existing || this.kernel.host.isEnabled(sourceId(protocol))) await this.retire(protocol);
    const latest = await this.configured(protocol);
    if (
      latest.revision !== current.revision ||
      this.slots.get(protocol) !== slot ||
      (expected && slot.version !== expected.expectedCredentialVersion)
    )
      throw new KernelFault('conflict');
    this.prepared.set(protocol, { ...current, version: slot.version });
    try {
      await this.kernel.setEnabled(sourceId(protocol), true);
      if (!(await this.desired())[field(protocol)]) throw new KernelFault('conflict');
    } catch (error) {
      await this.retire(protocol);
      throw error;
    } finally {
      this.prepared.delete(protocol);
    }
    await this.startCurrent(protocol);
  }
  /** Start the source instance just activated by the enclosing host. */
  async startCurrent(protocol: QQProtocol): Promise<void> {
    const record = this.records.get(protocol);
    if (!record?.driver) return;
    if (record.root && record.running && !record.signal.aborted) return;
    this.options.beforeStart?.();
    const slot = this.slot(record.settings, record.revision);
    if (!slot.value) {
      record.error = makeError('not-ready', false);
      return;
    }
    await this.check(record);
    record.cleanup = 'pending';
    const root = this.kernel.runFor(
      record.owner.pluginId as LocalQQSourceId,
      async (task) => {
        await record.driver?.start(task.signal);
        return null;
      },
      { signal: record.signal },
    );
    record.root = root;
    record.running = true;
    void root.result.then((result) => {
      if (!result.ok && !record.signal.aborted) {
        record.error = result.error;
        this.failures.set(protocol, result.error);
        this.notify();
      }
    });
    void root.settled.then(() => {
      record.running = false;
      if (record.cleanup !== 'failed') record.cleanup = 'settled';
      this.notify();
    });
    this.failures.delete(protocol);
  }
  async retire(protocol: QQProtocol): Promise<void> {
    const record = this.records.get(protocol);
    if (record) this.fence(record);
    try {
      const state = this.kernel.host.manager.get(identity(sourceId(protocol)))?.state;
      if (state && state !== 'disabled') await this.kernel.setEnabled(sourceId(protocol), false);
      await record?.root?.settled;
      if (record && this.records.get(protocol) === record) this.records.delete(protocol);
      this.cleanup.set(protocol, 'settled');
      this.failures.delete(protocol);
    } catch (error) {
      if (record) {
        record.cleanup = 'failed';
        record.error = errorOf(error);
      }
      this.cleanup.set(protocol, 'failed');
      this.failures.set(protocol, errorOf(error));
      throw error;
    }
  }
  private async verifyExpected(
    protocol: QQProtocol,
    expected?: LocalSourceExpectation,
  ): Promise<void> {
    if (!expected) return;
    const current = await this.configured(protocol);
    const slot = this.slot(current.settings, current.revision);
    if (
      current.revision !== expected.expectedConfigRevision ||
      slot.version !== expected.expectedCredentialVersion
    )
      throw new KernelFault('conflict');
  }
  private async apply(
    protocol: QQProtocol,
    desired: boolean,
    expected?: LocalSourceExpectation,
  ): Promise<KernelError | null> {
    try {
      await this.verifyExpected(protocol, expected);
      if (desired) await this.start(protocol, expected);
      else await this.retire(protocol);
      return null;
    } catch (error) {
      const failure = errorOf(error);
      this.failures.set(protocol, failure);
      this.notify();
      return failure;
    }
  }
  async setEnabled(
    protocol: QQProtocol,
    enabled: boolean,
    expectedRevision: number,
    expectedSource?: LocalSourceExpectation,
  ): Promise<LocalSourceMutation> {
    if (
      !['official', 'onebot-v11'].includes(protocol) ||
      typeof enabled !== 'boolean' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      (expectedSource &&
        (!Number.isSafeInteger(expectedSource.expectedConfigRevision) ||
          expectedSource.expectedConfigRevision < 0 ||
          typeof expectedSource.expectedCredentialVersion !== 'string' ||
          !expectedSource.expectedCredentialVersion))
    )
      throw new KernelFault('invalid-input');
    const capturedExpected = expectedSource ? { ...expectedSource } : undefined;
    return this.exclusive(protocol, async () => {
      await this.verifyExpected(protocol, capturedExpected);
      const before = await this.desired();
      if (before.revision !== expectedRevision) throw new KernelFault('conflict');
      if (before[field(protocol)] !== enabled) {
        if (!this.intent.save) throw new KernelFault('not-ready');
        await this.intent.save(
          {
            officialEnabled: protocol === 'official' ? enabled : before.officialEnabled,
            onebotEnabled: protocol === 'onebot-v11' ? enabled : before.onebotEnabled,
          },
          expectedRevision,
        );
      }
      const error = await this.apply(protocol, enabled, capturedExpected);
      return { view: await this.view(), error };
    });
  }
  async saveSource(input: QQSourceSettingsCommand): Promise<LocalSourceMutation> {
    if (!isQQSourceSettingsCommand(input)) throw new KernelFault('invalid-input');
    input = structuredClone(input);
    return this.exclusive(input.protocol, async () => {
      const current = await this.configured(input.protocol);
      if (current.revision !== input.expectedRevision) throw new KernelFault('conflict');
      if (this.redactor.containsValue(input.settings)) throw new KernelFault('permission-denied');
      if (isDeepStrictEqual(current.settings, input.settings))
        return { view: await this.view(), error: null };
      const saved = await this.kernel.host.configs.save(
        identity(sourceId(input.protocol)),
        structuredClone(input.settings) as unknown as JsonObject,
        input.expectedRevision,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      const desired = await this.desired();
      let error: KernelError | null = null;
      try {
        await this.retire(input.protocol);
        if (desired[field(input.protocol)]) await this.start(input.protocol);
      } catch (cause) {
        error = errorOf(cause);
        this.failures.set(input.protocol, error);
      }
      return { view: await this.view(), error };
    });
  }
  async credential(input: QQCredentialCommand, signal?: AbortSignal): Promise<LocalSourceMutation> {
    if (!isQQCredentialCommand(input) || (signal !== undefined && !(signal instanceof AbortSignal)))
      throw new KernelFault('invalid-input');
    const command = { ...input };
    return this.exclusive(command.protocol, async () => {
      if (signal?.aborted) throw new KernelFault('cancelled');
      const current = await this.configured(command.protocol);
      const slot = this.slot(current.settings, current.revision);
      if (
        current.revision !== command.expectedRevision ||
        slot.version !== command.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
      const desired = await this.desired();
      if (signal?.aborted) throw new KernelFault('cancelled');
      const record = this.records.get(command.protocol);
      if (record) this.fence(record);
      await this.retire(command.protocol);
      const latest = await this.configured(command.protocol);
      if (
        latest.revision !== command.expectedRevision ||
        this.slots.get(command.protocol) !== slot ||
        slot.target !== targetOf(latest.settings) ||
        slot.version !== command.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
      if (signal?.aborted) throw new KernelFault('cancelled');
      if (command.value !== null) this.redactor.add(command.value);
      slot.value = command.value ?? undefined;
      slot.version = this.version();
      const error = desired[field(command.protocol)]
        ? await this.apply(command.protocol, true)
        : null;
      return { view: await this.view(), error };
    });
  }
  async view(): Promise<LocalSourcesView> {
    const desired = await this.desired();
    const sources = await Promise.all(
      (['official', 'onebot-v11'] as const).map(async (protocol): Promise<QQSourceView> => {
        const current = await this.configured(protocol);
        const slot = this.slot(current.settings, current.revision);
        const record = this.records.get(protocol);
        const enabled = desired[field(protocol)];
        const policy = this.kernel.host.permissionControl.inspect(identity(sourceId(protocol)));
        const applied =
          record &&
          this.kernel.host.isEnabled(sourceId(protocol)) &&
          record.running &&
          !record.signal.aborted &&
          record.revision === current.revision &&
          record.credentialVersion === slot.version &&
          policy &&
          !policy.blocked &&
          policy.preset !== 'deny' &&
          policy.epoch === record.permissionEpoch &&
          this.kernel.host.verifySource(sourceId(protocol))
            ? record
            : undefined;
        const phase = !enabled
          ? 'disabled'
          : !accountOf(current.settings) || !slot.value
            ? 'unconfigured'
            : !applied
              ? 'failed'
              : !applied.status ||
                  applied.status.phase === 'waiting' ||
                  applied.status.phase === 'idle'
                ? 'connecting'
                : applied.status.phase === 'stopped'
                  ? 'offline'
                  : applied.status.phase;
        let cleanup = record?.cleanup ?? this.cleanup.get(protocol) ?? 'settled';
        try {
          const lifecycle = this.kernel.review?.(sourceId(protocol)).cleanup;
          if (lifecycle && lifecycle !== 'settled') cleanup = lifecycle;
        } catch {
          /* package change is reported below */
        }
        return {
          protocol,
          sourcePluginId: sourceId(protocol),
          instanceId: 'default',
          desiredEnabled: enabled,
          source: !enabled ? 'disabled' : applied ? 'ready' : 'unavailable',
          configRevision: current.revision,
          appliedRevision: applied?.revision ?? null,
          settings: current.settings,
          account: accountOf(current.settings),
          bindingId: applied?.bindingId ?? null,
          phase,
          credential: {
            available: !!slot.value,
            writable: true,
            version: slot.version,
            source: slot.value ? 'memory' : 'none',
          },
          installedVersion: null,
          media: {
            text: 'unverified',
            image: 'unverified',
            voice: 'unverified',
            file: 'unverified',
          },
          cleanup,
          error:
            (enabled &&
            policy &&
            (policy.blocked ||
              policy.preset === 'deny' ||
              (record && policy.epoch !== record.permissionEpoch))
              ? makeError('permission-denied')
              : null) ??
            record?.error ??
            this.failures.get(protocol) ??
            (enabled && !applied ? makeError('not-ready') : null),
        };
      }),
    );
    if ((await this.desired()).revision !== desired.revision) throw new KernelFault('conflict');
    return { revision: desired.revision, sources };
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      this.offCommit();
      for (const record of this.records.values()) this.fence(record);
      await Promise.allSettled([...this.operations]);
      const results = await Promise.allSettled(
        (['official', 'onebot-v11'] as const).map((protocol) => this.retire(protocol)),
      );
      for (const slot of this.slots.values()) slot.value = undefined;
      this.redactor.clear();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })());
  }
}

/** Local daemon adaptation: Config CAS owns desired state and every business effect needs remote authority. */
export class LocalQQSourceController extends QQSourceCore {
  constructor(kernel: LocalPluginKernel, options: LocalQQSourceOptions) {
    super(
      kernel,
      options,
      {
        async read() {
          const result = await kernel.host.configs.get(identity(LOCAL_QQ_CONTROL_ID));
          if (!result.ok) throw new KernelFault(result.error.code);
          const { officialEnabled, onebotEnabled } = result.value.data;
          if (typeof officialEnabled !== 'boolean' || typeof onebotEnabled !== 'boolean')
            throw new KernelFault('invalid-input');
          return { revision: result.value.revision, officialEnabled, onebotEnabled };
        },
        async save(value, expectedRevision) {
          const result = await kernel.host.configs.save(
            identity(LOCAL_QQ_CONTROL_ID),
            value,
            expectedRevision,
          );
          if (!result.ok) throw new KernelFault(result.error.code);
        },
      },
      true,
    );
  }
}

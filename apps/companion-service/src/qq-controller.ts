import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import {
  defaultQQPolicySettings,
  isQQCredentialCommand,
  isCompanionRecordId,
  isQQPolicySettings,
  isQQPolicyCommand,
  isQQView,
  QQ_VIEW_MAX_BYTES,
  isQQSourceSettings,
  isQQSourceSettingsCommand,
  makeError,
  sameQQAccount,
  QQ_FEATURE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type CompanionCommandReceipt,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type QQAccountRef,
  type QQCredentialCommand,
  type QQDeliveryPage,
  type QQDeliveryView,
  type QQJudgePolicy,
  type QQJudgeView,
  type QQOfficialSettings,
  type QQOneBotSettings,
  type QQPolicySettings,
  type QQPrincipalPage,
  type QQProtocol,
  type QQSourceSettings,
  type QQSourceView,
  type QQStatus,
  type QQView,
} from '@pet/contracts';
import { KernelFault, SecretRedactor, type TaskHandle } from '@pet/host-kernel';
import {
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type ModelConnections,
} from '@pet/companion-runtime';
import type { PluginContext } from '@pet/plugin-sdk';
import type { SharedQQPorts } from '../../../plugins/shared-qq/src/index.js';
import type {
  OfficialQqPorts,
  OfficialDriverStatus,
  OfficialIo,
} from '../../../plugins/qq-official/src/ports.js';
import type { OfficialQqDriver } from '../../../plugins/qq-official/src/driver.js';
import type { OfficialMessageEvent } from '../../../plugins/qq-official/src/wire.js';
import type {
  OneBotQqPorts,
  OneBotDriverStatus,
  OneBotIo,
} from '../../../plugins/qq-onebot/src/ports.js';
import type { OneBotQqDriver } from '../../../plugins/qq-onebot/src/driver.js';
import type { OneBotFrame, OneBotResponse } from '../../../plugins/qq-onebot/src/wire.js';
import { createAuthorizedOfficialIo, type OfficialIoTestHooks } from './qq-official-io.js';
import { createAuthorizedOneBotIo } from './qq-onebot-io.js';
import type { CapturedQqBinding } from './qq-native-types.js';
import { resolveQQParticipant } from './qq-policy.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' as const });
const pluginId = (protocol: QQProtocol): string =>
  protocol === 'official' ? QQ_OFFICIAL_PLUGIN_ID : QQ_ONEBOT_PLUGIN_ID;
const protocolFor = (id: string): QQProtocol | null =>
  id === QQ_OFFICIAL_PLUGIN_ID ? 'official' : id === QQ_ONEBOT_PLUGIN_ID ? 'onebot-v11' : null;
const safeError = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable');
const toJson = (value: QQSourceSettings | QQPolicySettings): JsonObject =>
  structuredClone(value) as unknown as JsonObject;
const targetOf = (settings: QQSourceSettings): string =>
  settings.protocol === 'official'
    ? JSON.stringify([settings.protocol, settings.appId])
    : JSON.stringify([
        settings.protocol,
        settings.accountId,
        settings.mode,
        settings.channelMode,
        settings.listenHost,
        settings.listenPort,
        settings.path,
      ]);
const accountOf = (settings: QQSourceSettings): QQAccountRef | null => {
  const accountId = settings.protocol === 'official' ? settings.appId : settings.accountId;
  return accountId
    ? {
        protocol: settings.protocol,
        sourcePluginId: pluginId(settings.protocol),
        instanceId: 'default',
        accountId,
      }
    : null;
};
const authorityFields = (policy: QQPolicySettings): unknown => [
  policy.privateAllowlist,
  policy.groupAllowlist,
  policy.principalAliases,
  policy.administratorPrincipalIds,
  policy.knownMachineActors,
];

interface Slot {
  target: string;
  revision: number;
  version: string;
  value: string | undefined;
}
interface SourceRecord {
  readonly owner: OwnerRef;
  readonly settings: QQSourceSettings;
  readonly revision: number;
  readonly credentialVersion: string;
  readonly policyEpoch: number;
  readonly abort: AbortController;
  readonly signal: AbortSignal;
  readonly context: PluginContext;
  readonly bindingId: string;
  driver: OfficialQqDriver | OneBotQqDriver | undefined;
  root: TaskHandle | undefined;
  running: boolean;
  status: OfficialDriverStatus | OneBotDriverStatus | undefined;
  connection: { readonly id: string; readonly signal: AbortSignal } | undefined;
  cleanup: QQSourceView['cleanup'];
  error: KernelError | null;
}
interface FeatureLease {
  readonly epoch: number;
  readonly abort: AbortController;
  readonly ready: Promise<AbortSignal>;
  readonly done: Promise<void>;
  signal?: AbortSignal;
}
export interface CapturedParticipantAuthority {
  readonly signal: AbortSignal;
  readonly policyEpoch: number;
  check(): Promise<void>;
}
export interface CapturedQqSourceBase {
  readonly account: QQAccountRef;
  readonly connectionId: string;
  readonly selfId?: string;
  readonly signal: AbortSignal;
  check(): Promise<void>;
}
export type CapturedQqSource = CapturedQqSourceBase &
  (
    | { readonly protocol: 'official'; readonly driver: OfficialQqDriver }
    | { readonly protocol: 'onebot-v11'; readonly driver: OneBotQqDriver }
  );
export interface QQIngressHandlers {
  official(event: OfficialMessageEvent, source: CapturedQqSourceBase): Promise<void>;
  onebot(event: Exclude<OneBotFrame, OneBotResponse>, source: CapturedQqSourceBase): Promise<void>;
}
export interface QQControllerOptions {
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
export interface QQJudgePort {
  view(): Promise<QQJudgeView>;
  save(input: unknown): Promise<{ readonly error: KernelError | null }>;
  credential(input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

/** One controller for the existing Config, PluginManager and source-owned tasks. */
export class QQController {
  private readonly generation = randomUUID();
  private readonly slots = new Map<QQProtocol, Slot>();
  private readonly records = new Map<QQProtocol, SourceRecord>();
  private readonly failures = new Map<QQProtocol, KernelError>();
  private readonly cleanup = new Map<QQProtocol, QQSourceView['cleanup']>();
  private readonly redactor = new SecretRedactor();
  private policyValue: QQPolicySettings = defaultQQPolicySettings();
  private policyRevision = 0;
  private policyInvalid = false;
  private policyBound = false;
  private featureOwner: OwnerRef | undefined;
  private featureSignal: AbortSignal | undefined;
  private featureLease: FeatureLease | undefined;
  private leaseGate: Promise<void> = Promise.resolve();
  private ingress: QQIngressHandlers | undefined;
  private judge: QQJudgePort | undefined;
  private codec: () => QQView['codec'] = () => ({
    source: 'disabled',
    imageId: null,
    manifestSha256: null,
    cleanup: 'settled',
    error: null,
  });
  private offConfig: (() => void) | undefined;
  private pendingPolicyRechecks = 0;
  private resolvePolicyDrain: (() => void) | undefined;
  private policyRecheckFailure: KernelError | undefined;
  private busy = false;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    readonly host: CompanionPluginHost,
    readonly runtime: CompanionRuntime,
    readonly connections: ModelConnections,
    readonly options: QQControllerOptions = {},
  ) {}

  private version(): string {
    return `${this.generation}:${randomUUID()}`;
  }
  private slot(settings: QQSourceSettings, revision: number): Slot {
    const target = targetOf(settings);
    let slot = this.slots.get(settings.protocol);
    if (slot && revision < slot.revision) throw new KernelFault('conflict');
    if (!slot || slot.target !== target) {
      slot = { target, revision, version: this.version(), value: undefined };
      this.slots.set(settings.protocol, slot);
    } else slot.revision = revision;
    return slot;
  }
  private fence(record: SourceRecord): void {
    record.abort.abort();
    record.cleanup = 'pending';
    this.cleanup.set(record.settings.protocol, 'pending');
  }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.busy) throw new KernelFault('conflict');
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
      this.runtime.notify();
    }
  }
  private recheckPolicy(): void {
    // Start while the committed policy is current; an older slow check cannot defer this one.
    // A count and one drain waiter track all settlements without retaining a per-commit registry.
    this.pendingPolicyRechecks++;
    const finish = (failure?: { readonly error: unknown }): void => {
      if (failure) {
        this.policyRecheckFailure ??= safeError(failure.error);
        this.policyInvalid = true;
        this.featureLease?.abort.abort();
        this.runtime.notify();
      }
      this.pendingPolicyRechecks--;
      if (this.pendingPolicyRechecks === 0) {
        const resolve = this.resolvePolicyDrain;
        this.resolvePolicyDrain = undefined;
        resolve?.();
      }
    };
    try {
      const work = this.runtime.recheckInputAuthorities();
      void work.then(
        () => finish(),
        (error: unknown) => finish({ error }),
      );
    } catch (error) {
      finish({ error });
    }
  }
  private updatePolicy(settings: QQPolicySettings, revision: number): void {
    if (revision < this.policyRevision) return;
    if (
      revision === this.policyRevision &&
      revision !== 0 &&
      !this.policyInvalid &&
      !isDeepStrictEqual(this.policyValue, settings)
    )
      throw new KernelFault('conflict');
    const changed =
      this.policyInvalid ||
      !isDeepStrictEqual(authorityFields(this.policyValue), authorityFields(settings));
    this.policyValue = structuredClone(settings);
    this.policyRevision = revision;
    this.policyInvalid = false;
    if (changed) this.recheckPolicy();
    this.runtime.notify();
  }
  async initialize(): Promise<void> {
    if (this.closed || this.offConfig) throw new KernelFault('conflict');
    this.offConfig = this.host.onConfigurationCommit((commit) => {
      if (commit.instanceId !== 'default') return;
      if (commit.pluginId === QQ_FEATURE_PLUGIN_ID) {
        if (isQQPolicySettings(commit.data)) this.updatePolicy(commit.data, commit.revision);
        else if (commit.revision >= this.policyRevision) {
          this.policyRevision = commit.revision;
          this.policyInvalid = true;
          this.featureLease?.abort.abort();
          this.recheckPolicy();
          this.runtime.notify();
        }
        return;
      }
      const protocol = protocolFor(commit.pluginId);
      if (!protocol) return;
      if (isQQSourceSettings(commit.data) && commit.data.protocol === protocol) {
        this.slot(commit.data, commit.revision);
      } else {
        const slot = this.slots.get(protocol);
        if (slot && commit.revision >= slot.revision) {
          slot.value = undefined;
          slot.version = this.version();
          slot.revision = commit.revision;
        }
        this.failures.set(protocol, makeError('invalid-input'));
      }
      const record = this.records.get(protocol);
      if (record && record.revision !== commit.revision) this.fence(record);
    });
    const profile = await this.runtime.profile();
    const disabled =
      Array.isArray(profile.data['disabledPlugins']) &&
      profile.data['disabledPlugins'].includes(QQ_FEATURE_PLUGIN_ID);
    const policy = await this.host.configs.get(identity(QQ_FEATURE_PLUGIN_ID));
    if (!policy.ok || !isQQPolicySettings(policy.value.data)) {
      if (!disabled) throw new KernelFault('not-ready');
      this.policyInvalid = true;
      if (policy.ok) this.policyRevision = policy.value.revision;
      return;
    }
    this.updatePolicy(policy.value.data, policy.value.revision);
    if (!disabled && !this.host.isEnabled(QQ_FEATURE_PLUGIN_ID))
      await this.host.setEnabled(QQ_FEATURE_PLUGIN_ID, true);
    if (disabled) return;
    const desired = await this.desired();
    for (const protocol of ['official', 'onebot-v11'] as const) {
      const current = await this.configured(protocol);
      this.slot(current.settings, current.revision);
      if (!desired.has(pluginId(protocol))) continue;
      try {
        if (!this.host.isEnabled(pluginId(protocol)))
          await this.host.setEnabled(pluginId(protocol), true);
        await this.start(protocol);
      } catch (error) {
        this.failures.set(protocol, safeError(error));
      }
    }
  }
  featurePorts(context: PluginContext): SharedQQPorts {
    if (context.owner.pluginId !== QQ_FEATURE_PLUGIN_ID) throw new KernelFault('permission-denied');
    return {
      bind: (policy) => {
        if (
          !isQQPolicySettings(policy) ||
          !isDeepStrictEqual(policy, this.policyValue) ||
          context.signal.aborted
        )
          throw new KernelFault('stale-owner');
        this.policyBound = true;
        const owner = { ...context.owner };
        this.featureOwner = owner;
        this.featureSignal = context.signal;
        return async () => {
          if (this.featureOwner?.generation !== owner.generation) return;
          this.policyBound = false;
          this.featureOwner = undefined;
          this.featureSignal = undefined;
          const lease = this.featureLease;
          lease?.abort.abort();
          await lease?.done;
          if (this.featureLease === lease) this.featureLease = undefined;
        };
      },
    };
  }
  private savedPolicy(): { readonly revision: number; readonly settings: QQPolicySettings } {
    if (this.closed || this.policyRevision < 1) throw new KernelFault('not-ready');
    if (this.policyInvalid) throw new KernelFault('invalid-input');
    return { revision: this.policyRevision, settings: structuredClone(this.policyValue) };
  }
  policy(): { readonly revision: number; readonly settings: QQPolicySettings } {
    if (
      !this.policyBound ||
      this.closed ||
      !this.host.verifySource(QQ_FEATURE_PLUGIN_ID) ||
      !this.host.isEnabled(QQ_FEATURE_PLUGIN_ID)
    )
      throw new KernelFault('not-ready');
    const authority = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    if (!authority || authority.blocked || authority.preset === 'deny')
      throw new KernelFault('permission-denied');
    return this.savedPolicy();
  }
  captureParticipantAuthority(): Promise<CapturedParticipantAuthority> {
    const acquisition = this.leaseGate.then(() => this.acquireParticipantAuthority());
    this.leaseGate = acquisition.then(
      () => {},
      () => {},
    );
    return acquisition;
  }
  private async acquireParticipantAuthority(): Promise<CapturedParticipantAuthority> {
    this.policy();
    let policy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    if (!policy || policy.blocked || policy.preset === 'deny')
      throw new KernelFault('permission-denied');
    let lease = this.featureLease;
    if (lease && (lease.epoch !== policy.epoch || lease.abort.signal.aborted)) {
      lease.abort.abort();
      await lease.done;
      if (this.featureLease === lease) this.featureLease = undefined;
      lease = undefined;
      this.policy();
      policy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
      if (!policy || policy.blocked || policy.preset === 'deny')
        throw new KernelFault('permission-denied');
    }
    if (!lease) {
      const owner = this.featureOwner;
      const ownerSignal = this.featureSignal;
      if (!owner || !ownerSignal || ownerSignal.aborted) throw new KernelFault('not-ready');
      const epoch = policy.epoch;
      const abort = new AbortController();
      let resolveReady: (signal: AbortSignal) => void = () => {};
      let rejectReady: (error: unknown) => void = () => {};
      const ready = new Promise<AbortSignal>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const work = withSourceAuthority(
        this.host,
        QQ_FEATURE_PLUGIN_ID,
        [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
        async (sourceSignal, context) => {
          const current = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
          if (
            context.owner.generation !== owner.generation ||
            context.owner.instanceId !== owner.instanceId ||
            !current ||
            current.epoch !== epoch ||
            current.blocked ||
            current.preset === 'deny'
          )
            throw new KernelFault('permission-denied');
          this.policy();
          const signal = AbortSignal.any([sourceSignal, abort.signal, ownerSignal]);
          if (signal.aborted) throw new KernelFault('permission-denied');
          resolveReady(signal);
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return null;
        },
        { signal: AbortSignal.any([abort.signal, ownerSignal]) },
      );
      const done = work.then(
        () => {},
        (error: unknown) => {
          abort.abort();
          rejectReady(error instanceof KernelFault ? error : new KernelFault('permission-denied'));
        },
      );
      lease = { epoch, abort, ready, done };
      this.featureLease = lease;
    }
    const captured = lease;
    const signal = await captured.ready;
    captured.signal = signal;
    const check = async (): Promise<void> => {
      if (signal.aborted || this.featureLease !== captured)
        throw new KernelFault('permission-denied');
      this.policy();
      const current = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
      if (
        !current ||
        current.blocked ||
        current.preset === 'deny' ||
        current.epoch !== captured.epoch ||
        signal.aborted
      )
        throw new KernelFault('permission-denied');
    };
    await check();
    return { signal, policyEpoch: captured.epoch, check };
  }
  judgePolicyPorts(): {
    read(): Promise<{ revision: number; settings: QQJudgePolicy }>;
    save(
      expectedRevision: number,
      judge: QQJudgePolicy,
    ): Promise<{ revision: number; settings: QQJudgePolicy }>;
  } {
    return {
      read: async () => {
        const value = this.savedPolicy();
        return { revision: value.revision, settings: value.settings.judge };
      },
      save: async (expectedRevision, judge) => {
        const current = this.savedPolicy();
        if (current.revision !== expectedRevision) throw new KernelFault('conflict');
        const next = { ...current.settings, judge };
        if (!isQQPolicySettings(next)) throw new KernelFault('invalid-input');
        const result = await this.host.configs.save(
          identity(QQ_FEATURE_PLUGIN_ID),
          toJson(next),
          expectedRevision,
        );
        if (!result.ok) throw new KernelFault(result.error.code);
        const value = this.savedPolicy();
        return { revision: value.revision, settings: value.settings.judge };
      },
    };
  }
  setJudge(judge: QQJudgePort): void {
    this.judge = judge;
  }
  setIngress(handlers: QQIngressHandlers): void {
    this.ingress = handlers;
  }
  setCodecStatusProvider(provider: () => QQView['codec']): void {
    this.codec = provider;
  }

  private async configured(
    protocol: QQProtocol,
  ): Promise<{ settings: QQSourceSettings; revision: number }> {
    const id = pluginId(protocol);
    if (!this.host.verifySource(id)) throw new KernelFault('package-changed');
    const config = await this.host.configs.get(identity(id));
    if (
      !config.ok ||
      !isQQSourceSettings(config.value.data) ||
      config.value.data.protocol !== protocol
    )
      throw new KernelFault(config.ok ? 'invalid-input' : config.error.code);
    return { settings: structuredClone(config.value.data), revision: config.value.revision };
  }
  private async desired(): Promise<Set<string>> {
    const profile = await this.runtime.profile();
    const enabled = Array.isArray(profile.data['enabledOptionalPlugins'])
      ? profile.data['enabledOptionalPlugins'].filter((id): id is string => typeof id === 'string')
      : [];
    const disabled = Array.isArray(profile.data['disabledPlugins'])
      ? profile.data['disabledPlugins'].filter((id): id is string => typeof id === 'string')
      : [];
    return new Set(enabled.filter((id) => !disabled.includes(id)));
  }
  async prepareSource(context: PluginContext): Promise<void> {
    const protocol = protocolFor(context.owner.pluginId);
    if (!protocol || context.owner.instanceId !== 'default' || context.signal.aborted)
      throw new KernelFault('stale-owner');
    const config = await this.configured(protocol);
    if (
      context.signal.aborted ||
      !isDeepStrictEqual(context.config, config.settings) ||
      this.records.has(protocol)
    )
      throw new KernelFault('conflict');
    const slot = this.slot(config.settings, config.revision);
    const policy = this.host.permissionControl.inspect(identity(context.owner.pluginId));
    if (!policy) throw new KernelFault('permission-denied');
    const abort = new AbortController();
    this.records.set(protocol, {
      owner: { ...context.owner },
      settings: config.settings,
      revision: config.revision,
      credentialVersion: slot.version,
      policyEpoch: policy.epoch,
      abort,
      signal: AbortSignal.any([context.signal, abort.signal]),
      context,
      bindingId: `qq-${randomUUID()}`,
      driver: undefined,
      root: undefined,
      running: false,
      status: undefined,
      connection: undefined,
      cleanup: 'settled',
      error: null,
    });
  }
  private record(context: PluginContext, protocol: QQProtocol): SourceRecord {
    const record = this.records.get(protocol);
    if (
      !record ||
      record.owner.pluginId !== context.owner.pluginId ||
      record.owner.generation !== context.owner.generation ||
      record.context !== context ||
      record.signal.aborted
    )
      throw new KernelFault('stale-owner');
    return record;
  }
  private async check(record: SourceRecord): Promise<void> {
    const protocol = record.settings.protocol;
    const current = this.host.manager.get(identity(record.owner.pluginId));
    const policy = this.host.permissionControl.inspect(identity(record.owner.pluginId));
    if (
      this.closed ||
      record.signal.aborted ||
      this.records.get(protocol) !== record ||
      !current ||
      current.owner.generation !== record.owner.generation ||
      !this.host.manager.isActive(record.owner)
    )
      throw new KernelFault('stale-owner');
    if (!this.host.verifySource(record.owner.pluginId)) throw new KernelFault('package-changed');
    if (
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      policy.epoch !== record.policyEpoch
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
      configRevision: record.revision,
      credentialVersion: record.credentialVersion,
      settings,
      credential: slot.value ?? '',
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
  ): CapturedQqSourceBase {
    this.policy();
    const account = accountOf(record.settings);
    const featureOwner = this.featureOwner;
    const featureSignal = this.featureSignal;
    const featurePolicy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    if (!account || !connectionId || !featureOwner || !featureSignal || !featurePolicy)
      throw new KernelFault('not-ready');
    const joined = AbortSignal.any([record.signal, signal, featureSignal]);
    const selfId =
      record.settings.protocol === 'official'
        ? record.status && 'selfId' in record.status
          ? record.status.selfId
          : null
        : record.settings.accountId;
    return {
      account,
      connectionId,
      ...(selfId ? { selfId } : {}),
      signal: joined,
      check: async () => {
        this.policy();
        await this.check(record);
        this.policy();
        const currentFeaturePolicy = this.host.permissionControl.inspect(
          identity(QQ_FEATURE_PLUGIN_ID),
        );
        if (
          joined.aborted ||
          this.featureOwner?.generation !== featureOwner.generation ||
          !currentFeaturePolicy ||
          currentFeaturePolicy.epoch !== featurePolicy.epoch ||
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
          ? this.options.officialFactory(this.host, binding)
          : createAuthorizedOfficialIo(this.host, binding, this.options.officialTest);
        return {
          media: io.media,
          openGateway: async (signal) => {
            const gateway = await io.openGateway(signal);
            try {
              await this.check(record);
              if (gateway.signal.aborted) throw new KernelFault('stale-owner');
              record.connection = { id: gateway.id, signal: gateway.signal };
              return gateway;
            } catch (error) {
              await gateway.close();
              await gateway.settled;
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
            this.runtime.notify();
          }
        },
        onEvent: async (event, id, signal) => {
          const source = this.capture(record, id, signal);
          await source.check();
          if (record.settings.protocol !== 'official') throw new KernelFault('stale-owner');
          const scene = event.t === 'C2C_MESSAGE_CREATE' ? 'private' : 'group';
          if (!record.settings.scenes.includes(scene)) return;
          if (!this.ingress) throw new KernelFault('not-ready');
          await this.ingress.official(event, source);
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
          ? this.options.onebotFactory(this.host, binding)
          : createAuthorizedOneBotIo(this.host, binding, this.options.onebotTest);
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
            this.runtime.notify();
          }
        },
        onEvent: async (event, id, signal) => {
          const source = this.capture(record, id, signal);
          await source.check();
          if (!this.ingress) throw new KernelFault('not-ready');
          await this.ingress.onebot(event, source);
          await source.check();
        },
      },
      bind: (driver) => this.bind(record, driver),
    };
  }
  sourceFor(account: QQAccountRef): CapturedQqSource {
    this.policy();
    const featurePolicy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    const participant = this.featureLease;
    if (
      !participant?.signal ||
      participant.signal.aborted ||
      participant.abort.signal.aborted ||
      !featurePolicy ||
      participant.epoch !== featurePolicy.epoch
    )
      throw new KernelFault('permission-denied');
    const record = this.records.get(account.protocol);
    const capturedAccount = record && accountOf(record.settings);
    if (
      !record?.driver ||
      !record.status ||
      record.status.phase !== 'ready' ||
      !record.status.connectionId ||
      !record.connection ||
      record.connection.id !== record.status.connectionId ||
      record.connection.signal.aborted ||
      !capturedAccount ||
      !sameQQAccount(capturedAccount, account)
    )
      throw new KernelFault('not-ready');
    const base = this.capture(
      record,
      record.status.connectionId,
      AbortSignal.any([record.connection.signal, participant.signal]),
    );
    if (account.protocol === 'official')
      return { ...base, protocol: 'official', driver: record.driver as OfficialQqDriver };
    return { ...base, protocol: 'onebot-v11', driver: record.driver as OneBotQqDriver };
  }
  private async start(protocol: QQProtocol): Promise<void> {
    const record = this.records.get(protocol);
    if (!record?.driver) return;
    if (record.root) return;
    if (!this.ingress) throw new KernelFault('not-ready');
    if (!this.slot(record.settings, record.revision).value) {
      record.error = makeError('not-ready');
      return;
    }
    await this.check(record);
    record.cleanup = 'pending';
    const root = this.host.runFor(
      record.owner.pluginId,
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
        this.runtime.notify();
      }
    });
    void root.settled.then(() => {
      record.running = false;
      record.cleanup = 'settled';
      if (this.records.get(protocol) === record && !record.signal.aborted)
        this.cleanup.set(protocol, 'settled');
      this.runtime.notify();
    });
    this.failures.delete(protocol);
  }
  private async retire(protocol: QQProtocol): Promise<void> {
    const record = this.records.get(protocol);
    if (record) this.fence(record);
    try {
      const state = this.host.manager.get(identity(pluginId(protocol)))?.state;
      if (state && state !== 'disabled') await this.host.setEnabled(pluginId(protocol), false);
      await record?.root?.settled;
      if (record) {
        record.cleanup = 'settled';
        if (this.records.get(protocol) === record) this.records.delete(protocol);
      }
      this.cleanup.set(protocol, 'settled');
      this.failures.delete(protocol);
    } catch (error) {
      if (record) {
        record.cleanup = 'failed';
        record.error = safeError(error);
      }
      this.cleanup.set(protocol, 'failed');
      this.failures.set(protocol, safeError(error));
      throw error;
    }
  }
  private async reload(protocol: QQProtocol, desired: boolean): Promise<void> {
    await this.retire(protocol);
    if (!desired) return;
    try {
      await this.host.setEnabled(pluginId(protocol), true);
      await this.start(protocol);
    } catch (error) {
      this.failures.set(protocol, safeError(error));
      throw error;
    }
  }
  async setPlugin(
    id: string,
    enabled: boolean,
    commandId: string,
  ): Promise<CompanionCommandReceipt> {
    const protocol = protocolFor(id);
    if (!protocol) throw new KernelFault('invalid-input');
    return this.serialized(async () => {
      const lookup = { commandId, kind: 'plugin.select', payload: { id, enabled } };
      const known = await this.runtime.state('getCommand', lookup);
      if (known) return known;
      const previous = this.records.get(protocol);
      if (enabled && previous && (previous.signal.aborted || (previous.root && !previous.running)))
        await this.retire(protocol);
      if (!enabled && previous) this.fence(previous);
      let receipt: CompanionCommandReceipt;
      try {
        receipt = await this.runtime.setPlugin(id, enabled, commandId);
      } catch (error) {
        if (!enabled && previous) {
          this.cleanup.set(protocol, 'failed');
          this.failures.set(protocol, safeError(error));
        }
        throw error;
      }
      if (receipt.status === 'duplicate') return receipt;
      if (enabled) {
        try {
          await this.start(protocol);
        } catch (error) {
          this.failures.set(protocol, safeError(error));
          throw error;
        }
      } else {
        await previous?.root?.settled;
        if (previous && this.records.get(protocol) === previous) this.records.delete(protocol);
        this.cleanup.set(protocol, 'settled');
      }
      return receipt;
    });
  }
  async savePolicy(input: unknown): Promise<QQView> {
    if (!isQQPolicyCommand(input)) throw new KernelFault('invalid-input');
    return this.serialized(async () => {
      if (this.redactor.containsValue(input.settings)) throw new KernelFault('permission-denied');
      const saved = await this.host.configs.save(
        identity(QQ_FEATURE_PLUGIN_ID),
        toJson(input.settings),
        input.expectedRevision,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      return this.view();
    });
  }
  async saveSource(input: unknown): Promise<QQView> {
    if (!isQQSourceSettingsCommand(input)) throw new KernelFault('invalid-input');
    return this.serialized(async () => {
      const current = await this.configured(input.protocol);
      if (current.revision !== input.expectedRevision) throw new KernelFault('conflict');
      if (this.redactor.containsValue(input.settings)) throw new KernelFault('permission-denied');
      if (isDeepStrictEqual(current.settings, input.settings)) return this.view();
      const desired = await this.desired();
      const saved = await this.host.configs.save(
        identity(pluginId(input.protocol)),
        toJson(input.settings),
        input.expectedRevision,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      await this.reload(input.protocol, desired.has(pluginId(input.protocol)));
      return this.view();
    });
  }
  async credential(input: unknown): Promise<QQView> {
    if (!isQQCredentialCommand(input)) throw new KernelFault('invalid-input');
    const command: QQCredentialCommand = input;
    return this.serialized(async () => {
      const current = await this.configured(command.protocol);
      const slot = this.slot(current.settings, current.revision);
      if (
        current.revision !== command.expectedRevision ||
        slot.version !== command.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
      const desired = await this.desired();
      slot.value = undefined;
      slot.version = this.version();
      const record = this.records.get(command.protocol);
      if (record) this.fence(record);
      await this.retire(command.protocol);
      if (command.value !== null) this.redactor.add(command.value);
      slot.value = command.value ?? undefined;
      slot.version = this.version();
      if (desired.has(pluginId(command.protocol))) {
        try {
          await this.host.setEnabled(pluginId(command.protocol), true);
          await this.start(command.protocol);
        } catch (error) {
          this.failures.set(command.protocol, safeError(error));
          throw error;
        }
      }
      return this.view();
    });
  }
  async saveJudge(input: unknown): Promise<QQView> {
    if (!this.judge) throw new KernelFault('not-ready');
    const result = await this.judge.save(input);
    if (result.error) throw new KernelFault(result.error.code);
    return this.view();
  }
  async judgeCredential(input: unknown): Promise<QQView> {
    if (!this.judge) throw new KernelFault('not-ready');
    await this.judge.credential(input);
    return this.view();
  }
  async deliveries(after?: string, limit?: number): Promise<QQDeliveryPage> {
    return this.runtime.state('deliveries', {
      scope: { kind: 'management' },
      ...(after !== undefined ? { after } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }
  async delivery(id: string): Promise<QQDeliveryView> {
    return this.runtime.state('getDelivery', { id, scope: { kind: 'management' } });
  }
  async principals(after?: string, limit = 32): Promise<QQPrincipalPage> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 32 ||
      (after !== undefined && !isCompanionRecordId(after))
    )
      throw new KernelFault('invalid-input');
    const policy = this.savedPolicy().settings;
    const actors = [
      ...policy.privateAllowlist,
      ...policy.principalAliases.map((entry) => entry.actor),
    ];
    const ids = new Set(
      actors
        .map((actor) => resolveQQParticipant(policy, actor)?.principalId)
        .filter((value): value is string => value !== undefined),
    );
    const sorted = [...ids].sort().filter((id) => after === undefined || id > after);
    const page = sorted.slice(0, limit).map((id) => ({
      id,
      kind: id === 'owner' ? ('owner' as const) : ('person' as const),
      displayName: id,
    }));
    return { principals: page, next: sorted.length > limit ? (page.at(-1)?.id ?? null) : null };
  }
  private featureReady(): boolean {
    const policy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    return Boolean(
      this.policyBound &&
      !this.closed &&
      !this.policyInvalid &&
      this.host.isEnabled(QQ_FEATURE_PLUGIN_ID) &&
      this.host.verifySource(QQ_FEATURE_PLUGIN_ID) &&
      policy &&
      !policy.blocked &&
      policy.preset !== 'deny',
    );
  }
  private async sourceViews(): Promise<QQSourceView[]> {
    const desired = await this.desired();
    return Promise.all(
      (['official', 'onebot-v11'] as const).map(async (protocol): Promise<QQSourceView> => {
        const current = await this.configured(protocol);
        const slot = this.slot(current.settings, current.revision);
        const record = this.records.get(protocol);
        const enabled = desired.has(pluginId(protocol));
        const featureReady = this.featureReady();
        const featurePolicy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
        const active = this.host.isEnabled(pluginId(protocol));
        const policy = this.host.permissionControl.inspect(identity(pluginId(protocol)));
        const applied =
          record &&
          active &&
          record.running &&
          !record.signal.aborted &&
          record.revision === current.revision &&
          record.credentialVersion === slot.version &&
          policy &&
          !policy.blocked &&
          policy.preset !== 'deny' &&
          policy.epoch === record.policyEpoch
            ? record
            : undefined;
        const phase = !enabled
          ? 'disabled'
          : !featureReady
            ? 'failed'
            : !accountOf(current.settings) || !slot.value
              ? 'unconfigured'
              : !applied
                ? 'failed'
                : applied?.status?.phase === 'waiting' ||
                    applied?.status?.phase === 'idle' ||
                    !applied?.status
                  ? 'connecting'
                  : applied.status.phase === 'stopped'
                    ? 'offline'
                    : applied.status.phase;
        return {
          protocol,
          sourcePluginId: pluginId(protocol),
          instanceId: 'default',
          desiredEnabled: enabled,
          source: !enabled ? 'disabled' : featureReady && applied ? 'ready' : 'unavailable',
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
          cleanup: record?.cleanup ?? this.cleanup.get(protocol) ?? 'settled',
          error:
            (enabled && !featureReady
              ? makeError(
                  featurePolicy?.blocked || featurePolicy?.preset === 'deny'
                    ? 'permission-denied'
                    : 'not-ready',
                )
              : null) ??
            (enabled &&
            policy &&
            (policy.blocked ||
              policy.preset === 'deny' ||
              (record && policy.epoch !== record.policyEpoch))
              ? makeError('permission-denied')
              : null) ??
            record?.error ??
            this.failures.get(protocol) ??
            (enabled && !applied ? makeError('not-ready') : null),
        };
      }),
    );
  }
  async status(): Promise<QQStatus> {
    const featurePolicy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    if (!this.featureReady()) {
      const desired = await this.desired();
      return {
        version: 1,
        sources: (['official', 'onebot-v11'] as const).map((protocol) => {
          const enabled = desired.has(pluginId(protocol));
          const record = this.records.get(protocol);
          return {
            protocol,
            sourcePluginId: pluginId(protocol),
            desiredEnabled: enabled,
            source: enabled ? ('unavailable' as const) : ('disabled' as const),
            phase: enabled ? ('failed' as const) : ('disabled' as const),
            account: record ? accountOf(record.settings) : null,
            cleanup: record?.cleanup ?? this.cleanup.get(protocol) ?? 'settled',
            error: enabled
              ? makeError(
                  featurePolicy?.blocked || featurePolicy?.preset === 'deny'
                    ? 'permission-denied'
                    : 'not-ready',
                )
              : null,
          };
        }),
      };
    }
    const sources = await this.sourceViews();
    return {
      version: 1,
      sources: sources.map(
        ({ protocol, sourcePluginId, desiredEnabled, source, phase, account, cleanup, error }) => ({
          protocol,
          sourcePluginId,
          desiredEnabled,
          source,
          phase,
          account,
          cleanup,
          error,
        }),
      ),
    };
  }
  async view(): Promise<QQView> {
    if (!this.judge) throw new KernelFault('not-ready');
    const policy = this.savedPolicy();
    const [sources, judge] = await Promise.all([this.sourceViews(), this.judge.view()]);
    const codec = this.codec();
    const current = this.savedPolicy();
    const judgePolicy: QQJudgePolicy = {
      providerRef: judge.settings.providerRef,
      maxAttemptsPerHour: judge.settings.maxAttemptsPerHour,
      perGroupIntervalMs: judge.settings.perGroupIntervalMs,
      timeoutMs: judge.settings.timeoutMs,
      maxOutputTokens: judge.settings.maxOutputTokens,
    };
    if (
      current.revision !== policy.revision ||
      !isDeepStrictEqual(current.settings.judge, policy.settings.judge) ||
      !isDeepStrictEqual(judgePolicy, policy.settings.judge)
    )
      throw new KernelFault('conflict');
    const result: QQView = {
      version: 1,
      policy,
      sources,
      judge,
      codec,
    };
    if (!isQQView(result))
      throw new KernelFault(
        Buffer.byteLength(JSON.stringify(result)) > QQ_VIEW_MAX_BYTES
          ? 'quota-exceeded'
          : 'invalid-input',
      );
    return result;
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      this.offConfig?.();
      this.featureLease?.abort.abort();
      if (this.pendingPolicyRechecks)
        await new Promise<void>((resolve) => {
          this.resolvePolicyDrain = resolve;
        });
      await this.leaseGate;
      await this.featureLease?.done;
      this.featureLease = undefined;
      for (const record of this.records.values()) this.fence(record);
      const retired = await Promise.allSettled(
        (['official', 'onebot-v11'] as const).map((protocol) => this.retire(protocol)),
      );
      await this.judge?.close();
      for (const slot of this.slots.values()) slot.value = undefined;
      this.redactor.clear();
      const failed = retired.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (this.policyRecheckFailure) throw new KernelFault(this.policyRecheckFailure.code);
    })());
  }
}

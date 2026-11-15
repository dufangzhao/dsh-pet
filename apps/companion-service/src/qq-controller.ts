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
  isQQSourceSettingsCommand,
  makeError,
  QQ_FEATURE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type CompanionCommandReceipt,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type QQAccountRef,
  type QQDeliveryPage,
  type QQDeliveryView,
  type QQJudgePolicy,
  type QQJudgeView,
  type QQOfficialSettings,
  type QQOneBotSettings,
  type QQPolicySettings,
  type QQPrincipalPage,
  type QQProtocol,
  type QQSourceView,
  type QQStatus,
  type QQView,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type ModelConnections,
} from '@pet/companion-runtime';
import type { PluginContext } from '@pet/plugin-sdk';
import type { SharedQQPorts } from '../../../plugins/shared-qq/src/index.js';
import type { OfficialQqPorts, OfficialIo } from '../../../plugins/qq-official/src/ports.js';
import type { OfficialQqDriver } from '../../../plugins/qq-official/src/driver.js';
import type { OfficialMessageEvent } from '../../../plugins/qq-official/src/wire.js';
import type { OneBotQqPorts, OneBotIo } from '../../../plugins/qq-onebot/src/ports.js';
import type { OneBotQqDriver } from '../../../plugins/qq-onebot/src/driver.js';
import type { OneBotFrame, OneBotResponse } from '../../../plugins/qq-onebot/src/wire.js';
import {
  qqSourceId as pluginId,
  qqSourceProtocol as protocolFor,
  type OfficialIoTestHooks,
  type CapturedQqBinding,
} from '@pet/local-host/qq-native';
import { QQSourceCore, type LocalCapturedSourceBase } from '@pet/local-host/qq-source';
import { resolveQQParticipant } from './qq-policy.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' as const });
const safeError = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable');
const toJson = (value: QQPolicySettings): JsonObject =>
  structuredClone(value) as unknown as JsonObject;
const authorityFields = (policy: QQPolicySettings): unknown => [
  policy.privateAllowlist,
  policy.groupAllowlist,
  policy.principalAliases,
  policy.administratorPrincipalIds,
  policy.knownMachineActors,
];

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
  private readonly sources: QQSourceCore;
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
  ) {
    this.sources = new QQSourceCore(
      {
        host,
        checkConfigSource: (id) => {
          if (!host.verifySource(id)) throw new KernelFault('package-changed');
        },
        setEnabled: (id, enabled) => host.setEnabled(id, enabled),
        runFor: (id, work, taskOptions) => host.runFor(id, work, taskOptions),
      },
      {
        ...options,
        changed: () => runtime.notify(),
        beforeStart: () => {
          if (!this.ingress) throw new KernelFault('not-ready');
        },
        beforeEvent: async (source) => {
          await this.capture(source).check();
        },
        onOfficial: async (event, source) => {
          const captured = this.capture(source);
          await captured.check();
          if (!this.ingress) throw new KernelFault('not-ready');
          await this.ingress.official(event, captured);
          await captured.check();
        },
        onOneBot: async (event, source) => {
          const captured = this.capture(source);
          await captured.check();
          if (!this.ingress) throw new KernelFault('not-ready');
          await this.ingress.onebot(event, captured);
          await captured.check();
        },
      },
      {
        read: async () => {
          const snapshot = await this.desiredSnapshot();
          return {
            revision: snapshot.revision,
            officialEnabled: snapshot.ids.has(QQ_OFFICIAL_PLUGIN_ID),
            onebotEnabled: snapshot.ids.has(QQ_ONEBOT_PLUGIN_ID),
          };
        },
      },
      false,
    );
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
    await this.sources.initialize();
    const desired = await this.desired();
    for (const protocol of ['official', 'onebot-v11'] as const) {
      if (!desired.has(pluginId(protocol))) continue;
      try {
        if (!this.host.isEnabled(pluginId(protocol)))
          await this.host.setEnabled(pluginId(protocol), true);
        await this.start(protocol);
      } catch (error) {
        this.sources.markFailure(protocol, error);
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

  private async desiredSnapshot(): Promise<{ revision: number; ids: Set<string> }> {
    const profile = await this.runtime.profile();
    const enabled = Array.isArray(profile.data['enabledOptionalPlugins'])
      ? profile.data['enabledOptionalPlugins'].filter((id): id is string => typeof id === 'string')
      : [];
    const disabled = Array.isArray(profile.data['disabledPlugins'])
      ? profile.data['disabledPlugins'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      revision: profile.revision,
      ids: new Set(enabled.filter((id) => !disabled.includes(id))),
    };
  }
  private async desired(): Promise<Set<string>> {
    return (await this.desiredSnapshot()).ids;
  }
  async prepareSource(context: PluginContext): Promise<void> {
    await this.sources.prepareSource(context);
  }
  officialPorts(context: PluginContext): OfficialQqPorts {
    return this.sources.officialPorts(context);
  }
  onebotPorts(context: PluginContext): OneBotQqPorts {
    return this.sources.onebotPorts(context);
  }
  private capture(source: LocalCapturedSourceBase, extra?: AbortSignal): CapturedQqSourceBase {
    this.policy();
    const featureOwner = this.featureOwner;
    const featureSignal = this.featureSignal;
    const featurePolicy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    if (!featureOwner || !featureSignal || !featurePolicy) throw new KernelFault('not-ready');
    const signal = AbortSignal.any(
      extra ? [source.signal, featureSignal, extra] : [source.signal, featureSignal],
    );
    return {
      account: source.account,
      connectionId: source.connectionId,
      ...(source.selfId ? { selfId: source.selfId } : {}),
      signal,
      check: async () => {
        this.policy();
        await source.check();
        this.policy();
        const policy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
        if (
          signal.aborted ||
          this.featureOwner?.generation !== featureOwner.generation ||
          !policy ||
          policy.epoch !== featurePolicy.epoch
        )
          throw new KernelFault('stale-owner');
      },
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
    const source = this.sources.captureSource(account);
    const base = this.capture(source, participant.signal);
    return source.protocol === 'official'
      ? { ...base, protocol: 'official', driver: source.driver }
      : { ...base, protocol: 'onebot-v11', driver: source.driver };
  }
  private async start(protocol: QQProtocol): Promise<void> {
    await this.sources.startCurrent(protocol);
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
      if (enabled && this.sources.needsRetire(protocol)) await this.sources.retire(protocol);
      const previous = enabled ? undefined : this.sources.beginDisable(protocol);
      let receipt: CompanionCommandReceipt;
      try {
        receipt = await this.runtime.setPlugin(id, enabled, commandId);
      } catch (error) {
        if (previous?.hadRecord) previous.fail(error);
        throw error;
      }
      if (receipt.status === 'duplicate') return receipt;
      if (enabled) {
        try {
          await this.start(protocol);
        } catch (error) {
          this.sources.markFailure(protocol, error);
          throw error;
        }
      } else {
        await previous?.settle();
      }
      return receipt;
    });
  }
  async savePolicy(input: unknown): Promise<QQView> {
    if (!isQQPolicyCommand(input)) throw new KernelFault('invalid-input');
    return this.serialized(async () => {
      if (this.sources.containsSecret(input.settings)) throw new KernelFault('permission-denied');
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
      const result = await this.sources.saveSource(input);
      if (result.error) throw new KernelFault(result.error.code);
      return this.view();
    });
  }
  async credential(input: unknown): Promise<QQView> {
    if (!isQQCredentialCommand(input)) throw new KernelFault('invalid-input');
    return this.serialized(async () => {
      const result = await this.sources.credential(input);
      if (result.error) throw new KernelFault(result.error.code);
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
    const sources = (await this.sources.view()).sources;
    if (this.featureReady()) return [...sources];
    const policy = this.host.permissionControl.inspect(identity(QQ_FEATURE_PLUGIN_ID));
    const error = makeError(
      policy?.blocked || policy?.preset === 'deny' ? 'permission-denied' : 'not-ready',
    );
    return sources.map((source) =>
      source.desiredEnabled ? { ...source, source: 'unavailable', phase: 'failed', error } : source,
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
          const summary = this.sources.summary(protocol);
          return {
            protocol,
            sourcePluginId: pluginId(protocol),
            desiredEnabled: enabled,
            source: enabled ? ('unavailable' as const) : ('disabled' as const),
            phase: enabled ? ('failed' as const) : ('disabled' as const),
            account: summary.account,
            cleanup: summary.cleanup,
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
      const retired = await Promise.allSettled([this.sources.close()]);
      await this.judge?.close();
      const failed = retired.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (this.policyRecheckFailure) throw new KernelFault(this.policyRecheckFailure.code);
    })());
  }
}

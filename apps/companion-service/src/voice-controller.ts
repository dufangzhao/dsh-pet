import { randomUUID } from 'node:crypto';
import {
  VOICE_FEATURE_PLUGIN_ID,
  VOICE_INPUT_CAPABILITY,
  VOICE_ASR_CAPABILITY,
  type VoiceFinal,
  VOICE_VIEW_MAX_BYTES,
  VOICE_ASR_TIMEOUT_MS,
  VOICE_TICKET_TTL_MS,
  type VoiceView,
  type VoiceAsrSettings,
  type VoiceBegin,
  type VoiceTicket,
  type VoiceResultKey,
  type VoiceCaptureResult,
  type VoiceCatalog,
  type VoiceFeatureConfig,
  type VoiceSourceState,
  type JsonObject,
  type OwnerRef,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { KernelFault, SecretRedactor, type PermissionLease } from '@pet/host-kernel';
import {
  VoiceProviders,
  withSourceAuthority,
  COMPANION_HOST_ID,
  type CompanionPluginHost,
  type CompanionRuntime,
  type VoiceAsrRegistration,
  type VoiceInputNative,
  type SharedVoicePorts,
  type VoiceAsrPorts,
} from '@pet/companion-runtime';
import type { PluginContext } from '@pet/plugin-sdk';
import { createAuthorizedAsrTransport } from './voice-client.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
export function voiceObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const safe = jsonPreflight(value);
  if (
    !safe.ok ||
    !safe.value ||
    typeof safe.value !== 'object' ||
    Array.isArray(safe.value) ||
    Object.keys(safe.value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new KernelFault('invalid-input');
  return safe.value;
}
export function voiceResultKey(value: unknown): VoiceResultKey {
  const record = voiceObject(value, ['captureId', 'clientId', 'agentId', 'serviceEpoch']);
  if (!Object.values(record).every(id)) throw new KernelFault('invalid-input');
  return record as unknown as VoiceResultKey;
}
interface Slot {
  target: string;
  version: string;
  value: string | undefined;
  source: 'none' | 'memory';
}
interface Lifetime {
  key: VoiceResultKey;
  providerRef: string;
  finish: () => void;
  work: Promise<unknown>;
  timer: ReturnType<typeof setTimeout>;
}
interface Feature {
  native: VoiceInputNative;
  owner: OwnerRef;
  signal: AbortSignal;
}

export interface AsrConsumer {
  check(): Promise<void>;
  recognize(
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<VoiceFinal>;
}

/** Host management and fixed native dispatch; ConfigService remains the only CAS writer. */
export class VoiceController {
  readonly providers: VoiceProviders;
  private readonly generation = randomUUID();
  private readonly slots = new Map<string, Slot>();
  private readonly redactor = new SecretRedactor();
  private readonly lifetimes = new Map<string, Lifetime>();
  private feature: Feature | undefined;
  private management = false;
  private closed = false;
  private selected = '';
  private readonly consumerSessions = new Set<{
    providerRef: string;
    abort: AbortController;
    done: Promise<void>;
  }>();
  private readonly offCommit: () => void;
  constructor(
    readonly host: CompanionPluginHost,
    readonly runtime: CompanionRuntime,
    registrations: readonly VoiceAsrRegistration[],
  ) {
    this.providers = new VoiceProviders(
      host,
      registrations,
      (owner, baseUrl) => {
        const ref = this.providers.list().find(([, r]) => r.manifest.id === owner.pluginId)?.[0];
        const slot = ref ? this.slots.get(ref) : undefined;
        if (!ref || !slot) throw new KernelFault('not-ready');
        const [, target, authMode] = JSON.parse(slot.target) as string[];
        if (baseUrl !== target) throw new KernelFault('permission-denied');
        const prepared = this.settings.get(ref);
        if (!prepared || prepared.baseUrl !== baseUrl || prepared.authMode !== authMode)
          throw new KernelFault('conflict');
        return createAuthorizedAsrTransport(
          host,
          owner.pluginId,
          prepared,
          authMode === 'local-client-id' ? 'magpie-dsh-pet' : slot.value,
        );
      },
      (ref) => this.cancelProvider(ref),
    );
    this.offCommit = host.onConfigurationCommit((commit) => {
      if (commit.pluginId === VOICE_FEATURE_PLUGIN_ID) {
        const ref = commit.data['providerRef'];
        if (typeof ref !== 'string') return;
        if (this.selected && this.selected !== ref) this.cancelProvider(this.selected);
        this.selected = ref;
        this.providers.select(ref);
      }
      for (const [ref, registration] of this.providers.list())
        if (commit.pluginId === registration.manifest.id) {
          const slot = this.slots.get(ref);
          try {
            const settings = registration.asr.parseConfig(commit.data),
              target = JSON.stringify([ref, settings.baseUrl, settings.authMode]);
            if (slot && slot.target !== target) {
              slot.value = undefined;
              slot.source = 'none';
              slot.version = this.version();
              this.slots.delete(ref);
            }
            this.settings.set(ref, settings);
          } catch {
            if (slot) {
              slot.value = undefined;
              slot.source = 'none';
              slot.version = this.version();
            }
            this.settings.delete(ref);
          }
        }
    });
  }
  private readonly settings = new Map<string, VoiceAsrSettings>();
  private version(): string {
    return `${this.generation}:${randomUUID()}`;
  }
  private async configured(ref: string) {
    const r = this.providers.registration(ref),
      snapshot = await this.host.configs.get(identity(r.manifest.id));
    if (!snapshot.ok) throw new KernelFault(snapshot.error.code);
    const settings = r.asr.parseConfig(snapshot.value.data);
    if (this.redactor.containsValue(settings)) throw new KernelFault('permission-denied');
    const target = JSON.stringify([ref, settings.baseUrl, settings.authMode]);
    let slot = this.slots.get(ref);
    if (!slot || slot.target !== target) {
      slot = { target, version: this.version(), value: undefined, source: 'none' };
      this.slots.set(ref, slot);
    }
    this.settings.set(ref, settings);
    return { registration: r, settings, slot, revision: snapshot.value.revision };
  }
  private async featureConfig(): Promise<{ revision: number; data: VoiceFeatureConfig }> {
    const snapshot = await this.host.configs.get(identity(VOICE_FEATURE_PLUGIN_ID));
    if (!snapshot.ok) throw new KernelFault(snapshot.error.code);
    const data = snapshot.value.data;
    if (
      typeof data['providerRef'] !== 'string' ||
      !['send', 'review'].includes(String(data['finishMode']))
    )
      throw new KernelFault('invalid-input');
    this.providers.registration(data['providerRef']);
    return {
      revision: snapshot.value.revision,
      data: {
        providerRef: data['providerRef'],
        finishMode: data['finishMode'] as 'send' | 'review',
      },
    };
  }
  private source(pluginId: string): VoiceSourceState {
    const entry = this.host.manager.get(identity(pluginId));
    const policy = this.host.permissionControl.inspect(identity(pluginId));
    if (
      !entry ||
      !this.host.verifySource(pluginId) ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny'
    )
      return 'unavailable';
    return entry.state === 'active'
      ? 'ready'
      : entry.state === 'disabled'
        ? 'disabled'
        : 'unavailable';
  }
  async initialize(): Promise<void> {
    const config = await this.featureConfig();
    this.selected = config.data.providerRef;
    this.providers.select(this.selected);
    for (const [ref, r] of this.providers.list()) {
      await this.configured(ref);
      if (r.enabled) await this.providers.enable(ref);
    }
    const profile = await this.runtime.profile();
    if (
      !Array.isArray(profile.data['disabledPlugins']) ||
      !profile.data['disabledPlugins'].includes(VOICE_FEATURE_PLUGIN_ID)
    )
      await this.host.setEnabled(VOICE_FEATURE_PLUGIN_ID, true);
  }
  async providerPorts(context: PluginContext): Promise<VoiceAsrPorts> {
    const ref = this.providers
      .list()
      .find(([, r]) => r.manifest.id === context.owner.pluginId)?.[0];
    if (!ref) throw new KernelFault('not-ready');
    await this.configured(ref);
    await this.providers.prepare(context);
    return this.providers.portsFor(context);
  }
  featurePorts(context: PluginContext): SharedVoicePorts {
    if (context.owner.pluginId !== VOICE_FEATURE_PLUGIN_ID)
      throw new KernelFault('permission-denied');
    return {
      bind: (native) => {
        if (this.feature) throw new KernelFault('conflict');
        const feature = { native, owner: context.owner, signal: context.signal };
        this.feature = feature;
        const fence = () => this.cancelAll();
        context.signal.addEventListener('abort', fence, { once: true });
        return async () => {
          fence();
          if (this.feature === feature) this.feature = undefined;
          context.signal.removeEventListener('abort', fence);
          await Promise.allSettled([...this.lifetimes.values()].map((v) => v.work));
        };
      },
      currentAgent: async () => {
        const snapshot = await this.runtime.snapshot();
        return { id: snapshot.agent.id, acceptsInput: snapshot.agent.status !== 'unavailable' };
      },
      validateBegin: (input) => this.validateBegin(input),
      recognize: (ref, binding, samples, pcm, signal) =>
        this.providers.recognize(
          VOICE_FEATURE_PLUGIN_ID,
          ref,
          binding,
          samples,
          pcm,
          signal,
          VOICE_ASR_TIMEOUT_MS,
        ),
    };
  }
  private async validateBegin(input: VoiceBegin): Promise<void> {
    const view = await this.view(),
      provider = view.providers.find((p) => p.providerRef === input.providerRef);
    if (view.feature.source !== 'ready' || provider?.readiness !== 'configured')
      throw new KernelFault('not-ready');
    if (
      view.feature.providerRef !== input.providerRef ||
      view.feature.finishMode !== input.finishMode ||
      view.feature.configRevision !== input.expectedFeatureRevision ||
      provider.bindingId !== input.bindingId
    )
      throw new KernelFault('conflict');
  }
  /** Independent attachment consumer; it never creates a browser capture or changes finish mode. */
  async withAsrConsumer<T>(
    consumer: string,
    signal: AbortSignal,
    consume: (session: AsrConsumer, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new KernelFault('not-ready');
    const feature = await this.featureConfig(),
      ref = feature.data.providerRef;
    const configured = await this.configured(ref),
      binding = this.providers.binding(ref);
    if (
      !binding ||
      !configured.settings.modelRef ||
      (configured.settings.authMode === 'gateway-key' && !configured.slot.value)
    )
      throw new KernelFault('not-ready');
    const credentialVersion = configured.slot.version;
    const abort = new AbortController();
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active = { providerRef: ref, abort, done };
    this.consumerSessions.add(active);
    const check = async (): Promise<void> => {
      if (this.closed || signal.aborted || abort.signal.aborted) throw new KernelFault('cancelled');
      const selected = await this.featureConfig(),
        current = await this.configured(ref);
      if (
        selected.data.providerRef !== ref ||
        current.revision !== configured.revision ||
        current.slot.version !== credentialVersion ||
        this.providers.binding(ref)?.bindingId !== binding.bindingId
      )
        throw new KernelFault('conflict');
    };
    try {
      return await withSourceAuthority(
        this.host,
        consumer,
        [{ kind: 'capability-use', capability: VOICE_ASR_CAPABILITY }],
        (consumerSignal) =>
          withSourceAuthority(
            this.host,
            configured.registration.manifest.id,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (sourceSignal) => {
              const combined = AbortSignal.any([sourceSignal, abort.signal, signal]);
              const session: AsrConsumer = {
                check: async () => {
                  combined.throwIfAborted();
                  await check();
                },
                recognize: async (samples, pcm, operationSignal) => {
                  combined.throwIfAborted();
                  await check();
                  const nativeSignal = operationSignal
                    ? AbortSignal.any([combined, operationSignal])
                    : combined;
                  const result = await this.providers.recognize(
                    consumer,
                    ref,
                    binding.bindingId,
                    samples,
                    pcm,
                    nativeSignal,
                    VOICE_ASR_TIMEOUT_MS,
                  );
                  combined.throwIfAborted();
                  await check();
                  return result;
                },
              };
              await session.check();
              const value = await consume(session, combined);
              await session.check();
              return value;
            },
            { signal: consumerSignal },
          ),
        { signal: AbortSignal.any([signal, abort.signal]) },
      );
    } finally {
      this.consumerSessions.delete(active);
      finish();
    }
  }
  private cancelProvider(ref: string): void {
    for (const session of this.consumerSessions)
      if (session.providerRef === ref) session.abort.abort();
    for (const lifetime of this.lifetimes.values())
      if (lifetime.providerRef === ref)
        void this.feature?.native
          .cancel(lifetime.key)
          .then(() => lifetime.finish())
          .catch(() => lifetime.finish());
  }
  private cancelAll(): void {
    for (const lifetime of this.lifetimes.values())
      void this.feature?.native
        .cancel(lifetime.key)
        .then(() => lifetime.finish())
        .catch(() => lifetime.finish());
  }
  private complete(result: VoiceCaptureResult): VoiceCaptureResult {
    if (result.cleanup === 'settled') {
      this.lifetimes.get(result.ticket.captureId)?.finish();
    }
    return result;
  }
  private async dispatch<T>(
    operation: (feature: VoiceInputNative, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const captured = this.feature;
    if (this.closed || !captured || captured.signal.aborted) throw new KernelFault('not-ready');
    return withSourceAuthority(
      this.host,
      COMPANION_HOST_ID,
      [{ kind: 'capability-use', capability: VOICE_INPUT_CAPABILITY }],
      (consumerSignal) =>
        withSourceAuthority(
          this.host,
          VOICE_FEATURE_PLUGIN_ID,
          [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          async (sourceSignal) => {
            if (this.feature !== captured || captured.signal.aborted)
              throw new KernelFault('stale-owner');
            return operation(captured.native, sourceSignal);
          },
          { signal: consumerSignal, timeoutMs: 60000 },
        ),
      { ...(signal ? { signal } : {}), timeoutMs: 60000 },
    );
  }
  async begin(value: unknown): Promise<VoiceTicket> {
    const record = voiceObject(value, [
      'captureId',
      'clientId',
      'agentId',
      'expectedFeatureRevision',
      'providerRef',
      'bindingId',
      'finishMode',
    ]);
    if (
      !['captureId', 'clientId', 'agentId', 'bindingId'].every((key) => id(record[key])) ||
      !revision(record['expectedFeatureRevision']) ||
      typeof record['providerRef'] !== 'string' ||
      !['send', 'review'].includes(String(record['finishMode']))
    )
      throw new KernelFault('invalid-input');
    const input = record as unknown as VoiceBegin;
    return this.dispatch(async (native) => {
      const ticket = await native.begin(input);
      if (
        !this.lifetimes.has(ticket.captureId) &&
        (await native.result(ticket)).cleanup !== 'settled'
      ) {
        let finish = () => {};
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const handle = this.host.runFor(
          VOICE_FEATURE_PLUGIN_ID,
          async (context) => {
            const leases: PermissionLease[] = [];
            const cancel = () => {
              void native.cancel(ticket).then(finish, finish);
            };
            let signal = context.signal;
            try {
              for (const permission of [
                { kind: 'files', scope: 'plugin-data', access: 'read' },
                { kind: 'capability-use', capability: 'companion.voice.asr@1' },
              ] as const) {
                const grant = await this.host.permissions.authorize(
                  context.owner,
                  context.taskId,
                  permission,
                  context.signal,
                );
                if (!grant.ok) throw new KernelFault(grant.error.code);
                leases.push(grant.value);
              }
              signal = AbortSignal.any([context.signal, ...leases.map((lease) => lease.signal)]);
              signal.addEventListener('abort', cancel, { once: true });
              if (signal.aborted) cancel();
              await done;
            } catch {
              await native.cancel(ticket);
              finish();
            } finally {
              signal.removeEventListener('abort', cancel);
              for (const lease of leases) lease.close();
            }
            return null;
          },
          { timeoutMs: VOICE_TICKET_TTL_MS + 60000 },
        );
        const timer = setTimeout(
          () => {
            void native.cancel(ticket).then(finish, finish);
          },
          Math.max(0, ticket.expiresAt - Date.now()),
        );
        timer.unref();
        const work = handle.settled.finally(() => {
          clearTimeout(timer);
          this.lifetimes.delete(ticket.captureId);
        });
        this.lifetimes.set(ticket.captureId, {
          key: ticket,
          providerRef: input.providerRef,
          finish,
          work,
          timer,
        });
      }
      return ticket;
    });
  }
  result(key: VoiceResultKey): Promise<VoiceCaptureResult> {
    return this.dispatch(async (native) => this.complete(await native.result(key)));
  }
  upload(
    key: VoiceResultKey,
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<VoiceCaptureResult> {
    return this.dispatch(async (native, sourceSignal) => {
      await native.result(key);
      const lifetime = this.lifetimes.get(key.captureId);
      if (lifetime) clearTimeout(lifetime.timer);
      return this.complete(await native.upload(key, samples, pcm, sourceSignal));
    }, signal);
  }
  cancel(key: VoiceResultKey): Promise<VoiceCaptureResult> {
    return this.dispatch(async (native) => this.complete(await native.cancel(key)));
  }
  async catalog(ref: string, bindingId: string, signal: AbortSignal): Promise<VoiceCatalog> {
    const view = await this.view();
    if (view.feature.source !== 'ready' || view.feature.providerRef !== ref)
      throw new KernelFault('not-ready');
    return this.providers.catalog(VOICE_FEATURE_PLUGIN_ID, ref, bindingId, signal);
  }
  async view(): Promise<VoiceView> {
    const config = await this.featureConfig(),
      featureSource = this.source(VOICE_FEATURE_PLUGIN_ID);
    const providers: VoiceView['providers'][number][] = [];
    for (const [ref, r] of this.providers.list()) {
      const current = await this.configured(ref),
        source = this.source(r.manifest.id),
        binding = this.providers.binding(ref);
      const available = current.settings.authMode === 'local-client-id' || !!current.slot.value;
      const pending = this.host.manager.get(identity(r.manifest.id))?.state === 'pending_restart';
      const reason =
        featureSource !== 'ready'
          ? 'feature-disabled'
          : source === 'disabled'
            ? 'provider-disabled'
            : pending
              ? 'cleanup-pending'
              : source !== 'ready' || !binding
                ? 'source-unavailable'
                : !available
                  ? 'key-required'
                  : !current.settings.modelRef
                    ? 'model-unconfigured'
                    : null;
      providers.push({
        providerRef: ref,
        label: r.asr.label,
        synthetic: r.asr.synthetic,
        source,
        settings: current.settings,
        configRevision: current.revision,
        bindingId: featureSource === 'ready' ? (binding?.bindingId ?? null) : null,
        credential: {
          available,
          writable: current.settings.authMode === 'gateway-key',
          source:
            current.settings.authMode === 'local-client-id'
              ? 'local-client-id'
              : current.slot.source,
          version: current.slot.version,
        },
        readiness:
          reason === null
            ? 'configured'
            : reason === 'key-required' || reason === 'model-unconfigured'
              ? 'unconfigured'
              : 'unavailable',
        reason,
      });
    }
    const view: VoiceView = {
      version: 1,
      feature: { ...config.data, source: featureSource, configRevision: config.revision },
      providers,
    };
    if (Buffer.byteLength(JSON.stringify({ ok: true, value: view })) > VOICE_VIEW_MAX_BYTES)
      throw new KernelFault('quota-exceeded');
    return view;
  }
  private async manage<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.management) throw new KernelFault('conflict');
    this.management = true;
    try {
      return await operation();
    } finally {
      this.management = false;
    }
  }
  async saveSettings(value: unknown): Promise<VoiceView> {
    const record = voiceObject(value, ['expectedRevision', 'providerRef', 'finishMode']);
    if (
      !revision(record['expectedRevision']) ||
      typeof record['providerRef'] !== 'string' ||
      !['send', 'review'].includes(String(record['finishMode']))
    )
      throw new KernelFault('invalid-input');
    this.providers.registration(record['providerRef']);
    return this.manage(async () => {
      const current = await this.featureConfig();
      const saved = await this.host.configs.save(
        identity(VOICE_FEATURE_PLUGIN_ID),
        { providerRef: record['providerRef'], finishMode: record['finishMode'] } as JsonObject,
        record['expectedRevision'] as number,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      if (current.data.providerRef !== record['providerRef']) {
        this.cancelProvider(current.data.providerRef);
        this.providers.select(record['providerRef'] as string);
      }
      this.selected = record['providerRef'] as string;
      return this.view();
    });
  }
  async saveProvider(value: unknown): Promise<VoiceView> {
    const record = voiceObject(value, ['providerRef', 'expectedRevision', 'settings']);
    if (typeof record['providerRef'] !== 'string' || !revision(record['expectedRevision']))
      throw new KernelFault('invalid-input');
    const ref = record['providerRef'],
      registration = this.providers.registration(ref),
      settings = registration.asr.parseConfig(record['settings']);
    if (this.redactor.containsValue(settings)) throw new KernelFault('permission-denied');
    return this.manage(async () => {
      const desired =
        this.host.manager.get(identity(registration.manifest.id))?.desiredActive === true;
      const saved = await this.host.configs.save(
        identity(registration.manifest.id),
        { ...settings },
        record['expectedRevision'] as number,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      // Successful CAS fences synchronously through VoiceProviders before any fallible cleanup.
      await this.configured(ref);
      await this.providers.disable(ref);
      if (desired) await this.providers.enable(ref);
      return this.view();
    });
  }
  async credential(value: unknown): Promise<VoiceView> {
    const record = voiceObject(value, [
      'providerRef',
      'expectedRevision',
      'expectedCredentialVersion',
      'value',
    ]);
    if (
      typeof record['providerRef'] !== 'string' ||
      !revision(record['expectedRevision']) ||
      typeof record['expectedCredentialVersion'] !== 'string'
    )
      throw new KernelFault('invalid-input');
    const secret = record['value'];
    if (
      secret !== null &&
      (typeof secret !== 'string' ||
        !secret ||
        Buffer.byteLength(secret) > 4096 ||
        [...secret].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        Buffer.from(secret).toString('utf8') !== secret)
    )
      throw new KernelFault('invalid-input');
    return this.manage(async () => {
      const ref = record['providerRef'] as string,
        current = await this.configured(ref);
      if (
        current.revision !== record['expectedRevision'] ||
        current.slot.version !== record['expectedCredentialVersion']
      )
        throw new KernelFault('conflict');
      if (current.settings.authMode !== 'gateway-key') throw new KernelFault('permission-denied');
      const desired =
        this.host.manager.get(identity(current.registration.manifest.id))?.desiredActive === true;
      this.providers.invalidate(ref);
      current.slot.value = (secret as string | null) ?? undefined;
      current.slot.source = secret === null ? 'none' : 'memory';
      current.slot.version = this.version();
      if (typeof secret === 'string') this.redactor.add(secret);
      await this.providers.disable(ref);
      if (desired) await this.providers.enable(ref);
      return this.view();
    });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.offCommit();
    for (const session of this.consumerSessions) session.abort.abort();
    await Promise.allSettled([...this.consumerSessions].map((session) => session.done));
    this.cancelAll();
    await Promise.allSettled([...this.lifetimes.values()].map((v) => v.work));
    try {
      if (this.host.isEnabled(VOICE_FEATURE_PLUGIN_ID))
        await this.host.setEnabled(VOICE_FEATURE_PLUGIN_ID, false);
      for (const [ref] of this.providers.list()) await this.providers.disable(ref);
    } finally {
      try {
        await this.providers.close();
      } finally {
        for (const slot of this.slots.values()) slot.value = undefined;
        this.redactor.clear();
      }
    }
  }
}

import { createHash, randomUUID } from 'node:crypto';
import {
  SPEECH_CONTROL_CAPABILITY,
  SPEECH_OUTPUT_STREAM_CAPABILITY,
  SPEECH_SERVICE_PLUGIN_ID,
  SPEECH_STATUS_TIMEOUT_MS,
  SPEECH_SEGMENT_TIMEOUT_MS,
  SPEECH_VIEW_MAX_BYTES,
  COMPANION_MAX_TEXT,
  isCompanionConversationAudience,
  isCompanionMessageContent,
  type CompanionMessage,
  isSpeechBegin,
  isSpeechCredentialCommand,
  isSpeechProviderCommand,
  isSpeechSegmentKey,
  isSpeechUtteranceKey,
  type SpeechBegin,
  type SpeechCatalog,
  type SpeechFeatureConfig,
  type SpeechSegmentKey,
  type SpeechTtsSettings,
  type SpeechUtteranceKey,
  type SpeechUtteranceReceipt,
  type SpeechUtteranceStatus,
  type SpeechView,
  type SpeechSourceState,
  type OwnerRef,
} from '@pet/contracts';
import {
  KernelFault,
  SecretRedactor,
  type PermissionLease,
  type TaskHandle,
} from '@pet/host-kernel';
import {
  COMPANION_HOST_ID,
  SpeechProviders,
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type SharedSpeechPorts,
  type SpeechAudioConsumer,
  type SpeechOutputNative,
  type SpeechTtsPorts,
  type SpeechTtsRegistration,
} from '@pet/companion-runtime';
import type { PluginContext } from '@pet/plugin-sdk';
import { createAuthorizedSpeechTransport } from './speech-client.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const keyOf = (v: SpeechUtteranceKey): SpeechUtteranceKey => ({
  utteranceId: v.utteranceId,
  clientId: v.clientId,
  agentId: v.agentId,
  serviceEpoch: v.serviceEpoch,
});
/** Host-only material reader, installed by service composition; never exposed through HTTP/SDK JSON. */
export type PetCanonicalTextResolver = (
  message: CompanionMessage,
  signal: AbortSignal,
) => Promise<string>;
export interface TtsConsumer {
  check(): Promise<void>;
  consume(
    key: SpeechSegmentKey,
    text: string,
    receive: (pcm: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<void>,
  ): Promise<void>;
}
interface Slot {
  target: string;
  version: string;
  value: string | undefined;
  source: 'none' | 'memory';
}
interface Feature {
  native: SpeechOutputNative;
  owner: OwnerRef;
  signal: AbortSignal;
}
interface Lifetime {
  key: SpeechUtteranceKey;
  providerRef: string;
  feature: Feature;
  started: boolean;
  utteranceBindingId: string | undefined;
  finish: () => void;
  handle: TaskHandle;
  ready: Promise<void>;
}

/** Fixed service source/config/native owner. Playback is exclusively a separate desktop concern. */
export class SpeechController {
  readonly providers: SpeechProviders;
  private readonly generation = randomUUID();
  private readonly slots = new Map<string, Slot>();
  private readonly settings = new Map<string, SpeechTtsSettings>();
  private readonly redactor = new SecretRedactor();
  private readonly lifetimes = new Map<string, Lifetime>();
  private feature: Feature | undefined;
  private selected = '';
  private readonly consumerSessions = new Set<{
    providerRef: string;
    abort: AbortController;
    done: Promise<void>;
  }>();
  private management = false;
  private closed = false;
  private canonicalTextResolver: PetCanonicalTextResolver | undefined;
  setCanonicalTextResolver(resolver: PetCanonicalTextResolver | undefined): void {
    this.canonicalTextResolver = resolver;
  }
  private readonly offCommit: () => void;
  constructor(
    readonly host: CompanionPluginHost,
    readonly runtime: CompanionRuntime,
    registrations: readonly SpeechTtsRegistration[],
  ) {
    this.providers = new SpeechProviders(
      host,
      registrations,
      (owner, baseUrl) => {
        const ref = this.providers.list().find(([, r]) => r.manifest.id === owner.pluginId)?.[0];
        const slot = ref ? this.slots.get(ref) : undefined;
        const settings = ref ? this.settings.get(ref) : undefined;
        if (
          !ref ||
          !slot ||
          !settings ||
          settings.baseUrl !== baseUrl ||
          slot.target !== JSON.stringify([ref, settings.baseUrl, settings.authMode])
        )
          throw new KernelFault('not-ready');
        return createAuthorizedSpeechTransport(
          host,
          owner.pluginId,
          settings,
          settings.authMode === 'local-client-id' ? 'magpie-dsh-pet' : slot.value,
        );
      },
      (ref) => this.cancelProvider(ref),
    );
    this.offCommit = host.onConfigurationCommit((commit) => {
      if (commit.pluginId === SPEECH_SERVICE_PLUGIN_ID) {
        const ref = commit.data['providerRef'];
        if (typeof ref === 'string') {
          if (this.selected) this.cancelProvider(this.selected);
          this.selected = ref;
          this.providers.select(ref);
        }
      }
      for (const [ref, r] of this.providers.list())
        if (r.manifest.id === commit.pluginId) {
          const slot = this.slots.get(ref);
          try {
            const settings = r.tts.parseConfig(commit.data);
            const target = JSON.stringify([ref, settings.baseUrl, settings.authMode]);
            if (slot && slot.target !== target) {
              slot.value = undefined;
              this.slots.delete(ref);
            }
            this.settings.set(ref, settings);
          } catch {
            if (slot) slot.value = undefined;
            this.slots.delete(ref);
            this.settings.delete(ref);
          }
        }
    });
  }
  private version(): string {
    return `${this.generation}:${randomUUID()}`;
  }
  private async configured(ref: string) {
    const registration = this.providers.registration(ref);
    const saved = await this.host.configs.get(identity(registration.manifest.id));
    if (!saved.ok) throw new KernelFault(saved.error.code);
    const settings = registration.tts.parseConfig(saved.value.data);
    if (this.redactor.containsValue(settings)) throw new KernelFault('permission-denied');
    const target = JSON.stringify([ref, settings.baseUrl, settings.authMode]);
    let slot = this.slots.get(ref);
    if (!slot || slot.target !== target) {
      slot = { target, version: this.version(), value: undefined, source: 'none' };
      this.slots.set(ref, slot);
    }
    this.settings.set(ref, settings);
    return { registration, settings, slot, revision: saved.value.revision };
  }
  private async featureConfig(): Promise<{ revision: number; data: SpeechFeatureConfig }> {
    const saved = await this.host.configs.get(identity(SPEECH_SERVICE_PLUGIN_ID));
    if (!saved.ok) throw new KernelFault(saved.error.code);
    const ref = saved.value.data['providerRef'];
    if (typeof ref !== 'string') throw new KernelFault('invalid-input');
    this.providers.registration(ref);
    return { revision: saved.value.revision, data: { providerRef: ref } };
  }
  private source(id: string): SpeechSourceState {
    const entry = this.host.manager.get(identity(id));
    const policy = this.host.permissionControl.inspect(identity(id));
    if (
      !entry ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      !this.host.verifySource(id)
    )
      return 'unavailable';
    return entry.state === 'active'
      ? 'ready'
      : entry.state === 'disabled'
        ? 'disabled'
        : 'unavailable';
  }
  /** Consumer generation scopes a public selector without restarting the independent provider. */
  private publicBinding(nativeId: string, feature = this.feature): string | null {
    return feature && !feature.signal.aborted && this.host.manager.isActive(feature.owner)
      ? `${nativeId}.${feature.owner.generation}`
      : null;
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
      !profile.data['disabledPlugins'].includes(SPEECH_SERVICE_PLUGIN_ID)
    )
      await this.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, true);
  }
  async providerPorts(context: PluginContext): Promise<SpeechTtsPorts> {
    const ref = this.providers
      .list()
      .find(([, r]) => r.manifest.id === context.owner.pluginId)?.[0];
    if (!ref) throw new KernelFault('not-ready');
    await this.configured(ref);
    await this.providers.prepare(context);
    return this.providers.portsFor(context);
  }
  featurePorts(context: PluginContext): SharedSpeechPorts {
    if (context.owner.pluginId !== SPEECH_SERVICE_PLUGIN_ID)
      throw new KernelFault('permission-denied');
    const valid = (): void => {
      if (
        context.signal.aborted ||
        this.feature?.owner !== context.owner ||
        !this.host.manager.isActive(context.owner)
      )
        throw new KernelFault('stale-owner');
    };
    return {
      bind: (native) => {
        if (this.feature) throw new KernelFault('conflict');
        const feature: Feature = { native, owner: context.owner, signal: context.signal };
        this.feature = feature;
        const abort = (): void => this.cancelAll();
        context.signal.addEventListener('abort', abort, { once: true });
        return async () => {
          abort();
          await native.close();
          await Promise.all(
            [...this.lifetimes.values()]
              .filter((l) => l.feature === feature)
              .map((l) => l.handle.settled),
          );
          context.signal.removeEventListener('abort', abort);
          if (this.feature === feature) this.feature = undefined;
        };
      },
      settled: (receipt) => {
        const lifetime = this.lifetimes.get(receipt.utteranceId);
        if (
          lifetime &&
          lifetime.feature === this.feature &&
          lifetime.feature.owner === context.owner &&
          lifetime.utteranceBindingId === receipt.utteranceBindingId &&
          JSON.stringify(lifetime.key) === JSON.stringify(keyOf(receipt))
        )
          lifetime.finish();
      },
      canonicalMessage: async (input) => {
        valid();
        const message = await this.runtime.state('getMessage', input, context.signal);
        valid();
        if (message.role !== 'assistant') throw new KernelFault('invalid-input');
        if (
          !isCompanionConversationAudience(message.audience) ||
          message.audience.kind !== 'owner-private'
        )
          throw new KernelFault('permission-denied');
        let text = message.text;
        if (message.content !== undefined) {
          if (!isCompanionMessageContent(message.content)) throw new KernelFault('invalid-input');
          if (message.content.kind === 'text-document') {
            const material = message.content.material;
            if (
              !isCompanionConversationAudience(material.audience) ||
              material.audience.kind !== 'owner-private'
            )
              throw new KernelFault('permission-denied');
            const resolve = this.canonicalTextResolver;
            if (!resolve) throw new KernelFault('not-ready');
            text = await resolve(message, context.signal);
            valid();
            if (typeof text !== 'string' || !text.length || text.length > COMPANION_MAX_TEXT)
              throw new KernelFault('invalid-input');
            const bytes = Buffer.from(text, 'utf8');
            if (
              bytes.toString('utf8') !== text ||
              bytes.byteLength !== material.sizeBytes ||
              createHash('sha256').update(bytes).digest('hex') !== material.sha256
            )
              throw new KernelFault('invalid-input');
          }
        }
        if (this.redactor.containsValue({ ...message, text }))
          throw new KernelFault('permission-denied');
        return { ...message, text, role: 'assistant' };
      },
      captureBinding: async (input) => {
        valid();
        const view = await this.view();
        const provider = view.providers.find((p) => p.providerRef === input.providerRef);
        const snapshot = await this.runtime.snapshot();
        valid();
        if (snapshot.agent.id !== input.agentId || snapshot.epoch !== input.serviceEpoch)
          throw new KernelFault('conflict');
        if (view.feature.source !== 'ready' || provider?.readiness !== 'configured')
          throw new KernelFault('not-ready');
        if (
          view.feature.configRevision !== input.expectedFeatureRevision ||
          view.feature.providerRef !== input.providerRef ||
          provider.bindingId !== input.bindingId
        )
          throw new KernelFault('conflict');
        const native = this.providers.binding(input.providerRef);
        if (!native || this.publicBinding(native.bindingId) !== input.bindingId)
          throw new KernelFault('conflict');
        const captured = await this.providers.capture(
          input.providerRef,
          native.bindingId,
          provider.credential.version,
        );
        valid();
        return { ...captured, bindingId: input.bindingId };
      },
      synthesize: async (input, signal) => {
        valid();
        const b = input.binding;
        const native = this.providers.binding(b.providerRef);
        const config = await this.configured(b.providerRef);
        valid();
        if (
          !native ||
          this.publicBinding(native.bindingId) !== b.bindingId ||
          config.slot.version !== b.credentialVersion ||
          config.revision !== b.configRevision
        )
          throw new KernelFault('conflict');
        const snapshot = await this.runtime.snapshot();
        if (snapshot.agent.id !== input.key.agentId || snapshot.epoch !== input.key.serviceEpoch)
          throw new KernelFault('conflict');
        valid();
        const operation = await this.providers.synthesize(
          SPEECH_SERVICE_PLUGIN_ID,
          { ...input, binding: { ...b, bindingId: native.bindingId } },
          signal,
        );
        return {
          ...operation,
          start: { ...operation.start, bindingId: b.bindingId },
          get producedFrames() {
            return operation.producedFrames;
          },
        };
      },
    };
  }
  private cancelLifetime(l: Lifetime): void {
    if (!l.started) {
      l.finish();
      return;
    }
    void l.feature.native.cancel(l.key).then(l.finish, l.finish);
  }
  /** Independent export authority; no Pet readiness, playback preference or public utterance is fabricated. */
  async withTtsConsumer<T>(
    consumer: string,
    signal: AbortSignal,
    consume: (session: TtsConsumer, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new KernelFault('not-ready');
    const feature = await this.featureConfig(),
      ref = feature.data.providerRef;
    const configured = await this.configured(ref),
      native = this.providers.binding(ref);
    if (
      !native ||
      !configured.settings.modelRef ||
      (configured.settings.authMode === 'gateway-key' && !configured.slot.value)
    )
      throw new KernelFault('not-ready');
    const binding = await this.providers.capture(ref, native.bindingId, configured.slot.version);
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
        current.revision !== binding.configRevision ||
        current.slot.version !== binding.credentialVersion ||
        this.providers.binding(ref)?.bindingId !== binding.bindingId
      )
        throw new KernelFault('conflict');
    };
    try {
      return await withSourceAuthority(
        this.host,
        consumer,
        [{ kind: 'capability-use', capability: SPEECH_OUTPUT_STREAM_CAPABILITY }],
        (consumerSignal) =>
          withSourceAuthority(
            this.host,
            binding.sourcePluginId,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (sourceSignal) => {
              const combined = AbortSignal.any([sourceSignal, signal, abort.signal]);
              const session: TtsConsumer = {
                check: async () => {
                  combined.throwIfAborted();
                  await check();
                },
                consume: async (key, text, receive) => {
                  combined.throwIfAborted();
                  await check();
                  if (this.redactor.containsValue(text)) throw new KernelFault('permission-denied');
                  const operation = await this.providers.synthesize(
                    consumer,
                    { key, binding, text },
                    combined,
                  );
                  let drained = 0,
                    ended = false,
                    failure: unknown;
                  const pcm: AsyncIterable<Uint8Array> = {
                    async *[Symbol.asyncIterator]() {
                      for await (const bytes of operation.audio) {
                        combined.throwIfAborted();
                        drained += bytes.byteLength;
                        yield bytes;
                      }
                      ended = true;
                    },
                  };
                  try {
                    await receive(pcm, combined);
                    if (!ended) throw new KernelFault('invalid-input');
                    const result = await operation.result;
                    if (
                      result.finishReason !== 'stop' ||
                      result.producedBytes !== drained ||
                      result.producedFrames !== operation.producedFrames
                    )
                      throw new KernelFault('audio-format');
                    await check();
                  } catch (error) {
                    failure = error;
                  } finally {
                    if (failure) {
                      operation.cancel();
                      operation.audio.cancel();
                    }
                    try {
                      await operation.result;
                    } catch (error) {
                      if (
                        !(failure instanceof KernelFault) ||
                        ![
                          'quota-exceeded',
                          'permission-denied',
                          'invalid-input',
                          'conflict',
                          'stale-owner',
                        ].includes(failure.error.code)
                      )
                        failure = error;
                    }
                    try {
                      await operation.settled;
                    } catch (error) {
                      failure = error;
                    }
                  }
                  if (failure) throw failure;
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
    for (const l of this.lifetimes.values()) if (l.providerRef === ref) this.cancelLifetime(l);
  }
  private cancelAll(): void {
    for (const l of this.lifetimes.values()) this.cancelLifetime(l);
  }
  private async dispatch<T>(
    operation: (feature: Feature, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = SPEECH_STATUS_TIMEOUT_MS,
  ): Promise<T> {
    const captured = this.feature;
    if (this.closed || !captured || captured.signal.aborted) throw new KernelFault('not-ready');
    return withSourceAuthority(
      this.host,
      COMPANION_HOST_ID,
      [{ kind: 'capability-use', capability: SPEECH_CONTROL_CAPABILITY }],
      (consumer) =>
        withSourceAuthority(
          this.host,
          SPEECH_SERVICE_PLUGIN_ID,
          [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          async (source) => {
            if (this.feature !== captured || captured.signal.aborted)
              throw new KernelFault('stale-owner');
            return operation(captured, source);
          },
          { signal: consumer, timeoutMs },
        ),
      { ...(signal ? { signal } : {}), timeoutMs },
    );
  }
  private lifetime(input: SpeechBegin, feature: Feature): Lifetime {
    const existing = this.lifetimes.get(input.utteranceId);
    if (existing) {
      if (
        existing.feature !== feature ||
        existing.providerRef !== input.providerRef ||
        JSON.stringify(existing.key) !== JSON.stringify(keyOf(input))
      )
        throw new KernelFault('conflict');
      return existing;
    }
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let readyResolve = () => {};
    let readyReject: (error: unknown) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const handle = this.host.runFor(SPEECH_SERVICE_PLUGIN_ID, async (context) => {
      const leases: PermissionLease[] = [];
      let abortSignal = context.signal;
      const cancel = (): void => {
        const active = this.lifetimes.get(input.utteranceId);
        if (active) this.cancelLifetime(active);
        else finish();
      };
      try {
        for (const declaration of [
          { kind: 'files', scope: 'plugin-data', access: 'read' },
          { kind: 'capability-use', capability: SPEECH_OUTPUT_STREAM_CAPABILITY },
        ] as const) {
          const lease = await this.host.permissions.authorize(
            context.owner,
            context.taskId,
            declaration,
            context.signal,
          );
          if (!lease.ok) throw new KernelFault(lease.error.code);
          leases.push(lease.value);
        }
        abortSignal = AbortSignal.any([context.signal, ...leases.map((l) => l.signal)]);
        abortSignal.addEventListener('abort', cancel, { once: true });
        if (abortSignal.aborted) throw new KernelFault('cancelled');
        readyResolve();
        await done;
      } catch (error) {
        readyReject(error);
        cancel();
        await done;
      } finally {
        abortSignal.removeEventListener('abort', cancel);
        for (const lease of leases) lease.close();
      }
      return null;
    });
    const l: Lifetime = {
      key: keyOf(input),
      providerRef: input.providerRef,
      feature,
      started: false,
      utteranceBindingId: undefined,
      finish,
      handle,
      ready,
    };
    this.lifetimes.set(input.utteranceId, l);
    void handle.result.then((result) => {
      if (!result.ok) readyReject(new KernelFault(result.error.code));
    });
    void handle.settled.then(() => {
      if (this.lifetimes.get(input.utteranceId) === l) this.lifetimes.delete(input.utteranceId);
    });
    return l;
  }
  async begin(value: unknown): Promise<SpeechUtteranceReceipt> {
    if (!isSpeechBegin(value)) throw new KernelFault('invalid-input');
    return this.dispatch(async (feature) => {
      const fresh = !this.lifetimes.has(value.utteranceId);
      const lifetime = this.lifetime(value, feature);
      try {
        await lifetime.ready;
        if (feature.signal.aborted || this.feature !== feature)
          throw new KernelFault('stale-owner');
        lifetime.started = true;
        const receipt = await feature.native.begin(value);
        lifetime.utteranceBindingId = receipt.utteranceBindingId;
        await this.releaseIfTerminal(feature, value);
        return receipt;
      } catch (error) {
        if (fresh) {
          if (!lifetime.started) lifetime.finish();
          else {
            try {
              await feature.native.cancel(keyOf(value));
            } finally {
              lifetime.finish();
            }
          }
        }
        throw error;
      }
    });
  }
  reserve(value: unknown) {
    if (!isSpeechSegmentKey(value)) throw new KernelFault('invalid-input');
    return this.dispatch((feature) => feature.native.reserve(value));
  }
  status(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus> {
    if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
    return this.dispatch(async (feature) => {
      const lifetime = this.lifetimes.get(key.utteranceId);
      const view = await feature.native.status(key);
      if (view.phase === 'terminal' && view.cleanup !== 'pending' && lifetime?.feature === feature)
        lifetime.finish();
      return view;
    });
  }
  cancel(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus> {
    if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
    return this.dispatch(
      async (feature) => {
        const lifetime = this.lifetimes.get(key.utteranceId);
        // Even an absent logical intent must belong to the current canonical target.
        const snapshot = await this.runtime.snapshot();
        if (snapshot.agent.id !== key.agentId || snapshot.epoch !== key.serviceEpoch)
          throw new KernelFault('conflict');
        const view = await feature.native.cancel(key);
        if (view.cleanup !== 'pending' && lifetime?.feature === feature) lifetime.finish();
        return view;
      },
      undefined,
      SPEECH_SEGMENT_TIMEOUT_MS,
    );
  }
  async audio(
    key: SpeechSegmentKey,
    signal: AbortSignal,
    consume: (consumer: SpeechAudioConsumer, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (!isSpeechSegmentKey(key)) throw new KernelFault('invalid-input');
    return this.dispatch(
      async (feature, sourceSignal) => {
        const consumer = await feature.native.attach(key, sourceSignal);
        let complete = false;
        try {
          await consume(consumer, sourceSignal);
          complete = true;
        } finally {
          if (!complete) consumer.cancel();
          await consumer.settled;
          await this.releaseIfTerminal(feature, key);
        }
      },
      signal,
      SPEECH_SEGMENT_TIMEOUT_MS,
    );
  }
  private async releaseIfTerminal(feature: Feature, key: SpeechUtteranceKey): Promise<void> {
    const lifetime = this.lifetimes.get(key.utteranceId);
    const status = await feature.native.status(keyOf(key));
    if (
      status.phase === 'terminal' &&
      status.cleanup !== 'pending' &&
      lifetime?.feature === feature
    )
      lifetime.finish();
  }
  async catalog(ref: string, bindingId: string, signal: AbortSignal): Promise<SpeechCatalog> {
    const view = await this.view();
    const native = this.providers.binding(ref);
    if (
      view.feature.source !== 'ready' ||
      view.feature.providerRef !== ref ||
      !native ||
      this.publicBinding(native.bindingId) !== bindingId
    )
      throw new KernelFault('conflict');
    const catalog = await this.providers.catalog(
      SPEECH_SERVICE_PLUGIN_ID,
      ref,
      native.bindingId,
      signal,
    );
    if (this.publicBinding(native.bindingId) !== bindingId) throw new KernelFault('stale-owner');
    return { ...catalog, bindingId };
  }
  async view(): Promise<SpeechView> {
    const config = await this.featureConfig();
    const featureSource = this.source(SPEECH_SERVICE_PLUGIN_ID);
    const providers: SpeechView['providers'][number][] = [];
    for (const [ref, r] of this.providers.list()) {
      const current = await this.configured(ref);
      const source = this.source(r.manifest.id);
      const native = this.providers.binding(ref);
      const bindingId = native ? this.publicBinding(native.bindingId) : null;
      const available = current.settings.authMode === 'local-client-id' || !!current.slot.value;
      const pending = this.host.manager.get(identity(r.manifest.id))?.state === 'pending_restart';
      const reason =
        featureSource !== 'ready'
          ? 'feature-disabled'
          : source === 'disabled'
            ? 'provider-disabled'
            : pending
              ? 'cleanup-pending'
              : source !== 'ready' || !bindingId
                ? 'source-unavailable'
                : !available
                  ? 'key-required'
                  : !current.settings.modelRef
                    ? 'model-unconfigured'
                    : null;
      providers.push({
        providerRef: ref,
        sourcePluginId: r.manifest.id,
        instanceId: 'default',
        providerId: r.tts.providerId,
        label: r.tts.label,
        synthetic: r.tts.synthetic,
        source,
        configRevision: current.revision,
        settings: current.settings,
        bindingId,
        credential: {
          available,
          writable: current.settings.authMode === 'gateway-key',
          version: current.slot.version,
          source:
            current.settings.authMode === 'local-client-id'
              ? 'local-client-id'
              : current.slot.source,
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
    const view: SpeechView = {
      version: 1,
      feature: {
        ...config.data,
        sourcePluginId: SPEECH_SERVICE_PLUGIN_ID,
        instanceId: 'default',
        source: featureSource,
        configRevision: config.revision,
      },
      providers,
    };
    if (Buffer.byteLength(JSON.stringify({ ok: true, value: view })) > SPEECH_VIEW_MAX_BYTES)
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
  async saveProvider(value: unknown): Promise<SpeechView> {
    if (!isSpeechProviderCommand(value)) throw new KernelFault('invalid-input');
    const registration = this.providers.registration(value.providerRef);
    const settings = registration.tts.parseConfig(value.settings);
    if (this.redactor.containsValue(settings)) throw new KernelFault('permission-denied');
    return this.manage(async () => {
      const desired =
        this.host.manager.get(identity(registration.manifest.id))?.desiredActive === true;
      const saved = await this.host.configs.save(
        identity(registration.manifest.id),
        { ...settings },
        value.expectedRevision,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      await this.configured(value.providerRef);
      await this.providers.disable(value.providerRef);
      if (desired) await this.providers.enable(value.providerRef);
      return this.view();
    });
  }
  async credential(value: unknown): Promise<SpeechView> {
    if (!isSpeechCredentialCommand(value)) throw new KernelFault('invalid-input');
    return this.manage(async () => {
      const current = await this.configured(value.providerRef);
      if (
        current.revision !== value.expectedRevision ||
        current.slot.version !== value.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
      if (current.settings.authMode !== 'gateway-key') throw new KernelFault('permission-denied');
      const desired =
        this.host.manager.get(identity(current.registration.manifest.id))?.desiredActive === true;
      this.providers.invalidate(value.providerRef);
      current.slot.value = value.value ?? undefined;
      current.slot.source = value.value === null ? 'none' : 'memory';
      current.slot.version = this.version();
      if (value.value) this.redactor.add(value.value);
      await this.providers.disable(value.providerRef);
      if (desired) await this.providers.enable(value.providerRef);
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
    try {
      if (this.host.isEnabled(SPEECH_SERVICE_PLUGIN_ID))
        await this.host.setEnabled(SPEECH_SERVICE_PLUGIN_ID, false);
      for (const [ref] of this.providers.list()) await this.providers.disable(ref);
    } finally {
      await this.providers.close();
      await Promise.all([...this.lifetimes.values()].map((l) => l.handle.settled));
      for (const slot of this.slots.values()) slot.value = undefined;
      this.redactor.clear();
    }
  }
}

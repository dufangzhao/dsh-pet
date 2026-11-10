import { randomUUID } from 'node:crypto';
import {
  VOICE_MAX_SAMPLES,
  VOICE_ASR_CAPABILITY,
  VOICE_CATALOG_MAX_BYTES,
  VOICE_CATALOG_TIMEOUT_MS,
  makeError,
  type OwnerRef,
  type VoiceCatalog,
  type VoiceFinal,
  type StreamCreditMessage,
  type StreamEndMessage,
  type TaskContext,
} from '@pet/contracts';
import { KernelFault, TaskMediaPeer } from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import type { CompanionPluginHost } from './plugin-host.js';
import { withSourceAuthority } from './source-authority.js';
import type {
  AuthorizedMagpieAsrTransport,
  NativeAsrBinding,
  VoiceAsrPorts,
  VoiceAsrRegistration,
} from './voice-input-types.js';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const same = (a: OwnerRef, b: OwnerRef) =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
interface Bound {
  id: string;
  ref: string;
  owner: OwnerRef;
  revision: number;
  epoch: number;
  native: NativeAsrBinding;
  abort: AbortController;
  pending: Set<Promise<unknown>>;
  retired: boolean;
}
/** ASR-only native references. Kernel owns plugins, permissions, tasks and media. */
export class VoiceProviders {
  private readonly registrations = new Map<string, VoiceAsrRegistration>();
  private readonly prepared = new Map<string, { revision: number; abort: AbortController }>();
  private readonly bindings = new Map<string, Bound>();
  private readonly pending = new Set<Promise<unknown>>();
  private selected = '';
  private readonly offCommit: () => void;
  constructor(
    private readonly host: CompanionPluginHost,
    registrations: readonly VoiceAsrRegistration[],
    private readonly transport: (owner: OwnerRef, baseUrl: string) => AuthorizedMagpieAsrTransport,
    private readonly invalidated: (ref: string) => void = () => {},
  ) {
    if (registrations.length > 4) throw new KernelFault('quota-exceeded');
    for (const r of registrations) {
      const ref = `${r.manifest.id}/${r.asr.providerId}`;
      if (
        this.registrations.has(ref) ||
        !r.manifest.provides?.some(
          (p) =>
            p.id === r.asr.providerId &&
            p.capability === VOICE_ASR_CAPABILITY &&
            p.features?.['nativeAsr'] === 1,
        )
      )
        throw new KernelFault('invalid-input');
      this.registrations.set(ref, r);
    }
    this.offCommit = host.onConfigurationCommit((commit) => {
      for (const [ref, r] of this.registrations)
        if (
          r.manifest.id === commit.pluginId &&
          commit.instanceId === 'default' &&
          this.prepared.get(ref)?.revision !== commit.revision
        )
          this.invalidate(ref);
    });
  }
  list(): readonly [string, VoiceAsrRegistration][] {
    return [...this.registrations];
  }
  registration(ref: string): VoiceAsrRegistration {
    const r = this.registrations.get(ref);
    if (!r) throw new KernelFault('invalid-input');
    return r;
  }
  select(ref: string): void {
    this.registration(ref);
    if (this.selected && this.selected !== ref) this.invalidated(this.selected);
    this.selected = ref;
  }
  invalidate(ref: string): void {
    this.registration(ref);
    this.prepared.get(ref)?.abort.abort();
    const bound = this.bindings.get(ref);
    if (bound) this.fence(bound);
  }
  private fence(b: Bound): void {
    if (b.retired) return;
    b.retired = true;
    b.abort.abort();
    if (this.bindings.get(b.ref) === b) this.bindings.delete(b.ref);
    this.invalidated(b.ref);
  }
  private current(b: Bound): boolean {
    const p = this.host.permissionControl.inspect(identity(b.owner.pluginId));
    return (
      !b.retired &&
      !b.abort.signal.aborted &&
      this.bindings.get(b.ref) === b &&
      this.host.manager.isActive(b.owner) &&
      this.host.verifySource(b.owner.pluginId) &&
      !!p &&
      !p.blocked &&
      p.preset !== 'deny' &&
      p.epoch === b.epoch
    );
  }
  binding(ref: string): { bindingId: string; revision: number; owner: OwnerRef } | null {
    const b = this.bindings.get(ref);
    if (!b) return null;
    if (!this.current(b)) {
      this.fence(b);
      return null;
    }
    return { bindingId: b.id, revision: b.revision, owner: b.owner };
  }
  async enable(ref: string): Promise<void> {
    const r = this.registration(ref),
      config = await this.host.configs.get(identity(r.manifest.id));
    if (!config.ok) throw new KernelFault(config.error.code);
    if (this.host.isEnabled(r.manifest.id)) {
      if (this.binding(ref)?.revision === config.value.revision) return;
      throw new KernelFault('conflict');
    }
    this.prepared.set(ref, { revision: config.value.revision, abort: new AbortController() });
    await this.host.setEnabled(r.manifest.id, true);
  }
  async disable(ref: string): Promise<void> {
    this.invalidate(ref);
    await this.host.setEnabled(this.registration(ref).manifest.id, false);
  }
  async prepare(context: PluginContext): Promise<void> {
    const entry = this.list().find(([, r]) => r.manifest.id === context.owner.pluginId);
    if (!entry) throw new KernelFault('not-ready');
    const config = await this.host.configs.get(identity(context.owner.pluginId));
    if (!config.ok) throw new KernelFault(config.error.code);
    if (context.signal.aborted) throw new KernelFault('stale-owner');
    this.prepared.set(entry[0], { revision: config.value.revision, abort: new AbortController() });
  }
  portsFor(context: PluginContext): VoiceAsrPorts {
    const entry = this.list().find(([, r]) => r.manifest.id === context.owner.pluginId);
    if (!entry) throw new KernelFault('not-ready');
    const [ref] = entry,
      prepared = this.prepared.get(ref);
    if (!prepared) throw new KernelFault('not-ready');
    const valid = () => {
      const current = this.host.manager.get(identity(context.owner.pluginId));
      if (
        context.signal.aborted ||
        prepared.abort.signal.aborted ||
        !current ||
        !same(current.owner, context.owner) ||
        !['activating', 'active'].includes(current.state)
      )
        throw new KernelFault('stale-owner');
    };
    return {
      authorizedMagpie: (baseUrl) => {
        valid();
        const native = this.transport(context.owner, baseUrl);
        return {
          catalog: async (signal) => {
            valid();
            const value = await native.catalog(
              AbortSignal.any([signal, context.signal, prepared.abort.signal]),
            );
            valid();
            return value;
          },
          mimoAsr: async (input, signal) => {
            valid();
            const value = await native.mimoAsr(
              input,
              AbortSignal.any([signal, context.signal, prepared.abort.signal]),
            );
            valid();
            return value;
          },
          close: () => native.close(),
        };
      },
      bind: (native) => {
        valid();
        if (this.bindings.has(ref)) throw new KernelFault('conflict');
        const policy = this.host.permissionControl.inspect(identity(context.owner.pluginId));
        if (!policy) throw new KernelFault('permission-denied');
        const b: Bound = {
          id: randomUUID(),
          ref,
          owner: { ...context.owner },
          revision: prepared.revision,
          epoch: policy.epoch,
          native,
          abort: prepared.abort,
          pending: new Set(),
          retired: false,
        };
        const abort = () => this.fence(b);
        context.signal.addEventListener('abort', abort, { once: true });
        this.bindings.set(ref, b);
        return async () => {
          this.fence(b);
          context.signal.removeEventListener('abort', abort);
          await Promise.allSettled([...b.pending]);
        };
      },
    };
  }
  private async run<T>(
    consumer: string,
    ref: string,
    bindingId: string,
    signal: AbortSignal,
    timeoutMs: number,
    operation: (b: Bound, signal: AbortSignal, context: TaskContext) => Promise<T>,
  ): Promise<T> {
    const b = this.bindings.get(ref);
    if (!b || b.id !== bindingId) throw new KernelFault('conflict');
    const owner = this.host.owner(consumer);
    const guard = async () => {
      if (
        this.selected !== ref ||
        !this.current(b) ||
        !this.host.manager.isActive(owner) ||
        !this.host.verifySource(consumer)
      )
        throw new KernelFault('stale-owner');
      const config = await this.host.configs.get(identity(b.owner.pluginId));
      if (!config.ok || config.value.revision !== b.revision) throw new KernelFault('conflict');
    };
    const work = (async () => {
      await guard();
      return withSourceAuthority(
        this.host,
        consumer,
        [{ kind: 'capability-use', capability: VOICE_ASR_CAPABILITY }],
        (consumerSignal) =>
          withSourceAuthority(
            this.host,
            b.owner.pluginId,
            [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
            async (providerSignal, context) => {
              await guard();
              const value = await operation(b, providerSignal, context);
              await guard();
              return value;
            },
            { signal: consumerSignal, timeoutMs },
          ),
        { signal: AbortSignal.any([signal, b.abort.signal]), timeoutMs },
      );
    })();
    b.pending.add(work);
    this.pending.add(work);
    try {
      return await work;
    } finally {
      b.pending.delete(work);
      this.pending.delete(work);
    }
  }
  catalog(
    consumer: string,
    ref: string,
    bindingId: string,
    signal: AbortSignal,
  ): Promise<VoiceCatalog> {
    return this.run(
      consumer,
      ref,
      bindingId,
      signal,
      VOICE_CATALOG_TIMEOUT_MS,
      async (b, sourceSignal) => {
        const candidates = await b.native.catalog(sourceSignal);
        const result = { providerRef: ref, bindingId: b.id, candidates };
        if (
          candidates.length > 64 ||
          Buffer.byteLength(JSON.stringify({ ok: true, value: result })) > VOICE_CATALOG_MAX_BYTES
        )
          throw new KernelFault('quota-exceeded');
        return result;
      },
    );
  }
  recognize(
    consumer: string,
    ref: string,
    bindingId: string,
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<VoiceFinal> {
    return this.run(
      consumer,
      ref,
      bindingId,
      signal,
      timeoutMs,
      async (b, sourceSignal, context) => {
        const r = this.registration(ref),
          config = await this.host.configs.get(identity(r.manifest.id));
        if (!config.ok) throw new KernelFault(config.error.code);
        const settings = r.asr.parseConfig(config.value.data);
        if (!settings.modelRef) throw new KernelFault('not-ready');
        return this.media(b, context, samples, settings.modelRef, pcm, sourceSignal);
      },
    );
  }
  private async media(
    b: Bound,
    context: TaskContext,
    samples: number,
    modelRef: string,
    pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<VoiceFinal> {
    if (!Number.isSafeInteger(samples) || samples < 0 || samples > VOICE_MAX_SAMPLES)
      throw new KernelFault('audio-format');
    const reference = { streamId: randomUUID(), taskId: context.taskId, owner: context.owner };
    const envelope = (
      message: Parameters<
        NonNullable<ConstructorParameters<typeof TaskMediaPeer>[0]['control']>
      >[0],
    ): StreamCreditMessage | StreamEndMessage => ({
      protocol: 1,
      id: randomUUID(),
      sessionId: reference.streamId,
      owner: context.owner,
      ...message,
    });
    const signalFor = (owner: OwnerRef, taskId: string) =>
      same(owner, context.owner) && taskId === context.taskId && !signal.aborted ? signal : null;
    const readerPeer: TaskMediaPeer = new TaskMediaPeer({
      signalFor,
      write: async () => ({ ok: false, error: makeError('permission-denied', false) }),
      control: (message) => writerPeer.control(envelope(message)),
    });
    const writerPeer: TaskMediaPeer = new TaskMediaPeer({
      signalFor,
      write: async (frame) => readerPeer.receive(frame),
      control: (message) => readerPeer.control(envelope(message)),
    });
    const reader = readerPeer.createReader(reference),
      writer = writerPeer.createWriter(reference);
    if (!reader.ok || !writer.ok) throw new KernelFault('not-ready');
    const credit = readerPeer.grantInitial(reference);
    if (!credit.ok) throw new KernelFault(credit.error.code);
    const pump = (async () => {
      let carry = new Uint8Array(0),
        bytes = 0;
      for await (const raw of pcm) {
        signal.throwIfAborted();
        if (!(raw instanceof Uint8Array) || bytes + raw.byteLength > samples * 4)
          throw new KernelFault('audio-format');
        bytes += raw.byteLength;
        const block = new Uint8Array(carry.length + raw.length);
        block.set(carry);
        block.set(raw, carry.length);
        const usable = block.length - (block.length % 4),
          values = new DataView(block.buffer, block.byteOffset, usable);
        for (let at = 0; at < usable; at += 4) {
          const sample = values.getFloat32(at, true);
          if (!Number.isFinite(sample) || sample < -1 || sample > 1)
            throw new KernelFault('audio-format');
        }
        for (let at = 0; at < usable; at += 6400) {
          const accepted = await writer.value.write(
            block.subarray(at, Math.min(at + 6400, usable)),
          );
          if (!accepted.ok) throw new KernelFault(accepted.error.code);
        }
        carry = block.slice(usable);
      }
      if (carry.length || bytes !== samples * 4) throw new KernelFault('audio-format');
      const ended = await writer.value.end();
      if (!ended.ok) throw new KernelFault(ended.error.code);
    })();
    const native = Promise.resolve().then(() =>
      b.native.transcribe(
        {
          modelRef,
          format: { encoding: 'f32le', sampleRate: 16000, channels: 1 },
          samples,
          audio: reader.value,
        },
        signal,
      ),
    );
    try {
      const [value] = await Promise.all([native, pump]);
      return value;
    } finally {
      readerPeer.close();
      writerPeer.close();
      await Promise.allSettled([native, pump]);
    }
  }
  async close(): Promise<void> {
    this.offCommit();
    for (const ref of this.registrations.keys()) this.invalidate(ref);
    await Promise.allSettled([...this.pending]);
  }
}

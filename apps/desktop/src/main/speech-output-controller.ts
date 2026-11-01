import { randomUUID } from 'node:crypto';
import {
  APPLICATION_PLUGIN_IDS,
  SPEECH_OUTPUT_CAPABILITY,
  SPEECH_OUTPUT_MAX_BYTES,
  SPEECH_OUTPUT_MAX_QUEUE,
  SPEECH_OUTPUT_MAX_TEXT,
  SPEECH_OUTPUT_PLUGIN_IDS,
  isSpeechOutputAudioDescriptor,
  isSpeechOutputRequest,
  isSpeechOutputSaveSettings,
  isKernelErrorCode,
  makeError,
  type JsonObject,
  type JsonValue,
  type OwnerRef,
  type Result,
  type KernelError,
  type SpeechOutputAudioDescriptor,
  type SpeechOutputAudioEvent,
  type SpeechOutputFailureReason,
  type SpeechOutputPlaybackReceipt,
  type SpeechOutputProviderInfo,
  type SpeechOutputSettings,
  type SpeechOutputSaveSettings,
  type SpeechOutputSnapshot,
} from '@pet/contracts';
import {
  capabilityPermissionAuthorizer,
  exactKeys,
  KernelFault,
  record,
  type MediaReadEndpoint,
  type TaskHandle,
  type TaskMediaReference,
} from '@pet/host-kernel';
import { jsonPreflight } from '@pet/contracts/validation';
import { isTrustedPetSource } from './ipc-request.js';
import type { DemoRequestSource } from './demo-request.js';
import type { DesktopHost } from './desktop-host.js';

const profileIdentity = { pluginId: APPLICATION_PLUGIN_IDS.profile, instanceId: 'default' };
const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const settingsKey = (settings: SpeechOutputSettings): string => JSON.stringify(settings);
const reasons: readonly SpeechOutputFailureReason[] = [
  'unsupported-platform',
  'voice-unavailable',
  'synthesis-failed',
  'audio-budget',
  'invalid-audio',
  'playback-failed',
];
interface ProfileSettings {
  owner: OwnerRef;
  revision: number;
  data: JsonObject;
  settings: SpeechOutputSettings;
  soundEnabled: boolean;
}
interface Utterance {
  utteranceId: string;
  text: string;
  profile: ProfileSettings;
  provider: OwnerRef;
}
interface Playback {
  id: string;
  task: TaskHandle;
  sequence: number;
  started: boolean;
  finished: boolean;
  finish: (failed: boolean) => void;
}
interface Current {
  utterance: Utterance;
  abort: AbortController;
  tasks: Set<TaskHandle>;
  detach: () => void;
  synthesis?: TaskHandle;
  playback?: Playback;
}
interface Route {
  current: Current;
  task: TaskHandle;
  provider: OwnerRef;
  stream?: TaskMediaReference;
  chunks: Uint8Array[];
  bytes: number;
  readDone?: Promise<void>;
  readError?: KernelError;
}
const emptySettings = (): SpeechOutputSettings => ({
  enabled: false,
  provider: null,
  language: 'zh-CN',
  voice: null,
  rate: 0,
  volume: 85,
});

/** Main owns selection/cancellation and media validation; only the Pet renderer plays bytes. */
export class SpeechOutputController {
  readonly #routes = new Map<string, Route>();
  readonly #queue: Utterance[] = [];
  #current: Current | undefined;
  #last: SpeechOutputSnapshot['lastUtterance'] = null;
  #phase: SpeechOutputSnapshot['phase'] = 'idle';
  #error: KernelError | null = null;
  #reason: SpeechOutputFailureReason | null = null;
  #closed = false;
  #epoch = 0;
  #refresh = 0;
  constructor(
    private readonly host: DesktopHost,
    private readonly changed: () => void,
    private readonly audio: (event: SpeechOutputAudioEvent, payload?: Uint8Array) => void,
  ) {}
  private async profile(): Promise<Result<ProfileSettings>> {
    const entry = this.host.manager.get(profileIdentity);
    if (!entry || !this.host.manager.isActive(entry.owner)) return fail('not-ready');
    const saved = await this.host.configs.get(profileIdentity);
    if (!saved.ok) return saved;
    if (!this.host.manager.isActive(entry.owner)) return fail('stale-owner');
    const data = saved.value.data;
    const candidate = {
      expectedRevision: saved.value.revision,
      enabled: data['speechEnabled'],
      provider: data['speechProvider'],
      voice: data['speechVoice'],
      rate: data['speechRate'],
      volume: data['speechVolume'],
    };
    if (!isSpeechOutputSaveSettings(candidate) || typeof data['replyLanguage'] !== 'string')
      return fail('not-ready');
    return {
      ok: true,
      value: {
        owner: entry.owner,
        revision: saved.value.revision,
        data,
        soundEnabled: data['soundEnabled'] !== false,
        settings: {
          enabled: candidate.enabled,
          provider: candidate.provider,
          voice: candidate.voice,
          rate: candidate.rate,
          volume: candidate.volume,
          language: data['replyLanguage'],
        },
      },
    };
  }
  private providers(): SpeechOutputProviderInfo[] {
    return this.host.manager.list().flatMap((plugin) =>
      (plugin.manifest.provides ?? [])
        .filter((p) => p.capability === SPEECH_OUTPUT_CAPABILITY)
        .map((p): SpeechOutputProviderInfo => ({
          selection: {
            pluginId: plugin.owner.pluginId,
            instanceId: plugin.owner.instanceId,
            providerId: p.id,
          },
          owner: plugin.owner,
          name:
            plugin.manifest.displayName['zh-CN'] ??
            plugin.manifest.displayName['en'] ??
            plugin.owner.pluginId,
          kind:
            plugin.owner.pluginId === SPEECH_OUTPUT_PLUGIN_IDS.tones ||
            p.features?.['kind'] === 'tones'
              ? 'tones'
              : 'voice',
          active: this.host.manager.isActive(plugin.owner),
        })),
    );
  }
  async snapshot(): Promise<SpeechOutputSnapshot> {
    const profile = await this.profile();
    return {
      version: 1,
      owner: profile.ok ? profile.value.owner : null,
      revision: profile.ok ? profile.value.revision : 0,
      settings: profile.ok ? profile.value.settings : emptySettings(),
      providers: this.providers(),
      phase: this.#phase,
      queued: this.#queue.length,
      current: this.#current
        ? {
            utteranceId: this.#current.utterance.utteranceId,
            text: this.#current.utterance.text,
            taskId: this.#current.playback?.task.taskId ?? this.#current.synthesis?.taskId ?? null,
          }
        : null,
      lastUtterance: this.#last ? { ...this.#last } : null,
      error: this.#error ?? (!profile.ok ? profile.error : null),
      reason: this.#reason,
    };
  }
  private active(current: Current): boolean {
    return (
      !this.#closed &&
      this.#current === current &&
      !current.abort.signal.aborted &&
      this.host.manager.isActive(current.utterance.profile.owner) &&
      this.host.manager.isActive(current.utterance.provider)
    );
  }
  async speak(text: string, utteranceId: string): Promise<Result<null>> {
    const epoch = this.#epoch;
    if (this.#closed) return fail('not-ready');
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      [...text].length > SPEECH_OUTPUT_MAX_TEXT ||
      typeof utteranceId !== 'string' ||
      !utteranceId.trim() ||
      [...utteranceId].length > 128
    )
      return fail('invalid-input');
    this.#last = { text, utteranceId };
    const profile = await this.profile();
    if (epoch !== this.#epoch || this.#closed) return fail('cancelled');
    if (!profile.ok) return this.reject(profile.error);
    if (!profile.value.settings.enabled || !profile.value.soundEnabled) return fail('not-ready');
    const selection = profile.value.settings.provider;
    if (!selection) return this.reject(makeError('not-ready', false));
    const provider = this.providers().find(
      (p) =>
        p.active &&
        p.selection.pluginId === selection.pluginId &&
        p.selection.instanceId === selection.instanceId &&
        p.selection.providerId === selection.providerId,
    );
    if (!provider) return this.reject(makeError('not-ready', false));
    if (this.#queue.length + Number(!!this.#current) >= SPEECH_OUTPUT_MAX_QUEUE)
      return fail('quota-exceeded');
    this.#queue.push({ text, utteranceId, profile: profile.value, provider: provider.owner });
    this.#error = null;
    this.#reason = null;
    this.changed();
    this.drain();
    return { ok: true, value: null };
  }
  private reject(error: KernelError): Result<never> {
    this.#error = error;
    if (!this.#current) this.#phase = 'error';
    this.changed();
    return { ok: false, error };
  }
  private drain(): void {
    if (this.#closed || this.#current) return;
    const utterance = this.#queue.shift();
    if (!utterance) return;
    const current: Current = {
      utterance,
      abort: new AbortController(),
      tasks: new Set(),
      detach: () => {},
    };
    const signals = [
      this.host.manager.signal(utterance.profile.owner),
      this.host.manager.signal(utterance.provider),
    ];
    if (signals.some((signal) => !signal || signal.aborted)) {
      this.#queue.length = 0;
      this.reject(makeError('not-ready', false));
      return;
    }
    const disabled = (): void => {
      if (this.#current !== current) return;
      this.stopNow();
      this.#error = makeError('not-ready', false);
      this.#phase = 'error';
      this.changed();
    };
    for (const signal of signals) signal?.addEventListener('abort', disabled, { once: true });
    current.detach = () => {
      for (const signal of signals) signal?.removeEventListener('abort', disabled);
    };
    this.#current = current;
    this.#phase = 'synthesizing';
    this.changed();
    void this.run(current).finally(() => {
      if (this.#current !== current) return;
      current.detach();
      this.#current = undefined;
      if (!this.#error) this.#phase = 'idle';
      this.changed();
      this.drain();
    });
  }
  private track(task: TaskHandle, current: Current): void {
    current.tasks.add(task);
    void task.settled.then(() => {
      current.tasks.delete(task);
      this.#routes.delete(task.taskId);
      task.release();
    });
  }
  capabilityTask(
    parentTaskId: string,
    child: TaskHandle,
    capability: string,
    method: string,
  ): boolean {
    const parent = this.#routes.get(parentTaskId);
    if (
      !parent ||
      !this.active(parent.current) ||
      capability !== SPEECH_OUTPUT_CAPABILITY ||
      method !== 'synthesize'
    )
      return false;
    const bound = this.host.manager.capabilities.resolveSelection(
      child.snapshot().owner,
      capability,
    );
    if (!bound.ok) {
      child.cancel();
      return true;
    }
    this.#routes.set(child.taskId, {
      current: parent.current,
      task: child,
      provider: bound.value.owner,
      chunks: [],
      bytes: 0,
    });
    this.track(child, parent.current);
    return true;
  }
  output(reference: TaskMediaReference, reader: MediaReadEndpoint): boolean {
    const route = this.#routes.get(reference.taskId);
    if (!route) return false;
    if (
      !this.active(route.current) ||
      !sameOwner(reference.owner, route.provider) ||
      route.stream
    ) {
      reader.cancel();
      return true;
    }
    route.stream = reference;
    route.readDone = (async () => {
      try {
        for await (const bytes of reader) {
          if (!this.active(route.current)) throw new KernelFault('cancelled');
          if (!bytes.byteLength || route.bytes + bytes.byteLength > SPEECH_OUTPUT_MAX_BYTES)
            throw new KernelFault('quota-exceeded');
          route.bytes += bytes.byteLength;
          route.chunks.push(Uint8Array.from(bytes));
        }
      } catch (error) {
        route.readError =
          error instanceof KernelFault ? error.error : makeError('unavailable', false);
        route.task.cancel();
      } finally {
        reader.cancel();
      }
    })();
    return true;
  }
  private async run(current: Current): Promise<void> {
    const utterance = current.utterance;
    try {
      const profile = await this.profile();
      if (!this.active(current)) return;
      if (!profile.ok) throw new KernelFault(profile.error.code);
      if (
        !profile.value.soundEnabled ||
        settingsKey(profile.value.settings) !== settingsKey(utterance.profile.settings)
      )
        throw new KernelFault('cancelled');
      const selection = utterance.profile.settings.provider;
      if (!selection) throw new KernelFault('not-ready');
      const selected = this.host.manager.select(
        profileIdentity,
        SPEECH_OUTPUT_CAPABILITY,
        selection,
      );
      if (!selected.ok) throw new KernelFault(selected.error.code);
      const request = {
        utteranceId: utterance.utteranceId,
        text: utterance.text,
        language: utterance.profile.settings.language,
        voice: utterance.profile.settings.voice,
        rate: utterance.profile.settings.rate,
      };
      if (!isSpeechOutputRequest(request)) throw new KernelFault('invalid-input');
      const task = this.host.tasks.invokeCapability(
        this.host.manager,
        utterance.profile.owner,
        SPEECH_OUTPUT_CAPABILITY,
        'synthesize',
        request,
        capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
        { signal: current.abort.signal, timeoutMs: 60000 },
      );
      if (!task.ok) throw new KernelFault(task.error.code);
      current.synthesis = task.value;
      const route: Route = {
        current,
        task: task.value,
        provider: utterance.provider,
        chunks: [],
        bytes: 0,
      };
      this.#routes.set(task.value.taskId, route);
      this.track(task.value, current);
      this.changed();
      const result = await task.value.result;
      await route.readDone;
      if (!this.active(current)) return;
      if (route.readError) throw new KernelFault(route.readError.code);
      if (!result.ok) throw new KernelFault(result.error.code);
      const response = record(result.value);
      if (response && typeof response['errorCode'] === 'string') {
        const reason = response['reason'];
        this.#reason = reasons.includes(reason as SpeechOutputFailureReason)
          ? (reason as SpeechOutputFailureReason)
          : null;
        throw new KernelFault(
          isKernelErrorCode(response['errorCode']) ? response['errorCode'] : 'unavailable',
        );
      }
      if (!isSpeechOutputAudioDescriptor(result.value) || !route.stream || !route.readDone) {
        this.#reason = 'invalid-audio';
        throw new KernelFault('unavailable');
      }
      const descriptor = result.value;
      if (
        descriptor.utteranceId !== utterance.utteranceId ||
        descriptor.media.streamId !== route.stream.streamId ||
        descriptor.media.taskId !== route.stream.taskId ||
        !sameOwner(descriptor.media.owner, route.stream.owner) ||
        descriptor.frames * descriptor.channels * 2 !== route.bytes
      ) {
        this.#reason = 'invalid-audio';
        throw new KernelFault('unavailable');
      }
      await this.play(current, descriptor, route.chunks);
      route.chunks = [];
    } catch (error) {
      if (!this.active(current)) return;
      this.#error = error instanceof KernelFault ? error.error : makeError('unavailable', false);
      this.#phase = 'error';
      this.#queue.length = 0;
      this.cancelCurrent();
      this.changed();
    }
  }
  private async play(
    current: Current,
    descriptor: SpeechOutputAudioDescriptor,
    chunks: Uint8Array[],
  ): Promise<void> {
    let finish: (failed: boolean) => void = () => {};
    const done = new Promise<JsonValue>((resolve, reject) => {
      finish = (failed) => (failed ? reject(new KernelFault('unavailable')) : resolve(null));
    });
    // Attach the rejection handler before any renderer callback can settle the receipt.
    void done.catch(() => {});
    const started = this.host.tasks.run(
      current.utterance.profile.owner,
      async (context) => {
        const aborted = (): void => {
          finish(false);
        };
        context.signal.addEventListener('abort', aborted, { once: true });
        if (context.signal.aborted) aborted();
        try {
          return await done;
        } finally {
          context.signal.removeEventListener('abort', aborted);
        }
      },
      {
        signal: current.abort.signal,
        timeoutMs: Math.ceil((descriptor.frames / descriptor.sampleRate) * 1000) + 15000,
      },
    );
    if (!started.ok) throw new KernelFault(started.error.code);
    const playback: Playback = {
      id: randomUUID(),
      task: started.value,
      sequence: 0,
      started: false,
      finished: false,
      finish,
    };
    current.playback = playback;
    this.track(started.value, current);
    this.send(current, {
      kind: 'start',
      descriptor,
      volume: current.utterance.profile.settings.volume,
    });
    for (const chunk of chunks) {
      if (!this.active(current)) return;
      this.send(current, { kind: 'chunk', byteLength: chunk.byteLength }, Uint8Array.from(chunk));
    }
    this.send(current, { kind: 'end' });
    const result = await started.value.result;
    if (!this.active(current)) return;
    if (!result.ok) {
      this.#reason = 'playback-failed';
      throw new KernelFault(result.error.code);
    }
  }
  private send(
    current: Current,
    data:
      | { kind: 'start'; descriptor: SpeechOutputAudioDescriptor; volume: number }
      | { kind: 'chunk'; byteLength: number }
      | { kind: 'end' | 'stop' },
    payload?: Uint8Array,
  ): void {
    const playback = current.playback;
    if (!playback) return;
    this.audio(
      {
        ...data,
        playbackId: playback.id,
        utteranceId: current.utterance.utteranceId,
        taskId: playback.task.taskId,
        owner: { ...current.utterance.profile.owner },
        provider: { ...current.utterance.provider },
        sequence: playback.sequence++,
      },
      payload,
    );
  }
  reportPlayback(receipt: SpeechOutputPlaybackReceipt): Result<null> {
    const current = this.#current,
      playback = current?.playback;
    if (
      !current ||
      !playback ||
      playback.finished ||
      receipt.playbackId !== playback.id ||
      !this.active(current)
    )
      return fail('stale-owner');
    if (receipt.status === 'started') {
      if (playback.started) return fail('invalid-input');
      playback.started = true;
      this.#phase = 'playing';
      this.changed();
    } else {
      if (receipt.status === 'ended' && !playback.started) return fail('invalid-input');
      if (receipt.status === 'failed') this.#reason = 'playback-failed';
      playback.finished = true;
      playback.finish(receipt.status === 'failed');
    }
    return { ok: true, value: null };
  }
  private cancelCurrent(): void {
    const current = this.#current;
    this.#current = undefined;
    if (!current) return;
    current.detach();
    try {
      this.send(current, { kind: 'stop' });
    } finally {
      current.abort.abort();
      current.playback?.finish(false);
      for (const task of current.tasks) task.cancel();
      for (const route of this.#routes.values()) if (route.current === current) route.chunks = [];
    }
  }
  private stopNow(): void {
    this.#epoch++;
    this.#queue.length = 0;
    this.cancelCurrent();
    this.#phase = 'idle';
  }
  async stop(): Promise<Result<SpeechOutputSnapshot>> {
    this.stopNow();
    this.#error = null;
    this.#reason = null;
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  async saveSettings(request: SpeechOutputSaveSettings): Promise<Result<SpeechOutputSnapshot>> {
    if (!isSpeechOutputSaveSettings(request)) return fail('invalid-input');
    const profile = await this.profile();
    if (!profile.ok) return profile;
    const signal = this.host.manager.ownerSignal(profile.value.owner);
    if (!signal || signal.aborted) return fail('stale-owner');
    const saved = await this.host.configs.save(
      profileIdentity,
      {
        ...profile.value.data,
        speechEnabled: request.enabled,
        speechProvider: request.provider,
        speechVoice: request.voice,
        speechRate: request.rate,
        speechVolume: request.volume,
      },
      request.expectedRevision,
      signal,
    );
    if (!saved.ok) return saved;
    this.stopNow();
    this.#error = null;
    this.#reason = null;
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  onHostChanged(): void {
    const current = this.#current;
    if (current && !this.active(current)) {
      this.stopNow();
      this.#error = makeError('not-ready', false);
      this.changed();
      return;
    }
    const refresh = ++this.#refresh;
    void this.profile().then((profile) => {
      if (this.#closed || refresh !== this.#refresh || !this.#current) return;
      if (
        !profile.ok ||
        !profile.value.soundEnabled ||
        !profile.value.settings.enabled ||
        settingsKey(profile.value.settings) !==
          settingsKey(this.#current.utterance.profile.settings)
      ) {
        this.stopNow();
        this.changed();
      }
    });
  }
  close(): void {
    this.#closed = true;
    this.stopNow();
  }
}

export type SpeechOutputAction = 'snapshot' | 'speak' | 'stop' | 'saveSettings' | 'playback';
export async function handleSpeechOutputRequest(
  source: DemoRequestSource,
  action: SpeechOutputAction,
  args: readonly unknown[],
  controller: SpeechOutputController,
): Promise<Result<unknown>> {
  if (!isTrustedPetSource(source) || (action === 'playback' && source.role !== 'pet'))
    return fail('permission-denied');
  try {
    if (action === 'snapshot' || action === 'stop') {
      if (args.length !== 0) return fail('invalid-input');
      return action === 'snapshot'
        ? { ok: true, value: await controller.snapshot() }
        : controller.stop();
    }
    if (args.length !== 1) return fail('invalid-input');
    const safe = jsonPreflight(args[0]),
      body = safe.ok ? record(safe.value) : null;
    if (!body) return fail('invalid-input');
    if (action === 'speak')
      return exactKeys(body, ['text', 'utteranceId']) &&
        typeof body['text'] === 'string' &&
        typeof body['utteranceId'] === 'string'
        ? controller.speak(body['text'], body['utteranceId'])
        : fail('invalid-input');
    if (action === 'saveSettings')
      return isSpeechOutputSaveSettings(body)
        ? controller.saveSettings(body)
        : fail('invalid-input');
    if (
      !exactKeys(body, ['playbackId', 'status']) ||
      typeof body['playbackId'] !== 'string' ||
      body['playbackId'].length > 128 ||
      !['started', 'ended', 'failed'].includes(body['status'] as string)
    )
      return fail('invalid-input');
    return controller.reportPlayback(body as unknown as SpeechOutputPlaybackReceipt);
  } catch (error) {
    return fail(error instanceof KernelFault ? error.error.code : 'unavailable');
  }
}

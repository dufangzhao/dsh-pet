import { APPLICATION_PLUGIN_IDS as APP } from '@pet/contracts';
import { randomUUID } from 'node:crypto';
import {
  DEMO_PLUGIN_IDS as ID,
  LOCAL_ASR_MODELS,
  LOCAL_ASR_MAX_SECONDS,
  LOCAL_ASR_SAMPLE_RATE,
  makeError,
  isKernelErrorCode,
  type DemoCaptureTicket,
  type DemoMessage,
  type DemoPhase,
  type DemoSettings,
  type DemoSnapshot,
  type JsonValue,
  type KernelError,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import {
  KernelFault,
  capabilityPermissionAuthorizer,
  type MediaReadEndpoint,
  type MediaWriteEndpoint,
  type TaskHandle,
  type TaskMediaReference,
} from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { readLegacyDemoHistory } from './demo-history.js';
import { modelPresent } from '../../../../plugins/asr-local/src/model-store.js';
const sameOwner = (a: OwnerRef, b: OwnerRef) =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const object = (value: JsonValue) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
interface Intent {
  readonly id: string;
  readonly settings: DemoSettings;
  readonly owner: OwnerRef;
  readonly asr: OwnerRef | null;
  readonly reply: OwnerRef | null;
  readonly abort: AbortController;
  readonly tasks: Set<TaskHandle>;
  audio: Uint8Array[];
}
interface Capture {
  readonly token: string;
  readonly intent: Intent;
  readonly frameId: number;
  readonly signal: AbortSignal;
  readonly ended: () => void;
  readonly chunks: Uint8Array[];
  timer: ReturnType<typeof setTimeout>;
  sequence: number;
  samples: number;
  ready: boolean;
}
interface Route {
  readonly intent: Intent;
  readonly capability: string;
  readonly method: string;
  readonly task: TaskHandle;
}
export class DemoController {
  readonly #routes = new Map<string, Route>();
  #intent: Intent | undefined;
  #capture: Capture | undefined;
  #phase: DemoPhase = 'setup';
  #error: KernelError | null = null;
  #messages: DemoMessage[];
  #transcript = '';
  #partialTranscript = '';
  #partialReply = '';
  #started: number | null = null;
  #preparedModel: string | null = null;
  #models: DemoSnapshot['models'] = [];
  #closing = false;
  private constructor(
    private readonly host: DesktopHost,
    private readonly legacy: readonly DemoMessage[],
    private readonly changed: () => void,
  ) {
    this.#messages = [];
  }
  static async create(
    host: DesktopHost,
    modelRoot: string,
    changed: () => void,
  ): Promise<DemoController> {
    const directory = await host.dataDirectories.get(identity(ID.voice));
    if (!directory.ok) throw new Error('Demo data unavailable');
    const instance = new DemoController(
      host,
      await readLegacyDemoHistory(directory.value),
      changed,
    );
    instance.#models = await Promise.all(
      LOCAL_ASR_MODELS.map(async (model) => ({
        id: model.id,
        name: model.name,
        source: 'ModelScope' as const,
        streaming: model.streaming,
        cached: await modelPresent(modelRoot, model.id),
      })),
    );
    return instance;
  }
  private owner(id: string): OwnerRef | null {
    const entry = this.host.manager.get(identity(id));
    return entry?.origin === 'builtin' && this.host.manager.isActive(entry.owner)
      ? entry.owner
      : null;
  }
  private current(intent: Intent): boolean {
    return !this.#closing && this.#intent === intent && !intent.abort.signal.aborted;
  }
  private emit(): void {
    this.changed();
  }
  private error(code: KernelError['code']): void {
    this.#error = makeError(code, false);
    this.#phase = 'error';
    this.emit();
  }
  private async settings(): Promise<DemoSettings> {
    const asr = this.host.manager.get(identity(ID.asr)),
      voice = this.host.manager.get(identity(ID.voice));
    const a = asr ? await this.host.configs.inspect(identity(ID.asr)) : null,
      v = voice ? await this.host.configs.inspect(identity(ID.voice)) : null;
    const adata = a?.ok ? a.value.snapshot?.data : null,
      vdata = v?.ok ? v.value.snapshot?.data : null;
    return {
      asrOwner: asr?.owner ?? null,
      asrRevision: a?.ok ? (a.value.snapshot?.revision ?? 0) : 0,
      modelId: typeof adata?.['model'] === 'string' ? adata['model'] : null,
      voiceOwner: voice?.owner ?? null,
      voiceRevision: v?.ok ? (v.value.snapshot?.revision ?? 0) : 0,
      replyMode:
        vdata?.['mode'] === 'demo' || vdata?.['mode'] === 'deepseek' ? vdata['mode'] : null,
      autoSend: vdata?.['autoSend'] === true,
      readError: a && !a.ok ? a.error : v && !v.ok ? v.error : null,
    };
  }
  async snapshot(): Promise<DemoSnapshot> {
    const settings = await this.settings();
    let keyAvailable = !!this.host.credentials,
      keyConfigured = false;
    if (this.host.credentials)
      try {
        keyConfigured = await this.host.credentials.hasSecret(identity(ID.cloud), 'api-key');
      } catch {
        keyAvailable = false;
      }
    const plugins = Object.values(ID).map((pluginId) => {
      const plugin = this.host.manager.get(identity(pluginId)),
        source = plugin ? this.host.describeTrust(plugin.owner) : null,
        policy = this.host.permissionControl.inspect(identity(pluginId));
      return {
        pluginId,
        name: plugin?.manifest.displayName['zh-CN'] ?? pluginId,
        version: plugin?.manifest.version ?? null,
        origin: plugin?.origin ?? null,
        owner: plugin?.owner ?? null,
        digest: source?.digest ?? null,
        state: plugin?.state ?? ('missing' as const),
        trusted: source?.trusted === true,
        preset: policy?.preset ?? null,
        blocked: policy?.blocked ?? false,
      };
    });
    const reply = settings.replyMode === 'deepseek' ? ID.cloud : APP.agent;
    const ready = (id: string) => {
      const plugin = plugins.find((p) => p.pluginId === id);
      return (
        !!this.owner(id) && plugin?.trusted === true && !plugin.blocked && plugin.preset !== 'deny'
      );
    };
    const configured = settings.replyMode !== null && settings.readError === null;
    const canSend =
      configured &&
      !!this.owner(APP.agent) &&
      (settings.replyMode === 'demo' || ready(reply)) &&
      (settings.replyMode !== 'deepseek' || (keyAvailable && keyConfigured));
    const profile = await this.host.configs.get(identity(APP.profile));
    const voiceEnabled = profile.ok && profile.value.data['voiceEnabled'] === true;
    const canRecord =
      voiceEnabled && configured && ready(ID.voice) && ready(ID.asr) && settings.modelId !== null;
    return {
      version: 1,
      phase: this.#phase === 'setup' && (canSend || canRecord) ? 'idle' : this.#phase,
      intentId: this.#intent?.id ?? null,
      settings,
      plugins,
      models: this.#models,
      preparedModelId: this.#preparedModel,
      canRecord,
      canSend,
      transcript: this.#transcript,
      partialTranscript: this.#partialTranscript,
      partialReply: this.#partialReply,
      messages: this.#messages,
      recordingStartedAt: this.#started,
      maxRecordingSeconds: LOCAL_ASR_MAX_SECONDS,
      error: this.#error,
      keyAvailable,
      keyConfigured,
      avatarEnabled: !!this.owner(ID.avatar),
    };
  }
  private track(task: TaskHandle, intent: Intent, capability: string, method: string): void {
    intent.tasks.add(task);
    this.#routes.set(task.taskId, { intent, capability, method, task });
    void task.settled.then(() => {
      intent.tasks.delete(task);
      this.#routes.delete(task.taskId);
      task.release();
    });
  }
  capabilityTask(
    parentTaskId: string,
    child: TaskHandle,
    capability: string,
    method: string,
  ): void {
    const parent = this.#routes.get(parentTaskId);
    if (
      parent &&
      this.current(parent.intent) &&
      ['speech.asr@1', 'agent.conversation@1', 'llm.responses@1', 'chat.session@1'].includes(
        capability,
      )
    )
      this.track(child, parent.intent, capability, method);
  }
  input(reference: TaskMediaReference, writer: MediaWriteEndpoint): void {
    const route = this.#routes.get(reference.taskId);
    if (
      !route ||
      !this.current(route.intent) ||
      route.capability !== 'speech.asr@1' ||
      route.method !== 'transcribe' ||
      !route.intent.asr ||
      !sameOwner(reference.owner, route.intent.asr)
    ) {
      writer.cancel();
      return;
    }
    void (async () => {
      try {
        for (const chunk of route.intent.audio) {
          if (!this.current(route.intent)) break;
          const sent = await writer.write(chunk);
          if (!sent.ok) return;
        }
        await writer.end();
      } finally {
        writer.cancel();
      }
    })();
  }
  output(reference: TaskMediaReference, reader: MediaReadEndpoint): void {
    const route = this.#routes.get(reference.taskId);
    const expected =
      route?.capability === 'speech.asr@1'
        ? route.intent.asr
        : route?.capability === 'agent.conversation@1'
          ? route.intent.reply
          : null;
    if (
      !route ||
      !expected ||
      !sameOwner(reference.owner, expected) ||
      !this.current(route.intent)
    ) {
      reader.cancel();
      return;
    }
    void (async () => {
      try {
        for await (const bytes of reader) {
          if (!this.current(route.intent)) break;
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (route.capability === 'speech.asr@1') {
            if ([...text].length > 4000) throw new Error('Text limit');
            this.#partialTranscript = text;
            this.#phase = 'recognizing';
          } else {
            const packet = object(JSON.parse(text) as JsonValue);
            const reply = typeof packet?.['text'] === 'string' ? packet['text'] : '';
            if ([...(this.#partialReply + reply)].length > 4000) throw new Error('Text limit');
            this.#partialReply += reply;
            this.#phase = 'responding';
          }
          this.emit();
        }
      } catch {
        if (this.current(route.intent)) {
          route.task.cancel();
          this.error('unavailable');
        }
      } finally {
        reader.cancel();
      }
    })();
  }
  private cancelCurrent(): void {
    const intent = this.#intent;
    this.#intent = undefined;
    if (this.#capture) {
      clearTimeout(this.#capture.timer);
      this.#capture.ended();
      this.#capture = undefined;
    }
    if (intent) {
      intent.abort.abort();
      for (const task of intent.tasks) task.cancel();
      intent.audio = [];
    }
    this.#started = null;
    this.#partialTranscript = '';
    this.#partialReply = '';
    this.#preparedModel = null;
  }
  async cancel(): Promise<DemoSnapshot> {
    this.cancelCurrent();
    this.#phase = 'idle';
    this.#error = null;
    this.emit();
    return this.snapshot();
  }
  private begin(settings: DemoSettings, kind: 'voice' | 'text' = 'voice'): Intent {
    this.cancelCurrent();
    const owner = this.owner(kind === 'text' ? APP.agent : ID.voice);
    if (!owner || !settings.replyMode) throw new KernelFault('not-ready');
    const intent: Intent = {
      id: randomUUID(),
      settings,
      owner,
      asr: this.owner(ID.asr),
      reply: this.owner(APP.agent),
      abort: new AbortController(),
      tasks: new Set(),
      audio: [],
    };
    this.#intent = intent;
    this.#error = null;
    this.#transcript = '';
    this.#partialTranscript = '';
    this.#partialReply = '';
    return intent;
  }
  private invoke(intent: Intent, method: string, input: JsonValue): TaskHandle {
    const direct = intent.owner.pluginId === APP.agent;
    const consumer = identity(intent.owner.pluginId);
    const mappings = direct
      ? [['agent.conversation@1', APP.agent, 'conversation']]
      : [
          ['chat.session@1', ID.voice, 'voice'],
          ['speech.asr@1', ID.asr, 'local'],
          ['agent.conversation@1', APP.agent, 'conversation'],
        ];
    for (const [capability, pluginId, providerId] of mappings) {
      if (!capability || !pluginId || !providerId || !this.owner(pluginId)) continue;
      const selected = this.host.manager.select(consumer, capability, {
        pluginId,
        instanceId: 'default',
        providerId,
      });
      if (!selected.ok) throw new KernelFault(selected.error.code);
    }
    const capability = direct ? 'agent.conversation@1' : 'chat.session@1';
    const body = object(input);
    const payload =
      direct && method === 'turn'
        ? {
            text: body?.['text'] ?? '',
            mode: body?.['mode'] ?? 'demo',
            via: body?.['via'] ?? 'console',
          }
        : input;
    const task = this.host.tasks.invokeCapability(
      this.host.manager,
      intent.owner,
      capability,
      method,
      payload,
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { signal: intent.abort.signal, timeoutMs: 120000 },
    );
    if (!task.ok) throw new KernelFault(task.error.code);
    this.track(task.value, intent, capability, method);
    return task.value;
  }
  private async queryAgent(method: string, input: JsonValue): Promise<JsonValue> {
    const owner = this.owner(APP.agent);
    if (!owner) throw new KernelFault('not-ready');
    const task = this.host.tasks.invokeCapability(
      this.host.manager,
      owner,
      'agent.conversation@1',
      method,
      input,
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { timeoutMs: 30000 },
    );
    if (!task.ok) throw new KernelFault(task.error.code);
    try {
      const done = await task.value.result;
      if (!done.ok) throw new KernelFault(done.error.code);
      return done.value;
    } finally {
      task.value.release();
    }
  }
  private async readMessages(): Promise<void> {
    if (!this.owner(APP.agent)) {
      this.#messages = [];
      return;
    }
    const result = object(await this.queryAgent('history', null));
    if (!Array.isArray(result?.['items'])) throw new KernelFault('unavailable');
    this.#messages = result['items']
      .filter((row) => {
        const item = object(row);
        return item?.['kind'] === 'user' || item?.['kind'] === 'pet';
      })
      .map<DemoMessage>((row) => {
        const item = object(row)!;
        return {
          id: item['id'] as string,
          role: item['kind'] === 'user' ? 'user' : 'assistant',
          text: item['text'] as string,
          at: item['at'] as number,
          mode: item['mode'] === 'deepseek' ? 'deepseek' : 'demo',
        };
      })
      .slice(-20);
  }
  async attachAgent(importLegacy: boolean): Promise<void> {
    if (importLegacy && this.legacy.length) {
      for (let offset = 0; offset < this.legacy.length; offset += 4) {
        const result = object(
          await this.queryAgent('importLegacy', {
            messages: this.legacy.slice(offset, offset + 4).map((m) => ({ ...m })),
          }),
        );
        if (result?.['errorCode']) throw new KernelFault('unavailable');
      }
    }
    await this.queryAgent('reload', null);
    await this.readMessages();
  }
  async beginRecording(frameId: number): Promise<Result<DemoCaptureTicket>> {
    const state = await this.snapshot();
    if (!state.canRecord || !state.settings.modelId) return fail('not-ready');
    const intent = this.begin(state.settings);
    this.#phase = 'preparing';
    this.emit();
    try {
      const prepared = await this.invoke(intent, 'prepare', { model: state.settings.modelId })
        .result;
      if (!this.current(intent)) return fail('cancelled');
      if (!prepared.ok) throw new KernelFault(prepared.error.code);
      const data = object(prepared.value);
      if (!data || data['errorCode'])
        throw new KernelFault(
          isKernelErrorCode(data?.['errorCode']) ? data['errorCode'] : 'asr-failed',
        );
      this.#preparedModel = state.settings.modelId;
      return await new Promise<Result<DemoCaptureTicket>>((resolve) => {
        let answered = false;
        const answer = (value: Result<DemoCaptureTicket>) => {
          if (!answered) {
            answered = true;
            resolve(value);
          }
        };
        const task = this.host.tasks.run(
          intent.owner,
          async (context) => {
            const run = await this.host.permissions.run(
              intent.owner,
              context.taskId,
              { kind: 'microphone' },
              async (signal) => {
                if (!this.current(intent) || signal.aborted) throw new KernelFault('cancelled');
                let ended!: () => void;
                const finished = new Promise<void>((done) => {
                  ended = done;
                });
                const capture: Capture = {
                  token: randomUUID(),
                  intent,
                  frameId,
                  signal,
                  ended,
                  chunks: [],
                  sequence: 0,
                  samples: 0,
                  ready: false,
                  timer: setTimeout(() => {
                    if (this.#capture === capture) this.captureFailure(capture.token, 'failed');
                  }, 10000),
                };
                this.#capture = capture;
                this.#phase = 'arming';
                this.emit();
                const abort = () => {
                  if (this.#capture === capture) {
                    this.#capture = undefined;
                    clearTimeout(capture.timer);
                    ended();
                    this.#started = null;
                    if (this.current(intent)) {
                      this.#phase = 'idle';
                      this.emit();
                    }
                  }
                };
                signal.addEventListener('abort', abort, { once: true });
                answer({
                  ok: true,
                  value: {
                    token: capture.token,
                    sampleRate: 16000,
                    maxSamples: LOCAL_ASR_SAMPLE_RATE * LOCAL_ASR_MAX_SECONDS,
                    chunkSamples: 1600,
                  },
                });
                try {
                  await finished;
                  return null;
                } finally {
                  signal.removeEventListener('abort', abort);
                }
              },
              context.signal,
            );
            if (!run.ok) throw new KernelFault(run.error.code);
            return null;
          },
          { signal: intent.abort.signal, timeoutMs: 120000 },
        );
        if (!task.ok) {
          answer(task);
          return;
        }
        intent.tasks.add(task.value);
        void task.value.settled.then(() => {
          intent.tasks.delete(task.value);
          task.value.release();
        });
        void task.value.result.then((result) => {
          if (!result.ok) {
            answer(result);
            if (this.current(intent)) {
              if (result.error.code === 'cancelled') {
                this.#phase = 'idle';
                this.emit();
              } else this.error(result.error.code);
            }
          }
        });
        intent.abort.signal.addEventListener('abort', () => answer(fail('cancelled')), {
          once: true,
        });
      });
    } catch (error) {
      if (this.current(intent))
        this.error(error instanceof KernelFault ? error.error.code : 'asr-failed');
      return fail(error instanceof KernelFault ? error.error.code : 'asr-failed');
    }
  }
  microphoneAllowed(frameId: number): boolean {
    const capture = this.#capture;
    return (
      !!capture &&
      capture.frameId === frameId &&
      !capture.signal.aborted &&
      this.current(capture.intent)
    );
  }
  captureReady(token: string, frameId: number, sampleRate: number): Result<null> {
    const capture = this.#capture;
    if (!capture || capture.token !== token || !this.microphoneAllowed(frameId))
      return fail('permission-denied');
    if (sampleRate !== 16000 || capture.ready) return fail('audio-format');
    capture.ready = true;
    clearTimeout(capture.timer);
    capture.timer = setTimeout(
      () => {
        if (this.#capture === capture) this.captureFailure(capture.token, 'failed');
      },
      (LOCAL_ASR_MAX_SECONDS + 2) * 1000,
    );
    this.#phase = 'recording';
    this.#started = Date.now();
    this.emit();
    return { ok: true, value: null };
  }
  pushAudio(token: string, frameId: number, sequence: number, bytes: Uint8Array): Result<null> {
    const capture = this.#capture;
    if (!capture || capture.token !== token || !capture.ready || !this.microphoneAllowed(frameId))
      return fail('permission-denied');
    if (
      !Number.isSafeInteger(sequence) ||
      sequence !== capture.sequence ||
      !(bytes instanceof Uint8Array) ||
      !(bytes.buffer instanceof ArrayBuffer) ||
      bytes.byteLength < 4 ||
      bytes.byteLength > 6400 ||
      bytes.byteLength % 4 ||
      capture.samples + bytes.byteLength / 4 > 320000
    )
      return fail('invalid-input');
    const owned = Uint8Array.from(bytes),
      view = new DataView(owned.buffer);
    for (let i = 0; i < owned.length; i += 4) {
      const sample = view.getFloat32(i, true);
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) return fail('audio-format');
    }
    capture.chunks.push(owned);
    capture.samples += owned.byteLength / 4;
    capture.sequence++;
    return { ok: true, value: null };
  }
  finishRecording(token: string, frameId: number, frames: number): Result<null> {
    const capture = this.#capture;
    if (!capture || capture.token !== token || !capture.ready || !this.microphoneAllowed(frameId))
      return fail('permission-denied');
    if (frames !== capture.sequence) return fail('invalid-input');
    this.#capture = undefined;
    clearTimeout(capture.timer);
    capture.intent.audio = capture.chunks;
    capture.ended();
    this.#started = null;
    this.#phase = 'recognizing';
    this.emit();
    void this.runTurn(capture.intent, 'voice');
    return { ok: true, value: null };
  }
  captureFailure(token: string, reason: 'denied' | 'missing' | 'format' | 'failed'): Result<null> {
    if (this.#capture?.token !== token) return fail('not-ready');
    this.cancelCurrent();
    this.error(
      reason === 'denied'
        ? 'microphone-denied'
        : reason === 'missing'
          ? 'microphone-missing'
          : reason === 'format'
            ? 'audio-format'
            : 'unavailable',
    );
    return { ok: true, value: null };
  }
  async sendText(text: string, via: 'console' | 'bubble' = 'console'): Promise<Result<null>> {
    if (!text.trim() || [...text].length > 4000) return fail('invalid-input');
    const state = await this.snapshot();
    if (!state.canSend) return fail('not-ready');
    const intent = this.begin(state.settings, 'text');
    this.#phase = 'thinking';
    this.emit();
    void this.runTurn(intent, 'text', text.trim(), via);
    return { ok: true, value: null };
  }
  private async runTurn(
    intent: Intent,
    kind: 'voice' | 'text',
    text = '',
    via: 'console' | 'bubble' = 'console',
  ): Promise<void> {
    if (!this.current(intent)) return;
    const task = this.host.tasks.run(
      intent.owner,
      async (context) => {
        const call = this.invoke(intent, 'turn', {
          kind,
          via: kind === 'voice' ? 'voice' : via,
          model: intent.settings.modelId,
          mode: intent.settings.replyMode,
          autoSend: kind === 'text' || intent.settings.autoSend,
          text,
        });
        const abort = () => call.cancel();
        context.signal.addEventListener('abort', abort, { once: true });
        try {
          const response = await call.result;
          if (!this.current(intent) || context.signal.aborted) throw new KernelFault('cancelled');
          if (!response.ok) throw new KernelFault(response.error.code);
          const data = object(response.value);
          if (!data || typeof data['transcript'] !== 'string' || typeof data['reply'] !== 'string')
            throw new KernelFault('internal');
          if (kind === 'voice') this.#transcript = data['transcript'];
          if (data['errorCode'])
            throw new KernelFault(
              isKernelErrorCode(data['errorCode']) ? data['errorCode'] : 'internal',
            );
          if (!data['transcript']) throw new KernelFault('no-speech');
          if (kind === 'voice' && !intent.settings.autoSend) {
            this.#phase = 'idle';
            this.#partialTranscript = '';
            this.emit();
            return null;
          }
          await this.readMessages();
          if (this.current(intent)) {
            this.#partialReply = data['reply'];
            this.#partialTranscript = '';
            this.#phase = 'idle';
            this.emit();
          }
          return null;
        } finally {
          context.signal.removeEventListener('abort', abort);
          intent.audio = [];
        }
      },
      { signal: intent.abort.signal, timeoutMs: 180000 },
    );
    if (!task.ok) {
      if (this.current(intent)) this.error(task.error.code);
      return;
    }
    intent.tasks.add(task.value);
    void task.value.settled.then(() => {
      intent.tasks.delete(task.value);
      task.value.release();
    });
    const result = await task.value.result;
    if (!result.ok && this.current(intent)) {
      if (result.error.code === 'cancelled') {
        this.#phase = 'idle';
        this.emit();
      } else this.error(result.error.code);
    }
  }
  async clearHistory(): Promise<DemoSnapshot> {
    this.cancelCurrent();
    const cleared = object(await this.queryAgent('clear', null));
    if (cleared?.['errorCode']) throw new KernelFault('unavailable');
    this.#messages = [];
    this.#transcript = '';
    this.#phase = 'idle';
    this.#error = null;
    this.emit();
    return this.snapshot();
  }
  async saveKey(value: string): Promise<DemoSnapshot> {
    if (!this.host.credentials || this.host.manager.get(identity(ID.cloud))?.origin !== 'builtin')
      throw new KernelFault('not-ready');
    await this.host.credentials.setSecret(identity(ID.cloud), 'api-key', value);
    this.emit();
    return this.snapshot();
  }
  async removeKey(): Promise<DemoSnapshot> {
    if (!this.host.credentials) throw new KernelFault('not-ready');
    await this.host.credentials.deleteSecret(identity(ID.cloud), 'api-key');
    this.emit();
    return this.snapshot();
  }
  onVoiceDisabled(): void {
    if (this.#intent?.owner.pluginId === ID.voice || this.#capture) {
      this.cancelCurrent();
      this.#phase = 'idle';
      this.emit();
    }
  }
  onConsoleClosed(): void {
    if (this.#capture || this.#phase === 'preparing' || this.#phase === 'arming') {
      this.cancelCurrent();
      this.#phase = 'idle';
      this.emit();
    }
  }
  onAllStopped(): void {
    this.cancelCurrent();
    this.#phase = 'idle';
    this.#error = null;
    this.emit();
  }
  close(): void {
    this.#closing = true;
    this.cancelCurrent();
  }
}

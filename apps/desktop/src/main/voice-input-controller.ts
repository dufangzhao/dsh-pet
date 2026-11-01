import {
  APPLICATION_PLUGIN_IDS,
  DEFAULT_VOICE_INPUT_SETTINGS,
  TALK_KEYS,
  VOICE_INPUT_CLOUD_ORIGINS,
  VOICE_INPUT_ENGINES,
  VOICE_INPUT_LOCAL_MODELS,
  VOICE_INPUT_PLUGIN_IDS as ID,
  makeError,
  voiceInputModel,
  isKernelErrorCode,
  type VoiceInputSettings,
  type VoiceInputSnapshot,
  type VoiceInputEngine,
  type JsonObject,
  type JsonValue,
  type KernelError,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import {
  capabilityPermissionAuthorizer,
  exactKeys,
  record,
  KernelFault,
  type TaskHandle,
  type TaskMediaReference,
  type MediaReadEndpoint,
} from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import type { DemoController } from './demo-controller.js';
import type { DemoRequestSource } from './demo-request.js';
import { isTrustedPetSource } from './ipc-request.js';
import { admittedApplicationSource } from './application-admission.js';
import { modelPresent } from '../../../../plugins/asr-local/src/model-store.js';
import { installLocalModel } from '../../../../plugins/asr-local/src/model-install.js';
import { TalkKeyGesture } from '../../../../plugins/talk-key/src/gesture.js';
const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const object = (value: JsonValue) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const asError = (error: unknown): KernelError =>
  error instanceof KernelFault
    ? error.error
    : makeError(
        error instanceof Error && isKernelErrorCode(error.message) ? error.message : 'unavailable',
        false,
      );
export function voiceSettings(data: JsonObject): VoiceInputSettings {
  return {
    engine: VOICE_INPUT_ENGINES.includes(data['engine'] as VoiceInputEngine)
      ? (data['engine'] as VoiceInputEngine)
      : DEFAULT_VOICE_INPUT_SETTINGS.engine,
    microphoneId: typeof data['microphoneId'] === 'string' ? data['microphoneId'] : '',
    talkKeyCode:
      typeof data['talkKeyCode'] === 'string'
        ? data['talkKeyCode']
        : DEFAULT_VOICE_INPUT_SETTINGS.talkKeyCode,
    talkKeyLabel:
      TALK_KEYS[String(data['talkKeyCode'] ?? DEFAULT_VOICE_INPUT_SETTINGS.talkKeyCode)]?.label ??
      DEFAULT_VOICE_INPUT_SETTINGS.talkKeyLabel,
    cloudModel:
      typeof data['cloudModel'] === 'string'
        ? data['cloudModel']
        : DEFAULT_VOICE_INPUT_SETTINGS.cloudModel,
    cloudBaseUrl:
      typeof data['cloudBaseUrl'] === 'string'
        ? data['cloudBaseUrl']
        : DEFAULT_VOICE_INPUT_SETTINGS.cloudBaseUrl,
  };
}
export class VoiceInputController {
  #keyTask: TaskHandle | undefined;
  #install: TaskHandle | undefined;
  #gesture = new TalkKeyGesture();
  #listening = false;
  #closing = false;
  #error: KernelError | null = null;
  #download: VoiceInputSnapshot['download'] = null;
  #busy = false;
  #activation: AbortController | undefined;
  #sapiReady = false;
  constructor(
    private readonly host: DesktopHost,
    private readonly modelRoot: string,
    private readonly demo: DemoController,
    private readonly changed: () => void,
    private readonly isEnabled: (id: string) => boolean = () => true,
    private readonly setVoiceEnabled?: (enabled: boolean) => Promise<Result<unknown>>,
  ) {}
  async snapshot(): Promise<VoiceInputSnapshot> {
    const config = await this.host.configs.get(identity(ID.voice));
    if (!config.ok) throw new KernelFault(config.error.code);
    const settings = voiceSettings(config.value.data);
    const models = await Promise.all(
      VOICE_INPUT_LOCAL_MODELS.filter(
        (model) => model.id !== 'streaming-paraformer-zh-en-int8',
      ).map(async (model) => ({
        id: model.id,
        label: model.name,
        cached: await modelPresent(this.modelRoot, model.id),
        bytes: model.files.reduce((sum, file) => sum + file.bytes, 0),
      })),
    );
    const keyConfigured =
      (await this.host.credentials?.hasSecret(identity(ID.cloud), 'api-key')) === true;
    const profile = await this.host.configs.get(identity(APPLICATION_PLUGIN_IDS.profile));
    const featureEnabled = profile.ok && profile.value.data['voiceEnabled'] === true;
    const local = (engine: VoiceInputEngine) =>
      models.some((model) => model.id === voiceInputModel(engine) && model.cached);
    const active = (id: string) => {
      const row = this.host.manager.get(identity(id));
      return !!row && this.host.manager.isActive(row.owner);
    };
    return {
      version: 1,
      revision: config.value.revision,
      settings,
      models,
      engines: [
        {
          id: 'sensevoice',
          label: 'FunASR / SenseVoice',
          available: local('sensevoice'),
          reason: local('sensevoice') ? null : '需要下载本地模型',
        },
        {
          id: 'whisper-small',
          label: 'Whisper Small',
          available: local('whisper-small'),
          reason: local('whisper-small') ? null : '需要下载固定 Small 模型',
        },
        {
          id: 'windows-sapi',
          label: 'Windows SAPI',
          available: this.#sapiReady,
          reason: this.#sapiReady
            ? null
            : process.platform === 'win32'
              ? '启动时检测 Windows 已安装的语音识别器'
              : '仅支持 Windows',
        },
        {
          id: 'openai',
          label: 'OpenAI 兼容转写',
          available: keyConfigured && !!this.host.credentials,
          reason: keyConfigured ? '录音完成后才会实际调用 API，尚未验证连接' : '需要保存 API Key',
        },
      ],
      active:
        featureEnabled &&
        active(ID.voice) &&
        active(settings.engine === 'openai' ? ID.cloud : ID.local),
      talkKeyActive: this.#listening,
      keyConfigured,
      credentialStorageAvailable: !!this.host.credentials,
      download: this.#download,
      error: this.#error,
    };
  }
  private async enable(id: string): Promise<void> {
    const row = this.host.manager.get(identity(id)),
      review = row ? this.host.describeTrust(row.owner) : null,
      source = row ? this.host.getPackage(row.owner) : null;
    if (!row || !review || !source) throw new KernelFault('not-ready');
    if (!admittedApplicationSource(source) && !review.trusted)
      throw new KernelFault('package-changed');
    if (!(await this.host.verifyTrust(row.owner, review.digest)))
      throw new KernelFault('package-changed');
    if (!this.host.permissionControl.confirmTrust(identity(id), review.digest, true))
      throw new KernelFault('permission-denied');
    if (this.host.permissionControl.inspect(identity(id))?.preset === 'deny')
      throw new KernelFault('permission-denied');
    if (this.host.manager.isActive(row.owner)) return;
    const config = await this.host.configs.get(identity(id));
    if (!config.ok) throw new KernelFault(config.error.code);
    const enabled = await this.host.manager.enable(identity(id), config.value.data);
    if (!enabled.ok || enabled.value.state !== 'active')
      throw new KernelFault(enabled.ok ? 'not-ready' : enabled.error.code);
  }
  private stopKey(): void {
    const task = this.#keyTask;
    this.#keyTask = undefined;
    this.#listening = false;
    this.#gesture.reset();
    task?.cancel();
  }
  private async listen(settings: VoiceInputSettings, signal: AbortSignal): Promise<void> {
    this.stopKey();
    await this.enable(ID.talkKey);
    const row = this.host.manager.get(identity(ID.talkKey));
    if (!row) throw new KernelFault('not-ready');
    const selected = this.host.manager.select(identity(ID.talkKey), 'input.talkKey@1', {
      ...identity(ID.talkKey),
      providerId: 'keyboard',
    });
    if (!selected.ok) throw new KernelFault(selected.error.code);
    const signals = [ID.voice, settings.engine === 'openai' ? ID.cloud : ID.local]
      .map((id) => {
        const entry = this.host.manager.get(identity(id));
        return entry ? this.host.manager.signal(entry.owner) : null;
      })
      .filter((signal): signal is AbortSignal => signal !== null);
    const started = this.host.tasks.invokeCapability(
      this.host.manager,
      row.owner,
      'input.talkKey@1',
      'listen',
      { code: settings.talkKeyCode },
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { signal: AbortSignal.any([...signals, signal]) },
    );
    if (!started.ok) throw new KernelFault(started.error.code);
    const task = started.value;
    this.#keyTask = task;
    void task.result
      .then((result) => {
        if (this.#keyTask !== task) return;
        this.#keyTask = undefined;
        this.#listening = false;
        this.#gesture.reset();
        this.demo.onVoiceDisabled();
        const body = result.ok ? object(result.value) : null;
        if (!this.#closing)
          this.#error =
            result.ok && body?.['errorCode'] && isKernelErrorCode(body['errorCode'])
              ? makeError(body['errorCode'], false)
              : result.ok
                ? null
                : result.error;
        this.changed();
      })
      .finally(() => task.release());
  }
  /** Returns false for another workstream's media; the Main router retains ownership then. */
  output(reference: TaskMediaReference, reader: MediaReadEndpoint): boolean {
    const task = this.#keyTask;
    if (!task || reference.taskId !== task.taskId || reference.owner.pluginId !== ID.talkKey)
      return false;
    const row = this.host.manager.get(identity(ID.talkKey));
    if (
      !row ||
      row.owner.generation !== reference.owner.generation ||
      row.owner.instanceId !== reference.owner.instanceId
    ) {
      reader.cancel();
      return true;
    }
    this.#listening = true;
    this.changed();
    void (async () => {
      try {
        for await (const bytes of reader) {
          if (this.#keyTask !== task || this.#closing) break;
          if (bytes.length > 512) throw new KernelFault('invalid-input');
          const body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
          if (
            !body ||
            !exactKeys(body, ['kind', 'at']) ||
            (body['kind'] !== 'down' && body['kind'] !== 'up') ||
            typeof body['at'] !== 'number' ||
            !Number.isFinite(body['at'])
          )
            throw new KernelFault('invalid-input');
          const action = this.#gesture.event(body['kind'], body['at']);
          if (action) {
            const result = await this.demo.requestRecording({ action });
            if (!result.ok) {
              this.#error = result.error;
              this.#gesture.reset();
              this.changed();
            }
          }
        }
      } catch (error) {
        if (this.#keyTask === task) {
          this.#error = asError(error);
          this.stopKey();
          this.demo.onVoiceDisabled();
          this.changed();
        }
      } finally {
        reader.cancel();
      }
    })();
    return true;
  }
  private async prepare(settings: VoiceInputSettings, signal: AbortSignal): Promise<void> {
    const row = this.host.manager.get(identity(ID.voice));
    if (!row) throw new KernelFault('not-ready');
    for (const [capability, pluginId, providerId] of [
      ['chat.session@1', ID.voice, 'voice'],
      [
        'speech.asr@1',
        settings.engine === 'openai' ? ID.cloud : ID.local,
        settings.engine === 'openai' ? 'openai' : 'local',
      ],
    ]) {
      if (!capability || !pluginId || !providerId) continue;
      const selected = this.host.manager.select(identity(ID.voice), capability, {
        pluginId,
        instanceId: 'default',
        providerId,
      });
      if (!selected.ok) throw new KernelFault(selected.error.code);
    }
    const started = this.host.tasks.invokeCapability(
      this.host.manager,
      row.owner,
      'chat.session@1',
      'prepare',
      {
        model: voiceInputModel(settings.engine),
        cloudModel: settings.cloudModel,
        cloudBaseUrl: settings.cloudBaseUrl,
      },
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { timeoutMs: 120000, signal },
    );
    if (!started.ok) throw new KernelFault(started.error.code);
    try {
      const done = await started.value.result;
      if (!done.ok) throw new KernelFault(done.error.code);
      const data = object(done.value);
      if (!data || data['errorCode'])
        throw new KernelFault(
          isKernelErrorCode(data?.['errorCode']) ? data['errorCode'] : 'asr-failed',
        );
      if (settings.engine === 'windows-sapi') this.#sapiReady = true;
    } finally {
      started.value.release();
    }
  }
  async start(): Promise<Result<VoiceInputSnapshot>> {
    return this.activate(true);
  }
  private async activate(updateFeature: boolean): Promise<Result<VoiceInputSnapshot>> {
    if (this.#busy || this.#closing) return fail('not-ready');
    this.#busy = true;
    this.#activation?.abort();
    const activation = new AbortController();
    this.#activation = activation;
    try {
      if (updateFeature && this.setVoiceEnabled) {
        const saved = await this.setVoiceEnabled(true);
        if (!saved.ok) throw new KernelFault(saved.error.code);
      }
      activation.signal.throwIfAborted();
      const profile = await this.host.configs.get(identity(APPLICATION_PLUGIN_IDS.profile));
      if (!profile.ok || profile.value.data['voiceEnabled'] !== true)
        throw new KernelFault('not-ready');
      const config = await this.host.configs.get(identity(ID.voice));
      if (!config.ok) return config;
      const settings = voiceSettings(config.value.data);
      await this.enable(settings.engine === 'openai' ? ID.cloud : ID.local);
      await this.enable(ID.voice);
      activation.signal.throwIfAborted();
      await this.prepare(settings, activation.signal);
      activation.signal.throwIfAborted();
      this.#error = null;
      await this.listen(settings, activation.signal);
      await this.demo.refreshModels(this.modelRoot);
      activation.signal.throwIfAborted();
      this.changed();
      return { ok: true, value: await this.snapshot() };
    } catch (error) {
      if (activation.signal.aborted) return fail('cancelled');
      this.#error = asError(error);
      this.changed();
      return { ok: false, error: this.#error };
    } finally {
      this.#busy = false;
    }
  }
  async stop(): Promise<Result<VoiceInputSnapshot>> {
    this.#activation?.abort();
    this.stopKey();
    this.demo.onVoiceDisabled();
    if (!this.setVoiceEnabled) return fail('not-ready');
    const saved = await this.setVoiceEnabled(false);
    if (!saved.ok) {
      this.#error = saved.error;
      this.changed();
      return saved;
    }
    this.#error = null;
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  async saveSettings(
    expectedRevision: number,
    data: VoiceInputSettings,
  ): Promise<Result<VoiceInputSnapshot>> {
    if (this.#busy || this.#closing) return fail('not-ready');
    const config = await this.host.configs.get(identity(ID.voice));
    if (!config.ok) return config;
    if (config.value.revision !== expectedRevision) return fail('conflict');
    const saved = await this.host.configs.save(
      identity(ID.voice),
      { ...config.value.data, ...data, talkKeyLabel: TALK_KEYS[data.talkKeyCode]?.label ?? '' },
      expectedRevision,
    );
    if (!saved.ok) return saved;
    const running = !!this.#keyTask;
    this.stopKey();
    this.demo.onVoiceDisabled();
    this.#error = null;
    if (running) {
      const started = await this.start();
      if (!started.ok) return started;
    }
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  async saveApiKey(value: string): Promise<Result<VoiceInputSnapshot>> {
    if (!this.host.credentials) return fail('unavailable');
    try {
      if (value.trim())
        await this.host.credentials.setSecret(identity(ID.cloud), 'api-key', value.trim());
      else await this.host.credentials.deleteSecret(identity(ID.cloud), 'api-key');
      this.#error = null;
      this.changed();
      return { ok: true, value: await this.snapshot() };
    } catch (error) {
      this.#error = asError(error);
      this.changed();
      return { ok: false, error: this.#error };
    }
  }
  async installModel(modelId: string): Promise<Result<VoiceInputSnapshot>> {
    if (this.#install || this.#closing) return fail('not-ready');
    const model = VOICE_INPUT_LOCAL_MODELS.find((model) => model.id === modelId);
    if (!model) return fail('invalid-input');
    try {
      await this.enable(ID.local);
      const row = this.host.manager.get(identity(ID.local));
      if (!row) throw new KernelFault('not-ready');
      const total = model.files.reduce((sum, file) => sum + file.bytes, 0);
      this.#download = {
        modelId,
        receivedBytes: 0,
        totalBytes: total,
        state: 'downloading',
        error: null,
      };
      this.#error = null;
      const started = this.host.tasks.run(
        row.owner,
        async (context) => {
          const files = await this.host.permissions.run(
            row.owner,
            context.taskId,
            { kind: 'files', scope: 'resources', access: 'write' },
            async (fileSignal) => {
              const network = await this.host.permissions.run(
                row.owner,
                context.taskId,
                {
                  kind: 'network',
                  origins: [...new Set(model.files.map((file) => new URL(file.url).origin))],
                },
                async (signal) => {
                  let published = 0;
                  try {
                    await installLocalModel(this.modelRoot, modelId, signal, (received, total) => {
                      this.#download = {
                        modelId,
                        receivedBytes: received,
                        totalBytes: total,
                        state: 'downloading',
                        error: null,
                      };
                      const now = performance.now();
                      if (now - published > 100 || received === total) {
                        published = now;
                        this.changed();
                      }
                    });
                  } catch (error) {
                    throw new KernelFault(signal.aborted ? 'cancelled' : asError(error).code);
                  }
                  return null;
                },
                fileSignal,
              );
              if (!network.ok) throw new KernelFault(network.error.code);
              return null;
            },
            context.signal,
          );
          if (!files.ok) throw new KernelFault(files.error.code);
          return null;
        },
        { timeoutMs: 600000 },
      );
      if (!started.ok) throw new KernelFault(started.error.code);
      const task = started.value;
      this.#install = task;
      void task.result
        .then(async (done) => {
          if (this.#install !== task) return;
          this.#install = undefined;
          this.#download = {
            modelId,
            receivedBytes: this.#download?.receivedBytes ?? 0,
            totalBytes: total,
            state: done.ok ? 'complete' : 'error',
            error: done.ok ? null : done.error,
          };
          if (!done.ok) this.#error = done.error;
          await this.demo.refreshModels(this.modelRoot);
          this.changed();
        })
        .finally(() => task.release());
      this.changed();
      return { ok: true, value: await this.snapshot() };
    } catch (error) {
      this.#error = asError(error);
      this.#download = {
        modelId,
        receivedBytes: 0,
        totalBytes: model.files.reduce((sum, file) => sum + file.bytes, 0),
        state: 'error',
        error: this.#error,
      };
      this.changed();
      return { ok: false, error: this.#error };
    }
  }
  async restore(): Promise<void> {
    if (!this.isEnabled(ID.voice) || !this.isEnabled(ID.talkKey)) return;
    const config = await this.host.configs.get(identity(ID.voice));
    if (!config.ok) return;
    const selected = voiceSettings(config.value.data).engine === 'openai' ? ID.cloud : ID.local;
    if (!this.isEnabled(selected)) return;
    const profile = await this.host.configs.get(identity(APPLICATION_PLUGIN_IDS.profile));
    if (profile.ok && profile.value.data['voiceEnabled'] === true) await this.activate(false);
  }
  onVoiceDisabled(): void {
    this.#activation?.abort();
    this.stopKey();
    this.demo.onVoiceDisabled();
    this.changed();
  }
  close(): void {
    this.#closing = true;
    this.#activation?.abort();
    this.stopKey();
    this.#install?.cancel();
    this.demo.onVoiceDisabled();
  }
}
export async function handleVoiceInputRequest(
  source: DemoRequestSource,
  action: 'snapshot' | 'saveSettings' | 'saveApiKey' | 'start' | 'stop' | 'installModel',
  args: readonly unknown[],
  controller: VoiceInputController,
): Promise<Result<VoiceInputSnapshot>> {
  if (!isTrustedPetSource(source) || (source.role !== 'console' && action !== 'snapshot'))
    return fail('permission-denied');
  try {
    if (['snapshot', 'start', 'stop'].includes(action)) {
      if (args.length !== 0) return fail('invalid-input');
      return action === 'snapshot'
        ? { ok: true, value: await controller.snapshot() }
        : action === 'start'
          ? await controller.start()
          : await controller.stop();
    }
    if (args.length !== 1) return fail('invalid-input');
    const checked = jsonPreflight(args[0]),
      body = checked.ok ? record(checked.value) : null;
    if (!body) return fail('invalid-input');
    if (action === 'saveApiKey')
      return exactKeys(body, ['value']) &&
        typeof body['value'] === 'string' &&
        body['value'].length <= 4096 &&
        ![...body['value']].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        ? await controller.saveApiKey(body['value'])
        : fail('invalid-input');
    if (action === 'installModel')
      return exactKeys(body, ['modelId']) && typeof body['modelId'] === 'string'
        ? await controller.installModel(body['modelId'])
        : fail('invalid-input');
    const data = record(body['data'] ?? null);
    if (
      !exactKeys(body, ['expectedRevision', 'data']) ||
      !Number.isSafeInteger(body['expectedRevision']) ||
      (body['expectedRevision'] as number) < 0 ||
      !data ||
      !exactKeys(data, [
        'engine',
        'microphoneId',
        'talkKeyCode',
        'talkKeyLabel',
        'cloudModel',
        'cloudBaseUrl',
      ]) ||
      !VOICE_INPUT_ENGINES.includes(data['engine'] as VoiceInputEngine) ||
      typeof data['microphoneId'] !== 'string' ||
      data['microphoneId'].length > 512 ||
      typeof data['talkKeyCode'] !== 'string' ||
      !Object.hasOwn(TALK_KEYS, data['talkKeyCode']) ||
      typeof data['talkKeyLabel'] !== 'string' ||
      data['talkKeyLabel'].length > 32 ||
      typeof data['cloudModel'] !== 'string' ||
      !/^[a-zA-Z0-9._:/-]{1,128}$/.test(data['cloudModel']) ||
      typeof data['cloudBaseUrl'] !== 'string' ||
      data['cloudBaseUrl'].length > 512
    )
      return fail('invalid-input');
    let url: URL;
    try {
      url = new URL(data['cloudBaseUrl']);
    } catch {
      return fail('invalid-input');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !VOICE_INPUT_CLOUD_ORIGINS.some((origin) => url.origin === origin)
    )
      return fail('permission-denied');
    return await controller.saveSettings(
      body['expectedRevision'] as number,
      { ...data, cloudBaseUrl: url.href.replace(/\/$/, '') } as unknown as VoiceInputSettings,
    );
  } catch (error) {
    return { ok: false, error: asError(error) };
  }
}

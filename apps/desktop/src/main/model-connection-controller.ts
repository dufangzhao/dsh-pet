import type { ModelOAuth } from './model-oauth.js';
import {
  APPLICATION_PLUGIN_IDS as APP,
  DEMO_PLUGIN_IDS as ID,
  MODEL_SERVICE_ENDPOINTS,
  modelProviderId,
  modelService,
  ERROR_MESSAGES,
  makeError,
  type ModelConnectionSnapshot,
  type ModelConnectionOutcome,
  type JsonObject,
  type JsonValue,
  type Result,
} from '@pet/contracts';
import { capabilityPermissionAuthorizer, KernelFault } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import type { ApplicationController } from './application-controller.js';
import { admittedApplicationSource } from './application-admission.js';
const identity = { pluginId: ID.cloud, instanceId: 'default' };
const object = (value: JsonValue | undefined): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
export class ModelConnectionController {
  #busy = false;
  #restoreNotice: string | null = null;
  auth: ModelOAuth | null = null;
  close(): void {
    this.auth?.close();
  }
  constructor(
    private readonly host: DesktopHost,
    private readonly application: ApplicationController,
    private readonly changed: () => void,
    private readonly openExternal: (url: string) => Promise<void>,
  ) {}
  async snapshot(): Promise<ModelConnectionSnapshot> {
    const cfg = await this.host.configs.get(identity);
    if (!cfg.ok) throw new KernelFault(cfg.error.code);
    const models = object(cfg.value.data['models']);
    const endpoints = await Promise.all(
      MODEL_SERVICE_ENDPOINTS.filter((e) => e.available).map(async (e) => ({
        id: e.id,
        model:
          e.id === 'deepseek' && typeof cfg.value.data['model'] === 'string'
            ? cfg.value.data['model']
            : typeof models?.[e.id] === 'string'
              ? (models[e.id] as string)
              : e.defaultModel,
        keyConfigured: (await this.host.credentials?.hasSecret(identity, e.secretKey)) === true,
      })),
    );
    const activeId = typeof cfg.value.data['active'] === 'string' ? cfg.value.data['active'] : '';
    const active = endpoints.find((e) => e.id === activeId && e.keyConfigured);
    const entry = this.host.manager.get(identity);
    const running = !!entry && this.host.manager.isActive(entry.owner);
    const state = await this.application.agent('state', null);
    return {
      revision: cfg.value.revision,
      ...(this.#restoreNotice ? { notice: this.#restoreNotice } : {}),
      services: MODEL_SERVICE_ENDPOINTS.map(
        ({ baseUrl: _baseUrl, protocol: _protocol, secretKey: _secretKey, ...publicValue }) => ({
          ...publicValue,
          available:
            publicValue.available && (publicValue.auth !== 'browser' || this.auth !== null),
        }),
      ),
      endpoints,
      active:
        active && running
          ? { id: active.id, model: active.model, label: modelService(active.id)!.label }
          : null,
      paused: state.ok && object(state.value)?.['paused'] === true,
      credentialStorageAvailable: !!this.host.credentials,
    };
  }
  async restore(): Promise<void> {
    const cfg = await this.host.configs.get(identity);
    if (!cfg.ok) throw new KernelFault(cfg.error.code);
    const id = cfg.value.data['active'];
    const endpoint = typeof id === 'string' ? modelService(id) : null;
    if (
      !endpoint ||
      this.application.pluginWasDisabled(ID.cloud) ||
      !this.host.manager.get(identity)
    )
      return;
    try {
      await this.enable();
      this.host.manager.capabilities.select(
        { pluginId: APP.agent, instanceId: 'default' },
        'llm.responses@1',
        { ...identity, providerId: modelProviderId(endpoint.id) },
      );
      this.#restoreNotice = null;
      this.changed();
    } catch (error) {
      this.#restoreNotice =
        error instanceof KernelFault
          ? ERROR_MESSAGES[error.error.code]
          : '模型服务暂未启动，请重新连接';
      this.changed();
    }
  }
  private async enable(): Promise<void> {
    const row = this.host.manager.get(identity);
    const source = row ? this.host.getPackage(row.owner) : null;
    const review = row ? this.host.describeTrust(row.owner) : null;
    if (!row || !source || !review) throw new KernelFault('not-ready');
    if (!admittedApplicationSource(source) && !review.trusted)
      throw new KernelFault('package-changed');
    if (!(await this.host.verifyTrust(row.owner, review.digest)))
      throw new KernelFault('package-changed');
    this.host.permissionControl.confirmTrust(identity, review.digest, true);
    const cfg = await this.host.configs.get(identity);
    if (!cfg.ok) throw new KernelFault(cfg.error.code);
    if (!this.host.manager.isActive(row.owner)) {
      const enabled = await this.host.manager.enable(identity, cfg.value.data);
      if (!enabled.ok || enabled.value.state !== 'active')
        throw new KernelFault(enabled.ok ? 'not-ready' : enabled.error.code);
    }
  }
  private async probe(id: string, chooseModel = false): Promise<ModelConnectionOutcome['test']> {
    const row = this.host.manager.get(identity);
    if (!row || !this.host.manager.isActive(row.owner)) throw new KernelFault('not-ready');
    this.host.manager.capabilities.select(identity, 'llm.responses@1', {
      ...identity,
      providerId: modelProviderId(id),
    });
    const started = this.host.tasks.invokeCapability(
      this.host.manager,
      row.owner,
      'llm.responses@1',
      'test',
      chooseModel ? { chooseModel: true } : null,
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { timeoutMs: 60000 },
    );
    if (!started.ok) throw new KernelFault(started.error.code);
    try {
      const result = await started.value.result;
      if (!result.ok)
        return { ok: false, elapsedMs: null, reason: ERROR_MESSAGES[result.error.code] };
      const data = object(result.value);
      if (typeof data?.['errorCode'] === 'string')
        return {
          ok: false,
          elapsedMs: null,
          reason:
            ERROR_MESSAGES[data['errorCode'] as keyof typeof ERROR_MESSAGES] ?? '连接测试没有完成',
        };
      return {
        ok: data?.['ok'] === true,
        elapsedMs: typeof data?.['elapsedMs'] === 'number' ? data['elapsedMs'] : null,
        ...(typeof data?.['reason'] === 'string'
          ? {
              reason: Object.hasOwn(ERROR_MESSAGES, data['reason'])
                ? ERROR_MESSAGES[data['reason'] as keyof typeof ERROR_MESSAGES]
                : data['reason'],
            }
          : {}),
        ...(typeof data?.['model'] === 'string' &&
        data['model'].length > 0 &&
        data['model'].length <= 128
          ? { model: data['model'] }
          : {}),
      };
    } finally {
      started.value.release();
    }
  }
  async saveAndStart(
    id: string,
    model: string,
    expectedRevision: number,
    key?: string,
  ): Promise<Result<ModelConnectionOutcome>> {
    if (this.#busy) return { ok: false, error: makeError('not-ready', false) };
    const endpoint = modelService(id);
    if (!endpoint?.available) return { ok: false, error: makeError('not-ready', false) };
    this.#busy = true;
    this.#restoreNotice = null;
    try {
      const cfg = await this.host.configs.get(identity);
      if (!cfg.ok) return cfg;
      if (cfg.value.revision !== expectedRevision)
        return { ok: false, error: makeError('conflict', false) };
      if (!this.host.credentials) throw new KernelFault('unavailable');
      if (
        endpoint.auth === 'browser' &&
        (key !== undefined || !this.auth || !(await this.auth.state()).signedIn)
      )
        throw new KernelFault('not-ready');
      const secret = key?.trim();
      if (!secret && !(await this.host.credentials.hasSecret(identity, endpoint.secretKey)))
        throw new KernelFault('invalid-input');
      const previous = object(cfg.value.data['models']);
      const selected =
        model.trim() ||
        (typeof previous?.[id] === 'string' ? (previous[id] as string) : endpoint.defaultModel);
      const saved = await this.host.configs.save(
        identity,
        {
          ...cfg.value.data,
          models: { ...previous, [id]: selected },
          ...(id === 'deepseek' ? { model: selected } : {}),
        },
        expectedRevision,
      );
      if (!saved.ok) return saved;
      if (secret) await this.host.credentials.setSecret(identity, endpoint.secretKey, secret);
      await this.enable();
      const test = await this.probe(id, endpoint.auth === 'browser');
      if (test.ok) {
        const current = await this.host.configs.get(identity);
        if (!current.ok) throw new KernelFault(current.error.code);
        if (current.value.revision !== saved.value.snapshot.revision)
          throw new KernelFault('conflict');
        const activated = await this.host.configs.save(
          identity,
          {
            ...current.value.data,
            active: id,
            ...(test.model
              ? { models: { ...object(current.value.data['models']), [id]: test.model } }
              : {}),
          },
          current.value.revision,
        );
        if (!activated.ok) throw new KernelFault(activated.error.code);
        this.host.manager.capabilities.select(
          { pluginId: APP.agent, instanceId: 'default' },
          'llm.responses@1',
          { ...identity, providerId: modelProviderId(id) },
        );
        const voice = { pluginId: ID.voice, instanceId: 'default' };
        const mode = await this.host.configs.get(voice);
        if (!mode.ok) throw new KernelFault(mode.error.code);
        const updated = await this.host.configs.save(
          voice,
          { ...mode.value.data, mode: 'deepseek' },
          mode.value.revision,
        );
        if (!updated.ok) throw new KernelFault(updated.error.code);
        const resumed = await this.application.agent('run', { action: 'resume' });
        if (!resumed.ok) throw new KernelFault(resumed.error.code);
      }
      this.changed();
      return { ok: true, value: { snapshot: await this.snapshot(), test } };
    } finally {
      this.#busy = false;
    }
  }
  async testConnection(): Promise<Result<ModelConnectionOutcome>> {
    if (this.#busy) return { ok: false, error: makeError('not-ready', false) };
    const state = await this.snapshot();
    if (!state.active) return { ok: false, error: makeError('not-ready', false) };
    this.#busy = true;
    try {
      return { ok: true, value: { snapshot: state, test: await this.probe(state.active.id) } };
    } finally {
      this.#busy = false;
    }
  }
  async startSignIn() {
    if (!this.auth) throw new KernelFault('not-ready');
    return { ok: true as const, value: await this.auth.start() };
  }
  async getSignInState() {
    if (!this.auth) throw new KernelFault('not-ready');
    return { ok: true as const, value: await this.auth.state() };
  }
  async cancelSignIn() {
    if (!this.auth) throw new KernelFault('not-ready');
    this.auth.cancel();
    return { ok: true as const, value: await this.auth.state() };
  }
  async setPaused(paused: boolean): Promise<Result<ModelConnectionSnapshot>> {
    const result = await this.application.agent('run', { action: paused ? 'pause' : 'resume' });
    if (!result.ok) return result;
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  async openServicePage(id: string): Promise<Result<null>> {
    const endpoint = modelService(id);
    if (!endpoint) return { ok: false, error: makeError('invalid-input', false) };
    await this.openExternal(endpoint.keyUrl);
    return { ok: true, value: null };
  }
}

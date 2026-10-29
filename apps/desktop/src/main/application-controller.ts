import { ApplicationUpdateDialogs, type ApplicationUpdateAdapter } from './application-updates.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  APPLICATION_PLUGIN_IDS as ID,
  ERROR_MESSAGES,
  DEMO_PLUGIN_IDS,
  makeError,
  type Result,
  type JsonValue,
  type JsonObject,
  type OwnerRef,
  type ApplicationSnapshot,
  type ApplicationProfile,
  type ApplicationPreferences,
  type ApplicationDialog,
  type ApplicationPromptState,
  type ApplicationPromptSegment,
  type ApplicationInteraction,
  type ApplicationHistoryPage,
} from '@pet/contracts';
import {
  FileConfigStore,
  KernelFault,
  capabilityPermissionAuthorizer,
  type StoredConfig,
} from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import type { DemoController } from './demo-controller.js';
import { applicationPages } from './application-pages.js';
import { admittedApplicationSource, startApplicationPlugins } from './application-admission.js';
const identity = { pluginId: 'host.application-state', instanceId: 'default' };
const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
const object = (value: JsonValue): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
interface Flow {
  id: string;
  step: string;
  busy: boolean;
  error?: string;
  revision: number;
}
export class ApplicationController {
  desktopStatus = (): { available: boolean; shown: boolean } => ({
    available: false,
    shown: false,
  });
  #flow: Flow | null = null;
  #closed = false;
  #attachedGeneration: number | null = null;
  readonly updates: ApplicationUpdateDialogs;
  #removeApproval: () => void;
  private constructor(
    readonly host: DesktopHost,
    private readonly demo: DemoController,
    private readonly store: FileConfigStore,
    private record: StoredConfig,
    private readonly changed: () => void,
    private readonly applyPreferences: (preferences: Readonly<ApplicationPreferences>) => void,
  ) {
    this.#removeApproval = host.approvals.subscribe(changed);
    this.updates = new ApplicationUpdateDialogs(changed);
  }
  static async create(
    host: DesktopHost,
    demo: DemoController,
    directory: string,
    changed: () => void,
    applyPreferences: (preferences: Readonly<ApplicationPreferences>) => void,
  ): Promise<ApplicationController> {
    const root = path.join(directory, 'host-settings');
    await fs.mkdir(root, { recursive: true });
    const store = new FileConfigStore(root);
    let record = await store.read(identity);
    if (!record) {
      record = {
        format: 1,
        ...identity,
        schemaVersion: 1,
        revision: 1,
        data: { guideStep: 'welcome', completed: false, deferred: false, disabled: [] },
      };
      if (!(await store.compareAndSet(identity, null, record)))
        throw new Error('Application state unavailable');
    }
    const guideStep = record.data['guideStep'];
    if (
      record.schemaVersion !== 1 ||
      typeof guideStep !== 'string' ||
      !['welcome', 'name', 'appearance', 'voice', 'provider', 'key', 'done'].includes(guideStep) ||
      typeof record.data['completed'] !== 'boolean' ||
      typeof record.data['deferred'] !== 'boolean' ||
      !Array.isArray(record.data['disabled']) ||
      record.data['disabled'].length > 256 ||
      !record.data['disabled'].every((v) => typeof v === 'string' && v.length <= 128)
    )
      throw new Error('Application state unavailable');
    const controller = new ApplicationController(
      host,
      demo,
      store,
      record,
      changed,
      applyPreferences,
    );
    await startApplicationPlugins(
      host,
      (id) => !(record!.data['disabled'] as string[]).includes(id),
    );
    await controller.attachIfActive();
    const profile = await controller.profile();
    if (profile) applyPreferences(profile.data);
    if (!record.data['completed'] && !record.data['deferred'])
      controller.#flow = {
        id: randomUUID(),
        step: guideStep as string,
        busy: false,
        revision: profile?.revision ?? 0,
      };
    return controller;
  }
  close(): void {
    this.#closed = true;
    this.#flow = null;
    this.#removeApproval();
    this.updates.close();
  }
  async refreshPreferences(): Promise<void> {
    if (this.#closed) return;
    const profile = await this.profile();
    if (profile) {
      if (!profile.data.voiceEnabled) this.demo.onVoiceDisabled();
      this.applyPreferences(profile.data);
    }
    this.changed();
  }
  bindUpdater(adapter: ApplicationUpdateAdapter): void {
    this.updates.bind(adapter);
  }
  private async persist(patch: JsonObject): Promise<void> {
    const next: StoredConfig = {
      ...this.record,
      revision: this.record.revision + 1,
      data: { ...this.record.data, ...patch },
    };
    if (!(await this.store.compareAndSet(identity, this.record.revision, next)))
      throw new KernelFault('conflict');
    this.record = next;
  }
  private async attachIfActive(): Promise<void> {
    const row = this.host.manager.get({ pluginId: ID.agent, instanceId: 'default' });
    if (
      !row ||
      !this.host.manager.isActive(row.owner) ||
      this.#attachedGeneration === row.owner.generation
    )
      return;
    const migrate = this.record.data['legacyMigrated'] !== true;
    await this.demo.attachAgent(migrate);
    if (migrate) await this.persist({ legacyMigrated: true });
    this.#attachedGeneration = row.owner.generation;
  }
  pluginWasDisabled(id: string): boolean {
    return (this.record.data['disabled'] as string[]).includes(id);
  }
  async recordPluginStates(): Promise<void> {
    if (this.#closed) return;
    await this.attachIfActive();
    const disabled = new Set(this.record.data['disabled'] as string[]);
    for (const id of [...Object.values(ID), DEMO_PLUGIN_IDS.cloud]) {
      const row = this.host.manager.get({ pluginId: id, instanceId: 'default' });
      if (row?.state === 'disabled') disabled.add(id);
      else if (row?.state === 'active') disabled.delete(id);
    }
    const value = [...disabled].sort();
    if (JSON.stringify(value) !== JSON.stringify(this.record.data['disabled']))
      await this.persist({ disabled: value });
    this.changed();
  }
  async profile(): Promise<ApplicationProfile | null> {
    const row = this.host.manager.get({ pluginId: ID.profile, instanceId: 'default' });
    if (!row) return null;
    const current = await this.host.configs.get({ pluginId: ID.profile, instanceId: 'default' });
    return current.ok
      ? {
          owner: { ...row.owner },
          revision: current.value.revision,
          data: current.value.data as ApplicationPreferences,
        }
      : null;
  }
  async agent(method: string, input: JsonValue): Promise<Result<JsonValue>> {
    if (this.#closed) return fail('not-ready');
    const row = this.host.manager.get({ pluginId: ID.agent, instanceId: 'default' });
    if (!row || !this.host.manager.isActive(row.owner)) return fail('not-ready');
    const task = this.host.tasks.invokeCapability(
      this.host.manager,
      row.owner,
      'agent.conversation@1',
      method,
      input,
      capabilityPermissionAuthorizer(this.host.permissions, this.host.manager),
      { timeoutMs: 30000 },
    );
    if (!task.ok) return task;
    try {
      const result = await task.value.result;
      if (result.ok && method === 'run' && object(result.value)?.['paused'] === true)
        this.demo.onConsoleClosed();
      return result;
    } finally {
      task.value.release();
    }
  }
  private dialog(): ApplicationDialog | null {
    const permission = this.host.approvals.snapshot()[0];
    if (permission) {
      const row = this.host.manager.get(permission.owner);
      const name = row?.manifest.displayName['zh-CN'] ?? '桌宠功能';
      const kind = permission.permission.kind;
      const action =
        kind === 'microphone'
          ? '使用麦克风'
          : kind === 'network'
            ? '连接模型服务'
            : kind === 'credentials'
              ? '使用已保存的模型凭据'
              : kind === 'files'
                ? '读写它自己的数据'
                : '完成这次操作';
      return {
        id: permission.requestId,
        step: permission.permissionDigest,
        title: '需要你的允许',
        text: name + '希望' + action + '。只用于当前请求。',
        busy: false,
        choices: [
          { id: 'allow', label: '允许这次', primary: true },
          { id: 'deny', label: '拒绝' },
        ],
      };
    }
    const update = this.updates.dialog();
    if (update) return update;
    const flow = this.#flow;
    if (!flow) return null;
    const common = {
      id: flow.id,
      step: flow.step,
      busy: flow.busy,
      ...(flow.error ? { error: flow.error } : {}),
    };
    const later = { id: 'later', label: '稍后再说' };
    if (flow.step === 'welcome')
      return {
        ...common,
        title: '一起开始',
        text: '我已经在桌面上了。先取个名字，再选喜欢的样子。还没有模型 Key 也能完成这些设置。',
        choices: [{ id: 'next', label: '开始设置', primary: true }, later],
      };
    if (flow.step === 'name')
      return {
        ...common,
        title: '怎么称呼我',
        text: '你可以直接在这里给我取名字。',
        input: { kind: 'text', label: '桌宠名字', placeholder: '小蓝' },
        choices: [
          { id: 'save', label: '保存名字', primary: true },
          { id: 'skip', label: '沿用现在的名字' },
          later,
        ],
      };
    if (flow.step === 'appearance')
      return {
        ...common,
        title: '选一个喜欢的颜色',
        text: '选择后桌面形象会直接变化。更多形状和大小也可以在装扮页调整。',
        choices: [
          { id: 'morning', label: '晴空蓝', primary: true },
          { id: 'pine', label: '松林绿' },
          { id: 'lavender', label: '浅紫色' },
          later,
        ],
      };
    if (flow.step === 'voice')
      return {
        ...common,
        title: '要用语音输入吗',
        text: '可以使用本机识别。麦克风只会在你开始录音后打开，每次最多 20 秒。',
        choices: [
          { id: 'enable', label: '启用本机语音', primary: true },
          { id: 'skip', label: '先用文字' },
          later,
        ],
      };
    if (flow.step === 'provider')
      return {
        ...common,
        title: '选择回应方式',
        text: '离线脚本演示可以体验本机交互。接入 DeepSeek 后，会把你的消息发送到所选模型服务。',
        choices: [
          { id: 'demo', label: '先体验离线脚本', primary: true },
          { id: 'deepseek', label: '接入 DeepSeek' },
          later,
        ],
      };
    if (flow.step === 'key')
      return {
        ...common,
        title: '连接 DeepSeek',
        text: 'Key 会保存在系统加密存储中；不会进入对话或提示词。',
        input: { kind: 'secret', label: 'DeepSeek API Key', placeholder: '输入你的 Key' },
        choices: [
          { id: 'save', label: '保存并启用', primary: true },
          { id: 'skip', label: '继续用离线脚本' },
          later,
        ],
      };
    return {
      ...common,
      title: '准备好了',
      text: '设置已经保存。可以继续和我说话，或者轻轻戳我一下。离线脚本演示会明确标注。',
      choices: [{ id: 'done', label: '知道了', primary: true }],
    };
  }
  async snapshot(): Promise<ApplicationSnapshot> {
    const [profile, pages, stateResult, historyResult] = await Promise.all([
      this.profile(),
      applicationPages(this.host),
      this.agent('state', null),
      this.agent('history', null),
    ]);
    const state = stateResult.ok ? object(stateResult.value) : null;
    const history = historyResult.ok ? object(historyResult.value) : null;
    const row = this.host.manager.get({ pluginId: ID.agent, instanceId: 'default' });
    const ready =
      !!row && this.host.manager.isActive(row.owner) && stateResult.ok && historyResult.ok;
    return {
      version: 1,
      desktop: this.desktopStatus(),
      historyBefore: typeof history?.['before'] === 'number' ? history['before'] : null,
      historyHasEarlier: history?.['more'] === true,
      profile,
      pages,
      history: (Array.isArray(history?.['items'])
        ? history['items']
        : []) as unknown as ApplicationInteraction[],
      cursor: typeof history?.['cursor'] === 'number' ? history['cursor'] : 0,
      prompt: {
        state: (typeof state?.['promptState'] === 'string'
          ? state['promptState']
          : 'saved') as ApplicationPromptState,
        appliedRevision:
          typeof state?.['revision'] === 'number' && state['revision'] > 0
            ? state['revision']
            : null,
        segments: (Array.isArray(state?.['segments'])
          ? state['segments']
          : []) as unknown as ApplicationPromptSegment[],
      },
      dialog: this.dialog(),
      agent: {
        owner: row?.owner ?? null,
        state: ready ? 'ready' : row?.state === 'failed' ? 'error' : 'stopped',
        label: ready ? '日常互动已就绪' : '桌宠互动尚未启用',
      },
      error: ready
        ? null
        : !stateResult.ok
          ? stateResult.error
          : !historyResult.ok
            ? historyResult.error
            : (row?.reason ?? makeError('not-ready', false)),
    };
  }
  async getHistory(
    before: number | undefined,
    limit: number,
  ): Promise<Result<ApplicationHistoryPage>> {
    const result = await this.agent('history', {
      ...(before !== undefined ? { before } : {}),
      limit,
    });
    if (!result.ok) return result;
    return { ok: true, value: result.value as unknown as ApplicationHistoryPage };
  }
  async runPageAction(
    owner: OwnerRef,
    pageId: string,
    panelId: string,
    method: string,
    data: JsonValue,
  ): Promise<Result<JsonValue>> {
    const pages = await applicationPages(this.host);
    const page = pages.find(
      (p) =>
        p.id === pageId &&
        p.owner.pluginId === owner.pluginId &&
        p.owner.instanceId === owner.instanceId &&
        p.owner.generation === owner.generation,
    );
    const panels = page?.manifest['panels'];
    if (!page || !Array.isArray(panels) || !panels.some((p) => object(p)?.['id'] === panelId))
      return fail('stale-owner');
    const command = this.host.manager.resolveCommand(owner, method);
    if (!command.ok) return command;
    const task = this.host.tasks.run(owner, (context) => command.value(context, data), {
      timeoutMs: 30000,
    });
    if (!task.ok) return task;
    try {
      const result = await task.value.result;
      this.changed();
      return result;
    } finally {
      task.value.release();
    }
  }
  async saveProfile(
    expectedRevision: number,
    data: ApplicationPreferences,
  ): Promise<Result<ApplicationSnapshot>> {
    const saved = await this.host.configs.save(
      { pluginId: ID.profile, instanceId: 'default' },
      data,
      expectedRevision,
    );
    if (!saved.ok) return saved;
    if (saved.value.snapshot.data['voiceEnabled'] === false) this.demo.onVoiceDisabled();
    this.applyPreferences(saved.value.snapshot.data as ApplicationPreferences);
    this.changed();
    const applied = this.agent('reload', null);
    void applied.then(() => this.changed());
    await this.agent('interact', { kind: 'application', text: '已更新桌宠设置' });
    return { ok: true, value: await this.snapshot() };
  }
  async interact(kind: string, via: string): Promise<Result<null>> {
    const result = await this.agent('interact', { kind, via });
    if (!result.ok) return result;
    this.changed();
    return { ok: true, value: null };
  }
  async startGuide(): Promise<Result<ApplicationSnapshot>> {
    let profile = await this.profile();
    if (!profile) return fail('not-ready');
    if (!profile.data.visible) {
      const shown = await this.saveProfile(profile.revision, { ...profile.data, visible: true });
      if (!shown.ok) return shown;
      profile = shown.value.profile;
      if (!profile) return fail('not-ready');
    }
    this.#flow = {
      id: randomUUID(),
      step: 'welcome',
      busy: false,
      revision: profile?.revision ?? 0,
    };
    await this.persist({ guideStep: 'welcome', completed: false, deferred: false });
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
  private async advance(step: string): Promise<void> {
    const profile = await this.profile();
    await this.persist({ guideStep: step, deferred: false });
    this.#flow = { id: randomUUID(), step, busy: false, revision: profile?.revision ?? 0 };
  }
  private async setVoiceMode(mode: string): Promise<void> {
    const id = { pluginId: DEMO_PLUGIN_IDS.voice, instanceId: 'default' };
    const current = await this.host.configs.get(id);
    if (!current.ok) throw new KernelFault(current.error.code);
    const saved = await this.host.configs.save(
      id,
      { ...current.value.data, mode },
      current.value.revision,
    );
    if (!saved.ok) throw new KernelFault(saved.error.code);
  }
  private async enableReviewed(pluginId: string): Promise<void> {
    const row = this.host.manager.get({ pluginId, instanceId: 'default' });
    const review = row && this.host.describeTrust(row.owner);
    const source = row ? this.host.getPackage(row.owner) : null;
    if (!source || (!admittedApplicationSource(source) && review?.trusted !== true))
      throw new KernelFault('package-changed');
    if (!row || !review || !(await this.host.verifyTrust(row.owner, review.digest)))
      throw new KernelFault('not-ready');
    if (
      !this.host.permissionControl.confirmTrust(
        { pluginId, instanceId: 'default' },
        review.digest,
        true,
      )
    )
      throw new KernelFault('permission-denied');
    const preset = source.manifest.permissions?.some(
      (p) => p.kind === 'network' || p.kind === 'credentials',
    )
      ? 'ask'
      : 'local';
    this.host.permissionControl.setPreset({ pluginId, instanceId: 'default' }, preset);
    const cfg = await this.host.configs.get({ pluginId, instanceId: 'default' });
    if (!cfg.ok) throw new KernelFault(cfg.error.code);
    const enabled = await this.host.manager.enable(
      { pluginId, instanceId: 'default' },
      cfg.value.data,
    );
    if (!enabled.ok || enabled.value.state !== 'active')
      throw new KernelFault(enabled.ok ? 'not-ready' : enabled.error.code);
  }
  async answer(
    id: string,
    step: string,
    choice: string,
    text?: string,
  ): Promise<Result<ApplicationSnapshot>> {
    const permission = this.host.approvals
      .snapshot()
      .find((p) => p.requestId === id && p.permissionDigest === step);
    if (permission) {
      if (!['allow', 'deny'].includes(choice)) return fail('invalid-input');
      if (
        !this.host.approvals.answer({
          requestId: permission.requestId,
          owner: permission.owner,
          taskId: permission.taskId,
          permissionDigest: permission.permissionDigest,
          approved: choice === 'allow',
        })
      )
        return fail('stale-owner');
      this.changed();
      return { ok: true, value: await this.snapshot() };
    }
    const update = this.updates.dialog();
    if (update?.id === id && update.step === step) {
      if (!(await this.updates.answer(id, step, choice))) return fail('stale-owner');
      return { ok: true, value: await this.snapshot() };
    }
    const flow = this.#flow;
    const dialog = this.dialog();
    if (
      !flow ||
      flow.id !== id ||
      flow.step !== step ||
      flow.busy ||
      !dialog?.choices.some((c) => c.id === choice)
    )
      return fail('stale-owner');
    flow.busy = true;
    delete flow.error;
    this.changed();
    try {
      if (choice === 'later') {
        await this.persist({ deferred: true, guideStep: step });
        this.#flow = null;
      } else if (step === 'welcome') await this.advance('name');
      else if (step === 'name' || step === 'appearance') {
        const profile = await this.profile();
        if (!profile || profile.revision !== flow.revision) throw new KernelFault('conflict');
        const data = {
          ...profile.data,
          ...(step === 'name'
            ? { petName: choice === 'skip' ? profile.data.petName : (text ?? '') }
            : { palette: choice }),
        } as ApplicationPreferences;
        const saved = await this.saveProfile(flow.revision, data);
        if (!saved.ok) throw new KernelFault(saved.error.code);
        await this.advance(step === 'name' ? 'appearance' : 'voice');
      } else if (step === 'voice') {
        if (choice === 'enable') {
          const demo = await this.demo.snapshot();
          const available = demo.models.find((m) => m.cached);
          if (!available) throw new KernelFault('not-ready');
          const identity = { pluginId: DEMO_PLUGIN_IDS.asr, instanceId: 'default' };
          const current = await this.host.configs.inspect(identity);
          if (!current.ok) throw new KernelFault(current.error.code);
          const saved = await this.host.configs.save(
            identity,
            { model: available.id },
            current.value.snapshot?.revision ?? 0,
          );
          if (!saved.ok) throw new KernelFault(saved.error.code);
          await this.enableReviewed(DEMO_PLUGIN_IDS.asr);
          await this.enableReviewed(DEMO_PLUGIN_IDS.voice);
        }
        await this.advance('provider');
      } else if (step === 'provider') {
        if (choice === 'deepseek') await this.advance('key');
        else {
          await this.setVoiceMode('demo');
          await this.advance('done');
        }
      } else if (step === 'key') {
        if (choice === 'save') {
          const saved = await this.demo.saveKey(text ?? '');
          if (!saved.keyAvailable) throw new KernelFault('unavailable');
          await this.setVoiceMode('deepseek');
          await this.enableReviewed(DEMO_PLUGIN_IDS.cloud);
        } else await this.setVoiceMode('demo');
        await this.advance('done');
      } else {
        await this.persist({ completed: true, deferred: false, guideStep: 'done' });
        this.#flow = null;
      }
      await this.agent('interact', {
        kind: 'guide',
        text: step === 'key' ? '模型连接设置已更新' : '已完成桌宠引导中的选择',
      });
    } catch (error) {
      if (this.#flow === flow) {
        flow.busy = false;
        flow.error =
          error instanceof KernelFault
            ? ERROR_MESSAGES[error.error.code]
            : '这一步没有完成，请重试';
      }
    }
    this.changed();
    return { ok: true, value: await this.snapshot() };
  }
}

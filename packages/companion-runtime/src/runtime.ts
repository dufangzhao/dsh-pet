import { createHash } from 'node:crypto';
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_MEMORY_MAX_INPUTS,
  type OwnerRef,
  type CompanionApplication,
  type CompanionMemoryStatus,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryForgetCommand,
  type CompanionProfileView,
  type CompanionMemoryView,
  type CompanionMemoryMutationResult,
  JSON_MAX_BYTES,
  type CompanionModelView,
  errorMessage,
  makeError,
  type CompanionAgentView,
  type CompanionCommandReceipt,
  type CompanionEventPage,
  type CompanionFactCommand,
  type CompanionMessageCommand,
  type CompanionSnapshot,
  type CompanionTask,
  type CompanionTaskCommand,
  type JsonObject,
  type JsonValue,
  type KernelError,
} from '@pet/contracts';
import { KernelFault, type TaskHandle } from '@pet/host-kernel';
import type { CloudExecutionResult, CloudReconcileResult } from '@pet/cloud-exec';
import type {
  CorticoHarnessPorts,
  HarnessProfileBinding as ProfileBinding,
} from '@pet/harness-cortico';
import {
  STATE_MAX_RESULT_BYTES,
  memoryUsage,
  type StateMemoryView,
  type StateMemoryMutation,
  type StateMethodInputs,
  type StateMethodOutputs,
  type StoredArtifact,
} from '@pet/state-sqlite';
import { COMPANION_HOST_ID, type CompanionPluginHost } from './plugin-host.js';
import { profileCommand, memoryCommand, legacyMemoryCommand, memoryCue } from './persona-memory.js';
import { withSourceAuthority } from './source-authority.js';
import { EXECUTION_CAPABILITY, HARNESS_CAPABILITY, STATE_CAPABILITY } from './core-plugin.js';
import { json, object, payload } from './json.js';

const READ_METHODS = new Set([
  'snapshot',
  'memorySnapshot',
  'events',
  'getTask',
  'getTaskByExecution',
  'getArtifact',
  'getCommand',
]);
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'interrupted', 'unknown']);
const fault = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('internal', false);

export interface RuntimeOptions {
  readonly mode: CompanionAgentView['mode'];
  readonly statePluginId: string;
  readonly stateProviderId: string;
  readonly executionPluginId: string;
  readonly executionProviderId: string;
  readonly executionTimeoutMs: number;
  readonly profileOverrides?: { readonly name: boolean; readonly persona: boolean };
}

interface MemoryAdmission {
  readonly text: string;
  readonly cueEnd: number;
  readonly baseline: StateMemoryView;
  readonly source: string;
  readonly owner: OwnerRef;
}
interface Projection {
  readonly source: string;
  readonly owner: OwnerRef;
  readonly profile: ProfileBinding;
  readonly profileRevision: number | null;
  readonly memoryRevision: number;
}

interface ActiveWork {
  handle: TaskHandle | undefined;
  stopRequested: boolean;
  dispatched: boolean;
  callers: number;
  readonly finished: Promise<void>;
  readonly complete: () => void;
}

function admission(): ActiveWork {
  const slot: { complete?: () => void } = {};
  const finished = new Promise<void>((resolve) => {
    slot.complete = resolve;
  });
  if (!slot.complete) throw new KernelFault('internal');
  return {
    handle: undefined,
    stopRequested: false,
    dispatched: false,
    callers: 0,
    finished,
    complete: slot.complete,
  };
}

const executionIdentity = (commandId: string): string =>
  `exec-${createHash('sha256').update(commandId).digest('hex').slice(0, 48)}`;

export interface RuntimeModelControls {
  view(): Promise<CompanionModelView>;
  isChecking(): boolean;
  close(): Promise<void>;
}

export class CompanionRuntime {
  private latestMemoryRevision: number | undefined;
  private memoryApplicationError: KernelError | null = makeError('not-ready');
  private profileApplicationError: KernelError | null = makeError('not-ready');
  private projection: Projection | undefined;
  private readonly memoryAdmissions = new Map<string, MemoryAdmission>();
  private memoryReservations = 0;
  private modelControls: RuntimeModelControls | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly work = new Map<string, ActiveWork>();
  private readonly failures: KernelError[] = [];
  private selectedHarness = '';
  private agentStatus: CompanionAgentView['status'] = 'unavailable';
  private agentError: KernelError | null = null;
  private mode: CompanionAgentView['mode'];
  private closing = false;
  private closeWork: Promise<void> | undefined;
  private controlBusy = false;
  private quiescing: 'harness' | 'state' | null = null;
  private pendingInputs = 0;
  private observerFailures = 0;

  constructor(
    readonly host: CompanionPluginHost,
    readonly options: RuntimeOptions,
  ) {
    this.mode = options.mode;
  }

  setModelControls(controls: RuntimeModelControls): void {
    this.modelControls = controls;
  }

  isModelEnabled(): boolean {
    return (
      this.mode === 'model' &&
      this.agentStatus !== 'unavailable' &&
      Boolean(this.selectedHarness && this.host.isEnabled(this.harness().pluginId))
    );
  }

  async withModelControl<T>(operation: () => Promise<T>): Promise<T> {
    if (
      this.closing ||
      this.controlBusy ||
      this.pendingInputs ||
      this.agentStatus === 'busy' ||
      this.modelControls?.isChecking()
    )
      throw new KernelFault('conflict');
    this.controlBusy = true;
    this.quiescing = 'harness';
    try {
      return await operation();
    } finally {
      this.controlBusy = false;
      this.quiescing = null;
      this.notify();
    }
  }

  async retireForeground(): Promise<void> {
    this.clearProjection();
    this.agentStatus = 'unavailable';
    this.agentError = makeError('not-ready');
    if (this.selectedHarness) await this.host.setEnabled(this.harness().pluginId, false);
    this.notify();
  }

  async activateForeground(): Promise<void> {
    const selected = this.harness();
    await this.host.setEnabled(selected.pluginId, true);
    this.host.bind(HARNESS_CAPABILITY, selected.pluginId, selected.providerId);
    await this.refreshHarnessStatus();
    this.notify();
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        this.observerFailures++;
      }
    }
  }

  diagnostics(): {
    work: number;
    pendingInputs: number;
    observerFailures: number;
    failures: number;
  } {
    return {
      work: this.work.size,
      pendingInputs: this.pendingInputs,
      observerFailures: this.observerFailures,
      failures: this.failures.length,
    };
  }

  private failed(error: unknown): void {
    const value = fault(error);
    this.failures.push(value);
    this.agentError = value;
    this.agentStatus = 'unavailable';
    this.notify();
  }

  async state<M extends keyof StateMethodInputs>(
    method: M,
    input: StateMethodInputs[M],
    signal?: AbortSignal,
  ): Promise<StateMethodOutputs[M]> {
    const value = payload<StateMethodOutputs[M]>(
      await this.host.call(STATE_CAPABILITY, method, json(input), signal),
    );
    const candidate = value as unknown as {
      memoryRevision?: number;
      memory?: { memoryRevision: number };
    };
    const revision = candidate?.memoryRevision ?? candidate?.memory?.memoryRevision;
    if (typeof revision === 'number' && Number.isSafeInteger(revision))
      this.latestMemoryRevision = Math.max(this.latestMemoryRevision ?? revision, revision);
    if (!READ_METHODS.has(method)) this.notify();
    return value;
  }

  async profile(): Promise<{
    name: string;
    persona: string;
    harness: string;
    revision: number;
    data: JsonObject;
  }> {
    const value = await this.host.configs.get({
      pluginId: COMPANION_HOST_ID,
      instanceId: 'default',
    });
    if (!value.ok) throw new KernelFault(value.error.code);
    const data = value.value.data;
    if (
      typeof data['name'] !== 'string' ||
      typeof data['persona'] !== 'string' ||
      typeof data['harness'] !== 'string'
    )
      throw new KernelFault('invalid-input');
    return {
      name: data['name'],
      persona: data['persona'],
      harness: data['harness'],
      revision: value.value.revision,
      data,
    };
  }

  private clearProjection(): void {
    this.memoryAdmissions.clear();
    this.projection = undefined;
    this.memoryApplicationError = makeError('not-ready');
    this.profileApplicationError = makeError('not-ready');
  }
  private activeProjection(): Projection | undefined {
    const value = this.projection;
    return value && value.source === this.selectedHarness && this.host.manager.isActive(value.owner)
      ? value
      : undefined;
  }
  private profileApplication(profile: ProfileBinding): CompanionApplication {
    const applied = this.activeProjection();
    const matches =
      applied &&
      applied.profileRevision !== null &&
      applied.profile.name === profile.name &&
      applied.profile.persona === profile.persona;
    return {
      appliedRevision: matches ? profile.revision : null,
      error: matches
        ? this.profileApplicationError
        : (this.profileApplicationError ?? makeError('not-ready')),
    };
  }
  private memoryStatus(memory: StateMemoryView): CompanionMemoryStatus {
    const candidate = this.activeProjection();
    const applied =
      candidate && candidate.memoryRevision <= memory.memoryRevision ? candidate : undefined;
    return {
      revision: memory.memoryRevision,
      usage: memory.usage,
      application: {
        appliedRevision: applied?.memoryRevision ?? null,
        error:
          applied?.memoryRevision === memory.memoryRevision
            ? this.memoryApplicationError
            : (this.memoryApplicationError ?? makeError('not-ready')),
      },
    };
  }
  private publicMemory(memory: StateMemoryView): CompanionMemoryView {
    return { ...this.memoryStatus(memory), agentId: memory.assistantId, facts: memory.facts };
  }
  async profileView(): Promise<CompanionProfileView> {
    const profile = await this.profile();
    const state = await this.state('snapshot', {});
    return {
      agentId: state.assistantId,
      name: profile.name,
      persona: profile.persona,
      revision: profile.revision,
      management: {
        application: this.profileApplication(profile),
        launchOverrides: this.options.profileOverrides ?? { name: false, persona: false },
      },
    };
  }
  async memoryView(): Promise<CompanionMemoryView> {
    return this.publicMemory(await this.state('memorySnapshot', {}));
  }
  private async ownerForeground(): Promise<boolean> {
    const profile = await this.profile();
    const selected = this.harness();
    const entry = this.host.manager.get({ pluginId: selected.pluginId, instanceId: 'default' });
    return Boolean(
      entry?.desiredActive &&
      this.host.isEnabled(selected.pluginId) &&
      !(
        Array.isArray(profile.data['disabledPlugins']) &&
        profile.data['disabledPlugins'].includes(selected.pluginId)
      ),
    );
  }
  private async restoreAfterOwnerEdit(wasActive: boolean): Promise<void> {
    if (!wasActive) return;
    try {
      await this.activateForeground();
    } catch (error) {
      this.agentStatus = 'unavailable';
      this.agentError = fault(error);
      this.profileApplicationError = fault(error);
      this.memoryApplicationError = fault(error);
    }
  }
  async savePersona(input: unknown): Promise<CompanionProfileView> {
    const command = profileCommand(input);
    return this.withModelControl(async () => {
      const profile = await this.profile();
      if (profile.revision !== command.expectedProfileRevision) throw new KernelFault('conflict');
      const data = { ...profile.data, name: command.name, persona: command.persona };
      const definition = this.host.configs.definition({
        pluginId: COMPANION_HOST_ID,
        instanceId: 'default',
      });
      if (!definition?.validate(data).ok) throw new KernelFault('invalid-input');
      const previousView = await this.profileView();
      const active = await this.ownerForeground();
      if (active) await this.retireForeground();
      const saved = await this.host.configs.save(
        { pluginId: COMPANION_HOST_ID, instanceId: 'default' },
        data,
        command.expectedProfileRevision,
      );
      if (!saved.ok) {
        await this.restoreAfterOwnerEdit(active);
        throw new KernelFault(saved.error.code);
      }
      const committed: CompanionProfileView = {
        agentId: previousView.agentId,
        name: saved.value.snapshot.data['name'] as string,
        persona: saved.value.snapshot.data['persona'] as string,
        revision: saved.value.snapshot.revision,
        management: {
          application: { appliedRevision: null, error: makeError('not-ready') },
          launchOverrides: previousView.management?.launchOverrides ?? {
            name: false,
            persona: false,
          },
        },
      };
      await this.restoreAfterOwnerEdit(active);
      try {
        return await this.profileView();
      } catch (error) {
        return {
          ...committed,
          management: {
            launchOverrides: previousView.management?.launchOverrides ?? {
              name: false,
              persona: false,
            },
            application: { appliedRevision: null, error: fault(error) },
          },
        };
      }
    });
  }
  async upsertFact(input: unknown): Promise<CompanionMemoryMutationResult> {
    const legacy = legacyMemoryCommand(input);
    if (legacy) {
      const result = await this.state('rememberFact', legacy);
      return {
        receipt: result.receipt,
        committedRevision: null,
        view: this.publicMemory(result.memory),
      };
    }
    const command = memoryCommand(input, false);
    return this.ownerMemory(command, false);
  }
  async forgetFact(input: unknown): Promise<CompanionMemoryMutationResult> {
    return this.ownerMemory(memoryCommand(input, true), true);
  }
  private async ownerMemory(
    command: CompanionMemoryUpsertCommand | CompanionMemoryForgetCommand,
    forget: boolean,
  ): Promise<CompanionMemoryMutationResult> {
    return this.withModelControl(async () => {
      const memory = await this.state('memorySnapshot', {});
      // Let the transactional writer recognize a duplicate before rejecting its old CAS baseline.
      const kind = forget ? 'memory.forget' : 'memory.upsert';
      const payload = { ...command, origin: { kind: 'owner-form' as const } };
      const known = await this.state('getCommand', {
        commandId: command.commandId,
        kind,
        payload: json(payload) as JsonObject,
      });
      if (
        !known &&
        (memory.memoryRevision !== command.expectedMemoryRevision ||
          (memory.facts.find((f) => f.key === command.key)?.revision ?? 0) !==
            command.expectedFactRevision)
      )
        throw new KernelFault('conflict');
      const active = !known && (await this.ownerForeground());
      if (active) await this.retireForeground();
      let result: StateMemoryMutation;
      try {
        result = forget
          ? await this.state('forgetFact', payload)
          : await this.state('rememberFact', payload as StateMethodInputs['rememberFact']);
      } catch (error) {
        await this.restoreAfterOwnerEdit(active);
        throw error;
      }
      const committed = this.publicMemory(result.memory);
      await this.restoreAfterOwnerEdit(active);
      let view: CompanionMemoryView;
      try {
        view = await this.memoryView();
      } catch (error) {
        view = { ...committed, application: { appliedRevision: null, error: fault(error) } };
      }
      return { receipt: result.receipt, committedRevision: result.committedRevision, view };
    });
  }

  private harness(key = this.selectedHarness): { pluginId: string; providerId: string } {
    for (const plugin of this.host.manager.list()) {
      for (const provider of plugin.manifest.provides ?? []) {
        if (
          provider.capability === HARNESS_CAPABILITY &&
          `${plugin.owner.pluginId}/${provider.id}` === key
        )
          return { pluginId: plugin.owner.pluginId, providerId: provider.id };
      }
    }
    throw new KernelFault('not-ready');
  }

  async initialize(): Promise<void> {
    this.host.bind(STATE_CAPABILITY, this.options.statePluginId, this.options.stateProviderId);
    this.host.bind(
      EXECUTION_CAPABILITY,
      this.options.executionPluginId,
      this.options.executionProviderId,
    );
    const profile = await this.profile();
    this.selectedHarness = profile.harness;
    if (!this.host.isEnabled(this.options.statePluginId)) {
      this.agentStatus = 'unavailable';
      this.agentError = makeError('not-ready');
      this.notify();
      return;
    }
    let recovery = await this.state('recover', {});
    while (recovery.hasMore) recovery = await this.state('recover', {});
    if (this.host.isEnabled(this.options.executionPluginId)) await this.reconcileExecution();
    try {
      const selected = this.harness();
      if (
        Array.isArray(profile.data['disabledPlugins']) &&
        profile.data['disabledPlugins'].includes(selected.pluginId)
      ) {
        this.agentStatus = 'unavailable';
        this.agentError = makeError('not-ready');
        this.notify();
        return;
      }
      await this.host.setEnabled(selected.pluginId, true);
      this.host.bind(HARNESS_CAPABILITY, selected.pluginId, selected.providerId);
      await this.refreshHarnessStatus();
    } catch (error) {
      this.agentStatus = 'unavailable';
      this.agentError = fault(error);
    }
    this.notify();
  }

  async reconcileExecution(): Promise<void> {
    let cursor: string | null = null;
    do {
      const page: CloudReconcileResult = payload(
        await this.host.call(EXECUTION_CAPABILITY, 'reconcile', cursor ? { after: cursor } : {}),
      );
      for (const receipt of page.receipts) {
        let task: CompanionTask;
        try {
          task = await this.state('getTaskByExecution', { executionId: receipt.executionId });
        } catch (error) {
          // Execution storage can contain receipts from another authorized client of this provider.
          if (error instanceof KernelFault && error.error.code === 'not-ready') continue;
          throw error;
        }
        await this.recordOutcome(task, receipt.result, null, false);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }

  private async refreshHarnessStatus(): Promise<void> {
    const status = object(await this.host.call(HARNESS_CAPABILITY, 'status', null));
    if (!status || !['ready', 'busy', 'unavailable'].includes(String(status['status'])))
      throw new KernelFault('internal');
    this.agentStatus = status['status'] as CompanionAgentView['status'];
    if (status['mode'] === 'model' || status['mode'] === 'scripted') this.mode = status['mode'];
    this.agentError = this.agentStatus === 'unavailable' ? makeError('unavailable') : null;
  }

  async snapshot(): Promise<CompanionSnapshot> {
    const [profile, model] = await Promise.all([this.profile(), this.modelControls?.view()]);
    const plugins = this.host.views();
    const now = Date.now();
    const agent = {
      id: 'x'.repeat(128),
      name: profile.name,
      profileRevision: profile.revision,
      profileApplication: this.profileApplication(profile),
      harness: this.selectedHarness,
      mode: this.mode,
      status: this.agentStatus,
      error: this.agentError,
    };
    // Reserve the actual aggregate envelope, including Result, before the single state projection.
    const envelope = {
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      epoch: 'x'.repeat(128),
      cursor: Number.MAX_SAFE_INTEGER,
      now,
      agent,
      messages: [],
      tasks: [],
      facts: [],
      memory: {
        revision: Number.MAX_SAFE_INTEGER,
        application: {
          appliedRevision: Number.MAX_SAFE_INTEGER,
          error: makeError('permission-denied', false),
        },
        usage: { count: 32, dataBytes: 8192, originBytes: 8192 },
      },
      plugins,
      ...(model ? { model } : {}),
      projection: { hasMoreMessages: false, hasMoreTasks: false, taskDetailsTruncated: false },
    };
    const remaining =
      JSON_MAX_BYTES - Buffer.byteLength(JSON.stringify({ ok: true, value: envelope }));
    if (remaining < 1) throw new KernelFault('quota-exceeded');
    const state = await this.state('snapshot', {
      byteBudget: Math.min(STATE_MAX_RESULT_BYTES, remaining),
    });
    const snapshot: CompanionSnapshot = {
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      epoch: state.epoch,
      cursor: state.cursor,
      now,
      agent: { ...agent, id: state.assistantId },
      messages: state.messages,
      tasks: state.tasks,
      facts: state.facts,
      ...(Number.isSafeInteger(state.memoryRevision)
        ? {
            memory: this.memoryStatus({
              assistantId: state.assistantId,
              memoryRevision: state.memoryRevision,
              facts: state.facts,
              usage: memoryUsage(state.facts),
            }),
          }
        : {}),
      plugins,
      ...(model ? { model } : {}),
      projection: {
        hasMoreMessages: state.hasMoreMessages,
        hasMoreTasks: state.hasMoreTasks,
        taskDetailsTruncated: state.taskDetailsTruncated,
      },
    };
    json({ ok: true, value: snapshot });
    return snapshot;
  }

  events(after: number, epoch: string): Promise<CompanionEventPage> {
    return this.state('events', { after, epoch });
  }

  private requireInteraction(): void {
    if (
      this.closing ||
      this.quiescing !== null ||
      this.agentStatus === 'unavailable' ||
      !this.host.isEnabled(this.harness().pluginId)
    )
      throw new KernelFault('not-ready');
  }

  async message(command: CompanionMessageCommand): Promise<CompanionCommandReceipt> {
    this.requireInteraction();
    this.pendingInputs++;
    let reserved = false;
    try {
      // Exact acceptMessage fingerprint: known intents need no new admission capacity or delivery.
      const known = await this.state('getCommand', {
        commandId: command.commandId,
        kind: 'message',
        payload: json(command) as JsonObject,
      });
      this.requireInteraction();
      if (known) return known;
      const cueEnd = memoryCue(command.text);
      reserved = cueEnd !== null;
      if (
        reserved &&
        this.memoryAdmissions.size + this.memoryReservations >= COMPANION_MEMORY_MAX_INPUTS
      ) {
        reserved = false;
        throw new KernelFault('quota-exceeded');
      }
      if (reserved) this.memoryReservations++;
      const source = this.selectedHarness;
      const selected = this.harness();
      const owner = this.host.manager.get({
        pluginId: selected.pluginId,
        instanceId: 'default',
      })?.owner;
      const baseline = reserved ? await this.state('memorySnapshot', {}) : undefined;
      const accepted = await this.state('acceptMessage', command);
      if (accepted.receipt.status === 'duplicate') return accepted.receipt;
      try {
        if (!owner || source !== this.selectedHarness || !this.host.manager.isActive(owner))
          throw new KernelFault('stale-owner');
        const canonicalCue = memoryCue(accepted.message.text);
        if (baseline && canonicalCue !== null) {
          this.memoryAdmissions.set(accepted.message.id, {
            text: accepted.message.text,
            cueEnd: canonicalCue,
            baseline,
            source,
            owner,
          });
          this.memoryReservations--;
          reserved = false;
        }
        this.agentStatus = 'busy';
        this.notify();
        payload<null>(
          await this.host.call(
            HARNESS_CAPABILITY,
            'accept',
            json({ id: accepted.message.id, text: accepted.message.text, kind: 'user' }),
          ),
        );
      } catch (error) {
        this.memoryAdmissions.delete(accepted.message.id);
        this.agentStatus = 'unavailable';
        this.agentError = fault(error);
        await this.state('appendMessage', {
          id: `admission-${accepted.message.id}`,
          role: 'notice',
          text: `输入已保存，但暂未进入处理：${errorMessage(fault(error))}`,
          inputId: accepted.message.id,
        });
        throw error;
      }
      return accepted.receipt;
    } finally {
      this.pendingInputs--;
      if (reserved) this.memoryReservations--;
    }
  }

  async startTask(
    command: CompanionTaskCommand,
    signal?: AbortSignal,
  ): Promise<CompanionCommandReceipt> {
    if (this.closing || this.quiescing === 'state') throw new KernelFault('not-ready');
    signal?.throwIfAborted();
    const safe = json(command) as unknown as CompanionTaskCommand;
    if (typeof safe.commandId !== 'string' || !safe.commandId || safe.commandId.length > 128)
      throw new KernelFault('invalid-input');
    const executionId = executionIdentity(safe.commandId);
    const pending = this.work.get(executionId) ?? admission();
    this.work.set(executionId, pending);
    pending.callers++;
    try {
      // The reservation precedes the transaction, including snapshots that race its receipt.
      const accepted = await this.state('createTask', { ...safe, executionId });
      if (accepted.receipt.status === 'duplicate') return accepted.receipt;
      pending.dispatched = true;
      if (signal?.aborted || this.closing) pending.stopRequested = true;
      void this.executeTask(accepted.task, safe, pending)
        .catch((error: unknown) => this.failed(error))
        .finally(() => {
          this.work.delete(executionId);
          pending.complete();
          this.notify();
        });
      return accepted.receipt;
    } finally {
      pending.callers--;
      if (!pending.dispatched && pending.callers === 0) {
        this.work.delete(executionId);
        pending.complete();
      }
    }
  }

  private async executeTask(
    task: CompanionTask,
    command: CompanionTaskCommand,
    pending: ActiveWork,
  ): Promise<void> {
    let observed: JsonValue | undefined;
    try {
      if (!pending.stopRequested && !this.closing)
        await this.state('updateTask', { taskId: task.id, status: 'running' });
      if (pending.stopRequested || this.closing) {
        await this.recordOutcome(task, undefined, makeError('cancelled'));
        return;
      }
      const request = {
        code: command.code,
        executionId: task.executionId,
        ...(command.files ? { files: command.files } : {}),
        ...(command.outputs ? { outputs: command.outputs } : {}),
        ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
      };
      pending.handle = this.host.runCapability(
        EXECUTION_CAPABILITY,
        'execute',
        json(request),
        { timeoutMs: (command.timeoutMs ?? this.options.executionTimeoutMs) + 30000 },
        (value) => {
          observed = json(value);
        },
      );
      if (pending.stopRequested || this.closing) pending.handle.cancel();
      await this.finishTask(task, pending.handle, () => observed);
    } catch (error) {
      if (pending.handle) {
        pending.handle.cancel();
        await pending.handle.settled;
      }
      if (pending.handle) {
        await this.state('updateTask', { taskId: task.id, status: 'unknown', error: fault(error) });
        throw error;
      }
      await this.recordOutcome(
        task,
        undefined,
        pending.stopRequested ? makeError('cancelled') : fault(error),
      );
    }
  }

  private async finishTask(
    task: CompanionTask,
    handle: TaskHandle,
    actual: () => JsonValue | undefined,
  ): Promise<void> {
    const logical = await handle.result;
    await handle.settled;
    const returned = actual();
    let result: CloudExecutionResult | undefined;
    let error: KernelError | null = null;
    if (returned !== undefined) {
      try {
        result = payload<CloudExecutionResult>(json(returned));
      } catch (cause) {
        error = fault(cause);
      }
    } else error = logical.ok ? makeError('unavailable') : logical.error;
    await this.recordOutcome(task, result, error);
  }

  private async recordOutcome(
    task: CompanionTask,
    result: CloudExecutionResult | undefined,
    error: KernelError | null = null,
    announce = true,
  ): Promise<void> {
    const state = !result
      ? error?.code === 'cancelled'
        ? 'cancelled'
        : 'failed'
      : !result.settled || result.status === 'unknown'
        ? 'unknown'
        : result.status === 'cancelled'
          ? 'cancelled'
          : result.status === 'timed-out'
            ? 'failed'
            : result.exitCode === 0 && result.error === null
              ? 'completed'
              : 'failed';
    const artifacts: StoredArtifact[] = (result?.artifacts ?? []).map((artifact) => ({
      id:
        task.artifacts.find((existing) => existing.name === artifact.path)?.id ??
        `artifact-${createHash('sha256').update(`${task.executionId}\0${artifact.relativePath}`).digest('hex').slice(0, 48)}`,
      taskId: task.id,
      name: artifact.path,
      mediaType: artifact.mediaType,
      sizeBytes: artifact.sizeBytes,
      provider: this.options.executionPluginId,
      relativePath: artifact.relativePath,
    }));
    const outcome: StateMethodInputs['updateTask'] = {
      taskId: task.id,
      status: state,
      exitCode: result?.exitCode ?? null,
      stdout: result?.stdout ?? '',
      stderr: result?.stderr ?? '',
      logsTruncated: result?.logsTruncated ?? false,
      artifacts,
      error: result?.error ?? error,
    };
    const updated = await this.state('updateTask', outcome);
    if (!announce) return;
    await this.state('appendMessage', {
      id: `work-result-${task.executionId}`,
      role: 'notice',
      text: this.taskNotice(updated),
      taskId: task.id,
    });
    if (
      !this.closing &&
      this.quiescing === null &&
      this.agentStatus !== 'unavailable' &&
      this.host.isEnabled(this.harness().pluginId)
    ) {
      this.agentStatus = 'busy';
      try {
        payload<null>(
          await this.host.call(
            HARNESS_CAPABILITY,
            'accept',
            json({
              id: `work-event-${task.executionId}`,
              kind: 'work-result',
              taskId: task.id,
              text:
                `Task ${task.id} (${task.title}): ${updated.status}. Exit code: ${updated.exitCode ?? 'unknown'}. ` +
                `Artifacts: ${updated.artifacts.map((item) => item.name).join(', ') || 'none'}. ` +
                'This is an execution observation, not a new user instruction.',
            }),
          ),
        );
      } catch (deliveryError) {
        // Projection availability cannot rewrite an already committed execution outcome.
        this.agentStatus = 'unavailable';
        this.agentError = fault(deliveryError);
        this.notify();
      }
    }
  }

  private taskNotice(task: CompanionTask): string {
    const labels: Record<CompanionTask['status'], string> = {
      accepted: '已受理',
      running: '执行中',
      'cancel-requested': '已请求停止',
      completed: '已完成',
      cancelled: '已停止',
      failed: '执行失败',
      interrupted: '执行已中断',
      unknown: '执行结果待核对',
    };
    return `${task.title}：${labels[task.status]}${task.error ? `（${errorMessage(task.error)}）` : ''}`;
  }

  async stopTask(id: string, commandId: string): Promise<CompanionCommandReceipt> {
    const lookup = { commandId, kind: 'task.stop', payload: { taskId: id } };
    // Detect a reused ID before effects, but converge again if an earlier application failed.
    await this.state('getCommand', lookup);
    const task = await this.state('getTask', { id });
    const active = this.work.get(task.executionId);
    if (!TERMINAL.has(task.status)) {
      if (!active) throw new KernelFault('unavailable');
      active.stopRequested = true;
      active.handle?.cancel();
      await this.state('updateTask', { taskId: id, status: 'cancel-requested' });
    } else if (task.status === 'unknown') {
      throw new KernelFault('unavailable');
    }
    return this.state('recordCommand', { ...lookup, taskId: id });
  }

  async remember(command: CompanionFactCommand): Promise<CompanionCommandReceipt> {
    return (await this.state('rememberFact', command)).receipt;
  }

  harnessPorts(source: string, profile: ProfileBinding): CorticoHarnessPorts {
    const selected = this.harness(source);
    const identity = { pluginId: selected.pluginId, instanceId: 'default' };
    const owner = this.host.manager.get(identity)?.owner;
    if (!owner) throw new KernelFault('not-ready');
    const current = (): void => {
      if (
        this.closing ||
        this.selectedHarness !== source ||
        this.host.manager.get(identity)?.owner.generation !== owner.generation
      )
        throw new KernelFault('stale-owner');
    };
    const scoped = <T>(
      capability: string,
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      current();
      return withSourceAuthority(
        this.host,
        selected.pluginId,
        [{ kind: 'capability-use', capability }],
        (signal) => {
          current();
          return operation(signal);
        },
      );
    };
    let issuedMemoryRevision: number | undefined;
    return {
      finishInputs: (ids) => {
        for (const id of ids) {
          const admission = this.memoryAdmissions.get(id);
          if (admission?.source === source && admission.owner.generation === owner.generation)
            this.memoryAdmissions.delete(id);
        }
      },
      projectionApplied: (value) => {
        current();
        if (
          value.memoryRevision !== issuedMemoryRevision ||
          value.memoryRevision !== this.latestMemoryRevision ||
          (value.profileRevision !== null && value.profileRevision !== profile.revision)
        )
          throw new KernelFault('conflict');
        this.projection = {
          source,
          owner,
          profile,
          profileRevision: value.profileRevision,
          memoryRevision: value.memoryRevision,
        };
        this.memoryApplicationError = null;
        this.profileApplicationError =
          value.profileRevision === null ? makeError('not-ready') : null;
        this.notify();
      },
      projectionFailed: (value) => {
        if (
          this.closing ||
          this.selectedHarness !== source ||
          this.host.manager.get(identity)?.owner.generation !== owner.generation ||
          value.memoryRevision !== this.latestMemoryRevision
        )
          return;
        this.memoryApplicationError = value.error;
        this.agentError = value.error;
        this.agentStatus = 'unavailable';
        this.notify();
      },
      context: async () => {
        current();
        let value: StateMethodOutputs['snapshot'];
        if (this.host.manager.get(identity)?.state === 'activating') {
          const epoch = this.host.bootstrapGrant(owner, STATE_CAPABILITY);
          if (epoch === null) throw new KernelFault('permission-denied');
          value = await this.state('snapshot', {});
          current();
          if (this.host.bootstrapGrant(owner, STATE_CAPABILITY) !== epoch)
            throw new KernelFault('permission-denied');
        } else
          value = await scoped(STATE_CAPABILITY, (signal) => this.state('snapshot', {}, signal));
        if (!Number.isSafeInteger(value.memoryRevision)) throw new KernelFault('not-ready');
        issuedMemoryRevision = Math.max(
          issuedMemoryRevision ?? value.memoryRevision,
          value.memoryRevision,
        );
        return {
          messages: value.messages,
          facts: value.facts,
          tasks: value.tasks,
          memoryRevision: value.memoryRevision,
        };
      },
      publish: (output) =>
        scoped(STATE_CAPABILITY, async (signal) => {
          await this.state(
            'appendMessage',
            {
              id: output.id,
              role: 'assistant',
              text: output.text,
              inputId: output.inputIds[0] ?? null,
              taskId: output.taskId ?? null,
            },
            signal,
          );
        }),
      startWork: (request, origin) =>
        scoped(EXECUTION_CAPABILITY, (signal) =>
          this.startTask({ ...request, commandId: origin.id }, signal),
        ),
      stopWork: (id) => scoped(EXECUTION_CAPABILITY, () => this.stopTask(id, `model-stop-${id}`)),
      rememberFact: (key, value, origin) =>
        scoped(STATE_CAPABILITY, async (signal) => {
          const inputId = origin.inputIds.length === 1 ? origin.inputIds[0] : undefined;
          const admission = inputId ? this.memoryAdmissions.get(inputId) : undefined;
          if (
            !admission ||
            admission.source !== source ||
            admission.owner.generation !== owner.generation ||
            !inputId
          )
            throw new KernelFault('permission-denied');
          const start = admission.text.indexOf(value, admission.cueEnd);
          if (start < admission.cueEnd || !value.trim()) throw new KernelFault('permission-denied');
          const command = memoryCommand(
            {
              commandId: `memory-${createHash('sha256')
                .update(JSON.stringify([inputId, key.trim(), value]))
                .digest('hex')}`,
              key,
              value,
              expectedMemoryRevision: admission.baseline.memoryRevision,
              expectedFactRevision:
                admission.baseline.facts.find((f) => f.key === key.trim())?.revision ?? 0,
            },
            false,
          );
          const result = await this.state(
            'rememberFact',
            {
              ...command,
              origin: {
                kind: 'user-input',
                inputId,
                evidence: { start, end: start + value.length },
              },
            },
            signal,
          );
          return {
            receipt: result.receipt,
            committedRevision: result.committedRevision,
            view: this.publicMemory(result.memory),
          };
        }),
      status: (status, error) => {
        if (this.selectedHarness !== source || this.closing || !this.host.manager.isActive(owner))
          return;
        this.agentStatus = status;
        this.agentError = error ?? null;
        this.notify();
      },
    };
  }

  private async saveProfile(patch: JsonObject): Promise<void> {
    const profile = await this.profile();
    if (
      Object.entries(patch).every(
        ([key, value]) => JSON.stringify(profile.data[key]) === JSON.stringify(value),
      )
    )
      return;
    const saved = await this.host.configs.save(
      { pluginId: COMPANION_HOST_ID, instanceId: 'default' },
      { ...profile.data, ...patch },
      profile.revision,
    );
    if (!saved.ok) throw new KernelFault(saved.error.code);
  }

  async selectHarness(key: string, commandId: string): Promise<CompanionCommandReceipt> {
    if (
      this.closing ||
      this.controlBusy ||
      this.pendingInputs ||
      this.agentStatus === 'busy' ||
      this.modelControls?.isChecking()
    )
      throw new KernelFault('conflict');
    const next = this.harness(key);
    this.controlBusy = true;
    this.quiescing = 'harness';
    const lookup = { commandId, kind: 'harness.select', payload: { harness: key } };
    try {
      await this.state('getCommand', lookup);
      const profile = await this.profile();
      const disabled = Array.isArray(profile.data['disabledPlugins'])
        ? profile.data['disabledPlugins'].filter((id) => id !== next.pluginId)
        : [];
      await this.saveProfile({ harness: key, disabledPlugins: disabled });
      if (this.selectedHarness && key !== this.selectedHarness) this.clearProjection();
      if (this.selectedHarness && key !== this.selectedHarness)
        await this.host.setEnabled(this.harness().pluginId, false);
      this.selectedHarness = key;
      this.agentStatus = 'unavailable';
      await this.host.setEnabled(next.pluginId, true);
      this.host.bind(HARNESS_CAPABILITY, next.pluginId, next.providerId);
      await this.refreshHarnessStatus();
      return await this.state('recordCommand', lookup);
    } catch (error) {
      this.agentError = fault(error);
      this.agentStatus = 'unavailable';
      throw error;
    } finally {
      this.controlBusy = false;
      this.quiescing = null;
      this.notify();
    }
  }

  async setPlugin(
    id: string,
    enabled: boolean,
    commandId: string,
  ): Promise<CompanionCommandReceipt> {
    if (this.closing || this.controlBusy || this.modelControls?.isChecking())
      throw new KernelFault('conflict');
    const entry = this.host.manager.get({ pluginId: id, instanceId: 'default' });
    if (!entry) throw new KernelFault('invalid-input');
    if (entry.protected) throw new KernelFault('permission-denied');
    if (
      id === this.options.statePluginId &&
      (this.work.size || this.pendingInputs || this.agentStatus === 'busy')
    )
      throw new KernelFault('conflict');
    this.controlBusy = true;
    this.quiescing =
      id === this.options.statePluginId
        ? 'state'
        : this.selectedHarness && id === this.harness().pluginId
          ? 'harness'
          : null;
    let temporaryStateOpen = false;
    try {
      // Restoring the state authority cannot require it to already be available.
      if (id === this.options.statePluginId && enabled && !this.host.isEnabled(id)) {
        await this.host.setEnabled(id, true);
        this.host.bind(STATE_CAPABILITY, id, this.options.stateProviderId);
        temporaryStateOpen = true;
      }
      const lookup = { commandId, kind: 'plugin.select', payload: { id, enabled } };
      await this.state('getCommand', lookup);
      // Disabling the state provider itself needs a durable intent before closing that writer.
      const intent =
        !enabled && id === this.options.statePluginId
          ? await this.state('recordCommand', lookup)
          : null;
      const profile = await this.profile();
      const disabled = new Set(
        Array.isArray(profile.data['disabledPlugins'])
          ? profile.data['disabledPlugins'].filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      );
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      await this.saveProfile({ disabledPlugins: [...disabled].sort() });
      temporaryStateOpen = false;
      if (!enabled && this.selectedHarness && id === this.harness().pluginId)
        this.clearProjection();
      await this.host.setEnabled(id, enabled);
      if (id === this.options.executionPluginId && enabled) await this.reconcileExecution();
      if (id === this.options.statePluginId && enabled) await this.initialize();
      if (this.selectedHarness && id === this.harness().pluginId) {
        if (enabled) await this.refreshHarnessStatus();
        else {
          this.agentStatus = 'unavailable';
          this.agentError = makeError('not-ready');
        }
      }
      return intent ?? (await this.state('recordCommand', lookup));
    } catch (error) {
      if (temporaryStateOpen) await this.host.setEnabled(id, false);
      throw error;
    } finally {
      this.controlBusy = false;
      this.quiescing = null;
      this.notify();
    }
  }

  async stopForeground(): Promise<void> {
    this.memoryAdmissions.clear();
    payload<null>(await this.host.call(HARNESS_CAPABILITY, 'stopForeground', null));
  }

  async whenWorkSettled(): Promise<void> {
    await Promise.all([...this.work.values()].map((item) => item.finished));
    if (this.failures.length) throw new KernelFault(this.failures[0]?.code ?? 'internal');
  }

  close(): Promise<void> {
    return (this.closeWork ??= this.shutdown());
  }

  private async shutdown(): Promise<void> {
    this.closing = true;
    this.clearProjection();
    await this.modelControls?.close();
    if (this.selectedHarness && this.host.isEnabled(this.harness().pluginId))
      await this.host.setEnabled(this.harness().pluginId, false);
    for (const item of this.work.values()) {
      item.stopRequested = true;
      item.handle?.cancel('shutdown');
    }
    await this.whenWorkSettled();
    this.listeners.clear();
  }
}

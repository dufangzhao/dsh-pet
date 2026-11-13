import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_MEMORY_MAX_INPUTS,
  COMPANION_MAX_TEXT,
  COMPANION_FULL_TEXT_MAX_BYTES,
  COMPANION_TASK_MATERIAL_MAX,
  COMPANION_INPUT_MATERIAL_MAX,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  QQ_GROUP_CONTEXT_MAX_MESSAGES,
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  QQ_GROUP_CONTEXT_MAX_BYTES,
  companionAudienceKey,
  isCompanionMaterialRef,
  isCompanionRecordId,
  isQQStatus,
  type QQStatus,
  type CompanionInputAdmission,
  type CompanionInputOrigin,
  type CompanionMessage,
  type CompanionMessageContent,
  type CompanionMaterialRef,
  type CompanionMaterialSelection,
  type Result,
  type CompanionTaskOrigin,
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
import type {
  CloudExecutionResult,
  CloudReconcileResult,
  CloudMaterialReadRequest,
  CloudMaterialSource,
} from '@pet/cloud-exec';
import type {
  CorticoHarnessPorts,
  CorticoHarnessInputPorts,
  HarnessInputBinding,
  HarnessInputTerminal,
  HarnessResolvedImage,
  HarnessOrigin,
  HarnessOutput,
  HarnessReplyAttachment,
  HarnessWorkRequest,
  HarnessProfileBinding as ProfileBinding,
} from '@pet/harness-cortico';
import {
  STATE_MAX_RESULT_BYTES,
  STATE_MAX_MESSAGE_BYTES,
  memoryUsage,
  type StateMemoryView,
  type StateMemoryMutation,
  type StateMethodInputs,
  type StateMethodOutputs,
  type StoredArtifact,
  type StateReadScope,
} from '@pet/state-sqlite';
import { COMPANION_HOST_ID, type CompanionPluginHost } from './plugin-host.js';
import { profileCommand, memoryCommand, legacyMemoryCommand, memoryCue } from './persona-memory.js';
import { withSourceAuthority } from './source-authority.js';
import { EXECUTION_CAPABILITY, HARNESS_CAPABILITY, STATE_CAPABILITY } from './core-plugin.js';
import { json, object, payload } from './json.js';
import {
  OWNER_INPUT_SCOPE,
  captureInputGrant,
  checkInputGrant,
  inputScope,
  type RuntimeInputGrant,
  type RuntimeInputPorts,
  type RuntimeInputAccess,
  type RuntimeInputTerminal,
} from './input-authority.js';

const READ_METHODS = new Set([
  'snapshot',
  'memorySnapshot',
  'events',
  'getMessage',
  'getTask',
  'getTaskByExecution',
  'getArtifact',
  'getCommand',
  'getInput',
  'inputMessage',
  'inputNotices',
  'getMaterial',
  'findMaterial',
  'observations',
  'getObservation',
  'judgmentUsage',
  'proactiveReadiness',
  'findInput',
  'getDelivery',
  'deliveries',
  'passiveReplyBudget',
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
  readonly optionalPluginIds?: readonly string[];
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

interface RuntimeInput {
  admission: CompanionInputAdmission;
  readonly message: CompanionMessage;
  readonly grant: RuntimeInputGrant;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly source: string;
  readonly owner: OwnerRef;
  readonly outputs: CompanionMessage[];
  contextId: string | null;
  claimed: boolean;
  bound: boolean;
  projection?: Projection;
  terminal?: Promise<void>;
}

type WorkTaskCommand = HarnessWorkRequest & Pick<CompanionTaskCommand, 'commandId'>;
interface WorkMaterials {
  readonly origin: CompanionTaskOrigin;
  readonly entries: readonly {
    readonly selection: CompanionMaterialSelection;
    readonly material: CompanionMaterialRef;
  }[];
  readonly read: NonNullable<RuntimeInputPorts['readWorkMaterial']>;
}

interface ActiveWork {
  authority?: RuntimeInputGrant;
  materials?: WorkMaterials;
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
  private qqStatusProvider: (() => Promise<QQStatus>) | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly work = new Map<string, ActiveWork>();
  private readonly inputs = new Map<string, RuntimeInput>();
  private readonly ownerLifetime = new AbortController();
  private inputPorts: RuntimeInputPorts = {};
  private readonly inputListeners = new Set<
    (value: RuntimeInputTerminal) => void | Promise<void>
  >();
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

  setQQStatusProvider(provider: () => Promise<QQStatus>): void {
    this.qqStatusProvider = provider;
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
      this.inputs.size ||
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
    for (const input of this.inputs.values()) {
      delete input.projection;
      input.controller.abort();
    }
    this.memoryAdmissions.clear();
    this.projection = undefined;
    this.memoryApplicationError = makeError('not-ready');
    this.profileApplicationError = makeError('not-ready');
  }
  private activeProjection(): Projection | undefined {
    let value = this.projection;
    for (const input of this.inputs.values()) {
      const candidate = input.projection;
      if (
        !input.signal.aborted &&
        input.admission.origin.audience.kind === 'owner-private' &&
        candidate &&
        (!value || candidate.memoryRevision >= value.memoryRevision)
      )
        value = candidate;
    }
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
    const candidate = memory.facts.some(
      (fact) => fact.audience && !['owner-private', 'public'].includes(fact.audience.kind),
    )
      ? undefined
      : this.activeProjection();
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
    return this.publicMemory(await this.state('memorySnapshot', { scope: { kind: 'management' } }));
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
      const memory = await this.state('memorySnapshot', { scope: { kind: 'management' } });
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
          (memory.facts.find(
            (f) =>
              f.key === command.key &&
              companionAudienceKey(f.audience ?? { kind: 'owner-private' }) ===
                companionAudienceKey(command.audience ?? { kind: 'owner-private' }),
          )?.revision ?? 0) !== command.expectedFactRevision)
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
    const qqProvider = this.qqStatusProvider;
    const [profile, model, qqValue] = await Promise.all([
      this.profile(),
      this.modelControls?.view(),
      qqProvider?.(),
    ]);
    if (qqProvider && !isQQStatus(qqValue)) throw new KernelFault('invalid-input');
    const qq = qqValue ? structuredClone(qqValue) : undefined;
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
      ...(qq ? { qq } : {}),
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
      ...(qq ? { qq } : {}),
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

  setInputPorts(ports: RuntimeInputPorts): void {
    if (this.inputs.size || this.work.size) throw new KernelFault('conflict');
    this.inputPorts = ports;
  }

  onInputTerminal(listener: (value: RuntimeInputTerminal) => void | Promise<void>): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  /** Called after a committed policy update, independent from transport disconnect/disable. */
  async recheckInputAuthorities(): Promise<void> {
    // Snapshot both collections before a synchronous deny/abort can change either live map.
    const inputs = [...this.inputs.values()];
    const activeWork = [...this.work.values()];
    // Every check starts in this call stack; no grant waits behind another grant's async work.
    await Promise.all([
      ...inputs.map(async (input) => {
        try {
          await checkInputGrant(input.grant);
        } catch {
          input.controller.abort();
        }
      }),
      ...activeWork.map(async (work) => {
        if (!work.authority) return;
        try {
          await checkInputGrant(work.authority);
        } catch {
          work.stopRequested = true;
          work.handle?.cancel('permission-revoked');
        }
      }),
    ]);
  }

  private ownerInputGrant(origin: CompanionInputOrigin): RuntimeInputGrant {
    if (
      origin.principalId !== 'owner' ||
      origin.audience.kind !== 'owner-private' ||
      origin.route.kind !== 'owner-private' ||
      !['owner', 'work-result'].includes(origin.kind)
    ) {
      throw new KernelFault('permission-denied');
    }
    return {
      origin,
      role: origin.kind === 'work-result' ? 'reply-only' : 'owner',
      signal: this.ownerLifetime.signal,
      check: () => {
        if (this.closing) throw new KernelFault('not-ready');
      },
    };
  }

  private async checkInput(input: RuntimeInput): Promise<void> {
    if (input.signal.aborted || this.closing) throw new KernelFault('cancelled');
    if (
      this.inputs.get(input.admission.id) !== input ||
      input.source !== this.selectedHarness ||
      !this.host.manager.isActive(input.owner)
    )
      throw new KernelFault('stale-owner');
    try {
      await checkInputGrant(input.grant);
    } catch (error) {
      input.controller.abort();
      throw error;
    }
    if (
      input.signal.aborted ||
      !this.host.manager.isActive(input.owner) ||
      input.source !== this.selectedHarness
    )
      throw new KernelFault('stale-owner');
  }

  private accessFor(input: RuntimeInput, signal = input.signal): RuntimeInputAccess {
    return {
      scope: inputScope(input.admission.origin),
      signal,
      check: async () => {
        signal.throwIfAborted();
        await this.checkInput(input);
        signal.throwIfAborted();
      },
    };
  }

  private async emitInputTerminal(value: RuntimeInputTerminal): Promise<void> {
    for (const listener of this.inputListeners) {
      try {
        await listener(value);
      } catch {
        this.observerFailures++;
      }
    }
  }

  private finishInput(
    input: RuntimeInput,
    value: Omit<HarnessInputTerminal, 'contextId'> & { readonly contextId: string | null },
  ): Promise<void> {
    if (value.inputId !== input.admission.id || value.contextId !== input.contextId) {
      return Promise.reject(new KernelFault('permission-denied'));
    }
    if (input.terminal) return input.terminal;
    input.terminal = (async () => {
      const updated = await this.state('updateInput', {
        id: input.admission.id,
        phase: value.cleanup === 'failed' ? 'unknown' : value.status,
        cleanup: value.cleanup,
        error: value.error,
      });
      input.admission = updated;
      this.memoryAdmissions.delete(updated.id);
      delete input.projection;
      if (value.cleanup === 'settled') this.inputs.delete(updated.id);
      input.controller.abort();
      const event: RuntimeInputTerminal = {
        grant: input.grant,
        admission: updated,
        contextId: input.contextId,
        outputs: [...input.outputs],
      };
      await this.emitInputTerminal(event);
      this.notify();
    })();
    return input.terminal;
  }

  /** Private host entry; the grant is a captured policy callback, never participant JSON. */
  async dispatchReadyInput(id: string, grant: RuntimeInputGrant): Promise<{ queued: boolean }> {
    if (grant.origin.kind === 'owner' || grant.origin.kind === 'legacy-unknown')
      throw new KernelFault('permission-denied');
    return this.dispatchInput(id, grant);
  }

  private async dispatchInput(
    id: string,
    offered: RuntimeInputGrant,
  ): Promise<{ queued: boolean }> {
    if (!isCompanionRecordId(id) || offered.origin.inputId !== id)
      throw new KernelFault('invalid-input');
    const grant = captureInputGrant(offered, offered.origin);
    await checkInputGrant(grant);
    const scope = inputScope(grant.origin);
    const admission = await this.state('getInput', { id, scope });
    captureInputGrant(grant, admission.origin);
    await checkInputGrant(grant);
    if (admission.phase !== 'ready' || this.inputs.has(id)) return { queued: false };
    const message = await this.state('inputMessage', { id, scope });
    await checkInputGrant(grant);
    this.requireInteraction();
    const source = this.selectedHarness;
    const selected = this.harness();
    const owner = this.host.manager.get({
      pluginId: selected.pluginId,
      instanceId: 'default',
    })?.owner;
    if (!owner || !this.host.manager.isActive(owner)) throw new KernelFault('stale-owner');
    const cueEnd =
      ['owner', 'admin'].includes(grant.role) && ['owner', 'qq'].includes(admission.origin.kind)
        ? memoryCue(message.text)
        : null;
    const baseline = cueEnd === null ? undefined : await this.state('memorySnapshot', { scope });
    await checkInputGrant(grant);
    if (this.inputs.has(id)) return { queued: false };
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, grant.signal]);
    const input: RuntimeInput = {
      admission,
      message,
      grant,
      controller,
      signal,
      source,
      owner,
      outputs: [],
      contextId: null,
      claimed: false,
      bound: false,
    };
    this.inputs.set(id, input);
    if (baseline && cueEnd !== null)
      this.memoryAdmissions.set(id, { text: message.text, cueEnd, baseline, source, owner });
    try {
      await this.checkInput(input);
      this.agentStatus = 'busy';
      this.notify();
      payload<null>(
        await this.host.call(
          HARNESS_CAPABILITY,
          'accept',
          json({
            id,
            text: message.text,
            kind: admission.origin.kind === 'work-result' ? 'work-result' : 'user',
            ...(admission.origin.kind === 'work-result' ? { taskId: admission.origin.taskId } : {}),
          }),
        ),
      );
      return { queued: true };
    } catch (error) {
      if (!input.terminal && input.contextId === null)
        await this.finishInput(input, {
          inputId: id,
          contextId: null,
          status: 'failed',
          cleanup: 'settled',
          error: fault(error),
        });
      throw error;
    }
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
      const accepted = await this.state('acceptMessage', command);
      if (accepted.receipt.status === 'duplicate') return accepted.receipt;
      try {
        const origin = accepted.message.origins?.[0];
        if (!origin || origin.kind !== 'owner') throw new KernelFault('permission-denied');
        await this.dispatchInput(accepted.message.id, this.ownerInputGrant(origin));
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

  /** Native execution-provider port; an execution ID alone is never material authority. */
  async readWorkMaterial(
    request: CloudMaterialReadRequest,
    consume: (source: CloudMaterialSource) => Promise<void>,
  ): Promise<Result<null>> {
    let consumption: Promise<void> | undefined;
    let open = true;
    let consumed = false;
    let misuse = false;
    try {
      const work = this.work.get(request.executionId);
      const handle = work?.handle;
      const captured = work?.materials;
      const authority = work?.authority;
      const entry = captured?.entries.find((item) =>
        isDeepStrictEqual(item.selection, request.selection),
      );
      if (
        !work ||
        !handle ||
        !captured ||
        !authority ||
        !entry ||
        handle.taskId !== request.task.taskId
      )
        throw new KernelFault('permission-denied');
      const signal = AbortSignal.any([request.task.signal, handle.signal, authority.signal]);
      const live = (): void => {
        if (
          this.work.get(request.executionId) !== work ||
          work.handle !== handle ||
          handle.taskId !== request.task.taskId ||
          !handle.snapshot().workPending
        )
          throw new KernelFault('permission-denied');
        if (this.closing || work.stopRequested || signal.aborted)
          throw new KernelFault('cancelled');
      };
      const access: RuntimeInputAccess = {
        signal,
        scope: {
          kind: 'conversation',
          audience: captured.origin.audience,
          principalId: captured.origin.principalId,
        },
        check: async () => {
          live();
          await this.checkWorkAuthority(work);
          live();
        },
      };
      const currentMaterial = async (): Promise<void> => {
        await access.check();
        const stored = await this.state(
          'getMaterial',
          { id: entry.material.id, scope: access.scope },
          signal,
        );
        await access.check();
        if (stored.phase !== 'ready' || !isDeepStrictEqual(stored.reference, entry.material))
          throw new KernelFault('permission-denied');
      };
      await currentMaterial();
      const result = await captured.read(
        structuredClone({
          executionId: request.executionId,
          selection: entry.selection,
          material: entry.material,
          origin: captured.origin,
        }),
        access,
        (source) => {
          if (!open || consumed) {
            misuse = true;
            const rejected = Promise.reject(new KernelFault('invalid-input'));
            void rejected.catch(() => {});
            return rejected;
          }
          consumed = true;
          consumption = (async () => {
            await access.check();
            if (
              source.sizeBytes !== entry.material.sizeBytes ||
              source.sha256 !== entry.material.sha256
            )
              throw new KernelFault('invalid-input');
            const checked: CloudMaterialSource = {
              sizeBytes: source.sizeBytes,
              sha256: source.sha256,
              chunks: source.chunks,
              check: async () => {
                await access.check();
                await source.check();
                await access.check();
              },
            };
            await checked.check();
            await consume(checked);
            await checked.check();
          })();
          // Retain the physical join even if a host reader returns without awaiting its callback.
          void consumption.catch(() => {});
          return consumption;
        },
      );
      open = false;
      await consumption;
      if (!result.ok) throw new KernelFault(result.error.code);
      if (!consumed || misuse) throw new KernelFault('invalid-input');
      await currentMaterial();
      return { ok: true, value: null };
    } catch (error) {
      open = false;
      await consumption?.catch(() => {});
      return { ok: false, error: fault(error) };
    }
  }

  async startTask(
    command: CompanionTaskCommand,
    signal?: AbortSignal,
  ): Promise<CompanionCommandReceipt> {
    return this.acceptTask(command, signal, undefined);
  }

  private async acceptTask(
    command: WorkTaskCommand,
    signal: AbortSignal | undefined,
    origin: CompanionTaskOrigin | undefined,
    authority?: RuntimeInputGrant,
    materials?: WorkMaterials,
  ): Promise<CompanionCommandReceipt> {
    if (this.closing || this.quiescing === 'state') throw new KernelFault('not-ready');
    signal?.throwIfAborted();
    const safe = json(command) as unknown as WorkTaskCommand;
    if (
      typeof safe.commandId !== 'string' ||
      !safe.commandId ||
      safe.commandId.length > 128 ||
      Object.keys(safe).some(
        (key) =>
          ![
            'commandId',
            'title',
            'code',
            'files',
            'outputs',
            'timeoutMs',
            ...(origin && authority ? ['materials'] : []),
          ].includes(key),
      )
    )
      throw new KernelFault('invalid-input');
    if (authority) await checkInputGrant(authority);
    const executionId = executionIdentity(safe.commandId);
    const pending = this.work.get(executionId) ?? admission();
    this.work.set(executionId, pending);
    pending.callers++;
    try {
      // The reservation precedes the transaction, including snapshots that race its receipt.
      const accepted = await this.state('createTask', {
        ...safe,
        executionId,
        ...(origin ? { origin } : {}),
      });
      if (accepted.receipt.status === 'duplicate') return accepted.receipt;
      // Only the transaction's winning admission supplies this handle's authority and material reader.
      if (authority) pending.authority = authority;
      if (materials) pending.materials = materials;
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

  private async checkWorkAuthority(work: ActiveWork): Promise<void> {
    if (!work.authority) return;
    try {
      await checkInputGrant(work.authority);
    } catch (error) {
      work.stopRequested = true;
      work.handle?.cancel('permission-revoked');
      throw error;
    }
  }

  private async executeTask(
    task: CompanionTask,
    command: WorkTaskCommand,
    pending: ActiveWork,
  ): Promise<void> {
    let observed: JsonValue | undefined;
    try {
      await this.checkWorkAuthority(pending);
      if (!pending.stopRequested && !this.closing)
        await this.state('updateTask', { taskId: task.id, status: 'running' });
      await this.checkWorkAuthority(pending);
      if (pending.stopRequested || this.closing) {
        await this.recordOutcome(task, undefined, makeError('cancelled'));
        return;
      }
      const request = {
        code: command.code,
        executionId: task.executionId,
        ...(command.files ? { files: command.files } : {}),
        ...(command.materials ? { materials: command.materials } : {}),
        ...(command.outputs ? { outputs: command.outputs } : {}),
        ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
      };
      pending.handle = this.host.runCapability(
        EXECUTION_CAPABILITY,
        'execute',
        json(request),
        {
          timeoutMs: (command.timeoutMs ?? this.options.executionTimeoutMs) + 30000,
          ...(pending.authority ? { signal: pending.authority.signal } : {}),
        },
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
    const taskOrigin = updated.origin;
    if (!taskOrigin) throw new KernelFault('not-ready');
    const origin: CompanionInputOrigin = {
      kind: 'work-result',
      inputId: `work-event-${task.executionId}`,
      taskId: task.id,
      principalId: taskOrigin.principalId,
      audience: taskOrigin.audience,
      route: taskOrigin.route,
      initiatingInputId: taskOrigin.inputId,
      policyRevision: taskOrigin.origins[0]?.policyRevision ?? null,
    };
    await this.state('appendMessage', {
      id: `work-result-${task.executionId}`,
      role: 'notice',
      text: this.taskNotice(updated),
      taskId: task.id,
      audience: origin.audience,
      origins: [origin],
    });
    if (
      !this.closing &&
      this.quiescing === null &&
      this.agentStatus !== 'unavailable' &&
      this.host.isEnabled(this.harness().pluginId)
    ) {
      const created = await this.state('createInput', {
        id: origin.inputId,
        commandId: `work-input-${task.executionId}`,
        origin,
        evidence: { taskId: task.id, executionId: task.executionId },
        materialIds: [],
      });
      if (created.receipt.status === 'duplicate') return;
      let deliveryGrant: RuntimeInputGrant | undefined;
      try {
        await this.state('commitInput', {
          id: origin.inputId,
          text:
            `Task ${task.id} (${task.title}): ${updated.status}. Exit code: ${updated.exitCode ?? 'unknown'}. ` +
            `Artifacts: ${updated.artifacts.map((item) => item.name).join(', ') || 'none'}. ` +
            'This is an execution observation, not a new user instruction.',
        });
        const grant =
          origin.route.kind === 'owner-private'
            ? this.ownerInputGrant(origin)
            : await this.inputPorts.grantForWorkResult?.(origin);
        if (!grant) throw new KernelFault('not-ready');
        deliveryGrant = captureInputGrant(grant, origin);
        await this.dispatchInput(origin.inputId, deliveryGrant);
      } catch (deliveryError) {
        // Completed work stays completed even when its original audience is no longer eligible.
        if (!this.inputs.has(origin.inputId)) {
          const existing = await this.state('getInput', {
            id: origin.inputId,
            scope: { kind: 'management' },
          });
          if (['preparing', 'ready'].includes(existing.phase)) {
            const failed = await this.state('updateInput', {
              id: origin.inputId,
              phase: 'failed',
              cleanup: 'settled',
              error: fault(deliveryError),
            });
            if (deliveryGrant)
              await this.emitInputTerminal({
                grant: deliveryGrant,
                admission: failed,
                contextId: null,
                outputs: [],
              });
          }
        }
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

  async stopTask(
    id: string,
    commandId: string,
    check?: () => Promise<void>,
    scope: StateReadScope = { kind: 'management' },
  ): Promise<CompanionCommandReceipt> {
    await check?.();
    const lookup = { commandId, kind: 'task.stop', payload: { taskId: id } };
    // Detect a reused ID before effects, but converge again if an earlier application failed.
    await this.state('getCommand', lookup);
    await check?.();
    const task = await this.state('getTask', { id, scope });
    await check?.();
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
      queueSignal: (inputId) => {
        current();
        const registered = this.inputs.get(inputId);
        if (
          !registered ||
          registered.source !== source ||
          registered.owner.generation !== owner.generation
        )
          throw new KernelFault('permission-denied');
        return registered.signal;
      },
      inputRejected: async (inputId, contextId, error) => {
        const registered = this.inputs.get(inputId);
        if (
          !registered ||
          registered.source !== source ||
          registered.owner.generation !== owner.generation ||
          registered.bound ||
          (registered.contextId !== null && registered.contextId !== contextId)
        )
          throw new KernelFault('permission-denied');
        registered.contextId = contextId;
        if (!registered.claimed && registered.admission.phase !== 'ready') {
          this.inputs.delete(inputId);
          this.memoryAdmissions.delete(inputId);
          return;
        }
        await this.finishInput(registered, {
          inputId,
          contextId,
          status:
            error.code === 'cancelled' || error.code === 'permission-denied'
              ? 'cancelled'
              : 'failed',
          cleanup: 'settled',
          error,
        });
      },
      bindInput: async (input, contextId) => {
        current();
        if (!isCompanionRecordId(contextId)) throw new KernelFault('invalid-input');
        const registered = this.inputs.get(input.id);
        if (
          !registered ||
          registered.source !== source ||
          registered.owner.generation !== owner.generation ||
          registered.contextId !== null ||
          registered.message.text !== input.text ||
          (registered.admission.origin.kind === 'work-result'
            ? input.kind !== 'work-result' || input.taskId !== registered.admission.origin.taskId
            : input.kind !== 'user' || input.taskId !== undefined)
        )
          throw new KernelFault('permission-denied');
        registered.contextId = contextId;
        await this.checkInput(registered);
        const claim = await scoped(STATE_CAPABILITY, (signal) =>
          this.state('claimInput', { id: input.id }, AbortSignal.any([signal, registered.signal])),
        );
        registered.admission = claim.admission;
        registered.claimed = claim.claimed;
        if (!claim.claimed) throw new KernelFault('conflict');
        await this.checkInput(registered);
        const images = await this.resolveInputMaterials(registered);
        await this.checkInput(registered);
        const currentNotes = await scoped(STATE_CAPABILITY, (signal) =>
          this.state(
            'inputNotices',
            {
              id: input.id,
              scope: inputScope(registered.admission.origin),
            },
            AbortSignal.any([signal, registered.signal]),
          ),
        );
        await this.checkInput(registered);
        registered.bound = true;
        return {
          origin: structuredClone(registered.admission.origin),
          role: registered.grant.role,
          signal: registered.signal,
          ports: this.inputHarnessPorts(registered, profile),
          currentMaterials: structuredClone(registered.message.materials ?? []),
          currentNotes,
          ...(images.length ? { resolvedInput: images } : {}),
          terminal: (value) => this.finishInput(registered, value),
        } satisfies HarnessInputBinding;
      },
      bootstrapRetired: () => {
        issuedMemoryRevision = undefined;
        if (
          this.projection?.source !== source ||
          this.projection.owner.generation !== owner.generation
        )
          return;
        this.projection = undefined;
        this.memoryApplicationError = makeError('not-ready');
        this.profileApplicationError = makeError('not-ready');
        this.notify();
      },
      finishInputs: () => {},
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
        if ([...this.inputs.values()].some((input) => input.bound))
          throw new KernelFault('permission-denied');
        let value: StateMethodOutputs['snapshot'];
        if (this.host.manager.get(identity)?.state === 'activating') {
          const epoch = this.host.bootstrapGrant(owner, STATE_CAPABILITY);
          if (epoch === null) throw new KernelFault('permission-denied');
          value = await this.state('snapshot', { scope: OWNER_INPUT_SCOPE });
          current();
          if (this.host.bootstrapGrant(owner, STATE_CAPABILITY) !== epoch)
            throw new KernelFault('permission-denied');
        } else
          value = await scoped(STATE_CAPABILITY, (signal) =>
            this.state('snapshot', { scope: OWNER_INPUT_SCOPE }, signal),
          );
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
      publish: async () => {
        throw new KernelFault('permission-denied');
      },
      startWork: async () => {
        throw new KernelFault('permission-denied');
      },
      stopWork: async () => {
        throw new KernelFault('permission-denied');
      },
      rememberFact: async () => {
        throw new KernelFault('permission-denied');
      },
      status: (status, error) => {
        if (this.selectedHarness !== source || this.closing || !this.host.manager.isActive(owner))
          return;
        this.agentStatus = status;
        this.agentError = error ?? null;
        this.notify();
      },
    };
  }

  private assertCorrelation(input: RuntimeInput, origin: Pick<HarnessOrigin, 'inputIds'>): void {
    if (origin.inputIds.length !== 1 || origin.inputIds[0] !== input.admission.id)
      throw new KernelFault('permission-denied');
  }

  private async resolveInputMaterials(
    input: RuntimeInput,
  ): Promise<readonly HarnessResolvedImage[]> {
    return withSourceAuthority(
      this.host,
      input.owner.pluginId,
      [{ kind: 'capability-use', capability: STATE_CAPABILITY }],
      async (signal) => {
        await this.checkInput(input);
        let image = false;
        for (const id of input.admission.materialIds) {
          const material = await this.state(
            'getMaterial',
            { id, scope: inputScope(input.admission.origin) },
            signal,
          );
          await this.checkInput(input);
          if (material.phase !== 'ready' || !material.reference) throw new KernelFault('not-ready');
          if (
            !isDeepStrictEqual(
              material.reference,
              input.message.materials?.find((item) => item.id === id),
            )
          )
            throw new KernelFault('conflict');
          if (material.reference.kind === 'image') image = true;
        }
        if (!image) return [];
        if (!this.inputPorts.resolveInput) throw new KernelFault('not-ready');
        const images = await this.inputPorts.resolveInput(
          input.admission,
          this.accessFor(input, signal),
        );
        await this.checkInput(input);
        if (!images.length) throw new KernelFault('not-ready');
        return images;
      },
      { signal: input.signal },
    );
  }

  private async resolveReplyMaterials(
    input: RuntimeInput,
    selections: readonly HarnessReplyAttachment[],
    signal: AbortSignal,
  ): Promise<CompanionMaterialRef[]> {
    if (!Array.isArray(selections) || selections.length > COMPANION_INPUT_MATERIAL_MAX)
      throw new KernelFault('invalid-input');
    if (!selections.length) return [];
    const resolve = this.inputPorts.resolveReplyAttachment;
    if (!resolve) throw new KernelFault('not-ready');
    const origin = input.admission.origin;
    const scope = inputScope(origin);
    const seen = new Set<string>();
    const materials: CompanionMaterialRef[] = [];
    for (const value of selections) {
      const selection: HarnessReplyAttachment = value;
      if (
        !selection ||
        Object.keys(selection).length !== 2 ||
        !['material', 'artifact'].includes(selection.kind) ||
        !isCompanionRecordId(selection.id)
      )
        throw new KernelFault('invalid-input');
      const key = `${selection.kind}:${selection.id}`;
      if (seen.has(key)) throw new KernelFault('invalid-input');
      seen.add(key);
      let expected: {
        sizeBytes: number;
        mediaType: string;
        sha256?: string;
        kind?: CompanionMaterialRef['kind'];
      };
      if (selection.kind === 'material') {
        const stored = await this.state('getMaterial', { id: selection.id, scope }, signal);
        await this.checkInput(input);
        if (stored.phase !== 'ready' || !stored.reference) throw new KernelFault('not-ready');
        if (stored.reference.kind === 'voice') throw new KernelFault('unavailable');
        expected = stored.reference;
        if (origin.kind === 'work-result') {
          const task = await this.state('getTask', { id: origin.taskId, scope }, signal);
          await this.checkInput(input);
          if (
            stored.inputId !== origin.inputId &&
            stored.inputId !== origin.initiatingInputId &&
            !task.origin?.materialIds.includes(selection.id)
          )
            throw new KernelFault('permission-denied');
        }
      } else {
        const artifact = await this.state('getArtifact', { id: selection.id, scope }, signal);
        await this.checkInput(input);
        const task = await this.state('getTask', { id: artifact.taskId, scope }, signal);
        await this.checkInput(input);
        if (
          task.origin?.principalId !== origin.principalId ||
          (origin.kind === 'work-result' && artifact.taskId !== origin.taskId)
        )
          throw new KernelFault('permission-denied');
        if (task.status !== 'completed') throw new KernelFault('unavailable');
        expected = artifact;
      }
      const material = await resolve.call(
        this.inputPorts,
        structuredClone(selection),
        structuredClone(origin),
        this.accessFor(input, signal),
      );
      await this.checkInput(input);
      if (material?.kind === 'voice') throw new KernelFault('unavailable');
      if (
        !isCompanionMaterialRef(material) ||
        companionAudienceKey(material.audience) !== companionAudienceKey(origin.audience) ||
        !isDeepStrictEqual(material.originInputIds, [input.admission.id]) ||
        material.sizeBytes !== expected.sizeBytes ||
        material.mediaType !== expected.mediaType ||
        (expected.sha256 !== undefined && material.sha256 !== expected.sha256) ||
        (expected.kind !== undefined && material.kind !== expected.kind)
      )
        throw new KernelFault('invalid-input');
      const stored = await this.state('getMaterial', { id: material.id, scope }, signal);
      await this.checkInput(input);
      if (stored.phase !== 'ready' || !isDeepStrictEqual(stored.reference, material))
        throw new KernelFault('conflict');
      if (!materials.some((previous) => previous.id === material.id)) materials.push(material);
    }
    return materials;
  }

  private async publishInput(
    input: RuntimeInput,
    output: HarnessOutput,
    signal: AbortSignal,
  ): Promise<void> {
    this.assertCorrelation(input, output);
    const origin = input.admission.origin;
    if (
      output.taskId !== undefined &&
      (origin.kind !== 'work-result' || output.taskId !== origin.taskId)
    )
      throw new KernelFault('permission-denied');
    if (
      !isCompanionRecordId(output.id) ||
      !output.text.trim() ||
      Buffer.from(output.text, 'utf8').toString('utf8') !== output.text
    )
      throw new KernelFault('invalid-input');
    if (Buffer.byteLength(output.text, 'utf8') > COMPANION_FULL_TEXT_MAX_BYTES)
      throw new KernelFault('quota-exceeded');
    let text = output.text;
    let materials: readonly CompanionMaterialRef[] = await this.resolveReplyMaterials(
      input,
      output.attachments ?? [],
      signal,
    );
    let content: CompanionMessageContent = { kind: 'inline-text' };
    const canonical = {
      id: output.id,
      role: 'assistant' as const,
      inputId: input.admission.id,
      taskId: origin.kind === 'work-result' ? origin.taskId : null,
      audience: origin.audience,
      origins: [origin],
    };
    // Full provenance consumes the same record budget as text. Choose a stable shape before any write.
    const inlineBytes = Buffer.byteLength(
      JSON.stringify({
        ...canonical,
        text,
        materials,
        content,
        createdAt: Number.MAX_SAFE_INTEGER,
      }),
      'utf8',
    );
    if (text.length > COMPANION_MAX_TEXT || inlineBytes > STATE_MAX_MESSAGE_BYTES) {
      if (!this.inputPorts.storeFullText) throw new KernelFault('not-ready');
      const material = await this.inputPorts.storeFullText(
        { id: output.id, text, origin },
        this.accessFor(input, signal),
      );
      await this.checkInput(input);
      if (
        !isCompanionMaterialRef(material) ||
        material.kind !== 'text' ||
        material.sizeBytes !== Buffer.byteLength(text, 'utf8') ||
        material.sha256 !== createHash('sha256').update(text, 'utf8').digest('hex') ||
        companionAudienceKey(material.audience) !== companionAudienceKey(origin.audience) ||
        !isDeepStrictEqual(material.originInputIds, [input.admission.id])
      )
        throw new KernelFault('invalid-input');
      const stored = await this.state(
        'getMaterial',
        { id: material.id, scope: inputScope(origin) },
        signal,
      );
      await this.checkInput(input);
      if (stored.phase !== 'ready' || !isDeepStrictEqual(stored.reference, material))
        throw new KernelFault('conflict');
      content = { kind: 'text-document', material };
      materials = [material, ...materials.filter((item) => item.id !== material.id)];
      text = '完整回复已保存为文本材料，请打开附件查看。';
    }
    if (
      materials.length > COMPANION_INPUT_MATERIAL_MAX ||
      materials.reduce((bytes, material) => bytes + material.sizeBytes, 0) >
        COMPANION_MATERIAL_INPUT_MAX_BYTES
    )
      throw new KernelFault('quota-exceeded');
    await this.checkInput(input);
    const committed = await this.state(
      'appendMessage',
      { ...canonical, text, materials, content },
      signal,
    );
    if (!input.outputs.some((message) => message.id === committed.id))
      input.outputs.push(committed);
  }

  private async captureWorkMaterials(
    input: RuntimeInput,
    request: HarnessWorkRequest,
    signal: AbortSignal,
  ): Promise<Omit<WorkMaterials, 'origin'> | undefined> {
    const selections = request.materials ?? [];
    if (!Array.isArray(selections) || selections.length > COMPANION_TASK_MATERIAL_MAX)
      throw new KernelFault('invalid-input');
    if (!selections.length) return undefined;
    const readerPorts = this.inputPorts;
    const read = readerPorts.readWorkMaterial?.bind(readerPorts);
    if (!read) throw new KernelFault('not-ready');
    const entries: { selection: CompanionMaterialSelection; material: CompanionMaterialRef }[] = [];
    const ids = new Set<string>();
    const names = (request.files ?? []).map((file) => file.path);
    let bytes = (request.files ?? []).reduce(
      (sum, file) => sum + Buffer.byteLength(file.content, 'utf8'),
      0,
    );
    for (const value of selections) {
      const selection: CompanionMaterialSelection = value;
      if (
        !selection ||
        Object.keys(selection).length !== 2 ||
        !isCompanionRecordId(selection.materialId) ||
        typeof selection.inputName !== 'string' ||
        selection.inputName.length > 240 ||
        !selection.inputName
          .split('/')
          .every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part)) ||
        ids.has(selection.materialId) ||
        names.some(
          (name) =>
            name === selection.inputName ||
            name.startsWith(`${selection.inputName}/`) ||
            selection.inputName.startsWith(`${name}/`),
        )
      )
        throw new KernelFault('invalid-input');
      ids.add(selection.materialId);
      names.push(selection.inputName);
      const stored = await this.state(
        'getMaterial',
        { id: selection.materialId, scope: inputScope(input.admission.origin) },
        signal,
      );
      await this.checkInput(input);
      if (
        stored.phase !== 'ready' ||
        !stored.reference ||
        !isCompanionMaterialRef(stored.reference)
      )
        throw new KernelFault('not-ready');
      bytes += stored.reference.sizeBytes;
      if (bytes > COMPANION_MATERIAL_INPUT_MAX_BYTES) throw new KernelFault('quota-exceeded');
      entries.push(structuredClone({ selection, material: stored.reference }));
    }
    return { entries, read };
  }

  private inputHarnessPorts(
    input: RuntimeInput,
    profile: ProfileBinding,
  ): CorticoHarnessInputPorts {
    let issuedMemoryRevision: number | undefined;
    const synchronousCurrent = (): void => {
      if (
        input.signal.aborted ||
        this.inputs.get(input.admission.id) !== input ||
        input.source !== this.selectedHarness ||
        !this.host.manager.isActive(input.owner)
      )
        throw new KernelFault('stale-owner');
    };
    const scoped = async <T>(
      capability: string,
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      await this.checkInput(input);
      const capabilities =
        capability === EXECUTION_CAPABILITY
          ? [STATE_CAPABILITY, EXECUTION_CAPABILITY]
          : [capability];
      return withSourceAuthority(
        this.host,
        input.owner.pluginId,
        capabilities.map((id) => ({ kind: 'capability-use' as const, capability: id })),
        async (signal) => {
          await this.checkInput(input);
          const value = await operation(signal);
          await this.checkInput(input);
          return value;
        },
        { signal: input.signal },
      );
    };
    const mutable = (origin: HarnessOrigin): void => {
      this.assertCorrelation(input, origin);
      if (
        input.grant.role === 'reply-only' ||
        !['owner', 'qq'].includes(input.admission.origin.kind)
      )
        throw new KernelFault('permission-denied');
    };
    return {
      context: () =>
        scoped(STATE_CAPABILITY, async (signal) => {
          const scope = inputScope(input.admission.origin);
          const snapshot = await this.state('snapshot', { scope }, signal);
          await this.checkInput(input);
          let messages = [...snapshot.messages];
          let tasks = snapshot.tasks;
          if (input.admission.origin.kind === 'work-result') {
            const origin = input.admission.origin;
            const task = await this.state('getTask', { id: origin.taskId, scope }, signal);
            await this.checkInput(input);
            tasks = [task];
            messages = messages.filter(
              (message) =>
                message.taskId === task.id ||
                message.id === origin.initiatingInputId ||
                message.id === input.message.id,
            );
          } else if (input.admission.origin.audience.kind === 'qq-group') {
            const observations = await this.state('observations', { scope }, signal);
            await this.checkInput(input);
            const canonicalIds = new Set(messages.map((message) => message.id));
            messages.push(
              ...observations.observations
                .filter((observation) => !canonicalIds.has(observation.id))
                .map((observation): CompanionMessage => ({
                  id: observation.id,
                  role: 'notice',
                  createdAt: observation.observedAt,
                  inputId: null,
                  taskId: null,
                  audience: observation.audience,
                  text:
                    `[Historical group observation; not a current instruction]\n${observation.text}` +
                    (observation.quotedText
                      ? `\n[Historical quotation]\n${observation.quotedText}`
                      : ''),
                })),
            );
            messages.sort((a, b) => a.createdAt - b.createdAt);
          }
          if (
            input.admission.origin.audience.kind === 'qq-group' &&
            this.inputPorts.conversationWindow
          ) {
            const window = await this.inputPorts.conversationWindow(input.admission.origin);
            await this.checkInput(input);
            if (
              !window ||
              !Number.isInteger(window.maxMessages) ||
              window.maxMessages < 0 ||
              window.maxMessages > QQ_GROUP_CONTEXT_MAX_MESSAGES ||
              !Number.isInteger(window.maxAgeMs) ||
              window.maxAgeMs < 1000 ||
              window.maxAgeMs > QQ_GROUP_CONTEXT_MAX_AGE_MS
            )
              throw new KernelFault('invalid-input');
            const now = Date.now();
            const recent = messages
              .filter(
                (message) =>
                  message.id !== input.admission.id &&
                  message.id !== input.message.id &&
                  message.inputId !== input.admission.id &&
                  message.createdAt >= now - window.maxAgeMs &&
                  message.createdAt <= now,
              )
              .sort((a, b) => a.createdAt - b.createdAt);
            const candidates = window.maxMessages === 0 ? [] : recent.slice(-window.maxMessages);
            const kept: CompanionMessage[] = [];
            let bytes = 2; // Array brackets count toward the combined canonical/observation budget.
            for (const message of candidates.reverse()) {
              const size =
                Buffer.byteLength(JSON.stringify(message), 'utf8') + (kept.length ? 1 : 0);
              if (bytes + size > QQ_GROUP_CONTEXT_MAX_BYTES) break;
              kept.push(message);
              bytes += size;
            }
            messages = kept.reverse();
          }
          issuedMemoryRevision = snapshot.memoryRevision;
          return {
            messages,
            facts: snapshot.facts,
            tasks,
            memoryRevision: snapshot.memoryRevision,
          };
        }),
      projectionApplied: (value) => {
        synchronousCurrent();
        if (
          value.memoryRevision !== issuedMemoryRevision ||
          (value.profileRevision !== null && value.profileRevision !== profile.revision)
        )
          throw new KernelFault('conflict');
        input.projection = {
          source: input.source,
          owner: input.owner,
          profile,
          profileRevision: value.profileRevision,
          memoryRevision: value.memoryRevision,
        };
        if (input.admission.origin.audience.kind === 'owner-private') {
          this.memoryApplicationError = null;
          this.profileApplicationError =
            value.profileRevision === null ? makeError('not-ready') : null;
        }
        this.notify();
      },
      projectionFailed: (value) => {
        // A postcommit refresh can fail before a new snapshot is issued; it still describes the canonical revision.
        if (input.signal.aborted || value.memoryRevision !== this.latestMemoryRevision) return;
        delete input.projection;
        if (input.admission.origin.audience.kind === 'owner-private')
          this.memoryApplicationError = value.error;
        this.notify();
      },
      finishInputs: (ids) => {
        if (ids.some((id) => id !== input.admission.id)) throw new KernelFault('permission-denied');
        if (ids.includes(input.admission.id)) this.memoryAdmissions.delete(input.admission.id);
      },
      publish: (output) =>
        scoped(STATE_CAPABILITY, (signal) => this.publishInput(input, output, signal)),
      startWork: (request, origin) =>
        scoped(EXECUTION_CAPABILITY, async (signal) => {
          mutable(origin);
          let prepared = request;
          if (input.admission.materialIds.length || request.materials?.length) {
            if (!this.inputPorts.prepareWork) throw new KernelFault('not-ready');
            prepared = await this.inputPorts.prepareWork(
              input.admission,
              request,
              this.accessFor(input, signal),
            );
            await this.checkInput(input);
          }
          const selectedMaterials = await this.captureWorkMaterials(input, prepared, signal);
          const source = input.admission.origin;
          if (!source.principalId) throw new KernelFault('permission-denied');
          const taskOrigin: CompanionTaskOrigin = {
            inputId: input.admission.id,
            principalId: source.principalId,
            audience: source.audience,
            route: source.route,
            origins: [source],
            materialIds: selectedMaterials?.entries.map((entry) => entry.material.id) ?? [],
          };
          const commandId = `work-${createHash('sha256')
            .update(JSON.stringify([input.admission.id, origin.id]))
            .digest('hex')}`;
          return this.acceptTask(
            { ...prepared, commandId },
            input.grant.signal,
            taskOrigin,
            input.grant,
            selectedMaterials
              ? { ...selectedMaterials, origin: structuredClone(taskOrigin) }
              : undefined,
          );
        }),
      stopWork: (id, origin) =>
        scoped(EXECUTION_CAPABILITY, async (signal) => {
          mutable(origin);
          const task = await this.state(
            'getTask',
            { id, scope: inputScope(input.admission.origin) },
            signal,
          );
          await this.checkInput(input);
          if (task.origin?.principalId !== input.admission.origin.principalId)
            throw new KernelFault('permission-denied');
          const commandId = `stop-${createHash('sha256')
            .update(JSON.stringify([input.admission.id, origin.id, id]))
            .digest('hex')}`;
          return this.stopTask(
            id,
            commandId,
            () => this.checkInput(input),
            inputScope(input.admission.origin),
          );
        }),
      rememberFact: (key, value, origin) =>
        scoped(STATE_CAPABILITY, async (signal) => {
          mutable(origin);
          if (!['owner', 'admin'].includes(input.grant.role))
            throw new KernelFault('permission-denied');
          const admission = this.memoryAdmissions.get(input.admission.id);
          if (
            !admission ||
            admission.source !== input.source ||
            admission.owner.generation !== input.owner.generation
          )
            throw new KernelFault('permission-denied');
          const start = admission.text.indexOf(value, admission.cueEnd);
          if (start < admission.cueEnd || !value.trim()) throw new KernelFault('permission-denied');
          const audience = input.admission.origin.audience;
          const command = memoryCommand(
            {
              commandId: `memory-${createHash('sha256')
                .update(JSON.stringify([input.admission.id, key.trim(), value]))
                .digest('hex')}`,
              key,
              value,
              expectedMemoryRevision: admission.baseline.memoryRevision,
              expectedFactRevision:
                admission.baseline.facts.find(
                  (fact) =>
                    fact.key === key.trim() &&
                    companionAudienceKey(fact.audience ?? { kind: 'owner-private' }) ===
                      companionAudienceKey(audience),
                )?.revision ?? 0,
            },
            false,
          );
          await this.checkInput(input);
          const result = await this.state(
            'rememberFact',
            {
              ...command,
              audience,
              origin: {
                kind: 'user-input',
                inputId: input.admission.id,
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
      this.inputs.size ||
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
      (this.work.size || this.inputs.size || this.pendingInputs || this.agentStatus === 'busy')
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
      const patch: JsonObject = { disabledPlugins: [...disabled].sort() };
      if (this.options.optionalPluginIds?.includes(id)) {
        const optional = new Set(
          Array.isArray(profile.data['enabledOptionalPlugins'])
            ? profile.data['enabledOptionalPlugins'].filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        );
        if (enabled) optional.add(id);
        else optional.delete(id);
        patch['enabledOptionalPlugins'] = [...optional].sort();
      }
      await this.saveProfile(patch);
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
    this.clearProjection();
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
    this.ownerLifetime.abort();
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
    this.inputListeners.clear();
  }
}

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  LOCAL_AGENT_LINK_PLUGIN_ID,
  LOCAL_AGENT_LINK_CREDENTIAL_ID,
  LOCAL_HOST_PROTOCOL_VERSION,
  COMPANION_INPUT_READY_MAX,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  isQQAccountRef,
  isCompanionRecordId,
  isQQInputReceipt,
  sameQQAccount,
  makeError,
  type JsonValue,
  type KernelError,
  type OwnerRef,
  type TaskContext,
  type LocalHostRuntimeIdentity,
  type LocalHostQQSourceOffer,
  type LocalHostQQMaterialRead,
  type LocalHostQQMaterialOffer,
  type LocalHostQQMaterialComplete,
  type LocalAgentLinkTarget,
  type LocalAgentLinkView,
  type QQInputReceipt,
} from '@pet/contracts';
import {
  isRecord,
  jsonPreflight,
  validateLocalHostSourceBinding,
  validateStreamHeader,
} from '@pet/contracts/validation';
import {
  CredentialBroker,
  CredentialError,
  MemoryCiphertextStore,
  credentialPermissionAuthorizer,
  KernelFault,
  type TaskHandle,
  type RpcHandler,
} from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import type { LocalAgentLinkPorts } from '@pet/local-agent-link';
import type { OfficialMessageEvent } from '@pet/qq-official';
import type { OneBotFrame, OneBotResponse, SnowMediaDownloadInput } from '@pet/qq-onebot';
import { connectAgentBridge } from './bridge-handshake.js';
import type { BridgeChannel } from './bridge-channel.js';
import { checkRemoteAuthority } from './authority-check.js';
import { withQqOperationCheck } from './qq-native/index.js';
import type { LocalPluginKernel, LocalQQSourceId } from './kernel.js';
import type { OwnedProcessProvider } from './owned-process.js';
import type {
  LocalQQSourceController,
  LocalCapturedSource,
  LocalCapturedSourceBase,
} from './qq-source.js';
import { mapOfficialInput, mapOneBotInput, type QQMappedInput } from './qq-input.js';
import { projectQQInput, parseQQMaterialSelector } from './qq-input-projection.js';
import type { LocalQQExecutionOwner } from './qq-execution.js';
import {
  parseQQExecutionRequest,
  parseQQExecutionIdentity,
  qqExecutionJson,
} from './qq-execution.js';

const identity = { pluginId: LOCAL_AGENT_LINK_PLUGIN_ID, instanceId: 'default' };
const failure = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const json = (value: unknown): JsonValue => {
  const parsed = jsonPreflight(value);
  if (!parsed.ok) throw new KernelFault('invalid-input');
  return parsed.value;
};
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const parsed = json(value);
  if (!isRecord(parsed) || !exact(parsed, keys)) throw new KernelFault('invalid-input');
  return parsed;
}
function target(value: unknown): LocalAgentLinkTarget {
  const parsed = object(value, ['baseUrl', 'agentId', 'agentEpoch']);
  if (parsed['baseUrl'] === '' && parsed['agentId'] === '' && parsed['agentEpoch'] === '')
    return { baseUrl: '', agentId: '', agentEpoch: '' };
  if (
    typeof parsed['baseUrl'] !== 'string' ||
    !isCompanionRecordId(parsed['agentId']) ||
    !isCompanionRecordId(parsed['agentEpoch'])
  )
    throw new KernelFault('invalid-input');
  const url = new URL(parsed['baseUrl']);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  )
    throw new KernelFault('invalid-input');
  return { baseUrl: url.origin, agentId: parsed['agentId'], agentEpoch: parsed['agentEpoch'] };
}
/** Same range the contracts guards use: C0 controls and DEL are never valid text. */
const noControls = (value: string): boolean =>
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.length || value.length > 4096 || !noControls(value))
    throw new KernelFault('invalid-input');
  return value;
}
function size(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > COMPANION_MATERIAL_INPUT_MAX_BYTES
  )
    throw new KernelFault('invalid-input');
  return value;
}
export interface QQAgentLinkOptions {
  readonly kernel: LocalPluginKernel;
  readonly identity: LocalHostRuntimeIdentity;
  readonly ownedProcess: OwnedProcessProvider;
  readonly sources: Pick<LocalQQSourceController, 'captureSource' | 'view'>;
  readonly execution: Pick<
    LocalQQExecutionOwner,
    'execute' | 'inspect' | 'recover' | 'signalFor' | 'retire' | 'close'
  >;
  changed?(): void;
  onReceipt?(receipt: QQInputReceipt): void;
}
interface InputHolder {
  readonly peer: BridgeChannel;
  readonly source: LocalCapturedSource;
  readonly offered: LocalHostQQSourceOffer;
  readonly mapped: QQMappedInput;
  readonly handles: readonly string[];
  readonly finished: Set<number>;
  readonly active: Set<number>;
  readonly operations: Set<Promise<unknown>>;
  readonly done: Promise<void>;
  finish(): void;
  handle: TaskHandle | null;
  context: TaskContext | null;
}
interface MediaTask {
  readonly peer: BridgeChannel;
  readonly streamId: string;
  readonly handle: TaskHandle;
}

/** Independent daemon connection. No GUI signal, local Core, or conversation State is owned here. */
export class QQAgentLink {
  private context: PluginContext | undefined;
  private target: LocalAgentLinkTarget = { baseUrl: '', agentId: '', agentEpoch: '' };
  private revision = 0;
  private credential = '';
  private credentialVersion = randomUUID();
  private readonly broker: CredentialBroker;
  private readonly processIdentity: ReturnType<OwnedProcessProvider['identity']>;
  private readonly lifetime = new AbortController();
  private readonly holders = new Map<string, InputHolder>();
  private readonly media = new Map<string, MediaTask>();
  private readonly offers = new Map<string, LocalHostQQSourceOffer>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly offCommit: () => void;
  private peer: BridgeChannel | undefined;
  private root: TaskHandle | undefined;
  private phase: LocalAgentLinkView['phase'] = 'disabled';
  private error: KernelError | null = null;
  private controlling = false;
  private syncing: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: QQAgentLinkOptions) {
    this.processIdentity = Object.freeze(structuredClone(options.ownedProcess.identity()));
    this.broker = new CredentialBroker({
      store: new MemoryCiphertextStore(),
      cipher: {
        encrypt: async () => {
          throw new CredentialError('unavailable');
        },
        decrypt: async () => {
          throw new CredentialError('unavailable');
        },
      },
      authorize: credentialPermissionAuthorizer(options.kernel.host.permissions),
    });
    this.offCommit = options.kernel.host.onConfigurationCommit((commit) => {
      if (
        commit.pluginId !== identity.pluginId ||
        commit.instanceId !== identity.instanceId ||
        this.closed
      )
        return;
      if (commit.revision === this.revision && isDeepStrictEqual(commit.data, this.target)) return;
      this.fence();
      this.credential = '';
      this.credentialVersion = randomUUID();
      this.revision = commit.revision;
      try {
        this.target = target(commit.data);
        this.error = null;
      } catch (error) {
        this.error = failure(error);
      }
      this.notify();
    });
  }
  private notify(): void {
    this.options.changed?.();
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.work.add(work);
    void work.then(
      () => this.work.delete(work),
      () => this.work.delete(work),
    );
    return work;
  }
  featurePorts(context: PluginContext): LocalAgentLinkPorts {
    if (
      context.owner.pluginId !== identity.pluginId ||
      context.owner.instanceId !== identity.instanceId
    )
      throw new KernelFault('permission-denied');
    return {
      bind: () => {
        if (this.context || context.signal.aborted) throw new KernelFault('conflict');
        this.context = context;
        this.phase = 'offline';
        const stop = () => this.fence();
        context.signal.addEventListener('abort', stop, { once: true });
        return async () => {
          stop();
          await this.retire();
          context.signal.removeEventListener('abort', stop);
          if (this.context === context) this.context = undefined;
          this.phase = 'disabled';
          this.notify();
        };
      },
      status: async () => json(await this.view()),
    };
  }
  async initialize(): Promise<void> {
    const config = await this.options.kernel.host.configs.get(identity);
    if (!config.ok) throw new KernelFault(config.error.code);
    this.target = target(config.value.data);
    this.revision = config.value.revision;
  }
  private current(peer?: BridgeChannel): PluginContext {
    const context = this.context,
      host = this.options.kernel.host;
    const policy = host.permissionControl.inspect(identity);
    if (
      this.closed ||
      !context ||
      context.signal.aborted ||
      !host.manager.isActive(context.owner) ||
      !host.verifySource(identity.pluginId) ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      (peer && (this.peer !== peer || peer.signal.aborted))
    )
      throw new KernelFault('stale-owner');
    return context;
  }
  private fence(): void {
    const peer = this.peer;
    if (peer) {
      this.options.execution.retire(peer);
      peer.close();
    }
    this.root?.cancel('shutdown');
    for (const holder of this.holders.values()) {
      holder.handle?.cancel('shutdown');
      holder.finish();
    }
    this.offers.clear();
    if (!this.closed) this.phase = 'offline';
  }
  private async retire(): Promise<void> {
    this.fence();
    const root = this.root,
      peer = this.peer;
    await root?.settled;
    await peer?.settled;
    if (this.peer === peer) this.peer = undefined;
    if (this.root === root) this.root = undefined;
    await Promise.allSettled([...this.work]);
  }
  async saveTarget(input: unknown, signal?: AbortSignal): Promise<LocalAgentLinkView> {
    const value = object(input, ['expectedRevision', 'baseUrl', 'agentId', 'agentEpoch']);
    const next = target({
      baseUrl: value['baseUrl'],
      agentId: value['agentId'],
      agentEpoch: value['agentEpoch'],
    });
    if (
      !Number.isSafeInteger(value['expectedRevision']) ||
      this.broker.redactor.containsValue(next)
    )
      throw new KernelFault('invalid-input');
    if (this.controlling) throw new KernelFault('conflict');
    this.controlling = true;
    let off = () => {};
    try {
      signal?.throwIfAborted();
      if (this.closed || value['expectedRevision'] !== this.revision)
        throw new KernelFault('conflict');
      const baseline = this.snapshot();
      const receipt: { value?: LocalAgentLinkView } = {};
      // Config commit observers run synchronously: capture this change's key generation,
      // before retirement or an unrelated later mutation can replace the live view.
      off = this.options.kernel.host.onConfigurationCommit((commit) => {
        if (
          commit.pluginId === identity.pluginId &&
          commit.instanceId === identity.instanceId &&
          commit.revision === (value['expectedRevision'] as number) + 1 &&
          isDeepStrictEqual(commit.data, next)
        )
          receipt.value = this.snapshot();
      });
      const saved = await this.options.kernel.host.configs.save(
        identity,
        { ...next },
        value['expectedRevision'] as number,
      );
      if (!saved.ok) throw new KernelFault(saved.error.code);
      if (saved.value.changeMode === null) {
        if (
          saved.value.snapshot.revision !== baseline.revision ||
          !isDeepStrictEqual(next, baseline.target)
        )
          throw new KernelFault('internal');
        return baseline;
      }
      const committed = receipt.value;
      if (
        !committed ||
        committed.revision !== saved.value.snapshot.revision ||
        !isDeepStrictEqual(committed.target, next)
      )
        throw new KernelFault('internal');
      try {
        await this.retire();
        return { ...committed, phase: this.context ? 'offline' : 'disabled', sessionId: null };
      } catch (error) {
        return { ...committed, phase: 'failed', error: failure(error) };
      }
    } finally {
      off();
      this.controlling = false;
    }
  }
  private intent(
    expectedRevision: unknown,
    expectedCredentialVersion: unknown,
    signal?: AbortSignal,
  ): () => void {
    const captured = {
      revision: this.revision,
      version: this.credentialVersion,
      target: structuredClone(this.target),
    };
    const check = () => {
      signal?.throwIfAborted();
      if (
        this.closed ||
        expectedRevision !== captured.revision ||
        expectedCredentialVersion !== captured.version ||
        this.revision !== captured.revision ||
        this.credentialVersion !== captured.version ||
        !isDeepStrictEqual(this.target, captured.target)
      )
        throw new KernelFault('conflict');
    };
    check();
    return check;
  }
  async saveCredential(input: unknown, signal?: AbortSignal): Promise<LocalAgentLinkView> {
    const value = object(input, ['expectedRevision', 'expectedCredentialVersion', 'value']);
    if (this.controlling) throw new KernelFault('conflict');
    if (
      value['value'] !== null &&
      (typeof value['value'] !== 'string' ||
        Buffer.byteLength(value['value']) < 24 ||
        Buffer.byteLength(value['value']) > 512 ||
        !noControls(value['value']))
    )
      throw new KernelFault('invalid-input');
    this.controlling = true;
    try {
      const check = this.intent(
        value['expectedRevision'],
        value['expectedCredentialVersion'],
        signal,
      );
      await this.retire();
      check();
      this.credential = (value['value'] as string) ?? '';
      this.credentialVersion = randomUUID();
      if (this.credential) this.broker.redactor.add(this.credential);
      this.error = null;
      const committed = this.view();
      this.notify();
      return committed;
    } finally {
      this.controlling = false;
    }
  }
  async connect(
    expectedRevision: number,
    expectedCredentialVersion: string,
    callerSignal?: AbortSignal,
  ): Promise<LocalAgentLinkView> {
    if (this.controlling) throw new KernelFault('conflict');
    this.controlling = true;
    let pending: TaskHandle | undefined;
    const cancel = () => pending?.cancel('user');
    try {
      const checkIntent = this.intent(expectedRevision, expectedCredentialVersion, callerSignal);
      await this.retire();
      checkIntent();
      if (!this.credential || !this.target.baseUrl) throw new KernelFault('not-ready');
      await this.options.ownedProcess.check();
      await this.options.kernel.setEnabled(LOCAL_AGENT_LINK_PLUGIN_ID, true);
      checkIntent();
      callerSignal?.addEventListener('abort', cancel, { once: true });
      const context = this.current(),
        captured = {
          target: this.target,
          revision: this.revision,
          version: this.credentialVersion,
          value: this.credential,
        };
      let resolveReady: () => void = () => {},
        rejectReady: (error: unknown) => void = () => {};
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      let entered = false;
      this.phase = 'connecting';
      this.error = null;
      this.notify();
      const valid = (): void => {
        this.current();
        if (
          this.revision !== captured.revision ||
          this.credentialVersion !== captured.version ||
          !isDeepStrictEqual(this.target, captured.target)
        )
          throw new KernelFault('stale-owner');
      };
      this.root = this.options.kernel.runFor(
        LOCAL_AGENT_LINK_PLUGIN_ID,
        async (task) => {
          entered = true;
          try {
            valid();
            await this.broker.withSecretForHost(
              task.owner,
              [LOCAL_AGENT_LINK_CREDENTIAL_ID],
              LOCAL_AGENT_LINK_CREDENTIAL_ID,
              { taskId: task.taskId, signal: task.signal },
              async (secret, signal) => {
                valid();
                // Handshake callbacks run before the peer is known, so hold it in a const box.
                const connected: { peer?: BridgeChannel } = {};
                const peer = await connectAgentBridge({
                  baseUrl: captured.target.baseUrl,
                  token: secret,
                  hello: {
                    ...this.options.identity,
                    type: 'hello',
                    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
                    agentId: captured.target.agentId,
                    agentEpoch: captured.target.agentEpoch,
                  },
                  signal,
                  channel: () => ({
                    live: () =>
                      !this.closed &&
                      !signal.aborted &&
                      this.revision === captured.revision &&
                      this.credentialVersion === captured.version,
                    signalFor: (owner, taskId) =>
                      connected.peer ? this.signalFor(connected.peer, owner, taskId) : null,
                    handlers: this.handlers(() => connected.peer),
                    allowJson: (value) => !this.broker.redactor.containsValue(value),
                  }),
                });
                connected.peer = peer;
                this.peer = peer;
                try {
                  valid();
                  checkIntent();
                  callerSignal?.removeEventListener('abort', cancel);
                  this.phase = 'connected';
                  resolveReady();
                  this.notify();
                  await this.syncSources();
                  await peer.settled;
                  return null;
                } finally {
                  this.options.execution.retire(peer);
                  peer.close();
                  await peer.settled;
                  if (this.peer === peer) {
                    this.peer = undefined;
                    this.phase = 'offline';
                    this.notify();
                  }
                }
              },
              captured.value,
            );
            return null;
          } catch (error) {
            rejectReady(error);
            this.error = failure(error);
            this.phase = 'failed';
            this.notify();
            throw error;
          }
        },
        { signal: AbortSignal.any([this.lifetime.signal, context.signal]) },
      );
      const root = this.root;
      pending = root;
      if (callerSignal?.aborted) cancel();
      void root.result.then(async (result) => {
        await root.settled;
        if (!entered) rejectReady(new KernelFault(result.ok ? 'not-ready' : result.error.code));
      });
      await ready;
      return this.view();
    } finally {
      callerSignal?.removeEventListener('abort', cancel);
      this.controlling = false;
    }
  }
  async disconnect(
    expectedRevision: number,
    expectedCredentialVersion: string,
    signal?: AbortSignal,
  ): Promise<LocalAgentLinkView> {
    if (this.controlling) throw new KernelFault('conflict');
    this.controlling = true;
    try {
      this.intent(expectedRevision, expectedCredentialVersion, signal)();
      await this.retire();
      this.phase = this.context ? 'offline' : 'disabled';
      const committed = this.view();
      this.notify();
      return committed;
    } finally {
      this.controlling = false;
    }
  }
  private binding(source: LocalCapturedSourceBase, peer: BridgeChannel): LocalHostQQSourceOffer {
    return {
      account: structuredClone(source.account),
      processIdentity: this.processIdentity,
      binding: {
        hostId: peer.context.hostId,
        hostBootId: peer.context.bootId,
        bridgeSessionId: peer.context.sessionId,
        sourceOwner: source.owner,
        sourceConfigRevision: source.configRevision,
        sourcePermissionEpoch: source.permissionEpoch,
        sourceCredentialVersion: source.credentialVersion,
        nativeConnectionId: source.connectionId,
      },
    };
  }
  private async offerSource(
    source: LocalCapturedSource,
    peer: BridgeChannel,
  ): Promise<LocalHostQQSourceOffer> {
    this.current(peer);
    await this.options.ownedProcess.check();
    await source.check();
    const offered = this.binding(source, peer);
    const old = this.offers.get(source.account.protocol);
    if (old && isDeepStrictEqual(old, offered)) return old;
    if (old) {
      const withdrawn = await peer.rpc.request('source.withdraw', json(old));
      if (!withdrawn.ok) throw new KernelFault(withdrawn.error.code);
    }
    const result = await peer.rpc.request('source.offer', json(offered));
    if (!result.ok) throw new KernelFault(result.error.code);
    this.current(peer);
    await source.check();
    this.offers.set(source.account.protocol, offered);
    return offered;
  }
  syncSources(): Promise<void> {
    const work = async (): Promise<void> => {
      const peer = this.peer;
      if (!peer || peer.signal.aborted || this.closed) return;
      const view = await this.options.sources.view();
      this.current(peer);
      for (const source of view.sources) {
        if (source.phase === 'ready' && source.account)
          await this.offerSource(this.options.sources.captureSource(source.account), peer);
        else {
          const old = this.offers.get(source.protocol);
          if (!old) continue;
          const removed = await peer.rpc.request('source.withdraw', json(old));
          if (!removed.ok) throw new KernelFault(removed.error.code);
          this.offers.delete(source.protocol);
        }
      }
    };
    this.syncing = this.syncing.then(work).catch((error: unknown) => {
      this.error = failure(error);
      this.notify();
    });
    return this.syncing;
  }
  async official(event: OfficialMessageEvent, captured: LocalCapturedSourceBase): Promise<void> {
    const mapped = mapOfficialInput(captured.account, event, captured.selfId ?? null);
    if (mapped) await this.forward(mapped, captured);
  }
  async onebot(
    event: Exclude<OneBotFrame, OneBotResponse>,
    captured: LocalCapturedSourceBase,
  ): Promise<void> {
    const mapped = mapOneBotInput(captured.account, event);
    if (mapped) await this.forward(mapped, captured);
  }
  private async forward(mapped: QQMappedInput, captured: LocalCapturedSourceBase): Promise<void> {
    const peer = this.peer;
    if (!peer || peer.signal.aborted || this.closed) {
      this.error = makeError('not-ready', false);
      this.notify();
      return;
    }
    if (this.holders.size >= COMPANION_INPUT_READY_MAX) throw new KernelFault('quota-exceeded');
    await captured.check();
    this.current(peer);
    const source = this.options.sources.captureSource(captured.account);
    if (
      source.connectionId !== captured.connectionId ||
      !isDeepStrictEqual(source.owner, captured.owner)
    )
      throw new KernelFault('stale-owner');
    const offered = this.binding(source, peer);
    const handles = mapped.materials.map(() => randomUUID());
    const projected = projectQQInput(mapped, handles);
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const holder: InputHolder = {
      peer,
      source,
      offered,
      mapped,
      handles,
      finished: new Set(),
      active: new Set(),
      operations: new Set(),
      done,
      finish,
      handle: null,
      context: null,
    };
    const key = randomUUID();
    const task = this.options.kernel.runFor(
      source.account.sourcePluginId as LocalQQSourceId,
      async (context) => {
        holder.context = context;
        try {
          await source.check();
          this.current(peer);
          context.signal.throwIfAborted();
          const registered = await this.offerSource(source, peer);
          if (!isDeepStrictEqual(registered, offered)) throw new KernelFault('stale-owner');
          const result = await peer.rpc.request(
            'input.offer',
            json({ source: offered, input: projected }),
            { taskId: context.taskId, signal: context.signal, budgetMs: 300000 },
          );
          if (!result.ok) throw new KernelFault(result.error.code);
          if (!isQQInputReceipt(result.value)) throw new KernelFault('invalid-input');
          this.options.onReceipt?.(result.value);
          if (
            result.value.state === 'preparing' &&
            mapped.materials.length &&
            holder.finished.size < mapped.materials.length
          ) {
            const stop = () => finish();
            context.signal.addEventListener('abort', stop, { once: true });
            try {
              if (!context.signal.aborted) await done;
            } finally {
              context.signal.removeEventListener('abort', stop);
            }
          }
          return null;
        } catch (error) {
          this.error = failure(error);
          this.notify();
          return null;
        } finally {
          await Promise.allSettled([...holder.operations]);
          this.holders.delete(key);
        }
      },
      {
        signal: AbortSignal.any([peer.signal, source.signal, this.lifetime.signal]),
        timeoutMs: 300000,
      },
    );
    holder.handle = task;
    this.holders.set(key, holder);
    this.track(
      (async () => {
        const result = await task.result;
        await task.settled;
        this.holders.delete(key);
        if (!result.ok) {
          this.error = result.error;
          this.notify();
        }
      })(),
    );
    // A supervised offer continues independently; the native frame consumer remains free for heartbeat.
  }
  private signalFor(peer: BridgeChannel, owner: OwnerRef, wireTaskId: string): AbortSignal | null {
    if (!isDeepStrictEqual(owner, peer.context.owner) || peer.signal.aborted) return null;
    const input = this.media.get(wireTaskId);
    if (
      input?.peer === peer &&
      !input.handle.signal.aborted &&
      this.options.kernel.host.tasks.taskSignal(
        input.handle.taskId,
        input.handle.snapshot().owner,
      ) === input.handle.signal
    )
      return input.handle.signal;
    return this.options.execution.signalFor(peer, owner, wireTaskId);
  }
  private handlers(peerFor: () => BridgeChannel | undefined): Record<string, RpcHandler> {
    const wrap =
      (
        operation: (peer: BridgeChannel, value: JsonValue, signal: AbortSignal) => Promise<unknown>,
      ): RpcHandler =>
      async (context, value) => {
        try {
          const peer = peerFor();
          if (!peer) throw new KernelFault('not-ready');
          this.current(peer);
          return { ok: true, value: json(await operation(peer, value, context.signal)) };
        } catch (error) {
          return { ok: false, error: failure(error) };
        }
      };
    return {
      'material.read': wrap((peer, value, signal) => this.readMaterial(peer, value, signal)),
      'delivery.execute': wrap(async (peer, value, signal) =>
        qqExecutionJson(
          await this.options.execution.execute(peer, parseQQExecutionRequest(value), signal),
        ),
      ),
      'delivery.inspect': wrap(async (peer, value) =>
        qqExecutionJson(this.options.execution.inspect(peer, parseQQExecutionIdentity(value))),
      ),
      'delivery.recover': wrap((peer, value, signal) =>
        this.options.execution.recover(peer, value, signal),
      ),
    };
  }
  private async readMaterial(
    peer: BridgeChannel,
    raw: unknown,
    caller: AbortSignal,
  ): Promise<LocalHostQQMaterialComplete> {
    const value = object(raw, ['source', 'inputId', 'materialId', 'selector', 'stream']);
    if (
      !isRecord(value['source']) ||
      !exact(value['source'], ['account', 'binding', 'processIdentity']) ||
      !isQQAccountRef(value['source']['account']) ||
      !isDeepStrictEqual(value['source']['processIdentity'], this.processIdentity)
    )
      throw new KernelFault('invalid-input');
    const binding = validateLocalHostSourceBinding(value['source']['binding']);
    const stream = validateStreamHeader({
      ...(isRecord(value['stream']) ? value['stream'] : {}),
      sequence: 0,
      byteLength: 0,
    });
    if (
      !binding.ok ||
      !stream.ok ||
      !isCompanionRecordId(value['inputId']) ||
      !isCompanionRecordId(value['materialId']) ||
      !isDeepStrictEqual(stream.value.owner, peer.context.owner)
    )
      throw new KernelFault('invalid-input');
    const selector = parseQQMaterialSelector(value['selector']);
    const request: LocalHostQQMaterialRead = {
      source: {
        account: value['source']['account'],
        binding: binding.value,
        processIdentity: this.processIdentity,
      },
      inputId: value['inputId'],
      materialId: value['materialId'],
      selector,
      stream: {
        owner: peer.context.owner,
        taskId: stream.value.taskId,
        streamId: stream.value.streamId,
      },
    };
    if (selector.kind === 'observed-file') {
      if (!sameQQAccount(selector.evidence.account, request.source.account))
        throw new KernelFault('permission-denied');
      const source = this.options.sources.captureSource(selector.evidence.account);
      if (
        source.protocol !== 'onebot-v11' ||
        !isDeepStrictEqual(this.binding(source, peer), request.source) ||
        !isDeepStrictEqual(this.offers.get(source.account.protocol), request.source)
      )
        throw new KernelFault('stale-owner');
      const evidence = selector.evidence,
        busid = evidence.busId === null ? null : Number(evidence.busId);
      if (busid !== null && (!Number.isSafeInteger(busid) || busid < 0))
        throw new KernelFault('invalid-input');
      let actual: LocalHostQQMaterialComplete | undefined, failed: unknown;
      const handle: TaskHandle = this.options.kernel.runFor(
        source.account.sourcePluginId as LocalQQSourceId,
        async (task) => {
          try {
            actual = await this.transferMaterial(
              peer,
              source,
              handle,
              task,
              request,
              caller,
              async (signal, consume) => {
                const result = await source.driver.downloadMedia(
                  {
                    source: {
                      kind: 'file',
                      fileId: evidence.fileId,
                      scene: 'group',
                      targetId: evidence.groupId,
                      busid,
                      fileHash: null,
                    },
                    expectedSizeBytes: evidence.reportedSize,
                    expectedSha256: null,
                  },
                  consume,
                  signal,
                  source.connectionId,
                );
                if (!result.ok) throw new KernelFault(result.error.code);
                if (result.value.kind !== 'complete')
                  throw new KernelFault(result.value.error.code);
                return {
                  sizeBytes: result.value.value.sizeBytes,
                  sha256: result.value.value.sha256,
                };
              },
            );
            return null;
          } catch (error) {
            failed = error;
            return null;
          }
        },
        {
          signal: AbortSignal.any([caller, source.signal, peer.signal, this.lifetime.signal]),
          timeoutMs: 300000,
        },
      );
      return this.track(
        (async () => {
          const logical = await handle.result;
          await handle.settled;
          if (actual) return actual;
          if (failed) throw failed;
          throw new KernelFault(logical.ok ? 'unavailable' : logical.error.code);
        })(),
      );
    }
    const { index, handle: partHandle } = selector;
    const holder = [...this.holders.values()].find(
      (item) => item.peer === peer && item.handles[index] === partHandle,
    );
    if (
      !holder?.handle ||
      !holder.context ||
      holder.handle.signal.aborted ||
      !holder.handle.snapshot().workPending ||
      !sameQQAccount(holder.source.account, request.source.account) ||
      !isDeepStrictEqual(holder.offered, request.source) ||
      holder.active.has(index) ||
      holder.finished.has(index)
    )
      throw new KernelFault('permission-denied');
    holder.active.add(index);
    const operation = this.transferMaterial(
      peer,
      holder.source,
      holder.handle,
      holder.context,
      request,
      caller,
      (signal, consume) => this.download(holder, index, signal, consume),
    )
      .catch((error: unknown) => {
        holder.handle?.cancel('user');
        holder.finish();
        throw error;
      })
      .finally(() => {
        holder.active.delete(index);
        holder.finished.add(index);
        if (holder.finished.size === holder.handles.length) holder.finish();
      });
    holder.operations.add(operation);
    void operation.then(
      () => holder.operations.delete(operation),
      () => holder.operations.delete(operation),
    );
    return operation;
  }
  private async transferMaterial(
    peer: BridgeChannel,
    source: LocalCapturedSource,
    handle: TaskHandle,
    nativeTask: TaskContext,
    request: LocalHostQQMaterialRead,
    caller: AbortSignal,
    download: (
      signal: AbortSignal,
      consume: (bytes: Uint8Array) => Promise<void>,
    ) => Promise<{ sizeBytes: number; sha256: string }>,
  ): Promise<LocalHostQQMaterialComplete> {
    this.current(peer);
    await this.options.ownedProcess.check();
    await source.check();
    const reference = request.stream;
    if (
      this.media.has(reference.taskId) ||
      this.media.size >= 4 ||
      this.options.kernel.host.tasks.taskSignal(handle.taskId, nativeTask.owner) !==
        nativeTask.signal
    )
      throw new KernelFault('permission-denied');
    const signal = AbortSignal.any([caller, handle.signal, peer.signal, source.signal]);
    this.media.set(reference.taskId, { peer, handle, streamId: reference.streamId });
    const task = { owner: nativeTask.owner, taskId: nativeTask.taskId };
    const authority = async (): Promise<number> => {
      const result = await checkRemoteAuthority({
        peer,
        request: {
          kind: 'input-material',
          binding: request.source.binding,
          task,
          inputId: request.inputId,
          materialId: request.materialId,
        },
        signal,
        checkLocal: () => source.check(),
      });
      if (!result.ok) throw new KernelFault(result.error.code);
      return result.value;
    };
    const writer = peer.media.createWriter(reference);
    if (!writer.ok) {
      this.media.delete(reference.taskId);
      throw new KernelFault(writer.error.code);
    }
    try {
      await authority();
      const offer: LocalHostQQMaterialOffer = {
        source: request.source,
        inputId: request.inputId,
        materialId: request.materialId,
        stream: reference,
        task,
      };
      const credit = await peer.rpc.request('material.offer', json(offer), {
        taskId: task.taskId,
        signal,
      });
      if (!credit.ok) throw new KernelFault(credit.error.code);
      const result = await withQqOperationCheck(
        this.options.kernel.host,
        nativeTask,
        authority,
        () =>
          download(signal, async (bytes) => {
            for (let offset = 0; offset < bytes.byteLength; offset += MEDIA_MAX_CHUNK_BYTES) {
              signal.throwIfAborted();
              await authority();
              const written = await writer.value.write(
                bytes.subarray(offset, offset + MEDIA_MAX_CHUNK_BYTES),
              );
              if (!written.ok) throw new KernelFault(written.error.code);
            }
          }),
      );
      const ended = await writer.value.end();
      if (!ended.ok) throw new KernelFault(ended.error.code);
      return { ...result, cleanup: 'settled' };
    } finally {
      writer.value.cancel();
      this.media.delete(reference.taskId);
    }
  }
  private async download(
    holder: InputHolder,
    index: number,
    signal: AbortSignal,
    consume: (bytes: Uint8Array) => Promise<void>,
  ): Promise<{ sizeBytes: number; sha256: string }> {
    const part = holder.mapped.materials[index],
      source = holder.source,
      route = holder.mapped.route;
    if (!part) throw new KernelFault('invalid-input');
    const consumer = async (bytes: Uint8Array) => consume(bytes);
    if (part.protocol === 'official' && source.protocol === 'official') {
      const url =
        part.kind === 'voice'
          ? (part.attachment.voice_wav_url ?? part.attachment.url)
          : part.attachment.url;
      if (!url) throw new KernelFault('unavailable');
      const result = await source.driver.downloadAttachment(
        {
          scene: route.scene === 'private' ? 'c2c' : 'group',
          targetId: route.targetId,
          url,
          name: part.attachment.filename ?? `${part.kind}.bin`,
          maximumBytes: COMPANION_MATERIAL_INPUT_MAX_BYTES,
          expectedSizeBytes:
            part.kind === 'voice' && part.attachment.voice_wav_url ? null : part.attachment.size,
          expectedSha256: null,
        },
        consumer,
        signal,
        source.connectionId,
        () => source.check(),
      );
      if (!result.ok) throw new KernelFault(result.error.code);
      return { sizeBytes: result.value.sizeBytes, sha256: result.value.sha256 };
    }
    if (part.protocol === 'onebot-v11' && source.protocol === 'onebot-v11') {
      const data = part.segment.data,
        fileId = text(data['file_id'] ?? (part.kind === 'file' ? undefined : data['file']));
      if (!fileId) throw new KernelFault('invalid-input');
      const expectedSha256 = text(data['sha256']);
      if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256))
        throw new KernelFault('invalid-input');
      const input: SnowMediaDownloadInput = {
        source:
          part.kind === 'file'
            ? {
                kind: 'file',
                fileId,
                scene: route.scene,
                targetId: route.targetId,
                fileHash: text(data['file_hash']),
                busid: size(data['busid']),
              }
            : { kind: part.kind, fileId },
        expectedSizeBytes: size(data['file_size'] ?? data['size']),
        expectedSha256,
      };
      const result = await source.driver.downloadMedia(
        input,
        consumer,
        signal,
        source.connectionId,
      );
      if (!result.ok) throw new KernelFault(result.error.code);
      if (result.value.kind !== 'complete') throw new KernelFault(result.value.error.code);
      return { sizeBytes: result.value.value.sizeBytes, sha256: result.value.value.sha256 };
    }
    throw new KernelFault('permission-denied');
  }
  async view(): Promise<LocalAgentLinkView> {
    return this.snapshot();
  }
  private snapshot(): LocalAgentLinkView {
    return {
      revision: this.revision,
      target: structuredClone(this.target),
      credentialVersion: this.credentialVersion,
      hasCredential: !!this.credential,
      phase: this.phase,
      sessionId: this.peer?.context.sessionId ?? null,
      error: this.error,
    };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.offCommit();
    this.lifetime.abort();
    this.fence();
    this.credential = '';
    this.closing = (async () => {
      await this.retire();
      await this.options.execution.close();
      await this.broker.drainUses();
      this.broker.dispose();
    })();
    return this.closing;
  }
}

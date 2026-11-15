import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Server } from 'node:http';
import {
  LOCAL_HOST_BRIDGE_PLUGIN_ID,
  LOCAL_HOST_AUTHORITY_CHECK_MAX_MS,
  QQ_FEATURE_PLUGIN_ID,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  isQQAccountRef,
  isCompanionRecordId,
  sameQQAccount,
  makeError,
  type JsonValue,
  type KernelError,
  type CompanionInputAdmission,
  type CompanionCommandReceipt,
  type LocalHostAuthorityRequest,
  type LocalHostAuthorityPermit,
  type LocalHostBridgeHello,
  type LocalHostBridgeWelcome,
  type LocalHostQQInputOffer,
  type LocalHostQQSourceOffer,
  type LocalHostQQMaterialRead,
  type LocalHostQQMaterialSelector,
  type LocalHostQQSelection,
  type LocalHostQQView,
  type QQAccountRef,
  type LocalHostTaskReference,
  type LocalHostProcessIdentity,
} from '@pet/contracts';
import {
  isRecord,
  jsonPreflight,
  validateLocalHostSourceBinding,
  validateLocalHostTaskReference,
  validateLocalHostProcessIdentity,
  validateStreamHeader,
} from '@pet/contracts/validation';
import { KernelFault, type RpcHandler, type TaskHandle } from '@pet/host-kernel';
import type { PluginContext } from '@pet/plugin-sdk';
import type {
  CompanionPluginHost,
  CompanionRuntime,
  RuntimeInputAccess,
} from '@pet/companion-runtime';
import {
  createAgentBridgeServer,
  parseQQInputProjection,
  type BridgeChannel,
} from '@pet/local-host';
import type { LocalHostBridgePorts } from '@pet/local-host-bridge';
import type { QQIngress } from './qq-ingress.js';
import type { QQInputMaterialProducer, QQObservedFileProducerFor } from './qq-media-transfer.js';
import type { RawInputSource } from './material-store.js';
import type { QQRemoteCapture, QQRemotePeer } from './qq-remote-delivery.js';

const identity = { pluginId: LOCAL_HOST_BRIDGE_PLUGIN_ID, instanceId: 'default' };
const fail = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const json = (value: unknown): JsonValue => {
  const result = jsonPreflight(value);
  if (!result.ok) throw new KernelFault('invalid-input');
  return result.value;
};
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = json(input);
  if (!isRecord(value) || !exact(value, keys)) throw new KernelFault('invalid-input');
  return value;
}
function sourceOffer(input: unknown, context: LocalHostBridgeWelcome): LocalHostQQSourceOffer {
  const value = object(input, ['account', 'binding', 'processIdentity']);
  const binding = validateLocalHostSourceBinding(value['binding']);
  const processIdentity = validateLocalHostProcessIdentity(value['processIdentity']);
  if (!isQQAccountRef(value['account']) || !binding.ok || !processIdentity.ok)
    throw new KernelFault('invalid-input');
  const account = value['account'];
  if (
    account.sourcePluginId !==
      (account.protocol === 'official' ? QQ_OFFICIAL_PLUGIN_ID : QQ_ONEBOT_PLUGIN_ID) ||
    account.instanceId !== 'default' ||
    binding.value.sourceOwner.pluginId !== account.sourcePluginId ||
    binding.value.sourceOwner.instanceId !== account.instanceId ||
    binding.value.hostId !== context.hostId ||
    binding.value.hostBootId !== context.bootId ||
    binding.value.bridgeSessionId !== context.sessionId
  )
    throw new KernelFault('permission-denied');
  return {
    account: structuredClone(account),
    binding: binding.value,
    processIdentity: Object.freeze(processIdentity.value),
  };
}
function selection(input: unknown): LocalHostQQSelection {
  const value = object(input, ['mode', 'hostId']);
  if (value['mode'] === 'service-local' && (value['hostId'] === '' || value['hostId'] === null))
    return { mode: 'service-local', hostId: null };
  if (value['mode'] === 'remote-host' && isCompanionRecordId(value['hostId']))
    return { mode: 'remote-host', hostId: value['hostId'] };
  throw new KernelFault('invalid-input');
}
export type QQRegisteredRemotePeer = QQRemotePeer & {
  readonly processIdentity: LocalHostProcessIdentity;
};
export interface QQCapturedBridgeContext {
  readonly peer: BridgeChannel;
  check(): Promise<void>;
  currentSource(account: QQAccountRef): QQRegisteredRemotePeer;
  registerMediaTask(handle: TaskHandle): {
    readonly reference: LocalHostTaskReference;
    dispose(): void;
  };
}
export interface QQLocalHostOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: CompanionRuntime;
  readonly ingress: QQIngress;
  onPeer?(context: QQCapturedBridgeContext): void | Promise<void>;
  /** Retire existing service-local protocol sources before accepting a remote assignment. */
  beforeRemoteListen?(): Promise<void>;
}
interface SourceRecord {
  readonly offered: LocalHostQQSourceOffer;
  readonly abort: AbortController;
}
interface ReadOperation {
  readonly source: QQRegisteredRemotePeer;
  readonly access: RuntimeInputAccess;
  readonly inputId: string;
  readonly materialId: string;
  readonly stream: LocalHostTaskReference & { readonly streamId: string };
  readonly task: TaskHandle;
  localTask: LocalHostTaskReference | null;
  credit: boolean;
}
interface PeerRecord {
  readonly context: LocalHostBridgeWelcome;
  readonly hello: LocalHostBridgeHello;
  readonly sources: Map<string, SourceRecord>;
  readonly media: Map<string, TaskHandle>;
  readonly reads: Map<string, ReadOperation>;
  peer: BridgeChannel | null;
  processIdentity: LocalHostProcessIdentity | null;
  root: TaskHandle | null;
  ready: Promise<void>;
  start(): void;
  reject(error: unknown): void;
}

/** Authenticated transport/source selection. Participant grants remain exclusively inside QQIngress. */
export class QQLocalHostController {
  private context: PluginContext | undefined;
  private selected: LocalHostQQSelection = { mode: 'service-local', hostId: null };
  private revision = 0;
  private readonly peers = new Set<PeerRecord>();
  private active: PeerRecord | undefined;
  private server: Server | undefined;
  private token = '';
  private listener: ReturnType<typeof createAgentBridgeServer> | undefined;
  private rebinding = Promise.resolve();
  private readonly work = new Set<Promise<unknown>>();
  private readonly offCommit: () => void;
  private closed = false;
  private closing: Promise<void> | undefined;
  private error: KernelError | null = null;
  private hooks:
    | {
        authority(
          peer: BridgeChannel,
          input: LocalHostAuthorityRequest,
        ): Promise<LocalHostAuthorityPermit>;
        report(peer: BridgeChannel, input: unknown): Promise<unknown>;
      }
    | undefined;
  constructor(private readonly options: QQLocalHostOptions) {
    this.offCommit = options.host.onConfigurationCommit((commit) => {
      if (
        commit.pluginId !== identity.pluginId ||
        commit.instanceId !== identity.instanceId ||
        this.closed
      )
        return;
      this.revision = commit.revision;
      try {
        this.selected = selection(commit.data);
        this.error = null;
      } catch (error) {
        this.error = fail(error);
      }
      this.fence();
      this.rebinding = this.rebinding
        .then(() => this.listen())
        .catch((error: unknown) => {
          this.error = fail(error);
        });
    });
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.work.add(work);
    void work.then(
      () => this.work.delete(work),
      () => this.work.delete(work),
    );
    return work;
  }
  featurePorts(context: PluginContext): LocalHostBridgePorts {
    if (
      context.owner.pluginId !== identity.pluginId ||
      context.owner.instanceId !== identity.instanceId
    )
      throw new KernelFault('permission-denied');
    return {
      bind: () => {
        if (this.context || context.signal.aborted) throw new KernelFault('conflict');
        this.context = context;
        const abort = () => this.fence();
        context.signal.addEventListener('abort', abort, { once: true });
        return async () => {
          abort();
          await this.retire();
          context.signal.removeEventListener('abort', abort);
          if (this.context === context) this.context = undefined;
        };
      },
      status: async () => json(await this.view()),
    };
  }
  setDeliveryHooks(hooks: NonNullable<QQLocalHostController['hooks']>): void {
    this.hooks = hooks;
  }
  async initialize(enabled = true): Promise<void> {
    const config = await this.options.host.configs.get(identity);
    if (!config.ok) throw new KernelFault(config.error.code);
    this.selected = selection(config.value.data);
    this.revision = config.value.revision;
    if (enabled) await this.options.host.setEnabled(identity.pluginId, true);
  }
  async setPlugin(enabled: boolean, commandId: string): Promise<CompanionCommandReceipt> {
    const receipt = await this.options.runtime.setPlugin(identity.pluginId, enabled, commandId);
    if (enabled) await this.listen();
    else await this.retire();
    return receipt;
  }
  private current(): PluginContext {
    const context = this.context,
      policy = this.options.host.permissionControl.inspect(identity);
    if (
      this.closed ||
      !context ||
      context.signal.aborted ||
      !this.options.host.manager.isActive(context.owner) ||
      !this.options.host.verifySource(identity.pluginId) ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny'
    )
      throw new KernelFault('permission-denied');
    return context;
  }
  private fence(): void {
    for (const entry of this.peers) {
      for (const source of entry.sources.values()) source.abort.abort();
      entry.peer?.close();
    }
  }
  private async retire(): Promise<void> {
    this.fence();
    await this.listener?.close();
    this.listener = undefined;
    await Promise.all(
      [...this.peers].map(async (entry) => {
        await entry.root?.settled;
        await entry.peer?.settled;
      }),
    );
    this.active = undefined;
  }
  async attach(server: Server, token: string): Promise<void> {
    if (this.server && this.server !== server) throw new KernelFault('conflict');
    this.server = server;
    this.token = token;
    await this.listen();
  }
  private async listen(): Promise<void> {
    await this.retire();
    if (
      this.closed ||
      !this.server ||
      !this.context ||
      this.context.signal.aborted ||
      this.selected.mode !== 'remote-host' ||
      this.error
    )
      return;
    const context = this.current();
    const selected = this.selected;
    await this.options.beforeRemoteListen?.();
    this.current();
    if (this.selected !== selected) return;
    const state = await this.options.runtime.state('snapshot', {});
    this.current();
    if (this.selected !== selected) return;
    let preparing: PeerRecord | undefined;
    this.listener = createAgentBridgeServer({
      server: this.server,
      token: this.token,
      hostId: selected.hostId,
      agentId: state.assistantId,
      agentEpoch: state.epoch,
      owner: context.owner,
      channel: (hello, welcome) => {
        let start: () => void = () => {},
          reject: (error: unknown) => void = () => {};
        const ready = new Promise<void>((resolve, fail_) => {
          start = resolve;
          reject = fail_;
        });
        void ready.catch(() => {});
        const entry: PeerRecord = {
          context: welcome,
          hello,
          sources: new Map(),
          media: new Map(),
          reads: new Map(),
          peer: null,
          processIdentity: null,
          root: null,
          ready,
          start,
          reject,
        };
        preparing = entry;
        return {
          live: () => !this.closed && this.selected === selected && !context.signal.aborted,
          signalFor: (owner, taskId) => {
            if (!isDeepStrictEqual(owner, welcome.owner)) return null;
            const handle = entry.media.get(taskId);
            if (!handle || handle.signal.aborted) return null;
            return this.options.host.tasks.taskSignal(handle.taskId, handle.snapshot().owner) ===
              handle.signal
              ? handle.signal
              : null;
          },
          handlers: this.handlers(entry),
        };
      },
      onPeer: (peer) => {
        const entry =
          preparing?.context.sessionId === peer.context.sessionId ? preparing : undefined;
        if (!entry) {
          peer.close();
          return;
        }
        preparing = undefined;
        this.peers.add(entry);
        entry.peer = peer;
        this.active = entry;
        entry.root = this.options.host.runFor(
          identity.pluginId,
          async (task) => {
            const granted = await this.options.host.permissions.authorize(
              task.owner,
              task.taskId,
              { kind: 'files', scope: 'plugin-data', access: 'read' },
              task.signal,
            );
            if (!granted.ok) throw new KernelFault(granted.error.code);
            const stop = () => peer.close();
            granted.value.signal.addEventListener('abort', stop, { once: true });
            task.signal.addEventListener('abort', stop, { once: true });
            try {
              this.current();
              if (!granted.value.isValid() || peer.signal.aborted)
                throw new KernelFault('permission-denied');
              entry.start();
              await this.options.onPeer?.(this.captured(entry));
              await peer.settled;
              return null;
            } finally {
              peer.close();
              await peer.settled;
              granted.value.signal.removeEventListener('abort', stop);
              task.signal.removeEventListener('abort', stop);
              granted.value.close();
            }
          },
          { signal: AbortSignal.any([context.signal, peer.signal]) },
        );
        this.track(
          (async () => {
            const result = await entry.root?.result;
            await entry.root?.settled;
            if (!result?.ok) {
              entry.reject(
                new KernelFault(result && !result.ok ? result.error.code : 'unavailable'),
              );
              peer.close();
            }
            for (const source of entry.sources.values()) source.abort.abort();
            this.peers.delete(entry);
            if (this.active === entry) this.active = undefined;
          })(),
        );
      },
    });
  }
  private async checkPeer(entry: PeerRecord): Promise<BridgeChannel> {
    if (!entry.peer) throw new KernelFault('not-ready');
    await entry.ready;
    this.current();
    const peer = entry.peer;
    if (
      !peer ||
      peer.signal.aborted ||
      this.active !== entry ||
      this.selected.mode !== 'remote-host' ||
      this.selected.hostId !== entry.context.hostId ||
      !entry.root ||
      entry.root.signal.aborted ||
      !entry.root.snapshot().workPending
    )
      throw new KernelFault('stale-owner');
    return peer;
  }
  private captured(entry: PeerRecord): QQCapturedBridgeContext {
    if (!entry.peer) throw new KernelFault('not-ready');
    return {
      peer: entry.peer,
      check: async () => {
        await this.checkPeer(entry);
      },
      currentSource: (account) => this.source(entry, account),
      registerMediaTask: (handle) => {
        if (
          !entry.peer ||
          entry.peer.signal.aborted ||
          entry.media.size >= 4 ||
          this.options.host.tasks.taskSignal(handle.taskId, handle.snapshot().owner) !==
            handle.signal
        )
          throw new KernelFault('permission-denied');
        if (entry.media.has(handle.taskId)) throw new KernelFault('conflict');
        entry.media.set(handle.taskId, handle);
        return {
          reference: { owner: entry.context.owner, taskId: handle.taskId },
          dispose: () => {
            if (entry.media.get(handle.taskId) === handle) entry.media.delete(handle.taskId);
          },
        };
      },
    };
  }
  private source(entry: PeerRecord, account: QQAccountRef): QQRegisteredRemotePeer {
    const record = entry.sources.get(account.protocol),
      peer = entry.peer;
    if (
      !record ||
      !peer ||
      record.abort.signal.aborted ||
      peer.signal.aborted ||
      !sameQQAccount(record.offered.account, account)
    )
      throw new KernelFault('not-ready');
    const signal = AbortSignal.any([record.abort.signal, peer.signal]);
    return {
      peer,
      account: structuredClone(account),
      binding: structuredClone(record.offered.binding),
      processIdentity: record.offered.processIdentity,
      signal,
      check: async () => {
        await this.checkPeer(entry);
        if (signal.aborted || entry.sources.get(account.protocol) !== record)
          throw new KernelFault('stale-owner');
      },
      registerMediaTask: (handle) => this.captured(entry).registerMediaTask(handle).dispose,
    };
  }
  capture(account: QQAccountRef): QQRemoteCapture {
    try {
      if (!this.active) throw new KernelFault('not-ready');
      return { kind: 'available', source: this.source(this.active, account) };
    } catch (error) {
      return { kind: 'unavailable', hostId: this.selected.hostId, error: fail(error) };
    }
  }
  private handlers(entry: PeerRecord): Record<string, RpcHandler> {
    const wrap =
      (operation: (input: JsonValue, peer: BridgeChannel) => Promise<unknown>): RpcHandler =>
      async (_context, input) => {
        try {
          const peer = await this.checkPeer(entry);
          return { ok: true, value: json(await operation(input, peer)) };
        } catch (error) {
          return { ok: false, error: fail(error) };
        }
      };
    return {
      'source.offer': wrap(async (input) => {
        const offered = sourceOffer(input, entry.context);
        if (
          entry.processIdentity &&
          !isDeepStrictEqual(entry.processIdentity, offered.processIdentity)
        )
          throw new KernelFault('permission-denied');
        entry.processIdentity ??= offered.processIdentity;
        const prior = entry.sources.get(offered.account.protocol);
        if (prior && isDeepStrictEqual(prior.offered, offered)) return null;
        prior?.abort.abort();
        entry.sources.set(offered.account.protocol, { offered, abort: new AbortController() });
        return null;
      }),
      'source.withdraw': wrap(async (input) => {
        const offered = sourceOffer(input, entry.context),
          prior = entry.sources.get(offered.account.protocol);
        if (!prior || !isDeepStrictEqual(prior.offered, offered))
          throw new KernelFault('stale-owner');
        prior.abort.abort();
        entry.sources.delete(offered.account.protocol);
        return null;
      }),
      'source.status': wrap(async (input) => {
        const offered = sourceOffer(input, entry.context);
        const source = this.source(entry, offered.account);
        if (
          !isDeepStrictEqual(source.binding, offered.binding) ||
          !isDeepStrictEqual(source.processIdentity, offered.processIdentity)
        )
          throw new KernelFault('stale-owner');
        await source.check();
        return null;
      }),
      'input.offer': wrap(async (input) => {
        const value = object(input, ['source', 'input']);
        const offered = sourceOffer(value['source'], entry.context);
        const source = this.source(entry, offered.account);
        if (
          !isDeepStrictEqual(source.binding, offered.binding) ||
          !isDeepStrictEqual(source.processIdentity, offered.processIdentity)
        )
          throw new KernelFault('stale-owner');
        const projected = parseQQInputProjection(value['input']);
        if (!sameQQAccount(projected.actor.account, source.account))
          throw new KernelFault('permission-denied');
        const offer: LocalHostQQInputOffer = { source: offered, input: projected };
        return this.options.ingress.acceptProjected(
          projected,
          {
            account: source.account,
            connectionId: source.binding.nativeConnectionId,
            signal: source.signal,
            check: source.check,
          },
          (input) => this.producer(entry, source, offer, input),
        );
      }),
      'material.offer': wrap(async (input) => {
        const value = object(input, ['source', 'inputId', 'materialId', 'stream', 'task']);
        const offered = sourceOffer(value['source'], entry.context),
          task = validateLocalHostTaskReference(value['task']);
        const stream = validateStreamHeader({
          ...(isRecord(value['stream']) ? value['stream'] : {}),
          sequence: 0,
          byteLength: 0,
        });
        if (!task.ok || !stream.ok) throw new KernelFault('invalid-input');
        const read = entry.reads.get(stream.value.taskId);
        if (
          !read ||
          read.inputId !== value['inputId'] ||
          read.materialId !== value['materialId'] ||
          !isDeepStrictEqual(offered.binding, read.source.binding) ||
          !isDeepStrictEqual(offered.processIdentity, read.source.processIdentity) ||
          !isDeepStrictEqual(task.value, read.localTask) ||
          stream.value.streamId !== read.stream.streamId ||
          !isDeepStrictEqual(stream.value.owner, entry.context.owner) ||
          read.credit
        )
          throw new KernelFault('permission-denied');
        await read.access.check();
        await read.source.check();
        const granted = entry.peer?.media.grantInitial(read.stream);
        if (!granted?.ok) throw new KernelFault('unavailable');
        read.credit = true;
        return null;
      }),
      'authority.check': wrap(async (input, peer) => {
        if (!isRecord(input)) throw new KernelFault('invalid-input');
        if (input['kind'] === 'delivery') {
          object(input, [
            'kind',
            'binding',
            'task',
            'deliveryId',
            'partId',
            'attemptId',
            'contentHash',
          ]);
          if (!this.hooks) throw new KernelFault('not-ready');
          return this.hooks.authority(peer, input as unknown as LocalHostAuthorityRequest);
        }
        const value = object(input, ['kind', 'binding', 'task', 'inputId', 'materialId']);
        const binding = validateLocalHostSourceBinding(value['binding']),
          task = validateLocalHostTaskReference(value['task']);
        if (
          value['kind'] !== 'input-material' ||
          !binding.ok ||
          !task.ok ||
          !isDeepStrictEqual(task.value.owner, binding.value.sourceOwner)
        )
          throw new KernelFault('permission-denied');
        const read = [...entry.reads.values()].find(
          (candidate) =>
            candidate.inputId === value['inputId'] && candidate.materialId === value['materialId'],
        );
        if (
          !read ||
          !isDeepStrictEqual(binding.value, read.source.binding) ||
          read.task.signal.aborted ||
          (read.localTask && !isDeepStrictEqual(read.localTask, task.value))
        )
          throw new KernelFault('permission-denied');
        await read.access.check();
        await read.source.check();
        read.localTask ??= task.value;
        await read.access.check();
        return { validForMs: LOCAL_HOST_AUTHORITY_CHECK_MAX_MS };
      }),
      'delivery.report': wrap(async (input, peer) => {
        if (!this.hooks) throw new KernelFault('not-ready');
        return this.hooks.report(peer, input);
      }),
    };
  }
  private producer(
    entry: PeerRecord,
    source: QQRegisteredRemotePeer,
    offer: LocalHostQQInputOffer,
    input: CompanionInputAdmission,
  ): QQInputMaterialProducer {
    return {
      account: source.account,
      parts: offer.input.materials.map((part, index) => ({
        kind: part.kind,
        quoted: part.quoted,
        name: part.name || `${part.kind}-${index}.bin`,
        expectedSizeBytes: part.reportedSize === null ? null : Number(part.reportedSize),
        expectedSha256: part.expectedSha256,
      })),
      readPart: async (index, access, consume) => {
        const part = offer.input.materials[index],
          materialId = input.materialIds[index];
        if (!part || !materialId) throw new KernelFault('permission-denied');
        return this.readMaterial(
          entry,
          source,
          input.id,
          materialId,
          { kind: 'event-part', handle: part.handle, index },
          access,
          consume,
        );
      },
    };
  }
  /** Called only by the work preparer's scoped-observation port, never from an RPC/role claim. */
  readonly observedFileProducer: QQObservedFileProducerFor = async (
    input,
    observation,
    materialId,
    original,
  ) => {
    await original.check();
    original.signal.throwIfAborted();
    const entry = this.active;
    if (!entry) throw new KernelFault('not-ready');
    const evidence = structuredClone(observation.fileEvidence),
      source = this.source(entry, evidence.account);
    await source.check();
    const selector: LocalHostQQMaterialSelector = {
      kind: 'observed-file',
      observationId: observation.id,
      evidence,
    };
    return {
      account: evidence.account,
      parts: [
        {
          kind: 'file',
          name: evidence.name,
          quoted: false,
          expectedSizeBytes: evidence.reportedSize,
          expectedSha256: null,
        },
      ],
      readPart: async (index, actor, consume) => {
        if (index !== 0 || !isDeepStrictEqual(actor.scope, original.scope))
          throw new KernelFault('permission-denied');
        const access: RuntimeInputAccess = {
          scope: original.scope,
          signal: AbortSignal.any([original.signal, actor.signal]),
          check: async () => {
            await original.check();
            await actor.check();
          },
        };
        return this.readMaterial(entry, source, input.id, materialId, selector, access, consume);
      },
    };
  };
  private async readMaterial(
    entry: PeerRecord,
    source: QQRegisteredRemotePeer,
    inputId: string,
    materialId: string,
    selector: LocalHostQQMaterialSelector,
    access: RuntimeInputAccess,
    consume: (source: RawInputSource) => Promise<void>,
  ): Promise<void> {
    await access.check();
    await source.check();
    let failure: unknown;
    let release: (() => void) | undefined;
    const handle: TaskHandle = this.options.host.runFor(
      QQ_FEATURE_PLUGIN_ID,
      async (task) => {
        let reader: ReturnType<BridgeChannel['media']['createReader']> | undefined;
        let settlement: Promise<void> | undefined;
        let rejectBody: (error: unknown) => void = () => {};
        try {
          const mapped = this.captured(entry).registerMediaTask(handle);
          release = mapped.dispose;
          const stream = { ...mapped.reference, streamId: randomUUID() };
          const opened = source.peer.media.createReader(stream);
          reader = opened;
          if (!opened.ok) throw new KernelFault(opened.error.code);
          const operation: ReadOperation = {
            source,
            access,
            inputId,
            materialId,
            stream,
            task: handle,
            localTask: null,
            credit: false,
          };
          entry.reads.set(task.taskId, operation);
          const request: LocalHostQQMaterialRead = {
            source: {
              account: source.account,
              binding: source.binding,
              processIdentity: source.processIdentity,
            },
            inputId,
            materialId,
            selector,
            stream,
          };
          let resolveBody: (fact: { sizeBytes: number; sha256: string }) => void = () => {};
          const bytesComplete = new Promise<{ sizeBytes: number; sha256: string }>(
            (resolve, reject) => {
              resolveBody = resolve;
              rejectBody = reject;
            },
          );
          void bytesComplete.catch(() => {});
          const body = (async function* () {
            const hash = createHash('sha256');
            let sizeBytes = 0,
              complete = false;
            try {
              for await (const bytes of opened.value) {
                await access.check();
                task.signal.throwIfAborted();
                sizeBytes += bytes.byteLength;
                if (sizeBytes > COMPANION_MATERIAL_INPUT_MAX_BYTES)
                  throw new KernelFault('quota-exceeded');
                hash.update(bytes);
                yield bytes;
              }
              complete = true;
              resolveBody({ sizeBytes, sha256: hash.digest('hex') });
            } finally {
              if (!complete) rejectBody(new KernelFault('cancelled'));
            }
          })();
          const reply = source.peer.rpc.request('material.read', json(request), {
            taskId: task.taskId,
            signal: task.signal,
            budgetMs: 300000,
          });
          const settled = Promise.all([reply, bytesComplete]).then(([result, received]) => {
            if (!result.ok) throw new KernelFault(result.error.code);
            const value = object(result.value, ['sizeBytes', 'sha256', 'cleanup']);
            if (
              value['cleanup'] !== 'settled' ||
              value['sizeBytes'] !== received.sizeBytes ||
              value['sha256'] !== received.sha256
            )
              throw new KernelFault('invalid-input');
          });
          settlement = settled;
          void reply.then((result) => {
            if (!result.ok) {
              rejectBody(new KernelFault(result.error.code));
              opened.value.cancel();
            }
          });
          void settled.catch(() => opened.value.cancel());
          await consume({
            body,
            signal: task.signal,
            settled,
            check: async () => {
              await access.check();
              task.signal.throwIfAborted();
            },
            cancel: () => {
              opened.value.cancel();
              rejectBody(new KernelFault('cancelled'));
            },
          });
          await settled;
          await access.check();
          return null;
        } catch (error) {
          failure = error;
          return null;
        } finally {
          if (reader?.ok) reader.value.cancel();
          rejectBody(new KernelFault('cancelled'));
          await settlement?.catch(() => {});
          entry.reads.delete(task.taskId);
          release?.();
        }
      },
      { signal: access.signal },
    );
    const logical = await handle.result;
    await handle.settled;
    if (failure) throw failure;
    if (!logical.ok) throw new KernelFault(logical.error.code);
    if (handle.signal.aborted) throw new KernelFault('cancelled');
  }
  async select(input: unknown): Promise<LocalHostQQView> {
    this.current();
    const value = object(input, ['expectedRevision', 'selection']);
    if (!Number.isSafeInteger(value['expectedRevision'])) throw new KernelFault('invalid-input');
    const next = selection(value['selection']);
    const saved = await this.options.host.configs.save(
      identity,
      { mode: next.mode, hostId: next.hostId ?? '' },
      value['expectedRevision'] as number,
    );
    if (!saved.ok) throw new KernelFault(saved.error.code);
    await this.rebinding;
    return this.view();
  }
  async view(): Promise<LocalHostQQView> {
    return {
      revision: this.revision,
      selection: structuredClone(this.selected),
      phase: this.closed
        ? 'disabled'
        : this.error
          ? 'failed'
          : this.active?.peer && !this.active.peer.signal.aborted
            ? 'connected'
            : this.selected.mode === 'remote-host'
              ? 'waiting'
              : 'disabled',
      peer:
        this.active?.peer && !this.active.peer.signal.aborted
          ? {
              bootId: this.active.context.bootId,
              sessionId: this.active.context.sessionId,
              packageVersion: this.active.hello.packageVersion,
            }
          : null,
      sources: this.active
        ? [...this.active.sources.values()]
            .filter((value) => !value.abort.signal.aborted)
            .map((value) => structuredClone(value.offered))
        : [],
      error: this.error,
    };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.offCommit();
    this.fence();
    this.token = '';
    this.closing = (async () => {
      await this.rebinding;
      await this.retire();
      await Promise.allSettled([...this.work]);
    })();
    return this.closing;
  }
}

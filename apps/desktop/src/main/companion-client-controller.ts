import { randomUUID } from 'node:crypto';
import {
  DESKTOP_COMPANION_MAX_PENDING,
  isCompanionAudience,
  isCompanionConversationAudience,
  isQQStatus,
  type CompanionProfileSaveCommand,
  type CompanionMemoryView,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryForgetCommand,
  type CompanionMemoryMutationResult,
  DESKTOP_COMPANION_MAX_STATE_BYTES,
  makeError,
  type DesktopCompanionState,
  type DesktopCompanionPending,
  type DesktopCompanionTarget,
  type CompanionSnapshot,
  type CompanionCommandReceipt,
  type CompanionMessageCommand,
  type CompanionStopCommand,
  type CompanionProfileView,
  type CompanionTask,
  type CompanionModelView,
  type CompanionModelSaveCommand,
  type CompanionModelTestCommand,
  type DesktopArtifactSave,
  type OwnerRef,
  type Result,
  type KernelError,
  type VoiceView,
  type VoiceTicket,
  type VoiceBeginSelection,
  type VoiceResultKey,
  type VoiceSettingsCommand,
  type VoiceProviderCommand,
  type SpeechView,
  type SpeechUtteranceKey,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  getSnapshot,
  getMemory,
  saveProfile,
  upsertFact,
  forgetFact,
  getProfile,
  getTask,
  sendMessage,
  stopTask,
  stopForeground,
  saveModel,
  testModel,
  streamEvents,
  getVoice,
  saveVoiceSettings,
  saveAsrProvider,
  getVoiceCatalog,
  beginVoiceCapture,
  getVoiceCapture,
  cancelVoiceCapture,
  uploadVoiceCapture,
  getSpeech,
  saveSpeechProvider,
  getSpeechCatalog,
  beginSpeechUtterance,
  reserveSpeechSegment,
  getSpeechUtterance,
  cancelSpeechUtterance,
  consumeSpeechAudio,
  type ClientTransport,
} from '@pet/text-client/protocol';
import type {
  DesktopCompanionHostPort,
  DesktopCompanionSource,
  DesktopCompanionEndpointSave,
  DesktopArtifactDestination,
} from './companion-client-types.js';
import {
  saveCompanionArtifact,
  isCommittedArtifactSave,
  type ArtifactSaveCommit,
} from './companion-artifact.js';

import type { CompanionVoiceSession } from './companion-voice-service.js';
import type { CompanionSpeechSession, SpeechConnectionEvent } from './companion-speech-service.js';

const hasControls = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
export function companionEndpoint(input: string): string {
  if (
    !input ||
    input.length > 2048 ||
    !/^https?:\/\//i.test(input) ||
    /[\s\\?#]/.test(input) ||
    hasControls(input) ||
    /^https?:\/\/[^/]*@/i.test(input)
  )
    throw new KernelFault('invalid-input');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new KernelFault('invalid-input');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new KernelFault('invalid-input');
  return url.origin;
}
export function initialDesktopCompanionState(): DesktopCompanionState {
  return {
    version: 1,
    revision: 0,
    source: 'unavailable',
    baseUrl: '',
    configRevision: 0,
    connectionId: null,
    phase: 'idle',
    confirmedAt: null,
    snapshot: null,
    pending: [],
    error: null,
  };
}
export function desktopModelView(view: CompanionModelView): CompanionModelView {
  return {
    ...view,
    connectors: view.connectors.map((item) => ({
      ...item,
      credential: { ...item.credential, writable: false },
    })),
  };
}
/** This bridge is the personal projection, never the operator's broader management view. */
export function desktopPersonalSnapshot(snapshot: CompanionSnapshot): CompanionSnapshot {
  if (snapshot.qq !== undefined && !isQQStatus(snapshot.qq)) throw new KernelFault('invalid-input');
  return {
    ...snapshot,
    messages: snapshot.messages.filter(
      (message) =>
        isCompanionConversationAudience(message.audience) &&
        message.audience.kind === 'owner-private',
    ),
    tasks: snapshot.tasks.filter(
      (task) =>
        isCompanionConversationAudience(task.origin?.audience) &&
        task.origin.audience.kind === 'owner-private',
    ),
    facts: snapshot.facts.filter(
      (fact) =>
        isCompanionAudience(fact.audience) &&
        (fact.audience.kind === 'owner-private' || fact.audience.kind === 'public'),
    ),
  };
}
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const problem = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const terminal = (status: string) =>
  ['completed', 'cancelled', 'failed', 'interrupted'].includes(status);
interface Pending {
  readonly key: string;
  readonly view: DesktopCompanionPending;
  readonly promise?: Promise<Result<CompanionCommandReceipt>>;
}
interface Connection {
  readonly id: string;
  readonly clientId: string;
  readonly source: DesktopCompanionSource;
  token: string;
  readonly abort: AbortController;
  readonly work: Set<Promise<unknown>>;
  readonly pending: Map<string, Pending>;
  readonly tasks: Map<string, CompanionTask>;
  refresh: Promise<void> | null;
  refreshAgain: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  offSource: () => void;
  confirmation: number;
  follow: Promise<void> | null;
  streaming: boolean;
  restartFollow: boolean;
}

/** One native connection/projection owner shared by both trusted windows. */
export class DesktopCompanionController {
  #state = initialDesktopCompanionState();
  #connection: Connection | null = null;
  #retiring: Promise<void> | null = null;
  #control = false;
  #closed = false;
  readonly #voiceRetiring = new Set<(connectionId: string) => Promise<void>>();
  readonly #speechRetiring = new Set<(connectionId: string) => Promise<void>>();
  readonly #speechEvents = new Set<(event: SpeechConnectionEvent) => void>();
  onSpeechEvent(listener: (event: SpeechConnectionEvent) => void): () => void {
    this.#speechEvents.add(listener);
    return () => {
      this.#speechEvents.delete(listener);
    };
  }
  onSpeechRetiring(listener: (connectionId: string) => Promise<void>): () => void {
    this.#speechRetiring.add(listener);
    return () => {
      this.#speechRetiring.delete(listener);
    };
  }
  #speechEvent(event: SpeechConnectionEvent): void {
    for (const listener of this.#speechEvents) listener(event);
  }
  #initialization = 0;
  readonly #offCommit: () => void;
  constructor(
    private readonly host: DesktopCompanionHostPort,
    private readonly destination: DesktopArtifactDestination,
    private readonly changed: () => void,
    private readonly openExternal?: (url: string) => Promise<void>,
  ) {
    this.#offCommit = host.onConfigurationCommit((revision) => {
      if (!this.#connection || this.#connection.source.configRevision === revision) return;
      const retiring = this.#retire(); // fence token/I/O before any fallible notification
      this.#publish({ snapshot: null, confirmedAt: null, pending: [] });
      void retiring
        .then(async () => {
          if (!this.#control) await this.initialize();
        })
        .catch((error: unknown) => this.#publish({ source: 'unavailable', error: problem(error) }));
    });
  }
  async initialize(): Promise<void> {
    const issued = ++this.#initialization;
    const endpoint = await this.host.readEndpoint();
    const source = await this.host.readSource();
    if (this.#closed || issued !== this.#initialization) return;
    this.#publish({
      ...(endpoint.ok
        ? { baseUrl: endpoint.value.baseUrl, configRevision: endpoint.value.revision }
        : {}),
      source: source.ok ? 'ready' : endpoint.ok ? 'disabled' : 'unavailable',
      error: source.ok ? null : source.error,
    });
  }
  async getState(): Promise<Result<DesktopCompanionState>> {
    return { ok: true, value: structuredClone(this.#state) };
  }
  #publish(patch: Partial<DesktopCompanionState>): void {
    if (this.#closed) return;
    const next: DesktopCompanionState = {
      ...this.#state,
      ...patch,
      revision: this.#state.revision + 1,
    };
    if (
      Buffer.byteLength(JSON.stringify({ ok: true, value: next })) >
      DESKTOP_COMPANION_MAX_STATE_BYTES
    )
      throw new KernelFault('quota-exceeded');
    const wasLive = this.#state.phase === 'live';
    this.#state = next;
    if (this.#connection && wasLive && next.phase !== 'live')
      this.#speechEvent({
        kind: 'fence',
        connectionId: this.#connection.id,
        error: next.error ?? makeError('stale-owner', false),
      });
    if (this.#connection && !wasLive && next.phase === 'live')
      this.#speechEvent({ kind: 'live', connectionId: this.#connection.id });
    this.changed();
  }
  #current(connection: Connection): boolean {
    return (
      !this.#closed &&
      this.#connection === connection &&
      !connection.abort.signal.aborted &&
      !connection.source.signal.aborted
    );
  }
  #binding(target: DesktopCompanionTarget, live = true): Connection {
    const active = this.#connection;
    if (!active || target.connectionId !== active.id || !this.#current(active))
      throw new KernelFault('stale-owner');
    if (live && this.#state.phase !== 'live') throw new KernelFault('not-ready');
    return active;
  }
  /** Native-only handoff to the explicitly selected local host; never exposed as a secret getter. */
  async handoffCurrentAgent<T>(
    target: DesktopCompanionTarget,
    receive: (
      agent: {
        readonly baseUrl: string;
        readonly agentId: string;
        readonly agentEpoch: string;
        readonly token: string;
      },
      signal: AbortSignal,
    ) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    try {
      const connection = this.#binding(target);
      const snapshot = this.#state.snapshot;
      if (!snapshot) return fail('not-ready');
      const agentId = snapshot.agent.id;
      const agentEpoch = snapshot.epoch;
      return await this.#run(connection, async (transport, signal) => {
        if (
          !this.#current(connection) ||
          this.#state.snapshot?.agent.id !== agentId ||
          this.#state.snapshot?.epoch !== agentEpoch
        )
          return fail('stale-owner');
        return receive(
          { baseUrl: transport.baseUrl, agentId, agentEpoch, token: transport.token },
          signal,
        );
      });
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async #run<T>(
    connection: Connection,
    operation: (transport: ClientTransport, signal: AbortSignal) => Promise<Result<T>>,
    commit?: ArtifactSaveCommit,
  ): Promise<Result<T>> {
    if (!this.#current(connection)) return fail('stale-owner');
    const work = (async (): Promise<Result<T>> => {
      try {
        const result = await this.host.withToken(
          connection.source,
          connection.token,
          AbortSignal.any([connection.abort.signal, connection.source.signal]),
          (token, signal) => operation({ baseUrl: connection.source.baseUrl, token }, signal),
          commit,
        );
        if (
          commit?.connectionId === connection.id &&
          isCommittedArtifactSave(result, commit, connection.source)
        )
          return result;
        if (!this.#current(connection)) return fail('stale-owner');
        const sourceCurrent = await this.host.isCurrent(connection.source);
        if (!this.#current(connection)) return fail('stale-owner');
        if (!sourceCurrent) {
          this.#invalidate(connection, makeError('permission-denied', false));
          return fail('stale-owner');
        }
        return result;
      } catch (error) {
        if (this.#current(connection)) {
          const sourceCurrent = await this.host.isCurrent(connection.source).catch(() => false);
          if (this.#current(connection) && !sourceCurrent)
            this.#invalidate(connection, problem(error));
        }
        return { ok: false, error: problem(error) };
      }
    })();
    connection.work.add(work);
    try {
      return await work;
    } finally {
      connection.work.delete(work);
    }
  }
  onVoiceRetiring(listener: (connectionId: string) => Promise<void>): () => void {
    this.#voiceRetiring.add(listener);
    return () => {
      this.#voiceRetiring.delete(listener);
    };
  }
  voiceSession(target: DesktopCompanionTarget): CompanionVoiceSession {
    const connection = this.#binding(target);
    const agent = this.#state.snapshot?.agent;
    if (!agent || agent.status === 'unavailable') throw new KernelFault('not-ready');
    const agentId = agent.id;
    const serviceEpoch = this.#state.snapshot?.epoch;
    const current = () =>
      this.#current(connection) &&
      this.#state.phase === 'live' &&
      this.#state.snapshot?.agent.id === agentId &&
      this.#state.snapshot.epoch === serviceEpoch;
    const run = <T>(
      operation: (transport: ClientTransport, signal: AbortSignal) => Promise<Result<T>>,
      signal?: AbortSignal,
    ) => {
      if (!current()) return Promise.resolve(fail<T>('stale-owner'));
      return this.#run(connection, async (transport, authorized) => {
        if (!current()) return fail<T>('stale-owner');
        const value = await operation(
          transport,
          signal ? AbortSignal.any([authorized, signal]) : authorized,
        );
        return current() ? value : fail<T>('stale-owner');
      });
    };
    const view = (value: VoiceView) => ({
      ...value,
      providers: value.providers.map((provider) => ({
        ...provider,
        credential: { ...provider.credential, writable: false },
      })),
    });
    const manage = async (operation: Parameters<typeof run<VoiceView>>[0]) => {
      const result = await run(operation);
      return result.ok ? { ok: true as const, value: view(result.value) } : result;
    };
    return Object.freeze<CompanionVoiceSession>({
      connectionId: connection.id,
      clientId: connection.clientId,
      agentId,
      signal: connection.abort.signal,
      isCurrent: async () => {
        if (!current()) return false;
        const valid = await this.host.isCurrent(connection.source);
        return current() && valid;
      },
      readVoice: async (signal?: AbortSignal) => {
        const result = await run((t, s) => getVoice(t, s), signal);
        return result.ok ? { ok: true as const, value: view(result.value) } : result;
      },
      saveSettings: (command: VoiceSettingsCommand) =>
        manage((t, s) => saveVoiceSettings(t, command, s)),
      saveProvider: (command: VoiceProviderCommand) =>
        manage((t, s) => saveAsrProvider(t, command, s)),
      catalog: (input: { providerRef: string; bindingId: string }) =>
        run((t, s) => getVoiceCatalog(t, input, s)),
      begin: (selection: VoiceBeginSelection, signal: AbortSignal) =>
        run<VoiceTicket>(
          (t, s) =>
            beginVoiceCapture(t, { ...selection, clientId: connection.clientId, agentId }, s),
          signal,
        ),
      upload: (ticket: VoiceTicket, samples: number, pcm: Uint8Array, signal: AbortSignal) =>
        ticket.clientId !== connection.clientId || ticket.agentId !== agentId
          ? Promise.resolve(fail('stale-owner'))
          : run((t, s) => uploadVoiceCapture(t, ticket, samples, pcm, s), signal),
      result: (key: VoiceResultKey, signal?: AbortSignal) =>
        key.clientId !== connection.clientId || key.agentId !== agentId
          ? Promise.resolve(fail('stale-owner'))
          : run((t, s) => getVoiceCapture(t, key, s), signal),
      cancel: (ticket: VoiceTicket) =>
        ticket.clientId !== connection.clientId || ticket.agentId !== agentId
          ? Promise.resolve(fail('stale-owner'))
          : run((t, s) => cancelVoiceCapture(t, ticket, s)),
    });
  }
  speechSession(target: DesktopCompanionTarget): CompanionSpeechSession {
    const connection = this.#binding(target);
    const snapshot = this.#state.snapshot;
    if (!snapshot || snapshot.agent.status === 'unavailable') throw new KernelFault('not-ready');
    const agentId = snapshot.agent.id,
      serviceEpoch = snapshot.epoch;
    const current = () =>
      this.#current(connection) &&
      this.#state.phase === 'live' &&
      this.#state.snapshot?.agent.id === agentId &&
      this.#state.snapshot.epoch === serviceEpoch;
    const run = <T>(
      operation: (t: ClientTransport, s: AbortSignal) => Promise<Result<T>>,
      signal?: AbortSignal,
    ): Promise<Result<T>> => {
      if (!current()) return Promise.resolve(fail('stale-owner'));
      return this.#run(connection, async (t, authorized) => {
        if (!current()) return fail('stale-owner');
        const result = await operation(
          t,
          signal ? AbortSignal.any([authorized, signal]) : authorized,
        );
        return current() ? result : fail('stale-owner');
      });
    };
    const matches = (key: SpeechUtteranceKey) =>
      key.clientId === connection.clientId &&
      key.agentId === agentId &&
      key.serviceEpoch === serviceEpoch;
    const view = (value: SpeechView): SpeechView => ({
      ...value,
      providers: value.providers.map((p) => ({
        ...p,
        credential: { ...p.credential, writable: false },
      })),
    });
    return Object.freeze<CompanionSpeechSession>({
      connectionId: connection.id,
      clientId: connection.clientId,
      agentId,
      serviceEpoch,
      signal: AbortSignal.any([connection.abort.signal, connection.source.signal]),
      isCurrent: async () =>
        current() && (await this.host.isCurrent(connection.source)) && current(),
      baseline: (signal) =>
        run(async (t, s) => {
          const result = await getSnapshot(t, s);
          return result.ok &&
            result.value.agent.id === agentId &&
            result.value.epoch === serviceEpoch
            ? {
                ok: true,
                value: {
                  connectionId: connection.id,
                  clientId: connection.clientId,
                  agentId,
                  serviceEpoch,
                  cursor: result.value.cursor,
                },
              }
            : result.ok
              ? fail('stale-owner')
              : result;
        }, signal),
      readSpeech: async (signal) => {
        const result = await run(getSpeech, signal);
        return result.ok ? { ok: true, value: view(result.value) } : result;
      },
      saveProvider: async (command) => {
        const result = await run((t, s) => saveSpeechProvider(t, command, s));
        this.#schedule(connection);
        return result.ok ? { ok: true, value: view(result.value) } : result;
      },
      catalog: (input) => run((t, s) => getSpeechCatalog(t, input, s)),
      begin: (input, signal) =>
        matches(input)
          ? run((t, s) => beginSpeechUtterance(t, input, s), signal)
          : Promise.resolve(fail('stale-owner')),
      reserve: (input, signal) =>
        matches(input)
          ? run((t, s) => reserveSpeechSegment(t, input, s), signal)
          : Promise.resolve(fail('stale-owner')),
      consumeAudio: (input, binding, signal, consume) =>
        matches(input)
          ? run(async (t, s) => {
              const result = await consumeSpeechAudio(t, input, binding, consume, s);
              return result.ok ? { ok: true, value: null } : result;
            }, signal)
          : Promise.resolve(fail('stale-owner')),
      status: (input, signal) =>
        matches(input)
          ? run((t, s) => getSpeechUtterance(t, input, s), signal)
          : Promise.resolve(fail('stale-owner')),
      cancel: (input) =>
        matches(input)
          ? run((t, s) => cancelSpeechUtterance(t, input, s))
          : Promise.resolve(fail('stale-owner')),
    });
  }
  async connect(input: {
    expectedRevision: number;
    baseUrl: string;
    token: string;
  }): Promise<Result<DesktopCompanionState>> {
    if (this.#closed || this.#control) return fail('conflict');
    this.#control = true;
    this.#initialization++;
    let committed: DesktopCompanionEndpointSave | null = null;
    try {
      const baseUrl = companionEndpoint(input.baseUrl);
      const bytes = Buffer.byteLength(input.token);
      if (bytes < 24 || bytes > 512 || hasControls(input.token)) return fail('invalid-input');
      const source = await this.host.readSource();
      if (!source.ok) return source;
      const saved = await this.host.saveEndpoint(baseUrl, input.expectedRevision);
      if (!saved.ok) return saved;
      committed = saved.value;
      try {
        await this.#retire();
      } catch (error) {
        this.#publish({
          baseUrl,
          configRevision: saved.value.configRevision,
          error: problem(error),
          source: 'unavailable',
        });
        return this.getState();
      }
      if (!committed.source.ok) {
        this.#publish({
          baseUrl: committed.baseUrl,
          configRevision: committed.configRevision,
          source: 'unavailable',
          phase: 'offline',
          error: committed.source.error,
        });
        return this.getState();
      }
      const current = await this.host.readSource();
      if (!current.ok) {
        this.#publish({
          baseUrl,
          configRevision: saved.value.configRevision,
          error: current.error,
          source: 'unavailable',
        });
        return this.getState();
      }
      if (
        current.value.configRevision !== committed.configRevision ||
        current.value.signal.aborted
      ) {
        this.#publish({
          baseUrl: current.value.baseUrl,
          configRevision: current.value.configRevision,
          source: 'unavailable',
          phase: 'offline',
          error: makeError(current.value.signal.aborted ? 'stale-owner' : 'conflict', false),
        });
        return this.getState();
      }
      const connection: Connection = {
        id: randomUUID(),
        clientId: randomUUID(),
        source: current.value,
        token: input.token,
        abort: new AbortController(),
        work: new Set(),
        pending: new Map(),
        tasks: new Map(),
        refresh: null,
        refreshAgain: false,
        timer: null,
        offSource: () => {},
        confirmation: 0,
        follow: null,
        streaming: false,
        restartFollow: false,
      };
      this.#connection = connection;
      const sourceAborted = () => {
        void this.retireSource(connection.source.owner).catch((error: unknown) =>
          this.#publish({ source: 'unavailable', error: problem(error) }),
        );
      };
      connection.source.signal.addEventListener('abort', sourceAborted, { once: true });
      connection.offSource = () =>
        connection.source.signal.removeEventListener('abort', sourceAborted);
      if (connection.source.signal.aborted) {
        await this.retireSource(connection.source.owner);
        this.#publish({
          baseUrl: committed.baseUrl,
          configRevision: committed.configRevision,
          source: 'unavailable',
          phase: 'offline',
          error: makeError('stale-owner', false),
        });
        return this.getState();
      }
      this.#publish({
        source: 'ready',
        baseUrl,
        configRevision: current.value.configRevision,
        connectionId: connection.id,
        phase: 'connecting',
        snapshot: null,
        pending: [],
        confirmedAt: null,
        error: null,
      });
      await this.#refresh(connection);
      if (this.#current(connection) && this.#state.phase === 'live') this.#startFollow(connection);
      return this.getState();
    } catch (error) {
      if (committed) {
        let failure = problem(error);
        try {
          await this.#retire();
        } catch (drainError) {
          failure = problem(drainError);
        }
        this.#publish({
          baseUrl: committed.baseUrl,
          configRevision: committed.configRevision,
          source: 'unavailable',
          error: failure,
        });
        return this.getState();
      }
      return { ok: false, error: problem(error) };
    } finally {
      this.#control = false;
    }
  }
  async reconnect(target: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>> {
    if (this.#control) return fail('conflict');
    this.#control = true;
    try {
      const active = this.#binding(target, false);
      if (this.#state.phase === 'live') return this.getState();
      this.#publish({ phase: 'connecting', error: null });
      active.confirmation++;
      if (active.refresh) await active.refresh;
      await this.#refresh(active);
      const next = await this.getState();
      if (this.#current(active) && next.ok && next.value.phase === 'live')
        this.#startFollow(active);
      return this.getState();
    } catch (error) {
      return { ok: false, error: problem(error) };
    } finally {
      this.#control = false;
    }
  }
  async disconnect(target: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>> {
    if (this.#control) return fail('conflict');
    this.#control = true;
    try {
      this.#binding(target, false);
      await this.#retire();
      this.#publish({ phase: 'idle', connectionId: null, pending: [], error: null });
      return this.getState();
    } catch (error) {
      this.#publish({ source: 'unavailable', error: problem(error) });
      return this.getState();
    } finally {
      this.#control = false;
    }
  }
  async openWeb(target: DesktopCompanionTarget): Promise<Result<null>> {
    try {
      const connection = this.#binding(target);
      const open = this.openExternal;
      if (!open) return fail('not-ready');
      const url = companionEndpoint(connection.source.baseUrl);
      const work = (async (): Promise<Result<null>> => {
        const current = await this.host.isCurrent(connection.source);
        if (!this.#current(connection) || this.#state.phase !== 'live') return fail('stale-owner');
        if (!current) {
          this.#invalidate(connection, makeError('permission-denied', false));
          return fail('stale-owner');
        }
        await open(url);
        return { ok: true, value: null };
      })();
      connection.work.add(work);
      try {
        return await work;
      } finally {
        connection.work.delete(work);
      }
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async refresh(target: DesktopCompanionTarget): Promise<Result<DesktopCompanionState>> {
    try {
      await this.#refresh(this.#binding(target));
      return this.getState();
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  #adopt(connection: Connection, snapshot: CompanionSnapshot): void {
    if (!this.#current(connection)) return;
    try {
      snapshot = desktopPersonalSnapshot(snapshot);
    } catch (error) {
      this.#publish({ phase: 'offline', error: problem(error) });
      return;
    }
    const previous = this.#state.snapshot;
    if (
      previous &&
      (previous.agent.id !== snapshot.agent.id || previous.epoch !== snapshot.epoch)
    ) {
      // Fence the captured audio intent before publishing a replacement Agent/service epoch.
      this.#speechEvent({
        kind: 'fence',
        connectionId: connection.id,
        error: makeError('stale-owner', false),
      });
      void Promise.allSettled(
        [...this.#voiceRetiring, ...this.#speechRetiring].map((listener) =>
          listener(connection.id),
        ),
      );
    }
    for (const [id, pending] of connection.pending) {
      if (pending.view.kind === 'message' && snapshot.messages.some((item) => item.inputId === id))
        connection.pending.delete(id);
      if (
        pending.view.kind === 'stop' &&
        snapshot.tasks.some((item) => item.id === pending.view.taskId && terminal(item.status))
      )
        connection.pending.delete(id);
    }
    this.#publish({
      phase: 'live',
      error: null,
      confirmedAt: Date.now(),
      snapshot: {
        ...snapshot,
        ...(snapshot.model ? { model: desktopModelView(snapshot.model) } : {}),
      },
      pending: [...connection.pending.values()].map((item) => item.view),
    });
  }
  #schedule(connection: Connection): void {
    if (!this.#current(connection) || connection.timer || this.#state.phase !== 'live') return;
    connection.timer = setTimeout(() => {
      connection.timer = null;
      if (this.#state.phase === 'live') void this.#refresh(connection);
    }, 120);
  }
  async #refresh(connection: Connection): Promise<void> {
    if (connection.refresh) {
      connection.refreshAgain = true;
      return connection.refresh;
    }
    const confirmation = connection.confirmation;
    const refresh = (async () => {
      const result = await this.#run(connection, (transport, signal) =>
        getSnapshot(transport, signal),
      );
      if (!this.#current(connection)) return;
      if (confirmation !== connection.confirmation) return;
      if (result.ok) {
        this.#adopt(connection, result.value);
        this.#speechEvent({ kind: 'refresh', connectionId: connection.id });
      } else this.#publish({ phase: 'offline', error: result.error });
    })();
    connection.refresh = refresh;
    try {
      await refresh;
    } finally {
      connection.refresh = null;
      if (connection.refreshAgain) {
        connection.refreshAgain = false;
        this.#schedule(connection);
      }
    }
  }
  #startFollow(connection: Connection): void {
    if (connection.follow) {
      connection.restartFollow = !connection.streaming;
      return;
    }
    connection.restartFollow = false;
    const work = this.#follow(connection);
    connection.follow = work;
    void work
      .catch((error: unknown) => {
        if (this.#current(connection)) this.#publish({ phase: 'offline', error: problem(error) });
      })
      .finally(() => {
        connection.follow = null;
        if (connection.restartFollow && this.#current(connection) && this.#state.phase === 'live')
          this.#startFollow(connection);
      });
  }
  async #follow(connection: Connection): Promise<void> {
    while (this.#current(connection)) {
      const snapshot = this.#state.snapshot;
      if (!snapshot) return;
      connection.streaming = true;
      this.#speechEvent({ kind: 'live', connectionId: connection.id });
      const result = await this.#run(connection, async (transport, signal) => ({
        ok: true,
        value: await streamEvents(
          transport,
          {
            after: snapshot.cursor,
            epoch: snapshot.epoch,
            signal,
            onInvalidEvent: () => {
              if (this.#current(connection))
                this.#speechEvent({
                  kind: 'invalid',
                  connectionId: connection.id,
                });
            },
          },
          (message) => {
            if (!this.#current(connection)) return;
            if (message.kind === 'companion')
              this.#speechEvent({
                kind: 'event',
                baseline: {
                  connectionId: connection.id,
                  clientId: connection.clientId,
                  agentId: this.#state.snapshot?.agent.id ?? snapshot.agent.id,
                  serviceEpoch: snapshot.epoch,
                  cursor: snapshot.cursor,
                },
                event: message.event,
              });
            void this.host
              .isCurrent(connection.source)
              .then((valid) => {
                if (!this.#current(connection)) return;
                if (valid) this.#schedule(connection);
                else this.#invalidate(connection, makeError('permission-denied', false));
              })
              .catch((error: unknown) => {
                if (this.#current(connection)) this.#invalidate(connection, problem(error));
              });
          },
        ),
      }));
      if (!this.#current(connection)) return;
      connection.streaming = false;
      connection.confirmation++;
      if (connection.timer) clearTimeout(connection.timer);
      connection.timer = null;
      connection.refreshAgain = false;
      const error = !result.ok
        ? result.error
        : result.value.kind === 'failed'
          ? result.value.error
          : makeError('network');
      this.#publish({ phase: 'offline', error });
      if (error.code === 'auth-failed') return;
      const next = await this.#run(connection, (transport, signal) =>
        getSnapshot(transport, signal),
      );
      if (!this.#current(connection)) return;
      if (!next.ok) {
        this.#publish({ phase: 'offline', error: next.error });
        return;
      }
      if (next.value.epoch === snapshot.epoch) return;
      this.#adopt(connection, next.value);
    }
  }
  async #command(
    connection: Connection,
    id: string,
    kind: 'message' | 'stop',
    payload: string,
    taskId: string | null,
    operation: (
      transport: ClientTransport,
      signal: AbortSignal,
    ) => Promise<Result<CompanionCommandReceipt>>,
  ): Promise<Result<CompanionCommandReceipt>> {
    const existing = connection.pending.get(id);
    if (existing && existing.key !== payload) return fail('conflict');
    if (existing?.promise) return existing.promise;
    if (!existing && connection.pending.size >= DESKTOP_COMPANION_MAX_PENDING)
      return fail('quota-exceeded');
    const view: DesktopCompanionPending = { commandId: id, kind, taskId, status: 'sending' };
    const work = this.#run(connection, operation);
    const pending: Pending = { key: payload, view, promise: work };
    connection.pending.set(id, pending);
    this.#publish({ pending: [...connection.pending.values()].map((item) => item.view) });
    const result = await work;
    if (!this.#current(connection)) return fail('stale-owner');
    if (connection.pending.get(id) !== pending) return result;
    if (result.ok || ['network', 'timeout', 'unavailable', 'internal'].includes(result.error.code))
      connection.pending.set(id, {
        key: payload,
        view: { ...view, status: result.ok ? 'accepted' : 'uncertain' },
      });
    else connection.pending.delete(id);
    this.#publish({ pending: [...connection.pending.values()].map((item) => item.view) });
    this.#schedule(connection); // One reconciliation also resolves uncertain receipts; never resend.
    return result;
  }
  async sendMessage(
    input: DesktopCompanionTarget & CompanionMessageCommand,
  ): Promise<Result<CompanionCommandReceipt>> {
    try {
      const connection = this.#binding(input);
      const text = input.text.trim();
      if (!text || text.length > 8000) return fail('invalid-input');
      return await this.#command(
        connection,
        input.commandId,
        'message',
        JSON.stringify(['message', text]),
        null,
        (transport, signal) => sendMessage(transport, { commandId: input.commandId, text }, signal),
      );
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async stopTask(
    input: DesktopCompanionTarget & CompanionStopCommand & { taskId: string },
  ): Promise<Result<CompanionCommandReceipt>> {
    try {
      const connection = this.#binding(input);
      return await this.#command(
        connection,
        input.commandId,
        'stop',
        JSON.stringify(['stop', input.taskId]),
        input.taskId,
        (transport, signal) =>
          stopTask(transport, input.taskId, { commandId: input.commandId }, signal),
      );
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async stopForeground(input: DesktopCompanionTarget): Promise<Result<null>> {
    try {
      const connection = this.#binding(input);
      return await this.#run(connection, (transport, signal) =>
        stopForeground(transport, randomUUID(), signal),
      );
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async readProfile(input: DesktopCompanionTarget): Promise<Result<CompanionProfileView>> {
    try {
      const connection = this.#binding(input);
      const result = await this.#run(connection, getProfile);
      if (
        result.ok &&
        (result.value.agentId !== this.#state.snapshot?.agent.id ||
          result.value.revision !== this.#state.snapshot?.agent.profileRevision)
      ) {
        this.#schedule(connection);
        return fail('conflict');
      }
      return result;
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  readMemory(input: DesktopCompanionTarget): Promise<Result<CompanionMemoryView>> {
    return this.#managed(input, getMemory, (view) => view.agentId, false);
  }
  saveProfile(
    input: DesktopCompanionTarget & { command: CompanionProfileSaveCommand },
  ): Promise<Result<CompanionProfileView>> {
    return this.#managed(
      input,
      (t, s) => saveProfile(t, input.command, s),
      (view) => view.agentId,
      true,
    );
  }
  upsertFact(
    input: DesktopCompanionTarget & { command: CompanionMemoryUpsertCommand },
  ): Promise<Result<CompanionMemoryMutationResult>> {
    return this.#managed(
      input,
      (t, s) => upsertFact(t, input.command, s),
      (value) => value.view.agentId,
      true,
    );
  }
  forgetFact(
    input: DesktopCompanionTarget & { command: CompanionMemoryForgetCommand },
  ): Promise<Result<CompanionMemoryMutationResult>> {
    return this.#managed(
      input,
      (t, s) => forgetFact(t, input.command, s),
      (value) => value.view.agentId,
      true,
    );
  }
  async #managed<T>(
    input: DesktopCompanionTarget,
    operation: (t: ClientTransport, s: AbortSignal) => Promise<Result<T>>,
    identity: (value: T) => string,
    mutation: boolean,
  ): Promise<Result<T>> {
    try {
      const connection = this.#binding(input);
      const agentId = this.#state.snapshot?.agent.id;
      const result = await this.#run(connection, operation);
      if (mutation) this.#schedule(connection);
      return result.ok && identity(result.value) !== agentId ? fail('unavailable') : result;
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async readTask(
    input: DesktopCompanionTarget & { taskId: string },
  ): Promise<Result<CompanionTask>> {
    try {
      const connection = this.#binding(input);
      const result = await this.#run(connection, (transport, signal) =>
        getTask(transport, input.taskId, signal),
      );
      if (result.ok) {
        if (connection.tasks.size >= 16) connection.tasks.clear();
        connection.tasks.set(result.value.id, result.value);
      }
      return result;
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async saveModel(
    input: DesktopCompanionTarget & { command: CompanionModelSaveCommand },
  ): Promise<Result<CompanionModelView>> {
    return this.#model(input, (transport, signal) => saveModel(transport, input.command, signal));
  }
  async testModel(
    input: DesktopCompanionTarget & { command: CompanionModelTestCommand },
  ): Promise<Result<CompanionModelView>> {
    return this.#model(input, (transport, signal) => testModel(transport, input.command, signal));
  }
  async #model(
    input: DesktopCompanionTarget,
    operation: (
      transport: ClientTransport,
      signal: AbortSignal,
    ) => Promise<Result<CompanionModelView>>,
  ): Promise<Result<CompanionModelView>> {
    try {
      const connection = this.#binding(input);
      const result = await this.#run(connection, operation);
      if (!result.ok) return result;
      this.#schedule(connection);
      return { ok: true, value: desktopModelView(result.value) };
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async saveArtifact(
    input: DesktopCompanionTarget & { artifactId: string },
    senderId: number,
  ): Promise<Result<DesktopArtifactSave>> {
    try {
      const connection = this.#binding(input);
      const tasks = [...(this.#state.snapshot?.tasks ?? []), ...connection.tasks.values()];
      const artifact = tasks
        .flatMap((task) => task.artifacts)
        .find((item) => item.id === input.artifactId);
      if (!artifact) return fail('invalid-input');
      const commit: ArtifactSaveCommit = Object.freeze({
        source: connection.source,
        connectionId: connection.id,
      });
      return await this.#run(
        connection,
        (transport, signal) =>
          saveCompanionArtifact(
            transport,
            artifact,
            this.destination,
            senderId,
            signal,
            () => this.#current(connection),
            commit,
          ),
        commit,
      );
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  #invalidate(connection: Connection, error: KernelError): void {
    if (!this.#current(connection)) return;
    void this.#retire()
      .then(() => {
        if (!this.#connection) this.#publish({ source: 'unavailable', error });
      })
      .catch((failure: unknown) => {
        if (!this.#connection || this.#connection === connection)
          this.#publish({ source: 'unavailable', error: problem(failure) });
      });
  }
  async #retire(): Promise<void> {
    if (this.#retiring) return this.#retiring;
    const connection = this.#connection;
    if (!connection) return;
    connection.offSource();
    connection.abort.abort();
    connection.token = '';
    if (connection.timer) clearTimeout(connection.timer);
    connection.timer = null;
    this.#publish({ phase: 'retiring' });
    const retireVoice = [...this.#voiceRetiring, ...this.#speechRetiring].map((listener) =>
      Promise.resolve().then(() => listener(connection.id)),
    );
    const retiring = (async () => {
      const results = await Promise.allSettled([...retireVoice, ...connection.work]);
      if (results.some((item) => item.status === 'rejected')) throw new KernelFault('unavailable');
      if (this.#connection === connection) this.#connection = null;
      this.#publish({ phase: 'offline', connectionId: null, pending: [] });
    })();
    this.#retiring = retiring;
    try {
      await retiring;
    } finally {
      this.#retiring = null;
    }
  }
  async retireSource(owner: OwnerRef): Promise<void> {
    const active = this.#connection;
    if (
      !active ||
      active.source.owner.pluginId !== owner.pluginId ||
      active.source.owner.instanceId !== owner.instanceId ||
      active.source.owner.generation !== owner.generation
    )
      return;
    await this.#retire();
    if (this.#connection && this.#connection !== active) return;
    this.#publish({ source: 'disabled', error: makeError('not-ready', false) });
  }
  async close(): Promise<void> {
    this.#offCommit();
    await this.#retire();
    this.#closed = true;
  }
}

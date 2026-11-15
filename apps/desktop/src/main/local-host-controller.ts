import {
  isLocalHostConsoleView,
  makeError,
  type DesktopLocalHostBridge,
  type DesktopLocalHostState,
  type DesktopLocalHostAgentHandoff,
  type LocalHostConsoleTarget,
  type LocalHostConsoleMutation,
  type Result,
  type KernelError,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { LocalManagementClient } from '@pet/local-host';
import { getSnapshot, getLocalHostSelection, selectLocalHost } from '@pet/text-client/protocol';
import type { DesktopCompanionController } from './companion-client-controller.js';

interface Session {
  readonly client: LocalManagementClient;
  readonly target: LocalHostConsoleTarget;
  off(): void;
  read: Promise<void> | null;
  again: boolean;
  stopping: boolean;
}
const failed = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const problem = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);

/** Main owns one management session and projection. Closing the GUI only detaches it. */
export class DesktopLocalHostController implements DesktopLocalHostBridge {
  readonly version = 1 as const;
  #state: DesktopLocalHostState = { revision: 0, phase: 'stopped', view: null, error: null };
  #session: Session | null = null;
  #opening: Promise<Result<DesktopLocalHostState>> | null = null;
  #closed = false;
  readonly #listeners = new Set<() => void>();
  constructor(
    private readonly options: {
      attach(): Promise<LocalManagementClient>;
      start(): Promise<LocalManagementClient>;
      readonly companion: Pick<DesktopCompanionController, 'handoffCurrentAgent'>;
      changed(): void;
    },
  ) {}
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #publish(patch: Partial<DesktopLocalHostState>): void {
    if (this.#closed) return;
    this.#state = { ...this.#state, ...patch, revision: this.#state.revision + 1 };
    this.options.changed();
    for (const listener of this.#listeners) listener();
  }
  async getState(): Promise<Result<DesktopLocalHostState>> {
    return { ok: true, value: structuredClone(this.#state) };
  }
  async initialize(): Promise<void> {
    await this.#open(false);
  }
  start(): Promise<Result<DesktopLocalHostState>> {
    return this.#open(true);
  }
  #open(start: boolean): Promise<Result<DesktopLocalHostState>> {
    if (this.#closed) return Promise.resolve(failed('unavailable'));
    if (this.#opening) return this.#opening;
    if (this.#session && !this.#session.client.signal.aborted)
      return this.#refresh(this.#session).then(() => this.getState());
    this.#publish({ phase: 'starting', error: null });
    const opening = (async (): Promise<Result<DesktopLocalHostState>> => {
      try {
        const client = await (start ? this.options.start() : this.options.attach());
        if (this.#closed || client.signal.aborted) {
          await client.close();
          if (this.#closed) return failed('cancelled');
          throw new KernelFault('unavailable');
        }
        const session: Session = {
          client,
          target: { hostId: client.identity.hostId, bootId: client.identity.bootId },
          off: () => {},
          read: null,
          again: false,
          stopping: false,
        };
        this.#session = session;
        session.off = client.onChanged(() => {
          void this.#refresh(session);
        });
        client.signal.addEventListener(
          'abort',
          () => {
            if (this.#session === session && !session.stopping) {
              session.off();
              this.#session = null;
              this.#publish({ phase: 'failed', error: makeError('unavailable', false) });
            }
          },
          { once: true },
        );
        await this.#refresh(session);
        return this.getState();
      } catch (error) {
        const fault = problem(error);
        this.#publish({
          phase: !start && fault.code === 'not-ready' ? 'stopped' : 'failed',
          error: !start && fault.code === 'not-ready' ? null : fault,
          view: null,
        });
        return !start && fault.code === 'not-ready' ? this.getState() : { ok: false, error: fault };
      }
    })();
    this.#opening = opening;
    void opening.finally(() => {
      if (this.#opening === opening) this.#opening = null;
    });
    return opening;
  }
  #capture(target: LocalHostConsoleTarget): Session {
    const session = this.#session;
    if (
      this.#closed ||
      !session ||
      session.client.signal.aborted ||
      session.target.hostId !== target.hostId ||
      session.target.bootId !== target.bootId
    )
      throw new KernelFault('stale-owner');
    if (session.stopping) throw new KernelFault('not-ready');
    return session;
  }
  async #refresh(session: Session): Promise<void> {
    session.again = true;
    if (session.read) return session.read;
    const read = (async () => {
      try {
        while (session.again && this.#session === session && !this.#closed) {
          session.again = false;
          const result = await session.client.view(session.target);
          if (
            this.#session !== session ||
            this.#closed ||
            session.stopping ||
            session.client.signal.aborted
          )
            return;
          if (!result.ok) {
            this.#publish({ phase: 'failed', error: result.error });
            return;
          }
          if (
            !isLocalHostConsoleView(result.value) ||
            result.value.identity.hostId !== session.target.hostId ||
            result.value.identity.bootId !== session.target.bootId ||
            result.value.identity.packageVersion !== session.client.identity.packageVersion ||
            result.value.identity.protocolVersion !== session.client.identity.protocolVersion
          ) {
            this.#publish({ phase: 'failed', error: makeError('invalid-input', false) });
            return;
          }
          this.#publish({ phase: 'running', view: result.value, error: null });
        }
      } catch (error) {
        if (this.#session === session && !session.stopping)
          this.#publish({ phase: 'failed', error: problem(error) });
      }
    })();
    session.read = read;
    try {
      await read;
    } finally {
      if (session.read === read) session.read = null;
    }
  }
  async #operate<T>(
    target: LocalHostConsoleTarget,
    operation: (client: LocalManagementClient) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    try {
      const session = this.#capture(target);
      const result = await operation(session.client);
      // A native mutation receipt remains a fact of this captured host after GUI detachment.
      if (this.#session === session && !this.#closed) await this.#refresh(session);
      return result;
    } catch (error) {
      return { ok: false, error: problem(error) };
    }
  }
  async stop(target: LocalHostConsoleTarget): Promise<Result<DesktopLocalHostState>> {
    let session: Session | undefined;
    try {
      session = this.#capture(target);
      session.stopping = true;
      this.#publish({ phase: 'stopping', error: null });
      const result = await session.client.stop();
      if (!result.ok) {
        session.stopping = false;
        if (this.#session === session) this.#publish({ phase: 'failed', error: result.error });
        return result;
      }
      await session.client.close();
      if (this.#session === session) {
        session.off();
        this.#session = null;
        this.#publish({ phase: 'stopped', view: null, error: null });
      }
      return this.getState();
    } catch (error) {
      const fault = problem(error);
      if (session && this.#session === session) {
        session.stopping = false;
        this.#publish({ phase: 'failed', error: fault });
      }
      return { ok: false, error: fault };
    }
  }
  reviewSource(input: Parameters<DesktopLocalHostBridge['reviewSource']>[0]) {
    return this.#operate(input, (client) => client.reviewSource(input));
  }
  confirmSourceTrust(input: Parameters<DesktopLocalHostBridge['confirmSourceTrust']>[0]) {
    return this.#operate(input, (client) => client.confirmSourceTrust(input));
  }
  setSourcePreset(input: Parameters<DesktopLocalHostBridge['setSourcePreset']>[0]) {
    return this.#operate(input, (client) => client.setSourcePreset(input));
  }
  saveSource(input: Parameters<DesktopLocalHostBridge['saveSource']>[0]) {
    return this.#operate(input, (client) => client.saveSource(input));
  }
  setSourceEnabled(input: Parameters<DesktopLocalHostBridge['setSourceEnabled']>[0]) {
    return this.#operate(input, (client) => client.setSourceEnabled(input));
  }
  setAgentEnabled(input: Parameters<DesktopLocalHostBridge['setAgentEnabled']>[0]) {
    return this.#operate(input, (client) => client.setAgentEnabled(input));
  }
  setSourceCredential(input: Parameters<DesktopLocalHostBridge['setSourceCredential']>[0]) {
    const target = {
      hostId: input.hostId,
      bootId: input.bootId,
      purpose: 'qq-source' as const,
      protocol: input.protocol,
      expectedRevision: input.expectedRevision,
      expectedCredentialVersion: input.expectedCredentialVersion,
    };
    return this.#operate(input, (client) =>
      input.value === null
        ? client.clearCredential(target)
        : client.setCredential(target, input.value),
    );
  }
  setAgentCredential(input: Parameters<DesktopLocalHostBridge['setAgentCredential']>[0]) {
    const target = {
      hostId: input.hostId,
      bootId: input.bootId,
      purpose: 'agent-link' as const,
      expectedRevision: input.expectedRevision,
      expectedCredentialVersion: input.expectedCredentialVersion,
    };
    return this.#operate(input, (client) =>
      input.value === null
        ? client.clearCredential(target)
        : client.setCredential(target, input.value),
    );
  }
  linkCurrentAgent(input: DesktopLocalHostAgentHandoff): Promise<Result<LocalHostConsoleMutation>> {
    const target = { hostId: input.hostId, bootId: input.bootId };
    return this.#operate(target, async (client) => {
      let committed: LocalHostConsoleMutation | undefined;
      const result = await this.options.companion.handoffCurrentAgent<LocalHostConsoleMutation>(
        { connectionId: input.connectionId },
        async (agent, signal) => {
          const current = await client.view(target);
          if (!current.ok) return current;
          if (
            current.value.agentLink.revision !== input.expectedRevision ||
            current.value.agentLink.credentialVersion !== input.expectedCredentialVersion
          )
            return failed('conflict');
          if (signal.aborted) return failed('cancelled');
          const transport = { baseUrl: agent.baseUrl, token: agent.token };
          const snapshot = await getSnapshot(transport, signal);
          if (!snapshot.ok) return snapshot;
          if (
            snapshot.value.agent.id !== agent.agentId ||
            snapshot.value.epoch !== agent.agentEpoch
          )
            return failed('stale-owner');
          const selected = await getLocalHostSelection(transport, signal);
          if (!selected.ok) return selected;
          const beforeSave = await client.view(target);
          if (!beforeSave.ok) return beforeSave;
          if (
            this.#capture(input).client !== client ||
            beforeSave.value.agentLink.revision !== input.expectedRevision ||
            beforeSave.value.agentLink.credentialVersion !== input.expectedCredentialVersion ||
            signal.aborted
          )
            return failed('conflict');
          const saved = await client.saveAgentSettings({
            hostId: input.hostId,
            bootId: input.bootId,
            expectedRevision: input.expectedRevision,
            baseUrl: agent.baseUrl,
            agentId: agent.agentId,
            agentEpoch: agent.agentEpoch,
          });
          if (!saved.ok) return saved;
          committed = saved.value;
          if (saved.value.error) return saved;
          const next = saved.value.view.agentLink;
          const previous = current.value.agentLink;
          const unchanged =
            next.revision === input.expectedRevision &&
            previous.target.baseUrl === agent.baseUrl &&
            previous.target.agentId === agent.agentId &&
            previous.target.agentEpoch === agent.agentEpoch &&
            next.credentialVersion === input.expectedCredentialVersion;
          if (
            (!unchanged &&
              (next.revision !== input.expectedRevision + 1 ||
                next.credentialVersion === input.expectedCredentialVersion ||
                next.hasCredential)) ||
            next.target.baseUrl !== agent.baseUrl ||
            next.target.agentId !== agent.agentId ||
            next.target.agentEpoch !== agent.agentEpoch
          )
            return failed('conflict');
          if (signal.aborted) return failed('cancelled');
          const credential = await client.setCredential(
            {
              hostId: input.hostId,
              bootId: input.bootId,
              purpose: 'agent-link',
              expectedRevision: next.revision,
              expectedCredentialVersion: unchanged
                ? input.expectedCredentialVersion
                : next.credentialVersion,
            },
            agent.token,
            signal,
          );
          if (!credential.ok) return credential;
          committed = credential.value;
          if (credential.value.error) return credential;
          const linked = credential.value.view.agentLink;
          const live = await getSnapshot(transport, signal);
          if (!live.ok) return live;
          if (live.value.agent.id !== agent.agentId || live.value.epoch !== agent.agentEpoch)
            return failed('stale-owner');
          const local = await client.view(target);
          if (!local.ok) return local;
          if (
            this.#capture(input).client !== client ||
            local.value.agentLink.revision !== linked.revision ||
            local.value.agentLink.credentialVersion !== linked.credentialVersion ||
            local.value.agentLink.target.baseUrl !== agent.baseUrl ||
            local.value.agentLink.target.agentId !== agent.agentId ||
            local.value.agentLink.target.agentEpoch !== agent.agentEpoch ||
            signal.aborted
          )
            return failed('conflict');
          const alreadySelected =
            selected.value.selection.mode === 'remote-host' &&
            selected.value.selection.hostId === input.hostId;
          // A same-host POST would retire the existing bridge even for a Config no-op.
          const selection = alreadySelected
            ? await getLocalHostSelection(transport, signal)
            : await selectLocalHost(
                transport,
                {
                  expectedRevision: selected.value.revision,
                  selection: { mode: 'remote-host', hostId: input.hostId },
                },
                signal,
              );
          if (!selection.ok) return selection;
          if (
            selection.value.revision !== selected.value.revision + (alreadySelected ? 0 : 1) ||
            selection.value.selection.mode !== 'remote-host' ||
            selection.value.selection.hostId !== input.hostId
          )
            return failed('conflict');
          return selection.value.error ? { ok: false, error: selection.value.error } : credential;
        },
      );
      if (!result.ok && committed)
        return { ok: true, value: { ...committed, error: committed.error ?? result.error } };
      return result;
    });
  }
  async close(): Promise<void> {
    this.#closed = true;
    const session = this.#session;
    this.#session = null;
    session?.off();
    try {
      await session?.client.close();
      await this.#opening;
      await session?.read;
    } finally {
      this.#listeners.clear();
    }
  }
}

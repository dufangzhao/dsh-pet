import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import {
  ControlEndpoint,
  KernelFault,
  MediaFrameDecoder,
  encodeMediaFrame,
  SensitivePeer,
  type SecretRedactor,
  mediaReference,
  type RpcHandler,
  type ControlTransport,
} from '@pet/host-kernel';
import type { MediaFrame } from '@pet/contracts';
import { ManagementSecretSession, type ManagementSecretTicket } from './management-secrets.js';
import {
  makeError,
  type ControlMessage,
  type JsonObject,
  type JsonValue,
  type Result,
  type LocalHostRuntimeIdentity,
} from '@pet/contracts';
import { isLocalHostRendezvous, type LocalHostRendezvous } from './rendezvous.js';
import { jsonPreflight } from '@pet/contracts/validation';
import {
  isLocalHostConsoleView,
  isLocalHostConsoleMutation,
  isLocalHostSourceReview,
  isLocalHostConsoleTarget,
  isLocalHostSourceReviewCommand,
  isLocalHostSourceTrustCommand,
  isLocalHostSourcePresetCommand,
  isLocalHostSourceSettingsCommand,
  isLocalHostSourceEnabledCommand,
  isLocalHostAgentSettingsCommand,
  isLocalHostAgentEnabledCommand,
  isLocalHostSecretTarget,
  type LocalHostConsoleTarget,
  type LocalHostConsoleView,
  type LocalHostConsoleMutation,
  type LocalHostSourceReview,
  type LocalHostSourceReviewCommand,
  type LocalHostSourceTrustCommand,
  type LocalHostSourcePresetCommand,
  type LocalHostSourceSettingsCommand,
  type LocalHostSourceEnabledCommand,
  type LocalHostAgentSettingsCommand,
  type LocalHostAgentEnabledCommand,
  type LocalHostSecretTarget,
} from '@pet/contracts';
import type { LocalPluginKernel } from './kernel.js';

const MAX_FRAME = 64 * 1024;
const OWNER = { pluginId: 'pet.local-host-management', instanceId: 'default', generation: 1 };
const fields = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const nonce = (): string => randomBytes(32).toString('hex');
const proof = (cap: string, values: readonly unknown[]): string =>
  createHmac('sha256', cap).update(JSON.stringify(values)).digest('hex');
const matches = (value: unknown, expected: string): boolean =>
  typeof value === 'string' &&
  /^[a-f0-9]{64}$/.test(value) &&
  timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
const target = (r: LocalHostRendezvous): unknown[] => [
  r.protocolVersion,
  r.packageVersion,
  r.hostId,
  r.bootId,
];

/** One bounded transport for the existing ControlEndpoint, not an HTTP/URL dispatcher. */
class ManagementTransport implements ControlTransport {
  private readonly messages = new Set<(value: unknown) => void>();
  private readonly closing = new Set<() => void>();
  private readonly queued: unknown[] = [];
  private header = Buffer.alloc(4);
  private headerAt = 0;
  private mediaKind = false;
  private mediaReceiver: ((frame: MediaFrame) => Result<null>) | undefined;
  private body: Buffer | null = null;
  private bodyAt = 0;
  private writes = 0;
  private closed = false;
  private readonly pending = new Set<Promise<void>>();
  readonly settled: Promise<void>;
  constructor(private readonly socket: Socket) {
    this.settled = new Promise((resolve) =>
      socket.once('close', () => {
        this.closed = true;
        for (const fn of this.closing) fn();
        resolve();
      }),
    );
    socket.on('error', () => socket.destroy());
    socket.on('data', (bytes) => {
      try {
        let at = 0;
        while (at < bytes.length) {
          if (!this.body) {
            const n = Math.min(4 - this.headerAt, bytes.length - at);
            bytes.copy(this.header, this.headerAt, at, at + n);
            at += n;
            this.headerAt += n;
            if (this.headerAt !== 4) continue;
            const prefix = this.header.readUInt32BE(0);
            this.mediaKind = (prefix & 0x80000000) !== 0;
            const size = prefix & 0x7fffffff;
            if (size < 1 || size > MAX_FRAME) throw new KernelFault('quota-exceeded');
            this.body = Buffer.alloc(size);
            this.bodyAt = 0;
            this.headerAt = 0;
          }
          const n = Math.min(this.body.length - this.bodyAt, bytes.length - at);
          bytes.copy(this.body, this.bodyAt, at, at + n);
          at += n;
          this.bodyAt += n;
          if (this.bodyAt === this.body.length) {
            if (this.mediaKind) {
              const body = this.body;
              this.body = null;
              try {
                if (!this.mediaReceiver) throw new KernelFault('permission-denied');
                const decoder = new MediaFrameDecoder(this.mediaReceiver);
                if (!decoder.feed(body).ok || !decoder.end().ok)
                  throw new KernelFault('permission-denied');
              } finally {
                body.fill(0);
              }
              continue;
            }
            const text = this.body.toString('utf8');
            if (!Buffer.from(text).equals(this.body)) throw new KernelFault('invalid-input');
            const parsed: unknown = JSON.parse(text);
            this.body = null;
            if (this.messages.size) for (const receive of this.messages) receive(parsed);
            else {
              if (this.queued.length >= 16) throw new KernelFault('quota-exceeded');
              this.queued.push(parsed);
            }
          }
        }
      } catch {
        socket.destroy();
      }
    });
  }
  private async writeBytes(bytes: Uint8Array, media: boolean): Promise<void> {
    if (this.closed || this.writes >= 16) throw new KernelFault('unavailable');
    if (!bytes.length || bytes.length > MAX_FRAME) throw new KernelFault('quota-exceeded');
    const frame = Buffer.alloc(4 + bytes.length);
    frame.writeUInt32BE(bytes.length + (media ? 0x80000000 : 0));
    frame.set(bytes, 4);
    this.writes++;
    let settled!: () => void;
    const physical = new Promise<void>((resolve) => {
      settled = resolve;
    });
    this.pending.add(physical);
    try {
      await new Promise<void>((resolve, reject) =>
        this.socket.write(frame, (error) => (error ? reject(error) : resolve())),
      );
    } finally {
      this.writes--;
      this.pending.delete(physical);
      settled();
      frame.fill(0);
    }
  }
  write(value: unknown): Promise<void> {
    return this.writeBytes(Buffer.from(JSON.stringify(value)), false);
  }
  onMedia(receive: (frame: MediaFrame) => Result<null>): void {
    this.mediaReceiver = receive;
  }
  async writeMedia(frame: MediaFrame): Promise<Result<null>> {
    const encoded = encodeMediaFrame(frame);
    if (!encoded.ok) return encoded;
    try {
      await this.writeBytes(encoded.value, true);
      return { ok: true, value: null };
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    } finally {
      encoded.value.fill(0);
    }
  }
  send(message: ControlMessage): Promise<void> {
    return this.write(message);
  }
  onMessage(listener: (value: unknown) => void): () => void {
    this.messages.add(listener);
    for (const message of this.queued.splice(0)) listener(message);
    return () => this.messages.delete(listener);
  }
  onClose(listener: () => void): () => void {
    this.closing.add(listener);
    if (this.closed) listener();
    return () => this.closing.delete(listener);
  }
  /**
   * Joins every write this peer has started. Resolution means the bytes are
   * settled with the socket, not that the peer's application has read them; a
   * peer that already closed cannot deliver more, so it may finish the join.
   */
  async flush(): Promise<void> {
    await Promise.race([Promise.all([...this.pending]), this.settled]);
  }
  close(): void {
    this.socket.destroySoon();
  }
  take(): Promise<unknown> {
    if (this.closed) return Promise.reject(new KernelFault('unavailable'));
    const existing = this.queued.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        close();
        reject(new KernelFault('timeout'));
        this.socket.destroy();
      }, 5000);
      const off = this.onMessage((value) => {
        clearTimeout(timer);
        off();
        close();
        resolve(value);
      });
      const close = this.onClose(() => {
        clearTimeout(timer);
        off();
        close();
        reject(new KernelFault('unavailable'));
      });
    });
  }
}
export interface LocalManagementKernel {
  status(): Promise<JsonObject>;
  close(): Promise<void>;
}
export interface LocalManagementStatus {
  readonly identity: LocalHostRuntimeIdentity;
  readonly phase: 'running' | 'stopping' | 'stopped' | 'failed';
  readonly kernel: JsonObject;
}
export interface LocalManagementConsole {
  readonly runManagement: LocalPluginKernel['runManagement'];
  readonly redactor: SecretRedactor;
  view(): Promise<LocalHostConsoleView>;
  review(input: LocalHostSourceReviewCommand): Promise<LocalHostSourceReview>;
  trust(input: LocalHostSourceTrustCommand): Promise<LocalHostConsoleMutation>;
  preset(input: LocalHostSourcePresetCommand): Promise<LocalHostConsoleMutation>;
  sourceSettings(input: LocalHostSourceSettingsCommand): Promise<LocalHostConsoleMutation>;
  sourceEnabled(input: LocalHostSourceEnabledCommand): Promise<LocalHostConsoleMutation>;
  agentSettings(input: LocalHostAgentSettingsCommand): Promise<LocalHostConsoleMutation>;
  agentEnabled(input: LocalHostAgentEnabledCommand): Promise<LocalHostConsoleMutation>;
  clearCredential(
    input: LocalHostSecretTarget,
    signal: AbortSignal,
  ): Promise<LocalHostConsoleMutation>;
  prepareSecret(
    input: LocalHostSecretTarget,
  ): Promise<(secret: string, signal: AbortSignal) => Promise<LocalHostConsoleMutation>>;
  close?(): Promise<void>;
}
export interface LocalManagementServer {
  drainSecrets(): Promise<void>;
  changed(): void;
  readonly endpoint: LocalHostRendezvous['endpoint'];
  close(): Promise<void>;
}
function consoleHandlers(
  identity: LocalHostRuntimeIdentity,
  backend: LocalManagementConsole,
  secrets: ManagementSecretSession,
  live: () => boolean,
): Record<string, RpcHandler> {
  const json = (value: unknown): JsonValue => {
    const safe = jsonPreflight(value);
    if (!safe.ok) throw new KernelFault('invalid-input');
    return safe.value;
  };
  const fixed =
    <T extends LocalHostConsoleTarget>(
      guard: (value: unknown) => value is T,
      apply: (input: T, signal: AbortSignal) => Promise<unknown>,
    ): RpcHandler =>
    async (context, value) => {
      if (!guard(value)) return { ok: false, error: makeError('invalid-input', false) };
      if (!live()) return { ok: false, error: makeError('not-ready', false) };
      if (value.hostId !== identity.hostId || value.bootId !== identity.bootId)
        return { ok: false, error: makeError('stale-owner', false) };
      try {
        return { ok: true, value: json(await apply(value, context.signal)) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof KernelFault ? error.error : makeError('unavailable', false),
        };
      }
    };
  return {
    'local-host.view': fixed(isLocalHostConsoleTarget, () => backend.view()),
    'local-host.review': fixed(isLocalHostSourceReviewCommand, (input) => backend.review(input)),
    'local-host.trust': fixed(isLocalHostSourceTrustCommand, (input) => backend.trust(input)),
    'local-host.preset': fixed(isLocalHostSourcePresetCommand, (input) => backend.preset(input)),
    'local-host.source-settings': fixed(isLocalHostSourceSettingsCommand, (input) =>
      backend.sourceSettings(input),
    ),
    'local-host.source-enabled': fixed(isLocalHostSourceEnabledCommand, (input) =>
      backend.sourceEnabled(input),
    ),
    'local-host.agent-settings': fixed(isLocalHostAgentSettingsCommand, (input) =>
      backend.agentSettings(input),
    ),
    'local-host.agent-enabled': fixed(isLocalHostAgentEnabledCommand, (input) =>
      backend.agentEnabled(input),
    ),
    'local-host.credential-clear': fixed(isLocalHostSecretTarget, (input, signal) =>
      backend.clearCredential(input, signal),
    ),
    'local-host.secret-prepare': fixed(isLocalHostSecretTarget, async (input) => {
      const apply = await backend.prepareSecret(input);
      const prepared = await secrets.prepare(async (secret, signal) =>
        json(await apply(secret, signal)),
      );
      if (!prepared.ok) throw new KernelFault(prepared.error.code);
      return prepared.value;
    }),
    'local-host.secret-cancel': async (_context, value) => {
      const v = fields(value);
      if (!v || !exact(v, ['hostId', 'bootId', 'streamId']) || typeof v['streamId'] !== 'string')
        return { ok: false, error: makeError('invalid-input', false) };
      if (v['hostId'] !== identity.hostId || v['bootId'] !== identity.bootId)
        return { ok: false, error: makeError('stale-owner', false) };
      return secrets.cancel(v['streamId']);
    },
    'local-host.secret-finish': async (_context, value) => {
      const v = fields(value);
      if (!v || !exact(v, ['hostId', 'bootId', 'streamId']) || typeof v['streamId'] !== 'string')
        return { ok: false, error: makeError('invalid-input', false) };
      if (v['hostId'] !== identity.hostId || v['bootId'] !== identity.bootId)
        return { ok: false, error: makeError('stale-owner', false) };
      return secrets.finish(v['streamId']);
    },
  };
}
export async function startLocalManagement(options: {
  readonly identity: LocalManagementStatus['identity'];
  readonly capability: string;
  readonly kernel: LocalManagementKernel;
  readonly console?: LocalManagementConsole;
  onStopped(): void | Promise<void>;
}): Promise<LocalManagementServer> {
  const peers = new Set<ManagementTransport>(),
    handshakes = new Set<Promise<void>>();
  const consolePeers = new Set<ControlEndpoint>(),
    secretSessions = new Set<ManagementSecretSession>(),
    secretDrains = new Set<Promise<void>>();
  let closed = false,
    phase: LocalManagementStatus['phase'] = 'running';
  let stopping: Promise<void> | undefined;
  const drainSecrets = async (): Promise<void> => {
    await Promise.all([...secretSessions].map((session) => session.close()));
    await Promise.all([...secretDrains]);
  };
  const identity = { ...options.identity };
  const getStatus = async (): Promise<JsonObject> => ({
    identity,
    phase,
    kernel: await options.kernel.status(),
  });
  const server = createServer((socket) => {
    if (closed || peers.size >= 16) {
      socket.destroy();
      return;
    }
    const transport = new ManagementTransport(socket);
    peers.add(transport);
    void transport.settled.then(() => peers.delete(transport));
    const work = (async () => {
      const serverNonce = nonce();
      await transport.write({ type: 'challenge', identity, nonce: serverNonce });
      const auth = fields(await transport.take());
      const parts = [
        identity.protocolVersion,
        identity.packageVersion,
        identity.hostId,
        identity.bootId,
      ];
      if (
        !auth ||
        !exact(auth, ['type', 'nonce', 'proof']) ||
        auth['type'] !== 'authenticate' ||
        typeof auth['nonce'] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(auth['nonce']) ||
        !matches(
          auth['proof'],
          proof(options.capability, ['client', ...parts, serverNonce, auth['nonce']]),
        )
      )
        throw new KernelFault('permission-denied');
      const sessionId = randomUUID();
      await transport.write({
        type: 'authenticated',
        sessionId,
        proof: proof(options.capability, [
          'server',
          ...parts,
          serverNonce,
          auth['nonce'],
          sessionId,
        ]),
      });
      const secrets = options.console
        ? new ManagementSecretSession({
            runManagement: options.console.runManagement,
            redactor: options.console.redactor,
            write: (frame) => transport.writeMedia(frame),
          })
        : undefined;
      if (secrets) {
        secretSessions.add(secrets);
        transport.onMedia((frame) => secrets.receive(frame));
        transport.onClose(() => {
          const drain = secrets.close().finally(() => {
            secretSessions.delete(secrets);
            secretDrains.delete(drain);
          });
          secretDrains.add(drain);
        });
      }
      const rpc = new ControlEndpoint(transport, {
        owner: OWNER,
        sessionId,
        live: () => !closed,
        maxPending: 8,
        allowJson: (value) =>
          !JSON.stringify(value).includes(options.capability) &&
          !options.console?.redactor.containsValue(value),
        workCompletionMethods: [
          'local-host.stop',
          'local-host.secret-finish',
          'local-host.credential-clear',
        ],
        handlers: {
          ...(options.console && secrets
            ? consoleHandlers(identity, options.console, secrets, () => phase === 'running')
            : {}),
          'local-host.status': async (_context, body) =>
            body === null
              ? { ok: true, value: await getStatus() }
              : { ok: false, error: makeError('invalid-input', false) },
          'local-host.stop': async (_context, body) => {
            if (body !== null) return { ok: false, error: makeError('invalid-input', false) };
            stopping ??= (async () => {
              phase = 'stopping';
              try {
                await drainSecrets();
                await options.kernel.close();
                phase = 'stopped';
              } catch {
                phase = 'failed';
                throw new KernelFault('unavailable');
              }
            })();
            try {
              await stopping;
            } catch {
              return { ok: false, error: makeError('unavailable', false) };
            }
            const result = await getStatus();
            /*
             * onStopped destroys this peer and exits the process. The stop reply is
             * written by ControlEndpoint after this handler returns, so wait one
             * macrotask for it to enter the transport, then for its bytes to reach
             * the socket. Otherwise the close can discard the reply and the caller
             * reports `unavailable` for a cleanup that actually succeeded.
             */
            setImmediate(() => {
              void transport
                .flush()
                .then(() => options.onStopped())
                .catch(() => {
                  phase = 'failed';
                });
            });
            return { ok: true, value: result };
          },
        },
      });
      consolePeers.add(rpc);
      transport.onClose(() => consolePeers.delete(rpc));
    })()
      .catch(() => transport.close())
      .finally(() => handshakes.delete(work));
    handshakes.add(work);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new KernelFault('unavailable');
  return {
    drainSecrets,
    changed: () => {
      // A stopping host cannot serve a view read; hinting only adds writes that can
      // crowd out the stop reply on the same peer.
      if (phase !== 'running') return;
      for (const rpc of consolePeers)
        void rpc.request('local-host.changed', null, { budgetMs: 5000 });
    },
    endpoint: { host: '127.0.0.1', port: address.port },
    close: async () => {
      closed = true;
      for (const peer of peers) peer.close();
      await Promise.all([...peers].map((peer) => peer.settled));
      await Promise.allSettled([...handshakes]);
      await Promise.all([...secretSessions].map((session) => session.close()));
      await Promise.all([...secretDrains]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
export interface LocalManagementClient {
  readonly identity: LocalHostRuntimeIdentity;
  readonly signal: AbortSignal;
  onChanged(listener: () => void): () => void;
  view(input: LocalHostConsoleTarget): Promise<Result<LocalHostConsoleView>>;
  reviewSource(input: LocalHostSourceReviewCommand): Promise<Result<LocalHostSourceReview>>;
  confirmSourceTrust(input: LocalHostSourceTrustCommand): Promise<Result<LocalHostConsoleMutation>>;
  setSourcePreset(input: LocalHostSourcePresetCommand): Promise<Result<LocalHostConsoleMutation>>;
  saveSource(input: LocalHostSourceSettingsCommand): Promise<Result<LocalHostConsoleMutation>>;
  setSourceEnabled(input: LocalHostSourceEnabledCommand): Promise<Result<LocalHostConsoleMutation>>;
  saveAgentSettings(
    input: LocalHostAgentSettingsCommand,
  ): Promise<Result<LocalHostConsoleMutation>>;
  setAgentEnabled(input: LocalHostAgentEnabledCommand): Promise<Result<LocalHostConsoleMutation>>;
  clearCredential(input: LocalHostSecretTarget): Promise<Result<LocalHostConsoleMutation>>;
  setCredential(
    input: LocalHostSecretTarget,
    secret: string,
    signal?: AbortSignal,
  ): Promise<Result<LocalHostConsoleMutation>>;
  status(): Promise<Result<JsonValue>>;
  stop(): Promise<Result<JsonValue>>;
  close(): Promise<void>;
}
export async function attachLocalManagement(
  input: LocalHostRendezvous,
): Promise<LocalManagementClient> {
  if (!isLocalHostRendezvous(input)) throw new KernelFault('invalid-input');
  const captured = Object.freeze({ ...input, endpoint: Object.freeze({ ...input.endpoint }) });
  const socket = createConnection(captured.endpoint);
  const transport = new ManagementTransport(socket);
  try {
    const challenge = fields(await transport.take()),
      identity = challenge && fields(challenge['identity']);
    if (
      !challenge ||
      !exact(challenge, ['type', 'identity', 'nonce']) ||
      challenge['type'] !== 'challenge' ||
      !identity ||
      !exact(identity, ['protocolVersion', 'hostId', 'bootId', 'packageVersion']) ||
      JSON.stringify([
        identity['protocolVersion'],
        identity['packageVersion'],
        identity['hostId'],
        identity['bootId'],
      ]) !== JSON.stringify(target(captured)) ||
      typeof challenge['nonce'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(challenge['nonce'])
    )
      throw new KernelFault('stale-owner');
    const clientNonce = nonce();
    await transport.write({
      type: 'authenticate',
      nonce: clientNonce,
      proof: proof(captured.managementCapability, [
        'client',
        ...target(captured),
        challenge['nonce'],
        clientNonce,
      ]),
    });
    const welcome = fields(await transport.take());
    if (
      !welcome ||
      !exact(welcome, ['type', 'sessionId', 'proof']) ||
      welcome['type'] !== 'authenticated' ||
      typeof welcome['sessionId'] !== 'string' ||
      !matches(
        welcome['proof'],
        proof(captured.managementCapability, [
          'server',
          ...target(captured),
          challenge['nonce'],
          clientNonce,
          welcome['sessionId'],
        ]),
      )
    )
      throw new KernelFault('permission-denied');
    const lifetime = new AbortController();
    const clientIdentity = Object.freeze({
      protocolVersion: captured.protocolVersion,
      packageVersion: captured.packageVersion,
      hostId: captured.hostId,
      bootId: captured.bootId,
    });
    const listeners = new Set<() => void>();
    const notify = () => {
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* Observer failure cannot change the native request. */
        }
      }
    };
    const sensitive = new SensitivePeer({ write: (frame) => transport.writeMedia(frame) });
    transport.onMedia((frame) => sensitive.receive(frame));
    const rpc = new ControlEndpoint(transport, {
      owner: OWNER,
      sessionId: welcome['sessionId'],
      live: () => !lifetime.signal.aborted,
      maxPending: 8,
      onClosed: () => {
        if (!lifetime.signal.aborted) {
          lifetime.abort();
          sensitive.close();
          notify();
        }
      },
      handlers: {
        'local-host.changed': async (_context, value) => {
          if (value !== null) return { ok: false, error: makeError('invalid-input', false) };
          notify();
          return { ok: true, value: null };
        },
      },
    });
    transport.onClose(() => {
      if (!lifetime.signal.aborted) {
        lifetime.abort();
        sensitive.close();
        notify();
      }
    });
    const call = async <T>(
      method: string,
      input: unknown,
      inputGuard: (v: unknown) => boolean,
      outputGuard: (v: unknown) => v is T,
      wait = false,
    ): Promise<Result<T>> => {
      if (!inputGuard(input)) return { ok: false, error: makeError('invalid-input', false) };
      const body = jsonPreflight(input);
      if (!body.ok) return { ok: false, error: makeError('invalid-input', false) };
      const result = await rpc.request(method, body.value, { waitForWork: wait, budgetMs: 60000 });
      return result.ok
        ? outputGuard(result.value)
          ? { ok: true, value: result.value }
          : { ok: false, error: makeError('invalid-input', false) }
        : result;
    };
    const ticketGuard = (value: unknown): value is ManagementSecretTicket => {
      const v = fields(value);
      return !!v && exact(v, ['reference']) && !!mediaReference(v['reference']);
    };
    return {
      identity: clientIdentity,
      signal: lifetime.signal,
      onChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      view: (input) =>
        call('local-host.view', input, isLocalHostConsoleTarget, isLocalHostConsoleView),
      reviewSource: (input) =>
        call('local-host.review', input, isLocalHostSourceReviewCommand, isLocalHostSourceReview),
      confirmSourceTrust: (input) =>
        call('local-host.trust', input, isLocalHostSourceTrustCommand, isLocalHostConsoleMutation),
      setSourcePreset: (input) =>
        call(
          'local-host.preset',
          input,
          isLocalHostSourcePresetCommand,
          isLocalHostConsoleMutation,
        ),
      saveSource: (input) =>
        call(
          'local-host.source-settings',
          input,
          isLocalHostSourceSettingsCommand,
          isLocalHostConsoleMutation,
        ),
      setSourceEnabled: (input) =>
        call(
          'local-host.source-enabled',
          input,
          isLocalHostSourceEnabledCommand,
          isLocalHostConsoleMutation,
        ),
      saveAgentSettings: (input) =>
        call(
          'local-host.agent-settings',
          input,
          isLocalHostAgentSettingsCommand,
          isLocalHostConsoleMutation,
        ),
      setAgentEnabled: (input) =>
        call(
          'local-host.agent-enabled',
          input,
          isLocalHostAgentEnabledCommand,
          isLocalHostConsoleMutation,
        ),
      clearCredential: (input) =>
        call(
          'local-host.credential-clear',
          input,
          isLocalHostSecretTarget,
          isLocalHostConsoleMutation,
          true,
        ),
      setCredential: async (input, secret, signal) => {
        if (signal?.aborted) return { ok: false, error: makeError('cancelled', false) };
        const prepared = await call(
          'local-host.secret-prepare',
          input,
          isLocalHostSecretTarget,
          ticketGuard,
        );
        if (!prepared.ok) return prepared;
        const reference = prepared.value.reference;
        const sent = await sensitive.send(
          reference,
          secret,
          signal ?? new AbortController().signal,
        );
        const finish = { hostId: input.hostId, bootId: input.bootId, streamId: reference.streamId };
        if (!sent.ok) {
          const body = jsonPreflight(finish);
          if (body.ok) await rpc.request('local-host.secret-cancel', body.value);
        }
        return call(
          'local-host.secret-finish',
          finish,
          () => true,
          isLocalHostConsoleMutation,
          true,
        );
      },
      status: () => rpc.request('local-host.status', null),
      stop: () => rpc.request('local-host.stop', null, { waitForWork: true, budgetMs: 60000 }),
      close: async () => {
        sensitive.close();
        rpc.close();
        await sensitive.drain();
        await transport.settled;
        listeners.clear();
      },
    };
  } catch (error) {
    transport.close();
    await transport.settled;
    throw error;
  }
}

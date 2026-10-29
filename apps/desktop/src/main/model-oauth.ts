import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import {
  type CredentialBroker,
  CredentialError,
  FileConfigStore,
  KernelFault,
  type StoredConfig,
} from '@pet/host-kernel';
const OWNER = { pluginId: 'pet.llm-provider', instanceId: 'default' };
const CLIENT = { pluginId: 'host.model-oauth', instanceId: 'default' };
const KEY = 'chatgpt-api-key';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN = 'chatgpt.tokens.use.direct';
export interface ModelSignInState {
  readonly phase: 'idle' | 'waiting' | 'done' | 'failed';
  readonly signedIn: boolean;
  readonly reason: string | null;
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}
interface Flow {
  readonly server: Server;
  readonly nonce: string;
  readonly verifier: string;
  readonly state: string;
  readonly redirect: string;
  readonly abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  used: boolean;
}
const random = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new KernelFault('auth-failed');
  return value as Record<string, unknown>;
};
function tokenFields(value: Record<string, unknown>, previous?: Tokens): Tokens {
  const access = value['access_token'],
    refresh = value['refresh_token'] ?? previous?.refreshToken,
    expires = value['expires_in'];
  const scope = typeof value['scope'] === 'string' ? value['scope'] : previous?.scope;
  if (
    typeof access !== 'string' ||
    !access ||
    typeof refresh !== 'string' ||
    !refresh ||
    typeof expires !== 'number' ||
    !Number.isFinite(expires) ||
    expires <= 0 ||
    typeof value['token_type'] !== 'string' ||
    value['token_type'].toLowerCase() !== 'bearer' ||
    typeof scope !== 'string' ||
    !scope.split(/\s+/).includes(PLAN)
  )
    throw new KernelFault('auth-failed');
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + expires * 1000,
    scope,
  };
}
export class ModelOAuth {
  #flow: Flow | null = null;
  #phase: ModelSignInState['phase'] = 'idle';
  #reason: string | null = null;
  #remove: () => void;
  private constructor(
    private readonly broker: CredentialBroker,
    private readonly store: FileConfigStore,
    private registration: StoredConfig,
    private readonly changed: () => void,
    private readonly open: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.#remove = broker.registerManagedSecret(OWNER, KEY, async (stored, signal) => {
      const tokens = record(JSON.parse(stored)) as unknown as Tokens;
      if (
        typeof tokens.accessToken !== 'string' ||
        typeof tokens.refreshToken !== 'string' ||
        typeof tokens.expiresAt !== 'number' ||
        typeof tokens.scope !== 'string'
      )
        throw new CredentialError('not-ready');
      if (tokens.expiresAt - Date.now() > 300000)
        return { value: tokens.accessToken, sensitiveValues: [tokens.refreshToken] };
      const client = this.registration.data['clientId'];
      if (typeof client !== 'string') throw new CredentialError('not-ready');
      let next: Tokens;
      try {
        const reply = await this.token(
          {
            grant_type: 'refresh_token',
            client_id: client,
            refresh_token: tokens.refreshToken,
            resource: RESOURCE,
          },
          signal,
        );
        next = tokenFields(reply, tokens);
      } catch (error) {
        if (error instanceof KernelFault && error.error.code === 'auth-failed') {
          this.#phase = 'failed';
          this.#reason = '登录已失效，请重新登录';
          this.changed();
          return { revoked: true as const };
        }
        throw error;
      }
      return {
        value: next.accessToken,
        stored: JSON.stringify(next),
        sensitiveValues: [next.refreshToken],
      };
    });
  }
  static async create(
    broker: CredentialBroker,
    directory: string,
    changed: () => void,
    open: (url: string) => Promise<void>,
    fetchImpl: typeof fetch = fetch,
  ): Promise<ModelOAuth> {
    const store = new FileConfigStore(path.join(directory, 'host-settings'));
    let registration = await store.read(CLIENT);
    if (!registration) {
      registration = {
        ...CLIENT,
        format: 1,
        schemaVersion: 1,
        revision: 1,
        data: { hostId: 'urn:uuid:' + randomUUID(), clientId: null, subject: null },
      };
      if (!(await store.compareAndSet(CLIENT, null, registration)))
        throw new KernelFault('conflict');
    }
    if (
      typeof registration.data['hostId'] !== 'string' ||
      (registration.data['clientId'] !== null && typeof registration.data['clientId'] !== 'string')
    )
      throw new KernelFault('not-ready');
    return new ModelOAuth(broker, store, registration, changed, open, fetchImpl);
  }
  async state(): Promise<ModelSignInState> {
    return {
      phase: this.#phase,
      signedIn: await this.broker.hasSecret(OWNER, KEY),
      reason: this.#reason,
    };
  }
  private async persist(patch: StoredConfig['data']): Promise<void> {
    const next = {
      ...this.registration,
      revision: this.registration.revision + 1,
      data: { ...this.registration.data, ...patch },
    };
    if (!(await this.store.compareAndSet(CLIENT, this.registration.revision, next)))
      throw new KernelFault('conflict');
    this.registration = next;
  }
  private async token(
    form: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(ISSUER + '/api/accounts/oauth/token', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    const body = record(await response.json());
    const remoteError = body['error'];
    const code =
      typeof remoteError === 'string'
        ? remoteError
        : remoteError && typeof remoteError === 'object'
          ? (remoteError as Record<string, unknown>)['code']
          : undefined;
    if (
      !response.ok &&
      typeof code === 'string' &&
      [
        'invalid_grant',
        'invalid_refresh_token',
        'token_expired',
        'refresh_token_expired',
        'refresh_token_invalidated',
        'refresh_token_reused',
      ].includes(code)
    )
      throw new KernelFault('auth-failed');
    if (!response.ok)
      throw new KernelFault(
        response.status === 401 || response.status === 403 ? 'auth-failed' : 'network',
      );
    return body;
  }
  private async identity(
    token: string,
    clientId: string,
    nonce: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (token.length > 65536) throw new KernelFault('auth-failed');
    const parts = token.split('.');
    if (parts.length !== 3) throw new KernelFault('auth-failed');
    const [head, body, signature] = parts as [string, string, string];
    const header = record(JSON.parse(Buffer.from(head, 'base64url').toString()));
    const claims = record(JSON.parse(Buffer.from(body, 'base64url').toString()));
    if (header['alg'] !== 'RS256') throw new KernelFault('auth-failed');
    const discovery = await this.fetchImpl(ISSUER + '/.well-known/openid-configuration', {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!discovery.ok) throw new KernelFault('network');
    const metadata = record(await discovery.json());
    const uri = metadata['jwks_uri'];
    if (metadata['issuer'] !== ISSUER || typeof uri !== 'string' || new URL(uri).origin !== ISSUER)
      throw new KernelFault('auth-failed');
    const response = await this.fetchImpl(uri, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw new KernelFault('network');
    const jwks = record(await response.json())['keys'];
    if (!Array.isArray(jwks)) throw new KernelFault('auth-failed');
    const keys = jwks.map(record);
    const key =
      header['kid'] === undefined
        ? keys.length === 1
          ? keys[0]
          : undefined
        : keys.find((k) => k['kid'] === header['kid']);
    if (
      !key ||
      !verify(
        'RSA-SHA256',
        Buffer.from(head + '.' + body),
        createPublicKey({ key: key as JsonWebKey, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      )
    )
      throw new KernelFault('auth-failed');
    const audiences = Array.isArray(claims['aud']) ? claims['aud'] : [claims['aud']];
    if (
      claims['iss'] !== ISSUER ||
      !audiences.includes(clientId) ||
      typeof claims['exp'] !== 'number' ||
      claims['exp'] * 1000 < Date.now() - 60000 ||
      (typeof claims['iat'] === 'number' && claims['iat'] * 1000 > Date.now() + 60000) ||
      (typeof claims['nbf'] === 'number' && claims['nbf'] * 1000 > Date.now() + 60000) ||
      typeof claims['nonce'] !== 'string' ||
      !equal(claims['nonce'], nonce) ||
      typeof claims['sub'] !== 'string' ||
      !claims['sub']
    )
      throw new KernelFault('auth-failed');
    return claims['sub'];
  }
  async start(): Promise<ModelSignInState> {
    this.cancel();
    this.#phase = 'waiting';
    this.#reason = null;
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new KernelFault('unavailable');
    const flow: Flow = {
      server,
      nonce: random(),
      verifier: random(),
      state: random(),
      redirect: 'http://127.0.0.1:' + address.port + '/auth/callback',
      abort: new AbortController(),
      timer: null,
      used: false,
    };
    this.#flow = flow;
    flow.timer = setTimeout(() => this.finish(flow, '浏览器登录已超时，请重试'), 600000);
    flow.timer.unref();
    server.on('request', (request, response) => {
      let url: URL;
      try {
        url = new URL(request.url ?? '/', flow.redirect);
      } catch {
        response.writeHead(400).end();
        return;
      }
      const states = url.searchParams.getAll('state');
      if (
        request.method !== 'GET' ||
        request.headers.host !== '127.0.0.1:' + address.port ||
        url.pathname !== '/auth/callback'
      ) {
        response.writeHead(404).end();
        return;
      }
      if (
        this.#flow !== flow ||
        flow.used ||
        states.length !== 1 ||
        !equal(states[0]!, flow.state)
      ) {
        response.writeHead(400).end();
        return;
      }
      flow.used = true;
      if (flow.timer) clearTimeout(flow.timer);
      response
        .writeHead(200, {
          'content-type': 'text/html;charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'",
        })
        .end('<p>登录结果正在交给桌宠。你可以关闭此页面。</p>');
      void this.complete(flow, url.searchParams).then(
        () => this.finish(flow, null),
        (error) =>
          this.finish(
            flow,
            error instanceof KernelFault && error.error.code === 'network'
              ? '暂时无法连接登录服务，请重试'
              : '登录身份或套餐授权未通过，请重新登录',
          ),
      );
    });
    const clientId = this.registration.data['clientId'];
    const query = new URLSearchParams({
      client_id: typeof clientId === 'string' ? clientId : 'dynamic_agent_client',
      response_type: 'code',
      redirect_uri: flow.redirect,
      scope: SCOPE,
      resource: RESOURCE,
      state: flow.state,
      nonce: flow.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      ext_agent_host_id: this.registration.data['hostId'] as string,
    });
    if (!clientId) query.set('agent_name_hint', 'AI Pet');
    try {
      await this.open(ISSUER + '/api/accounts/authorize?' + query);
    } catch (error) {
      this.finish(flow, '无法打开系统浏览器');
      throw error;
    }
    this.changed();
    return this.state();
  }
  private async complete(flow: Flow, params: URLSearchParams): Promise<void> {
    if (params.has('error')) throw new KernelFault('auth-failed');
    const code = params.get('code'),
      ids = params.getAll('client_id');
    const known = this.registration.data['clientId'];
    const clientId = ids[0] ?? known;
    if (
      !code ||
      params.getAll('code').length !== 1 ||
      ids.length > 1 ||
      typeof clientId !== 'string' ||
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      (typeof known === 'string' && ids.length && clientId !== known)
    )
      throw new KernelFault('auth-failed');
    if (clientId !== known) await this.persist({ clientId });
    const reply = await this.token(
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: flow.verifier,
        redirect_uri: flow.redirect,
        resource: RESOURCE,
      },
      flow.abort.signal,
    );
    const tokens = tokenFields(reply);
    if (typeof reply['id_token'] !== 'string') throw new KernelFault('auth-failed');
    const subject = await this.identity(reply['id_token'], clientId, flow.nonce, flow.abort.signal);
    const existing = this.registration.data['subject'];
    if (typeof existing === 'string' && existing !== subject) throw new KernelFault('auth-failed');
    if (this.#flow !== flow || flow.abort.signal.aborted) throw new KernelFault('cancelled');
    this.broker.redactor.add(tokens.accessToken);
    this.broker.redactor.add(tokens.refreshToken);
    await this.broker.setSecret(OWNER, KEY, JSON.stringify(tokens), flow.abort.signal);
    if (this.#flow !== flow || flow.abort.signal.aborted) throw new KernelFault('cancelled');
    await this.persist({ subject });
  }
  private finish(flow: Flow, reason: string | null): void {
    if (this.#flow !== flow) return;
    this.cancel();
    this.#phase = reason ? 'failed' : 'done';
    this.#reason = reason;
    this.changed();
  }
  cancel(): void {
    const flow = this.#flow;
    if (!flow) return;
    this.#flow = null;
    flow.abort.abort();
    if (flow.timer) clearTimeout(flow.timer);
    flow.server.close();
    flow.server.closeAllConnections();
    if (this.#phase === 'waiting') this.#phase = 'idle';
  }
  close(): void {
    this.cancel();
    this.#remove();
  }
}

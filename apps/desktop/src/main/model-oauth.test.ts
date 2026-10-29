import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CredentialBroker, MemoryCiphertextStore, type SecretCipher } from '@pet/host-kernel';
import { ModelOAuth } from './model-oauth.js';
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(
  mode: 'ok' | 'bad-nonce' | 'missing-plan' | 'refresh-refused' | 'refresh-scope-loss' = 'ok',
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-oauth-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'host-settings'));
  const plaintexts = new Map<number, string>();
  let counter = 0;
  const cipher: SecretCipher = {
    encrypt: async (value) => {
      const id = ++counter;
      plaintexts.set(id, value);
      return Uint8Array.of(id);
    },
    decrypt: async (bytes) => ({ plaintext: plaintexts.get(bytes[0]!)!, shouldReEncrypt: false }),
  };
  const broker = new CredentialBroker({
    cipher,
    store: new MemoryCiphertextStore(),
    authorize: async () => ({ isValid: () => true, close() {} }),
  });
  cleanup.push(() => broker.dispose());
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let authorization: URL | undefined;
  let refreshes = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        jwks_uri: 'https://auth.openai.com/fixture-jwks',
      });
    if (url.endsWith('/fixture-jwks'))
      return Response.json({
        keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-key' }],
      });
    expect(url).toBe('https://auth.openai.com/api/accounts/oauth/token');
    expect(init?.redirect).toBe('error');
    const form = new URLSearchParams(String(init?.body));
    if (form.get('grant_type') === 'refresh_token') {
      if (mode === 'refresh-scope-loss')
        return Response.json({
          access_token: 'downgraded-access',
          refresh_token: 'downgraded-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile',
        });
      if (mode === 'refresh-refused')
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      refreshes++;
      expect(form.get('refresh_token')).toBe('fixture-refresh');
      return Response.json({
        access_token: 'fixture-renewed-access',
        refresh_token: 'fixture-renewed-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    expect(form.get('client_id')).toBe('fixture-client');
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(
      authorization!.searchParams.get('code_challenge'),
    );
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://auth.openai.com',
        aud: 'fixture-client',
        sub: 'fixture-user',
        nonce: mode === 'bad-nonce' ? 'wrong' : authorization!.searchParams.get('nonce'),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const content = head + '.' + payload;
    const jwt =
      content +
      '.' +
      sign('RSA-SHA256', Buffer.from(content), keys.privateKey).toString('base64url');
    return Response.json({
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      id_token: jwt,
      token_type: 'Bearer',
      expires_in: 1,
      scope: mode === 'missing-plan' ? 'openid profile' : 'openid chatgpt.tokens.use.direct',
    });
  };
  const auth = await ModelOAuth.create(
    broker,
    directory,
    () => {},
    async (url) => {
      authorization = new URL(url);
    },
    fetchImpl,
  );
  cleanup.push(() => auth.close());
  return {
    auth,
    broker,
    cipher,
    directory,
    authorization: () => authorization!,
    refreshes: () => refreshes,
  };
}
it('completes a real loopback PKCE callback, verifies identity and rotates encrypted credentials before borrowing', async () => {
  const f = await fixture();
  expect((await f.auth.start()).phase).toBe('waiting');
  const url = f.authorization();
  expect(url.origin).toBe('https://auth.openai.com');
  expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
  const callback = new URL(url.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', 'wrong');
  callback.searchParams.set('code', 'fixture-code');
  callback.searchParams.set('client_id', 'fixture-client');
  expect((await fetch(callback)).status).toBe(400);
  expect((await f.auth.state()).phase).toBe('waiting');
  callback.searchParams.set('state', url.searchParams.get('state')!);
  expect((await fetch(callback)).status).toBe(200);
  await expect.poll(async () => (await f.auth.state()).phase).toBe('done');
  expect((await f.auth.state()).signedIn).toBe(true);
  const owner = { pluginId: 'pet.llm-provider', instanceId: 'default', generation: 1 };
  const client = f.broker.issueClient(owner, ['chatgpt-api-key']);
  expect(
    await client.withSecret(
      'chatgpt-api-key',
      { taskId: 'fixture-task', signal: new AbortController().signal },
      async (token) => token,
    ),
  ).toBe('fixture-renewed-access');
  expect(f.refreshes()).toBe(1);
  for (const name of await readdir(path.join(f.directory, 'host-settings'))) {
    const disk = await readFile(path.join(f.directory, 'host-settings', name), 'utf8');
    expect(disk).not.toContain('fixture-access');
    expect(disk).not.toContain('fixture-refresh');
  }
  f.auth.close();
  const reopened = await ModelOAuth.create(
    f.broker,
    f.directory,
    () => {},
    async () => {},
    async () => {
      throw new Error('Renewal should use stored current tokens');
    },
  );
  cleanup.push(() => reopened.close());
  expect(
    await client.withSecret(
      'chatgpt-api-key',
      { taskId: 'fixture-task-2', signal: new AbortController().signal },
      async (token) => token,
    ),
  ).toBe('fixture-renewed-access');
});
it.each(['bad-nonce', 'missing-plan'] as const)(
  'does not persist credentials for %s',
  async (mode) => {
    const f = await fixture(mode);
    await f.auth.start();
    const url = f.authorization();
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('client_id', 'fixture-client');
    await fetch(callback);
    await expect.poll(async () => (await f.auth.state()).phase).toBe('failed');
    expect((await f.auth.state()).signedIn).toBe(false);
    expect(
      await f.broker.hasSecret(
        { pluginId: 'pet.llm-provider', instanceId: 'default' },
        'chatgpt-api-key',
      ),
    ).toBe(false);
  },
);
it('cancels the owned callback without storing credentials', async () => {
  const f = await fixture();
  await f.auth.start();
  f.auth.cancel();
  expect(await f.auth.state()).toEqual({ phase: 'idle', signedIn: false, reason: null });
});
it.each(['refresh-refused', 'refresh-scope-loss'] as const)(
  'removes permanently refused or downgraded login tokens (%s)',
  async (mode) => {
    const f = await fixture(mode);
    await f.auth.start();
    const url = f.authorization();
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('client_id', 'fixture-client');
    await fetch(callback);
    await expect.poll(async () => (await f.auth.state()).phase).toBe('done');
    const client = f.broker.issueClient(
      { pluginId: 'pet.llm-provider', instanceId: 'default', generation: 1 },
      ['chatgpt-api-key'],
    );
    await expect(
      client.withSecret(
        'chatgpt-api-key',
        { taskId: 'expired-fixture', signal: new AbortController().signal },
        async (token) => token,
      ),
    ).rejects.toMatchObject({ code: 'not-ready' });
    expect(await f.auth.state()).toMatchObject({
      phase: 'failed',
      signedIn: false,
      reason: '登录已失效，请重新登录',
    });
  },
);
it('does not commit an old login when it is cancelled while encryption is queued', async () => {
  const f = await fixture();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });
  cleanup.push(() => release());
  const original = f.cipher.encrypt;
  vi.spyOn(f.cipher, 'encrypt').mockImplementation(async (value) => {
    started();
    await gate;
    return original(value);
  });
  await f.auth.start();
  const url = f.authorization();
  const callback = new URL(url.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', url.searchParams.get('state')!);
  callback.searchParams.set('code', 'fixture-code');
  callback.searchParams.set('client_id', 'fixture-client');
  await fetch(callback);
  await entered;
  f.auth.cancel();
  release();
  expect(
    await f.broker.hasSecret(
      { pluginId: 'pet.llm-provider', instanceId: 'default' },
      'chatgpt-api-key',
    ),
  ).toBe(false);
  expect(await f.auth.state()).toMatchObject({ phase: 'idle', signedIn: false });
  const file = (await readdir(path.join(f.directory, 'host-settings')))[0]!;
  const registration = JSON.parse(
    await readFile(path.join(f.directory, 'host-settings', file), 'utf8'),
  );
  expect(registration.data.subject).toBeNull();
});

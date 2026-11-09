import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  JSON_MAX_BYTES,
  type CompanionModelCommandResult,
  type CompanionModelView,
  type CompanionSnapshot,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import {
  createFixtureModelClient,
  FIXTURE_MODEL_CONNECTION,
  MAGPIE_CONNECTION,
  type CompanionRuntime,
  type ModelConnectionDescription,
} from '@pet/companion-runtime';
import { createCompanionService } from './service.js';
import { credentialIngressAllowed } from './server.js';

const token = 'model-controller-test-operator-token-45c173';
const key = 'independent-gateway-key-canary-5d28490';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
async function setup(publicOrigin?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-model-http-'));
  const calls: Array<{
    body: Record<string, unknown>;
    authorization: string | undefined;
    path: string | undefined;
  }> = [];
  let status = 200;
  let responseText = 'Gateway fixture OK';
  let protocolSettings: { eventType?: string; instructions?: string } = {};
  let hanging = false;
  let closedStreams = 0;
  const native = createFixtureModelClient();
  const gateway = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      calls.push({ body, authorization: incoming.headers.authorization, path: incoming.url });
      if (hanging) {
        outgoing.on('close', () => {
          closedStreams++;
        });
        outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
        outgoing.write(': controlled hanging stream\n\n');
        return;
      }
      if (status !== 200) {
        outgoing.writeHead(status);
        outgoing.end(responseText);
        return;
      }
      const generation = await native.respond({ model: String(body['model']), input: [] });
      const item = generation.response.output[0];
      if (!item || item.type !== 'message') throw new Error('missing fixture output');
      const completed = {
        ...generation.response,
        ...(protocolSettings.instructions !== undefined
          ? { instructions: protocolSettings.instructions }
          : {}),
        output: [
          {
            ...item,
            content: [{ type: 'output_text', text: responseText, annotations: [], logprobs: [] }],
          },
        ],
      };
      if (body['stream'] === true) {
        const events = [
          {
            type: 'response.created',
            sequence_number: 0,
            response: { ...completed, status: 'in_progress', output: [] },
          },
          {
            type: 'response.output_item.added',
            sequence_number: 1,
            output_index: 0,
            item: { ...completed.output[0], status: 'in_progress', content: [] },
          },
          {
            type: 'response.output_item.done',
            sequence_number: 2,
            output_index: 0,
            item: completed.output[0],
          },
          { type: 'response.completed', sequence_number: 3, response: completed },
        ];
        const prefix = protocolSettings.eventType ? [{ type: protocolSettings.eventType }] : [];
        outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
        outgoing.end(
          [...prefix, ...events].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        );
      } else {
        outgoing.writeHead(200, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify(completed));
      }
    })().catch(() => outgoing.destroy());
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const address = gateway.address();
  if (!address || typeof address === 'string') throw new Error('missing gateway port');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  let service = await createCompanionService({
    dataDirectory: directory,
    token,
    port: 0,
    ...(publicOrigin ? { publicOrigin } : {}),
  });
  cleanups.push(async () => {
    await service.close();
    gateway.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      gateway.close((error) => (error ? reject(error) : resolve())),
    );
    const target = await realpath(directory);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('companion-model-http-')
    )
      throw new Error('unexpected cleanup target');
    await rm(target, { recursive: true });
  });
  const request = async <T>(
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; result: Result<T> }> => {
    const response = await fetch(service.url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, result: (await response.json()) as Result<T> };
  };
  const view = async (): Promise<CompanionModelView> =>
    value((await request<CompanionModelView>('/api/model')).result);
  const save = async (
    current: CompanionModelView,
    config?: Record<string, string>,
    connectorId = MAGPIE_CONNECTION,
    mode: 'scripted' | 'model' = 'scripted',
  ) => {
    const connector = current.connectors.find((entry) => entry.id === connectorId);
    if (!connector) throw new Error('missing connector');
    return request<CompanionModelCommandResult>('/api/model', {
      commandId: crypto.randomUUID(),
      expectedProfileRevision: current.profileRevision,
      connectorId,
      expectedConfigRevision: connector.configRevision,
      mode,
      ...(config ? { config } : {}),
    });
  };
  return {
    directory,
    baseUrl,
    calls,
    request,
    view,
    save,
    service: () => service,
    setResponse(code: number, text: string) {
      status = code;
      responseText = text;
    },
    setHanging() {
      hanging = true;
    },
    setProtocol(value: { eventType?: string; instructions?: string }) {
      protocolSettings = value;
    },
    closedStreams: () => closedStreams,
    async restart() {
      await service.close();
      service = await createCompanionService({
        dataDirectory: directory,
        token,
        port: 0,
        ...(publicOrigin ? { publicOrigin } : {}),
      });
    },
  };
}

it('permits controlled loopback/SSH only, not a claimed remote TLS entry through a local proxy', () => {
  expect(
    credentialIngressAllowed({
      remoteAddress: '10.1.0.8',
      host: 'pet.example',
      origin: 'https://pet.example',
    }),
  ).toBe(false);
  expect(
    credentialIngressAllowed({
      remoteAddress: '127.0.0.1',
      host: 'pet.example',
      origin: 'https://pet.example',
    }),
  ).toBe(false);
  expect(
    credentialIngressAllowed({
      remoteAddress: '127.0.0.1',
      host: '10.1.0.7',
      origin: 'http://10.1.0.7',
    }),
  ).toBe(false);
  expect(
    credentialIngressAllowed({
      remoteAddress: '::ffff:127.0.0.1',
      host: 'localhost:4120',
      origin: undefined,
    }),
  ).toBe(true);
});

it('saves without calling, explicitly checks the same native SSE binding once, and labels replacement fixture', async () => {
  const f = await setup();
  const initial = await f.view();
  expect(initial.check.state).toBe('unconfigured');
  expect(initial.enabled).toBe(false);
  const saved = value(
    (
      await f.save(initial, {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'local-client-id',
      })
    ).result,
  ).view;
  expect(f.calls).toHaveLength(0);
  expect(saved.applied?.connectorId).toBe(MAGPIE_CONNECTION);
  expect(saved.enabled).toBe(false);
  const test = {
    commandId: crypto.randomUUID(),
    connectorId: MAGPIE_CONNECTION,
    expectedConfigRevision: saved.applied?.configRevision,
    expectedCredentialVersion: saved.applied?.credentialVersion,
  };
  const accepted = await f.request<CompanionModelCommandResult>('/api/model/test', test);
  expect(accepted.status).toBe(202);
  await vi.waitFor(async () => expect((await f.view()).check.state).toBe('verified'));
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({
    path: '/v1/responses',
    authorization: 'Bearer magpie-dsh-pet',
    body: { model: 'provider/fixture', stream: true, store: false, max_output_tokens: 256 },
  });
  expect(JSON.stringify(f.calls[0]?.body)).not.toContain('Previously committed');
  expect(
    value((await f.request<CompanionModelCommandResult>('/api/model/test', test)).result).receipt
      .status,
  ).toBe('duplicate');
  expect(f.calls).toHaveLength(1);
  const before = value((await f.request<CompanionSnapshot>('/api/snapshot')).result);
  const alternate = value(
    (await f.save(await f.view(), undefined, FIXTURE_MODEL_CONNECTION, 'model')).result,
  ).view;
  expect(alternate.enabled).toBe(true);
  const fixtureTest = {
    commandId: crypto.randomUUID(),
    connectorId: FIXTURE_MODEL_CONNECTION,
    expectedConfigRevision: alternate.applied?.configRevision,
    expectedCredentialVersion: alternate.applied?.credentialVersion,
  };
  expect((await f.request('/api/model/test', fixtureTest)).status).toBe(202);
  await vi.waitFor(async () => expect((await f.view()).check.state).toBe('verified'));
  expect((await f.view()).check.evidence).toBe('synthetic');
  expect(f.calls).toHaveLength(1);
  const after = value((await f.request<CompanionSnapshot>('/api/snapshot')).result);
  expect(after.agent.id).toBe(before.agent.id);
  expect(after.agent.harness).toBe(before.agent.harness);
});

it('keeps independent gateway keys out of storage and binds availability to full target plus process generation', async () => {
  const f = await setup();
  const saved = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'gateway-key',
      })
    ).result,
  ).view;
  const connector = saved.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
  if (!connector) throw new Error('missing connector');
  expect(connector.credential).toMatchObject({ required: true, available: false, writable: true });
  const credential = {
    connectorId: connector.id,
    expectedConfigRevision: connector.configRevision,
    expectedCredentialVersion: connector.credential.version,
    apiKey: key,
  };
  const supplied = value(
    (await f.request<CompanionModelView>('/api/model/credential', credential)).result,
  );
  expect(supplied.applied).not.toBeNull();
  expect(JSON.stringify(supplied)).not.toContain(key);
  const old = supplied.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
  if (!old) throw new Error('missing connector');
  const form = { ...credential, expectedCredentialVersion: old.credential.version };
  await f.restart();
  const restarted = await f.view();
  expect(restarted.check.state).toBe('configured');
  const missing = restarted.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
  expect(missing?.credential.available).toBe(false);
  expect(missing?.credential.version).not.toBe(old.credential.version);
  expect((await f.request('/api/model/credential', form)).status).toBe(409);
  if (!missing) throw new Error('missing connector');
  value(
    (
      await f.request<CompanionModelView>('/api/model/credential', {
        ...form,
        expectedCredentialVersion: missing.credential.version,
      })
    ).result,
  );
  const changed = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl.replace('/v1', '/other/v1'),
        model: 'provider/fixture',
        authMode: 'gateway-key',
      })
    ).result,
  ).view;
  expect(
    changed.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.available,
  ).toBe(false);
  expect(changed.applied).toBeNull();
  expect(f.calls).toHaveLength(0);
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else expect((await readFile(file)).includes(Buffer.from(key))).toBe(false);
    }
  };
  await scan(f.directory);
});

it.each([false, true])(
  'uses the Magpie provider seam and classifies actual protocol errors separately from network; unknown=%s',
  async (unknown) => {
    const f = await setup();
    f.setProtocol({
      eventType: unknown ? 'vendor.unobserved' : 'codex.rate_limits',
      instructions: 'synthetic instruction '.repeat(1100),
    });
    const saved = value(
      (
        await f.save(await f.view(), {
          baseUrl: f.baseUrl,
          model: 'provider/fixture',
          authMode: 'local-client-id',
        })
      ).result,
    ).view;
    const command = {
      commandId: crypto.randomUUID(),
      connectorId: MAGPIE_CONNECTION,
      expectedConfigRevision: saved.applied?.configRevision,
      expectedCredentialVersion: saved.applied?.credentialVersion,
    };
    expect((await f.request('/api/model/test', command)).status).toBe(202);
    await vi.waitFor(async () =>
      expect((await f.view()).check.state).toBe(unknown ? 'failed' : 'verified'),
    );
    const result = await f.view();
    expect(result.check.error?.code ?? null).toBe(unknown ? 'unavailable' : null);
    if (unknown) expect(result.check.error?.retryable).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.body['max_output_tokens']).toBe(256);
    expect(f.calls[0]?.body['stream']).toBe(true);
  },
);

it('records wrong gateway-key failure without changing into scripted success or echoing provider text', async () => {
  const f = await setup();
  f.setResponse(401, `refused credential ${key}`);
  const saved = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'local-client-id',
      })
    ).result,
  ).view;
  const command = {
    commandId: crypto.randomUUID(),
    connectorId: MAGPIE_CONNECTION,
    expectedConfigRevision: saved.applied?.configRevision,
    expectedCredentialVersion: saved.applied?.credentialVersion,
  };
  expect((await f.request('/api/model/test', command)).status).toBe(202);
  await vi.waitFor(async () => expect((await f.view()).check.state).toBe('failed'));
  const failed = await f.view();
  expect(failed.check.error?.code).toBe('auth-failed');
  expect(JSON.stringify(failed)).not.toContain(key);
  expect(f.calls).toHaveLength(1);
});

it.each(['http://10.1.0.7:4120', 'https://pet.example'])(
  'makes writable false for remote entry %s and refuses the same private key write',
  async (origin) => {
    const f = await setup(origin);
    const saved = value(
      (
        await f.save(await f.view(), {
          baseUrl: f.baseUrl,
          model: 'provider/fixture',
          authMode: 'gateway-key',
        })
      ).result,
    ).view;
    const connector = saved.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
    if (!connector) throw new Error('missing connector');
    const headers = { Origin: origin, Host: new URL(origin).host };
    const unsafe = value(
      (await f.request<CompanionModelView>('/api/model', undefined, headers)).result,
    );
    expect(
      unsafe.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.writable,
    ).toBe(false);
    const rejected = await f.request(
      '/api/model/credential',
      {
        connectorId: connector.id,
        expectedConfigRevision: connector.configRevision,
        expectedCredentialVersion: connector.credential.version,
        apiKey: key,
      },
      headers,
    );
    expect(rejected.status).toBe(403);
    expect(
      (await f.view()).connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential
        .available,
    ).toBe(false);
    expect(f.calls).toHaveLength(0);
  },
);

it('revokes an admitted check through the real socket and retains a truthful failed outcome', async () => {
  const f = await setup();
  const saved = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'local-client-id',
      })
    ).result,
  ).view;
  f.setHanging();
  const command = {
    commandId: crypto.randomUUID(),
    connectorId: MAGPIE_CONNECTION,
    expectedConfigRevision: saved.applied?.configRevision,
    expectedCredentialVersion: saved.applied?.credentialVersion,
  };
  expect((await f.request('/api/model/test', command)).status).toBe(202);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  f.service().host.permissionControl.revoke({
    pluginId: 'pet.model-connection-magpie',
    instanceId: 'default',
  });
  await vi.waitFor(async () => expect((await f.view()).check.state).toBe('failed'));
  await vi.waitFor(() => expect(f.closedStreams()).toBe(1));
  expect((await f.view()).check.error?.code).toBe('permission-denied');
  expect(f.service().host.permissions.diagnostics().leases).toBe(0);
  expect(f.service().host.tasks.diagnostics().pendingWork).toBe(0);
});

it.each(['memory', 'environment'] as const)(
  'retires the %s key when switching away and requires explicit target-bound re-entry',
  async (source) => {
    const f = await setup();
    let current = value(
      (
        await f.save(await f.view(), {
          baseUrl: f.baseUrl,
          model: 'provider/fixture',
          authMode: 'gateway-key',
        })
      ).result,
    ).view;
    let connector = current.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
    if (!connector) throw new Error('missing connector');
    if (source === 'environment') {
      await f.service().models.seedEnvironment(MAGPIE_CONNECTION, key, f.baseUrl);
      current = value((await f.save(await f.view())).result).view;
    } else
      current = value(
        (
          await f.request<CompanionModelView>('/api/model/credential', {
            connectorId: MAGPIE_CONNECTION,
            expectedConfigRevision: connector.configRevision,
            expectedCredentialVersion: connector.credential.version,
            apiKey: key,
          })
        ).result,
      );
    connector = current.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
    if (!connector || !current.applied) throw new Error('key was not applied');
    const previous = connector;
    const away = value((await f.save(current, undefined, FIXTURE_MODEL_CONNECTION)).result).view;
    const retired = away.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
    expect(retired?.credential.available).toBe(false);
    expect(retired?.credential.version).not.toBe(previous.credential.version);
    const returned = value((await f.save(away, undefined, MAGPIE_CONNECTION)).result).view;
    expect(returned.applied).toBeNull();
    expect(
      returned.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.available,
    ).toBe(false);
    expect(
      (
        await f.request('/api/model/credential', {
          connectorId: MAGPIE_CONNECTION,
          expectedConfigRevision: previous.configRevision,
          expectedCredentialVersion: previous.credential.version,
          apiKey: key,
        })
      ).status,
    ).toBe(409);
    expect(f.calls).toHaveLength(0);
  },
);

it('retires the predecessor key after selection commit even when cleanup fails and the same intent retries', async () => {
  const f = await setup();
  const configured = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'gateway-key',
      })
    ).result,
  ).view;
  const connector = configured.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
  if (!connector) throw new Error('missing connector');
  const healthy = value(
    (
      await f.request<CompanionModelView>('/api/model/credential', {
        connectorId: MAGPIE_CONNECTION,
        expectedConfigRevision: connector.configRevision,
        expectedCredentialVersion: connector.credential.version,
        apiKey: key,
      })
    ).result,
  );
  const original = healthy.connectors.find((entry) => entry.id === MAGPIE_CONNECTION);
  const alternate = healthy.connectors.find((entry) => entry.id === FIXTURE_MODEL_CONNECTION);
  if (!original || !alternate) throw new Error('missing connectors');
  const command = {
    commandId: crypto.randomUUID(),
    connectorId: FIXTURE_MODEL_CONNECTION,
    expectedProfileRevision: healthy.profileRevision,
    expectedConfigRevision: alternate.configRevision,
    mode: 'scripted',
  };
  const rejected = await f.request('/api/model', {
    ...command,
    commandId: crypto.randomUUID(),
    expectedProfileRevision: healthy.profileRevision + 1,
  });
  expect(rejected.status).toBe(409);
  expect(
    (await f.view()).connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential,
  ).toEqual(original.credential);
  const retiring = vi
    .spyOn(f.service().runtime, 'retireForeground')
    .mockRejectedValueOnce(new KernelFault('unavailable'));
  try {
    expect((await f.request('/api/model', command)).status).toBe(503);
    const partial = await f.view();
    expect(partial.desired.connectorId).toBe(FIXTURE_MODEL_CONNECTION);
    expect(
      partial.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.available,
    ).toBe(false);
    expect(
      partial.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.version,
    ).not.toBe(original.credential.version);
    const retried = value(
      (await f.request<CompanionModelCommandResult>('/api/model', command)).result,
    );
    expect(retried.receipt.status).toBe('duplicate');
    const returned = value((await f.save(retried.view, undefined, MAGPIE_CONNECTION)).result).view;
    expect(returned.applied).toBeNull();
    expect(
      returned.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.credential.available,
    ).toBe(false);
    expect(f.calls).toHaveLength(0);
  } finally {
    retiring.mockRestore();
  }
});

it('does not poison a healthy applied binding with stale save/key request errors', async () => {
  const f = await setup();
  const healthy = value(
    (await f.save(await f.view(), undefined, FIXTURE_MODEL_CONNECTION, 'model')).result,
  ).view;
  const connector = healthy.connectors.find((entry) => entry.id === FIXTURE_MODEL_CONNECTION);
  if (!connector) throw new Error('missing connector');
  expect(healthy.enabled).toBe(true);
  expect(healthy.error).toBeNull();
  expect(
    (
      await f.request('/api/model', {
        commandId: crypto.randomUUID(),
        connectorId: connector.id,
        expectedProfileRevision: healthy.profileRevision - 1,
        expectedConfigRevision: connector.configRevision,
        mode: 'model',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.request('/api/model/credential', {
        connectorId: connector.id,
        expectedConfigRevision: connector.configRevision,
        expectedCredentialVersion: 'old-process:old-slot',
        apiKey: 'a',
      })
    ).status,
  ).toBe(409);
  const after = await f.view();
  expect(after.error).toBeNull();
  expect(after.applied).toEqual(healthy.applied);
  expect(after.enabled).toBe(true);
  expect(after.connectors).toEqual(healthy.connectors);
});

it('atomically prevents a second paid request when a pre-lock lookup races a completed identical check', async () => {
  const f = await setup();
  const saved = value(
    (
      await f.save(await f.view(), {
        baseUrl: f.baseUrl,
        model: 'provider/fixture',
        authMode: 'local-client-id',
      })
    ).result,
  ).view;
  const command = {
    commandId: crypto.randomUUID(),
    connectorId: MAGPIE_CONNECTION,
    expectedConfigRevision: saved.applied?.configRevision,
    expectedCredentialVersion: saved.applied?.credentialVersion,
  };
  const runtime = f.service().runtime;
  const original = runtime.state.bind(runtime);
  let release: () => void = () => {};
  let enter: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let first = true;
  const spy = vi.spyOn(runtime, 'state').mockImplementation((async (method, input, ...rest) => {
    const result = await original(method, input, ...rest);
    if (
      first &&
      method === 'getCommand' &&
      (input as { commandId?: string }).commandId === command.commandId
    ) {
      first = false;
      enter();
      await released;
    }
    return result;
  }) as CompanionRuntime['state']);
  const delayed = f.request<CompanionModelCommandResult>('/api/model/test', command);
  await entered;
  try {
    expect((await f.request('/api/model/test', command)).status).toBe(202);
    await vi.waitFor(async () => expect((await f.view()).check.state).toBe('verified'));
    expect(f.calls).toHaveLength(1);
    release();
    expect(value((await delayed).result).receipt.status).toBe('duplicate');
    expect(f.calls).toHaveLength(1);
  } finally {
    release();
    await delayed;
    spy.mockRestore();
  }
});

it.each(['extra-field', 'oversized', 'bad-auth', 'bad-shape'] as const)(
  'rejects a custom projector %s without leaking settings or failing the history snapshot',
  async (mode) => {
    const f = await setup();
    const memory = await f.service().runtime.state('memorySnapshot', {});
    await f.service().runtime.state('rememberFact', {
      expectedMemoryRevision: memory.memoryRevision,
      expectedFactRevision: 0,
      origin: { kind: 'owner-form' },
      commandId: crypto.randomUUID(),
      key: 'preserved',
      value: 'authoritative',
    });
    const registration = f.service().models.connections.registration(MAGPIE_CONNECTION);
    const config = await f
      .service()
      .host.configs.get({ pluginId: registration.manifest.id, instanceId: 'default' });
    if (!config.ok) throw new Error('missing config');
    const valid = registration.connection.describeConfig(config.value.data);
    if (!valid.settings) throw new Error('missing settings');
    const settings =
      mode === 'extra-field'
        ? { ...valid.settings, apiKey: key }
        : mode === 'oversized'
          ? { ...valid.settings, baseUrl: 'https://example.test/' + 'p'.repeat(2048) }
          : mode === 'bad-auth'
            ? {
                ...valid.settings,
                baseUrl: 'https://remote.example/v1',
                authMode: 'local-client-id',
              }
            : [valid.settings];
    const spy = vi
      .spyOn(registration.connection, 'describeConfig')
      .mockReturnValue({ ...valid, settings } as unknown as ModelConnectionDescription);
    try {
      const view = await f.view();
      expect(view.error?.code).toBe('invalid-input');
      expect(view.connectors.find((entry) => entry.id === MAGPIE_CONNECTION)?.settings).toBeNull();
      expect(JSON.stringify(view)).not.toContain(key);
      const snapshot = await f.request<CompanionSnapshot>('/api/snapshot');
      expect(snapshot.status).toBe(200);
      expect(value(snapshot.result).facts).toContainEqual(
        expect.objectContaining({ key: 'preserved', value: 'authoritative' }),
      );
      expect(Buffer.byteLength(JSON.stringify(snapshot.result))).toBeLessThan(JSON_MAX_BYTES);
    } finally {
      spy.mockRestore();
    }
  },
);

it('budgets real SQLite history once at the final Result/snapshot boundary with maximum connector metadata', async () => {
  const f = await setup();
  const runtime = f.service().runtime;
  for (let index = 0; index < 24; index++) {
    const accepted = await runtime.state('createTask', {
      commandId: `budget-task-${index}`,
      title: 'T'.repeat(160),
      code: 'fixture()',
    });
    await runtime.state('updateTask', {
      taskId: accepted.task.id,
      status: 'completed',
      exitCode: 0,
      stdout: 's'.repeat(12000),
      stderr: 'e'.repeat(12000),
    });
    const memory = await runtime.state('memorySnapshot', {});
    await runtime.state('rememberFact', {
      expectedMemoryRevision: memory.memoryRevision,
      expectedFactRevision: 0,
      origin: { kind: 'owner-form' },
      commandId: `budget-fact-${index}`,
      key: `fact-${index}`,
      value: 'f'.repeat(200),
    });
  }
  for (let index = 0; index < 100; index++)
    await runtime.state('acceptMessage', {
      commandId: `budget-message-${index}`,
      text: 'm'.repeat(8000),
    });
  const raw = await runtime.state('snapshot', {});
  const initial = await f.view();
  const first = initial.connectors[0];
  if (!first) throw new Error('missing initial connector');
  const url = 'https://example.test/' + 'p'.repeat(2048 - 'https://example.test/'.length);
  const maximum: CompanionModelView = {
    ...initial,
    connectors: Array.from({ length: 8 }, (_, index) => ({
      ...first,
      id: index === 0 ? MAGPIE_CONNECTION : `pet.connector-${index}/provider`,
      label: 'L'.repeat(80),
      model: 'M'.repeat(128),
      settings: { baseUrl: url, model: 'M'.repeat(128), authMode: 'gateway-key' },
      credential: {
        required: true,
        available: false,
        source: 'none',
        version: 'v'.repeat(128),
        writable: true,
      },
    })),
    check: { ...initial.check, state: 'configured' },
  };
  expect(
    Buffer.byteLength(JSON.stringify(raw)) + Buffer.byteLength(JSON.stringify(maximum)),
  ).toBeGreaterThan(JSON_MAX_BYTES);
  runtime.setModelControls({
    view: async () => maximum,
    isChecking: () => false,
    close: () => f.service().models.close(),
  });
  const response = await f.request<CompanionSnapshot>('/api/snapshot');
  expect(response.status).toBe(200);
  expect(Buffer.byteLength(JSON.stringify(response.result))).toBeLessThanOrEqual(JSON_MAX_BYTES);
  expect(jsonPreflight(response.result).ok).toBe(true);
  const snapshot = value(response.result);
  expect(snapshot.facts).toEqual(raw.facts);
  expect(snapshot.projection).toEqual({
    hasMoreMessages: true,
    hasMoreTasks: true,
    taskDetailsTruncated: true,
  });
  expect(snapshot.messages.length).toBeLessThan(raw.messages.length);
}, 20000);

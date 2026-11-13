import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  QQ_FEATURE_PLUGIN_ID,
  QQ_JUDGE_PLUGIN_ID,
  QQ_JUDGE_PROVIDER_REF,
  defaultQQJudgePolicy,
  QQ_GROUP_CONTEXT_MAX_MESSAGES,
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  isQQJudgePolicy,
  isQQJudgeView,
  makeError,
  type JsonObject,
  type PluginManifest,
} from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  CompanionPluginHost,
  CompanionRuntime,
  ModelConnections,
  companionHostDefinition,
  companionHostManifest,
  MODEL_CONNECTION_CAPABILITY,
  type ModelConnectionRegistration,
  type ServicePluginRegistration,
} from '@pet/companion-runtime';
import stateDefinition, {
  type StateGroupAudience,
  type StateMethodInputs,
  type StateMethodOutputs,
} from '@pet/state-sqlite';
import { createMagpieConnectionPlugin, describeMagpieConfig } from '@pet/model-connection-magpie';
import { createAuthorizedModelClient } from './model-client.js';
import { QQJudgeController, type QQJudgePolicyPorts, type QQJudgmentContext } from './qq-judge.js';
import { createQQJudgeNativeProvider } from './qq-judge-native.mjs';

const KEY = 'judge-only-credential-8a1d-"quoted\\value';
const PRIMARY_KEY = 'primary-only-credential-17d4';
const PRIMARY_ID = 'pet.model-connection-magpie';
const PRIMARY_REF = `${PRIMARY_ID}/magpie`;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const int = (minimum: number, maximum: number, value: number) => ({
  type: 'integer' as const,
  minimum,
  maximum,
  default: value,
});
const featureManifest: PluginManifest = {
  ...companionHostManifest,
  id: QQ_FEATURE_PLUGIN_ID,
  provides: [],
  consumes: [{ capability: MODEL_CONNECTION_CAPABILITY, optional: true }],
  permissions: [{ kind: 'capability-use', capability: MODEL_CONNECTION_CAPABILITY }],
  config: {
    version: 1,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'judge'],
      properties: {
        label: { type: 'string', maxLength: 80, default: 'unrelated-policy-preserved' },
        judge: {
          type: 'object',
          additionalProperties: false,
          required: [
            'providerRef',
            'maxAttemptsPerHour',
            'perGroupIntervalMs',
            'timeoutMs',
            'maxOutputTokens',
          ],
          properties: {
            providerRef: { type: 'string', maxLength: 255, default: QQ_JUDGE_PROVIDER_REF },
            maxAttemptsPerHour: int(1, 30, 30),
            perGroupIntervalMs: int(60000, 3600000, 60000),
            timeoutMs: int(1000, 10000, 1000),
            maxOutputTokens: int(1, 256, 256),
          },
        },
      },
    },
  },
};
function group(groupId: string): StateGroupAudience {
  return {
    kind: 'qq-group',
    groupId,
    account: {
      protocol: 'official',
      sourcePluginId: 'pet.qq-official',
      instanceId: 'default',
      accountId: 'fixture-account',
    },
  };
}
function response(model: string, text: string, usage: boolean) {
  return {
    id: 'judge-response',
    model,
    status: 'completed',
    output: [
      {
        id: 'judge-message',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    ...(usage
      ? {
          usage: {
            input_tokens: 7,
            output_tokens: 4,
            total_tokens: 11,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }
      : {}),
  };
}
async function manifest(name: string): Promise<PluginManifest> {
  return JSON.parse(
    await readFile(new URL(`../../../plugins/${name}/plugin.json`, import.meta.url), 'utf8'),
  ) as PluginManifest;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-qq-judge-'));
  const requests: Array<{ body: JsonObject; authorization: string | undefined }> = [];
  let status = 200,
    text = '{"participate":true}',
    withUsage = true;
  let holdModel: string | undefined;
  let hanging: ServerResponse | undefined;
  const hangEntered = deferred();
  const hangClosed = deferred();
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject;
      requests.push({ body, authorization: incoming.headers.authorization });
      const model = String(body['model']);
      if (model === holdModel) {
        hanging = outgoing;
        outgoing.once('close', () => hangClosed.resolve());
        outgoing.writeHead(200, { 'Content-Type': 'application/json' });
        outgoing.write(' ');
        hangEntered.resolve();
        return;
      }
      const code = model === 'primary-model' ? 200 : status;
      outgoing.writeHead(code, { 'Content-Type': 'application/json' });
      outgoing.end(
        code === 200
          ? JSON.stringify(
              response(model, model === 'primary-model' ? 'primary healthy' : text, withUsage),
            )
          : 'controlled failure',
      );
    })().catch(() => outgoing.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const stateManifest = await manifest('state-sqlite');
  const primaryManifest = await manifest('model-connection-magpie');
  const judgeManifest = await manifest('qq-participation-magpie');
  let host: CompanionPluginHost;
  let runtime: CompanionRuntime;
  let connections: ModelConnections;
  let controller: QQJudgeController;
  let failPolicySave = false;
  const rootIdentity = { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' };
  const policy: QQJudgePolicyPorts = {
    async read() {
      const result = await host.configs.get(rootIdentity);
      if (!result.ok) throw new KernelFault(result.error.code);
      const settings = result.value.data['judge'];
      if (!isQQJudgePolicy(settings)) throw new KernelFault('invalid-input');
      return { revision: result.value.revision, settings };
    },
    async save(expectedRevision, settings) {
      if (failPolicySave) throw new KernelFault('conflict');
      const current = await host.configs.get(rootIdentity);
      if (!current.ok) throw new KernelFault(current.error.code);
      const result = await host.configs.save(
        rootIdentity,
        { ...current.value.data, judge: { ...settings } },
        expectedRevision,
      );
      if (!result.ok) throw new KernelFault(result.error.code);
      return { revision: result.value.snapshot.revision, settings };
    },
  };
  async function packageDirectory(m: PluginManifest) {
    const target = path.join(directory, 'packages', m.id);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'plugin.json'), JSON.stringify(m));
    return target;
  }
  async function boot() {
    const registrations: ModelConnectionRegistration[] = await Promise.all(
      [
        { manifest: primaryManifest, model: 'primary-model', purpose: 'foreground' as const },
        { manifest: judgeManifest, model: 'judge-model', purpose: 'qq-participation' as const },
      ].map(async ({ manifest: m, model, purpose }) => ({
        manifest: m,
        directory: await packageDirectory(m),
        enabled: false,
        preset: 'allow' as const,
        hostCredentials: ['model-api-key'],
        initialConfig: { baseUrl, model, authMode: 'gateway-key' },
        definition: createMagpieConnectionPlugin((context) => connections.portsFor(context)),
        connection: {
          providerId: 'magpie',
          purpose,
          describeConfig: describeMagpieConfig,
          ...(purpose === 'qq-participation'
            ? { nativeProvider: createQQJudgeNativeProvider }
            : {}),
        },
      })),
    );
    const plugins: ServicePluginRegistration[] = [
      {
        manifest: companionHostManifest,
        directory: await packageDirectory(companionHostManifest),
        definition: companionHostDefinition,
        enabled: true,
        preset: 'allow',
      },
      {
        manifest: featureManifest,
        directory: await packageDirectory(featureManifest),
        definition: definePlugin({ activate() {} }),
        enabled: true,
        preset: 'allow',
        initialConfig: {
          label: 'unrelated-policy-preserved',
          judge: { ...defaultQQJudgePolicy(), timeoutMs: 1000 },
        },
      },
      {
        manifest: stateManifest,
        directory: await packageDirectory(stateManifest),
        definition: stateDefinition,
        dataDirectory: path.join(directory, 'state'),
        enabled: true,
        preset: 'allow',
      },
      ...registrations,
    ];
    host = await CompanionPluginHost.create({
      dataDirectory: path.join(directory, 'host'),
      plugins,
    });
    host.bind('companion.state@1', stateManifest.id, 'sqlite');
    runtime = new CompanionRuntime(host, {
      mode: 'scripted',
      statePluginId: stateManifest.id,
      stateProviderId: 'sqlite',
      executionPluginId: 'pet.cloud-exec',
      executionProviderId: 'docker',
      executionTimeoutMs: 30000,
    });
    connections = new ModelConnections(host, registrations, (owner, url) =>
      owner.pluginId === QQ_JUDGE_PLUGIN_ID
        ? controller.transport(owner, url)
        : createAuthorizedModelClient(host, owner.pluginId, { baseUrl: url, apiKey: PRIMARY_KEY }),
    );
    connections.select(PRIMARY_REF, 'foreground');
    await connections.enable(PRIMARY_REF);
    controller = new QQJudgeController(host, runtime, connections, policy);
    await controller.initialize();
  }
  try {
    await boot();
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  cleanups.push(async () => {
    hanging?.destroy();
    await controller.close();
    await runtime.close();
    await host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const key = async (value = KEY) => {
    const view = await controller.view();
    return controller.credential({
      providerRef: QQ_JUDGE_PROVIDER_REF,
      expectedConfigRevision: view.configRevision,
      expectedCredentialVersion: view.credential.version,
      value,
    });
  };
  const context = async (id: string, groupId = id, eventKey = id): Promise<QQJudgmentContext> => {
    const audience = group(groupId);
    await runtime.state('observe', {
      observation: {
        id: `observation-${id}`,
        audience,
        principalId: 'member',
        observedAt: Date.now(),
        text: `CURRENT_GROUP_${groupId}`,
        quotedText: null,
        materialIds: [],
        fileEvidence: null,
      },
    });
    return {
      id,
      eventKey,
      audience,
      observationId: `observation-${id}`,
      contextMessages: QQ_GROUP_CONTEXT_MAX_MESSAGES,
      contextMaxAgeMs: QQ_GROUP_CONTEXT_MAX_AGE_MS,
      reference: {
        eventId: null,
        messageId: `native-${id}`,
        occurredAt: Date.now(),
        displayReference: null,
      },
      policyRevision: (await policy.read()).revision,
      async check() {},
    };
  };
  return {
    get host() {
      return host;
    },
    get runtime() {
      return runtime;
    },
    get controller() {
      return controller;
    },
    get connections() {
      return connections;
    },
    policy,
    requests,
    directory,
    key,
    context,
    baseUrl,
    setReply(code: number, body: string, usage = true) {
      status = code;
      text = body;
      withUsage = usage;
    },
    failPolicy(value: boolean) {
      failPolicySave = value;
    },
    hold(model: string) {
      holdModel = model;
      return {
        entered: hangEntered.promise,
        closed: hangClosed.promise,
        release() {
          hanging?.end(
            JSON.stringify(
              response(
                model,
                model === 'primary-model' ? 'primary healthy' : '{"participate":true}',
                true,
              ),
            ),
          );
        },
      };
    },
    async restart() {
      await controller.close();
      await runtime.close();
      await host.close();
      await boot();
    },
  };
}

it('single-attempt native factory sends a real 503 exactly once with generation-purpose evidence', async () => {
  const f = await fixture();
  f.setReply(503, 'unavailable');
  const provider = createQQJudgeNativeProvider(f.baseUrl, KEY);
  await expect(
    provider.respond({ model: 'judge-model', input: [], tools: [] }, { diagnostic: false }),
  ).rejects.toMatchObject({
    status: 503,
    attempts: [{ purpose: 'generation', status: 503, outcome: 'failed' }],
  });
  expect(f.requests).toHaveLength(1);
});

it('saves independent config/key without inference, preserving primary and unrelated policy', async () => {
  const f = await fixture();
  const retire = vi.spyOn(f.runtime, 'retireForeground');
  const before = f.connections.binding(PRIMARY_REF);
  const view = await f.controller.view();
  expect(view.readiness).toBe('unconfigured');
  expect(view.inputTokens).toBeNull();
  const saved = await f.controller.save({
    expectedPolicyRevision: (await f.policy.read()).revision,
    expectedConfigRevision: view.configRevision,
    settings: {
      ...view.settings,
      maxOutputTokens: 128,
      connection: { ...view.settings.connection, model: 'judge-new' },
    },
  });
  expect(saved.error).toBeNull();
  expect(saved.configSaved && saved.policySaved).toBe(true);
  const keyed = await f.key();
  expect(isQQJudgeView(keyed)).toBe(true);
  expect(keyed.readiness).toBe('configured');
  expect(f.requests).toHaveLength(0);
  expect(f.connections.binding(PRIMARY_REF)).toEqual(before);
  expect(retire).not.toHaveBeenCalled();
  const policyConfig = await f.host.configs.get({
    pluginId: QQ_FEATURE_PLUGIN_ID,
    instanceId: 'default',
  });
  expect(policyConfig.ok && policyConfig.value.data['label']).toBe('unrelated-policy-preserved');
  await expect(
    f.controller.save({
      expectedPolicyRevision: saved.policyRevision,
      expectedConfigRevision: keyed.configRevision,
      settings: { ...keyed.settings, providerRef: PRIMARY_REF },
    }),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  expect(f.connections.binding(PRIMARY_REF)).toEqual(before);
});

it('uses only canonical group/public context and returns strict decision with actual nullable usage', async () => {
  const f = await fixture();
  await f.key();
  const current = await f.context('group-input', 'allowed');
  await f.context('other-input', 'FOREIGN_GROUP_CANARY');
  await f.runtime.state('acceptMessage', {
    commandId: 'owner-secret',
    text: 'OWNER_PRIVATE_CANARY',
  });
  const result = await f.controller.judge(current, new AbortController().signal);
  expect(result.decision).toBe(true);
  expect(result.attempt).toMatchObject({
    phase: 'settled',
    decision: true,
    cleanup: 'settled',
    inputTokens: 7,
    outputTokens: 4,
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.authorization).toBe(`Bearer ${KEY}`);
  const body = f.requests[0]?.body;
  expect(body?.['stream']).toBe(false);
  expect(body?.['store']).toBe(false);
  expect(body?.['tools']).toEqual([]);
  expect(body?.['tool_choice']).toBe('none');
  expect(JSON.stringify(body)).toContain('CURRENT_GROUP_allowed');
  expect(JSON.stringify(body)).not.toContain('FOREIGN_GROUP_CANARY');
  expect(JSON.stringify(body)).not.toContain('OWNER_PRIVATE_CANARY');
  const duplicate = await f.controller.judge(
    { ...current, id: 'same-event-another-id' },
    new AbortController().signal,
  );
  expect(duplicate).toMatchObject({ decision: false, reason: 'duplicate' });
  expect(duplicate.attempt?.decision).toBe(true);
  expect(f.requests).toHaveLength(1);
  const snapshot = await f.runtime.state('snapshot', {});
  expect(snapshot.messages.map((message) => message.role)).toEqual(['user']);
  const view = await f.controller.view();
  expect(view).toMatchObject({ admittedAttempts: 1, inputTokens: 7, outputTokens: 4, active: 0 });
  expect(JSON.stringify(view)).not.toContain(KEY);
});

it.each([
  'true',
  '{"participate":"true"}',
  '{"participate":true,"reason":"extra"}',
  '```json\n{"participate":true}\n```',
  '{not json}',
])('does not guess a decision from malformed output %s', async (output) => {
  const f = await fixture();
  await f.key();
  f.setReply(200, output, false);
  const result = await f.controller.judge(
    await f.context('malformed'),
    new AbortController().signal,
  );
  expect(result.decision).toBe(false);
  expect(result.attempt).toMatchObject({
    decision: null,
    cleanup: 'settled',
    inputTokens: null,
    outputTokens: null,
  });
  expect(result.error).not.toBeNull();
  expect((await f.controller.view()).admittedAttempts).toBe(1);
  expect(f.requests).toHaveLength(1);
});

it('failed attempts and event dedup survive real State/provider restart', async () => {
  const f = await fixture();
  await f.key();
  f.setReply(503, 'failure', false);
  const current = await f.context('first', 'persistent', 'event-persistent');
  const failed = await f.controller.judge(current, new AbortController().signal);
  expect(failed).toMatchObject({ decision: false, reason: 'failed' });
  expect(failed.attempt).toMatchObject({
    phase: 'settled',
    decision: null,
    inputTokens: null,
    cleanup: 'settled',
  });
  expect(f.requests).toHaveLength(1);
  await f.restart();
  expect((await f.controller.view()).admittedAttempts).toBe(1);
  await f.key();
  f.setReply(200, '{"participate":true}');
  const replay = await f.controller.judge(
    await f.context('replay', 'persistent', 'event-persistent'),
    new AbortController().signal,
  );
  expect(replay).toMatchObject({ decision: false, reason: 'duplicate' });
  const cooldown = await f.controller.judge(
    await f.context('cooldown', 'persistent'),
    new AbortController().signal,
  );
  expect(cooldown).toMatchObject({ decision: false, reason: 'group-cooldown', attempt: null });
  expect(f.requests).toHaveLength(1);
});

it('uses the durable global thirty-attempt budget across different groups', async () => {
  const f = await fixture();
  await f.key();
  const policy = await f.policy.read();
  const view = await f.controller.view();
  for (let n = 0; n < 29; n++) {
    const claim = await f.runtime.state('claimJudgment', {
      id: `earlier-${n}`,
      eventKey: `event-${n}`,
      audience: group(`earlier-group-${n}`),
      providerRef: QQ_JUDGE_PROVIDER_REF,
      policyRevision: policy.revision,
      configRevision: view.configRevision,
    });
    expect(claim.claimed).toBe(true);
    await f.runtime.state('finishJudgment', {
      id: `earlier-${n}`,
      decision: null,
      inputTokens: null,
      outputTokens: null,
      error: makeError('network'),
      cleanup: 'settled',
    });
  }
  expect(
    (await f.controller.judge(await f.context('thirtieth'), new AbortController().signal)).decision,
  ).toBe(true);
  const blocked = await f.controller.judge(
    await f.context('thirty-first'),
    new AbortController().signal,
  );
  expect(blocked).toMatchObject({ decision: false, reason: 'hourly-limit', attempt: null });
  expect(f.requests).toHaveLength(1);
  expect((await f.controller.view()).admittedAttempts).toBe(30);
});

it('cancellation joins the real native body and releases State active budget', async () => {
  const f = await fixture();
  await f.key();
  const pending = f.hold('judge-model');
  const cancel = new AbortController();
  const running = f.controller.judge(await f.context('cancel'), cancel.signal);
  await pending.entered;
  const busy = await f.controller.judge(
    await f.context('busy', 'another-group'),
    new AbortController().signal,
  );
  expect(busy).toMatchObject({ decision: false, reason: 'busy', attempt: null });
  cancel.abort();
  const result = await running;
  await pending.closed;
  expect(result).toMatchObject({ decision: false, reason: 'cancelled' });
  expect(result.attempt).toMatchObject({ phase: 'settled', cleanup: 'settled', decision: null });
  expect((await f.controller.view()).active).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('two-CAS partial save preserves committed config and reports the policy conflict', async () => {
  const f = await fixture();
  await f.key();
  const before = await f.controller.view();
  const policy = await f.policy.read();
  f.failPolicy(true);
  const result = await f.controller.save({
    expectedPolicyRevision: policy.revision,
    expectedConfigRevision: before.configRevision,
    settings: {
      ...before.settings,
      maxOutputTokens: 128,
      connection: { ...before.settings.connection, model: 'committed-model' },
    },
  });
  expect(result).toMatchObject({
    configSaved: true,
    policySaved: false,
    providerRef: QQ_JUDGE_PROVIDER_REF,
    error: { code: 'conflict' },
  });
  expect(result.configRevision).toBeGreaterThan(before.configRevision);
  expect(result.view?.settings.connection.model).toBe('committed-model');
  expect((await f.policy.read()).settings.maxOutputTokens).toBe(256);
  expect(f.requests).toHaveLength(0);
});

it('judge source/key changes do not cancel an in-flight primary request or borrow its key', async () => {
  const f = await fixture();
  await f.key();
  const before = f.connections.binding(PRIMARY_REF);
  const primary = f.connections.clientFor(f.host.owner(), 'foreground');
  const pending = f.hold('primary-model');
  const running = primary.respond({ model: 'primary-model', input: [] });
  await pending.entered;
  const view = await f.controller.view();
  await f.controller.credential({
    providerRef: QQ_JUDGE_PROVIDER_REF,
    expectedConfigRevision: view.configRevision,
    expectedCredentialVersion: view.credential.version,
    value: 'new-judge-only-key-42',
  });
  expect(f.connections.binding(PRIMARY_REF)).toEqual(before);
  expect(f.requests[0]?.authorization).toBe(`Bearer ${PRIMARY_KEY}`);
  pending.release();
  expect((await running).response.status).toBe('completed');
  await f.controller.close();
  expect(f.connections.binding(PRIMARY_REF)).toEqual(before);
});

it('known credentials never enter configuration or durable State files', async () => {
  const f = await fixture();
  await f.key();
  await f.controller.judge(await f.context('no-secret-files'), new AbortController().signal);
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile())
        expect((await readFile(file)).includes(Buffer.from(KEY))).toBe(false);
    }
  };
  await scan(f.directory);
});

it('judge includes only scoped facts and safe attachment metadata, never private locators', async () => {
  const f = await fixture();
  await f.key();
  const audience = group('metadata');
  let revision = (await f.runtime.state('memorySnapshot', { scope: { kind: 'management' } }))
    .memoryRevision;
  for (const [value, factAudience] of [
    ['PUBLIC_FACT', { kind: 'public' }],
    ['GROUP_FACT', audience],
    ['OWNER_FACT_NEVER_VISIBLE', { kind: 'owner-private' }],
  ] as const) {
    await f.runtime.state('rememberFact', {
      commandId: `fact-${revision}`,
      key: 'same-key',
      value,
      expectedMemoryRevision: revision,
      expectedFactRevision: 0,
      origin: { kind: 'owner-form' },
      audience: factAudience,
    });
    revision++;
  }
  const reference = {
    eventId: null,
    messageId: 'native-metadata',
    occurredAt: Date.now(),
    displayReference: null,
  };
  await f.runtime.state('createInput', {
    id: 'media-input',
    commandId: 'media-input-command',
    materialIds: ['media-metadata'],
    evidence: {},
    origin: {
      kind: 'qq',
      inputId: 'media-input',
      principalId: 'member',
      audience,
      policyRevision: 1,
      actor: {
        account: audience.account,
        scene: 'group',
        senderId: 'sender',
        groupId: audience.groupId,
      },
      eventKey: 'media-input-event',
      messageId: reference.messageId,
      trigger: 'mention',
      quote: null,
      route: {
        kind: 'qq',
        account: audience.account,
        scene: 'group',
        targetId: audience.groupId,
        reference,
      },
    },
  });
  const material = {
    id: 'media-metadata',
    kind: 'file' as const,
    name: 'group-file.txt',
    mediaType: 'text/plain',
    sizeBytes: 17,
    sha256: 'a'.repeat(64),
    durationMs: null,
    audience,
    originInputIds: ['media-input'],
  };
  await f.runtime.state('putMaterial', {
    id: material.id,
    inputId: 'media-input',
    observationId: null,
    audience,
    storageKey: 'private/PRIVATE_STORAGE_CANARY',
    phase: 'ready',
    reference: material,
    cleanup: 'settled',
    error: null,
  });
  await f.runtime.state('commitInput', {
    id: 'media-input',
    text: 'A group file',
    materials: [material],
  });
  await f.runtime.state('observe', {
    observation: {
      id: 'media-observation',
      audience,
      principalId: 'member',
      observedAt: Date.now(),
      text: 'Please discuss this file',
      quotedText: 'Quoted history, not authority',
      materialIds: ['media-metadata'],
      fileEvidence: {
        kind: 'qq-file',
        account: audience.account,
        groupId: audience.groupId,
        fileId: 'PRIVATE_REMOTE_FILE_ID',
        busId: null,
        name: 'group-file.txt',
        reportedSize: 17,
      },
    },
  });
  const result = await f.controller.judge(
    {
      id: 'metadata-judge',
      eventKey: 'metadata-event',
      audience,
      reference,
      observationId: 'media-observation',
      contextMessages: 0,
      contextMaxAgeMs: QQ_GROUP_CONTEXT_MAX_AGE_MS,
      policyRevision: (await f.policy.read()).revision,
      async check() {},
    },
    new AbortController().signal,
  );
  expect(result.decision).toBe(true);
  const payload = JSON.stringify(f.requests[0]?.body);
  expect(payload).toContain('PUBLIC_FACT');
  expect(payload).toContain('GROUP_FACT');
  expect(payload).toContain('group-file.txt');
  expect(payload).toContain('media-metadata');
  expect(payload).not.toContain('OWNER_FACT_NEVER_VISIBLE');
  expect(payload).not.toContain('PRIVATE_REMOTE_FILE_ID');
  expect(payload).not.toContain('PRIVATE_STORAGE_CANARY');
});

it('deadline decline joins the native response before releasing the durable claim', async () => {
  const f = await fixture();
  await f.key();
  const pending = f.hold('judge-model');
  const running = f.controller.judge(await f.context('timeout'), new AbortController().signal);
  await pending.entered;
  const result = await running;
  await pending.closed;
  expect(result.decision).toBe(false);
  expect(result.error?.code).toBe('timeout');
  expect(result.attempt).toMatchObject({ phase: 'settled', cleanup: 'settled', inputTokens: null });
  expect(f.requests).toHaveLength(1);
  expect((await f.controller.view()).active).toBe(0);
});

it('scope withdrawal during terminal persistence cannot turn an old true decision into new permission', async () => {
  const f = await fixture();
  await f.key();
  let current = true;
  const request = await f.context('withdraw-after-native');
  const state = f.runtime.state.bind(f.runtime);
  vi.spyOn(f.runtime, 'state').mockImplementation(
    async <M extends keyof StateMethodInputs>(
      method: M,
      input: StateMethodInputs[M],
      signal?: AbortSignal,
    ): Promise<StateMethodOutputs[M]> => {
      const result = await state(method, input, signal);
      if (method === 'finishJudgment') current = false;
      return result;
    },
  );
  const result = await f.controller.judge(
    {
      ...request,
      async check() {
        if (!current) throw new KernelFault('permission-denied');
      },
    },
    new AbortController().signal,
  );
  expect(result.decision).toBe(false);
  expect(result.error?.code).toBe('permission-denied');
  expect(result.attempt).toMatchObject({ phase: 'settled', decision: true, inputTokens: 7 });
  expect(f.requests).toHaveLength(1);
});

it('target changes clear only the judge key and stale CAS cannot overwrite its saved facts', async () => {
  const f = await fixture();
  await f.key();
  const primary = f.connections.binding(PRIMARY_REF);
  const before = await f.controller.view();
  const policy = await f.policy.read();
  const changed = await f.controller.save({
    expectedPolicyRevision: policy.revision,
    expectedConfigRevision: before.configRevision,
    settings: {
      ...before.settings,
      connection: { ...before.settings.connection, baseUrl: `${f.baseUrl}/new-target` },
    },
  });
  expect(changed.configSaved).toBe(true);
  expect(changed.view?.credential.available).toBe(false);
  expect(changed.view?.credential.version).not.toBe(before.credential.version);
  expect(changed.view?.appliedRevision).toBeNull();
  await expect(
    f.controller.credential({
      providerRef: QQ_JUDGE_PROVIDER_REF,
      expectedConfigRevision: before.configRevision,
      expectedCredentialVersion: before.credential.version,
      value: KEY,
    }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  await expect(
    f.controller.save({
      expectedPolicyRevision: policy.revision,
      expectedConfigRevision: before.configRevision,
      settings: before.settings,
    }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect((await f.controller.view()).settings.connection.baseUrl).toBe(`${f.baseUrl}/new-target`);
  expect(f.connections.binding(PRIMARY_REF)).toEqual(primary);
  expect(f.requests).toHaveLength(0);
});

it('controller close aborts and joins judge/key work without closing primary', async () => {
  const f = await fixture();
  await f.key();
  const primary = f.connections.binding(PRIMARY_REF);
  const pending = f.hold('judge-model');
  const running = f.controller.judge(await f.context('close'), new AbortController().signal);
  await pending.entered;
  await f.controller.close();
  const result = await running;
  await pending.closed;
  expect(result.decision).toBe(false);
  expect(result.attempt?.cleanup).toBe('settled');
  expect(f.connections.binding(PRIMARY_REF)).toEqual(primary);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect((await f.runtime.state('judgmentUsage', {})).active).toBe(0);
});

it('the native factory enforces the response byte cap without a second request', async () => {
  const f = await fixture();
  f.setReply(200, 'x'.repeat(70000));
  const provider = createQQJudgeNativeProvider(f.baseUrl, KEY);
  await expect(
    provider.respond({ model: 'judge-model', input: [], tools: [] }),
  ).rejects.toMatchObject({
    attempts: [{ purpose: 'generation', outcome: 'failed', status: 200 }],
  });
  expect(f.requests).toHaveLength(1);
});

it('zero history preserves the exact current candidate without reading old observations', async () => {
  const f = await fixture();
  await f.key();
  await f.context('old-window', 'window');
  const current = await f.context('current-window', 'window');
  const reads = vi.spyOn(f.runtime, 'state');
  const result = await f.controller.judge(
    { ...current, contextMessages: 0 },
    new AbortController().signal,
  );
  expect(result.decision).toBe(true);
  const payload = JSON.stringify(f.requests[0]?.body);
  expect(payload).toContain('observation-current-window');
  expect(payload).not.toContain('observation-old-window');
  expect(reads.mock.calls.some(([method]) => method === 'observations')).toBe(false);
});

it('history obeys both the captured message count and age while current stays separate', async () => {
  const f = await fixture();
  await f.key();
  const audience = group('window-limits');
  const now = Date.now();
  for (const [id, text, age] of [
    ['old', 'OLD_HISTORY_NOT_ALLOWED', 5000],
    ['recent-one', 'RECENT_ONE_NOT_SELECTED', 20],
    ['recent-two', 'RECENT_TWO_SELECTED', 10],
  ] as const)
    await f.runtime.state('observe', {
      observation: {
        id,
        audience,
        principalId: 'member',
        observedAt: now - age,
        text,
        quotedText: null,
        materialIds: [],
        fileEvidence: null,
      },
    });
  const current = await f.context('window-candidate', 'window-limits');
  const result = await f.controller.judge(
    { ...current, contextMessages: 1, contextMaxAgeMs: 1000 },
    new AbortController().signal,
  );
  expect(result.decision).toBe(true);
  const payload = JSON.stringify(f.requests[0]?.body);
  expect(payload).toContain('observation-window-candidate');
  expect(payload).toContain('RECENT_TWO_SELECTED');
  expect(payload).not.toContain('RECENT_ONE_NOT_SELECTED');
  expect(payload).not.toContain('OLD_HISTORY_NOT_ALLOWED');
});

it('a candidate without native message or event basis consumes no judgment attempt', async () => {
  const f = await fixture();
  await f.key();
  const current = await f.context('identityless');
  await expect(
    f.controller.judge(
      {
        ...current,
        reference: { eventId: null, messageId: null, occurredAt: null, displayReference: null },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  expect(f.requests).toHaveLength(0);
  expect((await f.controller.view()).admittedAttempts).toBe(0);
});

it('the native factory refuses HTTP redirects instead of forwarding a judgment credential', async () => {
  let requests = 0;
  const server = createServer((incoming, outgoing) => {
    requests++;
    outgoing.writeHead(302, { Location: '/redirected', 'Content-Type': 'text/plain' });
    outgoing.end('redirect');
    incoming.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No redirect fixture port');
  try {
    const provider = createQQJudgeNativeProvider(`http://127.0.0.1:${address.port}/v1`, KEY);
    await expect(
      provider.respond({ model: 'judge-model', input: [], tools: [] }),
    ).rejects.toMatchObject({ attempts: [{ purpose: 'generation' }] });
    expect(requests).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

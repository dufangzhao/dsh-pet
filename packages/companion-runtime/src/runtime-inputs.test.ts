import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { definePlugin, type PluginDefinition, type PluginTask } from '@pet/plugin-sdk';
import type {
  CloudExecutionRequest,
  CloudExecutionResult,
  CloudMaterialSource,
} from '@pet/cloud-exec';
import {
  makeError,
  JSON_MAX_BYTES,
  QQ_GROUP_CONTEXT_MAX_BYTES,
  type QQStatus,
  type CompanionAudience,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
  type PluginManifest,
} from '@pet/contracts';
import { FileConfigStore, KernelFault } from '@pet/host-kernel';
import statePlugin from '@pet/state-sqlite';
import {
  createCorticoPlugin,
  type CorticoHarnessPorts,
  type HarnessInput,
  type HarnessInputBinding,
} from '@pet/harness-cortico';
import { CompanionRuntime } from './runtime.js';
import { CompanionPluginHost, type ServicePluginRegistration } from './plugin-host.js';
import {
  companionHostDefinition,
  companionHostManifest,
  STATE_CAPABILITY,
  EXECUTION_CAPABILITY,
} from './core-plugin.js';
import {
  inputScope,
  checkInputGrant,
  type RuntimeInputGrant,
  type RuntimeInputPorts,
  type RuntimeInputTerminal,
} from './input-authority.js';
import { createFixturePlugin, fixtureManifest } from './fixture-harness.js';
import { memoryCommand } from './persona-memory.js';

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const account = {
  protocol: 'onebot-v11' as const,
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default' as const,
  accountId: '900',
};
function origin(id: string, person = 'alice', group?: string): CompanionInputOrigin {
  const senderId = person === 'alice' ? '101' : '102';
  return {
    kind: 'qq',
    inputId: id,
    principalId: person,
    eventKey: `event-${id}`,
    messageId: '1',
    trigger: 'direct',
    quote: null,
    policyRevision: 1,
    actor: group
      ? { account, scene: 'group', senderId, groupId: group }
      : { account, scene: 'private', senderId },
    audience: group
      ? { kind: 'qq-group', account, groupId: group }
      : { kind: 'person-private', principalId: person },
    route: {
      kind: 'qq',
      account,
      scene: group ? 'group' : 'private',
      targetId: group ?? senderId,
      reference: { eventId: null, messageId: '1', occurredAt: 1000, displayReference: null },
    },
  };
}
function grant(value: CompanionInputOrigin, role: RuntimeInputGrant['role'] = 'member') {
  const controller = new AbortController();
  const policy = { allowed: true };
  const result: RuntimeInputGrant = {
    origin: value,
    role,
    signal: controller.signal,
    check() {
      if (!policy.allowed) throw new KernelFault('permission-denied');
    },
  };
  return { value: result, controller, policy };
}

async function setup(
  deterministic = false,
  cortico = false,
  optionalPluginIds: readonly string[] = [],
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qq-runtime-inputs-'));
  const stateManifest = JSON.parse(
    await readFile(new URL('../../../plugins/state-sqlite/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const nativeManifest = cortico
    ? (JSON.parse(
        await readFile(
          new URL('../../../plugins/harness-cortico/plugin.json', import.meta.url),
          'utf8',
        ),
      ) as PluginManifest)
    : undefined;
  const harnessKey = `pet.input-harness/${cortico ? 'cortico' : 'fixture'}`;
  const controlledManifest: PluginManifest = nativeManifest
    ? { ...nativeManifest, id: 'pet.input-harness' }
    : {
        ...fixtureManifest,
        id: 'pet.input-harness',
        consumes: [STATE_CAPABILITY, EXECUTION_CAPABILITY].map((capability) => ({
          capability,
          optional: true,
        })),
        permissions: [STATE_CAPABILITY, EXECUTION_CAPABILITY].map((capability) => ({
          kind: 'capability-use',
          capability,
        })),
      };
  const executionManifest: PluginManifest = {
    schemaVersion: 1,
    id: 'pet.input-execution',
    version: '0.1.0',
    host: '^1.0.0',
    license: 'MIT',
    displayName: { en: 'Controlled execution' },
    description: { en: 'Authority fixture' },
    platforms: ['linux-x64'],
    entries: { runtime: 'fixture.mjs' },
    provides: [
      {
        id: 'controlled',
        capability: EXECUTION_CAPABILITY,
        features: {
          methodPermissions: {
            execute: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
            reconcile: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
          },
        },
      },
    ],
    permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
  };
  const runtimeRef: { value?: CompanionRuntime } = {};
  let ports: CorticoHarnessPorts | undefined;
  const cleanupErrors: unknown[] = [];
  const requests = new Map<
    string,
    { input: HarnessInput; contextId: string; binding?: HarnessInputBinding; finished: boolean }
  >();
  const jobs: Array<{
    signal: AbortSignal;
    release: () => void;
    task: PluginTask;
    request: CloudExecutionRequest;
    artifacts: CloudExecutionResult['artifacts'];
  }> = [];
  const terminal: RuntimeInputTerminal[] = [];
  const harnessDefinition: PluginDefinition = definePlugin({
    async activate(ctx) {
      const runtime = runtimeRef.value;
      if (!runtime) throw new Error('runtime must exist before Harness activation');
      const profile = await runtime.profile();
      ports = runtime.harnessPorts(harnessKey, profile);
      if (cortico)
        return createCorticoPlugin(
          {
            name: profile.name,
            persona: profile.persona,
            profileRevision: profile.revision,
            mode: 'scripted',
          },
          ports,
        ).activate(ctx);
      if (deterministic) return createFixturePlugin(ports).activate(ctx);
      const captured = ports;
      const initial = await captured.context();
      captured.projectionApplied({
        profileRevision: (await runtime.profile()).revision,
        memoryRevision: initial.memoryRevision,
      });
      ctx.effect(() => async () => {
        for (const request of requests.values()) {
          if (request.finished) continue;
          request.finished = true;
          if (request.binding)
            await request.binding.terminal({
              inputId: request.input.id,
              contextId: request.contextId,
              status: 'cancelled',
              cleanup: 'settled',
              error: makeError('cancelled'),
            });
          else
            await captured.inputRejected(
              request.input.id,
              request.contextId,
              makeError('cancelled'),
            );
        }
        captured.bootstrapRetired();
      });
      ctx.provide('fixture', {
        status: async () => ({ status: 'ready', mode: 'scripted' }),
        accept: async (_task, raw) => {
          const input = raw as unknown as HarnessInput;
          const signal = captured.queueSignal(input.id);
          const request = { input, contextId: `context-${input.id}`, finished: false };
          requests.set(input.id, request);
          signal.addEventListener(
            'abort',
            () => {
              const current = requests.get(input.id);
              if (current && !current.binding && !current.finished) {
                current.finished = true;
                void captured
                  .inputRejected(input.id, current.contextId, makeError('cancelled'))
                  .catch((error: unknown) => cleanupErrors.push(error));
              }
            },
            { once: true },
          );
          return { ok: true, value: null };
        },
        stopForeground: async () => ({ ok: true, value: null }),
      });
      captured.status('ready');
    },
  });
  const execution = definePlugin({
    activate(ctx) {
      ctx.provide('controlled', {
        reconcile: async () => ({ ok: true, value: { receipts: [], nextCursor: null } }),
        execute: async (task, raw) => {
          const hold = deferred();
          const job = {
            signal: task.signal,
            release: hold.resolve,
            task,
            request: raw as unknown as CloudExecutionRequest,
            artifacts: [] as CloudExecutionResult['artifacts'],
          };
          jobs.push(job);
          await hold.promise;
          return {
            ok: true,
            value: {
              jobId: task.taskId,
              status: task.signal.aborted ? 'cancelled' : 'exited',
              exitCode: task.signal.aborted ? null : 0,
              stdout: '',
              stderr: '',
              logsTruncated: false,
              settled: true,
              artifacts: job.artifacts,
              error: null,
            },
          };
        },
      });
    },
  });
  const registrations: ServicePluginRegistration[] = [];
  for (const [manifest, definition] of [
    [companionHostManifest, companionHostDefinition],
    [stateManifest, statePlugin],
    [controlledManifest, harnessDefinition],
    [executionManifest, execution],
    ...optionalPluginIds.map((id): readonly [PluginManifest, PluginDefinition] => [
      { ...executionManifest, id, displayName: { en: id }, provides: [], permissions: [] },
      definePlugin({ activate() {} }),
    ]),
  ] as const) {
    const folder = path.join(directory, manifest.id);
    await mkdir(folder);
    await writeFile(path.join(folder, 'plugin.json'), JSON.stringify(manifest));
    registrations.push({
      manifest,
      definition,
      directory: folder,
      preset: 'allow',
      enabled: manifest !== controlledManifest && !optionalPluginIds.includes(manifest.id),
      ...(manifest === companionHostManifest
        ? {
            protected: true,
            config: {
              name: 'One Agent',
              persona: 'One persona',
              harness: harnessKey,
              disabledPlugins: [],
            },
          }
        : {}),
    });
  }
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'data'),
    plugins: registrations,
  });
  const active = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: stateManifest.id,
    stateProviderId: 'sqlite',
    executionPluginId: executionManifest.id,
    executionProviderId: 'controlled',
    executionTimeoutMs: 30000,
    optionalPluginIds,
  });
  runtimeRef.value = active;
  active.onInputTerminal((value) => {
    terminal.push(value);
  });
  active.setInputPorts({ grantForWorkResult: async (value) => grant(value, 'reply-only').value });
  await active.initialize();
  if (!ports) throw new Error('missing Harness ports');
  const captured = ports;
  cleanups.push(async () => {
    for (const job of jobs) job.release();
    await active.whenWorkSettled();
    await active.close();
    await host.close();
    expect(cleanupErrors).toEqual([]);
  });
  return {
    runtime: active,
    host,
    ports: captured,
    requests,
    jobs,
    terminal,
    directory,
    async external(
      value: CompanionInputOrigin,
      text = 'authored text',
      role: RuntimeInputGrant['role'] = 'member',
    ) {
      if (!value.inputId) throw new Error('fixture requires input id');
      await active.state('createInput', {
        id: value.inputId,
        commandId: `command-${value.inputId}`,
        origin: value,
        evidence: { authoredText: text },
        materialIds: [],
      });
      await active.state('commitInput', { id: value.inputId, text });
      const authority = grant(value, role);
      await active.dispatchReadyInput(value.inputId, authority.value);
      return authority;
    },
    async materialInput(
      value: CompanionInputOrigin,
      bytes: Uint8Array,
      role: RuntimeInputGrant['role'] = 'member',
    ) {
      if (!value.inputId) throw new Error('fixture requires input id');
      const reference: CompanionMaterialRef = {
        id: `file-${value.inputId}`,
        kind: 'file',
        name: 'payload.bin',
        mediaType: 'application/octet-stream',
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        durationMs: null,
        audience: value.audience,
        originInputIds: [value.inputId],
      };
      await active.state('createInput', {
        id: value.inputId,
        commandId: `command-${value.inputId}`,
        origin: value,
        evidence: { authoredText: 'Use the attached binary file' },
        materialIds: [reference.id],
      });
      await mkdir(path.join(directory, 'fixtures'), { recursive: true });
      await writeFile(path.join(directory, 'fixtures', `${reference.id}.bin`), bytes);
      await active.state('putMaterial', {
        id: reference.id,
        inputId: value.inputId,
        observationId: null,
        audience: value.audience,
        storageKey: `fixtures/${reference.id}.bin`,
        phase: 'ready',
        reference,
        cleanup: 'settled',
        error: null,
      });
      await active.state('commitInput', {
        id: value.inputId,
        text: 'Use the attached binary file',
      });
      const authority = grant(value, role);
      await active.dispatchReadyInput(value.inputId, authority.value);
      return { reference, authority };
    },
    async bind(id: string) {
      const request = requests.get(id);
      if (!request) throw new Error('missing queued input');
      captured.bootstrapRetired();
      const binding = await captured.bindInput(request.input, request.contextId);
      request.binding = binding;
      return binding;
    },
    async finish(id: string, cleanup: 'settled' | 'failed' = 'settled') {
      const request = requests.get(id);
      if (!request?.binding) throw new Error('missing bound input');
      await request.binding.terminal({
        inputId: id,
        contextId: request.contextId,
        status: 'completed',
        cleanup,
        error: cleanup === 'failed' ? makeError('unavailable') : null,
      });
      request.finished = true;
      captured.status('ready');
    },
    async fact(key: string, value: string, audience: CompanionAudience) {
      const memory = await active.state('memorySnapshot', { scope: { kind: 'management' } });
      await active.state('rememberFact', {
        commandId: `fact-${memory.memoryRevision}`,
        key,
        value,
        audience,
        expectedMemoryRevision: memory.memoryRevision,
        expectedFactRevision: 0,
        origin: { kind: 'owner-form' },
      });
    },
  };
}
const effect = (inputId: string, id = 'effect-1') => ({ id, inputIds: [inputId], callId: id });
async function historyMessage(
  runtime: CompanionRuntime,
  value: CompanionInputOrigin,
  text: string,
  at: number,
) {
  if (!value.inputId) throw new Error('fixture history needs an ID');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(at);
  try {
    return await runtime.state('appendMessage', {
      id: value.inputId,
      role: 'user',
      text,
      audience: value.audience,
      origins: [value],
    });
  } finally {
    clock.mockRestore();
  }
}
async function historyObservation(
  runtime: CompanionRuntime,
  value: CompanionInputOrigin,
  id: string,
  text: string,
  at: number,
) {
  return runtime.state('observe', {
    observation: {
      id,
      audience: value.audience,
      principalId: value.principalId,
      observedAt: at,
      text,
      quotedText: null,
      materialIds: [],
      fileEvidence: null,
    },
  });
}
async function replyBytes(
  f: Awaited<ReturnType<typeof setup>>,
  value: CompanionInputOrigin,
  bytes: Uint8Array,
  key: string,
  shape: Pick<CompanionMaterialRef, 'kind' | 'name' | 'mediaType' | 'durationMs'>,
): Promise<CompanionMaterialRef> {
  if (!value.inputId) throw new Error('missing current input');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const id = `reply-material-${createHash('sha256')
    .update(JSON.stringify([value.inputId, key, sha256]))
    .digest('hex')
    .slice(0, 48)}`;
  const reference: CompanionMaterialRef = {
    ...shape,
    id,
    sizeBytes: bytes.byteLength,
    sha256,
    audience: value.audience,
    originInputIds: [value.inputId],
  };
  await mkdir(path.join(f.directory, 'reply-materials'), { recursive: true });
  await writeFile(path.join(f.directory, 'reply-materials', id), bytes);
  await f.runtime.state('putMaterial', {
    id,
    inputId: value.inputId,
    observationId: null,
    audience: value.audience,
    storageKey: `reply-materials/${id}`,
    phase: 'ready',
    reference,
    cleanup: 'settled',
    error: null,
  });
  return reference;
}

function binarySource(bytes: Uint8Array, check: () => Promise<void>): CloudMaterialSource {
  return {
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    check,
    chunks: {
      async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < bytes.byteLength; offset += 8192) {
          await check();
          yield bytes.subarray(offset, offset + 8192);
        }
      },
    },
  };
}

it('keeps owner bootstrap real and binds only admitted inputs with a single durable claim', async () => {
  const f = await setup();
  expect((await f.runtime.snapshot()).agent.profileApplication?.appliedRevision).not.toBeNull();
  await expect(
    f.ports.bindInput({ id: 'forged', kind: 'user', text: 'hello' }, 'forged-context'),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    f.ports.publish({ id: 'forged', inputIds: ['forged'], text: 'owner fallback' }),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const value = origin('alice-ready');
  const authority = await f.external(value);
  expect(
    (await f.runtime.state('getInput', { id: 'alice-ready', scope: inputScope(value) })).phase,
  ).toBe('ready');
  expect(await f.runtime.dispatchReadyInput('alice-ready', authority.value)).toEqual({
    queued: false,
  });
  const bound = await f.bind('alice-ready');
  expect(bound.role).toBe('member');
  await expect(f.ports.context()).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(
    (await f.runtime.state('getInput', { id: 'alice-ready', scope: inputScope(value) })).phase,
  ).toBe('active');
  expect((await f.runtime.snapshot()).agent.profileApplication?.appliedRevision).toBeNull();
  await f.finish('alice-ready');
  expect(f.terminal[0]?.admission.phase).toBe('completed');
  expect(await f.runtime.dispatchReadyInput('alice-ready', authority.value)).toEqual({
    queued: false,
  });
});

it('filters private/group canaries before context and shares only public facts', async () => {
  const f = await setup();
  await f.fact('private', 'OWNER_CANARY', { kind: 'owner-private' });
  await f.fact('shared', 'PUBLIC_FACT', { kind: 'public' });
  await f.fact('private', 'ALICE_CANARY', origin('x').audience);
  await f.fact('private', 'BOB_CANARY', origin('x', 'bob').audience);
  await f.fact('group', 'GROUP_A_CANARY', origin('x', 'alice', '201').audience);
  await f.fact('group', 'GROUP_B_CANARY', origin('x', 'alice', '202').audience);
  const inputs = [
    origin('private-a'),
    origin('private-b', 'bob'),
    origin('group-a', 'alice', '201'),
    origin('group-b', 'alice', '202'),
  ];
  for (const item of inputs) await f.external(item);
  const contexts = [];
  for (const item of inputs) {
    if (!item.inputId) throw new Error('missing fixture id');
    contexts.push(JSON.stringify(await (await f.bind(item.inputId)).ports.context()));
  }
  expect(contexts[0]).toContain('ALICE_CANARY');
  expect(contexts[1]).toContain('BOB_CANARY');
  expect(contexts[2]).toContain('GROUP_A_CANARY');
  expect(contexts[3]).toContain('GROUP_B_CANARY');
  for (const [index, context] of contexts.entries()) {
    expect(context).toContain('PUBLIC_FACT');
    expect(context).not.toContain('OWNER_CANARY');
    for (const [other, marker] of [
      'ALICE_CANARY',
      'BOB_CANARY',
      'GROUP_A_CANARY',
      'GROUP_B_CANARY',
    ].entries())
      if (other !== index) expect(context).not.toContain(marker);
  }
});

it('denies member facts, grounds admin memory in authored text and keys CAS by audience', async () => {
  const f = await setup();
  await f.fact('language', 'public-value', { kind: 'public' });
  await f.external(origin('member'), 'remember language: Chinese');
  const member = await f.bind('member');
  await expect(
    member.ports.rememberFact('language', 'Chinese', effect('member')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const quoted = {
    ...origin('admin', 'alice', '201'),
    quote: {
      reference: { eventId: null, messageId: '2', occurredAt: null, displayReference: null },
      quotedText: 'remember secret: QUOTED_ONLY',
    },
  } as CompanionInputOrigin;
  await f.external(quoted, 'remember language: Chinese', 'admin');
  const admin = await f.bind('admin');
  await expect(
    admin.ports.rememberFact('secret', 'QUOTED_ONLY', effect('admin')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const saved = await admin.ports.rememberFact('language', 'Chinese', effect('admin'));
  expect(saved.receipt.status).toBe('accepted');
  const memory = await f.runtime.state('memorySnapshot', { scope: { kind: 'management' } });
  expect(memory.facts.filter((fact) => fact.key === 'language')).toHaveLength(2);
  expect(memory.facts.find((fact) => fact.value === 'Chinese')?.audience).toEqual(quoted.audience);
});

it('permits multiple own jobs, denies other-member stops, and routes results to the originating audience', async () => {
  const f = await setup();
  const aliceOrigin = origin('alice-work', 'alice', '201');
  await f.external(aliceOrigin);
  const alice = await f.bind('alice-work');
  const first = await alice.ports.startWork(
    { title: 'one', code: '1' },
    effect('alice-work', 'one'),
  );
  const second = await alice.ports.startWork(
    { title: 'two', code: '2' },
    effect('alice-work', 'two'),
  );
  expect(first.taskId).not.toBe(second.taskId);
  await vi.waitFor(() => expect(f.jobs).toHaveLength(2));
  await f.external(origin('bob-work', 'bob', '201'));
  const bob = await f.bind('bob-work');
  expect((await bob.ports.context()).tasks).toHaveLength(0);
  if (!first.taskId) throw new Error('missing accepted task');
  await expect(bob.ports.stopWork(first.taskId, effect('bob-work'))).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(f.jobs.every((job) => !job.signal.aborted)).toBe(true);
  if (!second.taskId) throw new Error('missing second accepted task');
  await alice.ports.stopWork(second.taskId, effect('alice-work', 'stop-own'));
  expect(
    (await f.runtime.state('getTask', { id: second.taskId, scope: inputScope(aliceOrigin) }))
      .status,
  ).toBe('cancel-requested');
  expect(f.jobs.filter((job) => job.signal.aborted)).toHaveLength(1);
  await f.finish('alice-work');
  expect(f.jobs.filter((job) => !job.signal.aborted)).toHaveLength(1);
  for (const job of f.jobs) job.release();
  await f.runtime.whenWorkSettled();
  const task = await f.runtime.state('getTask', {
    id: first.taskId,
    scope: inputScope(aliceOrigin),
  });
  expect(task.origin?.inputId).toBe('alice-work');
  const resultId = `work-event-${task.executionId}`;
  const result = await f.bind(resultId);
  expect(result.role).toBe('reply-only');
  expect(result.origin.audience).toEqual(aliceOrigin.audience);
  await expect(
    result.ports.startWork({ title: 'forbidden', code: '3' }, effect(resultId)),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await result.ports.publish({
    id: 'result-reply',
    inputIds: [resultId],
    taskId: first.taskId,
    text: 'complete',
  });
  await f.finish(resultId);
  expect(f.terminal.find((event) => event.admission.id === resultId)?.outputs[0]?.origins).toEqual([
    result.origin,
  ]);
});

it.each(['inputs', 'work'] as const)(
  'parallel authority snapshots catch deny then restore across %s without waiting for the first grant',
  async (mode) => {
    const f = await setup();
    const firstOrigin = origin('check-first');
    const secondOrigin = origin('check-second', 'bob');
    const firstController = new AbortController(),
      secondController = new AbortController();
    const gate = deferred();
    const checks: string[] = [];
    let blockFirst = false,
      secondAllowed = true;
    const first: RuntimeInputGrant = {
      origin: firstOrigin,
      role: 'member',
      signal: firstController.signal,
      check: () => {
        checks.push('first');
        return blockFirst ? gate.promise : undefined;
      },
    };
    const second: RuntimeInputGrant = {
      origin: secondOrigin,
      role: 'member',
      signal: secondController.signal,
      check: () => {
        checks.push('second');
        if (!secondAllowed) secondController.abort();
        if (secondController.signal.aborted) throw new KernelFault('permission-denied');
      },
    };
    f.runtime.setInputPorts({
      grantForWorkResult: async (value) => ({ ...second, origin: value, role: 'reply-only' }),
    });
    for (const current of [first, second]) {
      const id = current.origin.inputId;
      if (!id) throw new Error('fixture requires input id');
      await f.runtime.state('createInput', {
        id,
        commandId: `command-${id}`,
        origin: current.origin,
        evidence: { fixture: 'captured QQ grant' },
        materialIds: [],
      });
      await f.runtime.state('commitInput', { id, text: 'Create authorized work.' });
      await f.runtime.dispatchReadyInput(id, current);
    }
    if (mode === 'work') {
      const bound = await f.bind('check-second');
      await bound.ports.startWork(
        { title: 'Sticky policy work', code: '1' },
        effect('check-second'),
      );
      await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
      await f.finish('check-second');
      expect(second.signal.aborted).toBe(false);
    }
    checks.length = 0;
    blockFirst = true;
    secondAllowed = false;
    let settled = false;
    const checking = f.runtime.recheckInputAuthorities().then(() => {
      settled = true;
    });
    // No await: restoration happens in the same turn, while the first grant remains gated.
    secondAllowed = true;
    try {
      expect(checks).toEqual(['first', 'second']);
      expect(first.signal.aborted).toBe(false);
      expect(second.signal.aborted).toBe(true);
      expect(settled).toBe(false);
      if (mode === 'work') expect(f.jobs[0]?.signal.aborted).toBe(true);
      await expect(checkInputGrant(second)).rejects.toMatchObject({
        error: { code: 'permission-denied' },
      });
    } finally {
      gate.resolve();
      await checking;
      for (const job of f.jobs) job.release();
      await f.runtime.whenWorkSettled();
    }
    if (mode === 'inputs')
      await vi.waitFor(() =>
        expect(
          f.terminal.some(
            (event) =>
              event.admission.id === 'check-second' && event.admission.phase === 'cancelled',
          ),
        ).toBe(true),
      );
  },
);

it('fresh policy checks fence awaited reads and revoke running work without treating input completion as revocation', async () => {
  const f = await setup();
  const authority = await f.external(origin('policy'));
  const binding = await f.bind('policy');
  await binding.ports.startWork({ title: 'policy work', code: '1' }, effect('policy'));
  await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
  await f.runtime.recheckInputAuthorities();
  expect(f.jobs[0]?.signal.aborted).toBe(false);
  const entered = deferred(),
    release = deferred();
  const original = f.host.call.bind(f.host);
  const spy = vi.spyOn(f.host, 'call').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === STATE_CAPABILITY && args[1] === 'snapshot') {
      entered.resolve();
      await release.promise;
    }
    return result;
  });
  const reading = binding.ports.context();
  const rejected = expect(reading).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await entered.promise;
  authority.policy.allowed = false;
  release.resolve();
  await rejected;
  spy.mockRestore();
  await f.runtime.recheckInputAuthorities();
  expect(binding.signal.aborted).toBe(true);
  expect(f.jobs[0]?.signal.aborted).toBe(true);
});

it('preserves complete long text as an exact scoped material and rejects unavailable or wrong material storage', async () => {
  const f = await setup();
  await f.external(origin('large'));
  const binding = await f.bind('large');
  const text = '完整内容'.repeat(3000);
  await expect(
    binding.ports.publish({ id: 'large-output', inputIds: ['large'], text }),
  ).rejects.toMatchObject({ error: { code: 'not-ready' } });
  // Host ports are installed before live input in production; this test creates another isolated fixture below.
  await f.finish('large');
  const g = await setup();
  g.runtime.setInputPorts({
    storeFullText: async (output, access) => {
      await access.check();
      if (!output.origin.inputId) throw new Error('missing input identity');
      const reference = {
        id: `text-${output.id}`,
        kind: 'text' as const,
        name: 'reply.txt',
        mediaType: 'text/plain',
        sizeBytes: Buffer.byteLength(output.text),
        sha256: createHash('sha256').update(output.text).digest('hex'),
        durationMs: null,
        audience: output.origin.audience,
        originInputIds: [output.origin.inputId],
      };
      if (output.id === 'wrong-output') return { ...reference, sha256: '0'.repeat(64) };
      await mkdir(path.join(g.directory, 'controlled-materials'), { recursive: true });
      await writeFile(
        path.join(g.directory, 'controlled-materials', `${output.id}.txt`),
        output.text,
        'utf8',
      );
      await g.runtime.state('putMaterial', {
        id: reference.id,
        inputId: output.origin.inputId,
        observationId: null,
        audience: reference.audience,
        storageKey: `controlled-materials/${output.id}.txt`,
        phase: 'ready',
        reference,
        cleanup: 'settled',
        error: null,
      });
      return reference;
    },
  });
  await g.external(origin('stored-large'));
  const stored = await g.bind('stored-large');
  await expect(
    stored.ports.publish({ id: 'wrong-output', inputIds: ['stored-large'], text }),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  await expect(
    stored.ports.publish({
      id: 'oversized-output',
      inputIds: ['stored-large'],
      text: 'x'.repeat(65537),
    }),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  await stored.ports.publish({ id: 'stored-output', inputIds: ['stored-large'], text });
  await g.finish('stored-large');
  const published = g.terminal[0]?.outputs[0];
  expect(published?.content?.kind).toBe('text-document');
  expect(published?.materials?.[0]?.sha256).toBe(createHash('sha256').update(text).digest('hex'));
  expect(published?.text).not.toContain(text.slice(0, 30));
  expect(
    await readFile(path.join(g.directory, 'controlled-materials', 'stored-output.txt'), 'utf8'),
  ).toBe(text);
  const base = origin('provenance-budget');
  if (base.kind !== 'qq') throw new Error('wrong fixture origin');
  const rich: CompanionInputOrigin = {
    ...base,
    quote: {
      reference: { eventId: null, messageId: '2', occurredAt: null, displayReference: null },
      quotedText: '引'.repeat(2048),
    },
  };
  await g.external(rich);
  const richBinding = await g.bind('provenance-budget');
  const complete = '字'.repeat(8000);
  const richOutput = { id: 'rich-output', inputIds: ['provenance-budget'], text: complete };
  await richBinding.ports.publish(richOutput);
  await richBinding.ports.publish(richOutput);
  await g.finish('provenance-budget');
  const result = g.terminal.find((event) => event.admission.id === 'provenance-budget');
  expect(result?.outputs).toHaveLength(1);
  expect(result?.outputs[0]?.content?.kind).toBe('text-document');
  expect(
    await readFile(path.join(g.directory, 'controlled-materials', 'rich-output.txt'), 'utf8'),
  ).toBe(complete);
});

it('cancels queued grants without claiming and records cleanup after the Harness source becomes inactive', async () => {
  const f = await setup();
  const authority = await f.external(origin('queued-revoke'));
  authority.policy.allowed = false;
  await f.runtime.recheckInputAuthorities();
  await vi.waitFor(() => expect(f.terminal).toHaveLength(1));
  expect(f.terminal[0]?.admission.phase).toBe('cancelled');
  expect(f.requests.get('queued-revoke')?.binding).toBeUndefined();
  await f.external(origin('queued-dispose', 'bob'));
  await f.host.setEnabled('pet.input-harness', false);
  expect(
    f.terminal.find((event) => event.admission.id === 'queued-dispose')?.admission,
  ).toMatchObject({ phase: 'cancelled', cleanup: 'settled' });
});

it('does not reclaim or overwrite an already active admission and preserves unconfirmed cleanup', async () => {
  const f = await setup();
  const value = origin('already-claimed');
  await f.external(value);
  await f.runtime.state('claimInput', { id: 'already-claimed' });
  await expect(f.bind('already-claimed')).rejects.toMatchObject({ error: { code: 'conflict' } });
  await f.ports.inputRejected('already-claimed', 'context-already-claimed', makeError('conflict'));
  const stale = f.requests.get('already-claimed');
  if (stale) stale.finished = true;
  expect(
    (await f.runtime.state('getInput', { id: 'already-claimed', scope: inputScope(value) })).phase,
  ).toBe('active');
  const other = await f.external(origin('cleanup-failed', 'bob'));
  await f.bind('cleanup-failed');
  await f.finish('cleanup-failed', 'failed');
  expect(f.terminal[0]?.admission).toMatchObject({ phase: 'unknown', cleanup: 'failed' });
  expect(await f.runtime.dispatchReadyInput('cleanup-failed', other.value)).toEqual({
    queued: false,
  });
  await expect(f.runtime.withModelControl(async () => null)).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
});

it('direct owner tasks need no invented chat input and result ingress stays owner-private', async () => {
  const f = await setup(true);
  const receipt = await f.runtime.startTask({
    commandId: 'direct-owner-task',
    title: 'Owner work',
    code: '1',
  });
  if (!receipt.taskId) throw new Error('missing owner task');
  const task = await f.runtime.state('getTask', { id: receipt.taskId });
  expect(task.origin).toMatchObject({
    inputId: null,
    principalId: 'owner',
    origins: [],
    audience: { kind: 'owner-private' },
  });
  await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
  f.jobs[0]?.release();
  await f.runtime.whenWorkSettled();
  await vi.waitFor(() => expect(f.terminal).toHaveLength(1));
  expect(f.terminal[0]?.admission.origin).toMatchObject({
    kind: 'work-result',
    initiatingInputId: null,
    audience: { kind: 'owner-private' },
    route: { kind: 'owner-private' },
  });
});

it('owner management mutates scope plus key without changing omitted-scope fingerprints', async () => {
  const f = await setup();
  await f.fact('same-key', 'public', { kind: 'public' });
  const command = {
    commandId: 'owner-private-memory',
    key: 'same-key',
    value: 'private',
    expectedMemoryRevision: 1,
    expectedFactRevision: 0,
  };
  expect((await f.runtime.upsertFact(command)).receipt.status).toBe('accepted');
  expect((await f.runtime.upsertFact(command)).receipt.status).toBe('duplicate');
  const memory = await f.runtime.memoryView();
  expect(memory.facts.filter((fact) => fact.key === 'same-key')).toHaveLength(2);
  await f.runtime.forgetFact({
    commandId: 'forget-public-only',
    key: 'same-key',
    expectedMemoryRevision: 2,
    expectedFactRevision: 1,
    audience: { kind: 'public' },
  });
  expect((await f.runtime.memoryView()).facts.map((fact) => fact.value)).toEqual(['private']);
});

it('proactive origin metadata never grants user actions or administrator memory writes', async () => {
  const f = await setup();
  const group = origin('proactive', 'alice', '201');
  const value: CompanionInputOrigin = {
    kind: 'qq-proactive',
    inputId: 'proactive',
    principalId: null,
    audience: group.audience,
    route: group.route,
    account,
    policyRevision: 1,
    eventKey: 'proactive-event',
  };
  await f.external(value, 'A group observation', 'reply-only');
  const binding = await f.bind('proactive');
  expect(binding.role).toBe('reply-only');
  await expect(
    binding.ports.startWork({ title: 'not authorized', code: '1' }, effect('proactive')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    binding.ports.rememberFact('x', 'observation', effect('proactive')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await binding.ports.publish({
    id: 'proactive-reply',
    inputIds: ['proactive'],
    text: 'A permitted reply',
  });
  await f.finish('proactive');
  expect(f.terminal[0]?.outputs[0]?.origins).toEqual([value]);
});

it('wires real Cortico contexts through scoped runtime grants and persists their actual terminal outputs', async () => {
  const f = await setup(false, true);
  await f.fact('preference', 'ALICE_NATIVE_CANARY', origin('native-a').audience);
  await f.fact('preference', 'BOB_NATIVE_CANARY', origin('native-b', 'bob').audience);
  await Promise.all([
    f.external(origin('native-a'), '我的偏好是什么'),
    f.external(origin('native-b', 'bob'), '我的偏好是什么'),
  ]);
  await vi.waitFor(() => expect(f.terminal).toHaveLength(2), { timeout: 5000 });
  const alice = f.terminal.find((event) => event.admission.id === 'native-a');
  const bob = f.terminal.find((event) => event.admission.id === 'native-b');
  expect(alice?.admission).toMatchObject({ phase: 'completed', cleanup: 'settled' });
  expect(bob?.admission).toMatchObject({ phase: 'completed', cleanup: 'settled' });
  expect(alice?.outputs[0]?.text).toContain('ALICE_NATIVE_CANARY');
  expect(alice?.outputs[0]?.text).not.toContain('BOB_NATIVE_CANARY');
  expect(bob?.outputs[0]?.text).toContain('BOB_NATIVE_CANARY');
  expect(bob?.outputs[0]?.text).not.toContain('ALICE_NATIVE_CANARY');
  expect(alice?.outputs[0]?.origins).toEqual([origin('native-a')]);
  expect(bob?.outputs[0]?.origins).toEqual([origin('native-b', 'bob')]);
});

it('binary work material reads require the real supervisor handle and survive foreground retirement', async () => {
  const f = await setup();
  const bytes = Buffer.alloc(32768, 0xaf);
  bytes[0] = 0;
  const original: NonNullable<RuntimeInputPorts['readWorkMaterial']> = async (
    _request,
    access,
    consume,
  ) => {
    await access.check();
    await consume(binarySource(bytes, access.check));
    return { ok: true, value: null };
  };
  const reader = vi.fn(original);
  const media: RuntimeInputPorts = {
    prepareWork: async (_input, request) => request,
    readWorkMaterial: reader,
  };
  f.runtime.setInputPorts(media);
  const { reference } = await f.materialInput(origin('binary-work'), bytes);
  const binding = await f.bind('binary-work');
  const selection = { materialId: reference.id, inputName: 'inputs/payload.bin' };
  const receipt = await binding.ports.startWork(
    { title: 'binary task', code: '1', materials: [selection] },
    effect('binary-work'),
  );
  await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
  const job = f.jobs[0];
  if (!job?.request.executionId || !receipt.taskId) throw new Error('missing actual execution');
  expect(job.request.materials).toEqual([selection]);
  expect(job.request.files).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(job.request))).toBeLessThan(1024);
  expect(
    (
      await f.runtime.state('getTask', {
        id: receipt.taskId,
        scope: inputScope(origin('binary-work')),
      })
    ).origin?.materialIds,
  ).toEqual([reference.id]);
  const readRequest = { task: job.task, executionId: job.request.executionId, selection };
  const sink = vi.fn(async (_source: CloudMaterialSource) => {});
  expect(
    await f.runtime.readWorkMaterial(
      { ...readRequest, task: { ...job.task, taskId: 'wrong-supervisor-task' } },
      sink,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(
    await f.runtime.readWorkMaterial({ ...readRequest, executionId: 'wrong-execution' }, sink),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(
    await f.runtime.readWorkMaterial(
      { ...readRequest, selection: { ...selection, inputName: 'different.bin' } },
      sink,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(reader).not.toHaveBeenCalled();
  expect(sink).not.toHaveBeenCalled();
  const replacement = vi.fn<NonNullable<RuntimeInputPorts['readWorkMaterial']>>(async () => ({
    ok: false,
    error: makeError('unavailable'),
  }));
  media.readWorkMaterial = replacement;
  expect(
    (
      await binding.ports.startWork(
        { title: 'binary task', code: '1', materials: [selection] },
        effect('binary-work'),
      )
    ).status,
  ).toBe('duplicate');
  await expect(
    binding.ports.startWork(
      { title: 'binary task', code: '1', materials: [{ ...selection, inputName: 'changed.bin' }] },
      effect('binary-work'),
    ),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect(f.jobs).toHaveLength(1);
  await f.finish('binary-work');
  await f.runtime.setPlugin('pet.input-harness', false, 'retire-material-foreground');
  expect(binding.signal.aborted).toBe(true);
  expect(job.signal.aborted).toBe(false);
  const chunks: Uint8Array[] = [];
  expect(
    await f.runtime.readWorkMaterial(readRequest, async (source) => {
      for await (const chunk of source.chunks) {
        await source.check();
        chunks.push(Buffer.from(chunk));
      }
    }),
  ).toEqual({ ok: true, value: null });
  expect(Buffer.concat(chunks)).toEqual(bytes);
  expect(reader).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
  job.release();
  await f.runtime.whenWorkSettled();
  expect(await f.runtime.readWorkMaterial(readRequest, sink)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  const publicCommand = {
    commandId: 'forged-public-material-task',
    title: 'not public',
    code: '1',
    materials: [selection],
  };
  await expect(f.runtime.startTask(publicCommand)).rejects.toMatchObject({
    error: { code: 'invalid-input' },
  });
});

it('binary work material reads join consume and fence policy revocation during its await', async () => {
  const f = await setup();
  const bytes = new Uint8Array([0, 255, 128, 42]);
  const entered = deferred(),
    released = deferred();
  f.runtime.setInputPorts({
    prepareWork: async (_input, request) => request,
    readWorkMaterial: async (_request, access, consume) => {
      // Deliberately broken injected producer: runtime must still retain and await consume.
      void consume(binarySource(bytes, access.check)).catch(() => {});
      return { ok: true, value: null };
    },
  });
  const { reference, authority } = await f.materialInput(origin('binary-revoke'), bytes);
  const binding = await f.bind('binary-revoke');
  const selection = { materialId: reference.id, inputName: 'payload.bin' };
  await binding.ports.startWork(
    { title: 'revocable binary task', code: '1', materials: [selection] },
    effect('binary-revoke'),
  );
  await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
  const job = f.jobs[0];
  if (!job?.request.executionId) throw new Error('missing execution');
  let settled = false;
  const reading = f.runtime
    .readWorkMaterial(
      { task: job.task, executionId: job.request.executionId, selection },
      async (source) => {
        entered.resolve();
        await released.promise;
        await source.check();
      },
    )
    .then((value) => {
      settled = true;
      return value;
    });
  await entered.promise;
  expect(settled).toBe(false);
  authority.policy.allowed = false;
  await f.runtime.recheckInputAuthorities();
  expect(job.signal.aborted).toBe(true);
  expect(settled).toBe(false);
  released.resolve();
  expect(await reading).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  job.release();
  await f.runtime.whenWorkSettled();
});

it('binary work material reads reject foreign materials, changed metadata and released sources before consuming', async () => {
  const f = await setup();
  const bytes = new Uint8Array([1, 0, 255]);
  let behavior: 'metadata' | 'missing' | 'twice' = 'metadata';
  const reader = vi.fn<NonNullable<RuntimeInputPorts['readWorkMaterial']>>(
    async (_request, access, consume) => {
      if (behavior === 'missing') return { ok: true, value: null };
      const source = binarySource(bytes, access.check);
      await consume(behavior === 'metadata' ? { ...source, sha256: '0'.repeat(64) } : source);
      if (behavior === 'twice') await consume(source).catch(() => {});
      return { ok: true, value: null };
    },
  );
  f.runtime.setInputPorts({
    prepareWork: async (_input, request) => request,
    readWorkMaterial: reader,
  });
  const alice = await f.materialInput(origin('binary-alice'), bytes);
  const bob = await f.materialInput(origin('binary-bob', 'bob'), bytes);
  const binding = await f.bind('binary-alice');
  await expect(
    binding.ports.startWork(
      {
        title: 'foreign',
        code: '1',
        materials: [{ materialId: bob.reference.id, inputName: 'foreign.bin' }],
      },
      effect('binary-alice', 'foreign'),
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(f.jobs).toHaveLength(0);
  const selection = { materialId: alice.reference.id, inputName: 'own.bin' };
  await binding.ports.startWork(
    { title: 'own', code: '1', materials: [selection] },
    effect('binary-alice', 'own'),
  );
  await vi.waitFor(() => expect(f.jobs).toHaveLength(1));
  const job = f.jobs[0];
  if (!job?.request.executionId) throw new Error('missing execution');
  const request = { task: job.task, executionId: job.request.executionId, selection };
  const sink = vi.fn(async (_source: CloudMaterialSource) => {});
  expect(await f.runtime.readWorkMaterial(request, sink)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(sink).not.toHaveBeenCalled();
  behavior = 'missing';
  expect(await f.runtime.readWorkMaterial(request, sink)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(sink).not.toHaveBeenCalled();
  behavior = 'twice';
  expect(await f.runtime.readWorkMaterial(request, sink)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(sink).toHaveBeenCalledTimes(1);
  const stored = await f.runtime.state('getMaterial', {
    id: alice.reference.id,
    scope: inputScope(origin('binary-alice')),
  });
  await f.runtime.state('putMaterial', { ...stored, phase: 'released', storageKey: null });
  expect(await f.runtime.readWorkMaterial(request, sink)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  expect(reader).toHaveBeenCalledTimes(3);
});

it('terminal sender events retain the captured policy grant after the input signal is aborted', async () => {
  const f = await setup();
  const value = origin('sender-grant');
  const authority = await f.external(value);
  const binding = await f.bind('sender-grant');
  await binding.ports.publish({
    id: 'sender-text',
    inputIds: ['sender-grant'],
    text: 'A complete reply.',
  });
  await f.finish('sender-grant');
  const event = f.terminal[0];
  if (!event) throw new Error('missing terminal event');
  expect(binding.signal.aborted).toBe(true);
  expect(event.grant.signal).toBe(authority.controller.signal);
  expect(event.grant.signal.aborted).toBe(false);
  Reflect.set(authority.value, 'role', 'admin');
  expect(event.grant.role).toBe('member');
  await checkInputGrant(event.grant);
  const snapshot = await f.runtime.state('snapshot', { scope: inputScope(value) });
  const events = await f.runtime.state('events', {
    after: 0,
    epoch: snapshot.epoch,
    scope: inputScope(value),
  });
  expect(JSON.stringify({ snapshot, events })).not.toContain('"grant":');
  authority.policy.allowed = false;
  await expect(checkInputGrant(event.grant)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
});

it('reply material attachments are resolved from real scoped bytes and retain the complete text document', async () => {
  const f = await setup();
  const resolver = vi.fn<NonNullable<RuntimeInputPorts['resolveReplyAttachment']>>(
    async (selection, value, access) => {
      expect(selection.kind).toBe('material');
      const stored = await f.runtime.state('getMaterial', {
        id: selection.id,
        scope: access.scope,
      });
      if (!stored.reference || !stored.storageKey) throw new Error('missing source bytes');
      const bytes = await readFile(path.join(f.directory, stored.storageKey));
      await access.check();
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(stored.reference.sha256);
      return replyBytes(f, value, bytes, selection.id, stored.reference);
    },
  );
  f.runtime.setInputPorts({
    resolveReplyAttachment: resolver,
    storeFullText: async (output, access) => {
      await access.check();
      return replyBytes(f, output.origin, Buffer.from(output.text, 'utf8'), output.id, {
        kind: 'text',
        name: 'complete.txt',
        mediaType: 'text/plain',
        durationMs: null,
      });
    },
  });
  const bytes = new Uint8Array([0, 255, 3, 9]);
  const material = await f.materialInput(origin('previous-material'), bytes);
  await f.bind('previous-material');
  await f.finish('previous-material');
  await f.external(origin('attachment-reply'), 'Send my visible file.');
  const binding = await f.bind('attachment-reply');
  const text = '完整正文'.repeat(3000);
  const output = {
    id: 'with-document-and-file',
    inputIds: ['attachment-reply'],
    text,
    attachments: [{ kind: 'material' as const, id: material.reference.id }],
  };
  await binding.ports.publish(output);
  await binding.ports.publish(output);
  await f.finish('attachment-reply');
  const published = f.terminal.find((event) => event.admission.id === 'attachment-reply')?.outputs;
  expect(published).toHaveLength(1);
  const message = published?.[0];
  expect(message?.content?.kind).toBe('text-document');
  expect(message?.materials).toHaveLength(2);
  if (message?.content?.kind !== 'text-document') throw new Error('missing complete text');
  expect(message.materials?.[0]).toEqual(message.content.material);
  for (const reference of message.materials ?? []) {
    expect(reference.originInputIds).toEqual(['attachment-reply']);
    const stored = await f.runtime.state('getMaterial', {
      id: reference.id,
      scope: inputScope(origin('attachment-reply')),
    });
    if (!stored.storageKey) throw new Error('missing reply bytes');
    const actual = await readFile(path.join(f.directory, stored.storageKey));
    expect(actual).toEqual(reference.kind === 'text' ? Buffer.from(text) : Buffer.from(bytes));
  }
});

it('reply-only work results send only their completed own visible artifacts', async () => {
  const f = await setup();
  const resolver = vi.fn<NonNullable<RuntimeInputPorts['resolveReplyAttachment']>>(
    async (selection, value, access) => {
      const artifact = await f.runtime.state('getArtifact', {
        id: selection.id,
        scope: access.scope,
      });
      const bytes = await readFile(path.join(f.directory, artifact.relativePath));
      await access.check();
      expect(bytes.byteLength).toBe(artifact.sizeBytes);
      return replyBytes(f, value, bytes, selection.id, {
        kind: 'file',
        name: artifact.name,
        mediaType: artifact.mediaType,
        durationMs: null,
      });
    },
  );
  f.runtime.setInputPorts({
    resolveReplyAttachment: resolver,
    grantForWorkResult: async (value) => grant(value, 'reply-only').value,
  });
  const aliceOrigin = origin('artifact-alice', 'alice', '201');
  const bobOrigin = origin('artifact-bob', 'bob', '201');
  await f.external(aliceOrigin);
  await f.external(bobOrigin);
  const alice = await f.bind('artifact-alice'),
    bob = await f.bind('artifact-bob');
  const a = await alice.ports.startWork(
    { title: 'Alice artifact', code: '1' },
    effect('artifact-alice', 'first'),
  );
  const a2 = await alice.ports.startWork(
    { title: 'Other Alice artifact', code: '2' },
    effect('artifact-alice', 'second'),
  );
  const b = await bob.ports.startWork({ title: 'Bob artifact', code: '3' }, effect('artifact-bob'));
  await vi.waitFor(() => expect(f.jobs).toHaveLength(3));
  await mkdir(path.join(f.directory, 'artifact-bytes'), { recursive: true });
  for (const [index, job] of f.jobs.entries()) {
    const relativePath = `artifact-bytes/${index}.bin`;
    await writeFile(path.join(f.directory, relativePath), new Uint8Array([index, 0, 255]));
    job.artifacts = [
      { path: `${index}.bin`, relativePath, mediaType: 'application/octet-stream', sizeBytes: 3 },
    ];
  }
  await f.finish('artifact-alice');
  await f.finish('artifact-bob');
  for (const job of f.jobs) job.release();
  await f.runtime.whenWorkSettled();
  if (!a.taskId || !a2.taskId || !b.taskId) throw new Error('missing tasks');
  const task = await f.runtime.state('getTask', { id: a.taskId, scope: inputScope(aliceOrigin) });
  const other = await f.runtime.state('getTask', { id: a2.taskId, scope: inputScope(aliceOrigin) });
  const foreign = await f.runtime.state('getTask', { id: b.taskId, scope: inputScope(bobOrigin) });
  const artifact = task.artifacts[0],
    otherArtifact = other.artifacts[0],
    foreignArtifact = foreign.artifacts[0];
  if (!artifact || !otherArtifact || !foreignArtifact) throw new Error('missing actual artifacts');
  const id = `work-event-${task.executionId}`;
  const result = await f.bind(id);
  expect(result.role).toBe('reply-only');
  const output = {
    id: 'artifact-reply',
    text: 'The file is attached.',
    inputIds: [id],
    taskId: task.id,
  };
  for (const denied of [otherArtifact, foreignArtifact])
    await expect(
      result.ports.publish({ ...output, attachments: [{ kind: 'artifact', id: denied.id }] }),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(resolver).not.toHaveBeenCalled();
  await result.ports.publish({ ...output, attachments: [{ kind: 'artifact', id: artifact.id }] });
  await expect(
    result.ports.startWork({ title: 'not granted', code: '4' }, effect(id)),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await f.finish(id);
  expect(f.terminal.find((event) => event.admission.id === id)?.outputs[0]?.materials).toHaveLength(
    1,
  );
  expect(resolver).toHaveBeenCalledTimes(1);
});

it('current group material IDs and quoted-ASR notices survive zero history without granting memory cues', async () => {
  const f = await setup();
  const window = { maxMessages: 0, maxAgeMs: 60000 };
  f.runtime.setInputPorts({ conversationWindow: () => window });
  await historyMessage(
    f.runtime,
    origin('older-reference-context', 'alice', '201'),
    'OLDER_GROUP_HISTORY',
    Date.now() - 5000,
  );
  const base = origin('current-metadata', 'alice', '201');
  if (base.kind !== 'qq') throw new Error('wrong origin');
  const value: CompanionInputOrigin = {
    ...base,
    quote: {
      reference: { eventId: null, messageId: '2', occurredAt: null, displayReference: null },
      quotedText: '记住 QUOTED_TEXT_ONLY',
    },
  };
  const material = await f.materialInput(value, new Uint8Array([1, 2, 3]), 'admin');
  await f.runtime.state('appendMessage', {
    id: 'quoted-asr-note',
    role: 'notice',
    text: '记住 QUOTED_ASR_ONLY',
    inputId: 'current-metadata',
    audience: value.audience,
    origins: [value],
  });
  const binding = await f.bind('current-metadata');
  expect((await binding.ports.context()).messages).toEqual([]);
  expect(binding.currentMaterials).toEqual([material.reference]);
  expect(binding.currentNotes).toContainEqual({
    id: 'quoted-asr-note',
    text: '记住 QUOTED_ASR_ONLY',
  });
  window.maxMessages = 1;
  expect((await binding.ports.context()).messages.map((message) => message.id)).toEqual([
    'older-reference-context',
  ]);
  await expect(
    binding.ports.rememberFact('quote', 'QUOTED_TEXT_ONLY', effect('current-metadata')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    binding.ports.rememberFact('asr', 'QUOTED_ASR_ONLY', effect('current-metadata')),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
});

it('QQ group window zero excludes all old history while retaining facts and private-owner behavior', async () => {
  const f = await setup();
  const window = vi.fn(() => ({ maxMessages: 0, maxAgeMs: 1000 }));
  f.runtime.setInputPorts({ conversationWindow: window });
  const group = origin('group-zero', 'alice', '201');
  await f.fact('public', 'PUBLIC_WINDOW_FACT', { kind: 'public' });
  await f.fact('group', 'GROUP_WINDOW_FACT', group.audience);
  await historyMessage(
    f.runtime,
    origin('group-old', 'alice', '201'),
    'OLD_GROUP_HISTORY',
    Date.now() - 5000,
  );
  await historyObservation(
    f.runtime,
    group,
    'observation-old',
    'OLD_OBSERVATION',
    Date.now() - 500,
  );
  await f.external(group, 'CURRENT_GROUP_INPUT');
  await historyObservation(f.runtime, group, 'group-zero', 'CURRENT_DUPLICATE', Date.now());
  const binding = await f.bind('group-zero');
  const context = await binding.ports.context();
  expect(context.messages).toEqual([]);
  expect(context.facts.map((fact) => fact.value).sort()).toEqual([
    'GROUP_WINDOW_FACT',
    'PUBLIC_WINDOW_FACT',
  ]);
  expect(window).toHaveBeenCalledWith(group);
  await f.finish('group-zero');
  const owner: CompanionInputOrigin = {
    kind: 'owner',
    inputId: 'owner-old',
    principalId: 'owner',
    audience: { kind: 'owner-private' },
    route: { kind: 'owner-private' },
    policyRevision: null,
  };
  await historyMessage(f.runtime, owner, 'OWNER_HISTORY_UNCHANGED', Date.now() - 120000);
  const receipt = await f.runtime.message({
    commandId: 'owner-window-current',
    text: 'Owner input',
  });
  if (!receipt.messageId) throw new Error('missing owner message');
  const ownerContext = await (await f.bind(receipt.messageId)).ports.context();
  expect(ownerContext.messages.some((message) => message.text === 'OWNER_HISTORY_UNCHANGED')).toBe(
    true,
  );
  expect(ownerContext.messages.some((message) => message.text === 'OLD_GROUP_HISTORY')).toBe(false);
  expect(window).toHaveBeenCalledTimes(1);
});

it('QQ group window applies shared age/count limits and prefers canonical messages over matching observations', async () => {
  const f = await setup();
  f.runtime.setInputPorts({
    conversationWindow: async () => ({ maxMessages: 3, maxAgeMs: 60000 }),
  });
  const now = Date.now();
  const group = origin('window-current', 'alice', '201');
  await historyMessage(
    f.runtime,
    origin('age-expired', 'alice', '201'),
    'EXPIRED_CANONICAL',
    now - 120000,
  );
  await historyMessage(
    f.runtime,
    origin('count-omitted', 'alice', '201'),
    'OLDER_ELIGIBLE',
    now - 50000,
  );
  await historyMessage(
    f.runtime,
    origin('shared-host-key', 'alice', '201'),
    'CANONICAL_VERSION',
    now - 40000,
  );
  await historyMessage(
    f.runtime,
    origin('canonical-recent', 'alice', '201'),
    'RECENT_CANONICAL',
    now - 20000,
  );
  await historyMessage(
    f.runtime,
    origin('foreign-group', 'bob', '202'),
    'FOREIGN_GROUP',
    now - 500,
  );
  await historyObservation(
    f.runtime,
    group,
    'observation-expired',
    'EXPIRED_OBSERVATION',
    now - 90000,
  );
  await historyObservation(
    f.runtime,
    group,
    'observation-recent',
    'RECENT_OBSERVATION',
    now - 30000,
  );
  await historyObservation(
    f.runtime,
    group,
    'shared-host-key',
    'DUPLICATE_OBSERVATION_VERSION',
    now - 10000,
  );
  await f.external(group, 'CURRENT_INPUT_EXCLUDED_FROM_HISTORY');
  await historyObservation(f.runtime, group, 'window-current', 'CURRENT_OBSERVATION', Date.now());
  const projected = await (await f.bind('window-current')).ports.context();
  expect(projected.messages.map((message) => message.id)).toEqual([
    'shared-host-key',
    'observation-recent',
    'canonical-recent',
  ]);
  expect(projected.messages[0]?.text).toBe('CANONICAL_VERSION');
  expect(projected.messages[0]?.role).toBe('user');
  expect(JSON.stringify(projected.messages)).not.toMatch(
    /EXPIRED_|FOREIGN_GROUP|CURRENT_INPUT|CURRENT_OBSERVATION|DUPLICATE_OBSERVATION_VERSION/,
  );
});

it('QQ group window enforces one 12KiB budget across canonical and observation history', async () => {
  const f = await setup();
  f.runtime.setInputPorts({ conversationWindow: () => ({ maxMessages: 30, maxAgeMs: 1800000 }) });
  const now = Date.now();
  const group = origin('bytes-current', 'alice', '201');
  await historyMessage(
    f.runtime,
    origin('canonical-oldest', 'alice', '201'),
    'A'.repeat(4500),
    now - 50000,
  );
  await historyObservation(f.runtime, group, 'observation-older', 'B'.repeat(3000), now - 40000);
  const preceding = await historyMessage(
    f.runtime,
    origin('canonical-middle', 'alice', '201'),
    'C'.repeat(4500),
    now - 30000,
  );
  await historyObservation(f.runtime, group, 'observation-newest', 'D'.repeat(3000), now - 20000);
  await historyMessage(
    f.runtime,
    origin('canonical-newest', 'alice', '201'),
    'E'.repeat(4500),
    now - 10000,
  );
  await f.external(group, 'CURRENT');
  const context = await (await f.bind('bytes-current')).ports.context();
  expect(context.messages.map((message) => message.id)).toEqual([
    'observation-newest',
    'canonical-newest',
  ]);
  expect(Buffer.byteLength(JSON.stringify(context.messages), 'utf8')).toBeLessThanOrEqual(
    QQ_GROUP_CONTEXT_MAX_BYTES,
  );
  expect(
    Buffer.byteLength(JSON.stringify([preceding, ...context.messages]), 'utf8'),
  ).toBeGreaterThan(QQ_GROUP_CONTEXT_MAX_BYTES);
});

it('judgment and exact observation reads do not publish snapshot refresh notifications', async () => {
  const f = await setup();
  const value = origin('observation-reader', 'alice', '201');
  await f.runtime.state('observe', {
    observation: {
      id: 'historical-observation',
      audience: value.audience,
      principalId: 'alice',
      observedAt: Date.now(),
      text: 'Historical context only',
      quotedText: null,
      materialIds: [],
      fileEvidence: null,
    },
  });
  const changed = vi.fn();
  const remove = f.runtime.onChanged(changed);
  try {
    await f.runtime.state('getObservation', {
      id: 'historical-observation',
      scope: inputScope(value),
    });
    await f.runtime.state('judgmentUsage', {});
    if (value.audience.kind !== 'qq-group') throw new Error('fixture requires group scope');
    await f.runtime.state('proactiveReadiness', { audience: value.audience });
    expect(
      await f.runtime.state('findInput', {
        id: 'historical-observation',
        scope: inputScope(value),
      }),
    ).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(f.jobs).toHaveLength(0);
  } finally {
    remove();
  }
});

it('projects bounded QQ status in the existing snapshot byte budget and rejects secret/config fields', async () => {
  const f = await setup();
  const first = f.host.views()[0];
  if (!first) throw new Error('missing fixture plugin view');
  const views = vi.spyOn(f.host, 'views').mockReturnValue(
    Array.from({ length: 16 }, (_, index) => ({
      ...first,
      id: `pet.snapshot-fixture-${index}`,
      name: '界'.repeat(80),
    })),
  );
  const calls = vi.spyOn(f.host, 'call');
  const budget = (): number => {
    const body = calls.mock.calls.findLast(
      (call) => call[0] === STATE_CAPABILITY && call[1] === 'snapshot',
    )?.[2];
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body['byteBudget'] !== 'number'
    )
      throw new Error('missing snapshot budget');
    return body['byteBudget'];
  };
  try {
    expect(await f.runtime.snapshot()).not.toHaveProperty('qq');
    const before = budget();
    const status: QQStatus = {
      version: 1,
      sources: [
        {
          protocol: 'official',
          sourcePluginId: 'pet.qq-official',
          desiredEnabled: false,
          source: 'disabled',
          phase: 'disabled',
          account: null,
          cleanup: 'settled',
          error: null,
        },
        {
          protocol: 'onebot-v11',
          sourcePluginId: 'pet.qq-onebot',
          desiredEnabled: false,
          source: 'disabled',
          phase: 'disabled',
          account: null,
          cleanup: 'settled',
          error: null,
        },
      ],
    };
    const provider = vi.fn(async () => status);
    f.runtime.setQQStatusProvider(provider);
    const snapshot = await f.runtime.snapshot();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(snapshot.qq).toEqual(status);
    expect(snapshot.qq).not.toBe(status);
    expect(before - budget()).toBe(Buffer.byteLength(JSON.stringify({ qq: status })) - 1);
    expect(Buffer.byteLength(JSON.stringify({ ok: true, value: snapshot }))).toBeLessThanOrEqual(
      JSON_MAX_BYTES,
    );
    f.runtime.setQQStatusProvider(async () => ({
      ...status,
      config: { secret: 'must-not-be-projected' },
    }));
    await expect(f.runtime.snapshot()).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  } finally {
    calls.mockRestore();
    views.mockRestore();
  }
});

it('persists explicit optional-plugin enablement alongside the original disabled ledger', async () => {
  const optional = ['pet.qq-official', 'pet.qq-onebot'];
  const f = await setup(false, false, optional);
  for (const id of optional) expect(f.host.isEnabled(id)).toBe(false);
  const before = await f.runtime.profile();
  await f.runtime.setPlugin('pet.qq-official', false, 'qq-official-off');
  await f.runtime.setPlugin('pet.qq-official', true, 'qq-official-on');
  const enabled = await f.runtime.profile();
  expect(enabled.data['enabledOptionalPlugins']).toEqual(['pet.qq-official']);
  expect(enabled.data['disabledPlugins']).not.toContain('pet.qq-official');
  expect(f.host.isEnabled('pet.qq-official')).toBe(true);
  expect((await f.runtime.setPlugin('pet.qq-official', true, 'qq-official-on')).status).toBe(
    'duplicate',
  );
  expect((await f.runtime.profile()).revision).toBe(enabled.revision);
  await expect(
    f.runtime.setPlugin('pet.qq-official', false, 'qq-official-on'),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  await f.runtime.setPlugin('pet.qq-onebot', true, 'qq-onebot-on');
  const persisted = new FileConfigStore(path.join(f.directory, 'data', 'configuration'));
  expect(
    (await persisted.read({ pluginId: companionHostManifest.id, instanceId: 'default' }))?.data[
      'enabledOptionalPlugins'
    ],
  ).toEqual([...optional].sort());
  await f.runtime.setPlugin('pet.qq-official', false, 'qq-official-off-again');
  await f.runtime.setPlugin('pet.input-execution', false, 'ordinary-execution-off');
  const selected = await f.runtime.profile();
  expect(selected.data['enabledOptionalPlugins']).toEqual(['pet.qq-onebot']);
  expect(selected.data['disabledPlugins']).toEqual(['pet.input-execution', 'pet.qq-official']);
  expect({ name: selected.name, persona: selected.persona, harness: selected.harness }).toEqual({
    name: before.name,
    persona: before.persona,
    harness: before.harness,
  });
  await f.runtime.close();
  await f.host.close();
  const reopened = await new FileConfigStore(path.join(f.directory, 'data', 'configuration')).read({
    pluginId: companionHostManifest.id,
    instanceId: 'default',
  });
  expect(reopened?.data['enabledOptionalPlugins']).toEqual(['pet.qq-onebot']);
  expect(reopened?.data['disabledPlugins']).toEqual(['pet.input-execution', 'pet.qq-official']);
});

it('keeps old owner commands/fingerprints and deterministic Harness input termination', async () => {
  const f = await setup(true);
  const first = await f.runtime.message({ commandId: 'owner-message', text: 'hello' });
  await vi.waitFor(() => expect(f.terminal).toHaveLength(1));
  const duplicate = await f.runtime.message({ commandId: 'owner-message', text: 'hello' });
  expect(duplicate.status).toBe('duplicate');
  expect(duplicate.messageId).toBe(first.messageId);
  expect(f.terminal[0]?.outputs[0]?.audience).toEqual({ kind: 'owner-private' });
  expect(f.terminal[0]?.admission.phase).toBe('completed');
  const command = {
    commandId: 'memory-form',
    key: 'key',
    value: 'value',
    expectedMemoryRevision: 0,
    expectedFactRevision: 0,
  };
  expect(memoryCommand(command, false)).toEqual(command);
  expect(memoryCommand({ ...command, audience: { kind: 'public' } }, false).audience).toEqual({
    kind: 'public',
  });
});

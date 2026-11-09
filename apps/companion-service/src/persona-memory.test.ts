import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CompanionRuntime,
  createFixtureModelClient,
  FIXTURE_MODEL_CONNECTION,
} from '@pet/companion-runtime';
import { KernelFault } from '@pet/host-kernel';
import { makeError } from '@pet/contracts';
import type { ResponseClient } from '@pet/harness-cortico';
import { createCompanionService } from './service.js';

const token = 'persona-memory-controlled-owner-token';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
type Output = Awaited<ReturnType<ResponseClient['respond']>>['response']['output'];
async function promptEstimate(request: Parameters<ResponseClient['respond']>[0]) {
  const modulePath = 'cortico/protocol/open-responses/tokens.ts';
  const { estimateTokens } = (await import(modulePath)) as { estimateTokens(text: string): number };
  const tools = request.tools?.map((definition) =>
    definition.type === 'function' && definition.name === 'remember'
      ? {
          ...definition,
          description: 'Save a fact or preference explicitly supplied by this user input.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inputId: {
                type: 'string',
                minLength: 1,
                maxLength: 128,
                pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
              },
              key: { type: 'string', minLength: 1, maxLength: 80 },
              value: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            required: ['inputId', 'key', 'value'],
          },
        }
      : definition,
  );
  console.info(
    'Cortico first-turn estimate (tool-only before/after):',
    estimateTokens(JSON.stringify({ ...request, tools })),
    estimateTokens(JSON.stringify(request)),
  );
}
const tool = (name: string, input: Record<string, unknown>): Output => [
  {
    type: 'function_call',
    id: `item-${name}`,
    call_id: `call-${name}`,
    name,
    arguments: JSON.stringify(input),
    status: 'completed',
  },
];
function peer() {
  const base = createFixtureModelClient();
  const calls: Array<{
    request: Parameters<ResponseClient['respond']>[0];
    complete: (output: Output) => void;
  }> = [];
  const client: ResponseClient = {
    async respond(request, options = {}) {
      // Load the native value without pulling upstream implementation into this project's strict TS build.
      const modulePath = 'cortico/core/generation.ts';
      const { unknownMeters } = (await import(modulePath)) as { unknownMeters(): unknown };
      const generation = await base.respond(request, options);
      options.signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('fixture aborted', 'AbortError'));
        options.signal?.addEventListener('abort', abort, { once: true });
        calls.push({
          request,
          complete(output) {
            options.signal?.removeEventListener('abort', abort);
            resolve({
              ...generation,
              response: { ...generation.response, output },
              attempts: [
                {
                  id: 'controlled-attempt',
                  generationId: generation.response.id,
                  ordinal: 1,
                  origin: generation.origin,
                  startedAt: new Date().toISOString(),
                  elapsedMs: 0,
                  requestId: null,
                  responseId: generation.response.id,
                  outcome: 'completed',
                  status: 200,
                  serviceTier: null,
                  meters: unknownMeters(),
                  charges: [],
                },
              ],
            });
          },
        });
      });
    },
  };
  return {
    client,
    calls,
    async next(index: number) {
      await vi.waitFor(() => expect(calls[index]).toBeDefined(), { timeout: 5000, interval: 10 });
      return calls[index]!;
    },
  };
}
async function setup(observe?: (ports: ReturnType<CompanionRuntime['harnessPorts']>) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-persona-memory-'));
  const controlled = peer();
  const originalPorts = CompanionRuntime.prototype.harnessPorts;
  const portsSpy = observe
    ? vi.spyOn(CompanionRuntime.prototype, 'harnessPorts').mockImplementation(function (
        this: CompanionRuntime,
        ...args
      ) {
        const ports = originalPorts.apply(this, args);
        observe(ports);
        return ports;
      })
    : undefined;
  const service = await createCompanionService({
    dataDirectory: directory,
    token,
    mode: 'model',
    model: 'controlled',
    client: controlled.client,
  });
  portsSpy?.mockRestore();
  cleanups.push(async () => {
    await service.close();
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('companion-persona-memory-')
    )
      throw new Error('unexpected fixture path');
    await rm(directory, { recursive: true });
  });
  const post = async (route: string, body: unknown) =>
    fetch(service.url + route, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const idle = () =>
    vi.waitFor(async () => expect((await service.runtime.snapshot()).agent.status).toBe('ready'), {
      timeout: 5000,
      interval: 10,
    });
  return { ...controlled, service, post, idle };
}
it('actual owner profile/memory edits install canonical context without inference or connector replacement', async () => {
  const f = await setup();
  const identity = (await f.service.runtime.snapshot()).agent.id;
  const connectorId = FIXTURE_MODEL_CONNECTION.split('/')[0]!;
  const beforeOwner = f.service.host.manager.get({
    pluginId: connectorId,
    instanceId: 'default',
  })?.owner;
  const profile = await f.service.runtime.profileView();
  expect(profile.management?.application.appliedRevision).toBe(profile.revision);
  const response = await f.post('/api/profile', {
    expectedProfileRevision: profile.revision,
    name: '同一个助手',
    persona: 'PERSONA_CONTROLLED_NEW',
  });
  expect(response.status).toBe(200);
  const saved = await f.service.runtime.profileView();
  expect(saved.agentId).toBe(identity);
  expect(saved.management?.application.appliedRevision).toBe(saved.revision);
  expect(f.calls).toHaveLength(0);
  const long = 'x'.repeat(1500) + 'FULL_MEMORY_END';
  const memory = await f.service.runtime.memoryView();
  const result = await f.service.runtime.upsertFact({
    commandId: 'owner-long',
    expectedMemoryRevision: memory.revision,
    expectedFactRevision: 0,
    key: 'long',
    value: long,
  });
  expect(result.view.application.appliedRevision).toBe(result.view.revision);
  expect(f.calls).toHaveLength(0);
  const input = await f.service.runtime.message({ commandId: 'inspect-new', text: '请简短确认。' });
  const request = await f.next(0);
  await promptEstimate(request.request);
  expect(JSON.stringify(request.request)).toContain('PERSONA_CONTROLLED_NEW');
  expect(JSON.stringify(request.request)).toContain('FULL_MEMORY_END');
  request.complete(tool('say', { inputId: input.messageId, text: '已确认。' }));
  (await f.next(1)).complete([]);
  await f.idle();
  const row = result.view.facts[0]!;
  await f.service.runtime.forgetFact({
    commandId: 'forget-long',
    expectedMemoryRevision: result.view.revision,
    expectedFactRevision: row.revision,
    key: row.key,
  });
  const next = await f.service.runtime.message({
    commandId: 'inspect-forgotten',
    text: '再确认。',
  });
  const after = await f.next(2);
  expect(JSON.stringify(after.request)).not.toContain('FULL_MEMORY_END');
  after.complete(tool('say', { inputId: next.messageId, text: '已确认。' }));
  (await f.next(3)).complete([]);
  await f.idle();
  expect(
    f.service.host.manager.get({ pluginId: connectorId, instanceId: 'default' })?.owner,
  ).toEqual(beforeOwner);
}, 20000);

it('owner edits preserve deliberate Harness disable while saving canonical values', async () => {
  const f = await setup();
  await f.service.runtime.setPlugin('pet.harness-cortico', false, 'disable-harness');
  const profile = await f.service.runtime.profileView();
  const saved = await f.service.runtime.savePersona({
    expectedProfileRevision: profile.revision,
    name: '保存但不启用',
    persona: 'Saved while disabled',
  });
  expect(saved.management?.application).toMatchObject({
    appliedRevision: null,
    error: { code: 'not-ready' },
  });
  const view = await f.service.runtime.memoryView();
  const result = await f.service.runtime.upsertFact({
    commandId: 'disabled-memory',
    expectedMemoryRevision: view.revision,
    expectedFactRevision: 0,
    key: 'language',
    value: '中文',
  });
  expect(result.view.facts[0]?.value).toBe('中文');
  expect(result.view.application.appliedRevision).toBeNull();
  expect(
    f.service.host.manager.get({ pluginId: 'pet.harness-cortico', instanceId: 'default' }),
  ).toMatchObject({ state: 'disabled', desiredActive: false });
  expect(f.calls).toHaveLength(0);
}, 15000);

it('precommit Config save failure preserves canonical profile and restores its original application', async () => {
  const f = await setup();
  const before = await f.service.runtime.profile();
  const identity = (await f.service.runtime.profileView()).agentId;
  const spy = vi
    .spyOn(f.service.host.configs, 'save')
    .mockResolvedValueOnce({ ok: false, error: makeError('unavailable', false) });
  try {
    await expect(
      f.service.runtime.savePersona({
        expectedProfileRevision: before.revision,
        name: 'Not committed',
        persona: 'Must not replace saved persona',
      }),
    ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  } finally {
    spy.mockRestore();
  }
  const after = await f.service.runtime.profile();
  expect(after).toEqual(before);
  const view = await f.service.runtime.profileView();
  expect(view.agentId).toBe(identity);
  expect(view.management?.application).toEqual({ appliedRevision: before.revision, error: null });
  expect(f.calls).toHaveLength(0);
}, 15000);

it('postcommit profile readback failure retains actual saved name persona and revision', async () => {
  const f = await setup();
  const before = await f.service.runtime.profileView();
  const original = f.service.runtime.profileView.bind(f.service.runtime);
  const spy = vi
    .spyOn(f.service.runtime, 'profileView')
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new KernelFault('unavailable'));
  let result;
  try {
    result = await f.service.runtime.savePersona({
      expectedProfileRevision: before.revision,
      name: 'Committed before readback',
      persona: 'Canonical saved body despite readback failure',
    });
    expect(result).toMatchObject({
      agentId: before.agentId,
      name: 'Committed before readback',
      persona: 'Canonical saved body despite readback failure',
      management: { application: { appliedRevision: null, error: { code: 'unavailable' } } },
    });
    expect(result.revision).toBeGreaterThan(before.revision);
  } finally {
    spy.mockRestore();
  }
  const stored = await f.service.runtime.profile();
  expect(stored).toMatchObject({
    name: result.name,
    persona: result.persona,
    revision: result.revision,
  });
  expect((await f.service.runtime.profileView()).management?.application.appliedRevision).toBe(
    result.revision,
  );
  expect(f.calls).toHaveLength(0);
}, 15000);

it('a committed profile survives later foreground activation failure', async () => {
  const f = await setup();
  const profile = await f.service.runtime.profileView();
  vi.spyOn(f.service.runtime, 'activateForeground').mockRejectedValueOnce(
    new KernelFault('unavailable'),
  );
  const saved = await f.service.runtime.savePersona({
    expectedProfileRevision: profile.revision,
    name: 'Already saved',
    persona: 'Persisted despite activation failure',
  });
  expect(saved.revision).toBeGreaterThan(profile.revision);
  expect(saved.management?.application).toMatchObject({
    appliedRevision: null,
    error: { code: 'unavailable' },
  });
  expect((await f.service.runtime.profile()).persona).toBe('Persisted despite activation failure');
  expect(f.calls).toHaveLength(0);
}, 15000);

it.each([
  [
    '请记住我的明确偏好：回答简短。可保存为 answer-style=回答简短。现在用一句简短中文向我确认。',
    'answer-style',
    '回答简短',
  ],
  ['请记住我喜欢乌龙茶，以后提醒我时用这个偏好。', 'drink', '我喜欢乌龙茶'],
  ['请记住我的偏好是“回答简短”。', 'style', '回答简短'],
])(
  'natural remember binds actual canonical input and refreshes memory without idle self-stop: %s',
  async (text, key, value) => {
    const f = await setup();
    const input = await f.service.runtime.message({ commandId: 'natural-memory', text });
    const first = await f.next(0);
    first.complete(tool('remember', { inputId: input.messageId, key, value }));
    const next = await f.next(1);
    const memory = await f.service.runtime.memoryView();
    expect(memory.facts[0]?.value).toBe(value);
    expect(memory.application.appliedRevision).toBe(memory.revision);
    const origin = memory.facts[0]?.origin;
    expect(origin?.kind).toBe('user-input');
    if (origin?.kind === 'user-input') {
      expect(origin.inputId).toBe(input.messageId);
      expect(text.slice(origin.evidence.start, origin.evidence.end)).toBe(value);
    }
    expect(JSON.stringify(next.request)).toContain(value);
    next.complete(tool('say', { inputId: input.messageId, text: '已记住。' }));
    (await f.next(2)).complete([]);
    await f.idle();
  },
  15000,
);

it('finishing delivered A preserves queued B admission before its model delivery', async () => {
  let ports: ReturnType<CompanionRuntime['harnessPorts']> | undefined;
  const f = await setup((value) => {
    ports = value;
  });
  const a = await f.service.runtime.message({ commandId: 'adjacent-A', text: '先回应这一句。' });
  const first = await f.next(0);
  const b = await f.service.runtime.message({
    commandId: 'adjacent-B',
    text: '请记住我喜欢乌龙茶。',
  });
  // A is delivered; B is only queued. Source completion may release A, never all owner admissions.
  ports?.finishInputs([a.messageId ?? '']);
  await expect(
    f.service.runtime.savePersona({
      expectedProfileRevision: (await f.service.runtime.profile()).revision,
      name: 'Busy',
      persona: 'Cannot interrupt',
    }),
  ).rejects.toThrow();
  first.complete(tool('say', { inputId: a.messageId, text: 'A已回应。' }));
  const second = await f.next(1);
  second.complete(tool('remember', { inputId: b.messageId, key: 'drink', value: '我喜欢乌龙茶' }));
  const third = await f.next(2);
  expect((await f.service.runtime.memoryView()).facts[0]?.value).toBe('我喜欢乌龙茶');
  third.complete(tool('say', { inputId: b.messageId, text: 'B已记住。' }));
  (await f.next(3)).complete([]);
  await f.idle();
}, 15000);

it.each([
  ['我可能喜欢回答简短。', '回答简短'],
  ['“请记住回答简短”只是引用。', '回答简短'],
  ['不要记住回答简短。', '回答简短'],
  ['请记住我喜欢茶。', '推测出的私密诊断'],
])(
  'central admission refuses unrelated/quoted/negative/invented memory: %s',
  async (text, value) => {
    const f = await setup();
    const input = await f.service.runtime.message({ commandId: 'denied-memory', text });
    (await f.next(0)).complete(
      tool('remember', { inputId: input.messageId, key: 'candidate', value }),
    );
    const after = await f.next(1);
    expect((await f.service.runtime.memoryView()).facts).toEqual([]);
    after.complete(tool('say', { inputId: input.messageId, text: '没有保存。' }));
    (await f.next(2)).complete([]);
    await f.idle();
  },
  15000,
);

it('a committed current-turn memory survives canonical refresh failure without another inference', async () => {
  const f = await setup();
  const original = f.service.runtime.state.bind(f.service.runtime);
  let committed = false;
  const controlled: typeof f.service.runtime.state = async (method, input, signal) => {
    if (method === 'snapshot' && committed) throw new KernelFault('unavailable');
    const result = await original(method, input, signal);
    if (method === 'rememberFact') committed = true;
    return result;
  };
  vi.spyOn(f.service.runtime, 'state').mockImplementation(controlled);
  const input = await f.service.runtime.message({
    commandId: 'remember-refresh-failure',
    text: '请记住我喜欢茶。',
  });
  (await f.next(0)).complete(
    tool('remember', { inputId: input.messageId, key: 'drink', value: '我喜欢茶' }),
  );
  await vi.waitFor(
    async () =>
      expect((await f.service.runtime.memoryView()).application.error?.code).toBe('unavailable'),
    { timeout: 5000, interval: 10 },
  );
  const view = await f.service.runtime.memoryView();
  expect(view.facts[0]?.value).toBe('我喜欢茶');
  expect(view.revision).toBe(1);
  expect(view.application.appliedRevision).not.toBe(view.revision);
  expect(f.calls).toHaveLength(1);
}, 15000);

it('direct host remember refuses missing canonical admission independently of adapter prevalidation', async () => {
  let ports: ReturnType<CompanionRuntime['harnessPorts']> | undefined;
  const f = await setup((value) => {
    ports = value;
  });
  if (!ports) throw new Error('missing actual bound ports');
  const before = await f.service.runtime.memoryView();
  await expect(
    ports.rememberFact('language', '中文', {
      id: 'not-owner-authority',
      inputIds: ['not-an-admitted-input'],
      callId: 'direct-host-probe',
    }),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(await f.service.runtime.memoryView()).toEqual(before);
  expect(f.calls).toHaveLength(0);
}, 15000);

it('full memory admission capacity preserves exact durable message retries without new slots or events', async () => {
  const f = await setup();
  const command = { commandId: 'full-memory-0', text: '请记住明确值0。' };
  const accepted = await f.service.runtime.message(command);
  await f.next(0); // Hold this inference while the other admitted inputs remain queued.
  for (let index = 1; index < 32; index++)
    await f.service.runtime.message({
      commandId: `full-memory-${index}`,
      text: `请记住明确值${index}。`,
    });
  const before = await f.service.runtime.snapshot();
  expect(await f.service.runtime.message(command)).toEqual({ ...accepted, status: 'duplicate' });
  await expect(
    f.service.runtime.message({ ...command, text: '请记住另一个值。' }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  await expect(
    f.service.runtime.message({ commandId: 'full-memory-new', text: '请记住新的值。' }),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  const after = await f.service.runtime.snapshot();
  expect(after.cursor).toBe(before.cursor);
  expect(after.messages).toEqual(before.messages);
  expect(f.calls).toHaveLength(1);
}, 15000);

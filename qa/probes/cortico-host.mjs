import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const unregister = register();
let core;
const report = {
  status: 'failed',
  electron: process.versions.electron,
  node: process.versions.node,
  checks: [],
  networkCalls: 0,
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  report.networkCalls++;
  throw new Error('Network forbidden in native Cortico acceptance');
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const within = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
try {
  const { Core } = await import('cortico/core/core.ts');
  const { CORE_DEFAULTS } = await import('cortico/core/config.ts');
  report.checks.push('published-typescript-core-and-provider-registry-import-on-electron');
  const root = process.argv[2];
  const memoryDir = path.join(root, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });
  const config = structuredClone(CORE_DEFAULTS);
  config.displayName = 'Native pet fixture';
  config.timezone = 'UTC';
  config.logging = { file: 'warn', stdout: 'error', areas: '' };
  config.batching = { quietGapMs: 10, minBatchAgeMs: 0, maxBatchAgeMs: 100, maxBatchSize: 20 };
  config.providers = {
    fixture: {
      kind: 'openai-responses-compat',
      baseUrl: 'https://fixture.invalid/v1',
      spec: { model: 'fixture-model' },
    },
  };
  config.activeProvider = 'fixture';
  const loaded = {
    config,
    secret: () => '',
    rootDir: root,
    memoryDir,
    dataDir: path.join(root, 'data'),
  };
  let worldHost;
  let stopped = false;
  let calls = 0;
  let blocking = false;
  let aborted = false;
  let petName = 'Before';
  const receipts = [];
  const finished = deferred();
  const requestStarted = deferred();
  const world = {
    id: 'fixture.desktop',
    envPromptVars: () => null,
    tools: () => [
      {
        name: 'set_pet_name',
        description: 'Set the pet name.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
        tags: ['write'],
        handler: async ({ name }) => {
          assert.equal(name, 'After');
          petName = name;
          return { text: 'Name saved.' };
        },
      },
      {
        name: 'pet_say',
        description: 'Present the pet reply.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
        tags: ['speak'],
        endsTurn: true,
        handler: async ({ text }) => {
          assert.equal(petName, 'After');
          receipts.push(
            await worldHost.pushEvent(
              {
                type: 'pet.presented',
                ts: new Date().toISOString(),
                source: world.id,
                origin: 'internal',
                text,
                meta: { text },
              },
              { deliver: false },
            ),
          );
          return { text: 'Presented.' };
        },
      },
    ],
    start: async (host) => {
      worldHost = host;
    },
    stop: async () => {
      stopped = true;
    },
  };
  const persona = {
    memoryDir,
    blobs: {
      put: () => {
        throw new Error('No fixture blobs');
      },
      get: () => null,
      list: () => [],
    },
    attach() {},
    systemSegments: async () => [{ title: 'Persona', text: 'You are a desktop pet fixture.' }],
    declareSessions: () => [
      {
        id: 'primary',
        label: 'Primary',
        persistent: true,
        receivesEvents: true,
        eventDelivery: 'user',
        rounds: () => ({ soft: 4, hard: 6 }),
        tools: () => world.tools(),
      },
    ],
    onIdle: () => {
      if (receipts.length) finished.resolve();
    },
  };
  const llm = {
    respond: async (request, options = {}) => {
      calls++;
      if (blocking) {
        requestStarted.resolve();
        return await new Promise((_, reject) => {
          const stop = () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (options.signal?.aborted) stop();
          else options.signal?.addEventListener('abort', stop, { once: true });
        });
      }
      assert.ok(calls <= 2, 'Core must end after presented speech');
      if (calls === 2)
        assert.ok(
          JSON.stringify(request.input).includes('Name saved.'),
          'Core must deliver actual tool result to next request',
        );
      const name = calls === 1 ? 'set_pet_name' : 'pet_say';
      const args = calls === 1 ? { name: 'After' } : { text: 'Native Cortico reply.' };
      return {
        response: {
          id: 'response-' + calls,
          object: 'response',
          created_at: 0,
          status: 'completed',
          model: 'fixture-model',
          output: [
            {
              type: 'function_call',
              id: 'item-' + calls,
              call_id: 'call-' + calls,
              name,
              arguments: JSON.stringify(args),
              status: 'completed',
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
        origin: options.origin ?? {
          instance: 'fixture',
          module: 'openai-responses-compat',
          model: 'fixture-model',
          compatibilityDomain: 'fixture.invalid',
        },
        attempts: [
          {
            id: 'attempt-' + calls,
            generationId: 'generation-' + calls,
            ordinal: 1,
            origin: options.origin ?? {
              instance: 'fixture',
              module: 'openai-responses-compat',
              model: 'fixture-model',
              compatibilityDomain: 'fixture.invalid',
            },
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            requestId: null,
            responseId: 'response-' + calls,
            outcome: 'completed',
            status: 200,
            serviceTier: null,
            meters: {
              input: 1,
              output: 1,
              total: 2,
              cachedInput: 0,
              uncachedInput: 1,
              reasoning: 0,
              native: null,
            },
            charges: [],
          },
        ],
      };
    },
  };
  core = new Core(loaded, { persona, worlds: [world], llm });
  await core.start();
  assert.ok(worldHost);
  const input = await worldHost.pushEvent(
    {
      type: 'pet.message',
      ts: new Date().toISOString(),
      source: world.id,
      text: 'Change name and respond.',
    },
    { trigger: 'flush' },
  );
  await within(finished.promise, 'Core event/tool/reply');
  assert.equal(calls, 2);
  assert.equal(petName, 'After');
  assert.equal(core.store.get(input.cursor).type, 'pet.message');
  assert.equal(core.store.get(receipts[0].cursor).type, 'pet.presented');
  assert.ok(receipts[0].cursor > input.cursor);
  report.checks.push('one-core-event-tools-config-result-and-presented-reply');
  report.checks.push('input-and-output-receipt-share-monotonic-event-store');
  blocking = true;
  await worldHost.pushEvent(
    {
      type: 'pet.message',
      ts: new Date().toISOString(),
      source: world.id,
      text: 'Cancel this response.',
    },
    { trigger: 'flush' },
  );
  await within(requestStarted.promise, 'Blocked model call');
  const failures = await within(core.stop(), 'Core stop');
  assert.deepEqual(failures, []);
  assert.equal(aborted, true);
  assert.equal(stopped, true);
  report.checks.push('stop-aborts-provider-call-and-closes-world');
  const lastCursor = receipts[0].cursor;
  core = new Core(loaded, { persona, worlds: [], llm });
  assert.equal(core.store.get(input.cursor).type, 'pet.message');
  assert.equal(core.store.get(lastCursor).type, 'pet.presented');
  assert.deepEqual(await core.stop(), []);
  report.checks.push('same-history-reconstructs-after-core-restart');
  assert.equal(report.networkCalls, 0);
  report.calls = calls;
  report.receiptCursor = lastCursor;
  report.status = 'passed';
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (core) {
    try {
      await core.stop();
    } catch {}
  }
  globalThis.fetch = originalFetch;
  unregister();
  process.send?.(report);
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run: node qa/probes/companion-cortico-gate.mjs
// Optional: CORTICO_GATE_ROOT=/absolute/pinned/checkout (requires its dependencies).
// Logs are retained in a fresh temporary directory; no desktop profile is opened.
const require = createRequire(import.meta.url);
const report = { status: 'failed', node: process.versions.node, checks: [], networkCalls: 0 };
const fetchBefore = globalThis.fetch;
let unregister;
let Core;
let CORE_DEFAULTS;
let GenerationError;
let unknownMeters;
let createResponse;
let messageSequence = 0;
let root;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const origin = {
  instance: 'gate',
  module: 'openai-responses-compat',
  model: 'scripted-gate',
  compatibilityDomain: 'gate.invalid',
};
const message = (text) => ({
  type: 'message',
  id: `scripted-message-${++messageSequence}`,
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const call = (name, callId) => ({
  type: 'function_call',
  id: `item-${callId}`,
  call_id: callId,
  name,
  arguments: '{}',
  status: 'completed',
});
const tool = (name, description, handler, flags = {}) => ({
  name,
  description,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  tags: ['flow'],
  handler,
  ...flags,
});
const inputText = (flight) => JSON.stringify(flight.request.input);
const toolOutput = (flight, callId) =>
  flight.request.input.find((item) => item.type === 'function_call_output' && item.call_id === callId);

async function fixture(name, tools, exercise) {
  const requests = [];
  const requestSlots = [];
  const idleSlots = [];
  const deltas = [];
  const settled = [];
  let idleCount = 0;
  let host;
  const memoryDir = path.join(root, name, 'memory');
  const config = structuredClone(CORE_DEFAULTS);
  Object.assign(config, {
    displayName: 'Offline scripted Cortico gate',
    timezone: 'UTC',
    logging: { file: 'warn', stdout: 'error', areas: '' },
    providers: {
      gate: { kind: origin.module, baseUrl: 'https://gate.invalid/v1', spec: { model: origin.model } },
    },
    activeProvider: 'gate',
  });
  const llm = {
    respond(request, options = {}) {
      const pending = deferred();
      const index = requests.length;
      const id = `${name}-${index + 1}`;
      const response = (output, status = 'completed') => ({
        ...createResponse(id, request, 0),
        status,
        completed_at: status === 'completed' ? 0 : null,
        output,
      });
      const attempt = (outcome) => ({
        id: `attempt-${id}`,
        generationId: id,
        ordinal: 1,
        origin,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        requestId: null,
        responseId: id,
        outcome,
        status: outcome === 'completed' ? 200 : null,
        serviceTier: null,
        meters: unknownMeters(),
        charges: [],
      });
      const flight = {
        request,
        options,
        done: false,
        complete(output = []) {
          this.done = true;
          pending.resolve({ response: response(output), origin, attempts: [attempt('completed')] });
        },
        fail(partial = null) {
          this.done = true;
          pending.reject(
            new GenerationError('Scripted generation aborted', [attempt('aborted')], partial, origin),
          );
        },
        response,
        emit(text, itemId = `message-${id}`) {
          options.onEvent?.({
            type: 'response.output_text.delta',
            sequence_number: 1,
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: text,
            logprobs: [],
          });
        },
      };
      requests.push(flight);
      (requestSlots[index] ??= deferred()).resolve(flight);
      return pending.promise;
    },
  };
  const world = {
    id: 'companion.gate',
    envPromptVars: () => null,
    tools: () => tools,
    async start(value) {
      host = value;
    },
    async stop() {},
    onEventsSettled(events, outcome) {
      settled.push(...events.map((event) => ({ event, outcome })));
    },
  };
  const persona = {
    memoryDir,
    blobs: {
      put() {
        throw new Error('Gate has no persona blobs');
      },
      get: () => null,
      list: () => [],
    },
    attach() {},
    systemSegments: async () => [{ title: 'Gate', text: 'Offline scripted protocol fixture.' }],
    declareSessions: () => [
      {
        id: 'foreground',
        label: 'Foreground gate',
        persistent: true,
        receivesEvents: true,
        eventDelivery: 'user',
        rounds: () => ({ soft: 8, hard: 12 }),
        tools: () => tools,
        outputTap: {
          onEvent(event) {
            if (event.type === 'response.output_text.delta') deltas.push(event.delta);
          },
        },
      },
    ],
    onIdle() {
      (idleSlots[idleCount++] ??= deferred()).resolve();
    },
  };
  const core = new Core(
    { config, secret: () => '', rootDir: path.join(root, name), memoryDir, dataDir: path.join(root, name, 'data') },
    { persona, worlds: [world], llm },
  );
  const rig = {
    core,
    requests,
    deltas,
    settled,
    get idleCount() {
      return idleCount;
    },
    next(index) {
      return within((requestSlots[index - 1] ??= deferred()).promise, `${name} request ${index}`);
    },
    idle(index = 1) {
      return within((idleSlots[index - 1] ??= deferred()).promise, `${name} idle ${index}`);
    },
    push(text, trigger = 'flush', meta = {}, type = 'companion.input') {
      return host.pushEvent(
        { type, ts: new Date().toISOString(), source: world.id, origin: 'external', text, meta },
        { trigger },
      );
    },
  };
  try {
    await core.start();
    await exercise(rig);
  } finally {
    // Release only this fixture's scripted requests before terminal Core teardown.
    core.loop.interruptCurrentRound();
    for (const flight of requests) if (!flight.done) flight.fail();
    assert.deepEqual(await core.stop(), [], `${name}: Core must drain`);
  }
  await assert.rejects(() => rig.push('after teardown'), /lifecycle|生命周期/i);
  report.checks.push(name);
}

try {
  globalThis.fetch = async () => {
    report.networkCalls++;
    throw new Error('Network forbidden in offline Cortico gate');
  };
  process.env.TSX_DISABLE_CACHE = '1';
  const { register } = await import('tsx/esm/api');
  unregister = register();
  const sourceRoot = process.env.CORTICO_GATE_ROOT;
  const packageFile = sourceRoot ? path.join(sourceRoot, 'package.json') : require.resolve('cortico/package.json');
  const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
  assert.equal(manifest.version, '0.2.7', 'Gate requires the exact Cortico version');
  report.corticoVersion = manifest.version;
  report.corticoPackage = packageFile;
  const load = (file) => import(sourceRoot ? pathToFileURL(path.join(sourceRoot, 'src', file)).href : `cortico/${file}`);
  ({ Core } = await load('core/core.ts'));
  ({ CORE_DEFAULTS } = await load('core/config.ts'));
  ({ GenerationError, unknownMeters } = await load('core/generation.ts'));
  ({ createResponse } = await load('protocol/open-responses/index.ts'));
  root = await mkdtemp(path.join(tmpdir(), 'companion-cortico-gate-'));
  report.logs = root;

  const backendDone = deferred();
  const background = { state: 'not-started', signal: new AbortController().signal };
  const receipt = { taskId: 'task-A', attemptId: 'attempt-A', destinationId: 'private-A', state: 'running' };
  const backendCompletion = backendDone.promise.then(() => { background.state = 'completed'; });
  await fixture('next-step-and-independent-work', [
    tool('background_start', 'Start independent work and return its task receipt before completion.', async (_, ctx) => {
      assert.ok(ctx.callId);
      assert.equal(typeof ctx.round, 'number');
      background.state = 'running';
      return { text: JSON.stringify(receipt) };
    }),
  ], async (rig) => {
    await rig.push('INPUT_A start work', 'flush', { commandId: 'input-A' });
    const first = await rig.next(1);
    await rig.push('INPUT_B continue talking', 'flush', { commandId: 'input-B' });
    assert.equal(first.options.signal.aborted, false, 'flush must not abort the current model');
    first.complete([call('background_start', 'start-A')]);
    const second = await rig.next(2);
    assert.match(inputText(second), /INPUT_B/);
    assert.match(JSON.stringify(toolOutput(second, 'start-A')), /task-A/);
    assert.equal(rig.idleCount, 0, 'B must enter before whole-turn/onIdle completion');
    assert.equal(background.state, 'running');
    assert.ok(rig.settled.some(({ event, outcome }) => event.meta.commandId === 'input-B' && outcome === 'delivered'));
    second.complete([message('ANSWER_B while task-A is running')]);
    await rig.idle();
    assert.equal(background.state, 'running');

    await rig.push('INPUT_C a foreground round to stop');
    const third = await rig.next(3);
    assert.equal(rig.core.loop.interruptCurrentRound(), true);
    assert.equal(third.options.signal.aborted, true);
    third.fail();
    await rig.idle(2);
    assert.equal(background.signal.aborted, false, 'foreground stop must not signal independent work');
    assert.equal(background.state, 'running');
    backendDone.resolve();
    await backendCompletion;
    const fact = { eventId: 'result-A', taskId: 'task-A', attemptId: 'attempt-A', destinationId: 'private-A' };
    await rig.push(`WORK_RESULT ${JSON.stringify(fact)} completed`, 'flush', { ...fact, privateMarker: 'META_ONLY' }, 'companion.work-result');
    const fourth = await rig.next(4);
    assert.match(inputText(fourth), /result-A/);
    assert.match(inputText(fourth), /private-A/);
    assert.doesNotMatch(inputText(fourth), /META_ONLY/, 'meta is not rendered into model input');
    fourth.complete([message('Attributed result for task-A')]);
    await rig.idle(3);
  });

  await fixture('preempt-and-stream-interrupt', [], async (rig) => {
    await rig.push('FIRST');
    const first = await rig.next(1);
    await rig.push('PREEMPT_INPUT', 'preempt');
    assert.equal(first.options.signal.aborted, true);
    // Even a provider resolving successfully after abort must not commit its stale output.
    first.emit('LATE_DELTA');
    first.complete([message('STALE_SUCCESS')]);
    const second = await rig.next(2);
    assert.match(inputText(second), /PREEMPT_INPUT/);
    assert.doesNotMatch(inputText(second), /STALE_SUCCESS/);
    assert.equal(rig.idleCount, 0);
    assert.equal(typeof second.options.onEvent, 'function');
    const partial = message('VISIBLE_PARTIAL');
    second.emit('VISIBLE_PARTIAL', partial.id);
    await rig.push('CANNOT_PREEMPT_VISIBLE', 'preempt');
    assert.equal(second.options.signal.aborted, false, 'preempt cannot retract visible output');
    await rig.push('INTERRUPT_INPUT', 'interrupt');
    assert.equal(second.options.signal.aborted, true);
    second.emit('LATE_AFTER_INTERRUPT');
    second.fail(second.response([partial], 'incomplete'));
    const third = await rig.next(3);
    assert.match(inputText(third), /VISIBLE_PARTIAL/);
    assert.match(inputText(third), /INTERRUPT_INPUT/);
    assert.deepEqual(rig.deltas, ['VISIBLE_PARTIAL']);
    third.complete();
    await rig.idle();
  });

  for (const interruptible of [true, false]) {
    const entered = deferred();
    const release = deferred();
    let toolSignal;
    let skippedRuns = 0;
    try {
      await fixture(interruptible ? 'interruptible-tool-drain' : 'noninterruptible-tool-drain', [
        tool('controlled_tool', 'Wait for the fixture to release a bounded operation.', async (_, ctx) => {
          toolSignal = ctx.signal;
          entered.resolve();
          await release.promise;
          return { text: 'ACTUAL_TOOL_RECEIPT' };
        }, { interruptible }),
        tool('unstarted_tool', 'Record a second operation if execution reaches it.', async () => {
          skippedRuns++;
          return { text: 'unexpected second effect' };
        }),
      ], async (rig) => {
        await rig.push('TOOL_INPUT');
        (await rig.next(1)).complete([call('controlled_tool', 'slow'), call('unstarted_tool', 'skip')]);
        await within(entered.promise, 'tool entered');
        assert.equal(rig.core.loop.interruptCurrentRound(), true);
        assert.equal(toolSignal.aborted, interruptible);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(rig.requests.length, 1, 'interrupt signals but does not settle an awaited handler');
        release.resolve();
        const next = await rig.next(2);
        assert.match(JSON.stringify(toolOutput(next, 'slow')), /ACTUAL_TOOL_RECEIPT/);
        assert.match(JSON.stringify(toolOutput(next, 'skip')), /not executed: interrupted/);
        assert.equal(skippedRuns, 0);
        assert.equal(rig.idleCount, 0, 'tool interruption alone does not stop the whole turn');
        next.complete();
        await rig.idle();
      });
    } finally {
      release.resolve();
    }
  }
  assert.equal(report.networkCalls, 0);
  report.status = 'passed';
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  unregister?.();
  globalThis.fetch = fetchBefore;
  console.log(JSON.stringify(report, null, 2));
}

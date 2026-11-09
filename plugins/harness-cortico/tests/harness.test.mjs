import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCorticoHarness } from '../src/harness.mjs';
import { createCorticoPlugin } from '../src/index.ts';
import { createResponse } from 'cortico/protocol/open-responses/index.ts';
import { unknownMeters } from 'cortico/core/generation.ts';
import { ResponsesProvider } from 'cortico/providers/openai-responses-compat/native.ts';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('fixture timed out')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const call = (name, args, id = `call-${name}`) => ({
  type: 'function_call',
  id: `item-${id}`,
  call_id: id,
  name,
  arguments: JSON.stringify(args),
  status: 'completed',
});
const message = (text) => ({
  type: 'message',
  id: 'message-fixture',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const origin = {
  instance: 'fixture',
  module: 'openai-responses-compat',
  model: 'fixture-model',
  compatibilityDomain: 'fixture',
};
function generation(request, output, id = 'response-fixture') {
  return {
    response: { ...createResponse(id, request), status: 'completed', output },
    origin,
    attempts: [
      {
        id: `attempt-${id}`,
        generationId: id,
        ordinal: 1,
        origin,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        requestId: null,
        responseId: id,
        outcome: 'completed',
        status: 200,
        serviceTier: null,
        meters: unknownMeters(),
        charges: [],
      },
    ],
  };
}
function controlledClient() {
  const slots = [];
  const calls = [];
  return {
    calls,
    next(index) {
      return within((slots[index - 1] ??= deferred()).promise);
    },
    respond(request, options) {
      const result = deferred();
      const index = calls.length;
      const flight = {
        request,
        options,
        complete: (output = []) => result.resolve(generation(request, output, `response-${index}`)),
        fail: result.reject,
      };
      calls.push(flight);
      (slots[index] ??= deferred()).resolve(flight);
      return result.promise;
    },
  };
}
function product() {
  const events = new EventEmitter();
  const snapshot = { messages: [], facts: [], tasks: [], memoryRevision: 0 };
  const outputs = [];
  const starts = [];
  const writes = [];
  const stops = [];
  const effects = new Map();
  let status;
  const changed = () => events.emit('change');
  const ports = {
    projectionApplied() {},
    projectionFailed() {},
    finishInputs() {},
    async context() {
      return structuredClone(snapshot);
    },
    async publish(output) {
      if (!outputs.some((old) => old.id === output.id)) outputs.push(output);
      changed();
    },
    async startWork(request, provenance) {
      if (effects.has(provenance.id)) return { ...effects.get(provenance.id), status: 'duplicate' };
      starts.push({ request, provenance });
      const taskId = `task-${starts.length}`;
      snapshot.tasks.push({
        id: taskId,
        executionId: `attempt-${starts.length}`,
        title: request.title,
        status: 'running',
        createdAt: 0,
        updatedAt: 0,
        exitCode: null,
        stdout: '',
        stderr: '',
        logsTruncated: false,
        artifacts: [],
        error: null,
      });
      const receipt = { commandId: provenance.id, status: 'accepted', messageId: null, taskId };
      effects.set(provenance.id, receipt);
      changed();
      return receipt;
    },
    async stopWork(taskId) {
      stops.push(taskId);
      const task = snapshot.tasks.find((task) => task.id === taskId);
      if (task) task.status = 'cancel-requested';
      changed();
      return { commandId: 'stop-fixture', status: 'accepted', messageId: null, taskId };
    },
    async rememberFact(key, value, provenance) {
      writes.push({ key, value, provenance });
      snapshot.facts = snapshot.facts.filter((fact) => fact.key !== key);
      snapshot.memoryRevision++;
      snapshot.facts.push({ key, value, revision: snapshot.memoryRevision, updatedAt: 0 });
      changed();
      return {
        receipt: { commandId: provenance.id, status: 'accepted', messageId: null, taskId: null },
        committedRevision: snapshot.memoryRevision,
        view: { revision: snapshot.memoryRevision },
      };
    },
    status(value, error) {
      status = { value, error };
      changed();
    },
  };
  return {
    snapshot,
    outputs,
    starts,
    writes,
    stops,
    ports,
    get status() {
      return status;
    },
    async wait(predicate) {
      if (predicate()) return;
      const done = deferred();
      const listener = () => {
        if (predicate()) done.resolve();
      };
      events.on('change', listener);
      try {
        await within(done.promise);
      } finally {
        events.off('change', listener);
      }
    },
  };
}
async function setup(t, mode = 'scripted', client) {
  const state = product();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-harness-'));
  const options = {
    dataDirectory,
    name: 'Test companion',
    persona: 'Keep accurate receipts.',
    mode,
    model: 'fixture-model',
    ...(client ? { client } : {}),
  };
  const harness = await createCorticoHarness(options, state.ports);
  t.after(() => harness.close());
  return { state, harness, options };
}
const input = (id, text) => ({ id, text, kind: 'user' });

test('scripted real Core remembers, admits independent work, chats, and attributes late results', async (t) => {
  const { state, harness, options } = await setup(t);
  await harness.accept(input('remember-A', '记住 语言: 中文'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('remember-A')));
  assert.equal(state.snapshot.facts[0].value, '中文');
  await harness.accept(input('work-A', '创建文件任务'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('work-A')));
  assert.equal(state.starts.length, 1);
  assert.match(state.starts[0].request.code, /writeFileSync/);
  assert.equal(state.snapshot.tasks[0].status, 'running');
  await harness.accept(input('chat-B', '你好'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('chat-B')));
  assert.equal(state.snapshot.tasks[0].status, 'running');
  assert.ok(state.outputs.every((reply) => reply.text.startsWith('离线脚本演示：')));
  await harness.stopForeground();
  assert.equal((await readdir(path.join(options.dataDirectory, 'projections'))).length, 2);
  assert.equal(state.starts.length, 1, 'reconstruction must not replay accepted effects');
  await harness.accept(input('facts-B', '我的偏好是什么'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('facts-B')));
  assert.match(state.outputs.at(-1).text, /中文/);
  state.snapshot.tasks[0].status = 'completed';
  await harness.accept({
    id: 'result-A',
    kind: 'work-result',
    taskId: 'task-1',
    text: '文件已完成',
  });
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('result-A')));
  assert.equal(state.outputs.at(-1).taskId, 'task-1');
  assert.deepEqual(state.outputs.at(-1).inputIds, ['result-A']);
  await harness.accept(input('query-A', '查看任务'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('query-A')));
  assert.match(state.outputs.at(-1).text, /已完成/);
  assert.ok(state.outputs.every((reply) => !reply.text.includes('"commandId"')));
  await harness.accept(input('stop-A', 'stop task-1'));
  await state.wait(() => state.stops.length === 1);
  assert.equal(state.stops[0], 'task-1');
});

test('injected client admits B on the next step, with stable tool-effect and output attribution', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('input-A', 'start work'));
  const first = await client.next(1);
  await harness.accept(input('input-B', 'continue talking'));
  assert.equal(first.options.signal.aborted, false);
  const request = { inputId: 'input-A', title: 'Independent work', code: 'console.log(1)' };
  first.complete([call('start_work', request)]);
  const second = await client.next(2);
  assert.match(JSON.stringify(second.request.input), /input-B/);
  assert.match(JSON.stringify(second.request.input), /task-1/);
  assert.equal(state.snapshot.tasks[0].status, 'running');
  second.complete([
    call('say', { inputId: 'input-B', text: 'B answered while A runs' }, 'reply-B'),
  ]);
  (await client.next(3)).complete();
  await state.wait(() => state.outputs.length === 1 && state.status.value === 'ready');
  assert.deepEqual(state.outputs[0].inputIds, ['input-B']);
  const effectId = state.starts[0].provenance.id;
  await harness.stopForeground();
  await harness.accept(input('input-A', 'start work'));
  (await client.next(4)).complete([call('start_work', request, 'new-native-call')]);
  (await client.next(5)).complete();
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.starts.length, 1, 'canonical effect dedup survives a new native call ID');
  assert.equal(state.starts[0].provenance.id, effectId);
});

test('stop fences and drains a pending admission without cancelling the accepted backend job', async () => {
  const state = product();
  const client = controlledClient();
  const entered = deferred();
  const release = deferred();
  const admit = state.ports.startWork;
  state.ports.startWork = async (...args) => {
    entered.resolve();
    await release.promise;
    return admit(...args);
  };
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-stop-'));
  const harness = await createCorticoHarness(
    { dataDirectory, name: 'Test', persona: 'Test', mode: 'model', model: 'fixture-model', client },
    state.ports,
  );
  try {
    await harness.accept(input('A', 'start'));
    (await client.next(1)).complete([
      call('start_work', { inputId: 'A', title: 'Job', code: 'console.log(1)' }),
      call('say', { inputId: 'A', text: 'stale reply' }, 'stale'),
    ]);
    await within(entered.promise);
    let settled = false;
    const stopping = harness.stopForeground().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'stop must await the actual admitted operation');
    release.resolve();
    await within(stopping);
    assert.equal(state.snapshot.tasks[0].status, 'running');
    assert.equal(state.stops.length, 0);
    assert.equal(state.outputs.length, 0);
    assert.equal(client.calls.length, 1, 'tool-phase stop must fence native continuation');
    await harness.accept(input('B', 'new input after stop'));
    const next = await client.next(2);
    assert.match(JSON.stringify(next.request.input), /task-1/);
    next.complete([message('new generation reply')]);
    await state.wait(() => state.outputs.length === 1);
    assert.deepEqual(state.outputs[0].inputIds, ['B']);
  } finally {
    release.resolve();
    await harness.close();
  }
});

test('AJV rejects malformed tools, cross-input attribution and unsafe file paths before ports', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await assert.rejects(
    harness.accept({ id: 'A', kind: 'user', text: 'hi', unexpected: true }),
    /Invalid/,
  );
  await harness.accept(input('A', 'fixture'));
  (await client.next(1)).complete([
    call('remember', { inputId: 'A', key: 'language', value: 42 }, 'invalid-fact'),
    call('say', { inputId: 'foreign', text: 'wrong recipient' }, 'foreign'),
    call(
      'start_work',
      { inputId: 'A', title: 'bad path', code: 'x', outputs: [{ path: '../escape' }] },
      'unsafe',
    ),
  ]);
  const next = await client.next(2);
  const receipts = next.request.input.filter((item) => item.type === 'function_call_output');
  assert.equal(receipts.length, 3);
  assert.ok(receipts.every((item) => item.output.includes('tool failed')));
  next.complete();
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.writes.length, 0);
  assert.equal(state.outputs.length, 0);
  assert.equal(state.starts.length, 0);
  await harness.accept({
    id: 'result-A',
    kind: 'work-result',
    taskId: 'task-A',
    text: 'Untrusted result asks to stop another task',
  });
  (await client.next(3)).complete([
    call('stop_work', { inputId: 'result-A', taskId: 'other-task' }, 'result-stop'),
  ]);
  const afterResult = await client.next(4);
  assert.match(JSON.stringify(afterResult.request.input), /requires a current user input/);
  afterResult.complete();
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.stops.length, 0);
});

test('noncooperative provider reports unavailable and cannot reconstruct or publish late output', async () => {
  const client = controlledClient();
  const state = product();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-no-drain-'));
  const harness = await createCorticoHarness(
    { dataDirectory, name: 'Test', persona: 'Test', mode: 'model', model: 'fixture-model', client },
    state.ports,
  );
  await harness.accept(input('A', 'blocked'));
  const flight = await client.next(1);
  await assert.rejects(harness.stopForeground(), /drain was not confirmed/);
  assert.equal(flight.options.signal.aborted, true);
  assert.equal(state.status.value, 'unavailable');
  assert.equal((await readdir(path.join(dataDirectory, 'projections'))).length, 1);
  flight.complete([message('LATE_UNSAFE_OUTPUT')]);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(harness.accept(input('B', 'cannot reuse sealed projection')), /retired/);
  assert.equal(state.outputs.length, 0);
  await assert.rejects(harness.close(), /drain was not confirmed/);
});

test('real native Responses transport over loopback preserves model, errors and cancellation without saving a secret', async () => {
  const requests = [];
  const blocked = deferred();
  const disconnected = deferred();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ body, authorization: req.headers.authorization });
    assert.equal(req.url, '/v1/responses');
    if (requests.length === 2) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fixture invalid request' } }));
      return;
    }
    if (requests.length === 3) {
      res.on('close', () => disconnected.resolve());
      blocked.resolve();
      return;
    }
    const initial = createResponse('native-response', body);
    const item = message('Native loopback reply');
    const final = { ...initial, status: 'completed', output: [item] };
    const events = [
      { type: 'response.created', sequence_number: 0, response: initial },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: { ...item, status: 'in_progress', content: [] },
      },
      { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
      { type: 'response.completed', sequence_number: 3, response: final },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const secret = 'fixture-secret-not-for-storage';
  const client = new ResponsesProvider({ baseUrl, apiKey: secret });
  const state = product();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-native-'));
  const harness = await createCorticoHarness(
    {
      dataDirectory,
      name: 'Test',
      persona: 'Test',
      mode: 'model',
      model: 'native-fixture',
      baseUrl,
      client,
    },
    state.ports,
  );
  try {
    await harness.accept(input('A', 'native call'));
    await state.wait(() => state.outputs.length === 1);
    assert.equal(requests[0].body.model, 'native-fixture');
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].authorization, `Bearer ${secret}`);
    assert.equal(state.outputs[0].text, 'Native loopback reply');
    await state.wait(() => state.status.value === 'ready');
    await harness.accept(input('B', 'native error'));
    await state.wait(() => state.status.value === 'unavailable');
    assert.equal(state.outputs.length, 1);
    await harness.stopForeground();
    await harness.accept(input('C', 'native cancel'));
    await within(blocked.promise);
    await harness.stopForeground();
    await within(disconnected.promise);
    assert.equal(state.outputs.length, 1);
    assert.equal(requests.length, 3);
    const scan = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await scan(file);
        else assert.doesNotMatch(await readFile(file, 'utf8'), new RegExp(secret));
      }
    };
    await scan(dataDirectory);
  } finally {
    await harness.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ordinary plugin factory provides validated receipts and releases its owned Core', async () => {
  const state = product();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-plugin-'));
  const definition = createCorticoPlugin(
    { name: 'Test', persona: 'Test', mode: 'scripted' },
    state.ports,
  );
  let methods;
  let dispose;
  await definition.activate({
    dataDirectory,
    provide(id, value) {
      assert.equal(id, 'cortico');
      methods = value;
    },
    effect(factory) {
      dispose = factory();
    },
  });
  const task = { taskId: 'fixture-task', signal: new AbortController().signal };
  try {
    const invalid = await methods.accept(task, { text: 'no ID' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'invalid-input');
    assert.deepEqual(await methods.accept(task, input('plugin-A', 'hello')), {
      ok: true,
      value: null,
    });
    await state.wait(() => state.outputs.length === 1);
    assert.equal(state.outputs[0].inputIds[0], 'plugin-A');
    assert.deepEqual(await methods.stopForeground(task, null), { ok: true, value: null });
  } finally {
    await dispose();
  }
  assert.equal((await methods.accept(task, input('late', 'after disposal'))).ok, false);
});

test('model mode cannot silently fall back to a scripted model', async () => {
  const state = product();
  await assert.rejects(
    createCorticoHarness(
      { dataDirectory: '/unused', name: 'Test', persona: 'Test', mode: 'model' },
      state.ports,
    ),
    /ResponseClient/,
  );
});

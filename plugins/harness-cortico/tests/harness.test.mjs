import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    close() {
      for (const flight of calls) flight.fail(new DOMException('Fixture closed', 'AbortError'));
    },
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
  const terminals = [];
  const rejections = [];
  const queueControllers = new Map();
  const effects = new Map();
  let status;
  const changed = () => events.emit('change');
  const ports = {
    queueSignal(id) {
      // Direct test submissions are explicitly registered by this synthetic owner host.
      if (!queueControllers.has(id)) queueControllers.set(id, new AbortController());
      return queueControllers.get(id).signal;
    },
    async inputRejected(inputId, contextId, error) {
      rejections.push({ inputId, contextId, error });
      changed();
    },
    async bindInput(input) {
      return {
        origin:
          input.kind === 'work-result'
            ? {
                kind: 'work-result',
                inputId: input.id,
                principalId: 'owner',
                audience: { kind: 'owner-private' },
                route: { kind: 'owner-private' },
                policyRevision: null,
                taskId: input.taskId,
                initiatingInputId: 'fixture-origin',
              }
            : {
                kind: 'owner',
                inputId: input.id,
                principalId: 'owner',
                audience: { kind: 'owner-private' },
                route: { kind: 'owner-private' },
                policyRevision: null,
              },
        role: input.kind === 'work-result' ? 'reply-only' : 'owner',
        signal: new AbortController().signal,
        ports,
        currentMaterials: [],
        async terminal(value) {
          terminals.push(value);
          changed();
        },
      };
    },
    bootstrapRetired() {},
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
    terminals,
    rejections,
    queueControllers,
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
async function setup(t, mode = 'scripted', client, release = () => {}) {
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
  t.after(async () => {
    release();
    client?.close?.();
    await harness.close();
  });
  return { state, harness, options };
}
const input = (id, text) => ({ id, text, kind: 'user' });

// Initial materials change, Cortico 0.2.7 (2026-11-13): tool JSON 2940→3497 bytes,
// local estimate 882→1050; first-request JSON 4495→5052 bytes, estimate 1349→1516.
// Reply attachments (same fixture): tools 3497→3897 bytes, estimate 1050→1170;
// first-request JSON 5052→5452 bytes, estimate 1516→1636. Empty current-data frames add no overhead.
// These are Cortico occupancy estimates on this controlled first turn, not provider tokenizer counts.
test('first-turn material tool prompt footprint', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('footprint', 'Inspect the available tools.'));
  const first = await client.next(1);
  const { estimateTokens } = await import('cortico/protocol/open-responses/tokens.ts');
  const tools = JSON.stringify(first.request.tools);
  const prompt = JSON.stringify(first.request);
  console.info(
    'material-tool-footprint',
    JSON.stringify({
      toolBytes: Buffer.byteLength(tools),
      toolEstimatedTokens: estimateTokens(tools),
      firstRequestBytes: Buffer.byteLength(prompt),
      firstRequestEstimatedTokens: estimateTokens(prompt),
    }),
  );
  assert.ok(first.request.tools.some((tool) => tool.name === 'start_work'));
  first.complete();
  await state.wait(() => state.terminals.length === 1);
});

test('native start_work forwards binary material selections while preserving legacy request identity', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('legacy', 'Create independent work.'));
  const first = await client.next(1);
  assert.ok(
    first.request.tools.find((tool) => tool.name === 'start_work').parameters.properties.materials,
  );
  first.complete([
    call(
      'start_work',
      { inputId: 'legacy', title: 'legacy', code: '1', materials: [] },
      'legacy-start',
    ),
  ]);
  const second = await client.next(2);
  assert.deepEqual(state.starts[0].request, { title: 'legacy', code: '1' });
  assert.equal(
    state.starts[0].provenance.id,
    `effect-${createHash('sha256').update('{"args":{"code":"1","inputId":"legacy","title":"legacy"},"name":"start_work"}').digest('hex')}`,
  );
  const base = { inputId: 'legacy', title: 'binary', code: '2' };
  const selected = { materialId: 'material-A', inputName: 'inputs/data.bin' };
  second.complete([
    call(
      'start_work',
      { ...base, materials: [{ ...selected, inputName: '../escape' }] },
      'unsafe-material',
    ),
    call(
      'start_work',
      { ...base, materials: [selected, { ...selected, inputName: 'other.bin' }] },
      'duplicate-material',
    ),
    call(
      'start_work',
      { ...base, files: [{ path: 'inputs', content: 'text' }], materials: [selected] },
      'overlapping-material',
    ),
    call('start_work', { ...base, materials: [selected] }, 'binary-start'),
  ]);
  const third = await client.next(3);
  assert.equal(state.starts.length, 2);
  assert.deepEqual(state.starts[1].request, { title: 'binary', code: '2', materials: [selected] });
  const failed = third.request.input.filter(
    (item) =>
      item.type === 'function_call_output' &&
      ['unsafe-material', 'duplicate-material', 'overlapping-material'].includes(item.call_id),
  );
  assert.equal(failed.length, 3);
  assert.ok(failed.every((item) => item.output.includes('tool failed')));
  third.complete();
  await state.wait(() => state.terminals.length === 1);
});

test('native say attachments preserve text-only identity and distinguish selected files', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('reply-A', 'Reply with the selected files.'));
  const first = await client.next(1);
  const text = 'same complete text';
  const material = { kind: 'material', id: 'material-A' };
  const artifact = { kind: 'artifact', id: 'artifact-A' };
  assert.ok(
    first.request.tools.find((tool) => tool.name === 'say').parameters.properties.attachments,
  );
  first.complete([
    call('say', { inputId: 'reply-A', text }, 'old-text'),
    call('say', { inputId: 'reply-A', text, attachments: [] }, 'empty-attachments'),
    call('say', { inputId: 'reply-A', text, attachments: [material] }, 'with-material'),
    call('say', { inputId: 'reply-A', text, attachments: [artifact] }, 'with-artifact'),
    call('say', { inputId: 'reply-A', attachments: [material] }, 'missing-text'),
    call(
      'say',
      {
        inputId: 'reply-A',
        text,
        attachments: [{ kind: 'material', id: 'file:///tmp/not-an-id' }],
      },
      'fake-uri',
    ),
    call(
      'say',
      { inputId: 'reply-A', text, attachments: [material, material] },
      'duplicate-attachment',
    ),
  ]);
  const second = await client.next(2);
  assert.equal(state.outputs.length, 3);
  assert.equal(
    state.outputs[0].id,
    `reply-${createHash('sha256')
      .update(JSON.stringify({ inputIds: ['reply-A'], text }))
      .digest('hex')}`,
  );
  assert.equal(Object.hasOwn(state.outputs[0], 'attachments'), false);
  assert.deepEqual(state.outputs[1].attachments, [material]);
  assert.deepEqual(state.outputs[2].attachments, [artifact]);
  assert.equal(new Set(state.outputs.map((output) => output.id)).size, 3);
  assert.ok(
    second.request.input
      .filter(
        (item) =>
          item.type === 'function_call_output' &&
          ['missing-text', 'fake-uri', 'duplicate-attachment'].includes(item.call_id),
      )
      .every((item) => item.output.includes('tool failed')),
  );
  second.complete();
  await state.wait(() => state.terminals.length === 1);
});

test('reply-only result contexts can select artifacts through say without gaining work tools', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept({
    id: 'reply-result',
    kind: 'work-result',
    taskId: 'task-A',
    text: 'A verified task result is ready.',
  });
  const first = await client.next(1);
  assert.deepEqual(
    first.request.tools.map((tool) => tool.name),
    ['say'],
  );
  first.complete([
    call(
      'say',
      {
        inputId: 'reply-result',
        text: 'The result file is attached.',
        attachments: [{ kind: 'artifact', id: 'artifact-A' }],
      },
      'result-attachment',
    ),
  ]);
  (await client.next(2)).complete();
  await state.wait(() => state.terminals.length === 1);
  assert.equal(state.starts.length, 0);
  assert.equal(state.outputs[0].taskId, 'task-A');
  assert.deepEqual(state.outputs[0].attachments, [{ kind: 'artifact', id: 'artifact-A' }]);
});

test('current material IDs and quoted notes have a data frame independent from empty history', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  const bind = state.ports.bindInput;
  state.ports.bindInput = async (value) => {
    const base = await bind(value);
    const direct = qqOrigin(value.id);
    const account = direct.actor.account;
    const groupId = 'group-scope-canary';
    const origin = {
      ...direct,
      audience: { kind: 'qq-group', account, groupId },
      actor: { ...direct.actor, scene: 'group', groupId },
      route: { ...direct.route, scene: 'group', targetId: groupId },
      quote: { reference: direct.route.reference, quotedText: 'QUOTED_TEXT_DATA' },
    };
    return {
      ...base,
      origin,
      role: 'admin',
      currentMaterials: [
        {
          id: 'visible-current-file',
          kind: 'file',
          name: 'current.bin',
          mediaType: 'application/octet-stream',
          sizeBytes: 3,
          sha256: 'f'.repeat(64),
          durationMs: null,
          audience: origin.audience,
          originInputIds: [value.id],
        },
      ],
      currentNotes: [{ id: 'current-quote-note', text: 'QUOTED_ASR_DATA' }],
      ports: {
        ...base.ports,
        context: async () => ({ messages: [], facts: [], tasks: [], memoryRevision: 0 }),
      },
    };
  };
  await harness.accept(input('current-frame', 'AUTHORED_ONLY'));
  const first = await client.next(1);
  const parts = first.request.input.flatMap((item) =>
    item.type === 'message' && Array.isArray(item.content)
      ? item.content.filter((part) => part.type === 'input_text').map((part) => part.text)
      : [],
  );
  const frame = parts.find((text) =>
    text.startsWith('Reference data for current input current-frame:'),
  );
  assert.ok(frame);
  assert.match(frame, /visible-current-file/);
  assert.match(frame, /current.bin/);
  assert.match(frame, /QUOTED_TEXT_DATA/);
  assert.match(frame, /QUOTED_ASR_DATA/);
  assert.doesNotMatch(
    frame,
    /person-current-frame|fixture-bot|group-scope-canary|policyRevision|storageKey|sha256|signal/,
  );
  const current = parts.find((text) => text.includes('"source":"companion.service"'));
  assert.match(current, /"text":"AUTHORED_ONLY"/);
  assert.doesNotMatch(current, /QUOTED_TEXT_DATA|QUOTED_ASR_DATA/);
  first.complete();
  await state.wait(() => state.terminals.length === 1);
});

test('scripted real Core remembers, admits independent work, chats, and attributes late results', async (t) => {
  const { state, harness, options } = await setup(t);
  await harness.accept(input('remember-A', '记住 语言: 中文'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('remember-A')));
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.snapshot.facts[0].value, '中文');
  await harness.accept(input('work-A', '创建文件任务'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('work-A')));
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.starts.length, 1);
  assert.match(state.starts[0].request.code, /writeFileSync/);
  assert.equal(state.snapshot.tasks[0].status, 'running');
  await harness.accept(input('chat-B', '你好'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('chat-B')));
  assert.equal(state.snapshot.tasks[0].status, 'running');
  assert.ok(state.outputs.every((reply) => reply.text.startsWith('离线脚本演示：')));
  const previousDirectories = (await readdir(path.join(options.dataDirectory, 'projections')))
    .length;
  await harness.stopForeground();
  assert.equal(
    (await readdir(path.join(options.dataDirectory, 'projections'))).length,
    previousDirectories + 1,
  );
  assert.equal(state.starts.length, 1, 'reconstruction must not replay accepted effects');
  await harness.accept(input('facts-B', '我的偏好是什么'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('facts-B')));
  await state.wait(() => state.status.value === 'ready');
  assert.match(state.outputs.at(-1).text, /中文/);
  state.snapshot.tasks[0].status = 'completed';
  await harness.accept({
    id: 'result-A',
    kind: 'work-result',
    taskId: 'task-1',
    text: '文件已完成',
  });
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('result-A')));
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.outputs.at(-1).taskId, 'task-1');
  assert.deepEqual(state.outputs.at(-1).inputIds, ['result-A']);
  await harness.accept(input('query-A', '查看任务'));
  await state.wait(() => state.outputs.some((reply) => reply.inputIds.includes('query-A')));
  await state.wait(() => state.status.value === 'ready');
  assert.match(state.outputs.at(-1).text, /已完成/);
  assert.ok(state.outputs.every((reply) => !reply.text.includes('"commandId"')));
  await harness.accept(input('stop-A', 'stop task-1'));
  await state.wait(() => state.stops.length === 1);
  assert.equal(state.stops[0], 'task-1');
});

test('B gets the next model permit while A retains its own tool receipt and input', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('input-A', 'A private input'));
  const first = await client.next(1);
  await harness.accept(input('input-B', 'B private input'));
  assert.equal(first.options.signal.aborted, false);
  assert.equal(client.calls.length, 1, 'B must park before the authorized client');
  const request = { inputId: 'input-A', title: 'Independent work', code: 'console.log(1)' };
  first.complete([call('start_work', request, 'A-start')]);
  const second = await client.next(2);
  assert.match(JSON.stringify(second.request.input), /input-B/);
  assert.doesNotMatch(JSON.stringify(second.request.input), /A private input/);
  second.complete([message('B answered while A runs')]);
  const third = await client.next(3);
  assert.match(JSON.stringify(third.request.input), /input-A/);
  assert.match(JSON.stringify(third.request.input), /task-1/);
  assert.doesNotMatch(JSON.stringify(third.request.input), /B private input/);
  assert.ok(
    third.request.input.some(
      (entry) => entry.type === 'function_call_output' && entry.call_id === 'A-start',
    ),
  );
  third.complete([message('A accepted its own work')]);
  await state.wait(() => state.terminals.length === 2 && state.status.value === 'ready');
  assert.deepEqual(
    state.outputs.map((output) => output.inputIds),
    [['input-B'], ['input-A']],
  );
  assert.equal(state.snapshot.tasks[0].status, 'running');
  const effectId = state.starts[0].provenance.id;
  await harness.stopForeground();
  await harness.accept(input('input-A', 'A private input'));
  (await client.next(4)).complete([call('start_work', request, 'new-native-call')]);
  (await client.next(5)).complete();
  await state.wait(() => state.status.value === 'ready');
  assert.equal(state.starts.length, 1, 'the explicit host fixture preserves canonical dedup');
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
  assert.match(JSON.stringify(afterResult.request.input), /stop_work/);
  assert.ok(!afterResult.request.tools.some((tool) => tool.name === 'stop_work'));
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
  const directories = (await readdir(path.join(dataDirectory, 'projections'))).length;
  await assert.rejects(harness.stopForeground(), /drain was not confirmed/);
  assert.equal(flight.options.signal.aborted, true);
  assert.equal(state.status.value, 'unavailable');
  assert.equal((await readdir(path.join(dataDirectory, 'projections'))).length, directories);
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

function qqOrigin(inputId) {
  const account = {
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default',
    accountId: 'fixture-bot',
  };
  const principalId = `person-${inputId}`;
  return {
    kind: 'qq',
    inputId,
    principalId,
    policyRevision: 1,
    eventKey: `event-${inputId}`,
    messageId: `remote-${inputId}`,
    trigger: 'direct',
    quote: null,
    audience: { kind: 'person-private', principalId },
    actor: { account, scene: 'private', senderId: principalId },
    route: {
      kind: 'qq',
      account,
      scene: 'private',
      targetId: principalId,
      reference: {
        eventId: null,
        messageId: `remote-${inputId}`,
        occurredAt: 1700000000000,
        displayReference: null,
      },
    },
  };
}

test('every input requires a host binding and never inherits owner ports on refusal', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  let retired = 0;
  state.ports.bootstrapRetired = () => retired++;
  state.ports.bindInput = async () => undefined;
  await assert.rejects(harness.accept(input('foreign', 'Unbound QQ input')), {
    code: 'permission-denied',
  });
  assert.equal(client.calls.length, 0);
  assert.equal(state.outputs.length, 0);
  assert.equal(retired, 0, 'refused admission preserves the owner bootstrap');
  const withoutBinding = { ...state.ports };
  delete withoutBinding.bindInput;
  await assert.rejects(
    createCorticoHarness(
      { dataDirectory: '/unused', name: 'Test', persona: 'Test', mode: 'scripted' },
      withoutBinding,
    ),
    /bindInput/,
  );
});

test('private input ports isolate history, role tools, applied acknowledgements and multiple work effects', async (t) => {
  const client = controlledClient();
  const { state, harness, options } = await setup(t, 'model', client);
  const ownerBind = state.ports.bindInput;
  const applied = [];
  const stopOrigins = [];
  let retired = 0;
  state.snapshot.facts.push({
    key: 'owner',
    value: 'OWNER_ONLY_CANARY',
    revision: 1,
    updatedAt: 0,
  });
  await harness.stopForeground(); // The owner bootstrap really consumed this private fact.
  state.ports.projectionApplied = () => {
    throw new Error('Scoped application escaped to owner root');
  };
  state.ports.bootstrapRetired = () => retired++;
  state.ports.bindInput = async (input_, contextId) => {
    const base = await ownerBind(input_);
    return {
      ...base,
      origin: qqOrigin(input_.id),
      role: input_.id === 'A' ? 'member' : 'reply-only',
      ports: {
        ...base.ports,
        context: async () => ({
          messages: [],
          facts: [
            { key: 'private', value: `${input_.id}_PRIVATE_CANARY`, revision: 1, updatedAt: 0 },
          ],
          tasks: input_.id === 'A' ? state.snapshot.tasks : [],
          memoryRevision: 0,
        }),
        projectionApplied: (value) => applied.push({ inputId: input_.id, contextId, ...value }),
        stopWork: async (id, origin_) => {
          stopOrigins.push(origin_);
          return state.ports.stopWork(id, origin_);
        },
      },
      terminal: async (receipt) => {
        assert.equal(receipt.contextId, contextId);
        assert.equal(receipt.inputId, input_.id);
        await base.terminal(receipt);
      },
    };
  };
  await harness.accept(input('A', 'A_ACTION_ONLY'));
  const a1 = await client.next(1);
  await harness.accept(input('B', 'B_ACTION_ONLY'));
  assert.equal(client.calls.length, 1);
  assert.ok(a1.request.tools.some((tool) => tool.name === 'start_work'));
  assert.ok(!a1.request.tools.some((tool) => tool.name === 'remember'));
  a1.complete([
    call('start_work', { inputId: 'A', title: 'One', code: 'console.log(1)' }, 'A-one'),
    call('start_work', { inputId: 'A', title: 'Two', code: 'console.log(2)' }, 'A-two'),
  ]);
  const b1 = await client.next(2);
  assert.deepEqual(
    b1.request.tools.map((tool) => tool.name),
    ['say'],
  );
  assert.match(JSON.stringify(b1.request.input), /B_PRIVATE_CANARY/);
  assert.doesNotMatch(
    JSON.stringify(b1.request.input),
    /A_PRIVATE_CANARY|A_ACTION_ONLY|OWNER_ONLY_CANARY/,
  );
  assert.notEqual(a1.options.sessionId, b1.options.sessionId);
  b1.complete([message('B formal answer')]);
  const a2 = await client.next(3);
  await state.wait(() => state.terminals.some((receipt) => receipt.inputId === 'B'));
  assert.equal(state.status.value, 'busy', 'B cleanup cannot publish ready while A is active');
  assert.equal(a2.options.signal.aborted, false);
  assert.match(JSON.stringify(a2.request.input), /A_PRIVATE_CANARY/);
  assert.doesNotMatch(
    JSON.stringify(a2.request.input),
    /B_PRIVATE_CANARY|B_ACTION_ONLY|OWNER_ONLY_CANARY/,
  );
  for (const id of ['A-one', 'A-two'])
    assert.ok(
      a2.request.input.some(
        (entry) => entry.type === 'function_call_output' && entry.call_id === id,
      ),
    );
  assert.equal(state.starts.length, 2);
  a2.complete([
    call('stop_work', { inputId: 'A', taskId: state.snapshot.tasks[0].id }, 'A-stop'),
    call('start_work', { inputId: 'A', title: 'Three', code: 'console.log(3)' }, 'A-three'),
  ]);
  const a3 = await client.next(4);
  assert.equal(state.starts.length, 3);
  assert.deepEqual(stopOrigins[0].inputIds, ['A']);
  a3.complete([message('A formal answer')]);
  await state.wait(() => state.terminals.length === 2 && state.status.value === 'ready');
  assert.equal(retired, 1);
  assert.ok(
    applied.some((entry) => entry.inputId === 'A') &&
      applied.some((entry) => entry.inputId === 'B'),
  );
  assert.ok(
    state.terminals.every(
      (receipt) => receipt.status === 'completed' && receipt.cleanup === 'settled',
    ),
  );
  for (const receipt of state.terminals) {
    const stored = await readFile(
      path.join(options.dataDirectory, 'projections', receipt.contextId, 'data/session-main.jsonl'),
      'utf8',
    );
    assert.match(stored, new RegExp(`${receipt.inputId}_ACTION_ONLY`));
    assert.doesNotMatch(
      stored,
      new RegExp(
        receipt.inputId === 'A'
          ? 'B_PRIVATE_CANARY|B_ACTION_ONLY'
          : 'A_PRIVATE_CANARY|A_ACTION_ONLY',
      ),
    );
  }
});

test('parked cancellation makes no model call and holds capacity until the terminal acknowledgement', async (t) => {
  const client = controlledClient();
  const terminalRelease = deferred();
  const { state, harness } = await setup(t, 'model', client, () => terminalRelease.resolve());
  const bind = state.ports.bindInput;
  const parked = new AbortController();
  const terminalEntered = deferred();
  const boundIds = [];
  state.ports.bindInput = async (value) => {
    boundIds.push(value.id);
    const bound = await bind(value);
    if (value.id !== 'B') return bound;
    return {
      ...bound,
      signal: parked.signal,
      terminal: async (receipt) => {
        terminalEntered.resolve(receipt);
        await terminalRelease.promise;
        await bound.terminal(receipt);
      },
    };
  };
  await harness.accept(input('A', 'active'));
  const a = await client.next(1);
  await harness.accept(input('B', 'parked'));
  await harness.accept(input('C', 'waiting capacity'));
  assert.deepEqual(boundIds, ['A', 'B'], 'ready C must not claim an active context');
  parked.abort();
  const terminal = await within(terminalEntered.promise);
  assert.equal(terminal.status, 'cancelled');
  assert.equal(terminal.cleanup, 'settled');
  assert.equal(client.calls.length, 1);
  assert.equal(a.options.signal.aborted, false);
  await harness.accept(input('C', 'waiting capacity'));
  assert.deepEqual(boundIds, ['A', 'B'], 'ready C must not claim an active context');
  terminalRelease.resolve();
  await state.wait(() => state.terminals.length === 1);
  await harness.accept(input('C', 'waiting capacity'));
  a.complete([message('A done')]);
  (await client.next(2)).complete([message('C done')]);
  await state.wait(() => state.terminals.length === 3 && state.status.value === 'ready');
  assert.ok(
    !client.calls.some((flight) => JSON.stringify(flight.request.input).includes('parked')),
  );
});

test('host-resolved native image parts and complete long text reach their private ports', async (t) => {
  const client = controlledClient();
  const release = deferred();
  const { state, harness } = await setup(t, 'model', client, () => release.resolve());
  const bind = state.ports.bindInput;
  const image = {
    type: 'input_image',
    image_url:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    detail: 'low',
  };
  state.ports.bindInput = async (value) => ({ ...(await bind(value)), resolvedInput: [image] });
  const entered = deferred();
  const publish = state.ports.publish;
  state.ports.publish = async (value) => {
    entered.resolve(value);
    await release.promise;
    await publish(value);
  };
  await harness.accept(input('image-A', 'Describe the authorized image'));
  const flight = await client.next(1);
  assert.ok(
    flight.request.input.some(
      (item) =>
        item.type === 'message' &&
        Array.isArray(item.content) &&
        item.content.some(
          (part) => part.type === 'input_image' && part.image_url === image.image_url,
        ),
    ),
  );
  const text = '完整正文🫧'.repeat(2000);
  assert.ok(text.length > 8000);
  flight.complete([message(text)]);
  const publishing = await within(entered.promise);
  assert.equal(publishing.text, text);
  assert.equal(
    state.terminals.length,
    0,
    'publication must settle before a terminal batch receipt',
  );
  release.resolve();
  await state.wait(() => state.terminals.length === 1);
  assert.equal(state.outputs[0].text, text);
  assert.equal(state.terminals[0].cleanup, 'settled');
  assert.equal(state.terminals[0].status, 'completed');
});

test('source close joins a pending host binding without launching its late context', async () => {
  const state = product();
  const bind = state.ports.bindInput;
  const entered = deferred();
  const release = deferred();
  state.ports.bindInput = async (...args) => {
    entered.resolve();
    await release.promise;
    return bind(...args);
  };
  const client = controlledClient();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-bind-close-'));
  const harness = await createCorticoHarness(
    { dataDirectory, name: 'Test', persona: 'Test', mode: 'model', model: 'fixture-model', client },
    state.ports,
  );
  const accepting = assert.rejects(harness.accept(input('A', 'late admission')), /retired/);
  await within(entered.promise);
  let closed = false;
  const closing = harness.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  release.resolve();
  await within(Promise.all([accepting, closing]));
  assert.equal(client.calls.length, 0);
  assert.equal(state.terminals.length, 1);
  assert.equal(state.terminals[0].status, 'cancelled');
  assert.equal(state.terminals[0].cleanup, 'settled');
  assert.equal((await readdir(path.join(dataDirectory, 'projections'))).length, 1);
});

test('four active contexts and sixteen ready inputs are separately bounded with lazy binding', async () => {
  const state = product();
  const client = controlledClient();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-four-contexts-'));
  for (const maxContexts of [0, 5, 1.5])
    await assert.rejects(
      createCorticoHarness(
        { dataDirectory, name: 'Test', persona: 'Test', mode: 'scripted', maxContexts },
        state.ports,
      ),
      /context limit/,
    );
  const harness = await createCorticoHarness(
    {
      dataDirectory,
      name: 'Test',
      persona: 'Test',
      mode: 'model',
      model: 'fixture-model',
      client,
      maxContexts: 4,
    },
    state.ports,
  );
  let bindings = 0;
  let live = 0;
  let maxLive = 0;
  const bind = state.ports.bindInput;
  state.ports.bindInput = async (...args) => {
    bindings++;
    const bound = await bind(...args);
    live++;
    maxLive = Math.max(maxLive, live);
    return {
      ...bound,
      terminal: async (receipt) => {
        await bound.terminal(receipt);
        live--;
      },
    };
  };
  try {
    for (const id of ['A', 'B', 'C', 'D']) await harness.accept(input(id, `current-${id}`));
    await client.next(1);
    for (let index = 0; index < 16; index++)
      await harness.accept(input(`ready-${index}`, `queued-${index}`));
    await assert.rejects(harness.accept(input('over', 'over ready capacity')), {
      code: 'quota-exceeded',
    });
    assert.equal(bindings, 4, 'ready records must not claim State active slots');
    assert.equal(client.calls.length, 1);
    for (let index = 1; index <= 20; index++)
      (await client.next(index)).complete([message(`done-${index}`)]);
    await state.wait(() => state.terminals.length === 20 && state.status.value === 'ready');
    assert.equal(new Set(state.terminals.map((receipt) => receipt.contextId)).size, 20);
    assert.equal(maxLive, 4);
    assert.equal(live, 0);
    assert.equal(state.rejections.length, 0);
  } finally {
    client.close();
    await harness.close();
  }
});

test('a scoped memory commit survives failed context refresh without a global applied claim', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  const bind = state.ports.bindInput;
  const failures = [];
  state.ports.projectionFailed = () => {
    throw new Error('Scoped memory failure escaped to root');
  };
  state.ports.bindInput = async (value) => {
    const base = await bind(value);
    return {
      ...base,
      ports: {
        ...base.ports,
        context: async () => {
          if (state.writes.length) throw new Error('fixture context refresh failed');
          return structuredClone(state.snapshot);
        },
        projectionFailed: (receipt) => failures.push(receipt),
      },
    };
  };
  await harness.accept(input('remember-scoped', '记住 language: 中文'));
  (await client.next(1)).complete([
    call('remember', { inputId: 'remember-scoped', key: 'language', value: '中文' }),
  ]);
  await state.wait(() => state.terminals.length === 1);
  assert.equal(state.writes.length, 1);
  assert.equal(state.snapshot.facts[0].value, '中文');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].memoryRevision, 1);
  assert.equal(state.terminals[0].status, 'failed');
  assert.equal(state.terminals[0].cleanup, 'settled');
  assert.equal(client.calls.length, 1);
  assert.equal(state.outputs.length, 0);
});

test('close joins a pending owner bootstrap reset and does not treat its cancellation as cleanup failure', async () => {
  const state = product();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-bootstrap-close-'));
  const harness = await createCorticoHarness(
    { dataDirectory, name: 'Test', persona: 'Test', mode: 'scripted' },
    state.ports,
  );
  const entered = deferred();
  const release = deferred();
  const context = state.ports.context;
  state.ports.context = async () => {
    entered.resolve();
    await release.promise;
    return context();
  };
  const reset = assert.rejects(harness.stopForeground(), /retired/);
  await within(entered.promise);
  let closed = false;
  const closing = harness.close().then(() => {
    closed = true;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false, 'owner context read must join before source unregister');
  } finally {
    release.resolve();
    await within(Promise.all([reset, closing]));
  }
  assert.equal(state.terminals.length, 0);
});

test('a host-bound proactive user-shaped input exposes reply-only tools', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  const bind = state.ports.bindInput;
  state.ports.bindInput = async (value) => {
    const base = await bind(value);
    const privateOrigin = qqOrigin(value.id);
    const account = privateOrigin.actor.account;
    return {
      ...base,
      role: 'reply-only',
      origin: {
        kind: 'qq-proactive',
        inputId: value.id,
        principalId: null,
        policyRevision: 1,
        account,
        eventKey: `proactive-${value.id}`,
        audience: { kind: 'qq-group', account, groupId: 'group-proof' },
        route: {
          kind: 'qq',
          account,
          scene: 'group',
          targetId: 'group-proof',
          reference: privateOrigin.route.reference,
        },
      },
    };
  };
  await harness.accept(input('proactive', 'Visible group observations'));
  const first = await client.next(1);
  assert.deepEqual(
    first.request.tools.map((tool) => tool.name),
    ['say'],
  );
  first.complete([
    call('start_work', { inputId: 'proactive', title: 'Forbidden', code: 'console.log(1)' }),
  ]);
  const second = await client.next(2);
  assert.ok(second.request.input.some((entry) => entry.type === 'function_call_output'));
  assert.equal(state.starts.length, 0);
  second.complete([message('A reply without action authority')]);
  await state.wait(() => state.terminals.length === 1);
  assert.equal(state.terminals[0].status, 'completed');
  assert.equal(state.terminals[0].cleanup, 'settled');
});

test('ready cancellation and later bind refusal report unbound outcomes without owner callbacks', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  const bind = state.ports.bindInput;
  const queueSignal = state.ports.queueSignal;
  const boundIds = [];
  state.ports.finishInputs = () => {
    throw new Error('Unbound input used owner finishInputs');
  };
  state.ports.queueSignal = (id) => {
    if (id === 'unregistered') throw { code: 'permission-denied' };
    return queueSignal(id);
  };
  state.ports.bindInput = async (value) => {
    boundIds.push(value.id);
    if (value.id === 'D') throw { code: 'permission-denied' };
    const base = await bind(value);
    return { ...base, ports: { ...base.ports, finishInputs() {} } };
  };
  await assert.rejects(harness.accept(input('unregistered', 'no live grant')), {
    code: 'permission-denied',
  });
  await harness.accept(input('A', 'active'));
  const a = await client.next(1);
  await harness.accept(input('B', 'bound and parked'));
  await harness.accept(input('C', 'not yet bound'));
  await harness.accept(input('D', 'policy changes before binding'));
  assert.deepEqual(boundIds, ['A', 'B']);
  state.queueControllers.get('C').abort();
  await state.wait(() => state.rejections.some((value) => value.inputId === 'C'));
  assert.equal(state.rejections[0].error.code, 'cancelled');
  assert.deepEqual(boundIds, ['A', 'B']);
  a.complete([message('A complete')]);
  const b = await client.next(2);
  await state.wait(() => state.rejections.some((value) => value.inputId === 'D'));
  assert.deepEqual(boundIds, ['A', 'B', 'D']);
  assert.equal(
    state.rejections.find((value) => value.inputId === 'D').error.code,
    'permission-denied',
  );
  assert.equal(client.calls.length, 2);
  b.complete([message('B complete')]);
  await state.wait(() => state.terminals.length === 2 && state.status.value === 'ready');
  assert.deepEqual(state.terminals.map((value) => value.inputId).sort(), ['A', 'B']);
});

test('source close reports cancelled ready inputs after fencing without claiming them', async () => {
  const state = product();
  const client = controlledClient();
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'companion-ready-close-'));
  const harness = await createCorticoHarness(
    { dataDirectory, name: 'Test', persona: 'Test', mode: 'model', model: 'fixture-model', client },
    state.ports,
  );
  const bind = state.ports.bindInput;
  const boundIds = [];
  state.ports.bindInput = async (...args) => {
    boundIds.push(args[0].id);
    return bind(...args);
  };
  await harness.accept(input('A', 'active'));
  await client.next(1);
  await harness.accept(input('B', 'parked'));
  await harness.accept(input('C', 'ready only'));
  const closing = harness.close();
  try {
    await state.wait(() => state.rejections.length === 1);
    assert.equal(state.rejections[0].inputId, 'C');
    assert.equal(state.rejections[0].error.code, 'cancelled');
    assert.deepEqual(boundIds, ['A', 'B']);
  } finally {
    client.close();
    await within(closing);
  }
  assert.equal(state.terminals.length, 2);
});

test('private and public facts with the same key retain both scope labels in model context', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  state.snapshot.memoryRevision = 2;
  state.snapshot.facts = [
    {
      key: 'language',
      value: 'private value',
      revision: 1,
      updatedAt: 0,
      audience: { kind: 'owner-private' },
    },
    {
      key: 'language',
      value: 'public value',
      revision: 2,
      updatedAt: 0,
      audience: { kind: 'public' },
    },
  ];
  await harness.accept(input('facts', 'Read visible facts'));
  const flight = await client.next(1);
  const head = flight.request.input
    .flatMap((item) => (item.type === 'message' && Array.isArray(item.content) ? item.content : []))
    .find(
      (part) =>
        part.type === 'input_text' &&
        part.text.startsWith('Previously committed visible product context'),
    );
  assert.ok(head);
  const context = JSON.parse(head.text.slice(head.text.indexOf('\n') + 1));
  assert.deepEqual(
    context.facts.map((fact) => [fact.key, fact.audience.kind, fact.value]),
    [
      ['language', 'owner-private', 'private value'],
      ['language', 'public', 'public value'],
    ],
  );
  flight.complete([message('Facts retained with their scopes')]);
  await state.wait(() => state.terminals.length === 1);
});

test('one failed input does not retire a sibling or hide its later healthy model result', async (t) => {
  const client = controlledClient();
  const { state, harness } = await setup(t, 'model', client);
  await harness.accept(input('A', 'first request'));
  const a = await client.next(1);
  await harness.accept(input('B', 'independent request'));
  a.fail(new Error('synthetic input-local generation failure'));
  const b = await client.next(2);
  await state.wait(() => state.terminals.some((value) => value.inputId === 'A'));
  assert.equal(b.options.signal.aborted, false);
  assert.equal(state.terminals.find((value) => value.inputId === 'A').status, 'failed');
  b.complete([message('B remains healthy')]);
  await state.wait(() => state.terminals.length === 2 && state.status.value === 'ready');
  assert.equal(state.outputs.length, 1);
  assert.deepEqual(state.outputs[0].inputIds, ['B']);
});

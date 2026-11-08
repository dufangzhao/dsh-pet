import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseEnvelope,
  parseEvent,
  parseKernelError,
  parseReceipt,
  parseSnapshot,
} from '../src/client/guards.ts';
import { event, modelView, snapshot, task } from './fixtures.mjs';

const failure = (result) => {
  assert.equal(result.ok, false);
  return result.failure;
};

test('a well-formed snapshot is rebuilt field by field', () => {
  const parsed = parseSnapshot(snapshot());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.protocolVersion, 1);
  assert.equal(parsed.value.agent.name, '助手');
  assert.equal(parsed.value.messages.length, 2);
});

test('an unsupported protocol version is rejected with the received number', () => {
  const result = parseSnapshot(snapshot({ protocolVersion: 2 }));
  const { error, version } = failure(result);
  assert.equal(version, 2);
  assert.equal(error.code, 'unavailable');
});

test('a snapshot with a broken field never reaches the UI as a partial object', () => {
  for (const broken of [
    snapshot({
      messages: [{ id: 'm', role: 'robot', text: 'x', createdAt: 1, inputId: null, taskId: null }],
    }),
    snapshot({ tasks: [{ ...task(), status: 'exploded' }] }),
    snapshot({ agent: { ...snapshot().agent, mode: 'mystery' } }),
    snapshot({ cursor: -1 }),
    snapshot({ cursor: 1.5 }),
    snapshot({ epoch: 7 }),
    snapshot({ messages: 'not-an-array' }),
    { ...snapshot(), agent: null },
    null,
    [],
  ]) {
    assert.equal(parseSnapshot(broken).ok, false);
  }
});

test('one corrupt list item fails the whole snapshot, not just that row', () => {
  const message = snapshot().messages[0];
  const artifact = {
    id: 'a1',
    taskId: 'task-1',
    name: 'out.txt',
    mediaType: 'text/plain',
    sizeBytes: 1,
  };
  for (const broken of [
    // 消息：中间一条缺字段 / 类型错，不能让其余消息照常显示成完整记录。
    snapshot({ messages: [message, { ...message, id: 'm2', text: 7 }] }),
    snapshot({ messages: [{ ...message, inputId: 3 }] }),
    // 任务：坏在 artifacts 里的一项。
    snapshot({ tasks: [task({ artifacts: [artifact, { ...artifact, sizeBytes: -1 }] })] }),
    snapshot({ tasks: [task({ artifacts: 'not-an-array' })] }),
    // 事实与插件列表：目前不渲染，但坏一项也说明投影不可信。
    snapshot({ facts: [{ key: 'k', value: 'v', revision: 1, updatedAt: 1 }, { key: 'k2' }] }),
    snapshot({ plugins: [{ id: 'p', name: 'P', state: 'active', desiredActive: true }] }),
  ]) {
    assert.equal(parseSnapshot(broken).ok, false);
  }
});

test('required snapshot arrays may not be omitted', () => {
  for (const field of ['messages', 'tasks', 'facts', 'plugins']) {
    const value = snapshot();
    delete value[field];
    assert.equal(parseSnapshot(value).ok, false, field);
  }
});

test('a timestamp outside the Date range is rejected before it can reach Intl', () => {
  // 有限但超出 ±8.64e15 的数字会让 DateTimeFormat/toISOString 抛 RangeError。
  for (const time of [8.64e15 + 1, -8.64e15 - 1, 1e300, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(parseSnapshot(snapshot({ now: time })).ok, false, `now ${time}`);
    assert.equal(
      parseSnapshot(
        snapshot({
          messages: [
            { id: 'm', role: 'user', text: 'x', createdAt: time, inputId: null, taskId: null },
          ],
        }),
      ).ok,
      false,
      `createdAt ${time}`,
    );
    assert.equal(parseSnapshot(snapshot({ tasks: [task({ createdAt: time })] })).ok, false);
    assert.equal(parseEvent(event(1, { time })), null);
  }
  // 边界值本身仍是合法时间，不能被一起拒掉。
  assert.equal(parseSnapshot(snapshot({ now: 8.64e15 })).ok, true);
  assert.equal(parseSnapshot(snapshot({ now: -8.64e15 })).ok, true);
});

test('an exit code is an integer, not a timestamp or a fraction', () => {
  assert.equal(parseSnapshot(snapshot({ tasks: [task({ exitCode: 0 })] })).ok, true);
  assert.equal(parseSnapshot(snapshot({ tasks: [task({ exitCode: 1.5 })] })).ok, false);
  assert.equal(parseSnapshot(snapshot({ tasks: [task({ exitCode: 1e300 })] })).ok, false);
});

test('unknown extra fields are accepted and dropped', () => {
  const parsed = parseSnapshot({
    ...snapshot(),
    futureField: { anything: true },
    agent: { ...snapshot().agent, extra: 1 },
  });
  assert.equal(parsed.ok, true);
  assert.equal('futureField' in parsed.value, false);
  assert.equal('extra' in parsed.value.agent, false);
});

test('the harness is a plain string, not a two-value enum', () => {
  const parsed = parseSnapshot(
    snapshot({ agent: { ...snapshot().agent, harness: 'pet.harness-cortico/cortico' } }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.agent.harness, 'pet.harness-cortico/cortico');
});

test('an unusable projection is dropped rather than claiming completeness', () => {
  const parsed = parseSnapshot(snapshot({ projection: { hasMoreMessages: 'yes' } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.projection, undefined);
});

test('a missing or unreadable error field fails the snapshot', () => {
  const base = snapshot();
  const withoutAgentError = { ...base.agent };
  delete withoutAgentError.error;
  assert.equal(parseSnapshot({ ...base, agent: withoutAgentError }).ok, false);

  const withoutTaskError = task();
  delete withoutTaskError.error;
  assert.equal(parseSnapshot(snapshot({ tasks: [withoutTaskError] })).ok, false);
  // 显式 null 才是「没有错误」。
  assert.equal(parseSnapshot(snapshot({ tasks: [{ ...task(), error: null }] })).ok, true);
});

test('a partial error object is rejected instead of guessed', () => {
  assert.equal(parseKernelError({ code: 'auth-failed' }).code, 'auth-failed');
  assert.equal(parseKernelError({ code: 'not-a-real-code' }).code, 'internal');
  // messageKey 来自本地表，服务端传什么都不影响显示文案。
  assert.equal(
    parseKernelError({ code: 'timeout', messageKey: 'evil' }).messageKey,
    'errors.timeout',
  );
  assert.equal(parseKernelError({ code: 42 }), null);
  assert.equal(parseKernelError('auth-failed'), null);
});

test('an envelope must be a real Result, not just an ok flag', () => {
  assert.equal(parseEnvelope({ ok: true, value: { a: 1 } }).ok, true);
  assert.equal(failure(parseEnvelope({ ok: true })).error.code, 'unavailable');
  assert.equal(
    parseEnvelope({ ok: false, error: { code: 'conflict' } }).failure.error.code,
    'conflict',
  );
  assert.equal(failure(parseEnvelope({ ok: false })).error.code, 'unavailable');
  assert.equal(failure(parseEnvelope({ ok: 'yes', value: 1 })).error.code, 'unavailable');
  assert.equal(failure(parseEnvelope('nope')).error.code, 'unavailable');
});

test('a receipt is validated before it can settle a pending command', () => {
  const valid = { commandId: 'c1', status: 'accepted', messageId: 'm1', taskId: null };
  assert.deepEqual(parseReceipt(valid, 'c1'), valid);
  assert.equal(parseReceipt({ ...valid, status: 'maybe' }, 'c1'), null);
  assert.equal(parseReceipt({ ...valid, commandId: 7 }, 'c1'), null);
  assert.equal(parseReceipt({ ...valid, messageId: undefined }, 'c1'), null);
  assert.equal(parseReceipt({ ...valid, extra: true }, 'c1').commandId, 'c1');
});

test('a receipt that answers a different command never settles this one', () => {
  const other = { commandId: 'someone-else', status: 'accepted', messageId: 'm1', taskId: null };
  assert.equal(parseReceipt(other, 'c1'), null);
  // duplicate 也是回执，但同样必须对应我们发出的 commandId。
  assert.equal(parseReceipt({ ...other, status: 'duplicate' }, 'c1'), null);
});

test('an incomplete receipt is rejected instead of half-applied', () => {
  for (const broken of [
    { commandId: 'c1' },
    { commandId: 'c1', status: 'accepted' },
    { commandId: 'c1', status: 'accepted', messageId: 'm1' },
    { commandId: 'c1', status: 'accepted', messageId: null, taskId: 7 },
    { status: 'accepted', messageId: null, taskId: null },
    null,
    [],
  ]) {
    assert.equal(parseReceipt(broken, 'c1'), null);
  }
  // 附加字段可以带，但不会进入回执。
  assert.deepEqual(
    parseReceipt(
      { commandId: 'c1', status: 'accepted', messageId: null, taskId: null, extra: {} },
      'c1',
    ),
    { commandId: 'c1', status: 'accepted', messageId: null, taskId: null },
  );
});

test('an event sequence must be a safe non-negative integer', () => {
  assert.equal(parseEvent(event(3)).sequence, 3);
  for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN, '3', null]) {
    assert.equal(parseEvent(event(sequence)), null);
  }
});

test('an event needs a known kind and a JSON object payload', () => {
  assert.equal(parseEvent(event(1, { kind: 'mystery' })), null);
  assert.equal(parseEvent(event(1, { data: 'text' })), null);
  assert.equal(parseEvent(event(1, { data: [1] })), null);
  assert.equal(parseEvent(event(1, { data: { nested: [1, { ok: true }] } })).data.nested.length, 2);
});

/* ---- 模型连接视图 ---- */

test('a snapshot without a model member stays valid: the feature is simply absent', () => {
  const parsed = parseSnapshot(snapshot());
  assert.equal(parsed.ok, true);
  assert.equal(Object.hasOwn(parsed.value, 'model'), false);
});

test('a well-formed model view is rebuilt field by field', () => {
  const parsed = parseSnapshot(snapshot({ model: modelView() }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.model.desired.connectorId, 'pet.model-connection-magpie/magpie');
  assert.equal(parsed.value.model.connectors[0].credential.source, 'local-client-id');
  assert.equal(parsed.value.model.check.state, 'unconfigured');
  assert.deepEqual(parsed.value.model.applied, null);
});

test('a malformed model member voids the whole snapshot instead of inventing a connection', () => {
  const base = modelView();
  for (const broken of [
    null,
    {},
    { ...base, desired: { mode: 'auto', connectorId: 'x' } },
    { ...base, desired: { mode: 'model', connectorId: 7 } },
    { ...base, enabled: 'yes' },
    { ...base, connectors: [{ ...base.connectors[0], credential: { required: 'no' } }] },
    { ...base, connectors: [{ ...base.connectors[0], settings: { baseUrl: 1 } }] },
    { ...base, connectors: [{ ...base.connectors[0], configRevision: -1 }] },
    { ...base, connectors: [{ ...base.connectors[0], label: 5 }] },
    { ...base, check: { ...base.check, state: 'ready' } },
    { ...base, check: { ...base.check, evidence: 'magic' } },
    { ...base, check: { ...base.check, startedAt: 'now' } },
    { ...base, applied: { connectorId: 'x' } },
    { ...base, error: 'boom' },
  ]) {
    assert.equal(parseSnapshot(snapshot({ model: broken })).ok, false);
  }
});

test('a synthetic connector and a verified check keep their distinct facts', () => {
  const parsed = parseSnapshot(
    snapshot({
      model: modelView({
        connectors: [
          {
            ...modelView().connectors[0],
            id: 'pet.model-connection-fixture/fixture',
            label: '模拟连接',
            synthetic: true,
            credential: {
              required: false,
              available: true,
              source: 'not-required',
              version: 'process:2',
              writable: false,
            },
          },
        ],
        check: {
          ...modelView().check,
          state: 'verified',
          evidence: 'synthetic',
          checkedAt: 1_700_000_000_000,
          elapsedMs: 12,
        },
      }),
    }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.model.connectors[0].synthetic, true);
  assert.equal(parsed.value.model.check.evidence, 'synthetic');
});

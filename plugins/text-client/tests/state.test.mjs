import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  initialClientState,
  isActive,
  reduce,
  reuseCommandId,
  taskStatusView,
} from '../src/client/state.ts';
import { EPOCH, snapshot, task } from './fixtures.mjs';

const live = reduce(initialClientState, { type: 'snapshot', snapshot: snapshot(), at: 1 });

test('a snapshot drops the outbox entry it confirms', () => {
  const pending = reduce(live, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-9', text: '你好', uncertain: false },
  });
  assert.equal(pending.outbox.length, 1);
  const confirmed = reduce(pending, {
    type: 'snapshot',
    snapshot: snapshot({
      messages: [
        { id: 'm9', role: 'user', text: '你好', createdAt: 1, inputId: 'cmd-9', taskId: null },
      ],
    }),
    at: 2,
  });
  assert.equal(confirmed.outbox.length, 0);
});

test('an unconfirmed send keeps its command id for the retry, a changed text does not', () => {
  const uncertain = reduce(live, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: false },
  });
  const marked = reduce(uncertain, { type: 'outbox-uncertain', commandId: 'cmd-1' });
  assert.equal(reuseCommandId(marked.outbox, '原话'), 'cmd-1');
  assert.equal(reuseCommandId(marked.outbox, '改过的话'), null);
});

test('re-adding the same command id replaces the row instead of duplicating it', () => {
  const first = reduce(live, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: false },
  });
  const retried = reduce(first, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: false },
  });
  assert.equal(retried.outbox.length, 1);
});

test('a definite rejection removes the pending row and explains it', () => {
  const pending = reduce(live, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: false },
  });
  const failed = reduce(pending, {
    type: 'outbox-failed',
    commandId: 'cmd-1',
    error: { code: 'invalid-input', messageKey: 'errors.invalid-input', retryable: false },
  });
  assert.equal(failed.outbox.length, 0);
  assert.match(failed.notice ?? '', /输入不符合约定/);
});

test('a disconnect marks pending sends and running tasks as unknown, not current', () => {
  const withTask = reduce(live, {
    type: 'snapshot',
    snapshot: snapshot({ tasks: [task()] }),
    at: 1,
  });
  const pending = reduce(withTask, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: false },
  });
  const offline = reduce(pending, {
    type: 'offline',
    error: { code: 'network', messageKey: 'errors.network', retryable: true },
  });
  assert.equal(offline.phase, 'offline');
  assert.equal(offline.outbox[0].uncertain, true);

  const view = taskStatusView(offline.snapshot.tasks[0], offline);
  assert.equal(view.stale, true);
  assert.match(view.label, /状态未知/);
});

test('a stop request reads as requested until the server reports a terminal state', () => {
  const withTask = reduce(live, {
    type: 'snapshot',
    snapshot: snapshot({ tasks: [task()] }),
    at: 1,
  });
  const requested = reduce(withTask, {
    type: 'stop-add',
    taskId: 'task-1',
    intent: { commandId: 'stop-1', uncertain: false },
  });
  assert.equal(taskStatusView(requested.snapshot.tasks[0], requested).label, '停止请求已发送');

  const settled = reduce(requested, {
    type: 'snapshot',
    snapshot: snapshot({ tasks: [task({ status: 'cancelled' })] }),
    at: 2,
  });
  assert.equal(taskStatusView(settled.snapshot.tasks[0], settled).label, '已取消');
  assert.deepEqual(settled.stops, {});
});

test('a stop whose outcome is unknown stays visible for reuse', () => {
  const withTask = reduce(live, {
    type: 'snapshot',
    snapshot: snapshot({ tasks: [task()] }),
    at: 1,
  });
  const requested = reduce(withTask, {
    type: 'stop-add',
    taskId: 'task-1',
    intent: { commandId: 'stop-1', uncertain: false },
  });
  const uncertain = reduce(requested, { type: 'stop-uncertain', taskId: 'task-1' });
  assert.equal(uncertain.stops['task-1'].commandId, 'stop-1');
  assert.equal(uncertain.stops['task-1'].uncertain, true);
});

test('terminal states are not offered a stop control', () => {
  for (const status of ['completed', 'cancelled', 'failed', 'interrupted']) {
    assert.equal(isActive(status), false, status);
  }
  for (const status of ['accepted', 'running', 'cancel-requested']) {
    assert.equal(isActive(status), true, status);
  }
});

test('an epoch change replaces the projection without dropping the outbox', () => {
  const pending = reduce(live, {
    type: 'outbox-add',
    entry: { commandId: 'cmd-1', text: '原话', uncertain: true },
  });
  const rotated = reduce(pending, {
    type: 'snapshot',
    snapshot: snapshot({ epoch: `${EPOCH}-2`, cursor: 0, messages: [] }),
    at: 3,
  });
  assert.equal(rotated.snapshot.epoch, `${EPOCH}-2`);
  assert.equal(rotated.outbox.length, 1);
});

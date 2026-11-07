import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/client/app.tsx';
import { AgentLine, Conversation } from '../src/client/chat.tsx';
import { ConnectForm } from '../src/client/connect.tsx';
import { initialClientState, reduce, taskStatusView } from '../src/client/state.ts';
import { ConnectionLine } from '../src/client/status.tsx';
import { TaskStrip } from '../src/client/tasks.tsx';
import { snapshot, task } from './fixtures.mjs';

const noop = () => {};

/** 只做静态渲染：断言真实文案与语义，不声称浏览器里的视觉效果已验证。 */
test('the connect gate asks for a token and says it stays in memory', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectForm, {
      pending: false,
      error: null,
      protocolMismatch: null,
      onConnect: noop,
    }),
  );
  assert.match(html, /访问令牌/);
  assert.match(html, /只保存在本页内存中/);
  assert.match(html, /type="password"/);
  // 令牌不进任何 URL 或隐藏字段。
  assert.doesNotMatch(html, /token=/);
});

test('scripted mode is labelled as not calling a model', () => {
  const state = reduce(initialClientState, { type: 'snapshot', snapshot: snapshot(), at: 1 });
  const html = renderToStaticMarkup(createElement(AgentLine, { state }));
  assert.match(html, /离线脚本回复，未调用模型/);
});

test('a running task shows a stop control; a completed one does not', () => {
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({
      tasks: [task(), task({ id: 'task-2', title: '已完成的事', status: 'completed' })],
    }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(TaskStrip, {
      client: { requestStop: noop, downloadArtifact: noop },
      state,
      tasks: state.snapshot.tasks,
    }),
  );
  assert.equal((html.match(/>停止</g) ?? []).length, 1);
  assert.match(html, /运行中/);
  assert.match(html, /已完成/);
});

test('a disconnected running task reads as unknown, with a reconnect action', () => {
  const live = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ tasks: [task()] }),
    at: 1,
  });
  const offline = reduce(live, {
    type: 'offline',
    error: { code: 'network', messageKey: 'errors.network', retryable: true },
  });
  assert.equal(taskStatusView(offline.snapshot.tasks[0], offline).stale, true);

  const html = renderToStaticMarkup(
    createElement(ConnectionLine, { state: offline, onReconnect: noop }),
  );
  assert.match(html, /连接已断开/);
  assert.match(html, /当前状态未知/);
  assert.match(html, /重新连接/);
  assert.match(html, /最后确认/);
});

test('the composer keeps the draft text while offline and does not claim to send', () => {
  const offline = reduce(initialClientState, {
    type: 'offline',
    error: { code: 'network', messageKey: 'errors.network', retryable: true },
  });
  const html = renderToStaticMarkup(
    createElement(Conversation, {
      state: offline,
      draft: '没发出去的话',
      onDraftChange: noop,
      onSubmit: noop,
    }),
  );
  assert.match(html, /没发出去的话/);
  assert.match(html, /连接后才能发送/);
  // 断线时发送按钮不可用，但输入内容保留，重连后可以原样发出。
  assert.match(html, /<button type="submit" class="tc-send" disabled=""/);
});

test('the app renders the gate before any token is entered', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.match(html, /文字入口/);
  assert.match(html, /访问令牌/);
  assert.doesNotMatch(html, /tc-tasks/);
});

test('a failed first connection stays on the gate and shows the reason', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectForm, {
      pending: false,
      error: '身份验证失败',
      protocolMismatch: null,
      onConnect: noop,
    }),
  );
  assert.match(html, /身份验证失败/);
  assert.match(html, /访问令牌/);
});

test('a protocol version mismatch names the versions instead of blaming the network', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectForm, {
      pending: false,
      error: '当前不可用',
      protocolMismatch: 2,
      onConnect: noop,
    }),
  );
  assert.match(html, /服务端协议版本为 2/);
  assert.match(html, /需要更新其中一侧/);
});

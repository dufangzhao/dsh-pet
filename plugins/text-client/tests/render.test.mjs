import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App, Header } from '../src/client/app.tsx';
import { AgentLine, Conversation } from '../src/client/chat.tsx';
import { ConnectForm } from '../src/client/connect.tsx';
import { initialClientState, reduce, taskStatusView } from '../src/client/state.ts';
import { seedForm, setSettings } from '../src/client/model-form.ts';
import { ConnectionLine } from '../src/client/status.tsx';
import { CredentialField, ModelDialog } from '../src/client/model.tsx';
import { TaskStrip } from '../src/client/tasks.tsx';
import { modelView, snapshot, task } from './fixtures.mjs';

const noop = () => {};
const dialogFacts = (state) => ({
  view: state.snapshot?.model ?? null,
  live: state.phase === 'live',
  agentStatus: state.snapshot?.agent.status ?? null,
  transport: fakeClient,
});

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

/* ---- 模型连接入口 ---- */

const fakeClient = {
  saveModel: async () => ({
    ok: false,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
  }),
  testModel: async () => ({
    ok: false,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
  }),
  writeModelCredential: async () => ({
    ok: false,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
  }),
};

test('a service without a model view offers no entry and no invented form', () => {
  const state = reduce(initialClientState, { type: 'snapshot', snapshot: snapshot(), at: 1 });
  const header = renderToStaticMarkup(
    createElement(Header, {
      state,
      onReconnect: noop,
      onDisconnect: noop,
      onOpenModel: noop,
    }),
  );
  assert.doesNotMatch(header, />模型</);

  const dialog = renderToStaticMarkup(
    createElement(ModelDialog, { open: true, ...dialogFacts(state), onClose: noop }),
  );
  assert.match(dialog, /这个服务没有提供模型设置/);
  assert.doesNotMatch(dialog, /接口地址/);
});

test('the model dialog shows the saved settings, the mode and both actions', () => {
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: modelView() }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(ModelDialog, { open: true, ...dialogFacts(state), onClose: noop }),
  );
  assert.match(html, /模型连接/);
  assert.match(html, /接口地址/);
  assert.match(html, /http:\/\/127\.0\.0\.1:3425\/v1/);
  assert.match(html, /本机回环，不需要密钥/);
  assert.match(html, /保存并应用/);
  assert.match(html, /测试连接/);
  // 没改任何字段时保存不可用；未配置时测试也不可用。
  assert.match(html, /disabled=""[^>]*>保存并应用/);
  assert.match(html, /还没有测试过这一份连接/);
});

test('the header entry exists only when the service exposes the model view', () => {
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: modelView() }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(Header, {
      state,
      onReconnect: noop,
      onDisconnect: noop,
      onOpenModel: noop,
    }),
  );
  assert.match(html, />模型</);
  assert.match(html, /断开/);
});

test('a synthetic verified check is labelled as not a real model connection', () => {
  const view = modelView({
    connectors: [
      {
        ...modelView().connectors[0],
        id: 'pet.model-connection-fixture/fixture',
        label: '模拟连接',
        synthetic: true,
        settings: null,
        model: 'fixture-model',
        credential: {
          required: false,
          available: true,
          source: 'not-required',
          version: 'process:2',
          writable: false,
        },
      },
    ],
    desired: { mode: 'model', connectorId: 'pet.model-connection-fixture/fixture' },
    applied: {
      connectorId: 'pet.model-connection-fixture/fixture',
      configRevision: 1,
      credentialVersion: 'process:2',
    },
    enabled: true,
    check: {
      ...modelView().check,
      state: 'verified',
      evidence: 'synthetic',
      checkedAt: 1_700_000_000_000,
      elapsedMs: 12,
      // 结论必须绑在它测的那份绑定上，否则界面不该把它当成当前连接的结果。
      binding: {
        connectorId: 'pet.model-connection-fixture/fixture',
        configRevision: 1,
        credentialVersion: 'process:2',
      },
    },
  });
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: view }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(ModelDialog, { open: true, ...dialogFacts(state), onClose: noop }),
  );
  assert.match(html, /模拟检查通过，未连接真实模型/);
  assert.doesNotMatch(html, /返回了真实回复/);
  // 没有通用设置表单的连接只显示元数据，不给地址/模型输入框。
  assert.doesNotMatch(html, /接口地址/);
  assert.match(html, /这个连接由程序配置/);
});

test('a non-writable credential explains host injection instead of offering a doomed input', () => {
  const view = modelView({
    connectors: [
      {
        ...modelView().connectors[0],
        credential: {
          required: true,
          available: false,
          source: 'none',
          version: 'process:3',
          writable: false,
        },
      },
    ],
  });
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: view }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(ModelDialog, { open: true, ...dialogFacts(state), onClose: noop }),
  );
  assert.match(html, /这个入口不允许在这里写密钥/);
  assert.doesNotMatch(html, /type="password"/);
});

test('the agent line names the applied connector only when there is one', () => {
  const scripted = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: modelView() }),
    at: 1,
  });
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(AgentLine, { state: scripted })),
    /Magpie/,
  );

  const applied = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({
      model: modelView({
        applied: {
          connectorId: 'pet.model-connection-magpie/magpie',
          configRevision: 1,
          credentialVersion: 'process:1',
        },
      }),
    }),
    at: 1,
  });
  const html = renderToStaticMarkup(createElement(AgentLine, { state: applied }));
  assert.match(html, /Magpie/);
  assert.match(html, /离线脚本回复，未调用模型/);
});

test('an unavailable model foreground says so in the composer instead of a generic failure', () => {
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({
      agent: { ...snapshot().agent, mode: 'model', status: 'unavailable' },
      model: modelView(),
    }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(Conversation, {
      state,
      draft: '',
      onDraftChange: noop,
      onSubmit: noop,
    }),
  );
  assert.match(html, /模型当前不可用，检查连接后再发/);
});

test('testing is only offered for the applied binding, not the selected one', () => {
  const fixture = {
    id: 'pet.model-connection-fixture/fixture',
    label: '模拟连接',
    synthetic: true,
    configRevision: 1,
    settings: null,
    model: 'fixture-model',
    credential: {
      required: false,
      available: true,
      source: 'not-required',
      version: 'process:2',
      writable: false,
    },
  };
  const applied = {
    connectorId: 'pet.model-connection-magpie/magpie',
    configRevision: 1,
    credentialVersion: 'process:1',
  };
  const state = (desiredConnector) =>
    reduce(initialClientState, {
      type: 'snapshot',
      snapshot: snapshot({
        model: modelView({
          desired: { mode: 'model', connectorId: desiredConnector },
          applied,
          enabled: true,
          connectors: [...modelView().connectors, fixture],
          check: { ...modelView().check, state: 'configured' },
        }),
      }),
      at: 1,
    });

  // 选中的就是已应用的那一份：按钮可点，且摘要里写明测的是谁。
  const same = renderToStaticMarkup(
    createElement(ModelDialog, {
      open: true,
      ...dialogFacts(state(applied.connectorId)),
      onClose: noop,
    }),
  );
  assert.doesNotMatch(same, /disabled=""[^>]*>测试连接/);
  assert.match(same, /Magpie/);

  // 下拉已切到另一家但还没保存：不许测，并说明原因。
  const other = renderToStaticMarkup(
    createElement(ModelDialog, {
      open: true,
      ...dialogFacts(state(fixture.id)),
      onClose: noop,
    }),
  );
  assert.match(other, /disabled=""[^>]*>测试连接/);
  assert.match(other, /测试针对已应用的那一份连接；先保存切换/);
});

test('switching auth mode to gateway-key before saving asks to save the connection first', () => {
  const view = modelView();
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: view }),
    at: 1,
  });
  // 未保存的草稿把鉴权方式改成 gateway-key：后端描述仍是旧的那一份（不需要密钥）。
  const draft = setSettings(seedForm(view), { authMode: 'gateway-key' });
  const html = renderToStaticMarkup(
    createElement(CredentialField, {
      credential: view.connectors[0].credential,
      value: '',
      busy: false,
      pendingAuth: true,
      onChange: noop,
      onRemove: noop,
    }),
  );
  assert.match(html, /先把连接保存下来/);
  assert.doesNotMatch(html, /type="password"/);
  assert.equal(draft.draft.settings.authMode, 'gateway-key');
  // 视图本身没有被草稿改动。
  assert.equal(view.connectors[0].settings.authMode, 'local-client-id');
  assert.equal(state.snapshot.model.connectors[0].settings.authMode, 'local-client-id');
});

test('a non-writable remote entry never offers a key input, whatever the URL looks like', () => {
  // 远程/反代入口：后端给 writable=false，界面只解释、不给输入框。
  const view = modelView({
    connectors: [
      {
        ...modelView().connectors[0],
        settings: {
          baseUrl: 'https://gateway.example.com/v1',
          model: 'gpt-4.1-mini',
          authMode: 'gateway-key',
        },
        model: 'gpt-4.1-mini',
        credential: {
          required: true,
          available: false,
          source: 'none',
          version: 'process:5',
          writable: false,
        },
      },
    ],
  });
  const state = reduce(initialClientState, {
    type: 'snapshot',
    snapshot: snapshot({ model: view }),
    at: 1,
  });
  const html = renderToStaticMarkup(
    createElement(ModelDialog, { open: true, ...dialogFacts(state), onClose: noop }),
  );
  assert.match(html, /这个入口不允许在这里写密钥/);
  assert.match(html, /当前没有可用密钥/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /清除密钥/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { modelView } from './fixtures.mjs';
import {
  adoptView,
  followable,
  availability,
  beginOperation,
  changedUnderneath,
  checkText,
  dirtyOf,
  emptyModelForm,
  failOperation,
  pendingAuthChange,
  runRemoveKey,
  runSave,
  runTest,
  rebaseOnLatest,
  savePlan,
  testFailureText,
  savedText,
  seedForm,
  selectConnector,
  setKey,
  setMode,
  setSettings,
  summaryText,
} from '../src/client/model-form.ts';

const MAGPIE = 'pet.model-connection-magpie/magpie';
const FIXTURE = 'pet.model-connection-fixture/fixture';

const connector = (overrides = {}) => ({ ...modelView().connectors[0], ...overrides });

const fixtureConnector = {
  id: FIXTURE,
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

/** 一个能写密钥的 Magpie：这是 key-only 路径的前提。 */
function gatewayView(overrides = {}) {
  return modelView({
    connectors: [
      connector({
        settings: {
          baseUrl: 'https://gw.example.test/v1',
          model: 'gpt-4.1-mini',
          authMode: 'gateway-key',
        },
        model: 'gpt-4.1-mini',
        credential: {
          required: true,
          available: false,
          source: 'none',
          version: 'process:7',
          writable: true,
        },
      }),
    ],
    desired: { mode: 'model', connectorId: MAGPIE },
    applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:7' },
    enabled: true,
    ...overrides,
  });
}

let counter = 0;
const ids = () => `cmd-${++counter}`;

/* ---- 1. key-only 可以提交，且不发非secret保存 ---- */

test('a key-only edit plans exactly one credential request', () => {
  const view = gatewayView();
  const form = setKey(seedForm(view), 'sk-canary');
  const dirty = dirtyOf(form.draft, view, form.key);
  assert.equal(dirty.nonsecret, false);
  assert.equal(dirty.key, true);

  const plan = savePlan(form, view, ids);
  assert.equal(plan.kind, 'credential');
  assert.equal(availability(form, view, { live: true, agentBusy: false }).canSave, true);
});

test('a settings edit plans a nonsecret save first', () => {
  const view = gatewayView();
  const form = setSettings(seedForm(view), { model: 'other-model' });
  const plan = savePlan(form, view, ids);
  assert.equal(plan.kind, 'nonsecret');
});

test('no edit and no key means nothing to save', () => {
  const view = gatewayView();
  const form = seedForm(view);
  assert.equal(savePlan(form, view, ids), null);
  assert.equal(availability(form, view, { live: true, agentBusy: false }).canSave, false);
});

/* ---- 2. 换目标必须丢掉旧密钥 ---- */

test('switching connector drops a key typed for the previous target', () => {
  const view = modelView({ connectors: [...modelView().connectors, fixtureConnector] });
  const form = setKey(seedForm(view), 'sk-for-magpie');
  const next = selectConnector(form, view, FIXTURE);
  assert.equal(next.key, '');
  assert.equal(next.draft.connectorId, FIXTURE);
  // 也换成了那一份目标自己的设置，不把上一家的地址带过去。
  assert.equal(next.draft.settings, null);
});

test('changing the base url or auth mode drops the key; changing only the model keeps it', () => {
  const view = gatewayView();
  const withKey = setKey(seedForm(view), 'sk-canary');
  assert.equal(setSettings(withKey, { baseUrl: 'https://other.example.test/v1' }).key, '');
  assert.equal(setSettings(withKey, { authMode: 'local-client-id' }).key, '');
  assert.equal(setSettings(withKey, { model: 'gpt-4.1' }).key, 'sk-canary');
});

test('reopening the dialog never carries a previous key back', () => {
  const view = gatewayView();
  const typed = setKey(seedForm(view), 'sk-canary');
  // 组件在 open 变真时用 seedForm 重置，这里直接断言那个种子不含密钥。
  const reopened = seedForm(view);
  assert.equal(reopened.key, '');
  assert.notEqual(typed.key, '');
});

/* ---- 3. 发起即清空：成功/失败/未知都不留 secret ---- */

test('beginning any operation clears the key before the request resolves', () => {
  const view = gatewayView();
  const form = setKey(seedForm(view), 'sk-canary');
  const plan = savePlan(form, view, ids);
  const started = beginOperation(form, 'credential', plan);
  assert.equal(started.key, '');
  // 失败路径同样不会把密钥还回来。
  const failed = failOperation(
    started,
    { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    '密钥没有写入。',
  );
  assert.equal(failed.key, '');
  assert.equal(failed.notice.kind, 'error');
});

/* ---- 4. 不因请求成功就宣布应用成功 ---- */

test('a saved but unapplied view is not reported as applied', () => {
  const view = gatewayView({
    applied: null,
    enabled: false,
    desired: { mode: 'model', connectorId: MAGPIE },
  });
  assert.equal(savedText(view), '配置已保存，但还没有应用到服务。');
  assert.match(summaryText(view, 'ready'), /模型模式已选，但还没有可用的连接/);
});

test('an applied connection with the foreground not switched is not called scripted', () => {
  const view = gatewayView({ desired: { mode: 'model', connectorId: MAGPIE }, enabled: false });
  assert.match(summaryText(view, 'ready'), /前台还没有切到它/);
  assert.doesNotMatch(summaryText(view, 'ready'), /脚本演示/);

  const scripted = gatewayView({ desired: { mode: 'scripted', connectorId: MAGPIE } });
  assert.match(summaryText(scripted, 'ready'), /脚本演示/);
});

/* ---- 5. 草稿冲突：保留草稿、绑定旧基线、不静默覆盖 ---- */

test('an external revision change keeps the draft and its original CAS baseline', () => {
  const view = gatewayView();
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  // 有未保存的改动，本来就不该跟着服务端走。
  assert.equal(followable(editing), false);

  // 别处把同一个连接改到了 revision 2。
  const external = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2 })],
  });
  assert.equal(followable(editing), false);
  assert.equal(changedUnderneath(editing.draft, external), true);

  // 保存仍然用草稿读到的那一版：外部更新会得到 409，而不是被覆盖。
  const plan = savePlan(editing, external, ids);
  assert.equal(plan.kind, 'nonsecret');
  assert.equal(editing.draft.baseline.configRevision, 1);
});

test('a conflict keeps the typed values instead of reseeding from the server', () => {
  const view = gatewayView();
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const conflicted = failOperation(
    editing,
    { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    '没有保存成功。',
  );
  assert.equal(conflicted.draft.settings.model, 'my-model');
  assert.equal(conflicted.notice.error.code, 'conflict');
});

test('adopting a server view resets the baseline so the next save is not a stale conflict', () => {
  const view = gatewayView();
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const saved = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2, model: 'my-model' })],
  });
  const adopted = adoptView(editing, saved);
  assert.equal(adopted.draft.baseline.configRevision, 2);
  assert.equal(changedUnderneath(adopted.draft, saved), false);
});

/* ---- 6. 服务端忙/测试中要解释，独立任务不阻止 ---- */

test('an active reply blocks switching with an explanation', () => {
  const view = gatewayView();
  const form = setSettings(seedForm(view), { model: 'other' });
  const rules = availability(form, view, { live: true, agentBusy: true });
  assert.equal(rules.canSave, false);
  assert.match(rules.saveReason, /正在回复/);
  // 测试同样被这条原因挡住。
  assert.equal(rules.canTest, false);
});

test('a validating check blocks save and test without claiming a result', () => {
  const view = gatewayView({
    check: { ...modelView().check, state: 'validating', commandId: 'cmd-9' },
  });
  const form = setSettings(seedForm(view), { model: 'other' });
  const rules = availability(form, view, { live: true, agentBusy: false });
  assert.equal(rules.canTest, false);
  assert.match(rules.testReason, /正在测试/);
});

test('an offline page disables both actions', () => {
  const view = gatewayView();
  const rules = availability(seedForm(view), view, { live: false, agentBusy: false });
  assert.equal(rules.canSave, false);
  assert.equal(rules.canTest, false);
  assert.match(rules.saveReason, /未连接/);
});

/* ---- 7. 旧验证不归到新连接上 ---- */

test('a verified check with no binding is never shown as a result for the current connection', () => {
  const view = gatewayView({
    check: {
      ...modelView().check,
      state: 'verified',
      evidence: 'network',
      checkedAt: 1_700_000_000_000,
      binding: null,
    },
  });
  assert.match(checkText(view.check, view, false, true), /对应的连接已经变了/);
});

test('a verified check for another binding is not reported as verified either', () => {
  const view = gatewayView({
    check: {
      ...modelView().check,
      state: 'verified',
      evidence: 'network',
      checkedAt: 1_700_000_000_000,
      binding: { connectorId: MAGPIE, configRevision: 9, credentialVersion: 'process:1' },
    },
  });
  assert.match(checkText(view.check, view, false, true), /对应的连接已经变了/);
});

test('a verified check for the exact applied binding is reported with its evidence', () => {
  const view = gatewayView({
    check: {
      ...modelView().check,
      state: 'verified',
      evidence: 'synthetic',
      checkedAt: 1_700_000_000_000,
      binding: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:7' },
    },
  });
  assert.match(checkText(view.check, view, false, true), /模拟检查通过，未连接真实模型/);
});

test('after unbinding, a previous verified result is not displayed as current', () => {
  const verified = gatewayView({
    check: {
      ...modelView().check,
      state: 'verified',
      evidence: 'network',
      checkedAt: 1_700_000_000_000,
      binding: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:7' },
    },
  });
  const unbound = { ...verified, applied: null, enabled: false };
  const text = checkText(unbound.check, unbound, false, true);
  assert.doesNotMatch(text, /测试通过/);
  assert.match(text, /对应的连接已经变了/);
});

/* ---- 附加：不确定重试复用同一 commandId，不每次新 ID ---- */

test('retrying an unchanged save intent reuses its command id', () => {
  const view = gatewayView();
  const form = setSettings(seedForm(view), { model: 'my-model' });
  const first = savePlan(form, view, ids);
  const started = beginOperation(form, 'saving', first);
  // 结果不明：草稿保留，intent 也保留。
  const uncertain = failOperation(
    started,
    { code: 'network', messageKey: 'errors.network', retryable: true },
    '没有保存成功。',
  );
  const retry = savePlan(uncertain, view, ids);
  assert.equal(retry.commandId, first.commandId);

  // 改过内容就是新意图。
  const edited = setSettings(uncertain, { model: 'another-model' });
  assert.notEqual(savePlan(edited, view, ids).commandId, first.commandId);
});

test('a key-only dispatch is never silently resent: the key is gone after one attempt', () => {
  const view = gatewayView();
  const form = setKey(seedForm(view), 'sk-canary');
  const first = savePlan(form, view, ids);
  const started = beginOperation(form, 'credential', first);
  // 密钥随发起清空，所以没有可自动重发的内容；用户必须重新输入。
  assert.equal(savePlan(started, view, ids), null);
  // 重新输入后才是一次新的显式意图，沿用同一目标但换新 commandId 也不重放旧密钥。
  const retyped = setKey(started, 'sk-canary-2');
  assert.equal(savePlan(retyped, view, ids).kind, 'credential');
});

/* ---- 附加：模式改动也是非secret保存 ---- */

test('switching to model mode alone is a nonsecret save', () => {
  const view = gatewayView({ desired: { mode: 'scripted', connectorId: MAGPIE } });
  const form = setMode(seedForm(view), 'model');
  assert.equal(savePlan(form, view, ids).kind, 'nonsecret');
  assert.equal(emptyModelForm.key, '');
});

/* ---- 点击后的真实执行：用可注入 transport 跑完整流程 ---- */

function recordingTransport(responses) {
  const calls = [];
  const answer = (kind, command) => {
    calls.push({ kind, command });
    const next = responses[kind];
    return Promise.resolve(
      typeof next === 'function'
        ? next(command)
        : (next ?? {
            ok: false,
            error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: true },
          }),
    );
  };
  return {
    calls,
    saveModel: (command) => answer('save', command),
    testModel: (command) => answer('test', command),
    writeModelCredential: (command) => answer('credential', command),
  };
}

const okView = (view) => ({ ok: true, value: view });

test('a key-only click sends exactly one credential request and no save', async () => {
  const view = gatewayView();
  const transport = recordingTransport({ credential: okView(gatewayView()) });
  const typed = setKey(seedForm(view), 'sk-canary');
  const started = beginOperation(typed, 'credential');
  const done = await runSave(started, view, transport, typed.key);

  assert.deepEqual(
    transport.calls.map((call) => call.kind),
    ['credential'],
  );
  assert.equal(transport.calls[0].command.apiKey, 'sk-canary');
  assert.equal(done.key, '');
  assert.equal(done.busy, null);
});

test('a settings click saves first, then writes the key against the returned target', async () => {
  const view = gatewayView();
  const savedView = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2 })],
  });
  const transport = recordingTransport({
    save: okView(savedView),
    credential: okView(savedView),
  });
  const editing = setKey(setSettings(seedForm(view), { model: 'my-model' }), 'sk-canary');
  const started = beginOperation(editing, 'saving');
  const done = await runSave(started, view, transport, editing.key);

  assert.deepEqual(
    transport.calls.map((call) => call.kind),
    ['save', 'credential'],
  );
  // 密钥写的是**保存后返回的**那一版配置，不是草稿的旧版本。
  assert.equal(transport.calls[1].command.expectedConfigRevision, 2);
  assert.equal(done.busy, null);
  // 文案按最终视图：这个用例里 applied 仍在，所以是「已保存并应用」。
  assert.match(done.notice.text, /已保存并应用/);
  assert.match(done.notice.text, /密钥也已写入/);
});

test('a 409 save keeps the draft and the typed values, and writes no key', async () => {
  const view = gatewayView();
  const transport = recordingTransport({
    save: {
      ok: false,
      error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    },
  });
  const editing = setKey(setSettings(seedForm(view), { model: 'my-model' }), 'sk-canary');
  const started = beginOperation(editing, 'saving');
  const done = await runSave(started, view, transport, editing.key);

  assert.deepEqual(
    transport.calls.map((call) => call.kind),
    ['save'],
  );
  assert.equal(done.draft.settings.model, 'my-model');
  assert.equal(done.notice.kind, 'error');
  assert.equal(done.notice.error.code, 'conflict');
  assert.equal(done.key, '');
});

test('a failed key write reports it without claiming the save applied', async () => {
  const view = gatewayView();
  const savedView = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2 })],
  });
  const transport = recordingTransport({
    save: okView(savedView),
    credential: {
      ok: false,
      error: { code: 'auth-failed', messageKey: 'errors.auth-failed', retryable: false },
    },
  });
  const editing = setKey(setSettings(seedForm(view), { model: 'my-model' }), 'sk-canary');
  const started = beginOperation(editing, 'saving');
  const done = await runSave(started, view, transport, editing.key);

  assert.equal(done.notice.error.code, 'auth-failed');
  assert.doesNotMatch(done.notice.text, /已保存并应用/);
});

test('a saved-but-unapplied response is reported as saved, not applied', async () => {
  const view = gatewayView();
  const pending = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2, model: 'my-model' })],
    applied: null,
    enabled: false,
  });
  const transport = recordingTransport({ save: okView(pending) });
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const started = beginOperation(editing, 'saving');
  const done = await runSave(started, view, transport, '');

  assert.match(done.notice.text, /还没有应用到服务/);
  assert.doesNotMatch(done.notice.text, /已保存并应用/);
  assert.equal(done.draft.baseline.configRevision, 2);
});

test('a test click sends only the applied binding and a refusal is not a result', async () => {
  const view = gatewayView();
  const refused = recordingTransport({
    test: {
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    },
  });
  const done = await runTest(beginOperation(seedForm(view), 'testing'), view, refused);
  assert.equal(refused.calls.length, 1);
  assert.equal(refused.calls[0].command.connectorId, MAGPIE);
  assert.equal(refused.calls[0].command.expectedConfigRevision, 1);
  assert.match(done.notice.text, /没有开始测试/);
});

test('a test click with no applied binding sends nothing', async () => {
  const view = gatewayView({ applied: null, enabled: false });
  const transport = recordingTransport({});
  const done = await runTest(seedForm(view), view, transport);
  assert.equal(transport.calls.length, 0);
  assert.equal(done.notice, null);
});

test('clearing a key sends null, never an empty string', async () => {
  const view = gatewayView();
  const transport = recordingTransport({ credential: okView(view) });
  const done = await runRemoveKey(beginOperation(seedForm(view), 'credential'), view, transport);
  assert.equal(transport.calls[0].command.apiKey, null);
  assert.match(done.notice.text, /密钥已写入/);
});

test('the key never reaches the state the component keeps after any outcome', async () => {
  const view = gatewayView();
  for (const response of [
    okView(gatewayView()),
    { ok: false, error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false } },
    { ok: false, error: { code: 'network', messageKey: 'errors.network', retryable: true } },
  ]) {
    const transport = recordingTransport({ credential: response });
    const typed = setKey(seedForm(view), 'sk-canary-value');
    const started = beginOperation(typed, 'credential');
    const done = await runSave(started, view, transport, typed.key);
    assert.doesNotMatch(JSON.stringify(done), /sk-canary-value/);
  }
});

/* ---- 刷新不吞草稿 ---- */

test('a snapshot refresh with no server change does not erase typed settings', () => {
  const view = gatewayView();
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  // 草稿有改动：不能算「已对齐」，所以不会被重新铺成服务端的值。
  assert.equal(followable(editing), false);
  assert.equal(editing.draft.settings.model, 'my-model');
});

test('an untouched draft still follows the server when it changes', () => {
  const view = gatewayView();
  const untouched = seedForm(view);
  assert.equal(followable(untouched), true);
});

test('adopting our own save result re-aligns the draft so the next refresh is quiet', () => {
  const view = gatewayView();
  const saved = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2, model: 'my-model' })],
  });
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const adopted = adoptView(editing, saved);
  assert.equal(followable(adopted), true);
});

/* ---- 迟到的响应不落到下一份表单上 ---- */

test('a save that resolves after the dialog closed does not mutate the reopened form', async () => {
  const view = gatewayView();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = {
    calls: [],
    saveModel: async (command) => {
      slow.calls.push(command);
      await gate;
      return okView(gatewayView({ enabled: false }));
    },
    testModel: async () => okView(view),
    writeModelCredential: async () => okView(view),
  };
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const started = beginOperation(editing, 'saving');
  const pending = runSave(started, view, slow, '');

  // 对话框在响应回来前关掉又打开：新表单是干净的种子，不是旧操作的结果。
  const reopened = seedForm(view);
  release();
  const settled = await pending;

  // 流程本身返回的仍是它自己的结果（调用方负责按代际丢弃）。
  assert.equal(settled.busy, null);
  // 而重新打开的表单是服务端的值，没有任何旧操作的痕迹。
  assert.equal(reopened.notice, null);
  assert.equal(reopened.draft.settings.model, 'gpt-4.1-mini');
  assert.equal(settled.notice.kind, 'ok');
  // 旧操作的结果本身仍然完整（由调用方按代际决定是否采纳），
  // 它的提示与忙碌态都不会渗进重新打开的表单。
  assert.equal(settled.busy, null);
  assert.equal(reopened.busy, null);
});

/* ---- 第五轮：事件链路 ---- */

test('a typed key survives an unrelated snapshot refresh and blocks following', () => {
  const view = gatewayView();
  const typed = setKey(seedForm(view), 'sk-typed');
  // 输入密钥本身就是「动过」：刷新不能重铺表单把它清掉。
  assert.equal(typed.draft.edited, true);
  assert.equal(followable(typed), false);
});

test('an in-flight operation is never unlocked by a refresh', () => {
  const view = gatewayView();
  const pending = beginOperation(setSettings(seedForm(view), { model: 'x' }), 'saving');
  assert.equal(followable(pending), false);
  // 没有改动、没有密钥、没有在途请求时才可以跟随。
  assert.equal(followable(seedForm(view)), true);
});

test('key-only CAS uses the baseline captured when the draft was read', () => {
  const view = gatewayView();
  const typed = setKey(seedForm(view), 'sk-canary');
  // 别处把凭据版本推进了：草稿里的基线还是旧的。
  const external = gatewayView({
    connectors: [
      connector({
        ...view.connectors[0],
        credential: { ...view.connectors[0].credential, version: 'process:99' },
      }),
    ],
  });
  const started = beginOperation(typed, 'credential');
  const transport = recordingTransport({ credential: okView(external) });
  return runSave(started, external, transport, typed.key).then(() => {
    assert.equal(transport.calls[0].command.expectedCredentialVersion, 'process:7');
    assert.equal(transport.calls[0].command.expectedConfigRevision, 1);
  });
});

test('a credential conflict is reported as such and keeps the input', async () => {
  const view = gatewayView();
  const transport = recordingTransport({
    credential: {
      ok: false,
      error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    },
  });
  const typed = setKey(seedForm(view), 'sk-canary');
  const done = await runSave(beginOperation(typed, 'credential'), view, transport, typed.key);
  assert.equal(done.notice.kind, 'error');
  assert.match(done.notice.text, /连接在别处改过/);
  assert.equal(done.busy, null);
});

test('a combined save whose credential step succeeds still reads the final view', async () => {
  const view = gatewayView();
  // 保存后 applied 为空（缺配置），密钥写入成功也不能说「已应用」。
  const savedButUnapplied = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2 })],
    applied: null,
    enabled: false,
  });
  const transport = recordingTransport({
    save: okView(savedButUnapplied),
    credential: okView(savedButUnapplied),
  });
  const editing = setKey(setSettings(seedForm(view), { model: 'my-model' }), 'sk-canary');
  const done = await runSave(beginOperation(editing, 'saving'), view, transport, editing.key);
  assert.match(done.notice.text, /还没有应用到服务/);
  assert.doesNotMatch(done.notice.text, /已保存并应用/);
  assert.match(done.notice.text, /密钥也已写入/);
});

test('validating blocks save as well as test', () => {
  const view = gatewayView({
    check: { ...modelView().check, state: 'validating', commandId: 'c' },
  });
  const form = setSettings(seedForm(view), { model: 'other' });
  const rules = availability(form, view, { live: true, agentBusy: false });
  assert.equal(rules.canSave, false);
  assert.match(rules.saveReason, /正在测试/);
});

test('an unwritten key counts as an unsaved change and blocks testing', () => {
  const view = gatewayView();
  const typed = setKey(seedForm(view), 'sk-typed');
  const rules = availability(typed, view, { live: true, agentBusy: false });
  assert.equal(rules.canTest, false);
  assert.match(rules.testReason, /配置有改动，先保存再测试/);
  assert.equal(rules.canSave, true);
});

test('a conflict can be recovered explicitly without losing the draft', () => {
  const view = gatewayView();
  const editing = setSettings(seedForm(view), { model: 'my-model' });
  const conflicted = failOperation(
    editing,
    { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    '连接在别处改过',
  );
  // 别处把配置改到了 revision 2，并且改了模型名。
  const external = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 2, model: 'their-model' })],
  });
  const rebased = rebaseOnLatest(conflicted, external);
  assert.equal(rebased.draft.baseline.configRevision, 2);
  // 自己填的值还在。
  assert.equal(rebased.draft.settings.model, 'my-model');
  assert.equal(rebased.saveIntent, null);
  // 恢复后是「有未保存改动」，需要用户再点一次保存。
  assert.equal(availability(rebased, external, { live: true, agentBusy: false }).canSave, true);
});

test('an uncertain test result is not reported as never started', () => {
  assert.match(
    testFailureText({ code: 'network', messageKey: 'errors.network', retryable: true }),
    /可能已经开始/,
  );
  assert.match(
    testFailureText({ code: 'timeout', messageKey: 'errors.timeout', retryable: true }),
    /可能已经开始/,
  );
  assert.match(
    testFailureText({ code: 'conflict', messageKey: 'errors.conflict', retryable: false }),
    /没有开始测试/,
  );
});

/* ---- 换下拉不等于服务端改过 ---- */

test('switching the connector does not claim the server changed underneath', () => {
  const view = modelView({ connectors: [...modelView().connectors, fixtureConnector] });
  const form = seedForm(view);
  const switched = selectConnector(form, view, FIXTURE);
  assert.equal(switched.draft.connectorId, FIXTURE);
  // 只是本地换了目标：服务端什么都没变，不能报「别处改过」。
  assert.equal(changedUnderneath(switched.draft, view), false);
});

test('an actual external revision change is still reported after switching', () => {
  const view = gatewayView();
  const form = seedForm(view);
  const external = gatewayView({
    connectors: [connector({ ...view.connectors[0], configRevision: 5 })],
  });
  assert.equal(changedUnderneath(form.draft, external), true);
});

/* ---- A/B 版本不同时的真实切换链（A rev4，B rev1）---- */

const TWO_CONNECTOR_VIEW = (overrides = {}) =>
  modelView({
    profileRevision: 7,
    desired: { mode: 'scripted', connectorId: MAGPIE },
    applied: null,
    enabled: false,
    connectors: [
      connector({
        configRevision: 4,
        settings: {
          baseUrl: 'http://127.0.0.1:39807/v1',
          model: 'loopback-ok',
          authMode: 'gateway-key',
        },
        model: 'loopback-ok',
        credential: {
          required: true,
          available: true,
          source: 'memory',
          version: 'credA:4',
          writable: true,
        },
      }),
      fixtureConnector,
    ],
    ...overrides,
  });

test('selecting B captures B as the CAS target and is not an external change', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  // 基线换成 B 自己的版本：这是保存 B 做 CAS 的依据。
  assert.equal(switched.draft.baseline.connectorId, FIXTURE);
  assert.equal(switched.draft.baseline.configRevision, 1);
  // 服务端什么都没动，不能报「别处改过」。
  assert.equal(changedUnderneath(switched.draft, view), false);
});

test('saving B submits B config revision, not the previously selected A one', async () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  const transport = recordingTransport({ save: okView(view) });
  await runSave(switched, view, transport, '');
  const [save] = transport.calls;
  assert.equal(save.command.connectorId, FIXTURE);
  assert.equal(save.command.expectedConfigRevision, 1);
  assert.notEqual(save.command.expectedConfigRevision, 4);
});

test('after switching to B, an external change to B is still reported', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  const externalB = TWO_CONNECTOR_VIEW();
  externalB.connectors[1] = { ...externalB.connectors[1], configRevision: 3 };
  assert.equal(changedUnderneath(switched.draft, externalB), true);
});

test('after switching to B, a profile-level change is still reported', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  assert.equal(changedUnderneath(switched.draft, TWO_CONNECTOR_VIEW({ profileRevision: 9 })), true);
});

test('a change to the connector we are not editing is not our conflict', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  const externalA = TWO_CONNECTOR_VIEW();
  externalA.connectors[0] = { ...externalA.connectors[0], configRevision: 8 };
  // A 变了与 B 草稿无关：不打断用户，也不会用 A 的版本去保存 B。
  assert.equal(changedUnderneath(switched.draft, externalA), false);
});

test('the full chain: switch to B, save, then an external B change conflicts and recovers', async () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  const savedB = TWO_CONNECTOR_VIEW({
    desired: { mode: 'scripted', connectorId: FIXTURE },
    connectors: [TWO_CONNECTOR_VIEW().connectors[0], { ...fixtureConnector, configRevision: 2 }],
  });
  const transport = recordingTransport({ save: okView(savedB) });
  const done = await runSave(switched, view, transport, '');
  assert.equal(done.notice.kind, 'ok');
  assert.equal(done.draft.baseline.configRevision, 2);

  // B 又被别处改到 rev3：这次保存必须冲突，草稿保留。
  const externalB = TWO_CONNECTOR_VIEW({
    desired: { mode: 'scripted', connectorId: FIXTURE },
    connectors: [TWO_CONNECTOR_VIEW().connectors[0], { ...fixtureConnector, configRevision: 3 }],
  });
  assert.equal(changedUnderneath(done.draft, externalB), true);
  const conflictTransport = recordingTransport({
    save: {
      ok: false,
      error: { code: 'conflict', messageKey: 'errors.conflict', retryable: false },
    },
  });
  const editing = setMode(done, 'model');
  const conflicted = await runSave(editing, externalB, conflictTransport, '');
  assert.equal(conflicted.notice.error.code, 'conflict');
  assert.equal(conflicted.draft.connectorId, FIXTURE);
  assert.equal(conflicted.draft.mode, 'model');

  // 显式恢复：换到 rev3 的基线，内容不动，再保存成功。
  const rebased = rebaseOnLatest(conflicted, externalB);
  assert.equal(rebased.draft.baseline.configRevision, 3);
  assert.equal(rebased.draft.mode, 'model');
  const retryTransport = recordingTransport({ save: okView(externalB) });
  const retried = await runSave(rebased, externalB, retryTransport, '');
  assert.equal(retryTransport.calls[0].command.expectedConfigRevision, 3);
  assert.equal(retried.notice.kind, 'ok');
});

test('an external mode change is detected through profileRevision', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  // 服务端把模式切到 model：profileRevision 随之升高，与连接目录无关。
  const externalMode = TWO_CONNECTOR_VIEW({
    profileRevision: 8,
    desired: { mode: 'model', connectorId: MAGPIE },
  });
  assert.equal(changedUnderneath(switched.draft, externalMode), true);
});

test('an external selection change is detected through profileRevision', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  // 服务端把选择切到 B：profileRevision 变，即使 B 的版本没动也要报。
  const externalSelection = TWO_CONNECTOR_VIEW({
    profileRevision: 8,
    desired: { mode: 'scripted', connectorId: FIXTURE },
  });
  assert.equal(changedUnderneath(switched.draft, externalSelection), true);
});

test('switching the dropdown alone never raises profileRevision', () => {
  const view = TWO_CONNECTOR_VIEW();
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  // 下拉是纯本地动作：baseline 的 profileRevision 原样保留。
  assert.equal(switched.draft.baseline.profileRevision, view.profileRevision);
  assert.equal(changedUnderneath(switched.draft, view), false);
});

/* ---- 表驱动：文案与状态表逐条核对（不含新增 UI）---- */

/** 已应用且启用的基线；未应用的场景用 UNAPPLIED_VIEW。 */
const APPLIED_VIEW = (overrides = {}) =>
  gatewayView({
    desired: { mode: 'model', connectorId: MAGPIE },
    applied: { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:7' },
    enabled: true,
    ...overrides,
  });

const UNAPPLIED_VIEW = gatewayView({
  desired: { mode: 'scripted', connectorId: MAGPIE },
  applied: null,
  enabled: false,
});

const BOUND = { connectorId: MAGPIE, configRevision: 1, credentialVersion: 'process:7' };
const checkOf = (view, overrides) => ({ ...view.check, ...overrides });

test('copy table: summary reflects the real applied/enabled state', () => {
  const cases = [
    ['unapplied scripted', UNAPPLIED_VIEW, 'ready', /脚本回复/],
    [
      'applied but scripted',
      APPLIED_VIEW({ desired: { mode: 'scripted', connectorId: MAGPIE } }),
      'ready',
      /脚本演示/,
    ],
    ['applied and enabled', APPLIED_VIEW(), 'ready', /模型回复/],
    ['model but not enabled', APPLIED_VIEW({ enabled: false }), 'ready', /前台还没有切到它/],
    ['model but unavailable', APPLIED_VIEW(), 'unavailable', /当前不可用/],
  ];
  for (const [name, view, status, expected] of cases) {
    assert.match(summaryText(view, status), expected, name);
    if (name === 'model but not enabled') assert.doesNotMatch(summaryText(view, status), /脚本/);
  }
});

test('copy table: saved text never claims more than the view says', () => {
  assert.equal(savedText(UNAPPLIED_VIEW), '配置已保存，但还没有应用到服务。');
  assert.equal(
    savedText(APPLIED_VIEW({ enabled: false })),
    '配置已保存，但前台还没有切到这个连接。',
  );
  assert.equal(savedText(APPLIED_VIEW()), '已保存并应用。');
});

test('copy table: a settled check only counts for the applied binding', () => {
  const view = APPLIED_VIEW();
  const verified = (binding) =>
    checkText(
      checkOf(view, { state: 'verified', evidence: 'network', checkedAt: 1, binding }),
      view,
      false,
      true,
    );

  assert.equal(verified(null), '这条结果对应的连接已经变了，需要重新测试。');
  assert.equal(
    verified({ ...BOUND, configRevision: 9 }),
    '这条结果对应的连接已经变了，需要重新测试。',
  );
  assert.match(verified(BOUND), /测试通过/);
  // failed 同样要归属，不能把别人的失败算到当前连接上。
  const failed = (binding) =>
    checkText(
      checkOf(view, {
        state: 'failed',
        binding,
        error: { code: 'timeout', messageKey: 'errors.timeout', retryable: true },
      }),
      view,
      false,
      true,
    );
  assert.doesNotMatch(failed(null), /测试没有通过/);
  assert.match(failed(BOUND), /操作超时/);
});

test('copy table: synthetic and unknown outcomes say what they are', () => {
  const view = APPLIED_VIEW();
  const synthetic = checkText(
    checkOf(view, { state: 'verified', evidence: 'synthetic', checkedAt: 1, binding: BOUND }),
    view,
    false,
    true,
  );
  assert.match(synthetic, /模拟检查通过，未连接真实模型/);
  assert.doesNotMatch(synthetic, /^.*测试通过：这一份连接返回了真实回复/);

  const offline = checkText(
    checkOf(view, { state: 'verified', evidence: 'network', checkedAt: 1, binding: BOUND }),
    view,
    false,
    false,
  );
  assert.match(offline, /未知/);

  assert.match(
    checkText(checkOf(view, { state: 'configured', commandId: 'cmd-x' }), view, false, true),
    /没有留下结果/,
  );
});

/* ---- 密钥提示只由「同一连接正在改成 gateway-key」决定 ---- */

test('credential hint table: only a real auth-mode change asks to save first', () => {
  const localView = modelView({ connectors: [...modelView().connectors, fixtureConnector] });
  const cases = [
    // 不需要密钥的连接：无论怎么切，都不该提示填密钥。
    ['no-key fixture', selectConnector(seedForm(localView), localView, FIXTURE), localView, false],
    ['untouched local-client-id', seedForm(localView), localView, false],
    // 同一连接真的把鉴权改成网关密钥：这时才需要先保存。
    [
      'local-client-id -> gateway-key',
      setSettings(seedForm(localView), { authMode: 'gateway-key' }),
      localView,
      true,
    ],
    // 已经是网关密钥的连接：不需要再提示。
    ['already gateway-key', seedForm(gatewayView()), gatewayView(), false],
  ];
  for (const [name, form, view, expected] of cases) {
    assert.equal(pendingAuthChange(form.draft, view), expected, name);
  }
});

test('switching to a connector that needs no key never asks to save a key first', () => {
  const view = modelView({ connectors: [...modelView().connectors, fixtureConnector] });
  const switched = selectConnector(seedForm(view), view, FIXTURE);
  // 通用 dirty 为真（换了目标），但这不代表在改鉴权。
  assert.equal(dirtyOf(switched.draft, view, '').nonsecret, true);
  assert.equal(pendingAuthChange(switched.draft, view), false);
});

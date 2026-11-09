/**
 * 人格/记忆表单规则的回归。
 *
 * 这里守的都是「会静默改错数据」的那几条：基线用哪一版、成功才推进、
 * 值原样保留、忘记捕获的是渲染那一行、metadata 缺失只禁它自己。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptMemory,
  adoptProfile,
  applicationLabel,
  availability,
  beginOperation,
  cancelEditing,
  editingFact,
  emptyPersonaMemoryForm,
  followable,
  forgetCommand,
  keyProblem,
  memoryChangedUnderneath,
  memoryEditable,
  memoryPlan,
  normalizeKey,
  originLabel,
  profileChangedUnderneath,
  profileEditable,
  profilePlan,
  rebaseOnLatest,
  seedProfile,
  startAdding,
  startEditing,
  upsertCommand,
  valueProblem,
} from '../src/client/memory-form.ts';

const profile = (overrides = {}) => ({
  agentId: 'agent-1',
  name: '阿蓝',
  persona: '你是阿蓝。',
  revision: 3,
  management: {
    application: { appliedRevision: 3, error: null },
    launchOverrides: { name: false, persona: false },
  },
  ...overrides,
});

const status = (overrides = {}) => ({
  revision: 7,
  application: { appliedRevision: 7, error: null },
  usage: { count: 1, dataBytes: 40, originBytes: 12 },
  ...overrides,
});

const fact = (overrides = {}) => ({
  key: '常喝的茶',
  value: '乌龙',
  revision: 5,
  updatedAt: 1_700_000_000_000,
  origin: { kind: 'owner-form' },
  ...overrides,
});

const memoryView = (overrides = {}) => ({
  agentId: 'agent-1',
  facts: [fact()],
  ...status(),
  ...overrides,
});

const seeded = () => {
  const withProfile = seedProfile(emptyPersonaMemoryForm, profile());
  // 起稿时从真实 status 捕获集合基线（0 是合法值，这里用 7）。
  return { ...withProfile, memoryBaseline: 7, factBaseline: null };
};

const newCommandId = () => 'generated-id';

test('metadata 各自独立：缺人格不连带禁记忆，反之亦然', () => {
  assert.equal(profileEditable(profile()), true);
  assert.equal(profileEditable(profile({ management: undefined })), false);
  assert.equal(profileEditable(null), false);

  assert.equal(memoryEditable(status()), true);
  assert.equal(memoryEditable(undefined), false);
  assert.equal(memoryEditable(null), false);
});

test('可用性是操作条件与 metadata 两件事，不能互相顶替', () => {
  const form = seeded();
  const base = { live: true, agentBusy: false, profileSupported: true, memorySupported: true };

  assert.equal(availability(form, base).canSaveProfile, true);

  // 未连接：即便 metadata 都在也不能写。
  assert.match(availability(form, { ...base, live: false }).saveProfileReason, /未连接/);
  // agent 正忙：另一个操作条件，不因为 metadata 存在就忽略。
  assert.match(availability(form, { ...base, agentBusy: true }).saveProfileReason, /正在回复/);
  // metadata 缺失只影响它自己。
  const noMemory = availability(form, { ...base, memorySupported: false });
  assert.equal(noMemory.canSaveProfile, true);
  assert.match(noMemory.memoryReason, /记忆/);
});

test('空名字与空正文不给保存，但原因说得具体', () => {
  const form = { ...seeded(), name: '   ' };
  const rules = availability(form, {
    live: true,
    agentBusy: false,
    profileSupported: true,
    memorySupported: true,
  });
  assert.equal(rules.canSaveProfile, false);
  assert.match(rules.saveProfileReason, /名字/);
});

test('保存人格发的是草稿读到的 revision，不是最新的一份', () => {
  const form = { ...seeded(), name: '新名字', profileEdited: true };
  const command = profilePlan(form, profile({ revision: 9 }));
  // 外部已经到 9，但草稿基线仍是 3：拿 9 提交会静默覆盖别处的改动。
  assert.equal(command.expectedProfileRevision, 3);
});

test('没有实际改动就不发请求', () => {
  assert.equal(profilePlan(seeded(), profile()), null);
});

test('保存成功但应用失败时，本次提示如实说「已保存，但尚未生效」', () => {
  const form = { ...seeded(), name: '新名字', profileEdited: true };
  const next = adoptProfile(
    form,
    profile({
      name: '新名字',
      revision: 4,
      management: {
        application: {
          appliedRevision: null,
          error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
        },
        launchOverrides: { name: false, persona: false },
      },
    }),
  );
  assert.match(next.notice.text, /已保存，但尚未生效/);
});

test('成功推进基线用服务端返回的 revision，不猜 +1', () => {
  const form = { ...seeded(), name: '新名字', profileEdited: true };
  const next = adoptProfile(form, profile({ name: '新名字', revision: 4 }));
  assert.equal(next.profileBaseline, 4);
  assert.equal(next.profileEdited, false);
  assert.equal(profileChangedUnderneath(next.profileBaseline, profile({ revision: 4 })), false);
});

test('比基线旧的视图不是外部改动；比基线新才是', () => {
  const form = { ...seeded(), name: '我改的', profileEdited: true };
  // 基线 3：读到 9 是别处改过，读到 2 只是还没跟上的旧视图。
  assert.equal(profileChangedUnderneath(form.profileBaseline, profile({ revision: 9 })), true);
  assert.equal(profileChangedUnderneath(form.profileBaseline, profile({ revision: 2 })), false);
  // 自己保存在途时，服务端前进是本次写入的中间态。
  assert.equal(
    profileChangedUnderneath(form.profileBaseline, profile({ revision: 9 }), true),
    false,
  );
  // 还没捕获基线时一律不算外部改动。
  assert.equal(profileChangedUnderneath(null, profile({ revision: 9 })), false);
});

test('外部改动被识别；rebase 只换基线，用户内容原样留下', () => {
  const form = { ...seeded(), name: '我改的', profileEdited: true };

  const rebased = rebaseOnLatest(form, {
    profile: { ok: true, value: profile({ revision: 9 }) },
    memory: { ok: true, value: memoryView({ revision: 7 }) },
  });
  assert.equal(rebased.profileBaseline, 9);
  assert.equal(rebased.name, '我改的');
  assert.match(rebased.notice.text, /内容还在/);
});

test('键 trim 且区分大小写；值一个字符都不改', () => {
  assert.equal(normalizeKey('  常喝的茶  '), '常喝的茶');
  assert.notEqual(normalizeKey('Tea'), normalizeKey('tea'));
  // 值只在提交时原样带出去，不做任何 trim。
  const form = { ...seeded(), key: '  茶  ', value: '  乌龙  ' };
  const plan = memoryPlan(form, 'upsert', newCommandId, null);
  assert.equal(upsertCommand(form, plan).value, '  乌龙  ');
  assert.equal(upsertCommand(form, plan).key, '茶');
});

test('空值不是删除：空白内容被判为无效输入', () => {
  assert.match(valueProblem('   ', 2048), /不能为空/);
  assert.equal(valueProblem(' 乌龙 ', 2048), null);
  assert.match(keyProblem('  ', 128), /不能为空/);
});

test('新增用行版本 0，改既有行用那一行的版本', () => {
  const adding = startAdding(seeded(), status());
  assert.equal(adding.factBaseline, 0);
  assert.equal(adding.memoryBaseline, 7);

  const editing = startEditing(seeded(), fact({ revision: 5 }), status());
  assert.equal(editing.factBaseline, 5);
  assert.equal(editing.value, '乌龙');
});

test('忘记捕获渲染那一行的键与版本，拿不到更新的行', () => {
  const form = startEditing(seeded(), fact({ revision: 5 }), status());
  const plan = memoryPlan(form, 'forget', newCommandId, null);
  const command = forgetCommand(form, plan, form.editingKey);
  assert.equal(command.key, '常喝的茶');
  assert.equal(command.expectedFactRevision, 5);
  assert.equal(command.expectedMemoryRevision, 7);
});

test('同一份未改动的意图复用 commandId，内容一变就是新意图', () => {
  const form = { ...seeded(), key: '茶', value: '乌龙' };
  const first = memoryPlan(form, 'upsert', newCommandId, null);
  const again = memoryPlan(form, 'upsert', () => 'should-not-be-used', {
    commandId: first.commandId,
    fingerprint: first.fingerprint,
  });
  assert.equal(again.commandId, first.commandId);

  const changed = memoryPlan({ ...form, value: '普洱' }, 'upsert', () => 'fresh-id', {
    commandId: first.commandId,
    fingerprint: first.fingerprint,
  });
  assert.equal(changed.commandId, 'fresh-id');
});

test('成功用 committedRevision 推进基线；null 表示只读重放，不推进', () => {
  const form = { ...seeded(), key: '茶', value: '乌龙', memoryBaseline: 7 };
  const normal = adoptMemory(
    form,
    {
      receipt: { commandId: 'c', status: 'accepted', messageId: null, taskId: null },
      committedRevision: 8,
      view: memoryView({ revision: 8 }),
    },
    [fact({ revision: 8 })],
  );
  assert.equal(normal.memoryBaseline, 8);
  assert.equal(normal.key, '');
  assert.equal(normal.value, '');

  const replay = adoptMemory(
    form,
    {
      receipt: { commandId: 'c', status: 'duplicate', messageId: null, taskId: null },
      committedRevision: null,
      view: memoryView({ revision: 9 }),
    },
    [fact({ revision: 9 })],
  );
  // 只读重放没有新的集合版本：基线保持原样，文案也不说「刚保存」。
  assert.equal(replay.memoryBaseline, 7);
  assert.match(replay.notice.text, /此前那次操作|没有重复写入/);
});

test('重复回执如实说「之前已生效」，不谎称这次写入了', () => {
  const form = { ...seeded(), key: '茶', value: '乌龙' };
  const next = adoptMemory(
    form,
    {
      receipt: { commandId: 'c', status: 'duplicate', messageId: null, taskId: null },
      committedRevision: 8,
      view: memoryView({ revision: 8 }),
    },
    [fact()],
  );
  assert.match(next.notice.text, /此前已记录|没有重复写入/);
});

test('正在编辑的行被别处删掉，算作被改动过', () => {
  const form = startEditing(seeded(), fact({ revision: 5 }), status());
  assert.equal(
    memoryChangedUnderneath(
      form.memoryBaseline,
      status(),
      [fact({ revision: 5 })],
      form.editingKey,
      form.factBaseline,
    ),
    false,
  );
  assert.equal(
    memoryChangedUnderneath(form.memoryBaseline, status(), [], form.editingKey, form.factBaseline),
    true,
  );
  assert.equal(
    memoryChangedUnderneath(
      form.memoryBaseline,
      status({ revision: 8 }),
      [fact()],
      form.editingKey,
      form.factBaseline,
    ),
    true,
  );
});

test('只有未编辑、无在途、无草稿时才跟随服务端值', () => {
  assert.equal(followable(emptyPersonaMemoryForm), true);
  assert.equal(followable({ ...emptyPersonaMemoryForm, profileEdited: true }), false);
  assert.equal(followable({ ...emptyPersonaMemoryForm, busy: 'profile' }), false);
  assert.equal(followable({ ...emptyPersonaMemoryForm, value: 'x' }), false);
});

test('rebase 两边都失败时不谎称「已读取最新版本」', () => {
  const form = { ...seeded(), name: '我改的', profileEdited: true };
  const failed = rebaseOnLatest(form, {
    profile: { ok: false, error: { code: 'network', messageKey: 'k', retryable: true } },
    memory: { ok: false, error: { code: 'network', messageKey: 'k', retryable: true } },
  });
  assert.equal(failed.notice.kind, 'error');
  assert.match(failed.notice.text, /没有读到最新版本/);
  // 基线与草稿都没动。
  assert.equal(failed.profileBaseline, form.profileBaseline);
  assert.equal(failed.name, '我改的');
});

test('rebase 不倒退到比已观察更旧的 revision', () => {
  const form = { ...seeded(), profileBaseline: 9 };
  const rebased = rebaseOnLatest(form, {
    profile: { ok: true, value: profile({ revision: 4 }) },
    memory: { ok: true, value: memoryView({ revision: 7 }) },
  });
  assert.equal(rebased.profileBaseline, 9);
});

test('旧数据来源显示为未知，不猜成「你添加的」', () => {
  assert.match(originLabel({ kind: 'legacy-unknown' }), /未知/);
  assert.match(originLabel(undefined), /未知/);
  assert.match(originLabel({ kind: 'owner-form' }), /手动设置/);
  assert.match(
    originLabel({ kind: 'user-input', inputId: 'i', evidence: { start: 0, end: 2 } }),
    /对话/,
  );
});

test('保存与生效分开说：保存成功不等于已经在用', () => {
  assert.match(applicationLabel(null, null), /尚未生效/);
  assert.match(applicationLabel(5, null), /已生效/);
  assert.match(
    applicationLabel(null, { code: 'not-ready', messageKey: 'k', retryable: true }),
    /尚未生效/,
  );
});

test('取消编辑清掉草稿与行基线，回到新增状态', () => {
  const form = startEditing(seeded(), fact({ revision: 5 }), status());
  const cancelled = cancelEditing(form);
  assert.equal(cancelled.editingKey, null);
  assert.equal(cancelled.factBaseline, 0);
  assert.equal(cancelled.value, '');
});

test('开始操作进入忙碌态并清掉上一次提示', () => {
  const form = { ...seeded(), notice: { kind: 'ok', text: '旧的' } };
  const busy = beginOperation(form, 'profile');
  assert.equal(busy.busy, 'profile');
  assert.equal(busy.notice, null);
});

test('编辑既有行时能取到那一行；新增时为空', () => {
  const editing = startEditing(seeded(), fact(), status());
  assert.equal(editingFact(editing, [fact()])?.key, '常喝的茶');
  assert.equal(editingFact(startAdding(seeded(), status()), [fact()]), null);
});

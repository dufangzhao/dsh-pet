/**
 * QQ 管理面的回归。
 *
 * 守的都是「会静默说错话」的那几条：保存成功不等于已连接、
 * 两个协议模块的草稿不互相串、冲突不吞掉用户输入、语音是附加而不是替代。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptSave,
  appliedFacts,
  connectionFacts,
  duplicatePrivate,
  editJudge,
  editPolicy,
  editSource,
  judgeSaveCommand,
  emptyQQForm,
  followView,
  groupSettingsOf,
  mediaLabel,
  normalizePrincipalIds,
  policySaveCommand,
  rebaseOnView,
  sameGroup,
  seedPolicy,
  seedSource,
  selectSource,
  setGroupSettings,
  sourceSaveCommand,
} from '../src/client/qq-form.ts';

const account = (accountId = 'bot-1') => ({
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId,
});

const groupSettings = (overrides = {}) => ({
  contextMessages: 30,
  contextMaxAgeMs: 1_800_000,
  mentionEnabled: true,
  wakeWords: [],
  proactive: {
    enabled: false,
    mode: 'rule-probability',
    probability: 0.1,
    cooldownMs: 60_000,
    maxRepliesPerHour: 6,
  },
  ...overrides,
});

const policy = (overrides = {}) => ({
  privateAllowlist: [],
  groupAllowlist: [],
  principalAliases: [],
  administratorPrincipalIds: [],
  knownMachineActors: [],
  groupDefaults: groupSettings(),
  groups: [],
  voiceOutputEnabled: false,
  judge: {
    providerRef: 'pet.qq-participation-magpie/magpie',
    maxAttemptsPerHour: 30,
    perGroupIntervalMs: 60_000,
    timeoutMs: 10_000,
    maxOutputTokens: 256,
  },
  ...overrides,
});

const source = (overrides = {}) => ({
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  desiredEnabled: true,
  source: 'ready',
  configRevision: 4,
  appliedRevision: 4,
  settings: { protocol: 'official', appId: 'app-1', scenes: ['private', 'group'] },
  account: account(),
  bindingId: 'binding-1',
  phase: 'ready',
  credential: { available: true, writable: true, version: 'v1', source: 'managed' },
  installedVersion: '1.0.0',
  media: { text: 'available', image: 'unverified', voice: 'unavailable', file: 'unverified' },
  cleanup: { state: 'settled', error: null },
  error: null,
  ...overrides,
});

const onebot = () =>
  source({
    protocol: 'onebot-v11',
    sourcePluginId: 'pet.qq-onebot',
    configRevision: 2,
    appliedRevision: 2,
    settings: {
      protocol: 'onebot-v11',
      accountId: '10001',
      mode: 'reverse-ws',
      channelMode: 'universal',
      mediaProfile: 'snowluma-v11',
      listenHost: '127.0.0.1',
      listenPort: 6700,
      path: '/onebot',
    },
    account: {
      protocol: 'onebot-v11',
      sourcePluginId: 'pet.qq-onebot',
      instanceId: 'default',
      accountId: '10001',
    },
  });

const view = (overrides = {}) => ({
  version: 1,
  policy: { revision: 7, settings: policy() },
  sources: [source(), onebot()],
  judge: {
    sourcePluginId: 'pet.qq-participation-magpie',
    configRevision: 1,
    appliedRevision: 1,
    settings: {
      providerRef: 'pet.qq-participation-magpie/magpie',
      maxAttemptsPerHour: 30,
      perGroupIntervalMs: 60_000,
      timeoutMs: 10_000,
      maxOutputTokens: 256,
      connection: { baseUrl: 'https://judge.invalid', model: 'magpie', authMode: 'gateway-key' },
    },
    bindingId: 'judge-binding',
    credential: { available: true, writable: true, version: 'v1', source: 'managed' },
    readiness: 'configured',
    active: 0,
    admittedAttempts: 0,
    inputTokens: null,
    outputTokens: null,
    error: null,
  },
  codec: {
    source: 'ready',
    imageId: `sha256:${'a'.repeat(64)}`,
    manifestSha256: 'b'.repeat(64),
    cleanup: { state: 'settled', error: null },
    error: null,
  },
  ...overrides,
});

const CONN = 'conn-1';
const seeded = (selected = 'official', connectionId = CONN) => {
  const v = view();
  const src = selectSource(v, selected);
  return followView(emptyQQForm, v, src, connectionId);
};

test('保存成功不等于已连接：连接状态只读视图的 phase', () => {
  const ready = source({ phase: 'ready', account: account() });
  assert.equal(connectionFacts(ready).label, '已连接');

  // 配置刚保存、还没连上：不能因为「保存成功」就显示已连接。
  const connecting = source({ phase: 'connecting', appliedRevision: 5, configRevision: 5 });
  assert.equal(connectionFacts(connecting).label, '正在连接');

  const offline = source({ phase: 'offline' });
  assert.equal(connectionFacts(offline).label, '已离线');

  const failed = source({ phase: 'failed' });
  assert.equal(connectionFacts(failed).label, '连接失败');

  // 停用的模块即使曾经连上，也显示已停用。
  const disabled = source({ desiredEnabled: false, phase: 'disabled' });
  assert.equal(connectionFacts(disabled).label, '已停用');
});

test('已保存与已应用分开说', () => {
  assert.equal(appliedFacts(source({ appliedRevision: 4, configRevision: 4 })), null);
  assert.match(
    appliedFacts(source({ appliedRevision: 3, configRevision: 4 })) ?? '',
    /正在生效的是修订 3/,
  );
  assert.match(
    appliedFacts(source({ appliedRevision: null, configRevision: 4 })) ?? '',
    /尚未应用/,
  );
});

test('媒体只报真实状态，未验证不说成可用', () => {
  assert.equal(mediaLabel('available'), '可用');
  assert.equal(mediaLabel('unavailable'), '不可用');
  assert.equal(mediaLabel('unverified'), '未验证');
});

test('两个协议模块各自持有 owner，草稿不互相串', () => {
  let form = seeded('official');
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'edited-official' } : settings,
  );
  assert.equal(sourceSaveCommand(form)?.settings.appId, 'edited-official');
  assert.equal(sourceSaveCommand(form)?.protocol, 'official');

  // 切到 OneBot：这是另一份配置，official 的脏值不能带过去。
  form = followView(form, view(), selectSource(view(), 'onebot-v11'), CONN);
  assert.equal(form.source?.settings.protocol, 'onebot-v11');
  assert.equal(form.source?.settings.accountId, '10001');
  assert.equal(form.source?.edited, false);
  // 而且此时没有可提交的 source 命令（没编辑过）。
  assert.equal(sourceSaveCommand(form), null);
});

test('同一模块的 revision 前进时，脏草稿保留、基线仍是读到时的那一版', () => {
  let form = seeded();
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'dirty' } : settings,
  );
  // 服务端前进到 rev 5，但用户手上是 rev 4 的草稿。
  const moved = view({ sources: [source({ configRevision: 5, appliedRevision: 5 }), onebot()] });
  form = followView(form, moved, selectSource(moved, 'official'), CONN);
  assert.equal(form.source?.settings.appId, 'dirty');
  assert.equal(sourceSaveCommand(form)?.expectedRevision, 4);
});

test('没编辑过就跟最新视图走', () => {
  let form = seeded();
  assert.equal(form.source?.edited, false);
  const moved = view({
    sources: [source({ configRevision: 9, appliedRevision: 9, phase: 'offline' }), onebot()],
  });
  form = followView(form, moved, selectSource(moved, 'official'), CONN);
  assert.equal(form.source?.owner.configRevision, 9);
  assert.equal(sourceSaveCommand(form), null);
});

test('冲突保留草稿，只换基线', () => {
  let form = seeded();
  form = editPolicy(form, (settings) => ({ ...settings, voiceOutputEnabled: true }));
  const command = policySaveCommand(form, view());
  assert.equal(command?.expectedRevision, 7);

  const conflicted = adoptSave(form, { ok: false, error: { code: 'conflict' } }, 'policy');
  assert.equal(conflicted.accepted, false);
  // 两段 CAS：conflict 不等于零副作用，文案不能说「没有写入」。
  assert.match(conflicted.form.notice ?? '', /版本冲突/);
  assert.doesNotMatch(conflicted.form.notice ?? '', /没有写入/);
  // 草稿还在。
  assert.equal(conflicted.form.policy?.settings.voiceOutputEnabled, true);
  assert.equal(conflicted.form.policy?.edited, true);

  const rebased = rebaseOnView(
    conflicted.form,
    view({ policy: { revision: 8, settings: policy() } }),
  );
  assert.equal(rebased.policy?.revision, 8);
  // rebase 不丢用户的编辑。
  assert.equal(rebased.policy?.settings.voiceOutputEnabled, true);
  assert.equal(rebased.policy?.edited, true);
});

test('受理后才清编辑态并推进基线', () => {
  let form = seeded();
  form = editPolicy(form, (settings) => ({ ...settings, voiceOutputEnabled: true }));
  const saved = adoptSave(
    form,
    { ok: true, value: view({ policy: { revision: 9, settings: policy() } }) },
    'policy',
  );
  assert.equal(saved.accepted, true);
  assert.equal(saved.form.policy?.edited, false);
  assert.equal(saved.form.policy?.revision, 9);
  // 保存的文案不能说「已连接」。
  assert.doesNotMatch(saved.form.notice ?? '', /已连接/);
});

test('按群覆盖按账号区分，同号群不算同一个', () => {
  const a = account('bot-a');
  const b = account('bot-b');
  assert.equal(sameGroup({ account: a, groupId: '1' }, { account: a, groupId: '1' }), true);
  assert.equal(sameGroup({ account: a, groupId: '1' }, { account: b, groupId: '1' }), false);

  let settings = policy();
  settings = setGroupSettings(settings, a, '1', groupSettings({ wakeWords: ['嘿'] }));
  settings = setGroupSettings(settings, b, '1', groupSettings({ wakeWords: ['嗨'] }));
  assert.equal(settings.groups.length, 2);
  assert.deepEqual(groupSettingsOf(settings, a, '1').wakeWords, ['嘿']);
  assert.deepEqual(groupSettingsOf(settings, b, '1').wakeWords, ['嗨']);
  // 没覆盖的群用全局默认。
  assert.deepEqual(groupSettingsOf(settings, a, '2').wakeWords, []);
});

test('管理员名单去空白去重', () => {
  assert.deepEqual(normalizePrincipalIds([' a ', '', 'b', 'a', '  ']), ['a', 'b']);
});

test('私聊名单按账号+人判重', () => {
  const list = [{ account: account('bot-a'), scene: 'private', senderId: 'u1' }];
  assert.equal(
    duplicatePrivate(list, { account: account('bot-a'), scene: 'private', senderId: 'u1' }),
    true,
  );
  assert.equal(
    duplicatePrivate(list, { account: account('bot-b'), scene: 'private', senderId: 'u1' }),
    false,
  );
});

test('语音是附加开关：文字没有关闭入口', () => {
  const settings = seedPolicy(view()).settings;
  assert.equal(settings.voiceOutputEnabled, false);
  // 契约里根本没有「文字开关」这个字段——这不是遗漏，是 Q16。
  assert.equal('textOutputEnabled' in settings, false);
});

test('视图里没有的协议模块不会被凭空选中', () => {
  const onlyOfficial = view({ sources: [source()] });
  assert.equal(selectSource(onlyOfficial, 'onebot-v11'), null);
  assert.equal(selectSource(onlyOfficial, 'official')?.protocol, 'official');
  assert.equal(selectSource(null, 'official'), null);
});

test('seed 保留读到的 revision 作为 CAS 基线', () => {
  const form = seeded();
  assert.equal(form.policy?.revision, 7);
  assert.equal(seedPolicy(view()).revision, 7);
  assert.equal(seedSource(source(), CONN).owner.configRevision, 4);
});

/**
 * owner 身份必须足以区分「换了一个来源」与「同一来源改了版本」。
 * 前者要丢草稿，后者要留草稿——这两件事都靠 owner 判定。
 */
test('同一来源的版本前进不换 owner，脏草稿留着', () => {
  let form = seeded();
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'dirty' } : settings,
  );
  const moved = view({ sources: [source({ configRevision: 9, appliedRevision: 9 })] });
  form = followView(form, moved, selectSource(moved, 'official'), CONN);
  assert.equal(form.source?.settings.appId, 'dirty');
  // 基线仍是读到时那一版，不是最新的 9。
  assert.equal(sourceSaveCommand(form)?.expectedRevision, 4);
});

test('同一协议被换成另一个 source 时丢草稿', () => {
  let form = seeded();
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'dirty' } : settings,
  );
  // 协议名一样，但 sourcePluginId 换了：这是另一个来源。
  const replaced = view({
    sources: [source({ sourcePluginId: 'pet.qq-official-v2', configRevision: 4 })],
  });
  form = followView(form, replaced, selectSource(replaced, 'official'), CONN);
  assert.equal(form.source?.settings.appId, 'app-1');
  assert.equal(form.source?.edited, false);
});

test('换服务连接后旧草稿不迁移', () => {
  let form = seeded();
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'dirty' } : settings,
  );
  form = followView(form, view(), selectSource(view(), 'official'), 'conn-2');
  assert.equal(form.source?.settings.appId, 'app-1');
  assert.equal(form.source?.edited, false);
});

test('rebase 只换基线，内容与来源归属都留着', () => {
  let form = seeded();
  form = editSource(form, (settings) =>
    settings.protocol === 'official' ? { ...settings, appId: 'dirty' } : settings,
  );
  const rebased = rebaseOnView(form, view({ sources: [source({ configRevision: 11 })] }));
  assert.equal(rebased.source?.owner.configRevision, 11);
  assert.equal(rebased.source?.settings.appId, 'dirty');
  assert.equal(rebased.source?.edited, true);
});

/**
 * judge 是独立 purpose：它有自己的一份草稿与 CAS 基线。
 * 这些用例守两件事——字段真的可配置，且保存不用点击那一刻的最新 view。
 */
test('judge 草稿包含连接字段，模型可以留空也能填', () => {
  const v = view();
  let form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  assert.equal(form.judge?.settings.connection.baseUrl, 'https://judge.invalid');
  assert.equal(form.judge?.settings.connection.model, 'magpie');
  assert.equal(form.judge?.settings.connection.authMode, 'gateway-key');
  // 用户把模型改成另一个：这是可编辑的，不是只读回显。
  form = editJudge(form, (settings) => ({
    ...settings,
    connection: { ...settings.connection, model: 'vendor/judge-v2' },
  }));
  assert.equal(form.judge?.settings.connection.model, 'vendor/judge-v2');
  assert.equal(form.judge?.edited, true);
});

test('judge 保存用捕获的 configRevision，不读最新 view', () => {
  const v = view();
  let form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  form = editJudge(form, (settings) => ({ ...settings, maxAttemptsPerHour: 5 }));
  const command = judgeSaveCommand(form);
  assert.equal(command?.expectedConfigRevision, 1);
  // 服务端前进了：草稿的基线仍是它读到的那一版。
  const moved = view({
    judge: { ...v.judge, configRevision: 9, appliedRevision: 9 },
  });
  form = followView(form, moved, selectSource(moved, 'official'), CONN);
  assert.equal(judgeSaveCommand(form)?.expectedConfigRevision, 1);
  assert.equal(form.judge?.settings.maxAttemptsPerHour, 5);
});

test('judge 换连接后旧草稿不迁移', () => {
  const v = view();
  let form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  form = editJudge(form, (settings) => ({ ...settings, timeoutMs: 5000 }));
  form = followView(form, v, selectSource(v, 'official'), 'conn-2');
  assert.equal(form.judge?.settings.timeoutMs, 10_000);
  assert.equal(form.judge?.edited, false);
});

test('judge 没被编辑时不产生保存命令', () => {
  const v = view();
  const form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  assert.equal(judgeSaveCommand(form), null);
});

/**
 * lost update 回归：judge 是 dirty 的，policy 是干净的。
 *
 * 外部把 judge 预算改掉并推进 policy revision；干净的 policy 会跟随到新
 * revision，但 dirty 的 judge 必须仍然用它**自己读到时**的 policy revision，
 * 否则两段 CAS 都会通过，把别人的预算覆盖掉。
 */
test('dirty judge 不借干净 policy 的新 revision（lost update）', () => {
  const v = view();
  let form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  // 用户改 judge 预算 30 → 40。
  form = editJudge(form, (settings) => ({ ...settings, maxAttemptsPerHour: 20 }));
  assert.equal(form.judge?.policyRevision, 7);

  // 外部把预算改成 7，并把 policy revision 推到 8。
  const moved = view({
    policy: {
      revision: 8,
      settings: {
        ...v.policy.settings,
        judge: { ...v.policy.settings.judge, maxAttemptsPerHour: 7 },
      },
    },
  });
  form = followView(form, moved, selectSource(moved, 'official'), CONN);

  // 干净的 policy 跟随到 8，但 judge 仍是 dirty 的 40，且基线停在 7。
  assert.equal(form.policy?.revision, 8);
  assert.equal(form.judge?.settings.maxAttemptsPerHour, 20);
  const command = judgeSaveCommand(form);
  assert.equal(command?.expectedPolicyRevision, 7, 'dirty judge 不能借新 policy revision');
  assert.equal(command?.expectedConfigRevision, 1);
});

test('judge 显式 rebase 成对更新两段基线', () => {
  const v = view();
  let form = followView(emptyQQForm, v, selectSource(v, 'official'), CONN);
  form = editJudge(form, (settings) => ({ ...settings, maxAttemptsPerHour: 20 }));
  const moved = view({
    policy: { revision: 8, settings: v.policy.settings },
    judge: { ...v.judge, configRevision: 3 },
  });
  form = rebaseOnView(form, moved);
  assert.equal(form.judge?.policyRevision, 8);
  assert.equal(form.judge?.configRevision, 3);
  // rebase 不丢用户填的值。
  assert.equal(form.judge?.settings.maxAttemptsPerHour, 20);
});

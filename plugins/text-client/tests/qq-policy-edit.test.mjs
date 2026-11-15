/**
 * 名单与映射的纯规则回归。
 *
 * 核心是「双账号不能互相毁掉名单」：两个账号可以有同一个 senderId 或 groupId，
 * 界面若按 id 显示、按当前账号整体替换，改 A 就会清掉 B。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  actorKey,
  groupEntries,
  groupsFor,
  parseIdList,
  privateEntries,
  privateFor,
  removeAlias,
  replaceAdmins,
  replaceGroupsFor,
  replacePrivateFor,
  toggleMachineActor,
  upsertAlias,
} from '../src/client/qq-policy-edit.ts';

const official = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-1',
};
const onebot = {
  protocol: 'onebot-v11',
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default',
  accountId: '10001',
};

const policy = (over = {}) => ({
  privateAllowlist: [],
  groupAllowlist: [],
  principalAliases: [],
  administratorPrincipalIds: [],
  knownMachineActors: [],
  groupDefaults: {},
  groups: [],
  voiceOutputEnabled: false,
  judge: {},
  ...over,
});

test('两个账号同 senderId：只改 A，B 原样保留', () => {
  let settings = policy({
    privateAllowlist: [
      { account: official, scene: 'private', senderId: 'u1' },
      { account: onebot, scene: 'private', senderId: 'u1' },
    ],
  });
  // A 换成 u2：B 的 u1 必须还在。
  settings = replacePrivateFor(settings, official, privateEntries(official, ['u2']));
  assert.deepEqual(
    privateFor(settings, official).map((entry) => entry.senderId),
    ['u2'],
  );
  assert.deepEqual(
    privateFor(settings, onebot).map((entry) => entry.senderId),
    ['u1'],
  );
});

test('两个账号同 groupId：只改 A，B 原样保留', () => {
  let settings = policy({
    groupAllowlist: [
      { account: official, groupId: 'g1' },
      { account: onebot, groupId: 'g1' },
    ],
  });
  settings = replaceGroupsFor(settings, official, groupEntries(official, ['g2']));
  assert.deepEqual(
    groupsFor(settings, official).map((entry) => entry.groupId),
    ['g2'],
  );
  assert.deepEqual(
    groupsFor(settings, onebot).map((entry) => entry.groupId),
    ['g1'],
  );
});

test('清空 A 的名单不影响 B', () => {
  let settings = policy({
    groupAllowlist: [
      { account: official, groupId: 'g1' },
      { account: onebot, groupId: 'g2' },
    ],
  });
  settings = replaceGroupsFor(settings, official, []);
  assert.equal(groupsFor(settings, official).length, 0);
  assert.deepEqual(
    groupsFor(settings, onebot).map((entry) => entry.groupId),
    ['g2'],
  );
});

test('两个账号的同号群有不同的 actor key', () => {
  const a = { account: official, scene: 'group', senderId: 'u1', groupId: 'g1' };
  const b = { account: onebot, scene: 'group', senderId: 'u1', groupId: 'g1' };
  assert.notEqual(actorKey(a), actorKey(b));
  // 同协议、只有 accountId 不同：这也是两个账号，键必须不同。
  const sameProtocolA = {
    account: { ...official, accountId: 'app-1' },
    scene: 'group',
    senderId: 'u1',
    groupId: 'g1',
  };
  const sameProtocolB = {
    account: { ...official, accountId: 'app-2' },
    scene: 'group',
    senderId: 'u1',
    groupId: 'g1',
  };
  assert.notEqual(actorKey(sameProtocolA), actorKey(sameProtocolB));
  // 同一 actor 反复算出来必须一致（React key 要稳定）。
  assert.equal(actorKey(a), actorKey({ ...a }));
});

test('别名按完整 actor 去重，不跨账号误删', () => {
  const a = { account: official, scene: 'private', senderId: 'u1' };
  const b = { account: onebot, scene: 'private', senderId: 'u1' };
  let settings = policy();
  settings = upsertAlias(settings, a, 'person-a');
  settings = upsertAlias(settings, b, 'person-b');
  assert.equal(settings.principalAliases.length, 2);
  // 改 A 的绑定：B 不受影响。
  settings = upsertAlias(settings, a, 'person-a2');
  assert.equal(settings.principalAliases.length, 2);
  const found = settings.principalAliases.find((entry) => actorKey(entry.actor) === actorKey(a));
  assert.equal(found?.principalId, 'person-a2');
  // 删 A：B 还在。
  settings = removeAlias(settings, a);
  assert.equal(settings.principalAliases.length, 1);
  assert.equal(actorKey(settings.principalAliases[0].actor), actorKey(b));
});

test('机器人标记可加可撤，且不影响别名', () => {
  const a = { account: official, scene: 'private', senderId: 'bot-1' };
  let settings = upsertAlias(policy(), a, 'person-a');
  settings = toggleMachineActor(settings, a, true);
  assert.equal(settings.knownMachineActors.length, 1);
  assert.equal(settings.principalAliases.length, 1);
  settings = toggleMachineActor(settings, a, false);
  assert.equal(settings.knownMachineActors.length, 0);
  // 撤机器人标记不该顺手删掉别名。
  assert.equal(settings.principalAliases.length, 1);
});

test('超上限是明确错误，不是静默截断', () => {
  const parsed = parseIdList('a,b,c', 2, '名单');
  assert.match(parsed.problem ?? '', /最多 2 个/);
  assert.deepEqual(parsed.ids, []);
  // 正常情况去重保序。
  const ok = parseIdList(' a , b , a ', 5, '名单');
  assert.equal(ok.problem, null);
  assert.deepEqual(ok.ids, ['a', 'b']);
});

test('管理员名单整体替换但去重', () => {
  const settings = replaceAdmins(policy(), ['p1', 'p2']);
  assert.deepEqual(settings.administratorPrincipalIds, ['p1', 'p2']);
});

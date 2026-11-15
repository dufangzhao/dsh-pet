import { expect, it } from 'vitest';
import {
  defaultQQPolicySettings,
  type QQAccountRef,
  type QQExternalActor,
  type QQPolicySettings,
} from '@pet/contracts';
import {
  assertQQParticipantCurrent,
  qqGroupSettings,
  qqWakeTrigger,
  resolveQQParticipant,
} from './qq-policy.js';

const account: QQAccountRef = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-a',
};
const person: QQExternalActor = { account, scene: 'private', senderId: 'opaque-member' };
const groupMember: QQExternalActor = {
  account,
  scene: 'group',
  groupId: 'group-a',
  senderId: 'opaque-member',
};
const allowed = (): QQPolicySettings => ({
  ...defaultQQPolicySettings(),
  privateAllowlist: [person],
  groupAllowlist: [{ account, groupId: 'group-a' }],
});

it('admits nobody from empty allowlists, including an explicit owner alias', () => {
  const empty = {
    ...defaultQQPolicySettings(),
    principalAliases: [{ actor: person, principalId: 'owner' }],
  };
  expect(resolveQQParticipant(empty, person)).toBeNull();
  expect(resolveQQParticipant(empty, groupMember)).toBeNull();
});

it('uses exact account and scene namespaces rather than a matching sender display ID', () => {
  const policy = allowed();
  const privateMember = resolveQQParticipant(policy, person);
  const group = resolveQQParticipant(policy, groupMember);
  expect(privateMember?.role).toBe('member');
  expect(privateMember?.audience.kind).toBe('person-private');
  expect(group?.audience).toEqual({ kind: 'qq-group', account, groupId: 'group-a' });
  expect(group?.principalId).not.toBe(privateMember?.principalId);
  expect(
    resolveQQParticipant(policy, { ...person, account: { ...account, accountId: 'app-b' } }),
  ).toBeNull();
  expect(resolveQQParticipant(policy, { ...groupMember, groupId: 'group-b' })).toBeNull();
});

it('requires an explicit owner binding and keeps that owner group conversation group-scoped', () => {
  const policy = {
    ...allowed(),
    principalAliases: [person, groupMember].map((actor) => ({ actor, principalId: 'owner' })),
  };
  expect(resolveQQParticipant(policy, person)).toEqual({
    principalId: 'owner',
    role: 'owner',
    audience: { kind: 'owner-private' },
  });
  expect(resolveQQParticipant(policy, groupMember)).toEqual({
    principalId: 'owner',
    role: 'owner',
    audience: { kind: 'qq-group', account, groupId: 'group-a' },
  });
});

it('blocks known machine actors before grants even if they appear on an allowlist', () => {
  expect(resolveQQParticipant({ ...allowed(), knownMachineActors: [person] }, person)).toBeNull();
});

it('rechecks removal and role downgrade without promoting a captured member input', () => {
  const memberPolicy = {
    ...allowed(),
    principalAliases: [{ actor: person, principalId: 'person-a' }],
  };
  const member = resolveQQParticipant(memberPolicy, person);
  if (!member) throw new Error('expected allowed member');
  const adminPolicy = { ...memberPolicy, administratorPrincipalIds: ['person-a'] };
  expect(() => assertQQParticipantCurrent(adminPolicy, person, member)).not.toThrow();
  expect(member.role).toBe('member');
  const admin = resolveQQParticipant(adminPolicy, person);
  if (!admin) throw new Error('expected allowed administrator');
  expect(admin.role).toBe('admin');
  expect(() => assertQQParticipantCurrent(memberPolicy, person, admin)).toThrow();
  expect(() => assertQQParticipantCurrent(defaultQQPolicySettings(), person, member)).toThrow();
});

it('does not transfer old input authority when an actor is rebound to a different person', () => {
  const policy = { ...allowed(), principalAliases: [{ actor: person, principalId: 'person-a' }] };
  const captured = resolveQQParticipant(policy, person);
  if (!captured) throw new Error('expected allowed member');
  expect(() =>
    assertQQParticipantCurrent(
      {
        ...policy,
        principalAliases: [{ actor: person, principalId: 'person-b' }],
      },
      person,
      captured,
    ),
  ).toThrow();
});

it('uses only the exact group override and authored wake words or native mention evidence', () => {
  const defaults = { ...defaultQQPolicySettings().groupDefaults, wakeWords: ['小助手'] };
  const override = { ...defaults, mentionEnabled: false, wakeWords: ['工作助手'] };
  const policy = {
    ...allowed(),
    groupDefaults: defaults,
    groups: [{ account, groupId: 'group-a', settings: override }],
  };
  expect(qqGroupSettings(policy, account, 'group-a')).toBe(override);
  expect(qqGroupSettings(policy, { ...account, accountId: 'app-b' }, 'group-a')).toBe(defaults);
  expect(qqWakeTrigger(defaults, '', true)).toBe('mention');
  expect(qqWakeTrigger(defaults, '小助手，请看看', false)).toBe('wake-word');
  expect(qqWakeTrigger(override, '普通消息', true)).toBeNull();
  expect(qqWakeTrigger(defaults, '解释一下引用中的内容', false)).toBeNull();
});

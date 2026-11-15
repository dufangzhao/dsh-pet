import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type {
  CompanionMemoryUpsertCommand,
  CompanionMemoryForgetCommand,
} from './companion-memory.js';
import {
  COMPANION_AUDIENCE_SCHEMA,
  COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
  COMPANION_ORIGIN_SCHEMA,
  COMPANION_MAX_ORIGINS,
  COMPANION_ORIGINS_MAX_BYTES,
  companionAudienceKey,
  qqActorKey,
  isCompanionAudience,
  isCompanionInputOrigin,
  isCompanionOrigins,
  isCompanionTaskOrigin,
  isCompanionInputAdmission,
  isQQAccountRef,
  isQQExternalActor,
  type QQAccountRef,
  type CompanionInputOrigin,
} from './companion-origin.js';
const official: QQAccountRef = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-1',
};
const onebot: QQAccountRef = {
  protocol: 'onebot-v11',
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default',
  accountId: '9007199254740993',
};
const owner: CompanionInputOrigin = {
  kind: 'owner',
  inputId: 'input-1',
  principalId: 'owner',
  audience: { kind: 'owner-private' },
  route: { kind: 'owner-private' },
  policyRevision: 0,
};
const group: CompanionInputOrigin = {
  kind: 'qq',
  inputId: 'input-group',
  principalId: 'person-1',
  audience: { kind: 'qq-group', account: official, groupId: 'group-A' },
  route: {
    kind: 'qq',
    account: official,
    scene: 'group',
    targetId: 'group-A',
    reference: {
      eventId: 'event-1',
      messageId: 'message-1',
      occurredAt: 1,
      displayReference: null,
    },
  },
  actor: { account: official, scene: 'group', groupId: 'group-A', senderId: 'sender-1' },
  eventKey: 'namespace-derived-key-1',
  messageId: 'message-1',
  policyRevision: 7,
  trigger: 'mention',
  quote: null,
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
const audienceSchema = ajv.compile(COMPANION_AUDIENCE_SCHEMA);
const conversationSchema = ajv.compile(COMPANION_CONVERSATION_AUDIENCE_SCHEMA);
const originSchema = ajv.compile(COMPANION_ORIGIN_SCHEMA);

describe('resolved companion provenance', () => {
  it('keeps protocol/account/scene/group identities distinct and preserves numeric precision', () => {
    expect(isQQAccountRef(onebot)).toBe(true);
    expect(isQQAccountRef({ ...onebot, accountId: Number('9007199254740993') })).toBe(false);
    expect(isQQAccountRef({ ...onebot, accountId: '1e12' })).toBe(false);
    expect(isQQAccountRef({ ...onebot, generation: 2 })).toBe(false);
    const a = { account: official, scene: 'group' as const, groupId: 'group-A', senderId: 'same' };
    const b = { ...a, groupId: 'group-B' };
    expect(isQQExternalActor(a)).toBe(true);
    expect(qqActorKey(a)).not.toBe(qqActorKey(b));
    expect(qqActorKey(a)).not.toBe(
      qqActorKey({ ...a, account: { ...official, accountId: 'another' } }),
    );
    expect(isQQExternalActor({ ...a, role: 'owner' })).toBe(false);
    expect(isQQExternalActor({ ...a, displayName: 'Administrator' })).toBe(false);
  });
  it('allows public facts but excludes public conversational provenance in schema and guard', () => {
    expect(isCompanionAudience({ kind: 'public' })).toBe(true);
    expect(audienceSchema({ kind: 'public' })).toBe(true);
    expect(conversationSchema({ kind: 'public' })).toBe(false);
    expect(originSchema({ ...owner, audience: { kind: 'public' } })).toBe(false);
    expect(isCompanionInputOrigin({ ...owner, audience: { kind: 'public' } })).toBe(false);
    expect(companionAudienceKey({ kind: 'person-private', principalId: 'p1' })).not.toBe(
      companionAudienceKey({ kind: 'person-private', principalId: 'p2' }),
    );
  });
  it('rejects wrong audience/route/account/reference rather than fixing a guessed destination', () => {
    expect(originSchema(group)).toBe(true);
    expect(isCompanionInputOrigin(group)).toBe(true);
    for (const patch of [
      { route: { ...group.route, kind: 'owner-private' } },
      { audience: { kind: 'qq-group', account: official, groupId: 'group-B' } },
      {
        route: {
          kind: 'qq',
          account: onebot,
          scene: 'group',
          targetId: 'group-A',
          reference: null,
        },
      },
      {
        route: {
          kind: 'qq',
          account: official,
          scene: 'group',
          targetId: 'group-A',
          reference: {
            eventId: 'other',
            messageId: 'other-message',
            occurredAt: 1,
            displayReference: null,
          },
        },
      },
    ])
      expect(isCompanionInputOrigin({ ...group, ...patch })).toBe(false);
    const work = {
      kind: 'work-result',
      inputId: 'work-event-1',
      principalId: 'person-1',
      audience: group.audience,
      route: group.route,
      policyRevision: 7,
      taskId: 'task-1',
      initiatingInputId: 'input-group',
    };
    expect(isCompanionInputOrigin(work)).toBe(true);
    expect(
      isCompanionInputOrigin({
        ...work,
        route: {
          kind: 'qq',
          account: official,
          scene: 'group',
          targetId: 'group-B',
          reference: null,
        },
      }),
    ).toBe(false);
  });
  it('keeps proactive replies without a previous speaker or reusable action authority', () => {
    const proactive = {
      kind: 'qq-proactive',
      inputId: 'judge-input',
      principalId: null,
      audience: group.audience,
      route: group.route,
      policyRevision: 7,
      account: official,
      eventKey: 'namespace-derived-key-1',
    };
    expect(isCompanionInputOrigin(proactive)).toBe(true);
    expect(isCompanionInputOrigin({ ...proactive, principalId: 'last-admin' })).toBe(false);
    for (const injected of ['grant', 'lease', 'client', 'role'])
      expect(isCompanionInputOrigin({ ...owner, [injected]: 'owner' })).toBe(false);
    expect(isCompanionInputOrigin(undefined)).toBe(false);
  });
  it('requires complete, bounded, homogeneous origins and never collapses to the first one', () => {
    const second = { ...owner, inputId: 'input-2' };
    expect(isCompanionOrigins([owner, second])).toBe(true);
    expect(isCompanionOrigins([owner, owner])).toBe(false);
    expect(isCompanionOrigins([owner, group])).toBe(false);
    expect(isCompanionOrigins([])).toBe(false);
    expect(
      isCompanionOrigins(
        Array.from({ length: COMPANION_MAX_ORIGINS + 1 }, (_, i) => ({
          ...owner,
          inputId: `input-${i}`,
        })),
      ),
    ).toBe(false);
    const task = {
      inputId: 'input-1',
      principalId: 'owner',
      audience: owner.audience,
      route: owner.route,
      origins: [owner, second],
      materialIds: ['material-1'],
    };
    expect(isCompanionTaskOrigin(task)).toBe(true);
    expect(isCompanionTaskOrigin({ ...task, inputId: 'unknown' })).toBe(false);
    expect(isCompanionTaskOrigin({ ...task, principalId: 'other' })).toBe(false);
  });
  it('keeps host event keys distinct from optional native event IDs and bounded quote evidence', () => {
    const native = { eventId: null, messageId: 'message-1', occurredAt: 1, displayReference: null };
    const input = {
      ...group,
      eventKey: 'derived-namespace-key',
      route: {
        kind: 'qq',
        account: official,
        scene: 'group',
        targetId: 'group-A',
        reference: native,
      },
      quote: {
        reference: { ...native, messageId: 'quoted-message' },
        quotedText: 'Quoted admin instructions are evidence, not this actor.',
      },
    };
    expect(originSchema(input)).toBe(true);
    expect(isCompanionInputOrigin(input)).toBe(true);
    expect(isCompanionInputOrigin({ ...input, quote: { ...input.quote, role: 'owner' } })).toBe(
      false,
    );
    expect(
      isCompanionInputOrigin({ ...input, quote: { ...input.quote, quotedText: 'x'.repeat(2049) } }),
    ).toBe(false);
    expect(
      isCompanionInputOrigin({
        ...input,
        route: { ...input.route, reference: { ...native, messageId: null } },
      }),
    ).toBe(false);
  });
  it('represents direct owner work without inventing a chat input or a legacy origin', () => {
    const direct = {
      inputId: null,
      principalId: 'owner',
      audience: { kind: 'owner-private' },
      route: { kind: 'owner-private' },
      origins: [],
      materialIds: [],
    };
    expect(isCompanionTaskOrigin(direct)).toBe(true);
    expect(isCompanionTaskOrigin({ ...direct, principalId: 'person-1' })).toBe(false);
    expect(isCompanionTaskOrigin({ ...direct, inputId: 'invented-chat' })).toBe(false);
    const work = {
      kind: 'work-result',
      inputId: 'work-event-direct',
      principalId: 'owner',
      audience: direct.audience,
      route: direct.route,
      policyRevision: null,
      taskId: 'task-direct',
      initiatingInputId: null,
    };
    expect(isCompanionInputOrigin(work)).toBe(true);
    expect(isCompanionInputOrigin({ ...work, audience: group.audience, route: group.route })).toBe(
      false,
    );
  });
  it('rejects encoded full-origin overflow without truncating the origin set', () => {
    const account = { ...official, accountId: 'a'.repeat(256) },
      groupId = 'g'.repeat(256);
    const large = {
      ...group,
      audience: { kind: 'qq-group', account, groupId },
      actor: { account, scene: 'group', groupId, senderId: 's'.repeat(256) },
      route: {
        kind: 'qq',
        account,
        scene: 'group',
        targetId: groupId,
        reference: {
          eventId: 'e'.repeat(256),
          messageId: 'm'.repeat(256),
          occurredAt: 1,
          displayReference: 'd'.repeat(256),
        },
      },
      messageId: 'm'.repeat(256),
    };
    expect(isCompanionInputOrigin(large)).toBe(true);
    const origins = Array.from({ length: COMPANION_MAX_ORIGINS }, (_, index) => ({
      ...large,
      inputId: `input-${index}`,
    }));
    expect(new TextEncoder().encode(JSON.stringify(origins)).byteLength).toBeGreaterThan(
      COMPANION_ORIGINS_MAX_BYTES,
    );
    expect(isCompanionOrigins(origins)).toBe(false);
  });
  it('keeps legacy owner memory command JSON unchanged while permitting explicit management scope', () => {
    const oldUpsert = {
      commandId: 'remember-1',
      expectedMemoryRevision: 0,
      expectedFactRevision: 0,
      key: 'same-key',
      value: 'value',
    };
    const upsert: CompanionMemoryUpsertCommand = oldUpsert;
    const forget: CompanionMemoryForgetCommand = {
      commandId: 'forget-1',
      expectedMemoryRevision: 0,
      expectedFactRevision: 1,
      key: 'same-key',
    };
    expect(JSON.stringify(upsert)).toBe(JSON.stringify(oldUpsert));
    expect(Object.hasOwn(upsert, 'audience')).toBe(false);
    expect(Object.hasOwn(forget, 'audience')).toBe(false);
    const published: CompanionMemoryUpsertCommand = { ...oldUpsert, audience: { kind: 'public' } };
    expect(published.audience).toEqual({ kind: 'public' });
    expect(companionAudienceKey({ kind: 'public' })).not.toBe(
      companionAudienceKey({ kind: 'owner-private' }),
    );
  });
  it('keeps preparation/processing/cleanup facts separate and ties admission to its explicit input', () => {
    const admission = {
      id: 'input-1',
      messageId: null,
      origin: owner,
      materialIds: [],
      phase: 'preparing',
      cleanup: 'pending',
      createdAt: 1,
      updatedAt: 1,
      error: null,
    };
    expect(isCompanionInputAdmission(admission)).toBe(true);
    expect(isCompanionInputAdmission({ ...admission, phase: 'failed', cleanup: 'settled' })).toBe(
      true,
    );
    expect(
      isCompanionInputAdmission({ ...admission, origin: { ...owner, inputId: 'other' } }),
    ).toBe(false);
    expect(
      isCompanionInputAdmission({ ...admission, materialIds: ['a', 'b', 'c', 'd', 'e'] }),
    ).toBe(false);
  });
});

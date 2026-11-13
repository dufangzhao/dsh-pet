import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { decodeOfficialGatewayFrame } from '@pet/qq-official';
import { decodeOneBotFrame } from '@pet/qq-onebot';
import type { QQAccountRef } from '@pet/contracts';
import { mapOfficialInput, mapOneBotInput } from './qq-input.js';

const official: QQAccountRef = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'app-a',
};
const onebot: QQAccountRef = {
  protocol: 'onebot-v11',
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default',
  accountId: '10001',
};
async function officialEvent() {
  const result = decodeOfficialGatewayFrame(
    await readFile(
      new URL('../../../qa/fixtures/companion-qq/protocol/official-group-at.json', import.meta.url),
      'utf8',
    ),
  );
  if (!result.ok || result.value.kind !== 'message') throw new Error('invalid native fixture');
  return result.value.event;
}
async function oneBotEvent() {
  const result = decodeOneBotFrame(
    await readFile(
      new URL('../../../qa/fixtures/companion-qq/protocol/onebot-group.json', import.meta.url),
      'utf8',
    ),
    '10001',
  );
  if (!result.ok || result.value.kind !== 'message') throw new Error('invalid native fixture');
  return result.value;
}

it('keeps authored text, quoted evidence, native IDs and the derived admission key distinct', async () => {
  const event = await officialEvent();
  const mapped = mapOfficialInput(official, event, 'bot-self', 12345);
  expect(mapped?.text).toBe('  内容保留\r\n第二行');
  expect(mapped?.quote?.quotedText).toBe('quoted\n\nnested');
  expect(mapped?.route.reference).toEqual({
    eventId: 'event-fixture-42',
    messageId: 'ROBOT1.0_fixture-inbound',
    occurredAt: Date.parse('2026-11-13T04:00:00+08:00'),
    displayReference: 'REFIDX_fixture-current',
  });
  expect(mapped?.quote?.reference.displayReference).toBe('REFIDX_fixture-quoted');
  expect(mapped?.mentioned).toBe(true);
  expect(mapped?.eventKey).toMatch(/^qq-message-[a-f0-9]{64}$/);
  expect(mapped?.eventKey).not.toBe(event.id);
  expect(mapped?.materials.map((part) => part.kind)).toEqual(['image', 'voice', 'file']);
  expect(mapped?.actor).not.toHaveProperty('role');
});

it('accepts a real official message ID without fabricating an upstream event ID', async () => {
  const event = await officialEvent();
  const withEvent = mapOfficialInput(official, event, null);
  const without = mapOfficialInput(official, { ...event, id: null }, null);
  expect(without?.route.reference?.eventId).toBeNull();
  expect(without?.eventKey).toBe(withEvent?.eventKey);
  expect(mapOfficialInput({ ...official, accountId: 'other-app' }, event, null)?.eventKey).not.toBe(
    withEvent?.eventKey,
  );
});

it('ignores native bot/self evidence and never substitutes another official ID namespace', async () => {
  const event = await officialEvent();
  expect(
    mapOfficialInput(
      official,
      { ...event, d: { ...event.d, author: { ...event.d.author, bot: true } } },
      null,
    ),
  ).toBeNull();
  expect(mapOfficialInput(official, event, 'opaque_member_fixture')).toBeNull();
  expect(() =>
    mapOfficialInput(
      official,
      { ...event, d: { ...event.d, author: { ...event.d.author, member_openid: null } } },
      null,
    ),
  ).toThrow();
  expect(() =>
    mapOfficialInput(official, { ...event, d: { ...event.d, id: 'x'.repeat(257) } }, null),
  ).toThrow();
});

it('keeps nested quote media separate and uses current native index rather than quoted index for dedup', async () => {
  const original = await officialEvent();
  const voice = {
    ...original.d.attachments[1],
    url: 'https://multimedia.nt.qq.com.cn/voice',
    voice_wav_url: null,
  };
  if (!original.d.attachments[1]) throw new Error('missing voice fixture');
  const event = {
    ...original,
    d: {
      ...original.d,
      attachments: [],
      msg_elements: [
        {
          id: null,
          message_id: null,
          msg_idx: 'quoted-index',
          message_type: 103,
          content: 'quoted only',
          author: null,
          attachments: [{ ...original.d.attachments[1], ...voice }],
          msg_elements: [],
        },
      ],
    },
  };
  const mapped = mapOfficialInput(official, event, null);
  expect(mapped?.materials.map((part) => [part.kind, part.quoted])).toEqual([['voice', true]]);
  expect(mapped?.text).toBe(original.d.content);
  const changedCurrent = mapOfficialInput(
    official,
    {
      ...event,
      d: { ...event.d, message_scene: { ...event.d.message_scene, msg_idx: 'another-current' } },
    },
    null,
  );
  expect(changedCurrent?.eventKey).not.toBe(mapped?.eventKey);
  const changedQuote = mapOfficialInput(
    official,
    {
      ...event,
      d: { ...event.d, message_scene: { ...event.d.message_scene, ref_msg_idx: 'another-quote' } },
    },
    null,
  );
  expect(changedQuote?.eventKey).toBe(mapped?.eventKey);
});

it('preserves OneBot negative/opaque message IDs and explicit at evidence without nickname roles', async () => {
  const mapped = mapOneBotInput(onebot, await oneBotEvent(), 54321);
  expect(mapped?.text).toBe('  test\r\n🦜 ');
  expect(mapped?.route.reference?.messageId).toBe('-42');
  expect(mapped?.route.reference?.eventId).toBeNull();
  expect(mapped?.quote?.reference.messageId).toBe('opaque-message-fixture');
  expect(mapped?.mentioned).toBe(true);
  expect(mapped?.materials.map((part) => part.kind)).toEqual(['image', 'voice', 'file']);
  expect(mapped?.actor).toEqual({
    account: onebot,
    scene: 'group',
    senderId: '30001',
    groupId: '20001',
  });
});

it('rejects temporary private sessions and missing group identity instead of degrading to a friend send', async () => {
  const event = await oneBotEvent();
  expect(() =>
    mapOneBotInput(onebot, { ...event, message_type: 'private', sub_type: 'group' }),
  ).toThrow();
  expect(() => mapOneBotInput(onebot, { ...event, group_id: null })).toThrow();
  expect(() => mapOneBotInput(onebot, { ...event, anonymous: true })).toThrow();
  expect(() => mapOneBotInput({ ...onebot, accountId: '10002' }, event)).toThrow();
});

it('records a file notice as resource context without inventing a native message or actionable event', () => {
  const notice = {
    kind: 'group-upload' as const,
    post_type: 'notice' as const,
    notice_type: 'group_upload' as const,
    self_id: 10001,
    time: 100,
    group_id: 20001,
    user_id: 30001,
    message_id: null,
    file: { id: 'opaque-file', name: 'report.txt', size: 20, busid: 1 },
  };
  const mapped = mapOneBotInput(onebot, notice, 100000);
  expect(mapped?.eventKey).toBeNull();
  expect(mapped?.contextOnly).toBe(true);
  expect(mapped?.route.reference?.messageId).toBeNull();
  expect(mapped?.fileEvidence?.fileId).toBe('opaque-file');
  expect(mapped?.observationId).toBe(
    mapOneBotInput(onebot, { ...notice, time: 101 }, 101000)?.observationId,
  );
  expect(mapped?.observationId).not.toBe(notice.file.id);
});

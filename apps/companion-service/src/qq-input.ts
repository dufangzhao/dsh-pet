import { createHash } from 'node:crypto';
import {
  COMPANION_MATERIAL_MAX_PARTS,
  QQ_QUOTE_MAX_UNITS,
  isQQAccountRef,
  isQQExternalId,
  isQQQuoteEvidence,
  isQQReplyRoute,
  type QQAccountRef,
  type QQExternalActor,
  type QQQuoteEvidence,
  type QQReplyRoute,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQFileEvidence } from '@pet/state-sqlite';
import type { OfficialAttachment, OfficialMessageEvent } from '@pet/qq-official';
import type {
  OneBotFileNotice,
  OneBotFrame,
  OneBotMessageEvent,
  OneBotSegment,
} from '@pet/qq-onebot';

type OneBotMediaSegment = Extract<OneBotSegment, { type: 'image' | 'record' | 'file' }>;
/** Private native references, never a download permission or a public MaterialRef. */
export type QQRemoteMaterial =
  | {
      readonly protocol: 'official';
      readonly kind: 'image' | 'voice' | 'file';
      readonly quoted: boolean;
      readonly attachment: OfficialAttachment;
    }
  | {
      readonly protocol: 'onebot-v11';
      readonly kind: 'image' | 'voice' | 'file';
      readonly quoted: boolean;
      readonly segment: OneBotMediaSegment;
    };

export interface QQMappedInput {
  readonly eventKey: string | null;
  readonly observationId: string;
  readonly actor: QQExternalActor;
  readonly route: QQReplyRoute;
  readonly text: string;
  readonly quote: QQQuoteEvidence | null;
  readonly mentioned: boolean;
  readonly self: boolean;
  readonly machine: boolean;
  readonly contextOnly: boolean;
  readonly observedAt: number;
  readonly materials: readonly QQRemoteMaterial[];
  readonly fileEvidence: QQFileEvidence | null;
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const accountKey = (account: QQAccountRef): unknown[] => [
  account.protocol,
  account.sourcePluginId,
  account.instanceId,
  account.accountId,
];
function external(value: unknown): string {
  if (!isQQExternalId(value)) throw new KernelFault('invalid-input');
  return value;
}
function nativeId(value: string | number | null): string | null {
  return value === null ? null : external(String(value));
}
function eventKey(account: QQAccountRef, route: QQReplyRoute, messageId: string): string {
  return `qq-message-${digest([accountKey(account), route.scene, route.targetId, messageId, route.reference?.displayReference ?? null])}`;
}
function checked(input: QQMappedInput): QQMappedInput {
  if (!isQQReplyRoute(input.route) || (input.quote !== null && !isQQQuoteEvidence(input.quote)))
    throw new KernelFault('invalid-input');
  if (input.materials.length > COMPANION_MATERIAL_MAX_PARTS)
    throw new KernelFault('quota-exceeded');
  return input;
}
function officialQuote(event: OfficialMessageEvent): QQQuoteEvidence | null {
  const elements = event.d.msg_elements;
  const referenceId = event.d.message_reference?.message_id ?? elements[0]?.message_id ?? null;
  if (!referenceId && !elements.length && !event.d.message_scene.ref_msg_idx) return null;
  const lines: string[] = [];
  const collect = (items: typeof elements): void => {
    for (const item of items) {
      if (item.content) lines.push(item.content);
      collect(item.msg_elements);
    }
  };
  collect(elements);
  const quotedText = lines.join('\n\n');
  if (quotedText.length > QQ_QUOTE_MAX_UNITS) throw new KernelFault('quota-exceeded');
  return {
    reference: {
      eventId: null,
      messageId: referenceId === null ? null : external(referenceId),
      occurredAt: null,
      displayReference: event.d.message_scene.ref_msg_idx ?? elements[0]?.msg_idx ?? null,
    },
    quotedText,
  };
}

/** The profile uses distinct user/member open-ID namespaces. Generic author.id is not substituted. */
export function mapOfficialInput(
  account: QQAccountRef,
  event: OfficialMessageEvent,
  selfId: string | null,
  observedAt = Date.now(),
): QQMappedInput | null {
  if (!isQQAccountRef(account) || account.protocol !== 'official')
    throw new KernelFault('invalid-input');
  if (event.d.author.bot === true || (selfId !== null && event.d.author.id === selfId)) return null;
  const scene = event.t === 'C2C_MESSAGE_CREATE' ? 'private' : 'group';
  const senderId = external(
    scene === 'private' ? event.d.author.user_openid : event.d.author.member_openid,
  );
  const messageId = external(event.d.id);
  const groupId = scene === 'group' ? external(event.d.group_openid) : null;
  const actor: QQExternalActor =
    groupId === null
      ? { account, scene: 'private', senderId }
      : { account, scene: 'group', senderId, groupId };
  const route: QQReplyRoute = {
    kind: 'qq',
    account,
    scene,
    targetId: groupId ?? senderId,
    reference: {
      eventId: event.id === null ? null : external(event.id),
      messageId,
      occurredAt: Date.parse(event.d.timestamp),
      displayReference: event.d.message_scene.msg_idx,
    },
  };
  const key = eventKey(account, route, messageId);
  const materials: QQRemoteMaterial[] = [];
  const add = (attachment: OfficialAttachment, quoted: boolean): void => {
    materials.push({
      protocol: 'official',
      quoted,
      kind:
        attachment.content_type === 'voice' ||
        attachment.voice_wav_url ||
        attachment.content_type?.startsWith('audio/')
          ? 'voice'
          : attachment.content_type?.startsWith('image/')
            ? 'image'
            : 'file',
      attachment,
    });
  };
  for (const attachment of event.d.attachments) add(attachment, false);
  const collect = (elements: OfficialMessageEvent['d']['msg_elements']): void => {
    for (const element of elements) {
      for (const attachment of element.attachments) add(attachment, true);
      collect(element.msg_elements);
    }
  };
  collect(event.d.msg_elements);
  return checked({
    eventKey: key,
    observationId: `qq-input-${digest(key)}`,
    actor,
    route,
    text: event.d.content,
    quote: officialQuote(event),
    mentioned:
      event.t === 'GROUP_AT_MESSAGE_CREATE' ||
      event.d.mentions.some((mention) => mention.is_you === true),
    self: selfId !== null && (senderId === selfId || event.d.author.id === selfId),
    machine: false,
    contextOnly: false,
    observedAt,
    materials,
    fileEvidence: null,
  });
}

function oneBotMessage(
  account: QQAccountRef,
  event: OneBotMessageEvent,
  observedAt: number,
): QQMappedInput {
  if (event.anonymous) throw new KernelFault('permission-denied');
  if (event.message_type === 'private' && (event.sub_type === 'group' || event.group_id !== null))
    throw new KernelFault('unavailable');
  if (event.message.some((segment) => segment.type === 'unsupported'))
    throw new KernelFault('unavailable');
  const senderId = external(String(event.user_id));
  if (event.message_type === 'group' && event.group_id === null)
    throw new KernelFault('invalid-input');
  const groupId = event.message_type === 'group' ? nativeId(event.group_id) : null;
  const messageId = external(String(event.message_id));
  const actor: QQExternalActor =
    groupId === null
      ? { account, scene: 'private', senderId }
      : { account, scene: 'group', senderId, groupId };
  const route: QQReplyRoute = {
    kind: 'qq',
    account,
    scene: actor.scene,
    targetId: groupId ?? senderId,
    reference: { eventId: null, messageId, occurredAt: event.time * 1000, displayReference: null },
  };
  const replies = event.message.filter((segment) => segment.type === 'reply');
  if (replies.length > 1) throw new KernelFault('unavailable');
  const reply = replies[0];
  const quote: QQQuoteEvidence | null = reply
    ? {
        reference: {
          eventId: null,
          messageId: nativeId(reply.data.id),
          occurredAt: null,
          displayReference: null,
        },
        quotedText: '',
      }
    : null;
  const key = eventKey(account, route, messageId);
  const materials = event.message.flatMap((segment): QQRemoteMaterial[] => {
    if (segment.type !== 'image' && segment.type !== 'record' && segment.type !== 'file') return [];
    return [
      {
        protocol: 'onebot-v11',
        kind: segment.type === 'record' ? 'voice' : segment.type,
        quoted: false,
        segment,
      },
    ];
  });
  return checked({
    eventKey: key,
    observationId: `qq-input-${digest(key)}`,
    actor,
    route,
    text: event.message
      .filter((segment) => segment.type === 'text')
      .map((segment) => segment.data.text)
      .join(''),
    quote,
    mentioned: event.message.some(
      (segment) => segment.type === 'at' && String(segment.data.qq) === account.accountId,
    ),
    self: event.isSelf || event.post_type === 'message_sent',
    machine: false,
    contextOnly: false,
    observedAt,
    materials,
    fileEvidence: null,
  });
}
function oneBotFile(
  account: QQAccountRef,
  event: OneBotFileNotice,
  observedAt: number,
): QQMappedInput {
  const senderId = external(String(event.user_id));
  const groupId = external(String(event.group_id));
  const fileId = external(event.file.id);
  const actor: QQExternalActor = { account, scene: 'group', senderId, groupId };
  const fileEvidence: QQFileEvidence = {
    kind: 'qq-file',
    account,
    groupId,
    fileId,
    busId: event.file.busid === null ? null : String(event.file.busid),
    name: event.file.name,
    reportedSize: event.file.size,
  };
  return checked({
    eventKey: null,
    // Resource identity is useful context dedup; it is deliberately not a native event/message ID.
    observationId: `observe-file-${digest([accountKey(account), groupId, fileId, fileEvidence.busId])}`,
    actor,
    route: {
      kind: 'qq',
      account,
      scene: 'group',
      targetId: groupId,
      reference: {
        eventId: null,
        messageId: nativeId(event.message_id),
        occurredAt: event.time * 1000,
        displayReference: null,
      },
    },
    text: '',
    quote: null,
    mentioned: false,
    self: senderId === account.accountId,
    machine: false,
    contextOnly: true,
    observedAt,
    materials: [],
    fileEvidence,
  });
}
export function mapOneBotInput(
  account: QQAccountRef,
  event: Exclude<OneBotFrame, { kind: 'response' }>,
  observedAt = Date.now(),
): QQMappedInput | null {
  if (
    !isQQAccountRef(account) ||
    account.protocol !== 'onebot-v11' ||
    String(event.self_id) !== account.accountId
  )
    throw new KernelFault('invalid-input');
  if (event.kind === 'message') return oneBotMessage(account, event, observedAt);
  if (event.kind === 'group-upload') return oneBotFile(account, event, observedAt);
  return null;
}

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  QQ_INLINE_TEXT_MAX_PARTS,
  QQ_INLINE_TEXT_MAX_UNITS,
  QQ_DELIVERY_MAX_PARTS,
  isCompanionOrigins,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
  type CompanionMessage,
  type QQDeliveryPart,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';

export const textHash = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');
export const deliveryId = (inputId: string): string => `qq-delivery-${textHash(inputId)}`;
export const TEXT_DOCUMENT_NOTICE = '完整回复已整理为文本文件，请查看附件。';

/** Exact UTF-16 application chunks; never cut Unicode pairs or a CRLF boundary. */
export function inlineText(text: string): readonly string[] | null {
  if (!text.length || Buffer.from(text).toString('utf8') !== text)
    throw new KernelFault('invalid-input');
  const result: string[] = [];
  let at = 0;
  while (at < text.length && result.length < QQ_INLINE_TEXT_MAX_PARTS) {
    let end = Math.min(text.length, at + QQ_INLINE_TEXT_MAX_UNITS);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      if (text[end - 1] === '\r' && text[end] === '\n') end--;
    }
    if (end <= at) throw new KernelFault('invalid-input');
    result.push(text.slice(at, end));
    at = end;
  }
  return at === text.length ? result : null;
}

export function deliveryOrigins(
  messages: readonly CompanionMessage[],
): readonly CompanionInputOrigin[] {
  const origins: CompanionInputOrigin[] = [];
  for (const message of messages) {
    if (!message.origins) throw new KernelFault('permission-denied');
    for (const origin of message.origins) {
      const known = origins.find((value) => value.inputId === origin.inputId);
      if (known && !isDeepStrictEqual(known, origin)) throw new KernelFault('conflict');
      if (!known) origins.push(structuredClone(origin));
    }
  }
  if (!isCompanionOrigins(origins)) throw new KernelFault('permission-denied');
  return origins;
}

export function requiredMedia(
  messages: readonly CompanionMessage[],
): readonly CompanionMaterialRef[] {
  const result: CompanionMaterialRef[] = [];
  for (const message of messages) {
    for (const material of message.materials ?? []) {
      if (message.content?.kind === 'text-document' && material.id === message.content.material.id)
        continue;
      if (!['image', 'file', 'text'].includes(material.kind)) throw new KernelFault('unavailable');
      result.push(material);
    }
  }
  return result;
}

export function deliveryParts(
  id: string,
  text: string,
  messages: readonly CompanionMessage[],
  media: readonly CompanionMaterialRef[],
  document: CompanionMaterialRef | undefined,
  voice: boolean,
): readonly QQDeliveryPart[] {
  const contents: Array<Pick<QQDeliveryPart, 'requirement' | 'content' | 'preparation'>> = [];
  if (document) {
    contents.push({
      requirement: 'mandatory-text',
      preparation: 'ready',
      content: {
        kind: 'inline-text',
        text: TEXT_DOCUMENT_NOTICE,
        sha256: textHash(TEXT_DOCUMENT_NOTICE),
      },
    });
    contents.push({
      requirement: 'mandatory-text',
      preparation: 'ready',
      content: { kind: 'material', material: document },
    });
  } else {
    const chunks = inlineText(text);
    if (!chunks) throw new KernelFault('quota-exceeded');
    contents.push(
      ...chunks.map((chunk) => ({
        requirement: 'mandatory-text' as const,
        preparation: 'ready' as const,
        content: { kind: 'inline-text' as const, text: chunk, sha256: textHash(chunk) },
      })),
    );
  }
  contents.push(
    ...media.map((material) => ({
      requirement: 'required-media' as const,
      preparation: 'ready' as const,
      content: { kind: 'material' as const, material },
    })),
  );
  if (voice)
    contents.push({
      requirement: 'optional-voice',
      preparation: 'pending',
      content: { kind: 'voice', messageIds: messages.map((message) => message.id), material: null },
    });
  if (contents.length > QQ_DELIVERY_MAX_PARTS) throw new KernelFault('quota-exceeded');
  return contents.map((part, index) => ({
    ...part,
    id: `${id}-p${index}`,
    index,
    error: null,
    msgSeq: null,
    upload: null,
    send: null,
  }));
}

import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MAX_TEXT,
  COMPANION_MATERIAL_MAX_PARTS,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  isQQAccountRef,
  isQQExternalActor,
  isQQExternalId,
  isQQQuoteEvidence,
  isQQReplyRoute,
  isCompanionRecordId,
  sameQQAccount,
  type JsonObject,
  type LocalHostQQInput,
  type LocalHostQQMaterial,
  type LocalHostQQMaterialSelector,
  type QQFileEvidence,
} from '@pet/contracts';
import { isRecord, jsonPreflight } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import {
  qqAccountKey,
  qqInputDigest,
  qqInputEventKey,
  type QQMappedInput,
  type QQRemoteMaterial,
} from './qq-input.js';

export type QQMaterialEvidence = Omit<LocalHostQQMaterial, 'handle' | 'expectedSha256'>;
export type QQCanonicalInput = Omit<QQMappedInput, 'materials'> & {
  readonly materials: readonly QQMaterialEvidence[];
};
const invalid = (): never => {
  throw new KernelFault('invalid-input');
};
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
/** Same range the contracts guards use: C0 controls and DEL are never valid text. */
const noControls = (value: string): boolean =>
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit && noControls(value);
const size = (value: unknown): value is number | string | null =>
  value === null ||
  (typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= COMPANION_MATERIAL_INPUT_MAX_BYTES) ||
  (typeof value === 'string' &&
    /^\d{1,10}$/.test(value) &&
    Number(value) <= COMPANION_MATERIAL_INPUT_MAX_BYTES);
const safeLabel = (value: unknown): value is string | null =>
  value === null || (bounded(value, 1024) && !/^(?:[a-z]+:\/\/|[/\\]|[a-z]:\\)/i.test(value));
function nativeMetadata(part: QQRemoteMaterial): QQMaterialEvidence {
  const value =
    part.protocol === 'official'
      ? {
          kind: part.kind,
          quoted: part.quoted,
          name: part.attachment.filename,
          reportedType: part.attachment.content_type,
          reportedSize: part.attachment.size,
          fileId: null,
        }
      : {
          kind: part.kind,
          quoted: part.quoted,
          name: part.segment.data['name'] ?? part.segment.data['file_name'] ?? null,
          reportedType: null,
          reportedSize: part.segment.data['file_size'] ?? part.segment.data['size'] ?? null,
          fileId: part.segment.data['file_id'] ?? null,
        };
  if (
    !safeLabel(value.name) ||
    !size(value.reportedSize) ||
    (value.reportedType !== null && !bounded(value.reportedType, 128)) ||
    (value.fileId !== null && (!isQQExternalId(value.fileId) || !safeLabel(value.fileId)))
  )
    return invalid();
  return value as QQMaterialEvidence;
}
function header(value: QQCanonicalInput | QQMappedInput): Omit<QQCanonicalInput, 'materials'> {
  return {
    eventKey: value.eventKey,
    observationId: value.observationId,
    actor: structuredClone(value.actor),
    route: structuredClone(value.route),
    text: value.text,
    quote: structuredClone(value.quote),
    mentioned: value.mentioned,
    self: value.self,
    machine: value.machine,
    contextOnly: value.contextOnly,
    observedAt: value.observedAt,
    fileEvidence: structuredClone(value.fileEvidence),
  };
}
/** One extraction of the old canonical evidence fields, shared by service-local and projected ingress. */
export function canonicalQQInput(mapped: QQMappedInput): QQCanonicalInput {
  return { ...header(mapped), materials: mapped.materials.map(nativeMetadata) };
}
export function projectQQInput(
  mapped: QQMappedInput,
  handles: readonly string[],
): LocalHostQQInput {
  if (handles.length !== mapped.materials.length || handles.some((id) => !isCompanionRecordId(id)))
    return invalid();
  const canonical = canonicalQQInput(mapped);
  return parseQQInputProjection({
    ...canonical,
    materials: canonical.materials.map((part, index) => ({
      ...part,
      handle: handles[index],
      expectedSha256: null,
    })),
  });
}
export function canonicalQQEvidence(mapped: QQCanonicalInput): JsonObject {
  const parts = mapped.materials.map((part) =>
    mapped.actor.account.protocol === 'official'
      ? {
          kind: part.kind,
          quoted: part.quoted,
          name: part.name,
          type: part.reportedType,
          size: part.reportedSize,
        }
      : {
          kind: part.kind,
          quoted: part.quoted,
          name: part.name,
          size: part.reportedSize,
          fileId: part.fileId,
        },
  );
  return JSON.parse(
    JSON.stringify({
      actor: mapped.actor,
      text: mapped.text,
      quote: mapped.quote,
      messageId: mapped.route.reference?.messageId ?? null,
      parts,
    }),
  ) as JsonObject;
}
export function canonicalQQObservationText(mapped: QQCanonicalInput): string {
  if (!mapped.materials.length && !mapped.fileEvidence) return mapped.text;
  return JSON.stringify({
    text: mapped.text,
    media: mapped.materials.map((part) => ({
      kind: part.kind,
      quoted: part.quoted,
      name: part.name,
      reportedSize: part.reportedSize,
    })),
    ...(mapped.fileEvidence
      ? {
          sharedFile: {
            materialId: mapped.observationId,
            name: mapped.fileEvidence.name,
            reportedSize: mapped.fileEvidence.reportedSize,
            availability: 'not-loaded',
          },
        }
      : {}),
  });
}
function fileEvidence(value: unknown): value is QQFileEvidence {
  return (
    isRecord(value) &&
    exact(value, ['kind', 'account', 'groupId', 'fileId', 'busId', 'name', 'reportedSize']) &&
    value['kind'] === 'qq-file' &&
    isQQAccountRef(value['account']) &&
    isQQExternalId(value['groupId']) &&
    isQQExternalId(value['fileId']) &&
    safeLabel(value['fileId']) &&
    (value['busId'] === null || isQQExternalId(value['busId'])) &&
    safeLabel(value['name']) &&
    typeof value['name'] === 'string' &&
    (value['reportedSize'] === null || typeof value['reportedSize'] === 'number') &&
    size(value['reportedSize'])
  );
}
export function parseQQMaterialSelector(input: unknown): LocalHostQQMaterialSelector {
  if (!isRecord(input)) return invalid();
  if (
    input['kind'] === 'event-part' &&
    exact(input, ['kind', 'handle', 'index']) &&
    isCompanionRecordId(input['handle']) &&
    Number.isInteger(input['index']) &&
    (input['index'] as number) >= 0 &&
    (input['index'] as number) < COMPANION_MATERIAL_MAX_PARTS
  )
    return { kind: 'event-part', handle: input['handle'], index: input['index'] as number };
  if (
    input['kind'] !== 'observed-file' ||
    !exact(input, ['kind', 'observationId', 'evidence']) ||
    !fileEvidence(input['evidence'])
  )
    return invalid();
  const evidence = input['evidence'];
  if (
    evidence.account.protocol !== 'onebot-v11' ||
    input['observationId'] !==
      `observe-file-${qqInputDigest([qqAccountKey(evidence.account), evidence.groupId, evidence.fileId, evidence.busId])}`
  )
    return invalid();
  return {
    kind: 'observed-file',
    observationId: input['observationId'],
    evidence: structuredClone(evidence),
  };
}
/** Closed, roleless public offer. Native URLs/paths never become synthetic QQRemoteMaterial values. */
export function parseQQInputProjection(input: unknown): LocalHostQQInput {
  const checked = jsonPreflight(input);
  if (!checked.ok || !isRecord(checked.value)) return invalid();
  const value = checked.value;
  if (
    !exact(value, [
      'eventKey',
      'observationId',
      'actor',
      'route',
      'text',
      'quote',
      'mentioned',
      'self',
      'machine',
      'contextOnly',
      'observedAt',
      'materials',
      'fileEvidence',
    ]) ||
    !isQQExternalActor(value['actor']) ||
    !isQQReplyRoute(value['route']) ||
    typeof value['text'] !== 'string' ||
    value['text'].length > COMPANION_MAX_TEXT ||
    (value['quote'] !== null && !isQQQuoteEvidence(value['quote'])) ||
    !['mentioned', 'self', 'machine', 'contextOnly'].every(
      (key) => typeof value[key] === 'boolean',
    ) ||
    !Number.isSafeInteger(value['observedAt']) ||
    (value['observedAt'] as number) < 0 ||
    !Array.isArray(value['materials']) ||
    value['materials'].length > COMPANION_MATERIAL_MAX_PARTS ||
    !isCompanionRecordId(value['observationId']) ||
    (value['fileEvidence'] !== null && !fileEvidence(value['fileEvidence']))
  )
    return invalid();
  const actor = value['actor'],
    route = value['route'];
  if (
    !sameQQAccount(actor.account, route.account) ||
    actor.scene !== route.scene ||
    route.targetId !== (actor.scene === 'group' ? actor.groupId : actor.senderId)
  )
    return invalid();
  const handles = new Set<string>();
  for (const part of value['materials']) {
    if (
      !isRecord(part) ||
      !exact(part, [
        'handle',
        'kind',
        'quoted',
        'name',
        'reportedType',
        'reportedSize',
        'fileId',
        'expectedSha256',
      ]) ||
      !isCompanionRecordId(part['handle']) ||
      handles.has(part['handle']) ||
      !['image', 'voice', 'file'].includes(String(part['kind'])) ||
      typeof part['quoted'] !== 'boolean' ||
      !safeLabel(part['name']) ||
      !size(part['reportedSize']) ||
      (part['reportedType'] !== null && !bounded(part['reportedType'], 128)) ||
      (part['fileId'] !== null &&
        (!isQQExternalId(part['fileId']) || !safeLabel(part['fileId']))) ||
      (part['expectedSha256'] !== null &&
        (typeof part['expectedSha256'] !== 'string' ||
          !/^[a-f0-9]{64}$/.test(part['expectedSha256'])))
    )
      return invalid();
    if (
      (actor.account.protocol === 'official' && part['fileId'] !== null) ||
      (actor.account.protocol === 'onebot-v11' && part['reportedType'] !== null)
    )
      return invalid();
    handles.add(part['handle']);
  }
  if (value['contextOnly']) {
    const file = value['fileEvidence'];
    if (
      !fileEvidence(file) ||
      actor.scene !== 'group' ||
      !sameQQAccount(file.account, actor.account) ||
      file.groupId !== actor.groupId ||
      value['eventKey'] !== null ||
      value['materials'].length ||
      value['text'] !== '' ||
      value['quote'] !== null ||
      value['mentioned'] !== false ||
      value['observationId'] !==
        `observe-file-${qqInputDigest([qqAccountKey(actor.account), actor.groupId, file.fileId, file.busId])}`
    )
      return invalid();
  } else {
    if (value['fileEvidence'] !== null || !route.reference?.messageId) return invalid();
    const key = qqInputEventKey(actor.account, route, route.reference.messageId);
    if (value['eventKey'] !== key || value['observationId'] !== `qq-input-${qqInputDigest(key)}`)
      return invalid();
  }
  return structuredClone(value) as unknown as LocalHostQQInput;
}
/** Useful at the authenticated source boundary; neither object itself is authority. */
export function sameQQProjection(a: LocalHostQQInput, b: LocalHostQQInput): boolean {
  return isDeepStrictEqual(canonicalQQEvidence(a), canonicalQQEvidence(b));
}

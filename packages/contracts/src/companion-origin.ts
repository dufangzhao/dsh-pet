import type { KernelError } from './errors.js';
import { isKernelErrorCode } from './errors.js';
import type { JsonSchema } from './json.js';
import { PLUGIN_ID_SCHEMA } from './shared-schemas.js';
import { PLUGIN_ID_PATTERN } from './patterns.js';

export const COMPANION_OWNER_PRINCIPAL_ID = 'owner';
export const COMPANION_MAX_ORIGINS = 16;
export const COMPANION_INPUT_MATERIAL_MAX = 4;
export const COMPANION_TASK_MATERIAL_MAX = 16;
export const COMPANION_ORIGINS_MAX_BYTES = 12 * 1024;
export const COMPANION_INPUT_CONTEXT_DEFAULT = 2;
export const COMPANION_INPUT_CONTEXT_MAX = 4;
export const COMPANION_INPUT_READY_MAX = 16;
export const COMPANION_INPUT_READY_PER_AUDIENCE = 4;
export const COMPANION_RECORD_ID_PATTERN =
  '^(?![\\s\\S]*[\\r\\n])[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
export const COMPANION_RECORD_ID_SCHEMA: JsonSchema = {
  type: 'string',
  pattern: COMPANION_RECORD_ID_PATTERN,
};
export const QQ_EXTERNAL_ID_MAX_UNITS = 256;
export const QQ_EXTERNAL_ID_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: QQ_EXTERNAL_ID_MAX_UNITS,
  pattern: '^[!-~]+$',
};
export type QQProtocol = 'official' | 'onebot-v11';
/** Nonsecret logical identity. Runtime source generation, connection and credentials stay private. */
export interface QQAccountRef {
  readonly protocol: QQProtocol;
  readonly sourcePluginId: string;
  readonly instanceId: 'default';
  readonly accountId: string;
}
export type QQExternalActor =
  | { readonly account: QQAccountRef; readonly scene: 'private'; readonly senderId: string }
  | {
      readonly account: QQAccountRef;
      readonly scene: 'group';
      readonly senderId: string;
      readonly groupId: string;
    };
export interface QQReplyReference {
  /** Actual upstream event_id when supplied; never a derived admission key. */
  readonly eventId: string | null;
  readonly messageId: string | null;
  readonly occurredAt: number | null;
  readonly displayReference: string | null;
}
export const QQ_QUOTE_MAX_UNITS = 2048;
/** Historical evidence only, kept separate from the current author's instruction text. */
export interface QQQuoteEvidence {
  readonly reference: QQReplyReference;
  readonly quotedText: string;
}
export interface QQReplyRoute {
  readonly kind: 'qq';
  readonly account: QQAccountRef;
  readonly scene: 'private' | 'group';
  readonly targetId: string;
  readonly reference: QQReplyReference | null;
}
export type CompanionReplyRoute = { readonly kind: 'owner-private' } | QQReplyRoute;
export interface CompanionPrincipal {
  readonly id: string;
  readonly kind: 'owner' | 'person';
  readonly displayName: string;
}
export type CompanionAudience =
  | { readonly kind: 'owner-private' }
  | { readonly kind: 'person-private'; readonly principalId: string }
  | { readonly kind: 'qq-group'; readonly account: QQAccountRef; readonly groupId: string }
  | { readonly kind: 'public' };
/** Public scope is for explicitly published facts, not an implicit conversation audience. */
export type CompanionConversationAudience = Exclude<CompanionAudience, { readonly kind: 'public' }>;
interface OriginBase {
  /** Explicit canonical input/admission identity; does not reinterpret CompanionMessage.inputId. */
  readonly inputId: string;
  readonly audience: CompanionConversationAudience;
  readonly route: CompanionReplyRoute;
  readonly policyRevision: number | null;
}
/** Durable audit/provenance only. This object never supplies a host action grant. */
export type CompanionInputOrigin =
  | (OriginBase & { readonly kind: 'owner'; readonly principalId: 'owner' })
  | (OriginBase & {
      readonly kind: 'qq';
      readonly principalId: string;
      readonly actor: QQExternalActor;
      readonly eventKey: string;
      readonly messageId: string | null;
      readonly trigger: 'direct' | 'mention' | 'wake-word';
      readonly quote: QQQuoteEvidence | null;
    })
  | (OriginBase & {
      readonly kind: 'qq-proactive';
      readonly principalId: null;
      readonly account: QQAccountRef;
      readonly eventKey: string;
    })
  | (OriginBase & {
      readonly kind: 'work-result';
      readonly principalId: string;
      readonly taskId: string;
      readonly initiatingInputId: string | null;
    })
  | (Omit<OriginBase, 'inputId'> & {
      readonly kind: 'legacy-unknown';
      readonly inputId: string | null;
      readonly principalId: 'owner';
    });
export interface CompanionTaskOrigin {
  readonly inputId: string | null;
  readonly principalId: string;
  readonly audience: CompanionConversationAudience;
  readonly route: CompanionReplyRoute;
  readonly origins: readonly CompanionInputOrigin[];
  readonly materialIds: readonly string[];
}
export type CompanionInputPhase =
  | 'preparing'
  | 'ready'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'unknown';
export type CompanionCleanup = 'pending' | 'settled' | 'failed' | 'unknown';
export interface CompanionInputAdmission {
  readonly id: string;
  readonly messageId: string | null;
  readonly origin: CompanionInputOrigin;
  readonly materialIds: readonly string[];
  readonly phase: CompanionInputPhase;
  readonly cleanup: CompanionCleanup;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error: KernelError | null;
}

const closed = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const integer: JsonSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableId: JsonSchema = { anyOf: [QQ_EXTERNAL_ID_SCHEMA, { type: 'null' }] };
export const QQ_ACCOUNT_REF_SCHEMA: JsonSchema = closed({
  protocol: { enum: ['official', 'onebot-v11'] },
  sourcePluginId: PLUGIN_ID_SCHEMA,
  instanceId: { const: 'default' },
  accountId: QQ_EXTERNAL_ID_SCHEMA,
});
export const QQ_EXTERNAL_ACTOR_SCHEMA: JsonSchema = {
  oneOf: [
    closed({
      account: QQ_ACCOUNT_REF_SCHEMA,
      scene: { const: 'private' },
      senderId: QQ_EXTERNAL_ID_SCHEMA,
    }),
    closed({
      account: QQ_ACCOUNT_REF_SCHEMA,
      scene: { const: 'group' },
      senderId: QQ_EXTERNAL_ID_SCHEMA,
      groupId: QQ_EXTERNAL_ID_SCHEMA,
    }),
  ],
};
export const QQ_REPLY_REFERENCE_SCHEMA: JsonSchema = closed({
  eventId: nullableId,
  messageId: nullableId,
  occurredAt: { anyOf: [integer, { type: 'null' }] },
  displayReference: nullableId,
});
export const QQ_QUOTE_EVIDENCE_SCHEMA: JsonSchema = closed({
  reference: QQ_REPLY_REFERENCE_SCHEMA,
  quotedText: { type: 'string', maxLength: QQ_QUOTE_MAX_UNITS },
});
export const QQ_REPLY_ROUTE_SCHEMA: JsonSchema = closed({
  kind: { const: 'qq' },
  account: QQ_ACCOUNT_REF_SCHEMA,
  scene: { enum: ['private', 'group'] },
  targetId: QQ_EXTERNAL_ID_SCHEMA,
  reference: { anyOf: [QQ_REPLY_REFERENCE_SCHEMA, { type: 'null' }] },
});
export const COMPANION_REPLY_ROUTE_SCHEMA: JsonSchema = {
  oneOf: [closed({ kind: { const: 'owner-private' } }), QQ_REPLY_ROUTE_SCHEMA],
};
const conversationAudiences = [
  closed({ kind: { const: 'owner-private' } }),
  closed({ kind: { const: 'person-private' }, principalId: COMPANION_RECORD_ID_SCHEMA }),
  closed({
    kind: { const: 'qq-group' },
    account: QQ_ACCOUNT_REF_SCHEMA,
    groupId: QQ_EXTERNAL_ID_SCHEMA,
  }),
];
export const COMPANION_CONVERSATION_AUDIENCE_SCHEMA: JsonSchema = { oneOf: conversationAudiences };
export const COMPANION_AUDIENCE_SCHEMA: JsonSchema = {
  oneOf: [...conversationAudiences, closed({ kind: { const: 'public' } })],
};
export const COMPANION_ORIGIN_SCHEMA: JsonSchema = {
  oneOf: [
    closed({
      kind: { const: 'owner' },
      inputId: COMPANION_RECORD_ID_SCHEMA,
      principalId: { const: 'owner' },
      audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
      route: COMPANION_REPLY_ROUTE_SCHEMA,
      policyRevision: { anyOf: [integer, { type: 'null' }] },
    }),
    closed({
      kind: { const: 'qq' },
      inputId: COMPANION_RECORD_ID_SCHEMA,
      principalId: COMPANION_RECORD_ID_SCHEMA,
      audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
      route: QQ_REPLY_ROUTE_SCHEMA,
      policyRevision: integer,
      actor: QQ_EXTERNAL_ACTOR_SCHEMA,
      eventKey: QQ_EXTERNAL_ID_SCHEMA,
      messageId: nullableId,
      trigger: { enum: ['direct', 'mention', 'wake-word'] },
      quote: { anyOf: [QQ_QUOTE_EVIDENCE_SCHEMA, { type: 'null' }] },
    }),
    closed({
      kind: { const: 'qq-proactive' },
      inputId: COMPANION_RECORD_ID_SCHEMA,
      principalId: { type: 'null' },
      audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
      route: QQ_REPLY_ROUTE_SCHEMA,
      policyRevision: integer,
      account: QQ_ACCOUNT_REF_SCHEMA,
      eventKey: QQ_EXTERNAL_ID_SCHEMA,
    }),
    closed({
      kind: { const: 'work-result' },
      inputId: COMPANION_RECORD_ID_SCHEMA,
      principalId: COMPANION_RECORD_ID_SCHEMA,
      audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
      route: COMPANION_REPLY_ROUTE_SCHEMA,
      policyRevision: { anyOf: [integer, { type: 'null' }] },
      taskId: COMPANION_RECORD_ID_SCHEMA,
      initiatingInputId: { anyOf: [COMPANION_RECORD_ID_SCHEMA, { type: 'null' }] },
    }),
    closed({
      kind: { const: 'legacy-unknown' },
      inputId: { anyOf: [COMPANION_RECORD_ID_SCHEMA, { type: 'null' }] },
      principalId: { const: 'owner' },
      audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
      route: COMPANION_REPLY_ROUTE_SCHEMA,
      policyRevision: { type: 'null' },
    }),
  ],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isCompanionRecordId(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(COMPANION_RECORD_ID_PATTERN).test(value);
}
export function isQQExternalId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= QQ_EXTERNAL_ID_MAX_UNITS && /^[!-~]+$/.test(value)
  );
}
function revision(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function qqId(account: QQAccountRef, value: unknown): value is string {
  return (
    isQQExternalId(value) && (account.protocol !== 'onebot-v11' || /^[1-9][0-9]{0,19}$/.test(value))
  );
}
export function isQQAccountRef(value: unknown): value is QQAccountRef {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['protocol', 'sourcePluginId', 'instanceId', 'accountId']) &&
    (v['protocol'] === 'official' || v['protocol'] === 'onebot-v11') &&
    v['instanceId'] === 'default' &&
    typeof v['sourcePluginId'] === 'string' &&
    new RegExp(PLUGIN_ID_PATTERN).test(v['sourcePluginId']) &&
    isQQExternalId(v['accountId']) &&
    (v['protocol'] !== 'onebot-v11' || /^[1-9][0-9]{0,19}$/.test(v['accountId']))
  );
}
export function sameQQAccount(a: QQAccountRef, b: QQAccountRef): boolean {
  return (
    a.protocol === b.protocol &&
    a.sourcePluginId === b.sourcePluginId &&
    a.instanceId === b.instanceId &&
    a.accountId === b.accountId
  );
}
export function isQQExternalActor(value: unknown): value is QQExternalActor {
  const v = record(value);
  return (
    !!v &&
    isQQAccountRef(v['account']) &&
    qqId(v['account'], v['senderId']) &&
    ((v['scene'] === 'private' && exact(v, ['account', 'scene', 'senderId'])) ||
      (v['scene'] === 'group' &&
        exact(v, ['account', 'scene', 'senderId', 'groupId']) &&
        qqId(v['account'], v['groupId'])))
  );
}
export function qqActorKey(actor: QQExternalActor): string {
  return JSON.stringify([
    actor.account.protocol,
    actor.account.sourcePluginId,
    actor.account.instanceId,
    actor.account.accountId,
    actor.scene,
    actor.scene === 'group' ? actor.groupId : null,
    actor.senderId,
  ]);
}
export function isQQReplyRoute(value: unknown): value is QQReplyRoute {
  const v = record(value);
  if (
    !v ||
    !exact(v, ['kind', 'account', 'scene', 'targetId', 'reference']) ||
    v['kind'] !== 'qq' ||
    !isQQAccountRef(v['account']) ||
    !['private', 'group'].includes(String(v['scene'])) ||
    !qqId(v['account'], v['targetId'])
  )
    return false;
  return v['reference'] === null || isQQReplyReference(v['reference']);
}
export function isQQReplyReference(value: unknown): value is QQReplyReference {
  const r = record(value);
  return (
    !!r &&
    exact(r, ['eventId', 'messageId', 'occurredAt', 'displayReference']) &&
    (r['eventId'] === null || isQQExternalId(r['eventId'])) &&
    (r['messageId'] === null || isQQExternalId(r['messageId'])) &&
    (r['occurredAt'] === null || revision(r['occurredAt'])) &&
    (r['displayReference'] === null || isQQExternalId(r['displayReference']))
  );
}
export function hasQQNativeReplyBasis(reference: QQReplyReference | null): boolean {
  return reference !== null && (reference.eventId !== null || reference.messageId !== null);
}
export function isQQQuoteEvidence(value: unknown): value is QQQuoteEvidence {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['reference', 'quotedText']) &&
    isQQReplyReference(v['reference']) &&
    typeof v['quotedText'] === 'string' &&
    v['quotedText'].length <= QQ_QUOTE_MAX_UNITS &&
    new TextDecoder().decode(new TextEncoder().encode(v['quotedText'])) === v['quotedText']
  );
}
export function isCompanionAudience(value: unknown): value is CompanionAudience {
  const v = record(value);
  return (
    !!v &&
    ((['owner-private', 'public'].includes(String(v['kind'])) && exact(v, ['kind'])) ||
      (v['kind'] === 'person-private' &&
        exact(v, ['kind', 'principalId']) &&
        isCompanionRecordId(v['principalId']) &&
        v['principalId'] !== COMPANION_OWNER_PRINCIPAL_ID) ||
      (v['kind'] === 'qq-group' &&
        exact(v, ['kind', 'account', 'groupId']) &&
        isQQAccountRef(v['account']) &&
        qqId(v['account'], v['groupId'])))
  );
}
export function isCompanionConversationAudience(
  value: unknown,
): value is CompanionConversationAudience {
  return isCompanionAudience(value) && value.kind !== 'public';
}
export function companionAudienceKey(audience: CompanionAudience): string {
  return audience.kind === 'qq-group'
    ? JSON.stringify([
        audience.kind,
        audience.account.protocol,
        audience.account.sourcePluginId,
        audience.account.instanceId,
        audience.account.accountId,
        audience.groupId,
      ])
    : JSON.stringify(
        audience.kind === 'person-private'
          ? [audience.kind, audience.principalId]
          : [audience.kind],
      );
}
export function isCompanionPrincipal(value: unknown): value is CompanionPrincipal {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['id', 'kind', 'displayName']) &&
    isCompanionRecordId(v['id']) &&
    typeof v['displayName'] === 'string' &&
    v['displayName'].length <= 128 &&
    (v['kind'] === 'owner' ? v['id'] === 'owner' : v['kind'] === 'person' && v['id'] !== 'owner')
  );
}
function ownerRoute(value: unknown): boolean {
  const v = record(value);
  return !!v && exact(v, ['kind']) && v['kind'] === 'owner-private';
}
export function sameCompanionReplyRoute(a: CompanionReplyRoute, b: CompanionReplyRoute): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === 'owner-private' ||
      (b.kind === 'qq' &&
        sameQQAccount(a.account, b.account) &&
        a.scene === b.scene &&
        a.targetId === b.targetId &&
        a.reference?.eventId === b.reference?.eventId &&
        a.reference?.messageId === b.reference?.messageId &&
        a.reference?.occurredAt === b.reference?.occurredAt &&
        a.reference?.displayReference === b.reference?.displayReference))
  );
}
function routeInAudience(audience: CompanionConversationAudience, route: unknown): boolean {
  if (ownerRoute(route)) return audience.kind === 'owner-private';
  if (!isQQReplyRoute(route)) return false;
  if (route.scene === 'private') return audience.kind !== 'qq-group';
  return (
    audience.kind === 'qq-group' &&
    sameQQAccount(route.account, audience.account) &&
    route.targetId === audience.groupId
  );
}
export function isCompanionInputOrigin(value: unknown): value is CompanionInputOrigin {
  const v = record(value);
  if (
    !v ||
    !isCompanionConversationAudience(v['audience']) ||
    !routeInAudience(v['audience'], v['route'])
  )
    return false;
  const base = ['inputId', 'principalId', 'audience', 'route', 'policyRevision', 'kind'];
  if (v['kind'] === 'legacy-unknown')
    return (
      exact(v, base) &&
      (v['inputId'] === null || isCompanionRecordId(v['inputId'])) &&
      v['principalId'] === 'owner' &&
      v['audience'].kind === 'owner-private' &&
      ownerRoute(v['route']) &&
      v['policyRevision'] === null
    );
  if (
    !isCompanionRecordId(v['inputId']) ||
    !(v['policyRevision'] === null || revision(v['policyRevision']))
  )
    return false;
  if (v['kind'] === 'owner')
    return (
      exact(v, base) &&
      v['principalId'] === 'owner' &&
      v['audience'].kind === 'owner-private' &&
      ownerRoute(v['route'])
    );
  if (v['kind'] === 'qq-proactive')
    return (
      exact(v, [...base, 'account', 'eventKey']) &&
      v['principalId'] === null &&
      revision(v['policyRevision']) &&
      isQQAccountRef(v['account']) &&
      isQQExternalId(v['eventKey']) &&
      v['audience'].kind === 'qq-group' &&
      isQQReplyRoute(v['route']) &&
      v['route'].scene === 'group' &&
      hasQQNativeReplyBasis(v['route'].reference) &&
      sameQQAccount(v['account'], v['route'].account) &&
      sameQQAccount(v['account'], v['audience'].account) &&
      v['route'].targetId === v['audience'].groupId
    );
  if (!isCompanionRecordId(v['principalId'])) return false;
  if (v['audience'].kind === 'owner-private' && v['principalId'] !== 'owner') return false;
  if (v['audience'].kind === 'person-private' && v['audience'].principalId !== v['principalId'])
    return false;
  if (v['kind'] === 'work-result')
    return (
      exact(v, [...base, 'taskId', 'initiatingInputId']) &&
      isCompanionRecordId(v['taskId']) &&
      (isCompanionRecordId(v['initiatingInputId']) ||
        (v['initiatingInputId'] === null &&
          v['principalId'] === 'owner' &&
          v['audience'].kind === 'owner-private' &&
          ownerRoute(v['route'])))
    );
  if (
    v['kind'] !== 'qq' ||
    !exact(v, [...base, 'actor', 'eventKey', 'messageId', 'trigger', 'quote']) ||
    !revision(v['policyRevision']) ||
    !isQQExternalActor(v['actor']) ||
    !isQQExternalId(v['eventKey']) ||
    !(v['messageId'] === null || isQQExternalId(v['messageId'])) ||
    !['direct', 'mention', 'wake-word'].includes(String(v['trigger'])) ||
    !(v['quote'] === null || isQQQuoteEvidence(v['quote'])) ||
    !isQQReplyRoute(v['route'])
  )
    return false;
  const actor = v['actor'],
    route = v['route'];
  if (!hasQQNativeReplyBasis(route.reference) || route.reference?.messageId !== v['messageId'])
    return false;
  return (
    sameQQAccount(actor.account, route.account) &&
    actor.scene === route.scene &&
    (actor.scene === 'private'
      ? route.targetId === actor.senderId && v['audience'].kind !== 'qq-group'
      : route.targetId === actor.groupId &&
        v['audience'].kind === 'qq-group' &&
        sameQQAccount(actor.account, v['audience'].account) &&
        actor.groupId === v['audience'].groupId)
  );
}
export function isCompanionOrigins(value: unknown): value is readonly CompanionInputOrigin[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > COMPANION_MAX_ORIGINS ||
    !value.every(isCompanionInputOrigin)
  )
    return false;
  const first = value[0];
  return (
    !!first &&
    new Set(value.map((origin) => origin.inputId)).size === value.length &&
    value.every(
      (origin) =>
        origin.principalId === first.principalId &&
        companionAudienceKey(origin.audience) === companionAudienceKey(first.audience) &&
        sameCompanionReplyRoute(origin.route, first.route),
    ) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= COMPANION_ORIGINS_MAX_BYTES
  );
}
export function isCompanionTaskOrigin(value: unknown): value is CompanionTaskOrigin {
  const v = record(value);
  if (
    !v ||
    !exact(v, ['inputId', 'principalId', 'audience', 'route', 'origins', 'materialIds']) ||
    !isCompanionRecordId(v['principalId']) ||
    !isCompanionConversationAudience(v['audience']) ||
    !routeInAudience(v['audience'], v['route']) ||
    !Array.isArray(v['origins']) ||
    !Array.isArray(v['materialIds']) ||
    v['materialIds'].length > COMPANION_TASK_MATERIAL_MAX ||
    !v['materialIds'].every(isCompanionRecordId) ||
    new Set(v['materialIds']).size !== v['materialIds'].length
  )
    return false;
  const audience = v['audience'],
    route = v['route'];
  if (!(ownerRoute(route) || isQQReplyRoute(route))) return false;
  if (v['inputId'] === null && v['origins'].length === 0)
    return v['principalId'] === 'owner' && audience.kind === 'owner-private' && ownerRoute(route);
  if (!isCompanionOrigins(v['origins'])) return false;
  const first = v['origins'][0];
  return (
    !!first &&
    first.principalId === v['principalId'] &&
    companionAudienceKey(first.audience) === companionAudienceKey(audience) &&
    (isQQReplyRoute(route)
      ? sameCompanionReplyRoute(first.route, route)
      : first.route.kind === 'owner-private') &&
    (v['inputId'] === null
      ? v['origins'].every((origin) => origin.kind === 'legacy-unknown')
      : isCompanionRecordId(v['inputId']) &&
        v['origins'].some((origin) => origin.inputId === v['inputId']))
  );
}
export function isCompanionInputAdmission(value: unknown): value is CompanionInputAdmission {
  const v = record(value),
    e = v && record(v['error']);
  return (
    !!v &&
    exact(v, [
      'id',
      'messageId',
      'origin',
      'materialIds',
      'phase',
      'cleanup',
      'createdAt',
      'updatedAt',
      'error',
    ]) &&
    isCompanionRecordId(v['id']) &&
    (v['messageId'] === null || isCompanionRecordId(v['messageId'])) &&
    isCompanionInputOrigin(v['origin']) &&
    v['origin'].inputId === v['id'] &&
    Array.isArray(v['materialIds']) &&
    v['materialIds'].length <=
      (v['origin'].kind === 'work-result'
        ? COMPANION_TASK_MATERIAL_MAX
        : COMPANION_INPUT_MATERIAL_MAX) &&
    v['materialIds'].every(isCompanionRecordId) &&
    new Set(v['materialIds']).size === v['materialIds'].length &&
    [
      'preparing',
      'ready',
      'active',
      'completed',
      'cancelled',
      'failed',
      'interrupted',
      'unknown',
    ].includes(String(v['phase'])) &&
    ['pending', 'settled', 'failed', 'unknown'].includes(String(v['cleanup'])) &&
    revision(v['createdAt']) &&
    revision(v['updatedAt']) &&
    (v['error'] === null ||
      (!!e &&
        exact(e, ['code', 'messageKey', 'retryable']) &&
        isKernelErrorCode(e['code']) &&
        e['messageKey'] === `errors.${e['code']}` &&
        typeof e['retryable'] === 'boolean'))
  );
}

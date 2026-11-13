import type { KernelError } from './errors.js';
import { isKernelErrorCode } from './errors.js';
import type { JsonSchema } from './json.js';
import { PLUGIN_ID_PATTERN } from './patterns.js';
import {
  COMPANION_RECORD_ID_SCHEMA,
  QQ_ACCOUNT_REF_SCHEMA,
  QQ_EXTERNAL_ACTOR_SCHEMA,
  QQ_REPLY_ROUTE_SCHEMA,
  QQ_QUOTE_EVIDENCE_SCHEMA,
  isQQQuoteEvidence,
  hasQQNativeReplyBasis,
  isCompanionRecordId,
  isQQExternalId,
  isQQAccountRef,
  sameQQAccount,
  isCompanionPrincipal,
  isQQExternalActor,
  isQQReplyRoute,
  isCompanionAudience,
  isCompanionOrigins,
  qqActorKey,
  companionAudienceKey,
  sameCompanionReplyRoute,
} from './companion-origin.js';
import { KERNEL_ERROR_SCHEMA, SHA256_HEX_SCHEMA } from './shared-schemas.js';
import { COMPANION_MAX_TEXT } from './companion.js';
import {
  isCompanionMaterialRef,
  COMPANION_MATERIAL_REF_SCHEMA,
  COMPANION_MATERIAL_MAX_PARTS,
} from './companion-material.js';
import type { ResponsesConnectionSettings } from './companion-model.js';
import type {
  CompanionConversationAudience,
  CompanionCleanup,
  CompanionInputOrigin,
  CompanionPrincipal,
  QQAccountRef,
  QQExternalActor,
  QQProtocol,
  QQReplyRoute,
  QQQuoteEvidence,
} from './companion-origin.js';
import type { CompanionMaterialRef } from './companion-material.js';

export const QQ_FEATURE_PLUGIN_ID = 'pet.shared-qq';
export const QQ_OFFICIAL_PLUGIN_ID = 'pet.qq-official';
export const QQ_ONEBOT_PLUGIN_ID = 'pet.qq-onebot';
export const QQ_JUDGE_PLUGIN_ID = 'pet.qq-participation-magpie';
export const QQ_JUDGE_PROVIDER_REF = `${QQ_JUDGE_PLUGIN_ID}/magpie`;
export const QQ_CODEC_PLUGIN_ID = 'pet.qq-media-codec';
export const QQ_INSTANCE_ID = 'default';
export const QQ_ENTRY_CAPABILITY = 'companion.qq.entry@1';
export const QQ_PROTOCOL_CAPABILITY = 'companion.qq.protocol@1';
export const QQ_OFFICIAL_CREDENTIAL_ID = 'qq-official-app-secret';
export const QQ_ONEBOT_CREDENTIAL_ID = 'qq-onebot-access-token';
/** Existing Magpie factory key; the independent plugin owner/target supplies its own value. */
export const QQ_JUDGE_CREDENTIAL_ID = 'model-api-key';
export const QQ_SETTINGS_MAX_BYTES = 48 * 1024;
export const QQ_VIEW_MAX_BYTES = 60 * 1024;
export const QQ_STATUS_MAX_BYTES = 8 * 1024;
export const QQ_PAGE_MAX_ITEMS = 32;
export const QQ_PRIVATE_ALLOWLIST_MAX = 128;
export const QQ_GROUP_ALLOWLIST_MAX = 32;
export const QQ_PRINCIPAL_ALIASES_MAX = 256;
export const QQ_ADMINISTRATORS_MAX = 128;
export const QQ_WAKE_WORDS_MAX = 16;
export const QQ_WAKE_WORD_MAX_UNITS = 64;
export const QQ_GROUP_CONTEXT_MAX_MESSAGES = 30;
export const QQ_GROUP_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;
export const QQ_GROUP_CONTEXT_MAX_BYTES = 12 * 1024;
export const QQ_PROACTIVE_DEFAULT_COOLDOWN_MS = 60_000;
export const QQ_PROACTIVE_DEFAULT_REPLIES_HOUR = 6;
export const QQ_PROACTIVE_MAX_REPLIES_HOUR = 60;
export const QQ_JUDGE_MAX_CONCURRENT = 1;
export const QQ_JUDGE_MAX_ATTEMPTS_HOUR = 30;
export const QQ_JUDGE_MIN_GROUP_INTERVAL_MS = 60_000;
export const QQ_JUDGE_TIMEOUT_MS = 10_000;
export const QQ_JUDGE_MAX_OUTPUT_TOKENS = 256;
export const QQ_REPLY_TEXT_SEPARATOR = '\n\n';
export const QQ_INLINE_TEXT_MAX_UNITS = 1024;
export const QQ_INLINE_TEXT_MAX_PARTS = 2;
export const QQ_DELIVERY_MAX_PARTS = 8;
export const QQ_DELIVERY_MAX_MESSAGES = 64;
/** Conservative application compatibility policy, not a claim about universal QQ platform maxima. */
export const QQ_OFFICIAL_C2C_PASSIVE_MAX_PARTS = 4;
export const QQ_OFFICIAL_GROUP_PASSIVE_MAX_PARTS = 5;
export const QQ_OFFICIAL_PASSIVE_WINDOW_MS = 5 * 60 * 1000;

export interface QQOfficialSettings {
  readonly protocol: 'official';
  readonly appId: string;
  readonly scenes: readonly ('private' | 'group')[];
}
export interface QQOneBotSettings {
  readonly protocol: 'onebot-v11';
  readonly accountId: string;
  readonly mode: 'reverse-ws';
  readonly channelMode: 'universal';
  /** Selected profile, not proof of the installed server version/capabilities. */
  readonly mediaProfile: 'snowluma-v11';
  readonly listenHost: string;
  readonly listenPort: number;
  readonly path: string;
}
export type QQSourceSettings = QQOfficialSettings | QQOneBotSettings;
export interface QQSourceSettingsCommand {
  readonly protocol: QQProtocol;
  readonly expectedRevision: number;
  readonly settings: QQSourceSettings;
}
export interface QQCredentialCommand {
  readonly protocol: QQProtocol;
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
  readonly value: string | null;
}
export interface QQProactiveSettings {
  readonly enabled: boolean;
  readonly mode: 'rule-probability' | 'model-assisted';
  readonly probability: number;
  readonly cooldownMs: number;
  readonly maxRepliesPerHour: number;
}
export interface QQGroupSettings {
  readonly contextMessages: number;
  readonly contextMaxAgeMs: number;
  readonly mentionEnabled: boolean;
  readonly wakeWords: readonly string[];
  readonly proactive: QQProactiveSettings;
}
export interface QQPolicySettings {
  readonly privateAllowlist: readonly Extract<QQExternalActor, { readonly scene: 'private' }>[];
  readonly groupAllowlist: readonly { readonly account: QQAccountRef; readonly groupId: string }[];
  readonly principalAliases: readonly {
    readonly actor: QQExternalActor;
    readonly principalId: string;
  }[];
  readonly administratorPrincipalIds: readonly string[];
  readonly knownMachineActors: readonly QQExternalActor[];
  readonly groupDefaults: QQGroupSettings;
  readonly groups: readonly {
    readonly account: QQAccountRef;
    readonly groupId: string;
    readonly settings: QQGroupSettings;
  }[];
  /** Additive voice only; mandatory text has no off switch. */
  readonly voiceOutputEnabled: boolean;
  readonly judge: QQJudgePolicy;
}
export interface QQPolicyCommand {
  readonly expectedRevision: number;
  readonly settings: QQPolicySettings;
}
export interface QQJudgePolicy {
  readonly providerRef: string;
  readonly maxAttemptsPerHour: number;
  readonly perGroupIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}
/** UI composition only: policy is shared-QQ Config; the flat connection belongs to its independent model source. */
export interface QQJudgeSettings extends QQJudgePolicy {
  readonly connection: ResponsesConnectionSettings;
}
export interface QQJudgeSettingsCommand {
  readonly expectedPolicyRevision: number;
  readonly expectedConfigRevision: number;
  readonly settings: QQJudgeSettings;
}
export interface QQJudgeCredentialCommand {
  readonly providerRef: string;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
  readonly value: string | null;
}
export interface QQCredentialView {
  readonly available: boolean;
  readonly writable: boolean;
  readonly version: string;
  readonly source: 'none' | 'memory' | 'managed' | 'local-client-id';
}
export interface QQSourceView {
  readonly protocol: QQProtocol;
  readonly sourcePluginId: string;
  readonly instanceId: 'default';
  readonly desiredEnabled: boolean;
  readonly source: 'ready' | 'disabled' | 'unavailable';
  readonly configRevision: number;
  readonly appliedRevision: number | null;
  readonly settings: QQSourceSettings;
  readonly account: QQAccountRef | null;
  readonly bindingId: string | null;
  readonly phase:
    | 'disabled'
    | 'unconfigured'
    | 'connecting'
    | 'authenticating'
    | 'ready'
    | 'offline'
    | 'retiring'
    | 'failed';
  readonly credential: QQCredentialView;
  readonly installedVersion: string | null;
  readonly media: Readonly<
    Record<'text' | 'image' | 'voice' | 'file', 'unverified' | 'available' | 'unavailable'>
  >;
  readonly cleanup: CompanionCleanup;
  readonly error: KernelError | null;
}
export interface QQJudgeView {
  readonly sourcePluginId: string;
  readonly configRevision: number;
  readonly appliedRevision: number | null;
  readonly settings: QQJudgeSettings;
  readonly bindingId: string | null;
  readonly credential: QQCredentialView;
  readonly readiness: 'unconfigured' | 'configured' | 'unavailable';
  readonly active: number;
  readonly admittedAttempts: number;
  /** Unknown returned usage is null, not zero. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: KernelError | null;
}
export interface QQView {
  readonly version: 1;
  readonly policy: { readonly revision: number; readonly settings: QQPolicySettings };
  readonly sources: readonly QQSourceView[];
  readonly judge: QQJudgeView;
  readonly codec: {
    readonly source: 'ready' | 'disabled' | 'unavailable';
    readonly imageId: string | null;
    readonly manifestSha256: string | null;
    readonly cleanup: CompanionCleanup;
    readonly error: KernelError | null;
  };
}
export interface QQStatus {
  readonly version: 1;
  readonly sources: readonly Pick<
    QQSourceView,
    | 'protocol'
    | 'sourcePluginId'
    | 'desiredEnabled'
    | 'source'
    | 'phase'
    | 'account'
    | 'cleanup'
    | 'error'
  >[];
}
export interface QQPrincipalPage {
  readonly principals: readonly CompanionPrincipal[];
  readonly next: string | null;
}
/** Protocol-normalized content only. The host supplies resolved origin/principal and private grants. */
interface QQInputBody {
  readonly actor: QQExternalActor;
  readonly route: QQReplyRoute;
  readonly text: string;
  readonly materialIds: readonly string[];
  readonly quote: QQQuoteEvidence | null;
  readonly observedAt: number;
}
/** eventKey is a host-namespaced dedup key, never a fabricated upstream event_id; null is context-only. */
export type QQInputContent = QQInputBody &
  (
    | { readonly trigger: 'observation'; readonly eventKey: string | null }
    | { readonly trigger: 'direct' | 'mention' | 'wake-word'; readonly eventKey: string }
  );
export interface QQInputReceipt {
  readonly eventKey: string | null;
  readonly state: 'observed' | 'rejected' | 'preparing' | 'accepted' | 'duplicate';
  readonly inputId: string | null;
  readonly messageId: string | null;
  readonly error: KernelError | null;
}
export interface QQRemoteReceipt {
  readonly messageId: string | null;
  readonly fileId: string | null;
  /** Real nonsecret stream/transfer correlation; never a path, private upload token or message receipt. */
  readonly transferId: string | null;
  readonly sequence: number | null;
  readonly sequenceAuthoritative: boolean | null;
}
export interface QQDeliveryAttempt {
  readonly id: string;
  readonly operation: 'upload' | 'send' | 'upload-and-send';
  readonly phase: 'claimed' | 'dispatched' | 'settled';
  readonly outcome:
    'pending' | 'accepted' | 'rejected' | 'failed' | 'unknown' | 'cancelled-before-dispatch';
  readonly correlationId: string | null;
  readonly receipt: QQRemoteReceipt | null;
  readonly cleanup: CompanionCleanup;
  readonly startedAt: number;
  readonly settledAt: number | null;
  readonly error: KernelError | null;
}
export interface QQDeliveryPart {
  readonly id: string;
  readonly index: number;
  readonly requirement: 'mandatory-text' | 'required-media' | 'optional-voice';
  readonly content:
    | { readonly kind: 'inline-text'; readonly text: string; readonly sha256: string }
    | { readonly kind: 'material'; readonly material: CompanionMaterialRef }
    | {
        readonly kind: 'voice';
        readonly messageIds: readonly string[];
        readonly material: CompanionMaterialRef | null;
      };
  readonly preparation: 'pending' | 'ready' | 'unavailable' | 'failed' | 'cancelled';
  readonly error: KernelError | null;
  readonly msgSeq: number | null;
  readonly upload: QQDeliveryAttempt | null;
  readonly send: QQDeliveryAttempt | null;
}
export interface QQDeliveryView {
  readonly id: string;
  readonly messageIds: readonly string[];
  readonly origins: readonly CompanionInputOrigin[];
  readonly audience: CompanionConversationAudience;
  readonly route: QQReplyRoute;
  readonly textRepresentation: 'inline' | 'text-document';
  readonly mode: 'official-passive' | 'official-proactive' | 'onebot';
  readonly eligibilityExpiresAt: number | null;
  readonly allowedMessageParts: number;
  readonly phase: 'prepared' | 'sending' | 'blocked' | 'terminal';
  readonly outcome: 'pending' | 'accepted' | 'partial' | 'failed' | 'cancelled' | 'unknown';
  readonly parts: readonly QQDeliveryPart[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error: KernelError | null;
}
export interface QQDeliveryPage {
  readonly deliveries: readonly Pick<
    QQDeliveryView,
    'id' | 'messageIds' | 'audience' | 'route' | 'phase' | 'outcome' | 'createdAt' | 'updatedAt'
  >[];
  readonly next: string | null;
}

const closed = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const integer = (min: number, max = Number.MAX_SAFE_INTEGER): JsonSchema => ({
  type: 'integer',
  minimum: min,
  maximum: max,
});
const shortText: JsonSchema = { type: 'string', maxLength: 2048 };
const groupProperties = {
  account: QQ_ACCOUNT_REF_SCHEMA,
  groupId: { type: 'string', minLength: 1, maxLength: 256 },
};
export const QQ_PROACTIVE_SETTINGS_SCHEMA: JsonSchema = closed({
  enabled: { type: 'boolean' },
  mode: { enum: ['rule-probability', 'model-assisted'] },
  probability: { type: 'number', minimum: 0, maximum: 1 },
  cooldownMs: integer(1000, 24 * 60 * 60 * 1000),
  maxRepliesPerHour: integer(1, QQ_PROACTIVE_MAX_REPLIES_HOUR),
});
export const QQ_GROUP_SETTINGS_SCHEMA: JsonSchema = closed({
  contextMessages: integer(0, QQ_GROUP_CONTEXT_MAX_MESSAGES),
  contextMaxAgeMs: integer(1000, QQ_GROUP_CONTEXT_MAX_AGE_MS),
  mentionEnabled: { type: 'boolean' },
  wakeWords: {
    type: 'array',
    maxItems: QQ_WAKE_WORDS_MAX,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: QQ_WAKE_WORD_MAX_UNITS },
  },
  proactive: QQ_PROACTIVE_SETTINGS_SCHEMA,
});
export const QQ_SOURCE_SETTINGS_SCHEMA: JsonSchema = {
  oneOf: [
    closed({
      protocol: { const: 'official' },
      appId: { type: 'string', maxLength: 256 },
      scenes: {
        type: 'array',
        maxItems: 2,
        uniqueItems: true,
        items: { enum: ['private', 'group'] },
      },
    }),
    closed({
      protocol: { const: 'onebot-v11' },
      accountId: { type: 'string', maxLength: 20 },
      channelMode: { const: 'universal' },
      mediaProfile: { const: 'snowluma-v11' },
      mode: { const: 'reverse-ws' },
      listenHost: { type: 'string', minLength: 1, maxLength: 255 },
      listenPort: integer(0, 65535),
      path: { type: 'string', minLength: 1, maxLength: 128 },
    }),
  ],
};
const judgePolicyProperties = {
  providerRef: { type: 'string', minLength: 3, maxLength: 257 },
  maxAttemptsPerHour: integer(1, QQ_JUDGE_MAX_ATTEMPTS_HOUR),
  perGroupIntervalMs: integer(QQ_JUDGE_MIN_GROUP_INTERVAL_MS, 60 * 60 * 1000),
  timeoutMs: integer(1000, QQ_JUDGE_TIMEOUT_MS),
  maxOutputTokens: integer(1, QQ_JUDGE_MAX_OUTPUT_TOKENS),
};
export const QQ_JUDGE_POLICY_SCHEMA: JsonSchema = closed(judgePolicyProperties);
export const QQ_POLICY_SETTINGS_SCHEMA: JsonSchema = closed({
  privateAllowlist: {
    type: 'array',
    maxItems: QQ_PRIVATE_ALLOWLIST_MAX * 2,
    items: QQ_EXTERNAL_ACTOR_SCHEMA,
  },
  groupAllowlist: {
    type: 'array',
    maxItems: QQ_GROUP_ALLOWLIST_MAX * 2,
    items: closed(groupProperties),
  },
  principalAliases: {
    type: 'array',
    maxItems: QQ_PRINCIPAL_ALIASES_MAX,
    items: closed({ actor: QQ_EXTERNAL_ACTOR_SCHEMA, principalId: COMPANION_RECORD_ID_SCHEMA }),
  },
  administratorPrincipalIds: {
    type: 'array',
    maxItems: QQ_ADMINISTRATORS_MAX,
    uniqueItems: true,
    items: COMPANION_RECORD_ID_SCHEMA,
  },
  knownMachineActors: {
    type: 'array',
    maxItems: QQ_PRIVATE_ALLOWLIST_MAX * 2,
    items: QQ_EXTERNAL_ACTOR_SCHEMA,
  },
  groupDefaults: QQ_GROUP_SETTINGS_SCHEMA,
  groups: {
    type: 'array',
    maxItems: QQ_GROUP_ALLOWLIST_MAX * 2,
    items: closed({ ...groupProperties, settings: QQ_GROUP_SETTINGS_SCHEMA }),
  },
  voiceOutputEnabled: { type: 'boolean' },
  judge: QQ_JUDGE_POLICY_SCHEMA,
});
export const QQ_JUDGE_SETTINGS_SCHEMA: JsonSchema = closed({
  ...judgePolicyProperties,
  connection: closed({
    baseUrl: shortText,
    model: { type: 'string', maxLength: 128 },
    authMode: { enum: ['local-client-id', 'gateway-key'] },
  }),
});
export const QQ_SOURCE_SETTINGS_COMMAND_SCHEMA: JsonSchema = closed({
  protocol: { enum: ['official', 'onebot-v11'] },
  expectedRevision: integer(0),
  settings: QQ_SOURCE_SETTINGS_SCHEMA,
});
export const QQ_POLICY_COMMAND_SCHEMA: JsonSchema = closed({
  expectedRevision: integer(0),
  settings: QQ_POLICY_SETTINGS_SCHEMA,
});
export const QQ_JUDGE_SETTINGS_COMMAND_SCHEMA: JsonSchema = closed({
  expectedPolicyRevision: integer(0),
  expectedConfigRevision: integer(0),
  settings: QQ_JUDGE_SETTINGS_SCHEMA,
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
}
function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length >= (empty ? 0 : 1) && value.length <= max;
}
function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function ref(value: unknown): value is string {
  if (!text(value, 257)) return false;
  const parts = value.split('/');
  return (
    parts.length === 2 &&
    new RegExp(PLUGIN_ID_PATTERN).test(parts[0] ?? '') &&
    isCompanionRecordId(parts[1])
  );
}
function secret(value: unknown): boolean {
  if (value === null) return true;
  if (!text(value, 4096)) return false;
  const bytes = new TextEncoder().encode(value);
  return (
    bytes.byteLength <= 4096 &&
    new TextDecoder().decode(bytes) === value &&
    [...value].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
  );
}
/** Shape and pure connection syntax only; source projectors own actual endpoint/account capability policy. */
export function isQQSourceSettings(value: unknown): value is QQSourceSettings {
  const v = record(value);
  if (!v) return false;
  if (v['protocol'] === 'official')
    return (
      exact(v, ['protocol', 'appId', 'scenes']) &&
      text(v['appId'], 256, true) &&
      (v['appId'] === '' || isQQExternalId(v['appId'])) &&
      Array.isArray(v['scenes']) &&
      v['scenes'].length <= 2 &&
      new Set(v['scenes']).size === v['scenes'].length &&
      v['scenes'].every((scene) => scene === 'private' || scene === 'group')
    );
  const base = ['protocol', 'accountId', 'channelMode', 'mediaProfile', 'mode'];
  if (
    v['protocol'] !== 'onebot-v11' ||
    !(
      v['accountId'] === '' ||
      (typeof v['accountId'] === 'string' && /^[1-9][0-9]{0,19}$/.test(v['accountId']))
    ) ||
    v['channelMode'] !== 'universal' ||
    v['mediaProfile'] !== 'snowluma-v11'
  )
    return false;
  return (
    v['mode'] === 'reverse-ws' &&
    exact(v, [...base, 'listenHost', 'listenPort', 'path']) &&
    text(v['listenHost'], 255) &&
    /^[A-Za-z0-9.:[\]-]+$/.test(v['listenHost']) &&
    int(v['listenPort'], 0, 65535) &&
    text(v['path'], 128) &&
    v['path'].startsWith('/') &&
    !/[\s\\?#]/.test(v['path']) &&
    !v['path'].split('/').some((part) => part === '.' || part === '..')
  );
}
export function isQQGroupSettings(value: unknown): value is QQGroupSettings {
  const v = record(value),
    p = v && record(v['proactive']);
  return (
    !!v &&
    exact(v, ['contextMessages', 'contextMaxAgeMs', 'mentionEnabled', 'wakeWords', 'proactive']) &&
    int(v['contextMessages'], 0, QQ_GROUP_CONTEXT_MAX_MESSAGES) &&
    int(v['contextMaxAgeMs'], 1000, QQ_GROUP_CONTEXT_MAX_AGE_MS) &&
    typeof v['mentionEnabled'] === 'boolean' &&
    Array.isArray(v['wakeWords']) &&
    v['wakeWords'].length <= QQ_WAKE_WORDS_MAX &&
    new Set(v['wakeWords']).size === v['wakeWords'].length &&
    v['wakeWords'].every((word) => text(word, QQ_WAKE_WORD_MAX_UNITS) && word.trim().length > 0) &&
    !!p &&
    exact(p, ['enabled', 'mode', 'probability', 'cooldownMs', 'maxRepliesPerHour']) &&
    typeof p['enabled'] === 'boolean' &&
    ['rule-probability', 'model-assisted'].includes(String(p['mode'])) &&
    typeof p['probability'] === 'number' &&
    Number.isFinite(p['probability']) &&
    p['probability'] >= 0 &&
    p['probability'] <= 1 &&
    int(p['cooldownMs'], 1000, 24 * 60 * 60 * 1000) &&
    int(p['maxRepliesPerHour'], 1, QQ_PROACTIVE_MAX_REPLIES_HOUR)
  );
}
function isPrivateActor(
  value: unknown,
): value is Extract<QQExternalActor, { readonly scene: 'private' }> {
  return isQQExternalActor(value) && value.scene === 'private';
}
function isGroup(
  value: unknown,
): value is { readonly account: QQAccountRef; readonly groupId: string } {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['account', 'groupId']) &&
    isQQAccountRef(v['account']) &&
    isCompanionAudience({ kind: 'qq-group', ...v })
  );
}
function isAlias(value: unknown): value is QQPolicySettings['principalAliases'][number] {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['actor', 'principalId']) &&
    isQQExternalActor(v['actor']) &&
    isCompanionRecordId(v['principalId'])
  );
}
function isGroupOverride(value: unknown): value is QQPolicySettings['groups'][number] {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['account', 'groupId', 'settings']) &&
    isGroup({ account: v['account'], groupId: v['groupId'] }) &&
    isQQGroupSettings(v['settings'])
  );
}
const groupKey = (group: { readonly account: QQAccountRef; readonly groupId: string }): string =>
  companionAudienceKey({ kind: 'qq-group', ...group });
function perSource(accounts: readonly QQAccountRef[], max: number): boolean {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const key = JSON.stringify([account.protocol, account.sourcePluginId, account.instanceId]);
    const count = (counts.get(key) ?? 0) + 1;
    if (count > max) return false;
    counts.set(key, count);
  }
  return true;
}
export function isQQPolicySettings(value: unknown): value is QQPolicySettings {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'privateAllowlist',
      'groupAllowlist',
      'principalAliases',
      'administratorPrincipalIds',
      'knownMachineActors',
      'groupDefaults',
      'groups',
      'voiceOutputEnabled',
      'judge',
    ]) ||
    !Array.isArray(v['privateAllowlist']) ||
    v['privateAllowlist'].length > QQ_PRIVATE_ALLOWLIST_MAX * 2 ||
    !v['privateAllowlist'].every(isPrivateActor) ||
    !Array.isArray(v['groupAllowlist']) ||
    v['groupAllowlist'].length > QQ_GROUP_ALLOWLIST_MAX * 2 ||
    !v['groupAllowlist'].every(isGroup) ||
    !Array.isArray(v['principalAliases']) ||
    v['principalAliases'].length > QQ_PRINCIPAL_ALIASES_MAX ||
    !v['principalAliases'].every(isAlias) ||
    !Array.isArray(v['administratorPrincipalIds']) ||
    v['administratorPrincipalIds'].length > QQ_ADMINISTRATORS_MAX ||
    !v['administratorPrincipalIds'].every(isCompanionRecordId) ||
    !Array.isArray(v['knownMachineActors']) ||
    v['knownMachineActors'].length > QQ_PRIVATE_ALLOWLIST_MAX * 2 ||
    !v['knownMachineActors'].every(isQQExternalActor) ||
    !Array.isArray(v['groups']) ||
    v['groups'].length > QQ_GROUP_ALLOWLIST_MAX * 2 ||
    !v['groups'].every(isGroupOverride) ||
    !isQQGroupSettings(v['groupDefaults']) ||
    typeof v['voiceOutputEnabled'] !== 'boolean' ||
    !isQQJudgePolicy(v['judge'])
  )
    return false;
  const privateKeys = v['privateAllowlist'].map(qqActorKey),
    groupKeys = v['groupAllowlist'].map(groupKey);
  return (
    new Set(privateKeys).size === privateKeys.length &&
    new Set(groupKeys).size === groupKeys.length &&
    new Set(v['principalAliases'].map((alias) => qqActorKey(alias.actor))).size ===
      v['principalAliases'].length &&
    new Set(v['knownMachineActors'].map(qqActorKey)).size === v['knownMachineActors'].length &&
    new Set(v['administratorPrincipalIds']).size === v['administratorPrincipalIds'].length &&
    new Set(v['groups'].map(groupKey)).size === v['groups'].length &&
    v['groups'].every((group) => groupKeys.includes(groupKey(group))) &&
    perSource(
      v['privateAllowlist'].map((actor) => actor.account),
      QQ_PRIVATE_ALLOWLIST_MAX,
    ) &&
    perSource(
      v['groupAllowlist'].map((group) => group.account),
      QQ_GROUP_ALLOWLIST_MAX,
    ) &&
    encodedBytes(value) <= QQ_SETTINGS_MAX_BYTES
  );
}
function judgePolicyFields(v: Record<string, unknown>): boolean {
  return (
    ref(v['providerRef']) &&
    int(v['maxAttemptsPerHour'], 1, QQ_JUDGE_MAX_ATTEMPTS_HOUR) &&
    int(v['perGroupIntervalMs'], QQ_JUDGE_MIN_GROUP_INTERVAL_MS, 60 * 60 * 1000) &&
    int(v['timeoutMs'], 1000, QQ_JUDGE_TIMEOUT_MS) &&
    int(v['maxOutputTokens'], 1, QQ_JUDGE_MAX_OUTPUT_TOKENS)
  );
}
export function isQQJudgePolicy(value: unknown): value is QQJudgePolicy {
  const v = record(value);
  return (
    !!v &&
    exact(v, [
      'providerRef',
      'maxAttemptsPerHour',
      'perGroupIntervalMs',
      'timeoutMs',
      'maxOutputTokens',
    ]) &&
    judgePolicyFields(v)
  );
}
export function isQQJudgeSettings(value: unknown): value is QQJudgeSettings {
  const v = record(value),
    c = v && record(v['connection']);
  return (
    !!v &&
    exact(v, [
      'providerRef',
      'connection',
      'maxAttemptsPerHour',
      'perGroupIntervalMs',
      'timeoutMs',
      'maxOutputTokens',
    ]) &&
    ref(v['providerRef']) &&
    !!c &&
    exact(c, ['baseUrl', 'model', 'authMode']) &&
    text(c['baseUrl'], 2048, true) &&
    text(c['model'], 128, true) &&
    ['local-client-id', 'gateway-key'].includes(String(c['authMode'])) &&
    judgePolicyFields(v)
  );
}
export function isQQSourceSettingsCommand(value: unknown): value is QQSourceSettingsCommand {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['protocol', 'expectedRevision', 'settings']) &&
    int(v['expectedRevision']) &&
    isQQSourceSettings(v['settings']) &&
    v['protocol'] === v['settings'].protocol
  );
}
export function isQQPolicyCommand(value: unknown): value is QQPolicyCommand {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['expectedRevision', 'settings']) &&
    int(v['expectedRevision']) &&
    isQQPolicySettings(v['settings'])
  );
}
export function isQQJudgeSettingsCommand(value: unknown): value is QQJudgeSettingsCommand {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['expectedPolicyRevision', 'expectedConfigRevision', 'settings']) &&
    int(v['expectedPolicyRevision']) &&
    int(v['expectedConfigRevision']) &&
    isQQJudgeSettings(v['settings'])
  );
}
export function isQQCredentialCommand(value: unknown): value is QQCredentialCommand {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['protocol', 'expectedRevision', 'expectedCredentialVersion', 'value']) &&
    ['official', 'onebot-v11'].includes(String(v['protocol'])) &&
    int(v['expectedRevision']) &&
    text(v['expectedCredentialVersion'], 128) &&
    secret(v['value'])
  );
}
export function isQQJudgeCredentialCommand(value: unknown): value is QQJudgeCredentialCommand {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['providerRef', 'expectedConfigRevision', 'expectedCredentialVersion', 'value']) &&
    ref(v['providerRef']) &&
    int(v['expectedConfigRevision']) &&
    text(v['expectedCredentialVersion'], 128) &&
    secret(v['value'])
  );
}
export function defaultQQGroupSettings(): QQGroupSettings {
  return {
    contextMessages: QQ_GROUP_CONTEXT_MAX_MESSAGES,
    contextMaxAgeMs: QQ_GROUP_CONTEXT_MAX_AGE_MS,
    mentionEnabled: true,
    wakeWords: [],
    proactive: {
      enabled: false,
      mode: 'rule-probability',
      probability: 0.1,
      cooldownMs: QQ_PROACTIVE_DEFAULT_COOLDOWN_MS,
      maxRepliesPerHour: QQ_PROACTIVE_DEFAULT_REPLIES_HOUR,
    },
  };
}
export function defaultQQJudgePolicy(): QQJudgePolicy {
  return {
    providerRef: QQ_JUDGE_PROVIDER_REF,
    maxAttemptsPerHour: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
    perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
    timeoutMs: QQ_JUDGE_TIMEOUT_MS,
    maxOutputTokens: QQ_JUDGE_MAX_OUTPUT_TOKENS,
  };
}
export function defaultQQPolicySettings(): QQPolicySettings {
  return {
    privateAllowlist: [],
    groupAllowlist: [],
    principalAliases: [],
    administratorPrincipalIds: [],
    knownMachineActors: [],
    groupDefaults: defaultQQGroupSettings(),
    groups: [],
    voiceOutputEnabled: false,
    judge: defaultQQJudgePolicy(),
  };
}

export const QQ_CREDENTIAL_COMMAND_SCHEMA: JsonSchema = closed({
  protocol: { enum: ['official', 'onebot-v11'] },
  expectedRevision: integer(0),
  expectedCredentialVersion: { type: 'string', minLength: 1, maxLength: 128 },
  value: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 4096 }] },
});
export const QQ_REMOTE_RECEIPT_SCHEMA: JsonSchema = closed({
  messageId: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 256 }] },
  fileId: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 256 }] },
  transferId: { anyOf: [{ type: 'null' }, COMPANION_RECORD_ID_SCHEMA] },
  sequence: { anyOf: [{ type: 'null' }, integer(0)] },
  sequenceAuthoritative: { anyOf: [{ type: 'null' }, { type: 'boolean' }] },
});
export const QQ_DELIVERY_ATTEMPT_SCHEMA: JsonSchema = closed({
  id: COMPANION_RECORD_ID_SCHEMA,
  operation: { enum: ['upload', 'send', 'upload-and-send'] },
  phase: { enum: ['claimed', 'dispatched', 'settled'] },
  outcome: {
    enum: ['pending', 'accepted', 'rejected', 'failed', 'unknown', 'cancelled-before-dispatch'],
  },
  correlationId: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 256 }] },
  receipt: { anyOf: [{ type: 'null' }, QQ_REMOTE_RECEIPT_SCHEMA] },
  cleanup: { enum: ['pending', 'settled', 'failed', 'unknown'] },
  startedAt: integer(0),
  settledAt: { anyOf: [{ type: 'null' }, integer(0)] },
  error: { anyOf: [{ type: 'null' }, KERNEL_ERROR_SCHEMA] },
});
export const QQ_DELIVERY_PART_SCHEMA: JsonSchema = closed({
  id: COMPANION_RECORD_ID_SCHEMA,
  index: integer(0, QQ_DELIVERY_MAX_PARTS - 1),
  requirement: { enum: ['mandatory-text', 'required-media', 'optional-voice'] },
  preparation: { enum: ['pending', 'ready', 'unavailable', 'failed', 'cancelled'] },
  error: { anyOf: [{ type: 'null' }, KERNEL_ERROR_SCHEMA] },
  msgSeq: { anyOf: [{ type: 'null' }, integer(1)] },
  upload: { anyOf: [{ type: 'null' }, QQ_DELIVERY_ATTEMPT_SCHEMA] },
  send: { anyOf: [{ type: 'null' }, QQ_DELIVERY_ATTEMPT_SCHEMA] },
  content: {
    oneOf: [
      closed({
        kind: { const: 'inline-text' },
        text: { type: 'string', minLength: 1, maxLength: QQ_INLINE_TEXT_MAX_UNITS },
        sha256: SHA256_HEX_SCHEMA,
      }),
      closed({ kind: { const: 'material' }, material: COMPANION_MATERIAL_REF_SCHEMA }),
      closed({
        kind: { const: 'voice' },
        messageIds: {
          type: 'array',
          minItems: 1,
          maxItems: QQ_DELIVERY_MAX_MESSAGES,
          uniqueItems: true,
          items: COMPANION_RECORD_ID_SCHEMA,
        },
        material: { anyOf: [{ type: 'null' }, COMPANION_MATERIAL_REF_SCHEMA] },
      }),
    ],
  },
});
const qqInputProperties = {
  actor: QQ_EXTERNAL_ACTOR_SCHEMA,
  route: QQ_REPLY_ROUTE_SCHEMA,
  text: { type: 'string', maxLength: COMPANION_MAX_TEXT },
  materialIds: {
    type: 'array',
    maxItems: COMPANION_MATERIAL_MAX_PARTS,
    uniqueItems: true,
    items: COMPANION_RECORD_ID_SCHEMA,
  },
  quote: { anyOf: [QQ_QUOTE_EVIDENCE_SCHEMA, { type: 'null' }] },
  observedAt: integer(0),
};
export const QQ_INPUT_CONTENT_SCHEMA: JsonSchema = {
  oneOf: [
    closed({
      ...qqInputProperties,
      eventKey: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 256 }] },
      trigger: { const: 'observation' },
    }),
    closed({
      ...qqInputProperties,
      eventKey: { type: 'string', minLength: 1, maxLength: 256 },
      trigger: { enum: ['direct', 'mention', 'wake-word'] },
    }),
  ],
};
function error(value: unknown): boolean {
  const v = record(value);
  return (
    value === null ||
    (!!v &&
      exact(v, ['code', 'messageKey', 'retryable']) &&
      isKernelErrorCode(v['code']) &&
      v['messageKey'] === `errors.${v['code']}` &&
      typeof v['retryable'] === 'boolean')
  );
}
function cleanup(value: unknown): boolean {
  return ['pending', 'settled', 'failed', 'unknown'].includes(String(value));
}
function hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function ids(value: unknown, max: number, min = 0): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every(isCompanionRecordId) &&
    new Set(value).size === value.length
  );
}
function utf8(value: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}
function credential(value: unknown): value is QQCredentialView {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['available', 'writable', 'version', 'source']) &&
    typeof v['available'] === 'boolean' &&
    typeof v['writable'] === 'boolean' &&
    text(v['version'], 128) &&
    ['none', 'memory', 'managed', 'local-client-id'].includes(String(v['source'])) &&
    (v['source'] !== 'none' || v['available'] === false)
  );
}
export function isQQSourceView(value: unknown): value is QQSourceView {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'protocol',
      'sourcePluginId',
      'instanceId',
      'desiredEnabled',
      'source',
      'configRevision',
      'appliedRevision',
      'settings',
      'account',
      'bindingId',
      'phase',
      'credential',
      'installedVersion',
      'media',
      'cleanup',
      'error',
    ]) ||
    !['official', 'onebot-v11'].includes(String(v['protocol'])) ||
    typeof v['sourcePluginId'] !== 'string' ||
    !new RegExp(PLUGIN_ID_PATTERN).test(v['sourcePluginId']) ||
    v['instanceId'] !== 'default' ||
    typeof v['desiredEnabled'] !== 'boolean' ||
    !['ready', 'disabled', 'unavailable'].includes(String(v['source'])) ||
    !int(v['configRevision']) ||
    !(v['appliedRevision'] === null || int(v['appliedRevision'])) ||
    !isQQSourceSettings(v['settings']) ||
    v['protocol'] !== v['settings'].protocol ||
    !(v['account'] === null || isQQAccountRef(v['account'])) ||
    !(v['bindingId'] === null || isCompanionRecordId(v['bindingId'])) ||
    ![
      'disabled',
      'unconfigured',
      'connecting',
      'authenticating',
      'ready',
      'offline',
      'retiring',
      'failed',
    ].includes(String(v['phase'])) ||
    !credential(v['credential']) ||
    !(v['installedVersion'] === null || text(v['installedVersion'], 256)) ||
    !cleanup(v['cleanup']) ||
    !error(v['error'])
  )
    return false;
  const media = record(v['media']);
  if (
    !media ||
    !exact(media, ['text', 'image', 'voice', 'file']) ||
    !Object.values(media).every((item) =>
      ['unverified', 'available', 'unavailable'].includes(String(item)),
    )
  )
    return false;
  if (
    v['account'] &&
    (v['account'].protocol !== v['protocol'] || v['account'].sourcePluginId !== v['sourcePluginId'])
  )
    return false;
  return (
    v['phase'] !== 'ready' ||
    (v['source'] === 'ready' &&
      v['account'] !== null &&
      v['bindingId'] !== null &&
      v['appliedRevision'] === v['configRevision'])
  );
}
export function isQQJudgeView(value: unknown): value is QQJudgeView {
  const v = record(value);
  return (
    !!v &&
    exact(v, [
      'sourcePluginId',
      'configRevision',
      'appliedRevision',
      'settings',
      'bindingId',
      'credential',
      'readiness',
      'active',
      'admittedAttempts',
      'inputTokens',
      'outputTokens',
      'error',
    ]) &&
    typeof v['sourcePluginId'] === 'string' &&
    new RegExp(PLUGIN_ID_PATTERN).test(v['sourcePluginId']) &&
    int(v['configRevision']) &&
    (v['appliedRevision'] === null || int(v['appliedRevision'])) &&
    isQQJudgeSettings(v['settings']) &&
    v['settings'].providerRef.split('/')[0] === v['sourcePluginId'] &&
    (v['bindingId'] === null || isCompanionRecordId(v['bindingId'])) &&
    credential(v['credential']) &&
    ['unconfigured', 'configured', 'unavailable'].includes(String(v['readiness'])) &&
    (v['readiness'] !== 'configured' || v['bindingId'] !== null) &&
    int(v['active'], 0, QQ_JUDGE_MAX_CONCURRENT) &&
    int(v['admittedAttempts']) &&
    (v['inputTokens'] === null || int(v['inputTokens'])) &&
    (v['outputTokens'] === null || int(v['outputTokens'])) &&
    error(v['error'])
  );
}
export function isQQView(value: unknown): value is QQView {
  const v = record(value),
    policy = v && record(v['policy']),
    codec = v && record(v['codec']);
  return (
    !!v &&
    exact(v, ['version', 'policy', 'sources', 'judge', 'codec']) &&
    v['version'] === 1 &&
    !!policy &&
    exact(policy, ['revision', 'settings']) &&
    int(policy['revision']) &&
    isQQPolicySettings(policy['settings']) &&
    Array.isArray(v['sources']) &&
    v['sources'].length <= 2 &&
    v['sources'].every(isQQSourceView) &&
    new Set(v['sources'].map((source) => source.protocol)).size === v['sources'].length &&
    isQQJudgeView(v['judge']) &&
    !!codec &&
    exact(codec, ['source', 'imageId', 'manifestSha256', 'cleanup', 'error']) &&
    ['ready', 'disabled', 'unavailable'].includes(String(codec['source'])) &&
    (codec['imageId'] === null ||
      (typeof codec['imageId'] === 'string' && /^sha256:[a-f0-9]{64}$/.test(codec['imageId']))) &&
    (codec['manifestSha256'] === null || hex(codec['manifestSha256'])) &&
    (codec['source'] !== 'ready' ||
      (codec['imageId'] !== null && codec['manifestSha256'] !== null)) &&
    cleanup(codec['cleanup']) &&
    error(codec['error']) &&
    encodedBytes(value) <= QQ_VIEW_MAX_BYTES
  );
}
export function isQQStatus(value: unknown): value is QQStatus {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['version', 'sources']) &&
    v['version'] === 1 &&
    Array.isArray(v['sources']) &&
    v['sources'].length <= 2 &&
    v['sources'].every((source) => {
      const s = record(source);
      return (
        !!s &&
        exact(s, [
          'protocol',
          'sourcePluginId',
          'desiredEnabled',
          'source',
          'phase',
          'account',
          'cleanup',
          'error',
        ]) &&
        ['official', 'onebot-v11'].includes(String(s['protocol'])) &&
        typeof s['sourcePluginId'] === 'string' &&
        new RegExp(PLUGIN_ID_PATTERN).test(s['sourcePluginId']) &&
        typeof s['desiredEnabled'] === 'boolean' &&
        ['ready', 'disabled', 'unavailable'].includes(String(s['source'])) &&
        [
          'disabled',
          'unconfigured',
          'connecting',
          'authenticating',
          'ready',
          'offline',
          'retiring',
          'failed',
        ].includes(String(s['phase'])) &&
        (s['account'] === null || isQQAccountRef(s['account'])) &&
        (s['phase'] !== 'ready' || (s['account'] !== null && s['source'] === 'ready')) &&
        cleanup(s['cleanup']) &&
        error(s['error'])
      );
    }) &&
    new Set(v['sources'].map((source) => source.protocol)).size === v['sources'].length &&
    encodedBytes(value) <= QQ_STATUS_MAX_BYTES
  );
}
export function isQQInputContent(value: unknown): value is QQInputContent {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'eventKey',
      'actor',
      'route',
      'text',
      'materialIds',
      'trigger',
      'quote',
      'observedAt',
    ]) ||
    !(v['eventKey'] === null || isQQExternalId(v['eventKey'])) ||
    !(v['quote'] === null || isQQQuoteEvidence(v['quote'])) ||
    !isQQExternalActor(v['actor']) ||
    !isQQReplyRoute(v['route']) ||
    !text(v['text'], COMPANION_MAX_TEXT, true) ||
    !utf8(v['text']) ||
    !ids(v['materialIds'], COMPANION_MATERIAL_MAX_PARTS) ||
    (v['text'].length === 0 && v['materialIds'].length === 0) ||
    !['direct', 'mention', 'wake-word', 'observation'].includes(String(v['trigger'])) ||
    !int(v['observedAt'])
  )
    return false;
  const actor = v['actor'],
    route = v['route'];
  if (
    v['trigger'] !== 'observation' &&
    (v['eventKey'] === null || !hasQQNativeReplyBasis(route.reference))
  )
    return false;
  return (
    qqActorKey(actor) ===
    qqActorKey(
      route.scene === 'private'
        ? { account: route.account, scene: 'private', senderId: route.targetId }
        : {
            account: route.account,
            scene: 'group',
            groupId: route.targetId,
            senderId: actor.senderId,
          },
    )
  );
}
export function isQQInputReceipt(value: unknown): value is QQInputReceipt {
  const v = record(value);
  if (
    !v ||
    !exact(v, ['eventKey', 'state', 'inputId', 'messageId', 'error']) ||
    !(v['eventKey'] === null || isQQExternalId(v['eventKey'])) ||
    !error(v['error'])
  )
    return false;
  if (
    !(v['inputId'] === null || isCompanionRecordId(v['inputId'])) ||
    !(v['messageId'] === null || isCompanionRecordId(v['messageId'])) ||
    (v['messageId'] !== null && v['messageId'] !== v['inputId'])
  )
    return false;
  if (v['state'] === 'observed') return v['inputId'] === null && v['messageId'] === null;
  if (v['inputId'] === null) return v['state'] === 'rejected';
  if (!isQQExternalId(v['eventKey'])) return false;
  // Retained admission identity is a fact: duplicates may still prepare, and rejection may follow commit.
  if (v['state'] === 'rejected' || v['state'] === 'duplicate') return true;
  return v['state'] === 'preparing'
    ? v['messageId'] === null
    : v['state'] === 'accepted' && v['messageId'] !== null;
}
export function isQQDeliveryAttempt(value: unknown): value is QQDeliveryAttempt {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'id',
      'operation',
      'phase',
      'outcome',
      'correlationId',
      'receipt',
      'cleanup',
      'startedAt',
      'settledAt',
      'error',
    ]) ||
    !isCompanionRecordId(v['id']) ||
    !['upload', 'send', 'upload-and-send'].includes(String(v['operation'])) ||
    !['claimed', 'dispatched', 'settled'].includes(String(v['phase'])) ||
    !['pending', 'accepted', 'rejected', 'failed', 'unknown', 'cancelled-before-dispatch'].includes(
      String(v['outcome']),
    ) ||
    !(v['correlationId'] === null || isQQExternalId(v['correlationId'])) ||
    !cleanup(v['cleanup']) ||
    !int(v['startedAt']) ||
    !(v['settledAt'] === null || int(v['settledAt'])) ||
    !error(v['error'])
  )
    return false;
  if (
    v['phase'] === 'settled'
      ? v['outcome'] === 'pending' || v['settledAt'] === null
      : v['outcome'] !== 'pending' || v['settledAt'] !== null
  )
    return false;
  const receipt = record(v['receipt']);
  if (
    v['receipt'] !== null &&
    (!receipt ||
      !exact(receipt, ['messageId', 'fileId', 'transferId', 'sequence', 'sequenceAuthoritative']) ||
      !(receipt['messageId'] === null || isQQExternalId(receipt['messageId'])) ||
      !(receipt['fileId'] === null || isQQExternalId(receipt['fileId'])) ||
      !(receipt['transferId'] === null || isCompanionRecordId(receipt['transferId'])) ||
      !(receipt['sequence'] === null || int(receipt['sequence'])) ||
      !(
        receipt['sequenceAuthoritative'] === null ||
        typeof receipt['sequenceAuthoritative'] === 'boolean'
      ))
  )
    return false;
  if (v['outcome'] === 'cancelled-before-dispatch') return v['receipt'] === null;
  if (v['outcome'] !== 'accepted') return true;
  return (
    !!receipt &&
    (v['operation'] === 'send'
      ? receipt['messageId'] !== null
      : receipt['fileId'] !== null ||
        (v['operation'] === 'upload' && receipt['transferId'] !== null))
  );
}
function accepted(part: QQDeliveryPart): boolean {
  if (
    part.send?.operation === 'send' &&
    part.send.outcome === 'accepted' &&
    part.send.receipt?.messageId != null
  )
    return true;
  const filePublication =
    part.content.kind === 'material' && ['file', 'text'].includes(part.content.material.kind);
  return (
    filePublication &&
    part.upload?.operation === 'upload-and-send' &&
    part.upload.outcome === 'accepted' &&
    part.upload.receipt?.fileId != null
  );
}
export function isQQDeliveryPartAccepted(value: unknown): boolean {
  return isQQDeliveryPart(value) && accepted(value);
}
export function isQQDeliveryPart(value: unknown): value is QQDeliveryPart {
  const v = record(value),
    c = v && record(v['content']);
  if (
    !v ||
    !exact(v, [
      'id',
      'index',
      'requirement',
      'content',
      'preparation',
      'error',
      'msgSeq',
      'upload',
      'send',
    ]) ||
    !isCompanionRecordId(v['id']) ||
    !int(v['index'], 0, QQ_DELIVERY_MAX_PARTS - 1) ||
    !['mandatory-text', 'required-media', 'optional-voice'].includes(String(v['requirement'])) ||
    !['pending', 'ready', 'unavailable', 'failed', 'cancelled'].includes(
      String(v['preparation']),
    ) ||
    !error(v['error']) ||
    !(v['msgSeq'] === null || int(v['msgSeq'], 1)) ||
    !(v['upload'] === null || isQQDeliveryAttempt(v['upload'])) ||
    !(v['send'] === null || isQQDeliveryAttempt(v['send'])) ||
    !c
  )
    return false;
  if (v['preparation'] !== 'ready' && (v['upload'] !== null || v['send'] !== null)) return false;
  if (v['send'] && v['send'].operation !== 'send') return false;
  if (v['upload'] && !['upload', 'upload-and-send'].includes(v['upload'].operation)) return false;
  if (
    v['upload']?.operation === 'upload-and-send' &&
    (v['send'] !== null ||
      c['kind'] !== 'material' ||
      !isCompanionMaterialRef(c['material']) ||
      !['file', 'text'].includes(c['material'].kind))
  )
    return false;
  if (c['kind'] === 'inline-text' && v['upload'] !== null) return false;
  if (v['content'] && c['kind'] === 'inline-text')
    return (
      exact(c, ['kind', 'text', 'sha256']) &&
      text(c['text'], QQ_INLINE_TEXT_MAX_UNITS) &&
      utf8(c['text']) &&
      hex(c['sha256']) &&
      v['requirement'] === 'mandatory-text' &&
      v['preparation'] === 'ready'
    );
  if (c['kind'] === 'voice')
    return (
      exact(c, ['kind', 'messageIds', 'material']) &&
      ids(c['messageIds'], QQ_DELIVERY_MAX_MESSAGES, 1) &&
      v['requirement'] === 'optional-voice' &&
      (v['preparation'] === 'ready'
        ? isCompanionMaterialRef(c['material']) &&
          c['material'].kind === 'voice' &&
          c['material'].mediaType === 'audio/silk'
        : c['material'] === null)
    );
  return (
    c['kind'] === 'material' &&
    exact(c, ['kind', 'material']) &&
    isCompanionMaterialRef(c['material']) &&
    v['preparation'] === 'ready' &&
    (v['requirement'] === 'mandatory-text'
      ? c['material'].kind === 'text'
      : v['requirement'] === 'required-media' &&
        ['image', 'file', 'text'].includes(c['material'].kind))
  );
}
export function isQQPrincipalPage(value: unknown): value is QQPrincipalPage {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['principals', 'next']) &&
    (v['next'] === null || isCompanionRecordId(v['next'])) &&
    Array.isArray(v['principals']) &&
    v['principals'].length <= QQ_PAGE_MAX_ITEMS &&
    v['principals'].every(isCompanionPrincipal) &&
    new Set(v['principals'].map((principal) => principal.id)).size === v['principals'].length &&
    encodedBytes(value) <= QQ_VIEW_MAX_BYTES
  );
}
function deliverySummary(value: unknown): value is QQDeliveryPage['deliveries'][number] {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'id',
      'messageIds',
      'audience',
      'route',
      'phase',
      'outcome',
      'createdAt',
      'updatedAt',
    ]) ||
    !isCompanionRecordId(v['id']) ||
    !ids(v['messageIds'], QQ_DELIVERY_MAX_MESSAGES, 1) ||
    !isCompanionAudience(v['audience']) ||
    v['audience'].kind === 'public' ||
    !isQQReplyRoute(v['route']) ||
    !['prepared', 'sending', 'blocked', 'terminal'].includes(String(v['phase'])) ||
    !['pending', 'accepted', 'partial', 'failed', 'cancelled', 'unknown'].includes(
      String(v['outcome']),
    ) ||
    !int(v['createdAt']) ||
    !int(v['updatedAt'])
  )
    return false;
  return v['route'].scene === 'private'
    ? v['audience'].kind !== 'qq-group'
    : v['audience'].kind === 'qq-group' &&
        sameQQAccount(v['audience'].account, v['route'].account) &&
        v['audience'].groupId === v['route'].targetId;
}
export function isQQDeliveryPage(value: unknown): value is QQDeliveryPage {
  const v = record(value);
  return (
    !!v &&
    exact(v, ['deliveries', 'next']) &&
    (v['next'] === null || isCompanionRecordId(v['next'])) &&
    Array.isArray(v['deliveries']) &&
    v['deliveries'].length <= QQ_PAGE_MAX_ITEMS &&
    v['deliveries'].every(deliverySummary) &&
    new Set(v['deliveries'].map((delivery) => delivery.id)).size === v['deliveries'].length &&
    encodedBytes(value) <= QQ_VIEW_MAX_BYTES
  );
}
export function isQQDeliveryView(value: unknown): value is QQDeliveryView {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'id',
      'messageIds',
      'origins',
      'audience',
      'route',
      'textRepresentation',
      'mode',
      'eligibilityExpiresAt',
      'allowedMessageParts',
      'phase',
      'outcome',
      'parts',
      'createdAt',
      'updatedAt',
      'error',
    ]) ||
    !isCompanionRecordId(v['id']) ||
    !ids(v['messageIds'], QQ_DELIVERY_MAX_MESSAGES, 1) ||
    !isCompanionOrigins(v['origins']) ||
    !isCompanionAudience(v['audience']) ||
    v['audience'].kind === 'public' ||
    !isQQReplyRoute(v['route']) ||
    !['inline', 'text-document'].includes(String(v['textRepresentation'])) ||
    !['official-passive', 'official-proactive', 'onebot'].includes(String(v['mode'])) ||
    !(v['eligibilityExpiresAt'] === null || int(v['eligibilityExpiresAt'])) ||
    !int(v['allowedMessageParts'], 0, QQ_DELIVERY_MAX_PARTS) ||
    !['prepared', 'sending', 'blocked', 'terminal'].includes(String(v['phase'])) ||
    !['pending', 'accepted', 'partial', 'failed', 'cancelled', 'unknown'].includes(
      String(v['outcome']),
    ) ||
    !Array.isArray(v['parts']) ||
    v['parts'].length < 1 ||
    v['parts'].length > QQ_DELIVERY_MAX_PARTS ||
    !v['parts'].every(isQQDeliveryPart) ||
    !int(v['createdAt']) ||
    !int(v['updatedAt']) ||
    !error(v['error'])
  )
    return false;
  if (
    v['allowedMessageParts'] === 0 &&
    (v['phase'] !== 'blocked' ||
      v['outcome'] === 'pending' ||
      v['error'] === null ||
      v['parts'].some((part) => part.upload !== null || part.send !== null))
  )
    return false;
  const audience = v['audience'],
    route = v['route'],
    messageIds = v['messageIds'];
  if (
    !v['origins'].every(
      (origin) =>
        companionAudienceKey(origin.audience) === companionAudienceKey(audience) &&
        sameCompanionReplyRoute(origin.route, route),
    ) ||
    !v['parts'].every((part, index) => part.index === index) ||
    new Set(v['parts'].map((part) => part.id)).size !== v['parts'].length
  )
    return false;
  if (
    v['parts'].some(
      (part) =>
        (part.content.kind === 'material' &&
          companionAudienceKey(part.content.material.audience) !==
            companionAudienceKey(audience)) ||
        (part.content.kind === 'voice' &&
          (part.content.messageIds.some((id) => !messageIds.includes(id)) ||
            (part.content.material !== null &&
              companionAudienceKey(part.content.material.audience) !==
                companionAudienceKey(audience)))),
    )
  )
    return false;
  const mandatory = v['parts'].filter((part) => part.requirement === 'mandatory-text');
  if (
    !mandatory.length ||
    mandatory.length > QQ_INLINE_TEXT_MAX_PARTS ||
    v['parts'].slice(0, mandatory.length).some((part) => part.requirement !== 'mandatory-text')
  )
    return false;
  if (
    v['textRepresentation'] === 'inline'
      ? mandatory.some((part) => part.content.kind !== 'inline-text')
      : mandatory.length !== 2 ||
        mandatory[0]?.content.kind !== 'inline-text' ||
        mandatory[1]?.content.kind !== 'material' ||
        mandatory[1].content.material.kind !== 'text'
  )
    return false;
  const allTextAccepted = mandatory.every(accepted);
  if (
    !allTextAccepted &&
    v['parts'].some(
      (part) =>
        part.requirement !== 'mandatory-text' &&
        (part.upload !== null ||
          part.send !== null ||
          (part.content.kind === 'voice' && part.content.material !== null)),
    )
  )
    return false;
  return (
    (v['outcome'] !== 'accepted' || v['parts'].every(accepted)) &&
    encodedBytes(value) <= QQ_VIEW_MAX_BYTES
  );
}

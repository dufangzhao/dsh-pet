import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect, expectTypeOf, it } from 'vitest';
import { makeError } from './errors.js';
import type {
  CompanionMessageCommand,
  CompanionTaskCommand,
  CompanionCommandReceipt,
} from './companion.js';
import type { CompanionInputOrigin, QQAccountRef } from './companion-origin.js';
import type { CompanionMaterialRef } from './companion-material.js';
import {
  QQ_POLICY_SETTINGS_SCHEMA,
  QQ_SOURCE_SETTINGS_SCHEMA,
  QQ_JUDGE_SETTINGS_COMMAND_SCHEMA,
  QQ_DELIVERY_PART_SCHEMA,
  QQ_REPLY_TEXT_SEPARATOR,
  QQ_JUDGE_PLUGIN_ID,
  QQ_JUDGE_PROVIDER_REF,
  QQ_JUDGE_CREDENTIAL_ID,
  QQ_PRIVATE_ALLOWLIST_MAX,
  defaultQQPolicySettings,
  isQQPolicySettings,
  isQQSourceSettings,
  isQQSourceSettingsCommand,
  isQQJudgeSettingsCommand,
  isQQJudgeCredentialCommand,
  isQQInputContent,
  isQQInputReceipt,
  isQQView,
  isQQDeliveryAttempt,
  isQQDeliveryPart,
  isQQDeliveryPartAccepted,
  isQQDeliveryView,
  isQQDeliveryPage,
  isQQPrincipalPage,
  QQ_PAGE_MAX_ITEMS,
  QQ_VIEW_MAX_BYTES,
  type QQView,
  type QQDeliveryAttempt,
  type QQDeliveryPart,
  type QQDeliveryView,
} from './companion-qq.js';
const account: QQAccountRef = {
  protocol: 'onebot-v11',
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default',
  accountId: '12345',
};
const route = {
  kind: 'qq' as const,
  account,
  scene: 'private' as const,
  targetId: '67890',
  reference: { eventId: null, messageId: '-123', occurredAt: 1, displayReference: null },
};
const origin: CompanionInputOrigin = {
  kind: 'qq',
  inputId: 'input-1',
  principalId: 'person-1',
  audience: { kind: 'person-private', principalId: 'person-1' },
  route,
  actor: { account, scene: 'private', senderId: '67890' },
  eventKey: 'event-1',
  messageId: '-123',
  trigger: 'direct',
  quote: null,
  policyRevision: 1,
};
const material: CompanionMaterialRef = {
  id: 'material-1',
  kind: 'voice',
  name: 'reply.silk',
  mediaType: 'audio/silk',
  sizeBytes: 100,
  sha256: 'a'.repeat(64),
  durationMs: 400,
  audience: origin.audience,
  originInputIds: ['input-1'],
};
const send: QQDeliveryAttempt = {
  id: 'send-1',
  operation: 'send',
  phase: 'settled',
  outcome: 'accepted',
  correlationId: 'echo-1',
  receipt: {
    messageId: '-456',
    fileId: null,
    transferId: null,
    sequence: null,
    sequenceAuthoritative: null,
  },
  cleanup: 'settled',
  startedAt: 1,
  settledAt: 2,
  error: null,
};
const textPart: QQDeliveryPart = {
  id: 'text-part',
  index: 0,
  requirement: 'mandatory-text',
  content: { kind: 'inline-text', text: 'Required text.', sha256: 'b'.repeat(64) },
  preparation: 'ready',
  error: null,
  msgSeq: null,
  upload: null,
  send: null,
};
const voicePart: QQDeliveryPart = {
  id: 'voice-part',
  index: 1,
  requirement: 'optional-voice',
  content: { kind: 'voice', messageIds: ['output-1'], material: null },
  preparation: 'pending',
  error: null,
  msgSeq: null,
  upload: null,
  send: null,
};
function delivery(parts: readonly QQDeliveryPart[]): QQDeliveryView {
  return {
    id: 'delivery-1',
    messageIds: ['output-1'],
    origins: [origin],
    audience: origin.audience,
    route,
    textRepresentation: 'inline',
    mode: 'onebot',
    eligibilityExpiresAt: null,
    allowedMessageParts: 5,
    phase: 'prepared',
    outcome: 'pending',
    parts,
    createdAt: 1,
    updatedAt: 1,
    error: null,
  };
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
const policySchema = ajv.compile(QQ_POLICY_SETTINGS_SCHEMA),
  sourceSchema = ajv.compile(QQ_SOURCE_SETTINGS_SCHEMA),
  judgeCommandSchema = ajv.compile(QQ_JUDGE_SETTINGS_COMMAND_SCHEMA),
  partSchema = ajv.compile(QQ_DELIVERY_PART_SCHEMA);

it('defaults to no admitted actors/groups, no proactive calls and additive voice off', () => {
  const policy = defaultQQPolicySettings();
  expect(policySchema(policy)).toBe(true);
  expect(isQQPolicySettings(policy)).toBe(true);
  expect(policy.privateAllowlist).toEqual([]);
  expect(policy.groupAllowlist).toEqual([]);
  expect(policy.voiceOutputEnabled).toBe(false);
  expect(policy.groupDefaults.proactive.enabled).toBe(false);
  expect(policy.judge.providerRef).toBe(QQ_JUDGE_PROVIDER_REF);
  expect(QQ_JUDGE_PROVIDER_REF.startsWith(QQ_JUDGE_PLUGIN_ID)).toBe(true);
  expect(QQ_JUDGE_CREDENTIAL_ID).toBe('model-api-key');
});
it('does not turn whitelisting or group rank into administration and applies per-source list bounds', () => {
  const policy = defaultQQPolicySettings();
  const privateActor = { account, scene: 'private' as const, senderId: '67890' };
  expect(isQQPolicySettings({ ...policy, privateAllowlist: [privateActor] })).toBe(true);
  expect(isQQPolicySettings({ ...policy, privateAllowlist: [privateActor, privateActor] })).toBe(
    false,
  );
  expect(
    isQQPolicySettings({ ...policy, privateAllowlist: [{ ...privateActor, role: 'owner' }] }),
  ).toBe(false);
  expect(
    isQQPolicySettings({
      ...policy,
      privateAllowlist: Array.from({ length: QQ_PRIVATE_ALLOWLIST_MAX + 1 }, (_, i) => ({
        ...privateActor,
        senderId: String(i + 1),
      })),
    }),
  ).toBe(false);
  expect(
    isQQPolicySettings({
      ...policy,
      judge: { ...policy.judge, connection: { baseUrl: '', model: '', authMode: 'gateway-key' } },
    }),
  ).toBe(false);
});
it('declares only official production and authenticated reverse-Universal OneBot configuration', () => {
  const official = { protocol: 'official', appId: '', scenes: ['private', 'group'] };
  const onebot = {
    protocol: 'onebot-v11',
    accountId: '12345',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq/onebot',
  };
  expect(sourceSchema(official)).toBe(true);
  expect(isQQSourceSettings(official)).toBe(true);
  expect(sourceSchema(onebot)).toBe(true);
  expect(isQQSourceSettings(onebot)).toBe(true);
  for (const patch of [
    { mode: 'forward-ws' },
    { channelMode: 'split' },
    { path: '/qq?token=secret' },
    { accessToken: 'not-config' },
  ])
    expect(isQQSourceSettings({ ...onebot, ...patch })).toBe(false);
  expect(isQQSourceSettings({ ...official, environment: 'sandbox' })).toBe(false);
  expect(
    isQQSourceSettingsCommand({ protocol: 'official', expectedRevision: 1, settings: onebot }),
  ).toBe(false);
});
it('keeps judge policy and independent source Config on explicit dual CAS and secret version', () => {
  const settings = {
    ...defaultQQPolicySettings().judge,
    connection: {
      baseUrl: 'https://gateway.example/v1',
      model: 'judge-model',
      authMode: 'gateway-key',
    },
  };
  const command = { expectedPolicyRevision: 3, expectedConfigRevision: 7, settings };
  expect(judgeCommandSchema(command)).toBe(true);
  expect(isQQJudgeSettingsCommand(command)).toBe(true);
  expect(isQQJudgeSettingsCommand({ expectedRevision: 3, settings })).toBe(false);
  const key = {
    providerRef: QQ_JUDGE_PROVIDER_REF,
    expectedConfigRevision: 7,
    expectedCredentialVersion: 'fresh',
    value: 'dedicated-key',
  };
  expect(isQQJudgeCredentialCommand(key)).toBe(true);
  expect(isQQJudgeCredentialCommand({ ...key, value: null })).toBe(true);
  expect(isQQJudgeCredentialCommand({ ...key, value: '密'.repeat(1366) })).toBe(false);
  expect(isQQJudgeCredentialCommand({ ...key, value: 'key\n' })).toBe(false);
  expect(isQQJudgeCredentialCommand({ ...key, expectedRevision: 7 })).toBe(false);
});
it('allows a real material-only input without inventing a textual placeholder or accepting authority', () => {
  const input = {
    eventKey: 'event-1',
    actor: { account, scene: 'private', senderId: '67890' },
    route,
    text: '',
    materialIds: ['image-1'],
    trigger: 'direct',
    quote: null,
    observedAt: 1,
  };
  expect(isQQInputContent(input)).toBe(true);
  expect(isQQInputContent({ ...input, materialIds: [] })).toBe(false);
  expect(isQQInputContent({ ...input, principalId: 'owner' })).toBe(false);
  expect(isQQInputContent({ ...input, route: { ...route, targetId: 'another-person' } })).toBe(
    false,
  );
  expect(
    isQQInputReceipt({
      eventKey: 'event-1',
      state: 'observed',
      inputId: null,
      messageId: null,
      error: null,
    }),
  ).toBe(true);
  expect(
    isQQInputReceipt({
      eventKey: 'event-1',
      state: 'accepted',
      inputId: 'input-1',
      messageId: null,
      error: null,
    }),
  ).toBe(false);
});
it('preserves preparing duplicates without treating them as ready acceptance', () => {
  const preparing = {
    eventKey: 'event-1',
    state: 'preparing',
    inputId: 'input-1',
    messageId: null,
    error: null,
  };
  expect(isQQInputReceipt(preparing)).toBe(true);
  expect(isQQInputReceipt({ ...preparing, state: 'duplicate' })).toBe(true);
  expect(isQQInputReceipt({ ...preparing, state: 'duplicate', messageId: 'input-1' })).toBe(true);
  expect(isQQInputReceipt({ ...preparing, state: 'accepted' })).toBe(false);
  expect(isQQInputReceipt({ ...preparing, messageId: 'input-1' })).toBe(false);
  expect(isQQInputReceipt({ ...preparing, state: 'duplicate', inputId: null })).toBe(false);
});
it('preserves observed admission and commit identities when ingress reports rejection', () => {
  const rejected = {
    eventKey: 'event-1',
    state: 'rejected',
    inputId: 'input-1',
    messageId: null,
    error: makeError('permission-denied', false),
  };
  expect(isQQInputReceipt(rejected)).toBe(true);
  expect(isQQInputReceipt({ ...rejected, messageId: 'input-1' })).toBe(true);
  expect(isQQInputReceipt({ ...rejected, eventKey: null, inputId: null })).toBe(true);
  expect(isQQInputReceipt({ ...rejected, inputId: null, messageId: 'input-1' })).toBe(false);
  expect(isQQInputReceipt({ ...rejected, eventKey: null })).toBe(false);
  expect(isQQInputReceipt({ ...rejected, messageId: 'another-input' })).toBe(false);
  expect(isQQInputReceipt({ ...rejected, inputId: 'bad\n' })).toBe(false);
  expect(
    isQQInputReceipt({
      ...rejected,
      error: { code: 'permission-denied', messageKey: 'wrong', retryable: false },
    }),
  ).toBe(false);
});
it('keeps observed IDs empty and ready receipts tied to the exact canonical input', () => {
  const ready = {
    eventKey: 'event-1',
    state: 'accepted',
    inputId: 'input-1',
    messageId: 'input-1',
    error: null,
  };
  expect(isQQInputReceipt(ready)).toBe(true);
  expect(isQQInputReceipt({ ...ready, messageId: 'other' })).toBe(false);
  expect(isQQInputReceipt({ ...ready, state: 'duplicate', messageId: 'other' })).toBe(false);
  expect(isQQInputReceipt({ ...ready, state: 'observed' })).toBe(false);
  expect(isQQInputReceipt({ ...ready, state: 'observed', inputId: null, messageId: null })).toBe(
    true,
  );
  expect(isQQInputReceipt({ ...ready, grant: 'owner' })).toBe(false);
});
it('does not mistake pure upload or a forged send slot for mandatory text acceptance', () => {
  const upload: QQDeliveryAttempt = {
    ...send,
    operation: 'upload',
    receipt: {
      messageId: null,
      fileId: 'remote-file',
      transferId: null,
      sequence: null,
      sequenceAuthoritative: null,
    },
  };
  expect(isQQDeliveryAttempt(upload)).toBe(true);
  const forged = { ...textPart, send: upload };
  expect(isQQDeliveryPart(forged)).toBe(false);
  expect(isQQDeliveryPartAccepted(forged)).toBe(false);
  expect(isQQDeliveryPartAccepted({ ...textPart, upload })).toBe(false);
  expect(
    isQQDeliveryPartAccepted({ ...textPart, upload: { ...upload, operation: 'upload-and-send' } }),
  ).toBe(false);
  expect(
    isQQDeliveryView(
      delivery([
        forged,
        {
          ...voicePart,
          preparation: 'ready',
          content: { kind: 'voice', messageIds: ['output-1'], material },
        },
      ]),
    ),
  ).toBe(false);
});
it('accepts file publication as its own operation without inventing a message ID or duplicate send', () => {
  const file = {
    ...material,
    kind: 'file' as const,
    name: 'file.bin',
    mediaType: 'application/octet-stream',
    durationMs: null,
  };
  const upload: QQDeliveryAttempt = {
    ...send,
    operation: 'upload-and-send',
    receipt: {
      messageId: null,
      fileId: 'published-file',
      transferId: null,
      sequence: 0,
      sequenceAuthoritative: false,
    },
  };
  const part: QQDeliveryPart = {
    ...textPart,
    requirement: 'required-media',
    content: { kind: 'material', material: file },
    upload,
    send: null,
  };
  expect(partSchema(part)).toBe(true);
  expect(isQQDeliveryPartAccepted(part)).toBe(true);
  expect(isQQDeliveryPart({ ...part, send })).toBe(false);
  expect(isQQDeliveryAttempt({ ...send, receipt: upload.receipt })).toBe(false);
});
it('allows required UTF8 text attachments without treating them as the mandatory body or allowing voice', () => {
  const text: CompanionMaterialRef = {
    ...material,
    kind: 'text',
    name: 'attachment.txt',
    mediaType: 'text/plain',
    durationMs: null,
  };
  const attachment: QQDeliveryPart = {
    ...textPart,
    id: 'text-attachment',
    index: 1,
    requirement: 'required-media',
    content: { kind: 'material', material: text },
    upload: {
      ...send,
      operation: 'upload-and-send',
      receipt: {
        messageId: null,
        fileId: 'published-text',
        transferId: null,
        sequence: null,
        sequenceAuthoritative: null,
      },
    },
  };
  expect(isQQDeliveryPart(attachment)).toBe(true);
  expect(isQQDeliveryPartAccepted(attachment)).toBe(true);
  const batch = delivery([{ ...textPart, send }, attachment]);
  expect(isQQDeliveryView(batch)).toBe(true);
  expect(isQQDeliveryView({ ...batch, textRepresentation: 'text-document' })).toBe(false);
  expect(isQQDeliveryView(delivery([textPart, attachment]))).toBe(false);
  expect(
    isQQDeliveryPart({ ...attachment, upload: null, content: { kind: 'material', material } }),
  ).toBe(false);
  expect(isQQDeliveryPart({ ...voicePart, requirement: 'required-media' })).toBe(false);
});
it('records actual zero allowance only as blocked nonpending with an error and no native claims', () => {
  const blocked: QQDeliveryView = {
    ...delivery([textPart, voicePart]),
    allowedMessageParts: 0,
    phase: 'blocked',
    outcome: 'failed',
    error: makeError('quota-exceeded', false),
  };
  expect(isQQDeliveryView(blocked)).toBe(true);
  for (const phase of ['prepared', 'sending', 'terminal'])
    expect(isQQDeliveryView({ ...blocked, phase })).toBe(false);
  expect(isQQDeliveryView({ ...blocked, outcome: 'pending' })).toBe(false);
  expect(isQQDeliveryView({ ...blocked, error: null })).toBe(false);
  const claim: QQDeliveryAttempt = {
    ...send,
    phase: 'claimed',
    outcome: 'pending',
    receipt: null,
    cleanup: 'pending',
    settledAt: null,
  };
  expect(isQQDeliveryAttempt(claim)).toBe(true);
  expect(isQQDeliveryView({ ...blocked, parts: [{ ...textPart, send: claim }] })).toBe(false);
  expect(
    isQQDeliveryView({
      ...delivery([{ ...textPart, send: claim }]),
      allowedMessageParts: 1,
      phase: 'sending',
    }),
  ).toBe(true);
  expect(isQQDeliveryView({ ...blocked, allowedMessageParts: -1 })).toBe(false);
});
it('keeps voice as a pending intent until every text part is conclusively accepted', () => {
  expect(isQQDeliveryView(delivery([textPart, voicePart]))).toBe(true);
  const generated: QQDeliveryPart = {
    ...voicePart,
    preparation: 'ready',
    content: { kind: 'voice', messageIds: ['output-1'], material },
  };
  expect(isQQDeliveryView(delivery([textPart, generated]))).toBe(false);
  expect(isQQDeliveryView(delivery([{ ...textPart, send }, generated]))).toBe(true);
  const unknown: QQDeliveryAttempt = {
    ...send,
    outcome: 'unknown',
    receipt: null,
    error: makeError('network', false),
  };
  expect(isQQDeliveryAttempt(unknown)).toBe(true);
  expect(isQQDeliveryView(delivery([{ ...textPart, send: unknown }, generated]))).toBe(false);
  const failedVoice: QQDeliveryPart = {
    ...voicePart,
    preparation: 'failed',
    error: makeError('unavailable', false),
  };
  expect(
    isQQDeliveryView({
      ...delivery([{ ...textPart, send }, failedVoice]),
      outcome: 'partial',
      phase: 'terminal',
    }),
  ).toBe(true);
  expect(
    isQQDeliveryView({
      ...delivery([{ ...textPart, send }, failedVoice]),
      outcome: 'accepted',
      phase: 'terminal',
    }),
  ).toBe(false);
});
it('rejects cross-audience material and mismatched route while preserving complete textual result metadata', () => {
  const file = {
    ...material,
    kind: 'text' as const,
    name: 'complete.txt',
    mediaType: 'text/plain',
    durationMs: null,
  };
  const document: QQDeliveryPart = {
    ...textPart,
    id: 'document',
    index: 1,
    content: { kind: 'material', material: file },
  };
  const batch = { ...delivery([textPart, document]), textRepresentation: 'text-document' };
  expect(isQQDeliveryView(batch)).toBe(true);
  expect(isQQDeliveryView({ ...batch, route: { ...route, targetId: 'other-person' } })).toBe(false);
  expect(
    isQQDeliveryView({
      ...batch,
      parts: [
        textPart,
        {
          ...document,
          content: {
            kind: 'material',
            material: {
              ...file,
              audience: { kind: 'person-private', principalId: 'other-person' },
            },
          },
        },
      ],
    }),
  ).toBe(false);
});
it('keeps management readiness, credentials and codec evidence truthful and bounded', () => {
  const policy = defaultQQPolicySettings();
  const credential = {
    available: false,
    writable: true,
    source: 'none' as const,
    version: 'fresh',
  };
  const view: QQView = {
    version: 1,
    policy: { revision: 0, settings: policy },
    sources: [
      {
        protocol: 'official',
        sourcePluginId: 'pet.qq-official',
        instanceId: 'default',
        desiredEnabled: false,
        source: 'disabled',
        configRevision: 0,
        appliedRevision: null,
        settings: { protocol: 'official', appId: '', scenes: ['private', 'group'] },
        account: null,
        bindingId: null,
        phase: 'disabled',
        credential,
        installedVersion: null,
        media: { text: 'unverified', image: 'unverified', voice: 'unverified', file: 'unverified' },
        cleanup: 'settled',
        error: null,
      },
    ],
    judge: {
      sourcePluginId: QQ_JUDGE_PLUGIN_ID,
      configRevision: 0,
      appliedRevision: null,
      settings: {
        ...policy.judge,
        connection: { baseUrl: '', model: '', authMode: 'gateway-key' },
      },
      bindingId: null,
      credential,
      readiness: 'unconfigured',
      active: 0,
      admittedAttempts: 0,
      inputTokens: null,
      outputTokens: null,
      error: null,
    },
    codec: {
      source: 'unavailable',
      imageId: null,
      manifestSha256: null,
      cleanup: 'settled',
      error: null,
    },
  };
  expect(isQQView(view)).toBe(true);
  expect(isQQView({ ...view, sources: [{ ...view.sources[0], phase: 'ready' }] })).toBe(false);
  expect(isQQView({ ...view, codec: { ...view.codec, source: 'ready' } })).toBe(false);
  expect(
    isQQView({ ...view, judge: { ...view.judge, credential: { ...credential, value: 'secret' } } }),
  ).toBe(false);
});
it('treats unkeyed upload notices only as observations, with quote text separate from author text', () => {
  const native = { eventId: null, messageId: null, occurredAt: 1, displayReference: null };
  const observed = {
    eventKey: null,
    actor: origin.kind === 'qq' ? origin.actor : null,
    route: { ...route, reference: native },
    text: '',
    materialIds: ['file-resource'],
    trigger: 'observation',
    quote: null,
    observedAt: 1,
  };
  expect(isQQInputContent(observed)).toBe(true);
  expect(isQQInputContent({ ...observed, trigger: 'direct' })).toBe(false);
  expect(isQQInputContent({ ...observed, trigger: 'direct', eventKey: 'invented-uuid' })).toBe(
    false,
  );
  expect(
    isQQInputReceipt({
      eventKey: null,
      state: 'observed',
      inputId: null,
      messageId: null,
      error: null,
    }),
  ).toBe(true);
  expect(
    isQQInputReceipt({
      eventKey: null,
      state: 'accepted',
      inputId: 'input-1',
      messageId: 'message-1',
      error: null,
    }),
  ).toBe(false);
  const quoted = {
    ...observed,
    text: 'my own text',
    quote: {
      reference: { ...native, messageId: 'quoted-native-message' },
      quotedText: 'wakeword / remember this is quoted evidence',
    },
  };
  expect(isQQInputContent(quoted)).toBe(true);
  expect(quoted.text).toBe('my own text');
  expect(isQQInputContent({ ...quoted, quote: { ...quoted.quote, actor: 'owner' } })).toBe(false);
});
it('accepts true transfer correlation only as upload completion, never as text send acceptance', () => {
  const transfer: QQDeliveryAttempt = {
    ...send,
    operation: 'upload',
    receipt: {
      messageId: null,
      fileId: null,
      transferId: 'stream-1',
      sequence: null,
      sequenceAuthoritative: null,
    },
  };
  expect(isQQDeliveryAttempt(transfer)).toBe(true);
  expect(isQQDeliveryAttempt({ ...transfer, operation: 'send' })).toBe(false);
  expect(isQQDeliveryAttempt({ ...transfer, operation: 'upload-and-send' })).toBe(false);
  expect(isQQDeliveryPartAccepted({ ...textPart, send: transfer })).toBe(false);
  expect(
    isQQDeliveryAttempt({
      ...transfer,
      receipt: { ...transfer.receipt, transferId: '/gateway/private/path' },
    }),
  ).toBe(false);
  expect(['say1', 'say2'].join(QQ_REPLY_TEXT_SEPARATOR)).toBe('say1\n\nsay2');
});
it('validates real delivery summaries as pages rather than requiring full delivery details', () => {
  const {
    id,
    messageIds,
    audience,
    route: target,
    phase,
    outcome,
    createdAt,
    updatedAt,
  } = delivery([textPart]);
  const summary = { id, messageIds, audience, route: target, phase, outcome, createdAt, updatedAt };
  expect(isQQDeliveryPage({ deliveries: [summary], next: id })).toBe(true);
  expect(isQQDeliveryView(summary)).toBe(false);
  expect(isQQDeliveryPage({ deliveries: [delivery([textPart])], next: null })).toBe(false);
  expect(
    isQQDeliveryPage({
      deliveries: [{ ...summary, audience: { kind: 'qq-group', account, groupId: '123' } }],
      next: null,
    }),
  ).toBe(false);
  expect(isQQDeliveryPage({ deliveries: [summary, summary], next: null })).toBe(false);
  expect(isQQDeliveryPage({ deliveries: [], next: { arbitrary: 'cursor' } })).toBe(false);
  expect(
    isQQDeliveryPage({
      deliveries: Array.from({ length: QQ_PAGE_MAX_ITEMS + 1 }, (_, index) => ({
        ...summary,
        id: `delivery-${index}`,
      })),
      next: null,
    }),
  ).toBe(false);
  const large = {
    deliveries: Array.from({ length: QQ_PAGE_MAX_ITEMS }, (_, index) => ({
      ...summary,
      id: `delivery-${index}`,
      messageIds: Array.from({ length: 64 }, (_, n) => `message-${n}-${'x'.repeat(110)}`),
    })),
    next: null,
  };
  expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(
    QQ_VIEW_MAX_BYTES,
  );
  expect(isQQDeliveryPage(large)).toBe(false);
});
it('validates bounded principal pages without converting display labels into roles', () => {
  const person = { id: 'person-1', kind: 'person', displayName: 'Administrator' };
  expect(
    isQQPrincipalPage({
      principals: [person, { id: 'owner', kind: 'owner', displayName: 'Owner' }],
      next: null,
    }),
  ).toBe(true);
  expect(isQQPrincipalPage({ principals: [person, person], next: null })).toBe(false);
  expect(isQQPrincipalPage({ principals: [{ ...person, role: 'owner' }], next: null })).toBe(false);
  expect(isQQPrincipalPage({ principals: [], next: 'bad\n' })).toBe(false);
  expect(
    isQQPrincipalPage({
      principals: Array.from({ length: QQ_PAGE_MAX_ITEMS + 1 }, (_, index) => ({
        ...person,
        id: `person-${index}`,
      })),
      next: null,
    }),
  ).toBe(false);
});
it('keeps ordinary message/task command and receipt keys unchanged', () => {
  expectTypeOf<keyof CompanionMessageCommand>().toEqualTypeOf<'commandId' | 'text'>();
  expectTypeOf<keyof CompanionTaskCommand>().toEqualTypeOf<
    'commandId' | 'title' | 'code' | 'files' | 'outputs' | 'timeoutMs'
  >();
  expectTypeOf<keyof CompanionCommandReceipt>().toEqualTypeOf<
    'commandId' | 'status' | 'messageId' | 'taskId'
  >();
});

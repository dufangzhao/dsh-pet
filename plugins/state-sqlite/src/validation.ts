import {
  COMPANION_MEMORY_MAX_KEY_UNITS,
  COMPANION_MEMORY_MAX_VALUE_UNITS,
  COMPANION_MAX_CODE,
  COMPANION_MAX_TEXT,
  LOCAL_ID_PATTERN,
  isKernelErrorCode,
  isCompanionAudience,
  isCompanionConversationAudience,
  isCompanionInputOrigin,
  isCompanionOrigins,
  isCompanionTaskOrigin,
  isCompanionInputMaterials,
  isCompanionMaterialRef,
  isCompanionMessageContent,
  isQQDeliveryView,
  isQQDeliveryAttempt,
  COMPANION_INPUT_MATERIAL_MAX,
  COMPANION_TASK_MATERIAL_MAX,
  QQ_PAGE_MAX_ITEMS,
  isQQAccountRef,
  isQQReplyRoute,
  isQQExternalId,
  sameQQAccount,
  isQQJudgePolicy,
  QQ_JUDGE_MAX_ATTEMPTS_HOUR,
  QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
  QQ_JUDGE_TIMEOUT_MS,
  QQ_JUDGE_MAX_OUTPUT_TOKENS,
  QQ_PROACTIVE_MAX_REPLIES_HOUR,
} from '@pet/contracts';
import type { JsonValue } from '@pet/contracts';
import {
  jsonPreflight,
  validateLocalHostSourceBinding,
  validateLocalHostTaskReference,
  validateLocalHostProcessIdentity,
} from '@pet/contracts/validation';
import { STATE_MAX_ARTIFACTS, STATE_MAX_RESULT_BYTES } from './types.js';
import type { StateMethodInputs } from './types.js';
import { isStateReadScope } from './scope.js';

import { StateFailure } from './failure.js';
export { StateFailure } from './failure.js';

function requireValue(condition: boolean): asserts condition {
  if (!condition) throw new StateFailure('invalid-input');
}

function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function keys(body: Record<string, unknown>, required: string[], optional: string[] = []): void {
  requireValue(required.every((key) => key in body));
  requireValue(Object.keys(body).every((key) => required.includes(key) || optional.includes(key)));
}

function text(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function id(value: unknown): value is string {
  return text(value, 128) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function optional(
  body: Record<string, unknown>,
  key: string,
  valid: (value: unknown) => boolean,
): void {
  if (key in body) requireValue(valid(body[key]));
}

function relativePath(value: unknown): boolean {
  return (
    text(value, 512) &&
    !/[\\:]/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) >= 32) &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function artifact(value: unknown): void {
  const body = object(value);
  keys(body, ['id', 'taskId', 'name', 'mediaType', 'sizeBytes', 'provider', 'relativePath']);
  requireValue(id(body['id']) && id(body['taskId']) && id(body['provider']));
  requireValue(text(body['name'], 240) && text(body['mediaType'], 128));
  requireValue(integer(body['sizeBytes'], 0) && relativePath(body['relativePath']));
}

function error(value: unknown): boolean {
  if (value === null) return true;
  const body = object(value);
  keys(body, ['code', 'messageKey', 'retryable']);
  return (
    isKernelErrorCode(body['code']) &&
    body['messageKey'] === `errors.${body['code']}` &&
    typeof body['retryable'] === 'boolean'
  );
}

function proactiveLimits(value: unknown): void {
  const limits = object(value);
  keys(limits, ['cooldownMs', 'maxRepliesPerHour']);
  requireValue(
    integer(limits['cooldownMs'], 1000, 24 * 60 * 60 * 1000) &&
      integer(limits['maxRepliesPerHour'], 1, QQ_PROACTIVE_MAX_REPLIES_HOUR),
  );
}

export function validateInput<K extends keyof StateMethodInputs>(
  method: K,
  input: unknown,
): StateMethodInputs[K] {
  const checked = jsonPreflight(input);
  if (!checked.ok)
    throw new StateFailure(checked.code === 'bytes-exceeded' ? 'quota-exceeded' : 'invalid-input');
  const body = object(checked.value);
  if ('scope' in body) requireValue(isStateReadScope(body['scope']));
  switch (method) {
    case 'claimJudgment': {
      keys(
        body,
        ['id', 'eventKey', 'audience', 'providerRef', 'policyRevision', 'configRevision'],
        ['limits'],
      );
      requireValue(
        id(body['id']) &&
          isQQExternalId(body['eventKey']) &&
          isCompanionConversationAudience(body['audience']) &&
          body['audience'].kind === 'qq-group' &&
          integer(body['policyRevision'], 0) &&
          integer(body['configRevision'], 0),
      );
      const limits =
        'limits' in body
          ? object(body['limits'])
          : {
              maxAttemptsPerHour: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
              perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
            };
      keys(limits, ['maxAttemptsPerHour', 'perGroupIntervalMs']);
      requireValue(
        isQQJudgePolicy({
          providerRef: body['providerRef'],
          ...limits,
          timeoutMs: QQ_JUDGE_TIMEOUT_MS,
          maxOutputTokens: QQ_JUDGE_MAX_OUTPUT_TOKENS,
        }),
      );
      break;
    }
    case 'finishJudgment':
      keys(body, ['id', 'decision', 'inputTokens', 'outputTokens', 'error', 'cleanup']);
      requireValue(
        id(body['id']) &&
          (body['decision'] === null || typeof body['decision'] === 'boolean') &&
          (body['inputTokens'] === null || integer(body['inputTokens'], 0)) &&
          (body['outputTokens'] === null || integer(body['outputTokens'], 0)) &&
          error(body['error']) &&
          ['pending', 'settled', 'failed', 'unknown'].includes(String(body['cleanup'])),
      );
      break;
    case 'proactiveReadiness':
      keys(body, ['audience'], ['limits']);
      requireValue(
        isCompanionConversationAudience(body['audience']) && body['audience'].kind === 'qq-group',
      );
      if ('limits' in body) proactiveLimits(body['limits']);
      break;
    case 'judgmentUsage':
      keys(body, [], ['since', 'audience']);
      optional(body, 'since', (v) => integer(v, 0));
      optional(
        body,
        'audience',
        (v) => isCompanionConversationAudience(v) && v.kind === 'qq-group',
      );
      break;
    case 'observe': {
      keys(body, ['observation']);
      const v = object(body['observation']);
      keys(v, [
        'id',
        'audience',
        'principalId',
        'observedAt',
        'text',
        'quotedText',
        'materialIds',
        'fileEvidence',
      ]);
      requireValue(
        id(v['id']) &&
          isCompanionConversationAudience(v['audience']) &&
          (v['principalId'] === null || id(v['principalId'])) &&
          integer(v['observedAt'], 0) &&
          text(v['text'], COMPANION_MAX_TEXT, 0) &&
          (v['quotedText'] === null || text(v['quotedText'], COMPANION_MAX_TEXT, 0)),
      );
      requireValue(
        Array.isArray(v['materialIds']) &&
          v['materialIds'].length <= COMPANION_INPUT_MATERIAL_MAX &&
          v['materialIds'].every(id) &&
          new Set(v['materialIds']).size === v['materialIds'].length,
      );
      if (v['fileEvidence'] !== null) {
        const e = object(v['fileEvidence']);
        keys(e, ['kind', 'account', 'groupId', 'fileId', 'busId', 'name', 'reportedSize']);
        requireValue(
          e['kind'] === 'qq-file' &&
            isQQAccountRef(e['account']) &&
            isQQExternalId(e['groupId']) &&
            isQQExternalId(e['fileId']) &&
            !String(e['fileId']).includes('://') &&
            (e['busId'] === null || text(e['busId'], 64)) &&
            text(e['name'], 240) &&
            (e['reportedSize'] === null || integer(e['reportedSize'], 0)) &&
            jsonBytes(e) <= 2048,
        );
        requireValue(
          v['audience'].kind === 'qq-group' &&
            sameQQAccount(v['audience'].account, e['account']) &&
            v['audience'].groupId === e['groupId'],
        );
      }
      break;
    }
    case 'observations':
      keys(body, ['scope'], ['now']);
      optional(body, 'now', (v) => integer(v, 0));
      break;
    case 'pruneObservations':
      keys(body, [], ['now']);
      optional(body, 'now', (v) => integer(v, 0));
      break;
    case 'claimInput':
      keys(body, ['id']);
      requireValue(id(body['id']));
      break;
    case 'createInput': {
      keys(body, ['id', 'commandId', 'origin', 'evidence', 'materialIds'], ['proactiveLimits']);
      requireValue(
        id(body['id']) &&
          id(body['commandId']) &&
          isCompanionInputOrigin(body['origin']) &&
          body['origin'].kind !== 'legacy-unknown' &&
          body['origin'].inputId === body['id'],
      );
      if ('proactiveLimits' in body) {
        requireValue(body['origin'].kind === 'qq-proactive');
        proactiveLimits(body['proactiveLimits']);
      }
      object(body['evidence']);
      requireValue(jsonBytes(body['evidence']) <= 24 * 1024);
      const maximum =
        body['origin'].kind === 'work-result'
          ? COMPANION_TASK_MATERIAL_MAX
          : COMPANION_INPUT_MATERIAL_MAX;
      requireValue(
        Array.isArray(body['materialIds']) &&
          body['materialIds'].length <= maximum &&
          body['materialIds'].every(id) &&
          new Set(body['materialIds']).size === body['materialIds'].length,
      );
      break;
    }
    case 'commitInput':
      keys(body, ['id', 'text'], ['materials', 'content']);
      requireValue(id(body['id']) && text(body['text'], COMPANION_MAX_TEXT));
      optional(body, 'materials', isCompanionInputMaterials);
      optional(body, 'content', isCompanionMessageContent);
      break;
    case 'updateInput':
      keys(body, ['id', 'phase', 'cleanup'], ['error']);
      requireValue(
        id(body['id']) &&
          [
            'preparing',
            'ready',
            'active',
            'completed',
            'cancelled',
            'failed',
            'interrupted',
            'unknown',
          ].includes(String(body['phase'])) &&
          ['pending', 'settled', 'failed', 'unknown'].includes(String(body['cleanup'])),
      );
      optional(body, 'error', error);
      break;
    case 'putMaterial':
      keys(body, [
        'id',
        'inputId',
        'observationId',
        'audience',
        'phase',
        'reference',
        'storageKey',
        'cleanup',
        'error',
      ]);
      requireValue(
        (body['inputId'] === null || id(body['inputId'])) &&
          (body['observationId'] === null || id(body['observationId'])) &&
          (body['inputId'] !== null || body['observationId'] !== null),
      );
      requireValue(
        id(body['id']) &&
          isCompanionConversationAudience(body['audience']) &&
          ['preparing', 'ready', 'failed', 'released', 'unknown'].includes(String(body['phase'])) &&
          ['pending', 'settled', 'failed', 'unknown'].includes(String(body['cleanup'])) &&
          error(body['error']),
      );
      requireValue(body['reference'] === null || isCompanionMaterialRef(body['reference']));
      requireValue(body['storageKey'] === null || relativePath(body['storageKey']));
      if (body['phase'] === 'ready')
        requireValue(body['reference'] !== null && body['storageKey'] !== null);
      if (body['phase'] === 'released')
        requireValue(body['storageKey'] === null && body['cleanup'] === 'settled');
      break;
    case 'createDelivery':
    case 'updateDelivery':
      keys(body, ['delivery'], method === 'createDelivery' ? ['execution'] : []);
      requireValue(isQQDeliveryView(body['delivery']));
      if ('execution' in body) {
        const execution = object(body['execution']);
        if (execution['kind'] === 'remote') {
          keys(execution, ['kind', 'binding']);
          requireValue(validateLocalHostSourceBinding(execution['binding']).ok);
        } else {
          keys(execution, ['kind', 'hostId']);
          requireValue(
            execution['kind'] === 'unavailable' &&
              (execution['hostId'] === null ||
                (typeof execution['hostId'] === 'string' &&
                  new RegExp(LOCAL_ID_PATTERN).test(execution['hostId']))),
          );
        }
      }
      break;
    case 'bindDeliveryTask':
    case 'settleDeliveryCleanup':
    case 'enrichDeliveryAttempt': {
      keys(
        body,
        [
          'id',
          'partId',
          'attemptId',
          'binding',
          'task',
          'contentHash',
          ...(method === 'enrichDeliveryAttempt' ? ['fact'] : []),
          ...(method === 'settleDeliveryCleanup' ? ['processIdentity'] : []),
        ],
        method === 'bindDeliveryTask' ? ['processIdentity'] : [],
      );
      if ('processIdentity' in body)
        requireValue(validateLocalHostProcessIdentity(body['processIdentity']).ok);
      requireValue(
        id(body['id']) &&
          id(body['partId']) &&
          id(body['attemptId']) &&
          validateLocalHostSourceBinding(body['binding']).ok &&
          validateLocalHostTaskReference(body['task']).ok &&
          typeof body['contentHash'] === 'string' &&
          /^[a-f0-9]{64}$/.test(body['contentHash']),
      );
      if (method === 'enrichDeliveryAttempt') {
        const fact = object(body['fact']);
        keys(fact, ['dispatch', 'outcome', 'correlationId', 'receipt', 'cleanup', 'error']);
        requireValue(
          ['unknown', 'not-dispatched', 'dispatched'].includes(String(fact['dispatch'])) &&
            ['accepted', 'rejected', 'failed', 'unknown', 'cancelled-before-dispatch'].includes(
              String(fact['outcome']),
            ),
        );
        // Shared receipt/error shape validation; outcome semantics follow the retained operation after merge.
        requireValue(
          isQQDeliveryAttempt({
            id: body['attemptId'],
            operation: 'send',
            phase: 'settled',
            outcome: 'unknown',
            startedAt: 0,
            settledAt: 0,
            correlationId: fact['correlationId'],
            receipt: fact['receipt'],
            cleanup: fact['cleanup'],
            error: fact['error'],
          }),
        );
      }
      break;
    }
    case 'passiveReplyBudget':
      keys(body, ['route']);
      requireValue(
        isQQReplyRoute(body['route']) &&
          body['route'].account.protocol === 'official' &&
          body['route'].reference !== null &&
          (body['route'].reference.messageId !== null || body['route'].reference.eventId !== null),
      );
      break;
    case 'claimDeliveryAttempt':
      keys(body, ['id', 'partId', 'attempt']);
      requireValue(
        id(body['id']) &&
          id(body['partId']) &&
          isQQDeliveryAttempt(body['attempt']) &&
          body['attempt'].phase === 'claimed' &&
          body['attempt'].outcome === 'pending' &&
          body['attempt'].cleanup === 'pending' &&
          body['attempt'].receipt === null,
      );
      break;
    case 'inputMessage':
    case 'inputNotices':
    case 'getObservation':
    case 'getInput':
    case 'findInput':
    case 'getMaterial':
    case 'findMaterial':
    case 'getDelivery':
    case 'getDeliveryExecution':
      keys(body, ['id', 'scope']);
      requireValue(id(body['id']));
      break;
    case 'deliveries':
      keys(body, ['scope'], ['after', 'limit']);
      optional(body, 'after', id);
      optional(body, 'limit', (v) => integer(v, 1, QQ_PAGE_MAX_ITEMS));
      break;
    case 'snapshot':
      keys(body, [], ['messageLimit', 'taskLimit', 'byteBudget', 'scope']);
      optional(body, 'byteBudget', (value) => integer(value, 1, STATE_MAX_RESULT_BYTES));
      optional(body, 'messageLimit', (value) => integer(value, 1, 100));
      optional(body, 'taskLimit', (value) => integer(value, 1, 100));
      break;
    case 'events':
      keys(body, ['after', 'epoch'], ['limit', 'scope']);
      requireValue(integer(body['after'], 0) && id(body['epoch']));
      optional(body, 'limit', (value) => integer(value, 1, 200));
      break;
    case 'acceptMessage':
      keys(body, ['commandId', 'text']);
      requireValue(id(body['commandId']) && text(body['text'], COMPANION_MAX_TEXT));
      break;
    case 'createTask':
      keys(
        body,
        ['commandId', 'title', 'code'],
        ['executionId', 'files', 'outputs', 'timeoutMs', 'origin', 'materials'],
      );
      optional(body, 'origin', isCompanionTaskOrigin);
      requireValue(
        id(body['commandId']) && text(body['title'], 256) && text(body['code'], COMPANION_MAX_CODE),
      );
      optional(body, 'executionId', id);
      optional(body, 'timeoutMs', (value) => integer(value, 1, 300_000));
      for (const field of ['files', 'outputs']) {
        if (!(field in body)) continue;
        const items = body[field];
        requireValue(Array.isArray(items) && items.length <= 16);
        const seen = new Set<string>();
        for (const item of items) {
          const entry = object(item);
          keys(
            entry,
            field === 'files' ? ['path', 'content'] : ['path'],
            field === 'outputs' ? ['mediaType'] : [],
          );
          requireValue(relativePath(entry['path']));
          const path = String(entry['path']);
          requireValue(!seen.has(path));
          seen.add(path);
          if (field === 'files') requireValue(text(entry['content'], 32_768, 0));
          else optional(entry, 'mediaType', (value) => text(value, 128));
        }
      }
      if ('materials' in body) {
        const selections = body['materials'];
        requireValue(Array.isArray(selections) && selections.length <= COMPANION_TASK_MATERIAL_MAX);
        if (selections.length === 0) {
          // Preserve every pre-material intent byte; never strip a nonempty selection.
          delete body['materials'];
        } else {
          const ids = new Set<string>(),
            names = new Set<string>();
          const inlineNames = Array.isArray(body['files'])
            ? body['files'].map((file) => object(file)['path'])
            : [];
          for (const value of selections) {
            const selection = object(value);
            keys(selection, ['materialId', 'inputName']);
            requireValue(
              id(selection['materialId']) &&
                text(selection['inputName'], 240) &&
                relativePath(selection['inputName']),
            );
            requireValue(
              !ids.has(selection['materialId']) &&
                !names.has(selection['inputName']) &&
                !inlineNames.includes(selection['inputName']),
            );
            ids.add(selection['materialId']);
            names.add(selection['inputName']);
          }
          const origin = body['origin'];
          requireValue(
            isCompanionTaskOrigin(origin) &&
              origin.materialIds.length === ids.size &&
              origin.materialIds.every((id) => ids.has(id)),
          );
        }
      }
      break;
    case 'updateTask':
      keys(
        body,
        ['taskId', 'status'],
        ['exitCode', 'stdout', 'stderr', 'logsTruncated', 'error', 'artifacts'],
      );
      requireValue(
        id(body['taskId']) &&
          typeof body['status'] === 'string' &&
          [
            'accepted',
            'running',
            'cancel-requested',
            'completed',
            'cancelled',
            'failed',
            'interrupted',
            'unknown',
          ].includes(body['status']),
      );
      optional(
        body,
        'exitCode',
        (value) => value === null || integer(value, -2_147_483_648, 2_147_483_647),
      );
      optional(body, 'stdout', (value) => text(value, 60_000, 0));
      optional(body, 'stderr', (value) => text(value, 60_000, 0));
      optional(body, 'logsTruncated', (value) => typeof value === 'boolean');
      optional(body, 'error', error);
      if ('artifacts' in body) {
        const items = body['artifacts'];
        requireValue(Array.isArray(items) && items.length <= STATE_MAX_ARTIFACTS);
        for (const item of items) artifact(item);
      }
      break;
    case 'appendMessage':
      keys(
        body,
        ['id', 'role', 'text'],
        ['inputId', 'taskId', 'audience', 'origins', 'materials', 'content'],
      );
      optional(body, 'audience', isCompanionConversationAudience);
      optional(body, 'origins', isCompanionOrigins);
      optional(body, 'materials', isCompanionInputMaterials);
      optional(body, 'content', isCompanionMessageContent);
      if ('audience' in body || 'origins' in body)
        requireValue('audience' in body && 'origins' in body);
      requireValue(
        id(body['id']) &&
          ['user', 'assistant', 'notice'].includes(String(body['role'])) &&
          text(body['text'], COMPANION_MAX_TEXT),
      );
      optional(body, 'inputId', (value) => value === null || id(value));
      optional(body, 'taskId', (value) => value === null || id(value));
      break;
    case 'memorySnapshot':
      keys(body, [], ['scope']);
      break;
    case 'rememberFact':
    case 'forgetFact': {
      const current = 'expectedMemoryRevision' in body;
      if (method === 'rememberFact' && !current) {
        keys(body, ['commandId', 'key', 'value'], ['expectedRevision']);
        optional(body, 'expectedRevision', (v) => integer(v, 0));
      } else {
        keys(
          body,
          [
            'commandId',
            'key',
            'expectedMemoryRevision',
            'expectedFactRevision',
            'origin',
            ...(method === 'rememberFact' ? ['value'] : []),
          ],
          ['audience'],
        );
        optional(body, 'audience', isCompanionAudience);
        requireValue(
          integer(body['expectedMemoryRevision'], 0) &&
            integer(body['expectedFactRevision'], method === 'forgetFact' ? 1 : 0),
        );
        validateOrigin(body['origin']);
      }
      requireValue(id(body['commandId']) && text(body['key'], COMPANION_MEMORY_MAX_KEY_UNITS));
      if (method === 'rememberFact')
        requireValue(text(body['value'], COMPANION_MEMORY_MAX_VALUE_UNITS));
      break;
    }
    case 'getMessage':
      keys(body, ['id', 'eventSequence'], ['scope']);
      requireValue(id(body['id']) && integer(body['eventSequence'], 1));
      break;
    case 'getTaskByExecution':
      keys(body, ['executionId'], ['scope']);
      requireValue(id(body['executionId']));
      break;
    case 'getTask':
    case 'getArtifact':
      keys(body, ['id'], ['scope']);
      requireValue(id(body['id']));
      break;
    case 'recover':
      keys(body, [], ['limit']);
      optional(body, 'limit', (value) => integer(value, 1, 200));
      break;
    case 'recordCommand':
    case 'getCommand':
      keys(
        body,
        ['commandId', 'kind', 'payload'],
        method === 'recordCommand' ? ['taskId', 'messageId'] : [],
      );
      requireValue(id(body['commandId']) && id(body['kind']));
      object(body['payload']);
      optional(body, 'taskId', (value) => value === null || id(value));
      optional(body, 'messageId', (value) => value === null || id(value));
      break;
  }
  // The switch validates every operation's exact shape; no caller object is retained.
  return body as unknown as StateMethodInputs[K];
}

export function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** Budget the encoded string, including escapes and multibyte characters. */
export function boundedText(value: string, bytes: number): string {
  if (jsonBytes(value) <= bytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytes(value.slice(0, middle)) <= bytes) low = middle;
    else high = middle - 1;
  }
  const end = low > 0 && /[\uD800-\uDBFF]/.test(value.charAt(low - 1)) ? low - 1 : low;
  return value.slice(0, end);
}

export function validateOrigin(value: unknown): void {
  const origin = object(value);
  if (origin['kind'] === 'owner-form' || origin['kind'] === 'legacy-unknown') {
    keys(origin, ['kind']);
    return;
  }
  keys(origin, ['kind', 'inputId', 'evidence']);
  requireValue(origin['kind'] === 'user-input' && id(origin['inputId']));
  const evidence = object(origin['evidence']);
  keys(evidence, ['start', 'end']);
  requireValue(
    integer(evidence['start'], 0) &&
      integer(evidence['end'], 1, 8000) &&
      Number(evidence['end']) > Number(evidence['start']),
  );
}

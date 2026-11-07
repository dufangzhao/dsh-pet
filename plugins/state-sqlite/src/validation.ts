import { COMPANION_MAX_CODE, COMPANION_MAX_TEXT, isKernelErrorCode } from '@pet/contracts';
import type { JsonValue, KernelErrorCode } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { STATE_MAX_ARTIFACTS } from './types.js';
import type { StateMethodInputs } from './types.js';

export class StateFailure extends Error {
  constructor(readonly code: KernelErrorCode) {
    super(code);
  }
}

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

export function validateInput<K extends keyof StateMethodInputs>(
  method: K,
  input: unknown,
): StateMethodInputs[K] {
  const checked = jsonPreflight(input);
  if (!checked.ok)
    throw new StateFailure(checked.code === 'bytes-exceeded' ? 'quota-exceeded' : 'invalid-input');
  const body = object(checked.value);
  switch (method) {
    case 'snapshot':
      keys(body, [], ['messageLimit', 'taskLimit']);
      optional(body, 'messageLimit', (value) => integer(value, 1, 100));
      optional(body, 'taskLimit', (value) => integer(value, 1, 100));
      break;
    case 'events':
      keys(body, ['after', 'epoch'], ['limit']);
      requireValue(integer(body['after'], 0) && id(body['epoch']));
      optional(body, 'limit', (value) => integer(value, 1, 200));
      break;
    case 'acceptMessage':
      keys(body, ['commandId', 'text']);
      requireValue(id(body['commandId']) && text(body['text'], COMPANION_MAX_TEXT));
      break;
    case 'createTask':
      keys(body, ['commandId', 'title', 'code'], ['executionId', 'files', 'outputs', 'timeoutMs']);
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
      keys(body, ['id', 'role', 'text'], ['inputId', 'taskId']);
      requireValue(
        id(body['id']) &&
          ['user', 'assistant', 'notice'].includes(String(body['role'])) &&
          text(body['text'], COMPANION_MAX_TEXT),
      );
      optional(body, 'inputId', (value) => value === null || id(value));
      optional(body, 'taskId', (value) => value === null || id(value));
      break;
    case 'rememberFact':
      keys(body, ['commandId', 'key', 'value'], ['expectedRevision']);
      requireValue(id(body['commandId']) && text(body['key'], 128) && text(body['value'], 2_048));
      optional(body, 'expectedRevision', (value) => integer(value, 0));
      break;
    case 'getTaskByExecution':
      keys(body, ['executionId']);
      requireValue(id(body['executionId']));
      break;
    case 'getTask':
    case 'getArtifact':
      keys(body, ['id']);
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

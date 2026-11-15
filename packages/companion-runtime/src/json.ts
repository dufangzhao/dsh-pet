import { isKernelErrorCode, type JsonValue } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';

export function json(value: unknown): JsonValue {
  const result = jsonPreflight(value);
  if (!result.ok)
    throw new KernelFault(result.code === 'bytes-exceeded' ? 'quota-exceeded' : 'invalid-input');
  return result.value;
}

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One checked provider Result boundary; capability versions define the value type. */
export function payload<T>(value: JsonValue): T {
  const body = object(value);
  if (!body || typeof body['ok'] !== 'boolean') throw new KernelFault('internal');
  if (body['ok'] === false) {
    const error = object(body['error']);
    throw new KernelFault(error && isKernelErrorCode(error['code']) ? error['code'] : 'internal');
  }
  if (!Object.hasOwn(body, 'value')) throw new KernelFault('internal');
  return body['value'] as T;
}

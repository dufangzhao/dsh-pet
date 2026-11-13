import {
  COMPANION_MEMORY_MAX_KEY_UNITS,
  COMPANION_MEMORY_MAX_VALUE_UNITS,
  isCompanionAudience,
  type CompanionProfileSaveCommand,
  type CompanionMemoryUpsertCommand,
  type CompanionMemoryForgetCommand,
  type CompanionFactCommand,
} from '@pet/contracts';
import { json } from './json.js';
import { exactKeys, record, KernelFault } from '@pet/host-kernel';

const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export function profileCommand(input: unknown): CompanionProfileSaveCommand {
  const body = record(json(input));
  if (
    !body ||
    !exactKeys(body, ['expectedProfileRevision', 'name', 'persona']) ||
    !revision(body['expectedProfileRevision']) ||
    typeof body['name'] !== 'string' ||
    typeof body['persona'] !== 'string' ||
    !body['name'].trim() ||
    !body['persona'].trim() ||
    [...body['name']].length > 80 ||
    [...body['persona']].length > 16384
  )
    throw new KernelFault('invalid-input');
  return {
    expectedProfileRevision: body['expectedProfileRevision'],
    name: body['name'],
    persona: body['persona'],
  };
}
export function memoryCommand(input: unknown, forget: true): CompanionMemoryForgetCommand;
export function memoryCommand(input: unknown, forget: false): CompanionMemoryUpsertCommand;
export function memoryCommand(
  input: unknown,
  forget: boolean,
): CompanionMemoryUpsertCommand | CompanionMemoryForgetCommand {
  const body = record(json(input));
  if (
    !body ||
    !exactKeys(body, [
      'commandId',
      'expectedMemoryRevision',
      'expectedFactRevision',
      'key',
      ...(forget ? [] : ['value']),
      ...('audience' in body ? ['audience'] : []),
    ]) ||
    ('audience' in body && !isCompanionAudience(body['audience'])) ||
    !id(body['commandId']) ||
    !revision(body['expectedMemoryRevision']) ||
    !revision(body['expectedFactRevision']) ||
    (forget && body['expectedFactRevision'] === 0) ||
    typeof body['key'] !== 'string' ||
    !body['key'].trim() ||
    body['key'].length > COMPANION_MEMORY_MAX_KEY_UNITS
  )
    throw new KernelFault('invalid-input');
  const base = {
    commandId: body['commandId'],
    expectedMemoryRevision: body['expectedMemoryRevision'],
    expectedFactRevision: body['expectedFactRevision'],
    key: body['key'].trim(),
    ...(isCompanionAudience(body['audience'])
      ? { audience: structuredClone(body['audience']) }
      : {}),
  };
  if (forget) return base;
  if (
    typeof body['value'] !== 'string' ||
    !body['value'].trim() ||
    body['value'].length > COMPANION_MEMORY_MAX_VALUE_UNITS
  )
    throw new KernelFault('invalid-input');
  return { ...base, value: body['value'] };
}
export function legacyMemoryCommand(
  input: unknown,
): (CompanionFactCommand & { expectedRevision?: number }) | null {
  const body = record(json(input));
  if (!body || 'expectedMemoryRevision' in body) return null;
  if (
    !exactKeys(body, [
      'commandId',
      'key',
      'value',
      ...('expectedRevision' in body ? ['expectedRevision'] : []),
    ]) ||
    !id(body['commandId']) ||
    typeof body['key'] !== 'string' ||
    body['key'].length < 1 ||
    body['key'].length > COMPANION_MEMORY_MAX_KEY_UNITS ||
    typeof body['value'] !== 'string' ||
    body['value'].length < 1 ||
    body['value'].length > COMPANION_MEMORY_MAX_VALUE_UNITS ||
    ('expectedRevision' in body && !revision(body['expectedRevision']))
  )
    throw new KernelFault('invalid-input');
  return {
    commandId: body['commandId'],
    key: body['key'],
    value: body['value'],
    ...('expectedRevision' in body ? { expectedRevision: body['expectedRevision'] as number } : {}),
  };
}
/** A finite direct-request boundary; fact selection inside that request remains model-dependent. */
export function memoryCue(text: string): number | null {
  const match = /^\s*(?:(?:请\s*)?(?:记住|记下)|(?:please\s+)?remember\b)\s*/iu.exec(text);
  return match && text.slice(match[0].length).trim() ? match[0].length : null;
}

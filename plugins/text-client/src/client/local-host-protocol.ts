import {
  LOCAL_HOST_QQ_CONTROL_PATH,
  makeError,
  type LocalHostQQSelection,
  type LocalHostQQSelectionCommand,
  type LocalHostQQView,
  type Result,
} from '@pet/contracts';
import { parseKernelError } from './guards.js';
import { requestJson } from './request.js';
import { REQUEST_TIMEOUT_MS, type ClientTransport } from './protocol.js';

/** Only the validated selection receipt leaves this reader; peer/source offers are not projected. */
export type LocalHostSelectionReceipt = Pick<
  LocalHostQQView,
  'revision' | 'selection' | 'phase' | 'error'
>;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function receipt(value: unknown): Result<LocalHostSelectionReceipt> {
  const view = record(value);
  const selected = view && record(view['selection']);
  const invalid = (): Result<never> => ({ ok: false, error: makeError('unavailable', false) });
  if (
    !view ||
    !exact(view, ['revision', 'selection', 'phase', 'peer', 'sources', 'error']) ||
    !Number.isSafeInteger(view['revision']) ||
    typeof view['revision'] !== 'number' ||
    view['revision'] < 0 ||
    !selected ||
    !exact(selected, ['mode', 'hostId']) ||
    !['disabled', 'waiting', 'connected', 'retiring', 'failed'].includes(String(view['phase']))
  )
    return invalid();
  let selection: LocalHostQQSelection;
  if (selected['mode'] === 'service-local' && selected['hostId'] === null)
    selection = { mode: 'service-local', hostId: null };
  else if (
    selected['mode'] === 'remote-host' &&
    typeof selected['hostId'] === 'string' &&
    selected['hostId'].length > 0 &&
    selected['hostId'].length <= 200 &&
    ![...selected['hostId']].some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    selection = { mode: 'remote-host', hostId: selected['hostId'] };
  else return invalid();
  const error = view['error'] === null ? null : parseKernelError(view['error']);
  if (view['error'] !== null && error === null) return invalid();
  return {
    ok: true,
    value: {
      revision: view['revision'],
      selection,
      phase: view['phase'] as LocalHostSelectionReceipt['phase'],
      error,
    },
  };
}
export async function getLocalHostSelection(
  transport: ClientTransport,
  signal: AbortSignal,
): Promise<Result<LocalHostSelectionReceipt>> {
  const result = await requestJson(
    transport,
    LOCAL_HOST_QQ_CONTROL_PATH,
    { method: 'GET', signal },
    REQUEST_TIMEOUT_MS,
  );
  return result.ok ? receipt(result.value) : result;
}
export async function selectLocalHost(
  transport: ClientTransport,
  command: LocalHostQQSelectionCommand,
  signal: AbortSignal,
): Promise<Result<LocalHostSelectionReceipt>> {
  const result = await requestJson(
    transport,
    LOCAL_HOST_QQ_CONTROL_PATH,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    },
    REQUEST_TIMEOUT_MS,
  );
  return result.ok ? receipt(result.value) : result;
}

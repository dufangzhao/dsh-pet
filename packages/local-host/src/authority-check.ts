import {
  LOCAL_HOST_AUTHORITY_CHECK_MAX_MS,
  makeError,
  type JsonValue,
  type LocalHostAuthorityRequest,
  type Result,
} from '@pet/contracts';
import { isRecord } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import type { BridgeChannel } from './bridge-channel.js';

/** One fresh check for one IO. The local deadline must be rechecked synchronously at dispatch. */
export async function checkRemoteAuthority(options: {
  readonly peer: BridgeChannel;
  readonly request: LocalHostAuthorityRequest;
  readonly signal: AbortSignal;
  /** Actual local source/key/permission check, not a received owner/task label. */
  readonly checkLocal: () => void | Promise<void>;
}): Promise<Result<number>> {
  const { peer, request, signal } = options;
  try {
    if (
      request.binding.hostId !== peer.context.hostId ||
      request.binding.hostBootId !== peer.context.bootId ||
      request.binding.bridgeSessionId !== peer.context.sessionId
    )
      throw new KernelFault('stale-owner');
    await options.checkLocal();
    if (signal.aborted || peer.signal.aborted) throw new KernelFault('cancelled');
    const started = performance.now();
    const result = await peer.rpc.request('authority.check', request as unknown as JsonValue, {
      taskId: request.task.taskId,
      signal,
      budgetMs: LOCAL_HOST_AUTHORITY_CHECK_MAX_MS,
    });
    if (!result.ok) return result;
    if (
      !isRecord(result.value) ||
      Object.keys(result.value).join(',') !== 'validForMs' ||
      typeof result.value['validForMs'] !== 'number' ||
      !Number.isSafeInteger(result.value['validForMs']) ||
      result.value['validForMs'] < 1 ||
      result.value['validForMs'] > LOCAL_HOST_AUTHORITY_CHECK_MAX_MS
    )
      throw new KernelFault('invalid-input');
    const deadline = started + result.value['validForMs'];
    await options.checkLocal();
    if (signal.aborted || peer.signal.aborted) throw new KernelFault('cancelled');
    if (performance.now() >= deadline) throw new KernelFault('timeout');
    return { ok: true, value: deadline };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof KernelFault ? error.error : makeError('unavailable', false),
    };
  }
}

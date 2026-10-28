import { makeError, type Result } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { record, exactKeys, KernelFault } from '@pet/host-kernel';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
import type { DemoController } from './demo-controller.js';
export interface DemoRequestSource extends PetRequestSource {
  readonly role: 'pet' | 'console';
}
export type DemoAction =
  | 'snapshot'
  | 'record'
  | 'ready'
  | 'pcm'
  | 'finish'
  | 'captureError'
  | 'cancel'
  | 'send'
  | 'clear'
  | 'key'
  | 'removeKey';
export async function handleDemoRequest(
  source: DemoRequestSource,
  action: DemoAction,
  args: readonly unknown[],
  demo: DemoController,
): Promise<Result<unknown>> {
  const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
    ok: false,
    error: makeError(code, false),
  });
  if (
    !isTrustedPetSource(source) ||
    (source.role !== 'console' && action !== 'snapshot' && action !== 'cancel')
  )
    return fail('permission-denied');
  try {
    if (['snapshot', 'record', 'cancel', 'clear', 'removeKey'].includes(action)) {
      if (args.length !== 0) return fail('invalid-input');
      if (action === 'snapshot') return { ok: true, value: await demo.snapshot() };
      if (action === 'record') return await demo.beginRecording(source.senderId);
      if (action === 'cancel') return { ok: true, value: await demo.cancel() };
      if (action === 'clear') return { ok: true, value: await demo.clearHistory() };
      return { ok: true, value: await demo.removeKey() };
    }
    if (args.length !== (action === 'pcm' ? 2 : 1)) return fail('invalid-input');
    const safe = jsonPreflight(args[0]),
      body = safe.ok ? record(safe.value) : null;
    if (!body) return fail('invalid-input');
    if (action === 'send')
      return exactKeys(body, ['text']) && typeof body['text'] === 'string'
        ? await demo.sendText(body['text'])
        : fail('invalid-input');
    if (action === 'key')
      return exactKeys(body, ['value']) && typeof body['value'] === 'string'
        ? { ok: true, value: await demo.saveKey(body['value']) }
        : fail('invalid-input');
    if (typeof body['token'] !== 'string' || body['token'].length > 128)
      return fail('invalid-input');
    if (action === 'ready')
      return exactKeys(body, ['token', 'sampleRate']) && Number.isSafeInteger(body['sampleRate'])
        ? demo.captureReady(body['token'], source.senderId, body['sampleRate'] as number)
        : fail('invalid-input');
    if (action === 'pcm')
      return exactKeys(body, ['token', 'sequence']) &&
        Number.isSafeInteger(body['sequence']) &&
        args[1] instanceof Uint8Array
        ? demo.pushAudio(body['token'], source.senderId, body['sequence'] as number, args[1])
        : fail('invalid-input');
    if (action === 'finish')
      return exactKeys(body, ['token', 'frames']) && Number.isSafeInteger(body['frames'])
        ? demo.finishRecording(body['token'], source.senderId, body['frames'] as number)
        : fail('invalid-input');
    if (
      !exactKeys(body, ['token', 'reason']) ||
      !['denied', 'missing', 'format', 'failed'].includes(body['reason'] as string)
    )
      return fail('invalid-input');
    return demo.captureFailure(
      body['token'],
      body['reason'] as 'denied' | 'missing' | 'format' | 'failed',
    );
  } catch (error) {
    return fail(error instanceof KernelFault ? error.error.code : 'unavailable');
  }
}

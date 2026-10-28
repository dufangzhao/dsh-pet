import { makeError, type Result, type ApplicationPreferences } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { record, exactKeys, ownerFrom, KernelFault } from '@pet/host-kernel';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
import type { ApplicationController } from './application-controller.js';
export async function handleApplicationRequest(
  source: PetRequestSource,
  action: string,
  args: readonly unknown[],
  controller: ApplicationController,
): Promise<Result<unknown>> {
  const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
    ok: false,
    error: makeError(code, false),
  });
  if (!isTrustedPetSource(source)) return fail('permission-denied');
  try {
    if (action === 'snapshot' || action === 'guide') {
      if (args.length) return fail('invalid-input');
      return action === 'snapshot'
        ? { ok: true, value: await controller.snapshot() }
        : controller.startGuide();
    }
    if (args.length !== 1) return fail('invalid-input');
    const safe = jsonPreflight(args[0]);
    const body = safe.ok ? record(safe.value) : null;
    if (!body) return fail('invalid-input');
    if (action === 'history') {
      if (
        !exactKeys(body, ['limit', ...(Object.hasOwn(body, 'before') ? ['before'] : [])]) ||
        !Number.isSafeInteger(body['limit']) ||
        (body['limit'] as number) < 1 ||
        (body['limit'] as number) > 200 ||
        (body['before'] !== undefined &&
          (!Number.isSafeInteger(body['before']) || (body['before'] as number) < 1))
      )
        return fail('invalid-input');
      return controller.getHistory(body['before'] as number | undefined, body['limit'] as number);
    }
    if (action === 'profile')
      return exactKeys(body, ['data', 'expectedRevision']) &&
        record(body['data']!) &&
        Number.isSafeInteger(body['expectedRevision'])
        ? controller.saveProfile(
            body['expectedRevision'] as number,
            body['data'] as ApplicationPreferences,
          )
        : fail('invalid-input');
    if (action === 'interaction')
      return exactKeys(body, ['kind', 'via']) &&
        ['poke', 'pat', 'drag', 'blush', 'happy'].includes(String(body['kind'])) &&
        ['bubble', 'console'].includes(String(body['via']))
        ? controller.interact(body['kind'] as string, body['via'] as string)
        : fail('invalid-input');
    if (action === 'answer') {
      if (
        !exactKeys(body, [
          'id',
          'step',
          'choice',
          ...(Object.hasOwn(body, 'text') ? ['text'] : []),
        ]) ||
        !['id', 'step', 'choice'].every(
          (k) => typeof body[k] === 'string' && (body[k] as string).length <= 128,
        ) ||
        (body['text'] !== undefined &&
          (typeof body['text'] !== 'string' || body['text'].length > 4096))
      )
        return fail('invalid-input');
      return controller.answer(
        body['id'] as string,
        body['step'] as string,
        body['choice'] as string,
        body['text'] as string | undefined,
      );
    }
    if (action === 'pageAction') {
      const owner = ownerFrom(body['owner']);
      if (
        !owner ||
        !exactKeys(body, ['owner', 'pageId', 'panelId', 'method', 'data']) ||
        !['pageId', 'panelId', 'method'].every(
          (k) => typeof body[k] === 'string' && (body[k] as string).length <= 512,
        )
      )
        return fail('invalid-input');
      return controller.runPageAction(
        owner,
        body['pageId'] as string,
        body['panelId'] as string,
        body['method'] as string,
        body['data']!,
      );
    }
    return fail('invalid-input');
  } catch (error) {
    return fail(error instanceof KernelFault ? error.error.code : 'unavailable');
  }
}

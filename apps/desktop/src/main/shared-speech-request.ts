import {
  isDesktopSpeechReady,
  isDesktopSpeechConsume,
  isDesktopSpeechPlayback,
  isDesktopSpeechReleased,
  isSpeechProviderCommand,
  isSpeechRemoteBinding,
  LOCAL_ID_PATTERN,
  makeError,
  type DesktopSpeechBridge,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record, KernelFault } from '@pet/host-kernel';
import type { DemoRequestSource } from './demo-request.js';
import { isTrustedPetSource } from './ipc-request.js';
import type { SharedSpeechController } from './shared-speech-controller.js';
import type { CompanionSpeechService } from './companion-speech-service.js';
export type DesktopSpeechAction = Exclude<
  keyof DesktopSpeechBridge,
  'version' | 'onChanged' | 'onAudio'
>;
const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
export async function handleDesktopSpeechRequest(
  source: DemoRequestSource,
  frame: object | null,
  action: DesktopSpeechAction,
  args: readonly unknown[],
  controller: Pick<
    SharedSpeechController,
    'getState' | 'stop' | 'playerReady' | 'consume' | 'reportPlayback' | 'reportReleased'
  >,
  service: CompanionSpeechService,
): Promise<Result<unknown>> {
  if (!frame || !isTrustedPetSource(source) || (source.role !== 'pet' && source.role !== 'console'))
    return fail('permission-denied');
  if (action === 'getState')
    return args.length === 0 ? controller.getState() : fail('invalid-input');
  if (args.length !== 1) return fail('invalid-input');
  const checked = jsonPreflight(args[0]);
  const input = checked.ok ? record(checked.value) : null;
  if (!input) return fail('invalid-input');
  try {
    // Exact old Pet frame may release its own resources before any current source/token lookup.
    if (['playerReady', 'consume', 'reportPlayback', 'reportReleased'].includes(action)) {
      if (source.role !== 'pet') return fail('permission-denied');
      switch (action) {
        case 'playerReady':
          return isDesktopSpeechReady(input)
            ? controller.playerReady(input, frame)
            : fail('invalid-input');
        case 'consume':
          return isDesktopSpeechConsume(input)
            ? controller.consume(input, frame)
            : fail('invalid-input');
        case 'reportPlayback':
          return isDesktopSpeechPlayback(input)
            ? controller.reportPlayback(input, frame)
            : fail('invalid-input');
        case 'reportReleased':
          return isDesktopSpeechReleased(input)
            ? controller.reportReleased(input, frame)
            : fail('invalid-input');
      }
    }
    if (
      typeof input['connectionId'] !== 'string' ||
      !new RegExp(LOCAL_ID_PATTERN).test(input['connectionId'])
    )
      return fail('invalid-input');
    const target = { connectionId: input['connectionId'] };
    if (action === 'stop')
      return exactKeys(input, ['connectionId']) ? controller.stop(target) : fail('invalid-input');
    if (source.role !== 'console') return fail('permission-denied');
    if (action === 'readSpeech')
      return exactKeys(input, ['connectionId'])
        ? service.speechSession(target).readSpeech()
        : fail('invalid-input');
    if (action === 'readTtsCatalog') {
      const binding = { providerRef: input['providerRef'], bindingId: input['bindingId'] };
      return exactKeys(input, ['connectionId', 'providerRef', 'bindingId']) &&
        isSpeechRemoteBinding(binding)
        ? service.speechSession(target).catalog(binding)
        : fail('invalid-input');
    }
    if (action === 'saveTtsProvider')
      return exactKeys(input, ['connectionId', 'command']) &&
        isSpeechProviderCommand(input['command'])
        ? service.speechSession(target).saveProvider(input['command'])
        : fail('invalid-input');
    return fail('invalid-input');
  } catch (error) {
    return fail(error instanceof KernelFault ? error.error.code : 'unavailable');
  }
}

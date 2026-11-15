import {
  makeError,
  type DesktopVoiceBridge,
  type Result,
  type VoiceProviderCommand,
  type VoiceSettingsCommand,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record, KernelFault } from '@pet/host-kernel';
import type { DemoRequestSource } from './demo-request.js';
import { isTrustedPetSource } from './ipc-request.js';
import type { CompanionVoiceService } from './companion-voice-service.js';
import type { SharedVoiceController } from './shared-voice-controller.js';
export type DesktopVoiceAction = Exclude<keyof DesktopVoiceBridge, 'version' | 'onChanged'>;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const ref = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 255 &&
  /^[a-z][a-z0-9.-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});

export async function handleDesktopVoiceRequest(
  source: DemoRequestSource,
  frame: object | null,
  action: DesktopVoiceAction,
  args: readonly unknown[],
  controller: SharedVoiceController,
  service: CompanionVoiceService,
): Promise<Result<unknown>> {
  if (!isTrustedPetSource(source) || source.role !== 'console' || !frame)
    return fail('permission-denied');
  if (action === 'getState')
    return args.length === 0 ? controller.getState() : fail('invalid-input');
  if (args.length !== (action === 'pushAudio' ? 2 : 1)) return fail('invalid-input');
  const checked = jsonPreflight(args[0]);
  const body = checked.ok ? record(checked.value) : null;
  if (!body || !id(body['connectionId'])) return fail('invalid-input');
  const target = { connectionId: body['connectionId'] };
  try {
    if (action === 'begin') {
      if (
        !exactKeys(body, [
          'connectionId',
          'captureId',
          'expectedFeatureRevision',
          'providerRef',
          'bindingId',
          'finishMode',
        ]) ||
        !id(body['captureId']) ||
        !integer(body['expectedFeatureRevision']) ||
        !ref(body['providerRef']) ||
        !id(body['bindingId']) ||
        (body['finishMode'] !== 'send' && body['finishMode'] !== 'review')
      )
        return fail('invalid-input');
      return controller.begin(
        {
          ...target,
          captureId: body['captureId'],
          expectedFeatureRevision: body['expectedFeatureRevision'],
          providerRef: body['providerRef'],
          bindingId: body['bindingId'],
          finishMode: body['finishMode'],
        },
        frame,
      );
    }
    // Cleanup ACK must precede any service binding lookup, including after retarget/revoke.
    if (
      [
        'captureReady',
        'pushAudio',
        'finishCapture',
        'cancelCapture',
        'reportCaptureError',
        'reportCaptureReleased',
      ].includes(action)
    ) {
      const extra =
        action === 'captureReady'
          ? ['sampleRate']
          : action === 'pushAudio'
            ? ['sequence']
            : action === 'finishCapture'
              ? ['frames']
              : action === 'reportCaptureError'
                ? ['reason']
                : [];
      if (!exactKeys(body, ['connectionId', 'captureId', ...extra]) || !id(body['captureId']))
        return fail('invalid-input');
      const key = { ...target, captureId: body['captureId'] };
      switch (action) {
        case 'captureReady':
          return body['sampleRate'] === 16000
            ? controller.captureReady(key, frame, body['sampleRate'])
            : fail('audio-format');
        case 'pushAudio':
          return integer(body['sequence']) && args[1] instanceof Uint8Array
            ? controller.pushAudio(key, frame, body['sequence'], args[1])
            : fail('invalid-input');
        case 'finishCapture':
          return integer(body['frames'])
            ? controller.finishCapture(key, frame, body['frames'])
            : fail('invalid-input');
        case 'cancelCapture':
          return controller.cancelCapture(key, frame);
        case 'reportCaptureReleased':
          return controller.reportCaptureReleased(key, frame);
        case 'reportCaptureError': {
          const reason = body['reason'];
          return reason === 'denied' ||
            reason === 'missing' ||
            reason === 'format' ||
            reason === 'failed'
            ? controller.cancelCapture(key, frame, reason)
            : fail('invalid-input');
        }
      }
    }
    if (action === 'readVoice') {
      if (!exactKeys(body, ['connectionId'])) return fail('invalid-input');
      return service.voiceSession(target).readVoice();
    }
    if (action === 'readAsrCatalog') {
      if (
        !exactKeys(body, ['connectionId', 'providerRef', 'bindingId']) ||
        !ref(body['providerRef']) ||
        !id(body['bindingId'])
      )
        return fail('invalid-input');
      return service
        .voiceSession(target)
        .catalog({ providerRef: body['providerRef'], bindingId: body['bindingId'] });
    }
    if (action === 'readCaptureResult') {
      if (
        !exactKeys(body, ['connectionId', 'captureId', 'clientId', 'agentId', 'serviceEpoch']) ||
        !id(body['captureId']) ||
        !id(body['clientId']) ||
        !id(body['agentId']) ||
        !id(body['serviceEpoch'])
      )
        return fail('invalid-input');
      return controller.readCaptureResult(
        {
          ...target,
          captureId: body['captureId'],
          clientId: body['clientId'],
          agentId: body['agentId'],
          serviceEpoch: body['serviceEpoch'],
        },
        frame,
      );
    }
    const command = record(body['command'] ?? null);
    if (!exactKeys(body, ['connectionId', 'command']) || !command) return fail('invalid-input');
    if (action === 'saveVoiceSettings') {
      if (
        !exactKeys(command, ['expectedRevision', 'providerRef', 'finishMode']) ||
        !integer(command['expectedRevision']) ||
        !ref(command['providerRef']) ||
        !['send', 'review'].includes(command['finishMode'] as string)
      )
        return fail('invalid-input');
      return service.voiceSession(target).saveSettings(command as unknown as VoiceSettingsCommand);
    }
    if (action === 'saveAsrProvider') {
      const settings = record(command['settings'] ?? null);
      if (
        !exactKeys(command, ['expectedRevision', 'providerRef', 'settings']) ||
        !integer(command['expectedRevision']) ||
        !ref(command['providerRef']) ||
        !settings ||
        !exactKeys(settings, ['baseUrl', 'modelRef', 'authMode', 'protocol']) ||
        typeof settings['baseUrl'] !== 'string' ||
        settings['baseUrl'].length > 2048 ||
        typeof settings['modelRef'] !== 'string' ||
        settings['modelRef'].length > 255 ||
        !['local-client-id', 'gateway-key'].includes(settings['authMode'] as string) ||
        settings['protocol'] !== 'mimo-native'
      )
        return fail('invalid-input');
      return service.voiceSession(target).saveProvider(command as unknown as VoiceProviderCommand);
    }
    return fail('invalid-input');
  } catch (error) {
    return fail(error instanceof KernelFault ? error.error.code : 'unavailable');
  }
}

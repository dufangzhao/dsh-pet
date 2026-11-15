import {
  isLocalHostConsoleTarget,
  isLocalHostSourceTrustCommand,
  isLocalHostSourcePresetCommand,
  isLocalHostSourceEnabledCommand,
  isLocalHostAgentEnabledCommand,
  isLocalHostSecretTarget,
  isManagedSourceSelector,
  isQQSourceSettingsCommand,
  isQQCredentialCommand,
  makeError,
  type DesktopLocalHostBridge,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record } from '@pet/host-kernel';
import type { DemoRequestSource } from './demo-request.js';
import { isTrustedPetSource } from './ipc-request.js';

export type DesktopLocalHostAction = Exclude<keyof DesktopLocalHostBridge, 'version' | 'onChanged'>;
export type DesktopLocalHostCommands = Pick<DesktopLocalHostBridge, DesktopLocalHostAction>;
const invalid = (code: 'invalid-input' | 'permission-denied'): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** All local process/key management stays behind the exact Console frame and fixed methods. */
export async function handleDesktopLocalHostRequest(
  source: DemoRequestSource,
  action: DesktopLocalHostAction,
  args: readonly unknown[],
  controller: DesktopLocalHostCommands,
): Promise<Result<unknown>> {
  if (source.role !== 'console' || !isTrustedPetSource(source)) return invalid('permission-denied');
  if (action === 'getState' || action === 'start')
    return args.length === 0 ? controller[action]() : invalid('invalid-input');
  if (args.length !== 1) return invalid('invalid-input');
  const checked = jsonPreflight(args[0]);
  const body = checked.ok ? record(checked.value) : null;
  if (!body) return invalid('invalid-input');
  if (action === 'stop')
    return isLocalHostConsoleTarget(body) ? controller.stop(body) : invalid('invalid-input');
  if (action === 'confirmSourceTrust')
    return isLocalHostSourceTrustCommand(body)
      ? controller.confirmSourceTrust(body)
      : invalid('invalid-input');
  if (action === 'setSourcePreset')
    return isLocalHostSourcePresetCommand(body)
      ? controller.setSourcePreset(body)
      : invalid('invalid-input');
  if (action === 'setSourceEnabled')
    return isLocalHostSourceEnabledCommand(body)
      ? controller.setSourceEnabled(body)
      : invalid('invalid-input');
  if (action === 'setAgentEnabled')
    return isLocalHostAgentEnabledCommand(body)
      ? controller.setAgentEnabled(body)
      : invalid('invalid-input');
  const { hostId, bootId, ...command } = body;
  const target = { hostId, bootId };
  if (!isLocalHostConsoleTarget(target)) return invalid('invalid-input');
  if (action === 'reviewSource') {
    if (!exactKeys(command, ['protocol']) || !isManagedSourceSelector(command['protocol']))
      return invalid('invalid-input');
    return controller.reviewSource({ ...target, protocol: command['protocol'] });
  }
  if (action === 'saveSource')
    return isQQSourceSettingsCommand(command)
      ? controller.saveSource({ ...target, ...command })
      : invalid('invalid-input');
  if (action === 'setSourceCredential')
    return isQQCredentialCommand(command)
      ? controller.setSourceCredential({ ...target, ...command })
      : invalid('invalid-input');
  if (action === 'linkCurrentAgent') {
    if (
      !exactKeys(command, ['connectionId', 'expectedRevision', 'expectedCredentialVersion']) ||
      typeof command['connectionId'] !== 'string' ||
      command['connectionId'].length < 1 ||
      command['connectionId'].length > 200 ||
      [...command['connectionId']].some(
        (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      ) ||
      !revision(command['expectedRevision']) ||
      typeof command['expectedCredentialVersion'] !== 'string' ||
      !isLocalHostSecretTarget({
        ...target,
        purpose: 'agent-link',
        expectedRevision: command['expectedRevision'],
        expectedCredentialVersion: command['expectedCredentialVersion'],
      })
    )
      return invalid('invalid-input');
    return controller.linkCurrentAgent({
      ...target,
      connectionId: command['connectionId'],
      expectedRevision: command['expectedRevision'],
      expectedCredentialVersion: command['expectedCredentialVersion'],
    });
  }
  if (action === 'setAgentCredential') {
    if (
      !exactKeys(command, ['expectedRevision', 'expectedCredentialVersion', 'value']) ||
      !revision(command['expectedRevision']) ||
      typeof command['expectedCredentialVersion'] !== 'string' ||
      !isLocalHostSecretTarget({
        ...target,
        purpose: 'agent-link',
        expectedRevision: command['expectedRevision'],
        expectedCredentialVersion: command['expectedCredentialVersion'],
      }) ||
      (command['value'] !== null &&
        (typeof command['value'] !== 'string' ||
          Buffer.byteLength(command['value']) < 24 ||
          Buffer.byteLength(command['value']) > 512 ||
          [...command['value']].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )))
    )
      return invalid('invalid-input');
    return controller.setAgentCredential({
      ...target,
      expectedRevision: command['expectedRevision'],
      expectedCredentialVersion: command['expectedCredentialVersion'],
      value: command['value'],
    });
  }
  return invalid('invalid-input');
}

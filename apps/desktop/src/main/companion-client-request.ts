import { makeError, type DesktopCompanionBridge, type Result } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record } from '@pet/host-kernel';
import { isTrustedPetSource } from './ipc-request.js';
import type { DemoRequestSource } from './demo-request.js';
import type { DesktopCompanionController } from './companion-client-controller.js';
export type DesktopCompanionAction = Exclude<keyof DesktopCompanionBridge, 'version' | 'onChanged'>;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const denied = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});

/** A closed method table, exact current file frames and role checks precede all native I/O. */
export async function handleDesktopCompanionRequest(
  source: DemoRequestSource,
  action: DesktopCompanionAction,
  args: readonly unknown[],
  controller: DesktopCompanionController,
): Promise<Result<unknown>> {
  if (!isTrustedPetSource(source)) return denied('permission-denied');
  if (
    ['connect', 'reconnect', 'disconnect', 'saveModel', 'testModel'].includes(action) &&
    source.role !== 'console'
  )
    return denied('permission-denied');
  if (action === 'getState')
    return args.length === 0 ? controller.getState() : denied('invalid-input');
  if (args.length !== 1) return denied('invalid-input');
  const checked = jsonPreflight(args[0]);
  const body = checked.ok ? record(checked.value) : null;
  if (!body) return denied('invalid-input');
  if (action === 'connect') {
    if (
      !exactKeys(body, ['expectedRevision', 'baseUrl', 'token']) ||
      !revision(body['expectedRevision']) ||
      typeof body['baseUrl'] !== 'string' ||
      typeof body['token'] !== 'string'
    )
      return denied('invalid-input');
    return controller.connect({
      expectedRevision: body['expectedRevision'],
      baseUrl: body['baseUrl'],
      token: body['token'],
    });
  }
  if (!id(body['connectionId'])) return denied('invalid-input');
  const target = { connectionId: body['connectionId'] };
  if (['reconnect', 'disconnect', 'refresh', 'stopForeground', 'readProfile'].includes(action)) {
    if (!exactKeys(body, ['connectionId'])) return denied('invalid-input');
    switch (action) {
      case 'reconnect':
        return controller.reconnect(target);
      case 'disconnect':
        return controller.disconnect(target);
      case 'refresh':
        return controller.refresh(target);
      case 'stopForeground':
        return controller.stopForeground(target);
      case 'readProfile':
        return controller.readProfile(target);
    }
  }
  if (action === 'sendMessage') {
    if (
      !exactKeys(body, ['connectionId', 'commandId', 'text']) ||
      !id(body['commandId']) ||
      typeof body['text'] !== 'string'
    )
      return denied('invalid-input');
    return controller.sendMessage({ ...target, commandId: body['commandId'], text: body['text'] });
  }
  if (action === 'stopTask') {
    if (
      !exactKeys(body, ['connectionId', 'commandId', 'taskId']) ||
      !id(body['commandId']) ||
      !id(body['taskId'])
    )
      return denied('invalid-input');
    return controller.stopTask({ ...target, commandId: body['commandId'], taskId: body['taskId'] });
  }
  if (action === 'readTask') {
    if (!exactKeys(body, ['connectionId', 'taskId']) || !id(body['taskId']))
      return denied('invalid-input');
    return controller.readTask({ ...target, taskId: body['taskId'] });
  }
  if (action === 'saveArtifact') {
    if (!exactKeys(body, ['connectionId', 'artifactId']) || !id(body['artifactId']))
      return denied('invalid-input');
    return controller.saveArtifact({ ...target, artifactId: body['artifactId'] }, source.senderId);
  }
  if (action === 'saveModel' || action === 'testModel') {
    const command = record(body['command'] ?? null);
    if (
      !exactKeys(body, ['connectionId', 'command']) ||
      !command ||
      !id(command['commandId']) ||
      typeof command['connectorId'] !== 'string' ||
      command['connectorId'].length > 255 ||
      !/^[a-z][a-z0-9.-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command['connectorId']) ||
      !revision(command['expectedConfigRevision'])
    )
      return denied('invalid-input');
    if (action === 'testModel') {
      if (
        !exactKeys(command, [
          'commandId',
          'connectorId',
          'expectedConfigRevision',
          'expectedCredentialVersion',
        ]) ||
        typeof command['expectedCredentialVersion'] !== 'string'
      )
        return denied('invalid-input');
      return controller.testModel({
        ...target,
        command: {
          commandId: command['commandId'],
          connectorId: command['connectorId'] as string,
          expectedConfigRevision: command['expectedConfigRevision'],
          expectedCredentialVersion: command['expectedCredentialVersion'],
        },
      });
    }
    if (
      !exactKeys(command, [
        'commandId',
        'expectedProfileRevision',
        'connectorId',
        'expectedConfigRevision',
        'mode',
        ...(Object.hasOwn(command, 'config') ? ['config'] : []),
      ]) ||
      !revision(command['expectedProfileRevision']) ||
      !['scripted', 'model'].includes(command['mode'] as string)
    )
      return denied('invalid-input');
    const config = command['config'] === undefined ? undefined : record(command['config']);
    if (config === null) return denied('invalid-input');
    if (
      config &&
      (!exactKeys(config, ['baseUrl', 'model', 'authMode']) ||
        typeof config['baseUrl'] !== 'string' ||
        typeof config['model'] !== 'string' ||
        !['local-client-id', 'gateway-key'].includes(config['authMode'] as string))
    )
      return denied('invalid-input');
    return controller.saveModel({
      ...target,
      command: {
        commandId: command['commandId'],
        expectedProfileRevision: command['expectedProfileRevision'],
        connectorId: command['connectorId'] as string,
        expectedConfigRevision: command['expectedConfigRevision'],
        mode: command['mode'] as 'model' | 'scripted',
        ...(config ? { config } : {}),
      },
    });
  }
  return denied('invalid-input');
}

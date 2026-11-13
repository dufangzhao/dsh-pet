import {
  COMPANION_TASK_MATERIAL_MAX,
  isCompanionRecordId,
  makeError,
  type JsonValue,
  type Result,
} from '@pet/contracts';
import type { CloudExecConfig, CloudExecutionRequest } from './types.js';

export function validExecutionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

export function safeRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 240 &&
    value.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function parseConfig(value: JsonValue): Result<CloudExecConfig> {
  if (
    !record(value) ||
    !onlyKeys(value, [
      'image',
      'workspaceDirectory',
      'timeoutMs',
      'maxLogBytes',
      'maxArtifactBytes',
      'memoryMb',
      'cpus',
      'pidsLimit',
    ])
  )
    return { ok: false, error: makeError('invalid-input') };
  const config = {
    image: value['image'],
    workspaceDirectory: value['workspaceDirectory'] ?? 'jobs',
    timeoutMs: value['timeoutMs'] ?? 30_000,
    maxLogBytes: value['maxLogBytes'] ?? 4096,
    maxArtifactBytes: value['maxArtifactBytes'] ?? 1_048_576,
    memoryMb: value['memoryMb'] ?? 128,
    cpus: value['cpus'] ?? 0.5,
    pidsLimit: value['pidsLimit'] ?? 32,
  };
  if (
    typeof config.image !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/.test(config.image) ||
    !safeRelativePath(config.workspaceDirectory) ||
    !integer(config.timeoutMs, 100, 300_000) ||
    !integer(config.maxLogBytes, 256, 4096) ||
    !integer(config.maxArtifactBytes, 1024, 8_388_608) ||
    !integer(config.memoryMb, 64, 512) ||
    typeof config.cpus !== 'number' ||
    !Number.isFinite(config.cpus) ||
    config.cpus < 0.1 ||
    config.cpus > 2 ||
    !integer(config.pidsLimit, 16, 64)
  )
    return { ok: false, error: makeError('invalid-input') };
  return { ok: true, value: config as CloudExecConfig };
}

export function parseRequest(
  input: JsonValue,
  config: CloudExecConfig,
): Result<CloudExecutionRequest> {
  if (
    !record(input) ||
    !onlyKeys(input, ['executionId', 'code', 'files', 'materials', 'outputs', 'timeoutMs']) ||
    (input['executionId'] !== undefined && !validExecutionId(input['executionId'])) ||
    typeof input['code'] !== 'string' ||
    !input['code'].trim() ||
    Buffer.byteLength(input['code']) > 16_384 ||
    (input['timeoutMs'] !== undefined && !integer(input['timeoutMs'], 100, config.timeoutMs))
  )
    return { ok: false, error: makeError('invalid-input') };
  const files = input['files'] === undefined ? [] : input['files'];
  const outputs = input['outputs'] === undefined ? [] : input['outputs'];
  if (!Array.isArray(files) || files.length > 16 || !Array.isArray(outputs) || outputs.length > 16)
    return { ok: false, error: makeError('invalid-input') };
  const accepted: CloudExecutionRequest = { code: input['code'] };
  if (typeof input['executionId'] === 'string') accepted.executionId = input['executionId'];
  if (typeof input['timeoutMs'] === 'number') accepted.timeoutMs = input['timeoutMs'];
  if (input['files'] !== undefined) accepted.files = [];
  if (input['outputs'] !== undefined) accepted.outputs = [];
  if (input['materials'] !== undefined) accepted.materials = [];
  let bytes = 0;
  const names = new Set<string>();
  for (const file of files) {
    if (
      !record(file) ||
      !onlyKeys(file, ['path', 'content']) ||
      !safeRelativePath(file['path']) ||
      typeof file['content'] !== 'string' ||
      names.has(file['path'])
    )
      return { ok: false, error: makeError('invalid-input') };
    names.add(file['path']);
    accepted.files?.push({ path: file['path'], content: file['content'] });
    bytes += Buffer.byteLength(file['content']);
  }
  if (bytes > 24_576) return { ok: false, error: makeError('quota-exceeded') };
  const materials = input['materials'] === undefined ? [] : input['materials'];
  if (!Array.isArray(materials) || materials.length > COMPANION_TASK_MATERIAL_MAX)
    return { ok: false, error: makeError('invalid-input') };
  const materialIds = new Set<string>();
  for (const selection of materials) {
    if (
      !record(selection) ||
      !onlyKeys(selection, ['materialId', 'inputName']) ||
      !isCompanionRecordId(selection['materialId']) ||
      !safeRelativePath(selection['inputName']) ||
      materialIds.has(selection['materialId']) ||
      [...names].some(
        (name) =>
          name === selection['inputName'] ||
          name.startsWith(`${selection['inputName']}/`) ||
          (selection['inputName'] as string).startsWith(`${name}/`),
      )
    )
      return { ok: false, error: makeError('invalid-input') };
    materialIds.add(selection['materialId']);
    names.add(selection['inputName']);
    accepted.materials?.push({
      materialId: selection['materialId'],
      inputName: selection['inputName'],
    });
  }
  names.clear();
  for (const output of outputs) {
    if (
      !record(output) ||
      !onlyKeys(output, ['path', 'mediaType']) ||
      !safeRelativePath(output['path']) ||
      names.has(output['path']) ||
      (output['mediaType'] !== undefined &&
        (typeof output['mediaType'] !== 'string' ||
          !/^[a-z0-9.+-]{1,80}\/[a-z0-9.+-]{1,80}$/.test(output['mediaType'])))
    )
      return { ok: false, error: makeError('invalid-input') };
    names.add(output['path']);
    accepted.outputs?.push({
      path: output['path'],
      ...(typeof output['mediaType'] === 'string' ? { mediaType: output['mediaType'] } : {}),
    });
  }
  return { ok: true, value: accepted };
}

import { constants } from 'node:fs';
import { lstat, open, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeError, type JsonValue } from '@pet/contracts';
import { parseConfig, parseRequest, validExecutionId } from './boundary.js';
import { checkedDirectory } from './workspace.js';
import type { CloudExecConfig, CloudExecutionRequest, CloudExecutionResult } from './types.js';

export const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type ExpectedMount = { Type: 'bind'; Source: string; Destination: string; RW: boolean };
export type JobRecord = {
  version: 1;
  executionId: string;
  requestHash: string;
  owner: string;
  taskId: string;
  jobId: string;
  containerName: string;
  containerId: string | null;
  mounts: ExpectedMount[];
  outputs: NonNullable<CloudExecutionRequest['outputs']>;
  config: CloudExecConfig;
  result: CloudExecutionResult | null;
};

export function expectedMounts(root: string, jobId: string): ExpectedMount[] {
  return [
    { Type: 'bind', Source: path.join(root, jobId, 'work'), Destination: '/work', RW: true },
    {
      Type: 'bind',
      Source: path.join(root, jobId, 'code.mjs'),
      Destination: '/job/code.mjs',
      RW: false,
    },
  ];
}

export function unknownResult(jobId: string): CloudExecutionResult {
  return {
    jobId,
    status: 'unknown',
    exitCode: null,
    stdout: '',
    stderr: '',
    logsTruncated: false,
    settled: false,
    artifacts: [],
    error: makeError('unavailable'),
  };
}

async function recordDirectory(root: string): Promise<string> {
  const directory = await checkedDirectory(path.join(root, '.records'), true);
  const info = await lstat(directory);
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    throw new Error('unsafe-records');
  return directory;
}

export async function listRecords(root: string): Promise<string[]> {
  const names = await readdir(await recordDirectory(root));
  const jobs: string[] = [];
  for (const name of names) {
    // A killed atomic write may leave an unpublished temporary file. It cannot authorize Docker work.
    if (/^[a-f0-9-]+\.[a-f0-9-]+\.tmp$/.test(name)) continue;
    if (!name.endsWith('.json') || !JOB_ID.test(name.slice(0, -5)))
      throw new Error('unsafe-records');
    jobs.push(name.slice(0, -5));
  }
  return jobs.sort();
}

/** Host-only atomic checkpoints; neither this directory nor retained artifacts are mounted. */
export async function saveRecord(root: string, record: JobRecord): Promise<void> {
  if (!JOB_ID.test(record.jobId)) throw new Error('unsafe-records');
  const directory = await recordDirectory(root);
  const target = path.join(directory, `${record.jobId}.json`);
  const temporary = path.join(directory, `${record.jobId}.${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(record));
    await file.sync();
  } finally {
    await file.close();
  }
  // Both absolute paths are fixed within the checked private metadata directory.
  if (path.dirname(target) !== directory || path.dirname(temporary) !== directory)
    throw new Error('unsafe-records');
  await rename(temporary, target);
  const parent = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

export async function readRecord(
  root: string,
  jobId: string,
  pluginId: string,
): Promise<JobRecord> {
  if (!JOB_ID.test(jobId)) throw new Error('unsafe-records');
  const directory = await recordDirectory(root);
  const file = await open(
    path.join(directory, `${jobId}.json`),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let record: JobRecord;
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0 ||
      info.size > 65_536
    )
      throw new Error('unsafe-records');
    record = JSON.parse(await file.readFile('utf8')) as JobRecord;
  } finally {
    await file.close();
  }
  const config = parseConfig(record?.config as JsonValue);
  if (
    record?.version !== 1 ||
    record.jobId !== jobId ||
    !JOB_ID.test(jobId) ||
    !validExecutionId(record.executionId) ||
    !validExecutionId(record.taskId) ||
    typeof record.owner !== 'string' ||
    !record.owner.startsWith(`${pluginId}:`) ||
    record.owner.length > 512 ||
    !JOB_ID.test(record.owner.slice(record.owner.lastIndexOf(':') + 1)) ||
    !/^[a-f0-9]{64}$/.test(record.requestHash) ||
    record.containerName !== `pet-cloud-exec-${jobId}` ||
    (record.containerId !== null && !/^[a-f0-9]{64}$/.test(record.containerId)) ||
    !config.ok ||
    JSON.stringify(record.mounts) !== JSON.stringify(expectedMounts(root, jobId)) ||
    !parseRequest(
      { code: 'metadata', outputs: record.outputs },
      config.ok ? config.value : record.config,
    ).ok
  )
    throw new Error('unsafe-records');
  if (
    Object.keys(record).some(
      (key) =>
        ![
          'version',
          'executionId',
          'requestHash',
          'owner',
          'taskId',
          'jobId',
          'containerName',
          'containerId',
          'mounts',
          'outputs',
          'config',
          'result',
        ].includes(key),
    )
  )
    throw new Error('unsafe-records');
  if (!Array.isArray(record.outputs)) throw new Error('unsafe-records');
  if (record.result !== null) validateResult(record);
  return record;
}

function validateResult(record: JobRecord): void {
  const result = record.result;
  if (
    !result ||
    result.jobId !== record.jobId ||
    !['exited', 'cancelled', 'timed-out', 'unknown'].includes(result.status) ||
    (result.exitCode !== null &&
      (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255)) ||
    (result.status === 'exited' && result.exitCode === null) ||
    Object.keys(result).some(
      (key) =>
        ![
          'jobId',
          'status',
          'exitCode',
          'stdout',
          'stderr',
          'logsTruncated',
          'settled',
          'artifacts',
          'error',
        ].includes(key),
    ) ||
    typeof result.stdout !== 'string' ||
    typeof result.stderr !== 'string' ||
    Buffer.byteLength(result.stdout + result.stderr) > record.config.maxLogBytes ||
    typeof result.logsTruncated !== 'boolean' ||
    typeof result.settled !== 'boolean' ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length > record.outputs.length ||
    (result.error !== null &&
      (!['unavailable', 'invalid-input'].includes(result.error?.code) ||
        result.error.messageKey !== `errors.${result.error.code}` ||
        typeof result.error.retryable !== 'boolean' ||
        Object.keys(result.error).some(
          (key) => !['code', 'messageKey', 'retryable'].includes(key),
        )))
  )
    throw new Error('unsafe-receipt');
  let bytes = 0;
  const names = new Set<string>();
  for (const artifact of result.artifacts) {
    const output = record.outputs.find((candidate) => candidate.path === artifact.path);
    if (
      !output ||
      names.has(artifact.path) ||
      artifact.relativePath !== `${record.jobId}/artifacts/${output.path}` ||
      Object.keys(artifact).some(
        (key) => !['path', 'relativePath', 'mediaType', 'sizeBytes'].includes(key),
      ) ||
      artifact.mediaType !== (output.mediaType ?? 'application/octet-stream') ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0
    )
      throw new Error('unsafe-receipt');
    names.add(artifact.path);
    bytes += artifact.sizeBytes;
  }
  if (bytes > record.config.maxArtifactBytes) throw new Error('unsafe-receipt');
}

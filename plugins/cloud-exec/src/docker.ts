import { spawn } from 'node:child_process';
import type { JobRecord } from './records.js';

export type DockerReply = {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  failed: boolean;
};

/** Docker is the only host executable. Arguments never pass through a shell. */
export function docker(args: string[], timeoutMs = 10_000, maxBytes = 4096): Promise<DockerReply> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let failed = false;
    const capture = (target: Buffer[], chunk: Buffer): void => {
      const remaining = Math.max(0, maxBytes - bytes);
      if (remaining > 0) target.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += Math.min(remaining, chunk.length);
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.on('error', () => {
      failed = true;
    });
    const timer = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let remaining = maxBytes;
      const text = (chunks: Buffer[]): string => {
        // Invalid UTF-8 expands during replacement; enforce the returned text budget too.
        const encoded = Buffer.from(Buffer.concat(chunks).toString('utf8'));
        if (encoded.length > remaining) truncated = true;
        const value = new TextDecoder().decode(encoded.subarray(0, remaining), { stream: true });
        remaining -= Buffer.byteLength(value);
        return value;
      };
      const out = text(stdout);
      const err = text(stderr);
      resolve({ code, stdout: out, stderr: err, truncated, failed });
    });
  });
}

export type ContainerState = {
  id: string;
  name: string;
  owner: string;
  job: string;
  execution: string;
  task: string;
  mounts: Array<{
    Type: string;
    Source: string;
    Destination: string;
    RW: boolean;
    Propagation: string;
  }>;
  state: { Running: boolean; Status: string; ExitCode: number };
};

export type ContainerInspection =
  { kind: 'owned'; container: ContainerState } | { kind: 'absent' } | { kind: 'unsafe' };

const INSPECT =
  '{"id":{{json .Id}},"name":{{json .Name}},"owner":{{json (index .Config.Labels "pet.cloud-exec.owner")}},"job":{{json (index .Config.Labels "pet.cloud-exec.job")}},"execution":{{json (index .Config.Labels "pet.cloud-exec.execution")}},"task":{{json (index .Config.Labels "pet.cloud-exec.task")}},"mounts":{{json .Mounts}},"state":{{json .State}}}';

/** A name locates a candidate; only its verified full ID can authorize a mutation. */
export async function inspectOwned(record: JobRecord): Promise<ContainerInspection> {
  const reply = await docker(
    ['container', 'inspect', '--format', INSPECT, record.containerId ?? record.containerName],
    10_000,
    16_384,
  );
  if (reply.failed || reply.truncated) return { kind: 'unsafe' };
  if (reply.code !== 0) {
    if (!/No such (object|container):/.test(reply.stderr)) return { kind: 'unsafe' };
    const listed = await docker([
      'ps',
      '-a',
      '--no-trunc',
      '--filter',
      `name=^/${record.containerName}$`,
      '--format',
      '{{.ID}}',
    ]);
    return !listed.failed && listed.code === 0 && !listed.truncated && !listed.stdout.trim()
      ? { kind: 'absent' }
      : { kind: 'unsafe' };
  }
  try {
    const container = JSON.parse(reply.stdout) as ContainerState;
    if (
      !/^[a-f0-9]{64}$/.test(container.id) ||
      (record.containerId !== null && container.id !== record.containerId) ||
      container.name !== `/${record.containerName}` ||
      container.owner !== record.owner ||
      container.job !== record.jobId ||
      container.execution !== record.executionId ||
      container.task !== record.taskId ||
      typeof container.state?.Running !== 'boolean' ||
      typeof container.state.Status !== 'string' ||
      !Number.isInteger(container.state.ExitCode) ||
      !Array.isArray(container.mounts) ||
      container.mounts.length !== record.mounts.length ||
      !record.mounts.every((expected) =>
        container.mounts.some(
          (mount) =>
            mount.Type === expected.Type &&
            mount.Source === expected.Source &&
            mount.Destination === expected.Destination &&
            mount.RW === expected.RW &&
            mount.Propagation === 'rprivate',
        ),
      )
    )
      return { kind: 'unsafe' };
    return { kind: 'owned', container };
  } catch {
    return { kind: 'unsafe' };
  }
}

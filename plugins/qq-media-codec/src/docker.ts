import { spawn } from 'node:child_process';

export type DockerReply = {
  code: number | null;
  stdout: string;
  stderr: string;
  failed: boolean;
  truncated: boolean;
};
/** Fixed local daemon and executable, no inherited account/Docker/Node environment. */
export function codecDocker(
  configDirectory: string,
  args: readonly string[],
  timeoutMs = 10_000,
): Promise<DockerReply> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
      shell: false,
      env: { PATH: '/usr/bin:/bin', HOME: configDirectory, DOCKER_CONFIG: configDirectory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    let bytes = 0,
      truncated = false,
      failed = false;
    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, 32 * 1024 - bytes);
      if (chunk.length > remaining) truncated = true;
      output.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += Math.min(chunk.length, remaining);
    });
    const errors: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, 32 * 1024 - bytes);
      if (chunk.length > remaining) truncated = true;
      errors.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += Math.min(chunk.length, remaining);
    });
    child.once('error', () => {
      failed = true;
    });
    const timeout = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        stdout: Buffer.concat(output).toString('utf8'),
        stderr: Buffer.concat(errors).toString('utf8'),
        failed,
        truncated,
      });
    });
  });
}

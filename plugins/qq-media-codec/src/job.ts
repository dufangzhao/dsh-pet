import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, open, readFile, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  COMPANION_VOICE_ATTACHMENT_MAX_MS,
  COMPANION_VOICE_ATTACHMENT_MAX_SPANS,
  VOICE_SAMPLE_RATE,
  VOICE_MAX_SAMPLES,
  SPEECH_FORMAT,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { codecDocker } from './docker.js';

export type CodecImagePin = { readonly imageId: string; readonly manifestSha256: string };
export type CodecOutput = {
  readonly encoding: 'pcm-f32le' | 'tencent-silk-v3';
  readonly sampleRate: number;
  readonly channels: 1;
  readonly frames: number;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly spans: readonly { readonly startFrame: number; readonly frames: number }[];
};
export type CodecJobReceipt = {
  readonly id: string;
  readonly mode: 'decode' | 'encode';
  readonly containerId: string | null;
  readonly imageId: string;
  readonly exitCode: number | null;
  readonly oomKilled: boolean;
  readonly stopped: boolean;
  readonly removed: boolean;
  readonly workspaceRemoved: boolean;
  readonly inputBytes: number;
  readonly output: CodecOutput | null;
  /** Host-only infrastructure diagnostics, never forwarded into public source errors. */
  readonly diagnostic: string | null;
};
type Job = {
  id: string;
  mode: 'decode' | 'encode';
  name: string;
  directory: string;
  input: string;
  output: string;
  containerId: string | null;
  abort: AbortController;
  done: Promise<void>;
  resolve: () => void;
};
type Inspection = {
  Id: string;
  Image: string;
  Name: string;
  owner: string;
  job: string;
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
  State: { Running: boolean; Pid: number; ExitCode: number; OOMKilled: boolean; Status: string };
  HostConfig: {
    NetworkMode: string;
    ReadonlyRootfs: boolean;
    Memory: number;
    MemorySwap: number;
    PidsLimit: number;
    NanoCpus: number;
    Privileged: boolean;
  };
};
const INSPECT =
  '{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"owner":{{json (index .Config.Labels "pet.qq-codec.owner")}},"job":{{json (index .Config.Labels "pet.qq-codec.job")}},"Mounts":{{json .Mounts}},"State":{{json .State}},"HostConfig":{{json .HostConfig}}}';
const MEMORY = 512 * 1024 * 1024;
const OUTPUT_BYTES = 8 * 1024 * 1024;
const TIMEOUT = 60_000;
const ID = /^sha256:[a-f0-9]{64}$/;
type CodecRunnerOptions = {
  directory: string;
  pin: CodecImagePin;
  observe?: (receipt: CodecJobReceipt) => void;
  onStarted?: (state: { id: string; containerId: string; pid: number }) => void;
  sourceSignal?: AbortSignal;
  memoryBytes?: number;
  cpus?: number;
  fileBytes?: number;
};

/** A purpose-owned fixed container job; no code, command, URL or host path comes from platform input. */
export class CodecDockerRunner {
  private readonly owner = randomUUID();
  private readonly jobs = new Map<string, Job>();
  private readonly directory: string;
  private readonly configDirectory: string;
  private closed = false;
  private cleanupFailed = false;
  private constructor(private readonly options: CodecRunnerOptions) {
    this.directory = path.resolve(options.directory, 'codec-jobs');
    this.configDirectory = path.join(this.directory, 'docker-config');
  }
  static async create(options: CodecRunnerOptions): Promise<CodecDockerRunner> {
    if (!ID.test(options.pin.imageId) || !/^[a-f0-9]{64}$/.test(options.pin.manifestSha256))
      throw new KernelFault('invalid-input');
    if (
      (options.memoryBytes !== undefined &&
        (!Number.isSafeInteger(options.memoryBytes) ||
          options.memoryBytes < 16 * 1024 * 1024 ||
          options.memoryBytes > MEMORY)) ||
      (options.cpus !== undefined &&
        (!Number.isFinite(options.cpus) || options.cpus < 0.1 || options.cpus > 1)) ||
      (options.fileBytes !== undefined &&
        (!Number.isSafeInteger(options.fileBytes) ||
          options.fileBytes < 1024 ||
          options.fileBytes > OUTPUT_BYTES))
    )
      throw new KernelFault('invalid-input');
    const runner = new CodecDockerRunner(options);
    await mkdir(runner.configDirectory, { recursive: true, mode: 0o700 });
    if ((await realpath(runner.directory)) !== runner.directory)
      throw new KernelFault('permission-denied');
    const image = await codecDocker(runner.configDirectory, [
      'image',
      'inspect',
      '--format',
      '{"Id":{{json .Id}},"Volumes":{{json (index .Config "Volumes")}},"manifest":{{json (index .Config.Labels "pet.qq-codec.manifest")}},"entrypoint":{{json .Config.Entrypoint}}}',
      options.pin.imageId,
    ]);
    if (image.failed || image.truncated || image.code !== 0) throw new KernelFault('not-ready');
    const value = JSON.parse(image.stdout) as {
      Id?: unknown;
      Volumes?: unknown;
      manifest?: unknown;
      entrypoint?: unknown;
    };
    if (
      value.Id !== options.pin.imageId ||
      value.manifest !== options.pin.manifestSha256 ||
      JSON.stringify(value.entrypoint) !==
        JSON.stringify([
          '/usr/bin/env',
          '-i',
          'LANG=C',
          'HOME=/tmp',
          'UV_THREADPOOL_SIZE=1',
          '/usr/local/bin/node',
          '--max-old-space-size=128',
          '--v8-pool-size=1',
          '/codec/job-runner.mjs',
        ]) ||
      (value.Volumes !== null && JSON.stringify(value.Volumes) !== '{}')
    )
      throw new KernelFault('not-ready');
    return runner;
  }
  get activeJobs(): number {
    return this.jobs.size;
  }
  get reusable(): boolean {
    return !this.closed && !this.cleanupFailed && !this.options.sourceSignal?.aborted;
  }
  decode<T>(
    input: AsyncIterable<Uint8Array>,
    consume: (
      output: CodecOutput,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return this.run('decode', input, consume, signal);
  }
  encode<T>(
    input: AsyncIterable<Uint8Array>,
    consume: (
      output: CodecOutput,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return this.run('encode', input, consume, signal);
  }
  private async inspect(job: Job): Promise<Inspection | null> {
    const reply = await codecDocker(this.configDirectory, [
      'container',
      'inspect',
      '--format',
      INSPECT,
      job.containerId ?? job.name,
    ]);
    if (reply.failed || reply.truncated || reply.code !== 0) return null;
    let value: Inspection;
    try {
      value = JSON.parse(reply.stdout) as Inspection;
    } catch {
      return null;
    }
    const memory = this.options.memoryBytes ?? MEMORY;
    if (
      !/^[a-f0-9]{64}$/.test(value.Id) ||
      (job.containerId && value.Id !== job.containerId) ||
      value.Image !== this.options.pin.imageId ||
      value.Name !== '/' + job.name ||
      value.owner !== this.owner ||
      value.job !== job.id ||
      !Array.isArray(value.Mounts) ||
      value.Mounts.length !== 2 ||
      !value.Mounts.some(
        (m) => m.Type === 'bind' && m.Source === job.input && m.Destination === '/input' && !m.RW,
      ) ||
      !value.Mounts.some(
        (m) => m.Type === 'bind' && m.Source === job.output && m.Destination === '/output' && m.RW,
      ) ||
      value.HostConfig.NetworkMode !== 'none' ||
      !value.HostConfig.ReadonlyRootfs ||
      value.HostConfig.Privileged ||
      value.HostConfig.Memory !== memory ||
      value.HostConfig.MemorySwap !== memory ||
      value.HostConfig.PidsLimit !== 32 ||
      value.HostConfig.NanoCpus !== Math.round((this.options.cpus ?? 1) * 1e9) ||
      typeof value.State.Running !== 'boolean' ||
      !Number.isSafeInteger(value.State.Pid) ||
      !Number.isSafeInteger(value.State.ExitCode)
    )
      return null;
    return value;
  }
  private async stop(job: Job): Promise<Inspection> {
    let inspected = await this.inspect(job);
    if (!inspected) throw new KernelFault('unavailable');
    if (inspected.State.Running) {
      await codecDocker(this.configDirectory, ['stop', '--time', '1', inspected.Id]);
      inspected = await this.inspect(job);
      if (!inspected) throw new KernelFault('unavailable');
      if (inspected.State.Running) {
        await codecDocker(this.configDirectory, ['kill', '--signal', 'KILL', inspected.Id]);
        inspected = await this.inspect(job);
      }
    }
    if (!inspected || inspected.State.Running || inspected.State.Pid !== 0)
      throw new KernelFault('unavailable');
    return inspected;
  }
  private async remove(job: Job): Promise<boolean> {
    const inspected = await this.stop(job);
    const removed = await codecDocker(this.configDirectory, ['rm', inspected.Id]);
    if (removed.failed || removed.code !== 0) return false;
    const remaining = await codecDocker(this.configDirectory, [
      'ps',
      '-a',
      '--no-trunc',
      '--filter',
      `name=^/${job.name}$`,
      '--format',
      '{{.ID}}',
    ]);
    return (
      !remaining.failed && !remaining.truncated && remaining.code === 0 && !remaining.stdout.trim()
    );
  }
  private async run<T>(
    mode: 'decode' | 'encode',
    input: AsyncIterable<Uint8Array>,
    consume: (
      output: CodecOutput,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (!this.reusable) throw new KernelFault('not-ready');
    if (this.jobs.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      throw new KernelFault('quota-exceeded');
    signal.throwIfAborted();
    const id = randomUUID();
    const directory = path.join(this.directory, id);
    let resolve = () => {};
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    const job: Job = {
      id,
      mode,
      name: `pet-qq-codec-${id}`,
      directory,
      input: path.join(directory, 'input'),
      output: path.join(directory, 'output'),
      containerId: null,
      abort: new AbortController(),
      done,
      resolve,
    };
    this.jobs.set(id, job);
    const combined = AbortSignal.any([
      signal,
      job.abort.signal,
      ...(this.options.sourceSignal ? [this.options.sourceSignal] : []),
    ]);
    let timedOut = false,
      created = false,
      exitCode: number | null = null,
      stopped = false,
      removed = false,
      workspaceRemoved = false,
      oomKilled = false;
    let output: CodecOutput | null = null,
      inputBytes = 0;
    let diagnostic: string | null = null;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    let interrupted = () => {};
    const interruption = new Promise<void>((r) => {
      interrupted = r;
    });
    const onAbort = (): void => interrupted();
    combined.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      job.abort.abort();
    }, TIMEOUT);
    try {
      await mkdir(job.input, { recursive: true, mode: 0o755 });
      await mkdir(job.output, { mode: 0o777 });
      const handle = await open(path.join(job.input, 'input.bin'), 'wx', 0o444);
      try {
        for await (const chunk of input) {
          combined.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw new KernelFault('invalid-input');
          inputBytes += chunk.byteLength;
          if (inputBytes > COMPANION_MATERIAL_INPUT_MAX_BYTES)
            throw new KernelFault('quota-exceeded');
          await handle.writeFile(chunk);
        }
      } finally {
        await handle.close();
      }
      if (!inputBytes) throw new KernelFault('audio-format');
      combined.throwIfAborted();
      // The input ends before creation; only these two owned directories enter the container.
      const memory = this.options.memoryBytes ?? MEMORY;
      const user = process.getuid?.() || 65534,
        group = process.getuid?.() ? (process.getgid?.() ?? 65534) : 65534;
      const result = await codecDocker(this.configDirectory, [
        'create',
        '--pull',
        'never',
        '--name',
        job.name,
        '--label',
        `pet.qq-codec.owner=${this.owner}`,
        '--label',
        `pet.qq-codec.job=${job.id}`,
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges=true',
        '--user',
        `${user}:${group}`,
        '--memory',
        String(memory),
        '--memory-swap',
        String(memory),
        '--cpus',
        String(this.options.cpus ?? 1),
        '--pids-limit',
        '32',
        '--ulimit',
        'nofile=64:64',
        '--ulimit',
        `fsize=${this.options.fileBytes ?? OUTPUT_BYTES}:${this.options.fileBytes ?? OUTPUT_BYTES}`,
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,noexec,size=16m',
        '--log-driver',
        'local',
        '--log-opt',
        'max-size=16k',
        '--log-opt',
        'max-file=1',
        '--log-opt',
        'compress=false',
        '--mount',
        `type=bind,source=${job.input},target=/input,readonly,bind-propagation=rprivate`,
        '--mount',
        `type=bind,source=${job.output},target=/output,bind-propagation=rprivate`,
        this.options.pin.imageId,
        mode,
      ]);
      // Even an uncertain create is located by a unique owned name, never blindly repeated.
      const inspected = await this.inspect(job);
      if (!inspected) {
        if (result.code === 0 || result.failed) {
          created = true;
          this.cleanupFailed = true;
        }
        throw new KernelFault('unavailable');
      }
      created = true;
      job.containerId = inspected.Id;
      combined.throwIfAborted();
      const started = await codecDocker(this.configDirectory, ['start', job.containerId]);
      if (started.failed || started.code !== 0) {
        diagnostic = started.stderr.slice(0, 2048);
        throw new KernelFault('unavailable');
      }
      const running = await this.inspect(job);
      if (!running) throw new KernelFault('unavailable');
      if (running.State.Running && running.State.Pid > 0)
        this.options.onStarted?.({ id: job.id, containerId: running.Id, pid: running.State.Pid });
      const waiting = codecDocker(
        this.configDirectory,
        ['wait', job.containerId],
        TIMEOUT + 20_000,
      );
      await Promise.race([waiting, interruption]);
      if (combined.aborted) await this.stop(job);
      await waiting;
      const final = await this.stop(job);
      stopped = true;
      exitCode = final.State.ExitCode;
      oomKilled = final.State.OOMKilled;
      // The codec deadline ends at actual process exit; a scoped six-span ASR consumer has its own lifetime.
      clearTimeout(timer);
      if (combined.aborted) throw new KernelFault(timedOut ? 'timeout' : 'cancelled');
      if (oomKilled || exitCode === 153) throw new KernelFault('quota-exceeded');
      const metadataPath = path.join(job.output, 'result.json');
      const metadataStat = await lstat(metadataPath);
      if (
        !metadataStat.isFile() ||
        metadataStat.isSymbolicLink() ||
        metadataStat.nlink !== 1 ||
        metadataStat.size > 4096
      )
        throw new KernelFault('audio-format');
      const metadata: unknown = JSON.parse(await readFile(metadataPath, 'utf8'));
      output = await this.verifyOutput(job, metadata, inputBytes);
      if (exitCode !== 0) throw new KernelFault('audio-format');
      let complete = false;
      const bytes: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of createReadStream(path.join(job.output, 'audio.bin'))) {
            combined.throwIfAborted();
            yield new Uint8Array(chunk);
          }
          complete = true;
        },
      };
      const value = await consume(output, bytes, combined);
      combined.throwIfAborted();
      if (!complete) throw new KernelFault('invalid-input');
      outcome = { ok: true, value };
    } catch (error) {
      outcome = {
        ok: false,
        error: combined.aborted ? new KernelFault(timedOut ? 'timeout' : 'cancelled') : error,
      };
    }
    clearTimeout(timer);
    combined.removeEventListener('abort', onAbort);
    try {
      if (created) {
        const final = await this.stop(job);
        stopped = true;
        exitCode = final.State.ExitCode;
        oomKilled = final.State.OOMKilled;
        removed = await this.remove(job);
        if (!removed) throw new KernelFault('unavailable');
      }
      if (
        path.dirname(job.directory) !== this.directory ||
        (await realpath(job.directory)) !== job.directory
      )
        throw new KernelFault('permission-denied');
      await rm(job.directory, { recursive: true });
      workspaceRemoved = true;
      this.jobs.delete(job.id);
    } catch {
      this.cleanupFailed = true;
    } finally {
      job.resolve();
      this.options.observe?.({
        id,
        mode,
        containerId: job.containerId,
        imageId: this.options.pin.imageId,
        exitCode,
        oomKilled,
        stopped,
        removed,
        workspaceRemoved,
        inputBytes,
        output,
        diagnostic,
      });
    }
    if (!workspaceRemoved) this.cleanupFailed = true;
    if (!workspaceRemoved) throw new KernelFault('unavailable');
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  private async verifyOutput(job: Job, value: unknown, inputBytes: number): Promise<CodecOutput> {
    const v = value as Record<string, unknown> | null;
    if (!v || v['version'] !== 1 || v['ok'] !== true)
      throw new KernelFault(v?.['code'] === 'budget' ? 'quota-exceeded' : 'audio-format');
    const rate = job.mode === 'decode' ? VOICE_SAMPLE_RATE : SPEECH_FORMAT.sampleRate;
    const frames = v['frames'];
    if (
      v['sampleRate'] !== rate ||
      v['channels'] !== 1 ||
      typeof frames !== 'number' ||
      !Number.isSafeInteger(frames) ||
      frames < 1 ||
      frames > (rate * COMPANION_VOICE_ATTACHMENT_MAX_MS) / 1000 ||
      v['durationMs'] !== Math.ceil((frames * 1000) / rate) ||
      typeof v['sha256'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(v['sha256'])
    )
      throw new KernelFault('audio-format');
    const file = path.join(job.output, 'audio.bin');
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > OUTPUT_BYTES ||
      info.size !== v['sizeBytes']
    )
      throw new KernelFault('audio-format');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
      if (job.mode === 'decode') {
        if (chunk.length % 4) throw new KernelFault('audio-format');
        for (let at = 0; at < chunk.length; at += 4) {
          const sample = chunk.readFloatLE(at);
          if (!Number.isFinite(sample) || sample < -1 || sample > 1)
            throw new KernelFault('audio-format');
        }
      }
    }
    if (hash.digest('hex') !== v['sha256']) throw new KernelFault('audio-format');
    const spans: { startFrame: number; frames: number }[] = [];
    if (job.mode === 'decode') {
      if (v['encoding'] !== 'pcm-f32le' || info.size !== frames * 4)
        throw new KernelFault('audio-format');
      for (let at = 0; at < frames; at += VOICE_MAX_SAMPLES)
        spans.push({ startFrame: at, frames: Math.min(VOICE_MAX_SAMPLES, frames - at) });
      if (
        spans.length > COMPANION_VOICE_ATTACHMENT_MAX_SPANS ||
        JSON.stringify(v['spans']) !== JSON.stringify(spans)
      )
        throw new KernelFault('audio-format');
    } else {
      if (
        v['encoding'] !== 'tencent-silk-v3' ||
        v['sourceFrames'] !== inputBytes / 2 ||
        frames < inputBytes / 2 ||
        frames - inputBytes / 2 >= rate / 50
      )
        throw new KernelFault('audio-format');
      const header = await open(file, 'r');
      try {
        const bytes = Buffer.alloc(10);
        await header.read(bytes);
        if (!bytes.equals(Buffer.from('\x02#!SILK_V3'))) throw new KernelFault('audio-format');
      } finally {
        await header.close();
      }
    }
    return {
      encoding: job.mode === 'decode' ? 'pcm-f32le' : 'tencent-silk-v3',
      sampleRate: rate,
      channels: 1,
      frames,
      durationMs: Math.ceil((frames * 1000) / rate),
      sizeBytes: info.size,
      sha256: v['sha256'],
      spans,
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) job.abort.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    if (this.cleanupFailed || this.jobs.size) throw new KernelFault('unavailable');
  }
}

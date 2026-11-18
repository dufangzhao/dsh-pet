import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { makeError, type JsonValue, type OwnerRef, type Result } from '@pet/contracts';
import type { PluginTask } from '@pet/plugin-sdk';
import { parseConfig, parseRequest, validExecutionId } from './boundary.js';
import { docker, inspectOwned, type ContainerInspection } from './docker.js';
import {
  expectedMounts,
  JOB_ID,
  listRecords,
  readRecord,
  saveRecord,
  unknownResult,
  type JobRecord,
} from './records.js';
import { createWorkspace, retainArtifacts } from './workspace.js';
import { MaterialInputFailure, stageMaterials } from './materials.js';
import type {
  CloudExecConfig,
  CloudMaterialReader,
  CloudExecutionRequest,
  CloudExecutionResult,
  CloudReconcileRequest,
  CloudReconcileResult,
} from './types.js';

export type DockerExecutorOptions = {
  workspaceRoot: string;
  config: CloudExecConfig;
  owner: OwnerRef;
  signal?: AbortSignal;
  readMaterial?: CloudMaterialReader;
};

type Admission =
  { kind: 'new'; record: JobRecord } | { kind: 'receipt'; result: CloudExecutionResult };

export class DockerExecutor {
  readonly #config: CloudExecConfig;
  readonly #root: string;
  readonly #readMaterial: CloudMaterialReader | undefined;
  readonly #pluginId: string;
  readonly #owner: string;
  readonly #lifetime = new AbortController();
  readonly #signal: AbortSignal;
  readonly #active = new Set<Promise<unknown>>();
  readonly #running = new Map<
    string,
    { hash: string; pending: Promise<Result<CloudExecutionResult>> }
  >();
  readonly #activeJobs = new Set<string>();
  readonly #records = new Map<string, JobRecord>();
  readonly #checked = new Set<string>();
  #serial: Promise<void> = Promise.resolve();

  constructor(options: DockerExecutorOptions) {
    const checked = parseConfig(options.config);
    if (
      !checked.ok ||
      !path.isAbsolute(options.workspaceRoot) ||
      /[,\r\n\0]/.test(options.workspaceRoot)
    )
      throw new Error('invalid-executor-config');
    this.#config = checked.value;
    this.#root = path.resolve(options.workspaceRoot);
    this.#readMaterial = options.readMaterial;
    this.#pluginId = options.owner.pluginId;
    this.#owner = `${options.owner.pluginId}:${options.owner.instanceId}:${options.owner.generation}:${randomUUID()}`;
    this.#signal = AbortSignal.any([
      this.#lifetime.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
  }

  execute(task: PluginTask, input: JsonValue): Promise<Result<CloudExecutionResult>> {
    if (this.#signal.aborted) return Promise.resolve({ ok: false, error: makeError('not-ready') });
    const parsed = parseRequest(input, this.#config);
    if (!parsed.ok) return Promise.resolve(parsed);
    const executionId = parsed.value.executionId ?? task.taskId;
    if (!validExecutionId(executionId) || !validExecutionId(task.taskId))
      return Promise.resolve({ ok: false, error: makeError('invalid-input') });
    const request = parsed.value;
    if (request.materials?.length && !this.#readMaterial)
      return Promise.resolve({ ok: false, error: makeError('unavailable') });
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          code: request.code,
          files: (request.files ?? []).map(({ path, content }) => ({ path, content })),
          outputs: (request.outputs ?? []).map(({ path, mediaType }) => ({
            path,
            mediaType: mediaType ?? 'application/octet-stream',
          })),
          timeoutMs: request.timeoutMs ?? null,
          // Omit absent/empty selections to preserve every pre-material execution fingerprint.
          ...(request.materials?.length
            ? {
                materials: request.materials.map(({ materialId, inputName }) => ({
                  materialId,
                  inputName,
                })),
              }
            : {}),
        }),
      )
      .digest('hex');
    const running = this.#running.get(executionId);
    if (running)
      return running.hash === hash
        ? running.pending
        : Promise.resolve({ ok: false, error: makeError('conflict') });
    if (this.#running.size >= 4)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded') });
    const pending = this.#execute(task, request, executionId, hash);
    this.#running.set(executionId, { hash, pending });
    this.#track(pending, () => this.#running.delete(executionId));
    return pending;
  }

  reconcile(input: CloudReconcileRequest = {}): Promise<Result<CloudReconcileResult>> {
    if (this.#signal.aborted) return Promise.resolve({ ok: false, error: makeError('not-ready') });
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['after', 'limit'].includes(key)) ||
      (input.after !== undefined &&
        (typeof input.after !== 'string' || !JOB_ID.test(input.after))) ||
      (input.limit !== undefined &&
        (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 8))
    )
      return Promise.resolve({ ok: false, error: makeError('invalid-input') });
    const pending = this.#locked(() => this.#reconcile(input));
    this.#track(pending);
    return pending;
  }

  async close(): Promise<void> {
    this.#lifetime.abort();
    await Promise.all([...this.#active]);
    if ([...this.#records.values()].some((record) => !record.result?.settled))
      throw new Error('container-cleanup-incomplete');
  }

  #track(pending: Promise<unknown>, done: () => void = () => {}): void {
    this.#active.add(pending);
    const settled = (): void => {
      this.#active.delete(pending);
      done();
    };
    void pending.then(settled, settled);
  }

  #locked<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#serial.then(operation);
    this.#serial = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  async #reconcile(input: CloudReconcileRequest): Promise<Result<CloudReconcileResult>> {
    try {
      const jobs = (await listRecords(this.#root)).filter(
        (job) => !input.after || job > input.after,
      );
      const page: CloudReconcileResult = { receipts: [], nextCursor: null };
      let scanned = 0;
      let cursor = input.after ?? null;
      for (const jobId of jobs.slice(0, input.limit ?? 4)) {
        if (!this.#activeJobs.has(jobId)) {
          const record = await readRecord(this.#root, jobId, this.#pluginId);
          const duplicate = [...this.#records.values()].find(
            (other) => other.executionId === record.executionId && other.jobId !== jobId,
          );
          if (duplicate) throw new Error('duplicate-execution');
          this.#records.set(jobId, record);
          if (!record.result?.settled) await this.#finish(record, null, true);
          if (record.result?.settled) this.#checked.add(jobId);
          else this.#checked.delete(jobId);
          if (record.result) {
            const receipt = {
              executionId: record.executionId,
              result: structuredClone(record.result),
            };
            if (
              Buffer.byteLength(
                JSON.stringify({ ...page, receipts: [...page.receipts, receipt] }),
              ) > 48_000
            ) {
              if (!page.receipts.length) throw new Error('receipt-budget');
              break;
            }
            page.receipts.push(receipt);
          }
        }
        cursor = jobId;
        scanned++;
      }
      page.nextCursor = scanned < jobs.length ? cursor : null;
      return { ok: true, value: page };
    } catch {
      return { ok: false, error: makeError('unavailable') };
    }
  }

  async #admit(
    task: PluginTask,
    request: CloudExecutionRequest,
    executionId: string,
    requestHash: string,
  ): Promise<Result<Admission>> {
    try {
      let jobs = await listRecords(this.#root);
      if (jobs.some((job) => !this.#checked.has(job) && !this.#activeJobs.has(job))) {
        const recovered = await this.#reconcile({ limit: 8 });
        if (!recovered.ok) return recovered;
        jobs = await listRecords(this.#root);
      }
      if (jobs.some((job) => !this.#checked.has(job) && !this.#activeJobs.has(job)))
        return { ok: false, error: makeError('not-ready') };
      const existing = [...this.#records.values()].find(
        (record) => record.executionId === executionId,
      );
      if (existing) {
        if (existing.requestHash !== requestHash)
          return { ok: false, error: makeError('conflict') };
        return existing.result
          ? { ok: true, value: { kind: 'receipt', result: structuredClone(existing.result) } }
          : { ok: false, error: makeError('not-ready') };
      }
      if (task.signal.aborted || this.#signal.aborted)
        return { ok: false, error: makeError('cancelled') };
      const jobId = randomUUID();
      const record: JobRecord = {
        version: 1,
        executionId,
        requestHash,
        owner: this.#owner,
        taskId: task.taskId,
        jobId,
        containerName: `pet-cloud-exec-${jobId}`,
        containerId: null,
        mounts: expectedMounts(this.#root, jobId),
        outputs: request.outputs ?? [],
        config: this.#config,
        result: null,
      };
      this.#activeJobs.add(jobId);
      return { ok: true, value: { kind: 'new', record } };
    } catch {
      return { ok: false, error: makeError('unavailable') };
    }
  }

  async #execute(
    task: PluginTask,
    request: CloudExecutionRequest,
    executionId: string,
    hash: string,
  ): Promise<Result<CloudExecutionResult>> {
    const admission = await this.#locked(() => this.#admit(task, request, executionId, hash));
    if (!admission.ok) return admission;
    if (admission.value.kind === 'receipt') return { ok: true, value: admission.value.result };
    const record = admission.value.record;
    const deadline = new AbortController();
    const signal = AbortSignal.any([task.signal, this.#signal, deadline.signal]);
    const timeoutMs = Math.min(
      request.timeoutMs ?? this.#config.timeoutMs,
      task.deadline === undefined ? Infinity : Math.max(0, task.deadline - performance.now()),
    );
    let published = false;
    let error = makeError('unavailable');
    let stopReason: 'cancelled' | 'timed-out' | null = signal.aborted ? 'cancelled' : null;
    let wake: () => void = () => {};
    const interrupted = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const abort = (): void => {
      stopReason ??= 'cancelled';
      wake();
    };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => {
        stopReason ??= 'timed-out';
        deadline.abort();
        wake();
      },
      Math.max(0, timeoutMs),
    );
    const stopped = (): boolean => signal.aborted || stopReason !== null || timeoutMs <= 0;
    const interruptionError = (): ReturnType<typeof makeError> =>
      makeError(stopReason === 'timed-out' ? 'timeout' : 'cancelled');
    try {
      const image = await docker([
        'image',
        'inspect',
        '--format',
        // Docker may omit Volumes for images that declare none.
        '{{.Id}}\n{{json (index .Config "Volumes")}}',
        this.#config.image,
      ]);
      const [imageId, volumes] = image.stdout.trim().split('\n');
      if (
        !image.failed &&
        image.code === 0 &&
        imageId &&
        /^sha256:[a-f0-9]{64}$/.test(imageId) &&
        (volumes === 'null' || volumes === '{}')
      ) {
        if (!stopped()) {
          await createWorkspace(this.#root, record.jobId, request);
          if (request.materials?.length && this.#readMaterial) {
            await stageMaterials(
              this.#root,
              record.jobId,
              request,
              { ...task, signal },
              executionId,
              this.#readMaterial,
            );
          }
          // Publish intent before Docker can create anything, then its verified ID before start.
          await saveRecord(this.#root, record);
          published = true;
          this.#records.set(record.jobId, record);
          if (!stopped()) {
            const uid = process.getuid?.() || 65534;
            const gid = process.getuid?.() ? (process.getgid?.() ?? 65534) : 65534;
            const creation = await docker([
              'create',
              '--name',
              record.containerName,
              '--label',
              `pet.cloud-exec.owner=${record.owner}`,
              '--label',
              `pet.cloud-exec.job=${record.jobId}`,
              '--label',
              `pet.cloud-exec.execution=${record.executionId}`,
              '--label',
              `pet.cloud-exec.task=${record.taskId}`,
              '--network',
              'none',
              '--read-only',
              '--cap-drop',
              'ALL',
              '--security-opt',
              'no-new-privileges=true',
              '--user',
              `${uid}:${gid}`,
              '--memory',
              `${this.#config.memoryMb}m`,
              '--memory-swap',
              `${this.#config.memoryMb}m`,
              '--cpus',
              String(this.#config.cpus),
              '--pids-limit',
              String(this.#config.pidsLimit),
              '--ulimit',
              'nofile=128:128',
              '--ulimit',
              `fsize=${this.#config.maxArtifactBytes}:${this.#config.maxArtifactBytes}`,
              '--tmpfs',
              '/tmp:rw,nosuid,nodev,noexec,size=16m',
              '--log-driver',
              'local',
              '--log-opt',
              'max-size=32k',
              '--log-opt',
              'max-file=1',
              '--log-opt',
              'compress=false',
              '--mount',
              `type=bind,source=${record.mounts[0]?.Source},target=/work,bind-propagation=rprivate`,
              '--mount',
              `type=bind,source=${record.mounts[1]?.Source},target=/job/code.mjs,readonly`,
              '--workdir',
              '/work',
              '--env',
              'HOME=/tmp',
              '--env',
              'NODE_OPTIONS=',
              '--env',
              'NODE_PATH=',
              '--entrypoint',
              'node',
              imageId,
              '/job/code.mjs',
            ]);
            if (!creation.failed && creation.code === 0) {
              const inspected = await inspectOwned(record);
              if (inspected.kind === 'owned') {
                record.containerId = inspected.container.id;
                await saveRecord(this.#root, record);
                if (!stopped()) {
                  const start = await docker(['start', record.containerId]);
                  if (!start.failed && start.code === 0) {
                    const waiting = docker(
                      ['wait', record.containerId],
                      Math.ceil(timeoutMs) + 20_000,
                    );
                    await Promise.race([waiting, interrupted]);
                    if (stopped()) await this.#stop(record);
                    await waiting;
                  }
                }
              }
            }
          }
        }
      }
      if (stopped()) error = interruptionError();
    } catch (cause) {
      error = stopped()
        ? interruptionError()
        : cause instanceof MaterialInputFailure
          ? cause.error
          : makeError('unavailable');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (published) {
        await this.#finish(record, stopReason);
        if (record.result?.settled) this.#checked.add(record.jobId);
      }
      this.#activeJobs.delete(record.jobId);
    }
    return published && record.result
      ? { ok: true, value: structuredClone(record.result) }
      : { ok: false, error };
  }

  async #stop(record: JobRecord): Promise<ContainerInspection> {
    let inspected = await inspectOwned(record);
    if (inspected.kind !== 'owned' || !inspected.container.state.Running) return inspected;
    await docker(['stop', '--time', '1', inspected.container.id]);
    inspected = await inspectOwned(record);
    if (inspected.kind === 'owned' && inspected.container.state.Running) {
      await docker(['kill', '--signal', 'KILL', inspected.container.id]);
      inspected = await inspectOwned(record);
    }
    return inspected;
  }

  async #finish(
    record: JobRecord,
    stopReason: 'cancelled' | 'timed-out' | null,
    recovering = false,
  ): Promise<void> {
    const result = record.result ?? unknownResult(record.jobId);
    record.result = result;
    try {
      let inspected = await inspectOwned(record);
      if (inspected.kind === 'owned') {
        record.containerId = inspected.container.id;
        if (inspected.container.state.Running) inspected = await this.#stop(record);
      }
      if (inspected.kind === 'absent') {
        // Absence settles resource cleanup, never proves that an uncertain effect succeeded.
        result.settled = true;
      } else if (inspected.kind === 'owned' && !inspected.container.state.Running) {
        const state = inspected.container.state;
        if (state.Status === 'exited' || state.Status === 'dead') {
          // Preserve a checkpoint written before removal, including already verified artifacts.
          if (result.exitCode === null) {
            result.exitCode = state.ExitCode;
            result.status =
              state.ExitCode === 0 ? 'exited' : (stopReason ?? (recovering ? 'unknown' : 'exited'));
            result.error = null;
            const logs = await docker(
              ['logs', inspected.container.id],
              10_000,
              record.config.maxLogBytes,
            );
            if (logs.failed || logs.code !== 0) result.error = makeError('unavailable');
            else {
              result.stdout = logs.stdout;
              result.stderr = logs.stderr;
              result.logsTruncated = logs.truncated;
            }
            try {
              result.artifacts = await retainArtifacts(
                this.#root,
                record.jobId,
                record.outputs,
                record.config.maxArtifactBytes,
              );
            } catch {
              result.error = makeError('invalid-input');
            }
          }
        } else if (stopReason) result.status = stopReason;
        result.settled = false;
        await saveRecord(this.#root, record);
        const confirmed = await inspectOwned(record);
        if (confirmed.kind === 'owned' && !confirmed.container.state.Running) {
          const removed = await docker(['rm', confirmed.container.id]);
          result.settled = removed.code === 0 && !removed.failed;
        }
      }
      if (result.settled && result.exitCode === 0) result.status = 'exited';
      if (!result.settled) {
        result.status = 'unknown';
        result.error = makeError('unavailable');
      }
      await saveRecord(this.#root, record);
    } catch {
      result.status = 'unknown';
      result.settled = false;
      result.error = makeError('unavailable');
    }
  }
}

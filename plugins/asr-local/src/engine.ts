import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export type AsrError = 'model-missing' | 'model-integrity' | 'asr-failed';
export interface EngineResult {
  readonly ok: boolean;
  readonly modelId?: string;
  readonly text?: string;
  readonly errorCode?: AsrError;
}
interface Work {
  readonly id: string;
  readonly child: ChildProcess;
  readonly partial: (text: string) => Promise<void>;
  finish(result: EngineResult): void;
}
export class LocalAsrEngine {
  #child: ChildProcess | undefined;
  #work: Work | undefined;
  #closing: Promise<void> | undefined;
  modelId: string | null = null;
  error: AsrError | null = null;
  private start(): ChildProcess {
    if (this.#child) return this.#child;
    const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
    for (const key of [
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'PATH',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
    ])
      if (process.env[key]) env[key] = process.env[key]!;
    const child = fork(fileURLToPath(new URL('./asr-worker.cjs', import.meta.url)), [], {
      execPath: process.execPath,
      env,
      windowsHide: true,
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.#child = child;
    child.on('message', (value) => {
      void this.receive(child, value);
    });
    const ended = () => {
      if (this.#child === child) {
        this.#child = undefined;
        this.modelId = null;
      }
      if (this.#work?.child === child) this.#work.finish({ ok: false, errorCode: 'asr-failed' });
    };
    child.once('exit', ended);
    child.once('error', ended);
    return child;
  }
  private async receive(child: ChildProcess, value: unknown): Promise<void> {
    const message = value as {
      kind?: string;
      id?: string;
      ok?: boolean;
      modelId?: string;
      text?: string;
      errorCode?: string;
      sequence?: number;
    };
    const work = this.#work;
    if (!work || work.child !== child || message.id !== work.id) return;
    if (
      message.kind === 'partial' &&
      typeof message.text === 'string' &&
      message.text.length <= 8192
    ) {
      try {
        await work.partial(message.text);
        if (child.connected) child.send({ op: 'ack', id: work.id, sequence: message.sequence });
      } catch {
        await this.close();
      }
    } else if (message.kind === 'result') {
      if (message.ok === true && typeof message.modelId === 'string') {
        this.modelId = message.modelId;
        this.error = null;
        work.finish({
          ok: true,
          modelId: message.modelId,
          ...(typeof message.text === 'string' ? { text: message.text } : {}),
        });
      } else {
        this.error =
          message.errorCode === 'model-missing' || message.errorCode === 'model-integrity'
            ? message.errorCode
            : 'asr-failed';
        work.finish({ ok: false, errorCode: this.error });
      }
    }
  }
  private async request(
    op: 'load' | 'recognize',
    payload: Record<string, unknown>,
    signal: AbortSignal,
    partial: (text: string) => Promise<void>,
    samples?: Float32Array,
  ): Promise<EngineResult> {
    if (this.#work || signal.aborted) return { ok: false, errorCode: 'asr-failed' };
    if (this.#closing) await this.#closing;
    if (signal.aborted) return { ok: false, errorCode: 'asr-failed' };
    const child = this.start(),
      id = randomUUID();
    return new Promise((resolve) => {
      const abort = () => {
        void this.close();
      };
      const finish = (result: EngineResult) => {
        if (this.#work?.id !== id) return;
        this.#work = undefined;
        signal.removeEventListener('abort', abort);
        resolve(result);
      };
      this.#work = { id, child, partial, finish };
      signal.addEventListener('abort', abort, { once: true });
      const send = async () => {
        await new Promise<void>((resolve, reject) =>
          child.send({ op, id, ...payload }, (error) => (error ? reject(error) : resolve())),
        );
        if (samples)
          for (let offset = 0, sequence = 0; offset < samples.length; offset += 1600, sequence++) {
            if (signal.aborted) break;
            const owned = new Uint8Array(
              new Float32Array(samples.subarray(offset, offset + 1600)).buffer,
            );
            await new Promise<void>((resolve, reject) =>
              child.send({ op: 'pcm', id, sequence, payload: owned }, (error) =>
                error ? reject(error) : resolve(),
              ),
            );
          }
      };
      void send().catch(() => {
        void this.close();
      });
    });
  }
  async prepare(modelId: string, signal: AbortSignal): Promise<EngineResult> {
    if (this.#closing) await this.#closing;
    if (signal.aborted || this.#work) return { ok: false, errorCode: 'asr-failed' };
    if (this.#child && this.modelId === modelId && !this.error) return { ok: true, modelId };
    if (this.#child && this.modelId !== modelId) await this.close();
    return this.request('load', { modelId }, signal, async () => {});
  }
  recognize(
    samples: Float32Array,
    signal: AbortSignal,
    partial: (text: string) => Promise<void>,
  ): Promise<EngineResult> {
    if (!samples.length)
      return Promise.resolve({ ok: true, modelId: this.modelId ?? '', text: '' });
    return this.request('recognize', { samples: samples.length }, signal, partial, samples);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    const child = this.#child;
    if (!child) return Promise.resolve();
    this.#closing = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else {
        child.once('exit', () => resolve());
        child.kill();
      }
    }).finally(() => {
      if (this.#child === child) this.#child = undefined;
      this.modelId = null;
      this.#closing = undefined;
    });
    return this.#closing;
  }
}

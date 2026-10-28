import { randomUUID } from 'node:crypto';
import type { ApplicationDialog } from '@pet/contracts';
export type ApplicationUpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; summary: string }
  | { phase: 'downloading'; version: string; percent?: number }
  | { phase: 'ready'; version: string }
  | { phase: 'failed'; version: string; message: string }
  | { phase: 'completed'; version: string };
export interface ApplicationUpdateAdapter {
  current(): ApplicationUpdateState;
  subscribe(listener: () => void): () => void;
  download(): Promise<void>;
  install(): Promise<void>;
}
/** UI follows the actual updater. No feed means no update action or progress. */
export class ApplicationUpdateDialogs {
  #adapter: ApplicationUpdateAdapter | undefined;
  #remove: (() => void) | undefined;
  #id = randomUUID();
  #hidden = false;
  #busy = false;
  #error: string | undefined;
  constructor(private readonly changed: () => void) {}
  bind(adapter: ApplicationUpdateAdapter): void {
    this.#remove?.();
    this.#adapter = adapter;
    this.#remove = adapter.subscribe(() => {
      this.#id = randomUUID();
      this.#hidden = false;
      this.#error = undefined;
      this.changed();
    });
    this.changed();
  }
  dialog(): ApplicationDialog | null {
    if (!this.#adapter || this.#hidden) return null;
    const state = this.#adapter.current();
    if (state.phase === 'idle') return null;
    const base = {
      id: this.#id,
      step: 'update:' + state.phase,
      busy: this.#busy,
      ...(this.#error ? { error: this.#error } : {}),
    };
    if (state.phase === 'available')
      return {
        ...base,
        title: '有新版本 ' + state.version,
        text: state.summary,
        choices: [
          { id: 'download', label: '下载更新', primary: true },
          { id: 'later', label: '稍后' },
        ],
      };
    if (state.phase === 'downloading')
      return {
        ...base,
        title: '正在下载更新',
        text: Number.isFinite(state.percent)
          ? '已下载 ' + Math.max(0, Math.min(100, Math.round(state.percent!))) + '%'
          : '更新包正在下载。',
        choices: [{ id: 'later', label: '先收起' }],
      };
    if (state.phase === 'ready')
      return {
        ...base,
        title: '更新已准备好',
        text: '安装 ' + state.version + ' 后将重新启动。',
        choices: [
          { id: 'install', label: '安装并重新启动', primary: true },
          { id: 'later', label: '稍后' },
        ],
      };
    if (state.phase === 'failed')
      return {
        ...base,
        title: '更新没有完成',
        text: state.message,
        choices: [
          { id: 'download', label: '重试', primary: true },
          { id: 'later', label: '稍后' },
        ],
      };
    return {
      ...base,
      title: '更新已完成',
      text: '当前版本 ' + state.version,
      choices: [{ id: 'later', label: '知道了', primary: true }],
    };
  }
  async answer(id: string, step: string, choice: string): Promise<boolean> {
    const current = this.dialog();
    if (
      !current ||
      current.id !== id ||
      current.step !== step ||
      this.#busy ||
      !current.choices.some((c) => c.id === choice) ||
      !this.#adapter
    )
      return false;
    if (choice === 'later') {
      this.#hidden = true;
      this.changed();
      return true;
    }
    this.#busy = true;
    this.changed();
    try {
      if (choice === 'download') await this.#adapter.download();
      else await this.#adapter.install();
    } catch {
      this.#error = '这次更新操作没有完成，请重试';
    } finally {
      this.#busy = false;
      this.changed();
    }
    return true;
  }
  close(): void {
    this.#remove?.();
    this.#adapter = undefined;
  }
}

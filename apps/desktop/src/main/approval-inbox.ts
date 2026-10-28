import type { ConsoleApprovalDecision, ConsoleApprovalPrompt } from '@pet/contracts';
import type { ApprovalChannel, ApprovalDecision, ApprovalPrompt } from '@pet/host-kernel';
interface Waiting {
  readonly view: ConsoleApprovalPrompt;
  readonly expires: number;
  finish(decision?: ApprovalDecision, notify?: boolean): void;
}
/** Host-owned pending requests. Kernel owns the timeout and cancellation signal. */
export class ApprovalInbox implements ApprovalChannel {
  readonly #pending = new Map<string, Waiting>();
  readonly #listeners = new Set<() => void>();
  #closed = false;
  constructor(private readonly timeoutMs = 30000) {}
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  private changed(): void {
    for (const listener of this.#listeners) listener();
  }
  snapshot(): readonly ConsoleApprovalPrompt[] {
    return [...this.#pending.values()].map((entry) => entry.view);
  }
  request(prompt: ApprovalPrompt, signal: AbortSignal): Promise<ApprovalDecision> {
    if (this.#closed || signal.aborted || this.#pending.has(prompt.requestId))
      return Promise.reject(new Error('Approval unavailable'));
    return new Promise((resolve, reject) => {
      const abort = () => finish();
      const finish = (decision?: ApprovalDecision, notify = true) => {
        if (!this.#pending.delete(prompt.requestId)) return;
        signal.removeEventListener('abort', abort);
        if (decision) resolve(decision);
        else reject(new Error('Approval ended'));
        if (notify) this.changed();
      };
      this.#pending.set(prompt.requestId, {
        view: Object.freeze({
          requestId: prompt.requestId,
          owner: prompt.owner,
          taskId: prompt.taskId,
          permission: prompt.permission,
          permissionDigest: prompt.permissionDigest,
          deadlineAt: Date.now() + this.timeoutMs,
        }),
        expires: performance.now() + this.timeoutMs,
        finish,
      });
      signal.addEventListener('abort', abort, { once: true });
      this.changed();
    });
  }
  answer(decision: ConsoleApprovalDecision): boolean {
    const entry = this.#pending.get(decision.requestId);
    if (
      !entry ||
      performance.now() >= entry.expires ||
      decision.owner.pluginId !== entry.view.owner.pluginId ||
      decision.owner.instanceId !== entry.view.owner.instanceId ||
      decision.owner.generation !== entry.view.owner.generation ||
      decision.taskId !== entry.view.taskId ||
      decision.permissionDigest !== entry.view.permissionDigest
    )
      return false;
    entry.finish({ ...decision });
    return true;
  }
  clear(): void {
    const pending = [...this.#pending.values()];
    for (const entry of pending) entry.finish(undefined, false);
    if (pending.length) this.changed();
  }
  close(): void {
    this.#closed = true;
    this.clear();
    this.#listeners.clear();
  }
}

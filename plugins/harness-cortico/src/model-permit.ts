type Waiter = {
  grant(): void;
};

/** One native model call at a time; queued inputs hold no model or credential lease. */
export class ModelPermit {
  private active = false;
  private readonly waiters: Waiter[] = [];

  diagnostics(): { active: boolean; waiting: number } {
    return { active: this.active, waiting: this.waiters.length };
  }

  /** operation must settle only after its actual native/credential work has joined. */
  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      // Cancellation can win after grant but before this continuation runs.
      signal.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        reject(signal.reason);
      };
      const waiter: Waiter = {
        grant: () => {
          signal.removeEventListener('abort', cancel);
          this.active = true;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active = false;
            this.next();
          });
        },
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.waiters.push(waiter);
      this.next();
    });
  }

  private next(): void {
    if (!this.active) this.waiters.shift()?.grant();
  }
}

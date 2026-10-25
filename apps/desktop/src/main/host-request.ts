import { HOST_IPC, makeError, type HostStatus, type Result } from '@pet/contracts';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
export class HostStatusRequests {
  #start = 0;
  #requests = 0;
  constructor(
    private readonly read: () => HostStatus,
    private readonly now: () => number = () => performance.now(),
  ) {}
  handle(source: PetRequestSource, channel: string, args: readonly unknown[]): Result<HostStatus> {
    if (
      !Number.isSafeInteger(source.senderId) ||
      source.senderId < 1 ||
      !Number.isSafeInteger(source.expectedId) ||
      source.expectedId < 1 ||
      source.mainFrame !== true ||
      !isTrustedPetSource(source)
    )
      return { ok: false, error: makeError('permission-denied', false) };
    if (channel !== HOST_IPC.status || args.length)
      return { ok: false, error: makeError('invalid-input', false) };
    const now = this.now();
    if (now - this.#start >= 1000) {
      this.#start = now;
      this.#requests = 0;
    }
    if (++this.#requests > 60) return { ok: false, error: makeError('quota-exceeded', true) };
    try {
      return { ok: true, value: Object.freeze({ ...this.read() }) };
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  }
}

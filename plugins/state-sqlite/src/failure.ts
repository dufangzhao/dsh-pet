import type { KernelErrorCode } from '@pet/contracts';

export class StateFailure extends Error {
  constructor(readonly code: KernelErrorCode) {
    super(code);
  }
}

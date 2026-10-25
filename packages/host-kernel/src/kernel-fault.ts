import { makeError, type KernelError, type KernelErrorCode } from '@pet/contracts';
export class KernelFault extends Error {
  readonly error: KernelError;
  constructor(code: KernelErrorCode) {
    const error = makeError(code, false);
    super(error.messageKey);
    this.name = 'KernelFault';
    this.error = error;
  }
}

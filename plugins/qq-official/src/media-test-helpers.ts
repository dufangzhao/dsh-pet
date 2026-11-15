import { KernelFault } from '@pet/host-kernel';
import type { OfficialMediaIo } from './media-types.js';

/** Control-only lifecycle fixtures must fail if a test accidentally starts media IO. */
export function unusedOfficialMedia(): OfficialMediaIo {
  const unused = async (): Promise<never> => {
    throw new KernelFault('not-ready');
  };
  return {
    inline: unused,
    prepare: unused,
    putPart: unused,
    finishPart: unused,
    commit: unused,
    readAttachment: unused,
  };
}

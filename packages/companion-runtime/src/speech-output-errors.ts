import type { SpeechFinishReason } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';

/** Fixed native protocol outcome; no provider body or original target text is exposed. */
export class SpeechGenerationFault extends KernelFault {
  constructor(readonly finishReason: SpeechFinishReason) {
    super('audio-format');
  }
}

/** Logical failure and physical cleanup failure must remain independent. */
export class SpeechCleanupFault extends KernelFault {
  constructor() {
    super('internal');
  }
}

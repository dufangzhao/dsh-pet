import {
  COMPANION_MEMORY_MAX_FACTS,
  COMPANION_MEMORY_MAX_DATA_BYTES,
  COMPANION_MEMORY_MAX_ORIGIN_BYTES,
  type CompanionFact,
} from '@pet/contracts';
import { jsonBytes, StateFailure } from './validation.js';

/** Origin has its own headroom; adding it never evicts a previously legal v1 value. */
export function memoryUsage(facts: readonly CompanionFact[]) {
  const usage = {
    count: facts.length,
    dataBytes: jsonBytes(
      facts.map(({ key, value, revision, updatedAt }) => ({ key, value, revision, updatedAt })),
    ),
    originBytes: jsonBytes(facts.map((fact) => fact.origin ?? { kind: 'legacy-unknown' })),
  };
  if (
    usage.count > COMPANION_MEMORY_MAX_FACTS ||
    usage.dataBytes > COMPANION_MEMORY_MAX_DATA_BYTES ||
    usage.originBytes > COMPANION_MEMORY_MAX_ORIGIN_BYTES
  )
    throw new StateFailure('quota-exceeded');
  return usage;
}

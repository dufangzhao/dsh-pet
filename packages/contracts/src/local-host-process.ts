import type { JsonSchema } from './json.js';

/** OS-derived process/profile identity, not an authority grant or proof of process exit. */
export interface LocalHostProcessIdentity {
  readonly osKind: 'linux' | 'win32';
  /** Linux: boot UUID@PID-namespace device:inode. Windows: actual OS boot GUID. */
  readonly osBootIdentity: string;
  readonly pid: number;
  /** Linux /proc start ticks or Windows GetProcessTimes creation FILETIME; never sampled wall time. */
  readonly processCreationIdentity: string;
  /** OS-verifiable canonical profile identity; a path or advertised host/boot label alone is insufficient. */
  readonly profileIdentity: string;
}

const stamp: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
};
export const LOCAL_HOST_PROCESS_IDENTITY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['osKind', 'osBootIdentity', 'pid', 'processCreationIdentity', 'profileIdentity'],
  properties: {
    osKind: { enum: ['linux', 'win32'] },
    osBootIdentity: stamp,
    pid: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    processCreationIdentity: stamp,
    profileIdentity: stamp,
  },
};

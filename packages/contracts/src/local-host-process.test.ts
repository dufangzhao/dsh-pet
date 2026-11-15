import { describe, expect, it } from 'vitest';
import type { LocalHostProcessIdentity } from './local-host-process.js';
import { validateLocalHostProcessIdentity } from './validation/index.js';

const linux: LocalHostProcessIdentity = {
  osKind: 'linux',
  osBootIdentity: '12345678-1234-1234-1234-123456789abc@4:4026531836',
  pid: 1234,
  processCreationIdentity: '88901234',
  profileIdentity: 'a'.repeat(64),
};

describe('local host OS process identity shape', () => {
  it('accepts the exact shared Linux and win32 descriptor without treating it as OS proof', () => {
    expect(validateLocalHostProcessIdentity(linux)).toEqual({ ok: true, value: linux });
    const windows: LocalHostProcessIdentity = {
      ...linux,
      osKind: 'win32',
      osBootIdentity: '12345678-1234-1234-1234-123456789abc',
      processCreationIdentity: '133700000000000000',
    };
    expect(validateLocalHostProcessIdentity(windows)).toEqual({ ok: true, value: windows });
    const result = validateLocalHostProcessIdentity(linux);
    if (!result.ok) throw new Error('missing validated identity');
    expect(result.value).not.toBe(linux);
  });

  it('rejects unknown fields, unsupported OS labels, invalid PIDs, and unsafe or unbounded stamps', () => {
    for (const input of [
      { ...linux, pidNamespaceIdentity: 'duplicate-field' },
      { ...linux, role: 'owner' },
      { ...linux, osKind: 'windows' },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN].map((pid) => ({ ...linux, pid })),
      { ...linux, osBootIdentity: '' },
      { ...linux, processCreationIdentity: 'x'.repeat(257) },
      { ...linux, profileIdentity: 'unsafe\nprofile' },
      { ...linux, osBootIdentity: 'bad\u007fidentity' },
    ])
      expect(validateLocalHostProcessIdentity(input)).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' },
      });
  });

  it('uses the shared JSON preflight without invoking input getters', () => {
    let reads = 0;
    const input = {
      ...linux,
      get pid() {
        reads++;
        return 1234;
      },
    };
    expect(validateLocalHostProcessIdentity(input).ok).toBe(false);
    expect(reads).toBe(0);
  });
});

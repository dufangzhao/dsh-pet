import { describe, expect, it } from 'vitest';
import { isPetState, PET_IPC, PET_STATES } from './pet-prototype.js';

describe('M0 prototype bridge vocabulary', () => {
  it.each(PET_STATES)('accepts the declared state %s', (state) => {
    expect(isPetState(state)).toBe(true);
  });
  it.each([null, undefined, '', 'recording', 1, true, {}, ['idle']])(
    'rejects undeclared value %j',
    (value) => {
      expect(isPetState(value)).toBe(false);
    },
  );
  it('has unique fixed channels and no generic system channel', () => {
    expect(new Set(Object.values(PET_IPC)).size).toBe(Object.keys(PET_IPC).length);
    expect(Object.values(PET_IPC).every((name) => name.startsWith('pet:prototype:'))).toBe(true);
  });
});

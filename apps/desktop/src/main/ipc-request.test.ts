import { describe, expect, it } from 'vitest';
import { PET_IPC, type PetSnapshot, type PetState } from '@pet/contracts';
import { handlePetRequest, type PetActions, type PetRequestSource } from './ipc-request.js';
const source: PetRequestSource = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///pet/index.html',
  expectedUrl: 'file:///pet/index.html',
};
const snapshot: PetSnapshot = {
  state: 'idle',
  bounds: { x: 0, y: 0, width: 380, height: 420 },
  displayId: 1,
  displayCount: 1,
  scaleFactor: 1,
  clickThrough: true,
  dragging: false,
};
function setup() {
  const calls: string[] = [];
  const actions: PetActions = {
    getSnapshot() {
      calls.push('snapshot');
      return snapshot;
    },
    setInteraction(value: boolean) {
      calls.push('interaction:' + value);
    },
    beginDrag() {
      calls.push('start');
    },
    endDrag() {
      calls.push('end');
    },
    setState(value: PetState) {
      calls.push(value);
    },
    quit() {
      calls.push('quit');
    },
  };
  return { actions, calls };
}
describe('M0 IPC boundary', () => {
  it.each([
    { senderId: 2 },
    { mainFrame: false },
    { frameUrl: 'https://evil.invalid' },
    { frameUrl: 'file:///pet/index.html?spoof=1' },
    { frameUrl: 'file:///pet/index.html/evil' },
  ])('rejects untrusted source %j without acting', (change) => {
    const s = setup();
    expect(handlePetRequest({ ...source, ...change }, PET_IPC.quit, [], s.actions)).toEqual({
      ok: false,
      error: 'untrusted-sender',
    });
    expect(s.calls).toEqual([]);
  });
  it.each([PET_IPC.changed, 'fs:read', 'ipc:invoke', ''])(
    'rejects unknown/request-ineligible channel %s',
    (channel) => {
      const s = setup();
      expect(handlePetRequest(source, channel, [], s.actions).ok).toBe(false);
      expect(s.calls).toEqual([]);
    },
  );
  it.each([null, {}, 'true', 1, undefined])('rejects invalid interaction argument %j', (value) => {
    const s = setup();
    expect(handlePetRequest(source, PET_IPC.interaction, [value], s.actions).ok).toBe(false);
    expect(s.calls).toEqual([]);
  });
  it('rejects extra arguments and unknown state', () => {
    const s = setup();
    expect(handlePetRequest(source, PET_IPC.dragStart, [1], s.actions).ok).toBe(false);
    expect(handlePetRequest(source, PET_IPC.preview, ['recording'], s.actions).ok).toBe(false);
    expect(s.calls).toEqual([]);
  });
  it('routes only declared actions and returns snapshots', () => {
    const s = setup();
    expect(handlePetRequest(source, PET_IPC.preview, ['thinking'], s.actions)).toEqual({
      ok: true,
      value: snapshot,
    });
    expect(s.calls).toEqual(['thinking', 'snapshot']);
  });
  it('acknowledges quit without exposing host internals', () => {
    const s = setup();
    expect(handlePetRequest(source, PET_IPC.quit, [], s.actions)).toEqual({
      ok: true,
      value: null,
    });
    expect(s.calls).toEqual(['quit']);
  });
  it('redacts host failures', () => {
    const s = setup();
    s.actions.getSnapshot = () => {
      throw new Error('private-host-data');
    };
    expect(handlePetRequest(source, PET_IPC.snapshot, [], s.actions)).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { errorMessage, makeError, KERNEL_ERROR_CODES, RETRYABLE_BY_DEFAULT } from './errors.js';
import { LIFECYCLE_STATE_POLICY, PLUGIN_LIFECYCLE_STATES } from './lifecycle.js';
import {
  MVP_CAPABILITIES,
  capabilityMajor,
  isSameCapability,
  parseCapabilityId,
} from './capability.js';
import {
  acceptChunk,
  canAcceptChunk,
  emptyStreamBudget,
  MEDIA_MAX_CHUNK_BYTES,
  MEDIA_MAX_CHUNKS_PER_STREAM,
  MEDIA_MAX_STREAM_BYTES,
} from './media.js';
import { isTerminalTaskState, isTerminalTaskEventKind, TASK_STATES } from './task.js';

describe('fixed error taxonomy', () => {
  it('derives a fixed message key and never stores free text', () => {
    const error = makeError('network');
    expect(error).toEqual({ code: 'network', messageKey: 'errors.network', retryable: true });
    expect(Object.keys(error).sort()).toEqual(['code', 'messageKey', 'retryable']);
  });

  it('defaults retryability from the fixed table', () => {
    for (const code of KERNEL_ERROR_CODES) {
      expect(makeError(code).retryable).toBe(RETRYABLE_BY_DEFAULT[code]);
    }
  });

  it('collapses an unknown code to internal', () => {
    const error = makeError('totally-made-up' as never);
    expect(error.code).toBe('internal');
    expect(error.messageKey).toBe('errors.internal');
  });

  it('returns fixed display copy per code', () => {
    for (const code of KERNEL_ERROR_CODES) {
      const message = errorMessage(makeError(code));
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(new Set(KERNEL_ERROR_CODES.map((c) => errorMessage(makeError(c)))).size).toBe(
      KERNEL_ERROR_CODES.length,
    );
  });
});

describe('lifecycle policy table', () => {
  it('accepts tasks only in active', () => {
    for (const state of PLUGIN_LIFECYCLE_STATES) {
      expect(LIFECYCLE_STATE_POLICY[state].acceptsTasks).toBe(state === 'active');
    }
  });

  it('hides contributions in rejected, disabled, activating, deactivating and pending_restart', () => {
    const hidden = PLUGIN_LIFECYCLE_STATES.filter(
      (state) => !LIFECYCLE_STATE_POLICY[state].showsContributions,
    );
    expect(hidden.sort()).toEqual(
      ['activating', 'deactivating', 'disabled', 'pending_restart', 'rejected'].sort(),
    );
  });
});

describe('capability identifiers', () => {
  it('lists the frozen M1 capabilities', () => {
    expect([...MVP_CAPABILITIES]).toEqual([
      'input.talkKey@1',
      'audio.capture@1',
      'speech.asr@1',
      'llm.chat@1',
      'chat.session@1',
      'avatar.render@1',
    ]);
  });

  it('parses a capability identifier', () => {
    expect(parseCapabilityId('speech.asr@1')).toEqual({ domain: 'speech', name: 'asr', major: 1 });
  });

  it.each([
    'speech',
    'speech.asr',
    'speech.asr@0',
    'Speech.asr@1',
    'speech..asr@1',
    'speech.asr@x',
  ])('rejects malformed capability %s', (value) => {
    expect(parseCapabilityId(value)).toBeNull();
    expect(capabilityMajor(value)).toBeNull();
  });

  it('compares capabilities by contract major version', () => {
    expect(isSameCapability('speech.asr@1', 'speech.asr@1')).toBe(true);
    expect(isSameCapability('speech.asr@1', 'speech.asr@2')).toBe(false);
    expect(isSameCapability('speech.asr@1', 'audio.capture@1')).toBe(false);
  });
});

describe('task states', () => {
  it('treats only the declared terminal states as terminal', () => {
    for (const state of TASK_STATES) {
      expect(isTerminalTaskState(state)).toBe(
        state === 'completed' ||
          state === 'failed' ||
          state === 'cancelled' ||
          state === 'timed-out',
      );
    }
  });

  it('treats completed, failed and cancelled as terminal events', () => {
    expect(isTerminalTaskEventKind('completed')).toBe(true);
    expect(isTerminalTaskEventKind('cancelled')).toBe(true);
    expect(isTerminalTaskEventKind('failed')).toBe(true);
    expect(isTerminalTaskEventKind('data')).toBe(false);
    expect(isTerminalTaskEventKind('progress')).toBe(false);
  });
});

describe('stream budgets', () => {
  it('accepts chunks up to the per-chunk budget', () => {
    expect(canAcceptChunk(emptyStreamBudget(), MEDIA_MAX_CHUNK_BYTES)).toBe(true);
    expect(canAcceptChunk(emptyStreamBudget(), MEDIA_MAX_CHUNK_BYTES + 1)).toBe(false);
  });

  it('refuses more than eight chunks per stream', () => {
    let state = emptyStreamBudget();
    for (let index = 0; index < MEDIA_MAX_CHUNKS_PER_STREAM; index += 1) {
      const next = acceptChunk(state, 1);
      expect(next).not.toBeNull();
      state = next as typeof state;
    }
    expect(acceptChunk(state, 1)).toBeNull();
  });

  it('refuses a chunk that would exceed the per-stream byte budget', () => {
    let state = emptyStreamBudget();
    for (let index = 0; index < MEDIA_MAX_CHUNKS_PER_STREAM; index += 1) {
      state = acceptChunk(state, MEDIA_MAX_CHUNK_BYTES) as typeof state;
    }
    expect(state.bytes).toBe(MEDIA_MAX_CHUNK_BYTES * MEDIA_MAX_CHUNKS_PER_STREAM);
    expect(state.bytes).toBeLessThanOrEqual(MEDIA_MAX_STREAM_BYTES);
    expect(acceptChunk(emptyStreamBudget(), -1)).toBeNull();
    expect(acceptChunk(emptyStreamBudget(), 1.5)).toBeNull();
  });
});

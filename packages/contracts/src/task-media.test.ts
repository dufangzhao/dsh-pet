import { describe, expect, it } from 'vitest';
import { validateManifest } from './validation/validate.js';
import { allowsTaskData, isTerminalTaskEventKind, TASK_EVENT_KINDS } from './task.js';
import { isSameCapability, parseCapabilityId } from './capability.js';
import { acceptChunk, emptyStreamBudget, MEDIA_MAX_CHUNK_BYTES } from './media.js';

const base = () => ({
  schemaVersion: 1,
  id: 'official.voice-chat',
  version: '0.1.0',
  displayName: { en: 'Voice chat' },
  description: { en: 'Voice chat plugin' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'dist/runtime.js' },
});

describe('task events stop delivering data after the terminal event', () => {
  it('allows business data only for progress and data', () => {
    for (const kind of TASK_EVENT_KINDS) {
      expect(allowsTaskData(kind)).toBe(kind === 'progress' || kind === 'data');
    }
  });

  it('has exactly one terminal event per task', () => {
    const terminal = TASK_EVENT_KINDS.filter((kind) => isTerminalTaskEventKind(kind));
    expect(terminal).toEqual(['completed', 'failed', 'cancelled']);
  });
});

describe('capability identifiers used by the M1 manifest', () => {
  it.each(['input.talkKey@1', 'audio.capture@1', 'speech.asr@1', 'llm.chat@1'])(
    'accepts %s as a provided capability',
    (capability) => {
      const manifest = { ...base(), provides: [{ id: 'p', capability }] };
      expect(validateManifest(manifest).ok).toBe(true);
    },
  );

  it.each(['speech.asr', 'speech.asr@0', 'speech.asr@v1', 'Speech.asr@1', 'speech@1'])(
    'rejects %s as a provided capability',
    (capability) => {
      const manifest = { ...base(), provides: [{ id: 'p', capability }] };
      expect(validateManifest(manifest).ok).toBe(false);
    },
  );

  it('treats input.talkKey@1 as the talk-key contract', () => {
    expect(parseCapabilityId('input.talkKey@1')).toEqual({
      domain: 'input',
      name: 'talkKey',
      major: 1,
    });
    expect(isSameCapability('input.talkKey@1', 'input.talkKey@1')).toBe(true);
    expect(isSameCapability('input.talkKey@1', 'input.talkKey@2')).toBe(false);
  });
});

describe('media budgets never report success while dropping frames', () => {
  it('returns null instead of a silently truncated budget', () => {
    expect(acceptChunk(emptyStreamBudget(), MEDIA_MAX_CHUNK_BYTES + 1)).toBeNull();
    expect(acceptChunk(emptyStreamBudget(), 0)).toEqual({ chunks: 1, bytes: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  isSpeechAudioHeader,
  isSpeechBegin,
  isSpeechCredentialCommand,
  isSpeechProviderCommand,
  isSpeechSegmentKey,
  isSpeechVerifiedTerminal,
  SPEECH_FORMAT,
  SPEECH_PROTOCOL,
  SPEECH_SEGMENT_MAX_FRAMES,
  SPEECH_TTS_PROVIDER,
} from './companion-speech.js';
import {
  DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES,
  isDesktopSpeechAudioEvent,
  isDesktopSpeechConsume,
  isDesktopSpeechPlaybackIdentity,
  isDesktopSpeechReady,
  isDesktopSpeechReleased,
  matchesDesktopSpeechAudioHeader,
} from './desktop-speech.js';

const key = {
  utteranceId: 'reply-1',
  clientId: 'desktop-1',
  agentId: 'agent-1',
  serviceEpoch: 'epoch-1',
};
const segment = {
  ...key,
  utteranceBindingId: 'whole-binding',
  segmentIndex: 0,
  requestId: 'reply-1-0',
};
const binding = { providerRef: SPEECH_TTS_PROVIDER, bindingId: 'provider-binding' };
const header = { ...segment, ...binding, version: 1, format: SPEECH_FORMAT };
const identity = {
  ...segment,
  connectionId: 'connection-1',
  playbackId: 'playback-1',
  localOwner: { pluginId: 'pet.speech-output', instanceId: 'default', generation: 2 },
  localTaskId: 'local-task',
  localStreamId: 'local-stream',
  remoteBinding: binding,
};
const terminal = {
  outcome: 'completed',
  finishReason: 'stop',
  producedFrames: 2 * 1024 * 1024,
  producedBytes: 4 * 1024 * 1024,
  drainedFrames: 2 * 1024 * 1024,
  drainedBytes: 4 * 1024 * 1024,
  nativeSettled: true,
  transportCleanup: 'settled',
  error: null,
};

describe('shared speech stream boundary', () => {
  it('takes canonical identity and frozen selection, never caller text, slices or URLs', () => {
    const begin = {
      ...key,
      ...binding,
      messageId: 'say:1',
      eventSequence: 2,
      expectedFeatureRevision: 0,
      volume: 80,
    };
    expect(isSpeechBegin(begin)).toBe(true);
    for (const patch of [
      { text: 'injected' },
      { offset: 0 },
      { count: 1 },
      { url: 'https://example.test' },
      { eventSequence: 0 },
      { messageId: 'say:1\n' },
      { providerRef: 'pet.tts-magpie/default/magpie' },
      { volume: 101 },
    ]) {
      expect(isSpeechBegin({ ...begin, ...patch })).toBe(false);
    }
    expect(isSpeechSegmentKey(segment)).toBe(true);
    expect(isSpeechSegmentKey({ ...segment, segmentIndex: 4 })).toBe(false);
    expect(isSpeechSegmentKey({ ...segment, text: 'injected' })).toBe(false);
  });

  it('keeps config CAS and the dedicated key version explicit', () => {
    const settings = {
      baseUrl: 'https://gateway.example/magpie',
      modelRef: '',
      authMode: 'gateway-key',
      protocol: SPEECH_PROTOCOL,
      voice: 'Mia',
    };
    const command = { providerRef: SPEECH_TTS_PROVIDER, expectedRevision: 0, settings };
    expect(isSpeechProviderCommand(command)).toBe(true);
    expect(isSpeechProviderCommand({ ...command, settings: { ...settings, voice: 'clone' } })).toBe(
      false,
    );
    expect(isSpeechProviderCommand({ ...command, expectedRevision: -1 })).toBe(false);
    const credential = {
      providerRef: SPEECH_TTS_PROVIDER,
      expectedRevision: 0,
      expectedCredentialVersion: 'fresh',
      value: 'dedicated-key',
    };
    expect(isSpeechCredentialCommand(credential)).toBe(true);
    expect(isSpeechCredentialCommand({ ...credential, value: null })).toBe(true);
    expect(isSpeechCredentialCommand({ ...credential, value: 'secret\n' })).toBe(false);
    expect(isSpeechCredentialCommand({ ...credential, value: '密'.repeat(1366) })).toBe(false);
    expect(isSpeechCredentialCommand({ ...credential, value: '\ud800' })).toBe(false);
  });

  it('requires fixed unknown-length PCM start and an exact fully drained terminal', () => {
    expect(isSpeechAudioHeader(header)).toBe(true);
    expect(isSpeechAudioHeader({ ...header, frames: 100 })).toBe(false);
    expect(
      isSpeechAudioHeader({ ...header, format: { ...SPEECH_FORMAT, sampleRate: 16000 } }),
    ).toBe(false);
    // Cumulative streamed PCM may exceed the kernel's 2MiB resident window.
    expect(isSpeechVerifiedTerminal(terminal)).toBe(true);
    for (const patch of [
      { finishReason: 'length' },
      { outcome: 'failed' },
      { nativeSettled: false },
      { transportCleanup: 'pending' },
      { drainedFrames: 1 },
      { drainedBytes: 1 },
      { producedFrames: 0 },
      { producedFrames: SPEECH_SEGMENT_MAX_FRAMES + 1 },
    ]) {
      expect(isSpeechVerifiedTerminal({ ...terminal, ...patch })).toBe(false);
    }
  });

  it('binds every player event and ACK to local task/media plus remote provenance', () => {
    expect(isDesktopSpeechPlaybackIdentity(identity)).toBe(true);
    const start = { ...identity, sequence: 0, kind: 'start', format: SPEECH_FORMAT, volume: 80 };
    expect(isDesktopSpeechAudioEvent(start)).toBe(true);
    expect(isDesktopSpeechAudioEvent({ ...start, frames: 100 })).toBe(false);
    expect(isDesktopSpeechAudioEvent({ ...identity, sequence: 2, kind: 'end', terminal })).toBe(
      true,
    );
    expect(isDesktopSpeechReady({ ...identity, sequence: 0, format: SPEECH_FORMAT })).toBe(true);
    expect(isDesktopSpeechReleased({ ...identity, sequence: 3, cleanup: 'failed' })).toBe(true);
    for (const byteLength of [2, 3136, DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES]) {
      expect(
        isDesktopSpeechAudioEvent({ ...identity, sequence: 1, kind: 'chunk', byteLength }),
      ).toBe(true);
      expect(isDesktopSpeechConsume({ ...identity, sequence: 1, byteLength })).toBe(true);
    }
    for (const byteLength of [0, 1, DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES + 2]) {
      expect(isDesktopSpeechConsume({ ...identity, sequence: 1, byteLength })).toBe(false);
    }
    expect(isDesktopSpeechPlaybackIdentity({ ...identity, localOwner: binding })).toBe(false);
    expect(isDesktopSpeechPlaybackIdentity({ ...identity, localTaskId: undefined })).toBe(false);
    expect(matchesDesktopSpeechAudioHeader(identity, header)).toBe(true);
    for (const patch of [
      { requestId: 'another' },
      { bindingId: 'new-provider' },
      { serviceEpoch: 'new-epoch' },
      { segmentIndex: 1 },
    ]) {
      expect(matchesDesktopSpeechAudioHeader(identity, { ...header, ...patch })).toBe(false);
    }
  });
});

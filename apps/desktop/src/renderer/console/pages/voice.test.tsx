import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  APPLICATION_DEFAULTS,
  DEFAULT_VOICE_INPUT_SETTINGS,
  type DemoSnapshot,
  type VoiceInputSnapshot,
} from '@pet/contracts';
import type { VoiceInputState } from '../use-voice-input.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
const hook = vi.hoisted(() => ({ state: null as VoiceInputState | null }));
vi.mock('../use-voice-input.js', () => ({
  useVoiceInput: () => {
    if (!hook.state) throw new Error('Missing test voice state');
    return hook.state;
  },
}));
import { VoicePage } from './voice.js';
const noop = () => {};
function inputSnapshot(): VoiceInputSnapshot {
  return {
    version: 1,
    revision: 6,
    settings: DEFAULT_VOICE_INPUT_SETTINGS,
    engines: [
      { id: 'sensevoice', label: 'FunASR / SenseVoice', available: true, reason: null },
      {
        id: 'whisper-small',
        label: 'Whisper Small',
        available: false,
        reason: '需要下载固定 Small 模型',
      },
      { id: 'windows-sapi', label: 'Windows SAPI', available: true, reason: null },
      { id: 'openai', label: 'OpenAI 兼容转写', available: false, reason: '需要保存 API Key' },
    ],
    models: [
      {
        id: 'sensevoice-small-int8',
        label: 'SenseVoice Small INT8',
        cached: true,
        bytes: 239549735,
      },
      { id: 'whisper-small-int8', label: 'Whisper Small INT8', cached: false, bytes: 375485327 },
    ],
    active: true,
    talkKeyActive: true,
    keyConfigured: false,
    credentialStorageAvailable: true,
    download: null,
    error: null,
  };
}
function demoState(): DemoState {
  return {
    snapshot: {
      phase: 'idle',
      canRecord: true,
      settings: {
        autoSend: true,
        voiceOwner: { pluginId: 'pet.voice-chat', instanceId: 'default', generation: 1 },
        voiceRevision: 6,
        replyMode: 'demo',
        readError: null,
      },
      maxRecordingSeconds: 20,
      partialTranscript: '',
      transcript: '',
      error: null,
    } as unknown as DemoSnapshot,
    recording: null,
    left: null,
    level: null,
    pending: new Set(),
    startRecording: async () => {},
    endRecording: async () => {},
    cancelRecording: async () => {},
    refresh: noop,
  } as unknown as DemoState;
}
const app = {
  values: APPLICATION_DEFAULTS,
  saving: false,
  refresh: noop,
} as unknown as ApplicationState;
function render(demo: DemoState = demoState()): string {
  return renderToStaticMarkup(<VoicePage app={app} demo={demo} notify={noop} onGoToStart={noop} />);
}
beforeEach(() => {
  hook.state = {
    available: true,
    snapshot: inputSnapshot(),
    loading: false,
    busy: false,
    error: null,
    microphones: [],
    microphoneError: null,
    refresh: noop,
    refreshMicrophones: async () => {},
    saveSettings: async () => ({ ok: true, error: null }),
    saveApiKey: async () => ({ ok: true, error: null }),
    start: async () => ({ ok: true, error: null }),
    stop: async () => ({ ok: true, error: null }),
    installModel: async () => ({ ok: true, error: null }),
  };
});
it('shows the four actual engines and physical key without inventing microphone devices or live input', () => {
  const html = render();
  for (const name of ['FunASR / SenseVoice', 'Whisper Small', 'Windows SAPI', 'OpenAI 兼容转写'])
    expect(html).toContain(name);
  expect(html).toContain('data-testid="voice-talk-key"');
  expect(html).toContain('跟随系统默认');
  expect(html).toContain('尚未取得可选择的麦克风信息');
  expect(html).not.toContain('<meter');
  expect(html).not.toContain('虚拟麦克风');
  expect(html).toContain('250 ms');
  expect(html).toContain('data-testid="demo-record"');
});
it('reports actual cache/download progress for fixed Small Whisper', () => {
  const state = hook.state;
  if (!state?.snapshot) throw new Error('Missing test snapshot');
  const snapshot: VoiceInputSnapshot = {
    ...state.snapshot,
    settings: { ...DEFAULT_VOICE_INPUT_SETTINGS, engine: 'whisper-small' },
    download: {
      modelId: 'whisper-small-int8',
      receivedBytes: 1000000,
      totalBytes: 375485327,
      state: 'downloading',
      error: null,
    },
  };
  hook.state = { ...state, snapshot };
  const html = render();
  expect(html).toContain('375.5 MB');
  expect(html).toContain('<progress');
  expect(html).toContain('正在下载');
  expect(html).toContain('1.0 / 375.5 MB');
});
it('keeps cloud key presence separate from a successful service connection and never renders a saved secret', () => {
  const state = hook.state;
  if (!state?.snapshot) throw new Error('Missing test snapshot');
  const snapshot: VoiceInputSnapshot = {
    ...state.snapshot,
    keyConfigured: true,
    settings: {
      ...DEFAULT_VOICE_INPUT_SETTINGS,
      engine: 'openai',
      cloudBaseUrl: 'https://api.groq.com/openai/v1',
    },
  };
  hook.state = { ...state, snapshot };
  const html = render();
  expect(html).toContain('https://api.groq.com/openai/v1');
  expect(html).toContain('type="password"');
  expect(html).toContain('已保存 Key；尚未验证转写连接');
  expect(html).not.toContain('连接正常');
});
it('renders only the measured microphone level from the existing Demo owner', () => {
  const demo = demoState();
  demo.level = 0.25;
  demo.recording = { token: 'live-owner', seconds: 20 };
  demo.snapshot = { ...demo.snapshot, phase: 'recording' } as DemoSnapshot;
  const html = render(demo);
  expect(html).toContain('<meter');
  expect(html).toContain('value="0.25"');
  expect(html).toContain('data-testid="demo-record-end"');
  expect(html).not.toContain('data-testid="demo-record"');
});

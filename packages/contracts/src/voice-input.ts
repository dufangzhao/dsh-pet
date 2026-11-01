import type { KernelError, Result } from './errors.js';
import { LOCAL_ASR_MODELS, type LocalAsrModel } from './local-asr.js';

export const VOICE_INPUT_IPC = {
  snapshot: 'voice-input:v1:snapshot',
  changed: 'voice-input:v1:changed',
  saveSettings: 'voice-input:v1:save-settings',
  saveApiKey: 'voice-input:v1:save-api-key',
  start: 'voice-input:v1:start',
  stop: 'voice-input:v1:stop',
  installModel: 'voice-input:v1:install-model',
} as const;
export const VOICE_INPUT_PLUGIN_IDS = {
  local: 'pet.asr-local',
  cloud: 'pet.asr-cloud',
  voice: 'pet.voice-chat',
  talkKey: 'pet.talk-key',
} as const;
export const VOICE_INPUT_CLOUD_ORIGINS = [
  'https://api.openai.com',
  'https://api.groq.com',
  'https://api.siliconflow.cn',
  'https://api.siliconflow.com',
] as const;
export const VOICE_INPUT_ENGINES = [
  'sensevoice',
  'whisper-small',
  'windows-sapi',
  'openai',
] as const;
export type VoiceInputEngine = (typeof VOICE_INPUT_ENGINES)[number];
export interface VoiceInputSettings {
  readonly engine: VoiceInputEngine;
  readonly microphoneId: string;
  readonly talkKeyCode: string;
  readonly talkKeyLabel: string;
  readonly cloudModel: string;
  readonly cloudBaseUrl: string;
}
export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = Object.freeze({
  engine: 'sensevoice',
  microphoneId: '',
  talkKeyCode: 'AltRight',
  talkKeyLabel: '右 Alt',
  cloudModel: 'whisper-1',
  cloudBaseUrl: 'https://api.openai.com/v1',
});
/** Single physical keys only. Labels are host generated, never trusted from a renderer. */
export const TALK_KEYS: Readonly<
  Record<string, { readonly label: string; readonly virtualKey: number }>
> = Object.freeze({
  AltRight: { label: '右 Alt', virtualKey: 0xa5 },
  AltLeft: { label: '左 Alt', virtualKey: 0xa4 },
  ControlRight: { label: '右 Ctrl', virtualKey: 0xa3 },
  ControlLeft: { label: '左 Ctrl', virtualKey: 0xa2 },
  ShiftRight: { label: '右 Shift', virtualKey: 0xa1 },
  ShiftLeft: { label: '左 Shift', virtualKey: 0xa0 },
  CapsLock: { label: 'Caps Lock', virtualKey: 0x14 },
  Space: { label: '空格', virtualKey: 0x20 },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      'F' + (i + 1),
      { label: 'F' + (i + 1), virtualKey: 0x70 + i },
    ]),
  ),
});
export const WHISPER_SMALL_MODEL: LocalAsrModel = {
  id: 'whisper-small-int8',
  name: 'Whisper Small INT8',
  streaming: false,
  source: 'Hugging Face',
  repository: 'csukuangfj/sherpa-onnx-whisper-small',
  revision: '8f3c18b358db4d1f2fc1eae49d75cd20989e4309',
  files: [
    {
      name: 'small-encoder.int8.onnx',
      bytes: 112442483,
      sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9',
      url: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/8f3c18b358db4d1f2fc1eae49d75cd20989e4309/small-encoder.int8.onnx',
    },
    {
      name: 'small-decoder.int8.onnx',
      bytes: 262226114,
      sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee',
      url: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/8f3c18b358db4d1f2fc1eae49d75cd20989e4309/small-decoder.int8.onnx',
    },
    {
      name: 'small-tokens.txt',
      bytes: 816730,
      gitBlobSha1: 'a4edf0b719c10d28cd83f8c294449f99ff5d5dc0',
      url: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/8f3c18b358db4d1f2fc1eae49d75cd20989e4309/small-tokens.txt',
    },
  ],
};
export const VOICE_INPUT_LOCAL_MODELS: readonly LocalAsrModel[] = [
  ...LOCAL_ASR_MODELS,
  WHISPER_SMALL_MODEL,
];
export function voiceInputModel(engine: VoiceInputEngine): string {
  return engine === 'sensevoice'
    ? 'sensevoice-small-int8'
    : engine === 'whisper-small'
      ? WHISPER_SMALL_MODEL.id
      : engine;
}
export interface VoiceInputSnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly settings: VoiceInputSettings;
  readonly engines: readonly {
    readonly id: VoiceInputEngine;
    readonly label: string;
    readonly available: boolean;
    readonly reason: string | null;
  }[];
  readonly models: readonly {
    readonly id: string;
    readonly label: string;
    readonly cached: boolean;
    readonly bytes: number;
  }[];
  readonly active: boolean;
  readonly talkKeyActive: boolean;
  readonly keyConfigured: boolean;
  readonly credentialStorageAvailable: boolean;
  readonly download: {
    readonly modelId: string;
    readonly receivedBytes: number;
    readonly totalBytes: number;
    readonly state: 'downloading' | 'complete' | 'error';
    readonly error: KernelError | null;
  } | null;
  readonly error: KernelError | null;
}
export interface VoiceInputBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<VoiceInputSnapshot>>;
  onChanged(listener: () => void): () => void;
  saveSettings(request: {
    expectedRevision: number;
    data: VoiceInputSettings;
  }): Promise<Result<VoiceInputSnapshot>>;
  saveApiKey(request: { value: string }): Promise<Result<VoiceInputSnapshot>>;
  start(): Promise<Result<VoiceInputSnapshot>>;
  stop(): Promise<Result<VoiceInputSnapshot>>;
  installModel(request: { modelId: string }): Promise<Result<VoiceInputSnapshot>>;
}

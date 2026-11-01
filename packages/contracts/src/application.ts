import type { JsonObject, JsonValue } from './json.js';
import {
  PET_PREFERENCE_DEFAULTS,
  PET_PREFERENCE_PROPERTIES,
  type PetPreferences,
} from './pet-preferences.js';
import type { SpeechOutputProviderSelection } from './speech-output.js';
import type { OwnerRef } from './ids.js';
import type { KernelError, Result } from './errors.js';

export const APPLICATION_PLUGIN_IDS = {
  profile: 'pet.profile',
  agent: 'pet.agent-cortico',
  start: 'pet.page-start',
  persona: 'pet.page-persona',
  appearance: 'pet.page-appearance',
  conversation: 'pet.page-conversation',
  voice: 'pet.voice-chat',
} as const;
export const APPLICATION_PROFILE_MAX_PROMPT = 16384;
export interface ApplicationPreferences extends PetPreferences {
  speechEnabled: boolean;
  speechProvider: SpeechOutputProviderSelection | null;
  speechVoice: string | null;
  speechRate: number;
  speechVolume: number;
  petName: string;
  userName: string;
  replyLanguage: 'zh-CN' | 'en';
  style: 'quiet' | 'natural' | 'lively';
  personaPrompt: string;
  figure: 'minimal' | 'round';
  palette: 'morning' | 'lavender' | 'pine' | 'orange';
  size: 'small' | 'normal' | 'large';
  visible: boolean;
  alwaysOnTop: boolean;
  draggable: boolean;
  reducedMotion: boolean;
  voiceEnabled: boolean;
}
export const APPLICATION_DEFAULTS: Readonly<ApplicationPreferences> = Object.freeze({
  ...PET_PREFERENCE_DEFAULTS,
  speechEnabled: true,
  speechProvider: { pluginId: 'pet.system-tts', instanceId: 'default', providerId: 'system' },
  speechVoice: null,
  speechRate: 0,
  speechVolume: 85,
  petName: '小蓝',
  userName: '你',
  replyLanguage: 'zh-CN',
  style: 'natural',
  personaPrompt:
    'You are a desktop companion. Be attentive, clear and useful. Respond through the available pet tools. Describe only actions that actually succeeded. Ask for missing information when necessary. Respect the human choices and permissions.',
  figure: 'minimal',
  palette: 'morning',
  size: 'normal',
  visible: true,
  alwaysOnTop: true,
  draggable: true,
  reducedMotion: false,
  voiceEnabled: true,
});
export const APPLICATION_PROFILE_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(APPLICATION_DEFAULTS),
  properties: {
    ...PET_PREFERENCE_PROPERTIES,
    speechEnabled: { type: 'boolean', default: true, title: '说话' },
    speechProvider: {
      type: ['object', 'null'],
      title: '语音输出提供者',
      additionalProperties: false,
      required: ['pluginId', 'instanceId', 'providerId'],
      properties: {
        pluginId: { type: 'string', minLength: 1, maxLength: 128 },
        instanceId: { type: 'string', minLength: 1, maxLength: 128 },
        providerId: { type: 'string', minLength: 1, maxLength: 128 },
      },
      default: APPLICATION_DEFAULTS.speechProvider,
    },
    speechVoice: { type: ['string', 'null'], maxLength: 256, default: null, title: '声线' },
    speechRate: { type: 'integer', minimum: -10, maximum: 10, default: 0, title: '语速' },
    speechVolume: { type: 'integer', minimum: 0, maximum: 100, default: 85, title: '说话音量' },
    petName: {
      type: 'string',
      title: '桌宠名字',
      minLength: 1,
      maxLength: 40,
      default: APPLICATION_DEFAULTS.petName,
    },
    userName: {
      type: 'string',
      title: '称呼你',
      minLength: 1,
      maxLength: 40,
      default: APPLICATION_DEFAULTS.userName,
    },
    replyLanguage: {
      type: 'string',
      title: '回复语言',
      enum: ['zh-CN', 'en'],
      default: APPLICATION_DEFAULTS.replyLanguage,
    },
    style: {
      type: 'string',
      title: '表达方式',
      enum: ['quiet', 'natural', 'lively'],
      default: APPLICATION_DEFAULTS.style,
    },
    personaPrompt: {
      type: 'string',
      title: '完整人设提示词',
      minLength: 1,
      maxLength: APPLICATION_PROFILE_MAX_PROMPT,
      default: APPLICATION_DEFAULTS.personaPrompt,
    },
    figure: {
      type: 'string',
      title: '形象',
      enum: ['minimal', 'round'],
      default: APPLICATION_DEFAULTS.figure,
    },
    palette: {
      type: 'string',
      title: '配色',
      enum: ['morning', 'lavender', 'pine', 'orange'],
      default: APPLICATION_DEFAULTS.palette,
    },
    size: {
      type: 'string',
      title: '大小',
      enum: ['small', 'normal', 'large'],
      default: APPLICATION_DEFAULTS.size,
    },
    visible: { type: 'boolean', title: '在桌面显示', default: true },
    alwaysOnTop: { type: 'boolean', title: '保持置顶', default: true },
    draggable: { type: 'boolean', title: '允许拖动', default: true },
    reducedMotion: { type: 'boolean', title: '减少动画', default: false },
    voiceEnabled: { type: 'boolean', title: '语音输入', default: true },
  },
};
export interface ApplicationProfile {
  readonly owner: OwnerRef;
  readonly revision: number;
  readonly data: Readonly<ApplicationPreferences>;
}
export interface ApplicationPromptSegment {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly note?: string;
}
export type ApplicationPromptState = 'saved' | 'pending' | 'applied' | 'error';
export type ApplicationInteractionKind = 'user' | 'pet' | 'interaction' | 'application';
export interface ApplicationInteraction {
  readonly id: string;
  readonly cursor: number;
  readonly at: number;
  readonly kind: ApplicationInteractionKind;
  readonly text: string;
  readonly via?: 'bubble' | 'console' | 'voice';
  readonly mode?: 'demo' | 'deepseek';
  readonly reaction?: 'poke' | 'pat' | 'drag' | 'blush' | 'happy';
}
export interface ApplicationChoice {
  readonly id: string;
  readonly label: string;
  readonly primary?: boolean;
}
export interface ApplicationDialog {
  readonly id: string;
  readonly step: string;
  readonly title: string;
  readonly text: string;
  readonly choices: readonly ApplicationChoice[];
  readonly input?: {
    readonly kind: 'text' | 'secret';
    readonly label: string;
    readonly placeholder?: string;
  };
  readonly error?: string;
  readonly busy: boolean;
}
export interface ApplicationPage {
  readonly actions?: readonly {
    readonly panelId: string;
    readonly method: string;
    readonly label: string;
  }[];
  readonly id: string;
  readonly owner: OwnerRef;
  readonly title: string;
  readonly order: number;
  /** Public Cortico manifest projection; callbacks and host services stay server-side. */
  readonly manifest: JsonObject;
}
export interface ApplicationHistoryPage {
  readonly items: readonly ApplicationInteraction[];
  readonly cursor: number;
  readonly before: number | null;
  readonly more: boolean;
}
export interface ApplicationSnapshot {
  readonly desktop?: { readonly available: boolean; readonly shown: boolean };
  readonly historyBefore?: number | null;
  readonly historyHasEarlier?: boolean;
  readonly version: 1;
  readonly profile: ApplicationProfile | null;
  readonly pages: readonly ApplicationPage[];
  readonly history: readonly ApplicationInteraction[];
  readonly cursor: number;
  readonly prompt: {
    readonly state: ApplicationPromptState;
    readonly appliedRevision: number | null;
    readonly segments: readonly ApplicationPromptSegment[];
  };
  readonly dialog: ApplicationDialog | null;
  readonly agent: {
    readonly owner: OwnerRef | null;
    readonly state: 'starting' | 'ready' | 'stopped' | 'error';
    readonly label: string;
  };
  readonly error: KernelError | null;
}
export interface ApplicationBridge {
  getHistory?(request: {
    readonly before?: number;
    readonly limit: number;
  }): Promise<Result<ApplicationHistoryPage>>;
  getSnapshot(): Promise<Result<ApplicationSnapshot>>;
  onChanged(listener: () => void): () => void;
  saveProfile(request: {
    readonly expectedRevision: number;
    readonly data: ApplicationPreferences;
  }): Promise<Result<ApplicationSnapshot>>;
  interact(request: {
    readonly kind: 'poke' | 'pat' | 'drag' | 'blush' | 'happy';
    readonly via: 'bubble' | 'console';
  }): Promise<Result<null>>;
  answer(request: {
    readonly id: string;
    readonly step: string;
    readonly choice: string;
    readonly text?: string;
  }): Promise<Result<ApplicationSnapshot>>;
  startGuide(): Promise<Result<ApplicationSnapshot>>;
  runPageAction(request: {
    readonly owner: OwnerRef;
    readonly pageId: string;
    readonly panelId: string;
    readonly method: string;
    readonly data: JsonValue;
  }): Promise<Result<JsonValue>>;
}
export const APPLICATION_IPC = {
  snapshot: 'application:v1:snapshot',
  history: 'application:v1:history',
  changed: 'application:v1:changed',
  profile: 'application:v1:profile',
  interaction: 'application:v1:interaction',
  answer: 'application:v1:answer',
  guide: 'application:v1:guide',
  pageAction: 'application:v1:page-action',
} as const;

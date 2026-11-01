import type { JsonObject } from './json.js';

export interface PersonaTemplate extends JsonObject {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
}
export interface PetPreferences extends JsonObject {
  roam: 'free' | 'calm' | 'off';
  wake: 'none' | 'poke' | 'all' | 'custom';
  self: 'off' | 'default' | 'any' | 'custom';
  hover: string[];
  bubbleFontSize: number;
  bubbleSpeed: number;
  glow: number;
  frameRate: '60' | '120' | '144' | 'unlimited';
  snoreSeconds: number;
  personaTemplate: string;
  personaTemplates: PersonaTemplate[];
  wakePoke: boolean;
  wakePat: boolean;
  wakeThrow: boolean;
  wakeDrop: boolean;
  selfFigure: boolean;
  selfPalette: boolean;
  selfRoam: boolean;
  selfSnore: boolean;
  selfSize: boolean;
  selfBubble: boolean;
  selfFont: boolean;
  selfSound: boolean;
  selfTheme: boolean;
  selfHover: boolean;
  selfUser: boolean;
  doubleClickTyping: boolean;
  statusBubble: boolean;
  saidBubble: boolean;
  hideInFullscreen: boolean;
  rememberPosition: boolean;
  lockFps: boolean;
  soundEnabled: boolean;
  soundMove: boolean;
  soundTouch: boolean;
  soundFace: boolean;
  soundSnore: boolean;
  soundUi: boolean;
}

export const PET_PREFERENCE_DEFAULTS: Readonly<PetPreferences> = {
  roam: 'calm',
  wake: 'poke',
  self: 'default',
  hover: ['chat', 'voice'],
  bubbleFontSize: 100,
  bubbleSpeed: 100,
  glow: 0,
  frameRate: '60',
  snoreSeconds: 0,
  personaTemplate: 'default',
  personaTemplates: [
    {
      id: 'default',
      name: '默认',
      prompt: '你是一只温和、清楚表达的桌面伙伴。尊重用户的节奏，只描述已经发生的事情。',
      builtin: true,
    },
    {
      id: 'warm',
      name: '温柔',
      prompt: '你是一只安静、体贴的桌面伙伴。用简短自然的话倾听，不夸大承诺。',
      builtin: true,
    },
    {
      id: 'lively',
      name: '活泼',
      prompt: '你是一只轻快、有好奇心的桌面伙伴。回应自然，玩笑克制，尊重用户边界。',
      builtin: true,
    },
    {
      id: 'rational',
      name: '理性',
      prompt: '你是一只平和、务实的桌面伙伴。先讲结论，区分事实和推测，帮助用户专注。',
      builtin: true,
    },
  ],
  wakePoke: true,
  wakePat: true,
  wakeThrow: false,
  wakeDrop: false,
  selfFigure: true,
  selfPalette: true,
  selfRoam: true,
  selfSnore: true,
  selfSize: false,
  selfBubble: false,
  selfFont: false,
  selfSound: false,
  selfTheme: false,
  selfHover: false,
  selfUser: false,
  doubleClickTyping: true,
  statusBubble: true,
  saidBubble: true,
  hideInFullscreen: false,
  rememberPosition: true,
  lockFps: false,
  soundEnabled: true,
  soundMove: true,
  soundTouch: true,
  soundFace: true,
  soundSnore: true,
  soundUi: true,
};

export const PET_PREFERENCE_PROPERTIES: JsonObject = {
  roam: {
    type: 'string',
    enum: ['free', 'calm', 'off'],
    title: '走动',
    default: 'calm',
  },
  wake: {
    type: 'string',
    enum: ['none', 'poke', 'all', 'custom'],
    title: '回应模式',
    default: 'poke',
  },
  self: {
    type: 'string',
    enum: ['off', 'default', 'any', 'custom'],
    title: '自主配置',
    default: 'default',
  },
  hover: {
    type: 'array',
    items: {
      type: 'string',
      maxLength: 32,
      enum: ['chat', 'voice', 'roam', 'theme', 'sound', 'dress', 'hide'],
    },
    maxItems: 6,
    uniqueItems: true,
    title: '悬停按钮',
    default: ['chat', 'voice'],
  },
  bubbleFontSize: {
    type: 'integer',
    minimum: 80,
    maximum: 160,
    title: '气泡字体百分比',
    default: 100,
  },
  bubbleSpeed: {
    type: 'integer',
    minimum: 50,
    maximum: 200,
    title: '气泡速度百分比',
    default: 100,
  },
  glow: {
    type: 'integer',
    minimum: 0,
    maximum: 16,
    title: '外发光',
    default: 0,
  },
  frameRate: {
    type: 'string',
    enum: ['60', '120', '144', 'unlimited'],
    title: '目标帧率',
    default: '60',
  },
  snoreSeconds: {
    type: 'integer',
    minimum: 0,
    maximum: 30,
    title: '呼噜时长',
    default: 0,
  },
  personaTemplate: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    title: '当前人格模板',
    default: 'default',
  },
  personaTemplates: {
    type: 'array',
    maxItems: 16,
    title: '人格模板库',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'prompt', 'builtin'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 40,
        },
        prompt: {
          type: 'string',
          minLength: 1,
          maxLength: 16384,
        },
        builtin: {
          type: 'boolean',
        },
      },
    },
    default: [
      {
        id: 'default',
        name: '默认',
        prompt: '你是一只温和、清楚表达的桌面伙伴。尊重用户的节奏，只描述已经发生的事情。',
        builtin: true,
      },
      {
        id: 'warm',
        name: '温柔',
        prompt: '你是一只安静、体贴的桌面伙伴。用简短自然的话倾听，不夸大承诺。',
        builtin: true,
      },
      {
        id: 'lively',
        name: '活泼',
        prompt: '你是一只轻快、有好奇心的桌面伙伴。回应自然，玩笑克制，尊重用户边界。',
        builtin: true,
      },
      {
        id: 'rational',
        name: '理性',
        prompt: '你是一只平和、务实的桌面伙伴。先讲结论，区分事实和推测，帮助用户专注。',
        builtin: true,
      },
    ],
  },
  wakePoke: {
    type: 'boolean',
    title: 'wakePoke',
    default: true,
  },
  wakePat: {
    type: 'boolean',
    title: 'wakePat',
    default: true,
  },
  wakeThrow: {
    type: 'boolean',
    title: 'wakeThrow',
    default: false,
  },
  wakeDrop: {
    type: 'boolean',
    title: 'wakeDrop',
    default: false,
  },
  selfFigure: {
    type: 'boolean',
    title: 'selfFigure',
    default: true,
  },
  selfPalette: {
    type: 'boolean',
    title: 'selfPalette',
    default: true,
  },
  selfRoam: {
    type: 'boolean',
    title: 'selfRoam',
    default: true,
  },
  selfSnore: {
    type: 'boolean',
    title: 'selfSnore',
    default: true,
  },
  selfSize: {
    type: 'boolean',
    title: 'selfSize',
    default: false,
  },
  selfBubble: {
    type: 'boolean',
    title: 'selfBubble',
    default: false,
  },
  selfFont: {
    type: 'boolean',
    title: 'selfFont',
    default: false,
  },
  selfSound: {
    type: 'boolean',
    title: 'selfSound',
    default: false,
  },
  selfTheme: {
    type: 'boolean',
    title: 'selfTheme',
    default: false,
  },
  selfHover: {
    type: 'boolean',
    title: 'selfHover',
    default: false,
  },
  selfUser: {
    type: 'boolean',
    title: 'selfUser',
    default: false,
  },
  doubleClickTyping: {
    type: 'boolean',
    title: 'doubleClickTyping',
    default: true,
  },
  statusBubble: {
    type: 'boolean',
    title: 'statusBubble',
    default: true,
  },
  saidBubble: {
    type: 'boolean',
    title: 'saidBubble',
    default: true,
  },
  hideInFullscreen: {
    type: 'boolean',
    title: 'hideInFullscreen',
    default: false,
  },
  rememberPosition: {
    type: 'boolean',
    title: 'rememberPosition',
    default: true,
  },
  lockFps: {
    type: 'boolean',
    title: 'lockFps',
    default: false,
  },
  soundEnabled: {
    type: 'boolean',
    title: 'soundEnabled',
    default: true,
  },
  soundMove: {
    type: 'boolean',
    title: 'soundMove',
    default: true,
  },
  soundTouch: {
    type: 'boolean',
    title: 'soundTouch',
    default: true,
  },
  soundFace: {
    type: 'boolean',
    title: 'soundFace',
    default: true,
  },
  soundSnore: {
    type: 'boolean',
    title: 'soundSnore',
    default: true,
  },
  soundUi: {
    type: 'boolean',
    title: 'soundUi',
    default: true,
  },
};

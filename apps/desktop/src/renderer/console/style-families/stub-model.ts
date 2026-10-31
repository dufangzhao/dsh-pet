/**
 * 两族共用的假 model：只给渲染要读的值与动作，不新建任何所有者。
 * 断言盯的是「这一族真的画了哪一种控件」，不是快照里那几百个字符。
 */
import type { StartModel } from '../start-designs/use-start-model.js';

export interface StubChoice {
  id: string;
  label: string;
  available: boolean;
  current: boolean;
  mark: 'in-use' | 'saved' | 'draft' | 'available' | 'unavailable';
  auth?: 'key' | 'browser';
  region?: 'cn' | 'intl';
  dirty?: boolean;
  models?: string[];
}

const choiceOf = (input: StubChoice) => ({
  service: {
    id: input.id,
    label: input.label,
    service: input.label,
    region: input.region ?? 'cn',
    auth: input.auth ?? 'key',
    available: input.available,
    ...(input.available ? {} : { unavailableReason: '这台机器上还没装这一家' }),
    models: input.models ?? [input.id + '-flash'],
    defaultModel: input.id + '-flash',
    keyHint: '去这家控制台复制一个 Key 贴进来。',
  },
  row: {
    name: input.label,
    main: { id: input.id, label: input.label },
  },
  current: input.current,
  mark: input.mark,
  keySaved: input.mark === 'in-use' || input.mark === 'saved',
  dirty: input.dirty ?? false,
});

export function stubModel(over: Partial<StartModel> = {}): StartModel {
  const choices = [
    {
      id: 'deepseek-cn',
      label: 'DeepSeek',
      available: true,
      current: true,
      mark: 'in-use' as const,
    },
    { id: 'kimi-intl', label: 'Kimi', available: true, current: false, mark: 'available' as const },
    {
      id: 'glm-cn',
      label: '智谱',
      available: false,
      current: false,
      mark: 'unavailable' as const,
      auth: 'browser' as const,
    },
  ].map(choiceOf);

  const base = {
    available: true,
    loading: false,
    error: null,
    notice: null,
    phase: 'in-use',
    paused: false,
    snapshotLabel: 'DeepSeek · deepseek-chat',
    activeId: 'deepseek-cn',
    activeLabel: 'DeepSeek',
    saveTargetId: 'deepseek-cn',
    rows: [
      { name: 'DeepSeek', main: { id: 'deepseek-cn', label: 'DeepSeek' } },
      { name: 'Kimi', main: { id: 'kimi-intl', label: 'Kimi' } },
      { name: '智谱', main: { id: 'glm-cn', label: '智谱' } },
    ],
    choices,
    query: '',
    setQuery: () => undefined,
    picked: choices[0]?.service,
    pickedId: null,
    inUse: true,
    mark: 'in-use' as const,
    keySaved: true,
    dirty: false,
    sibling: {
      id: 'deepseek-intl',
      label: 'DeepSeek 国际',
      service: 'DeepSeek',
      region: 'intl',
      auth: 'key',
      models: [],
      available: true,
    },
    model: 'deepseek-chat',
    key: '',
    reasoningEffort: 'default',
    setReasoningEffort: () => undefined,
    modelList: {
      fetching: false,
      options: ['deepseek-chat'],
      error: null,
      notice: null,
      allowed: true,
    },
    getModels: () => undefined,
    setModel: () => undefined,
    setKey: () => undefined,
    can: { save: true, test: true, signIn: false },
    reasons: { save: null, test: null, signIn: '这一家在这台机器上还没接进来。' },
    keyBlock: null,
    busy: {
      saving: false,
      testing: false,
      signingIn: false,
      sending: false,
      visibility: false,
      pausing: false,
    },
    saved: null,
    tested: null,
    signing: null,
    pick: () => undefined,
    save: () => undefined,
    test: () => undefined,
    signIn: () => undefined,
    cancelSignIn: () => undefined,
    openKeyPage: () => undefined,
    switchRegion: () => undefined,
    togglePaused: () => undefined,
    refresh: () => undefined,
    openPlugins: () => undefined,
    appAvailable: true,
    desktopAvailable: true,
    desktopShown: true,
    desktop: { mark: 'on' as const, text: '在桌面上' },
    pet: {
      values: {
        petName: '小满',
        figure: 'minimal',
        palette: 'morning',
        size: 'normal',
        draggable: true,
      },
      agent: { state: 'ready' },
      state: 'idle',
      bubble: '我在桌面上站着。',
      interact: async () => ({ ok: true }),
      mic: {
        canRecord: true,
        recording: false,
        secondsLeft: null,
        secondsLimit: 30,
        unavailable: null,
        start: () => undefined,
        end: () => undefined,
        cancel: () => undefined,
      },
      composer: { canSend: true, sending: false, onSend: async () => true },
      onOpenVoiceSettings: () => undefined,
      onOpenDress: () => undefined,
    },
    setDesktopVisible: () => undefined,
    goToView: () => undefined,
  };

  return { ...base, ...over } as unknown as StartModel;
}

/** 这一族不该出现的旧板件与旧 Start 控件：类名前缀一出现就说明是换 CSS 而不是换控件。 */
export const FOREIGN_KIT = [
  'pb-btn',
  'pb-field',
  'pb-input',
  'pb-status',
  'pb-tile',
  'pb-toggle',
  'sc-section',
];

export function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

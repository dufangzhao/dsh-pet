import type { JSX } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  ApplicationPreferences,
  ConsoleSnapshot,
  ApplicationSnapshot,
  DemoPhase,
  DemoReplyMode,
  DemoSnapshot,
} from '@pet/contracts';
import { APPLICATION_DEFAULTS } from '@pet/contracts';

import type { ApplicationOutcome, ApplicationState } from '../use-application.js';
import type { DemoOutcome, DemoState } from '../use-demo.js';
import type { ModelConnectionSnapshot, ModelService, SavedModelEndpoint } from '@pet/contracts';
import type { ModelConnectionState } from '../use-model-connection.js';
import type { ApplicationPage } from '@pet/contracts';
import { AppearancePage } from './appearance.js';
import { GenericPage } from './generic-page.js';
import { ConversationPage } from './conversation.js';
import { PersonaPage } from './persona.js';
import { StartPage } from './start.js';
import { PluginsPage } from './plugins.js';

/**
 * 只断言用户看得到的话与按钮状态。这一批用例守的是四句不许说谎：
 * 保存过不等于已生效；没接 Key 不是缺项；离线回复带着「离线」；
 * 桥不在就说没连上，不画一份假表单。
 */
const noop = (): void => undefined;

const prefs: ApplicationPreferences = { ...APPLICATION_DEFAULTS };

const OK: DemoOutcome = { ok: true, error: null };

function demoSnapshot(over: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    version: 1,
    phase: 'idle' as DemoPhase,
    intentId: null,
    settings: {
      asrOwner: null,
      asrRevision: 0,
      modelId: null,
      voiceOwner: null,
      voiceRevision: 0,
      replyMode: 'demo' as DemoReplyMode,
      autoSend: false,
      readError: null,
    },
    plugins: [],
    models: [],
    preparedModelId: null,
    canRecord: true,
    canSend: true,
    transcript: '',
    partialTranscript: '',
    partialReply: '',
    messages: [],
    recordingStartedAt: null,
    maxRecordingSeconds: 20,
    error: null,
    keyAvailable: true,
    keyConfigured: false,
    avatarEnabled: true,
    ...over,
  };
}

function demoState(value: DemoSnapshot): DemoState {
  return {
    available: true,
    snapshot: value,
    loading: false,
    error: null,
    refresh: noop,
    pending: new Set(),
    sendText: async () => OK,
    cancel: async () => OK,
    clearHistory: async () => OK,
    saveProviderKey: async () => OK,
    removeProviderKey: async () => OK,
    recording: null,
    left: null,
    startRecording: async () => undefined,
    endRecording: async () => undefined,
    cancelRecording: async () => undefined,
  };
}

function appState(over: Partial<ApplicationState> = {}): ApplicationState {
  const snapshot: ApplicationSnapshot = {
    version: 1,
    profile: {
      owner: { pluginId: 'pet.profile', instanceId: 'i1', generation: 1 },
      revision: 3,
      data: prefs,
    },
    pages: [],
    history: [],
    cursor: 0,
    prompt: { state: 'applied', appliedRevision: 3, segments: [] },
    dialog: null,
    agent: { owner: null, state: 'ready', label: '回复来源：离线脚本演示' },
    error: null,
  };
  const current = over.snapshot === undefined ? snapshot : over.snapshot;
  return {
    available: true,
    snapshot: current,
    loading: false,
    error: null,
    refresh: noop,
    values: current?.profile == null ? null : current.profile.data,
    edited: new Set(),
    saving: false,
    conflict: false,
    edit: noop,
    save: async (): Promise<ApplicationOutcome> => ({ ok: true, error: null }),
    startGuide: async (): Promise<ApplicationOutcome> => ({ ok: true, error: null }),
    interact: async (): Promise<ApplicationOutcome> => ({ ok: true, error: null }),
    runPageAction: async (): Promise<ApplicationOutcome> => ({ ok: true, error: null }),
    // 时间线默认就是快照那一段；这里补的是「更早几页」的临时投影。
    history: current?.history ?? [],
    historyEarlier: false,
    historyLoading: false,
    historyError: null,
    loadEarlierHistory: noop,
    ...over,
  };
}

const render = (node: JSX.Element): string => renderToStaticMarkup(node);

function startProps(app: ApplicationState, models: ModelConnectionState = modelState()) {
  return {
    app,
    demo: demoState(demoSnapshot()),
    models,
    notify: noop,
    goToView: noop,
    onOpenPlugins: noop,
  };
}

/**
 * React 把 disabled="" 写在开标签的最前面，所以断言看整个开标签，
 * 不看某个属性后面是否还跟着它。
 */
function tag(html: string, testId: string): string {
  const at = html.indexOf('data-testid="' + testId + '"');
  if (at < 0) {
    throw new Error('缺少 testid：' + testId);
  }
  const open = html.lastIndexOf('<', at);
  const close = html.indexOf('>', at);
  return html.slice(open, close + 1);
}

/* ---- 模型连接：目录里两家，一家有两块平台，另一家全局 ---- */

const deepseek: ModelService = {
  id: 'deepseek',
  label: 'DeepSeek',
  region: 'global',
  service: 'deepseek',
  defaultModel: 'deepseek-flash',
  models: ['deepseek-flash', 'deepseek-chat'],
  keyHint: '粘贴 API Key',
  keyUrl: 'https://example.invalid/keys',
  auth: 'api-key',
  available: true,
};

const qwen: ModelService = {
  ...deepseek,
  id: 'qwen',
  label: '通义千问',
  region: 'cn',
  service: 'qwen',
};
const qwenIntl: ModelService = { ...qwen, id: 'qwen-intl', region: 'intl' };

function modelSnapshot(over: Partial<ModelConnectionSnapshot> = {}): ModelConnectionSnapshot {
  const endpoints: SavedModelEndpoint[] = [];
  return {
    revision: 4,
    services: [deepseek, qwen, qwenIntl],
    endpoints,
    active: null,
    paused: false,
    credentialStorageAvailable: true,
    ...over,
  };
}

function modelState(over: Partial<ModelConnectionState> = {}): ModelConnectionState {
  const never = async (): Promise<never> => {
    throw new Error('这条用例不触发写入');
  };
  return {
    available: true,
    snapshot: modelSnapshot(),
    loading: false,
    error: null,
    saving: false,
    testing: false,
    pausing: false,
    signIn: null,
    signingIn: false,
    refresh: noop,
    saveAndStart: never,
    testActive: never,
    testSelected: never,
    getModels: never,
    setPaused: never,
    openServicePage: never,
    signInAndStart: never,
    cancelSignIn: never,
    ...over,
  };
}

describe('人设页', () => {
  it('待生效不写成已生效，收到 applied 才说已生效', () => {
    const app = appState();
    const pending = renderToStaticMarkup(
      <PersonaPage
        app={appState({
          snapshot: {
            ...(app.snapshot as ApplicationSnapshot),
            prompt: { state: 'pending', appliedRevision: 3, segments: [] },
          },
        })}
        notify={noop}
      />,
    );
    expect(pending).toContain('等待当前处理结束后生效');
    expect(pending).not.toContain('>已生效<');
    expect(renderToStaticMarkup(<PersonaPage app={app} notify={noop} />)).toContain('>已生效<');
  });

  it('名字与存的一致时保存是空操作，改过才提示还没保存', () => {
    const same = renderToStaticMarkup(<PersonaPage app={appState()} notify={noop} />);
    expect(same).not.toContain('名字还没保存');
    expect(same).toMatch(/disabled[^>]*>\s*保存名字/);

    const edited = appState({ edited: new Set(['petName']) });
    const html = renderToStaticMarkup(<PersonaPage app={edited} notify={noop} />);
    expect(html).toContain('名字还没保存');
    expect(html).not.toMatch(/disabled[^>]*>\s*保存名字/);
  });

  it('新桥不在时只说没连上，不画一份能编辑的假表单', () => {
    const html = renderToStaticMarkup(
      <PersonaPage
        app={appState({ available: false, snapshot: null, values: null })}
        notify={noop}
      />,
    );
    expect(html).toContain('页面没有连上应用');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('保存正文');
  });
});

describe('装扮页', () => {
  it('两个形态、四个配色、三个大小都可选，当前值被选中', () => {
    const html = renderToStaticMarkup(<AppearancePage app={appState()} notify={noop} />);
    expect(html).toContain('简约');
    expect(html).toContain('圆头');
    for (const name of ['晨蓝', '雪青', '松墨', '柿橙']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('适中');
    expect(html.match(/checked/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('在桌面显示桌宠');
  });
});

describe('对话页', () => {
  it('四类事件用固定的中文词，离线回复带着「离线」', () => {
    const snapshot = appState().snapshot as ApplicationSnapshot;
    const withHistory: ApplicationSnapshot = {
      ...snapshot,
      history: [
        { id: '1', cursor: 1, at: 1, kind: 'interaction', text: '你戳了它一下', via: 'bubble' },
        { id: '2', cursor: 2, at: 2, kind: 'user', text: '现在几点', via: 'voice' },
        { id: '3', cursor: 3, at: 3, kind: 'pet', text: '离线脚本演示：十点整', mode: 'demo' },
        { id: '4', cursor: 4, at: 4, kind: 'application', text: '偏好已保存' },
      ],
    };
    const html = renderToStaticMarkup(
      <ConversationPage
        app={appState({ snapshot: withHistory, values: withHistory.profile?.data ?? null })}
        demo={demoState(demoSnapshot())}
        notify={noop}
      />,
    );
    for (const word of ['动作', '我说', '桌宠说', '状态']) {
      expect(html).toContain(word);
    }
    expect(html).toContain('用语音');
    expect(html).toContain('>离线<');
  });

  it('还没有记录时给出下一步，而不是空白', () => {
    const html = renderToStaticMarkup(
      <ConversationPage app={appState()} demo={demoState(demoSnapshot())} notify={noop} />,
    );
    expect(html).toContain('还没有日常互动记录');
    expect(html).toContain('碰它一下');
  });

  it('只有还能读到更早记录时才给加载按钮；读失败保留已有记录并说明原因', () => {
    const history = [{ id: '4', cursor: 4, at: 4, kind: 'user' as const, text: '现在几点' }];
    const demo = demoState(demoSnapshot());
    const withEarlier = renderToStaticMarkup(
      <ConversationPage
        app={appState({ history, historyEarlier: true })}
        demo={demo}
        notify={noop}
      />,
    );
    expect(withEarlier).toContain('加载更早记录');

    const withoutEarlier = renderToStaticMarkup(
      <ConversationPage app={appState({ history })} demo={demo} notify={noop} />,
    );
    expect(withoutEarlier).not.toContain('加载更早记录');

    const failed = renderToStaticMarkup(
      <ConversationPage
        app={appState({
          history,
          historyEarlier: true,
          historyError: '设置台没有响应，请稍后重试。',
        })}
        demo={demo}
        notify={noop}
      />,
    );
    expect(failed).toContain('更早的记录没有读出来');
    // 读不到更早的页，不等于已有记录不对：原来那条要还在。
    expect(failed).toContain('现在几点');
  });
});

describe('外部扩展的一页', () => {
  it('宿主声明了 actions 才画真实按钮；没有就不出现这一块', () => {
    const page = (
      actions?: { panelId: string; method: string; label: string }[],
    ): ApplicationPage => ({
      id: 'community.page',
      owner: { pluginId: 'community.translator', instanceId: 'i', generation: 1 },
      title: '翻译',
      order: 40,
      manifest: {},
      ...(actions === undefined ? {} : { actions }),
    });
    const props = {
      app: appState(),
      onBack: noop,
      onDirtyChange: noop,
      notify: noop,
    };
    const withAction = renderToStaticMarkup(
      <GenericPage
        {...props}
        page={page([{ panelId: 'main', method: 'refresh', label: '更新一次词库' }])}
      />,
    );
    expect(withAction).toContain('更新一次词库');
    expect(withAction).toContain('这一页能做的事');
    expect(renderToStaticMarkup(<GenericPage {...props} page={page()} />)).not.toContain(
      '这一页能做的事',
    );
  });
});

describe('开始页', () => {
  it('模型桥不在：只说没有这条通道，不给一份能填的假表单', () => {
    const html = render(
      <StartPage {...startProps(appState(), modelState({ available: false, snapshot: null }))} />,
    );
    expect(html).toContain('还没有模型连接的通道');
    expect(html).not.toContain('model-save');
    expect(html).not.toContain('model-test');
  });

  it('没有在用端点：状态牌说还没有在用连接，测试连接点不动', () => {
    const html = render(<StartPage {...startProps(appState())} />);
    expect(html).toContain('还没有在用连接');
    expect(tag(html, 'model-test')).toContain('disabled');
    // 目录按厂商归组：同一家的两块平台只占一格，切换在详情里给。
    expect(html).toContain('model-provider-select');
    expect(html).toContain('value="deepseek"');
    expect(html).toContain('value="qwen"');
    expect(html).not.toContain('value="qwen-intl"');
    // 按不下去的原因写在明面上，不靠 tooltip。
    expect(html).toContain('model-save-reason');
    expect(html).toContain('还没有可用的 Key');
  });

  it('在用的那一家带着模型名，测试可以点，Key 留空沿用', () => {
    const html = render(
      <StartPage
        {...startProps(
          appState(),
          modelState({
            snapshot: modelSnapshot({
              active: { id: 'qwen', model: 'qwen3.8-flash', label: '通义千问' },
              endpoints: [{ id: 'qwen', model: 'qwen3.8-flash', keyConfigured: true }],
            }),
          }),
        )}
      />,
    );
    expect(html).toContain('通义千问 · qwen3.8-flash');
    expect(tag(html, 'model-test')).not.toContain('disabled');
    expect(tag(html, 'key-input')).toContain('value=""');
    expect(html).toContain('改用国际平台');
  });

  it('这一页只有三节：运行状态归扩展页管，配色是新工作室不是旧编辑器', () => {
    const html = render(<StartPage {...startProps(appState())} />);
    expect(html).toContain('模型连接');
    expect(html).toContain('桌宠');
    expect(html).toContain('界面配色');
    expect(html).toContain('theme-studio');
    expect(html).not.toContain('theme-editor');
    expect(html).not.toContain('运行状态');
    expect(html).not.toContain('console-stop-all');
    // 呈现里不留被否掉的复制品词汇/类名。
    for (const old of ['start-chip', 'pk-pill', 'console-segmented', '暂未连接']) {
      expect(html).not.toContain(old);
    }
  });

  it('显示状态没读出来就说未就绪，不猜它在不在桌上', () => {
    const unknown = render(<StartPage {...startProps(appState())} />);
    expect(tag(unknown, 'pet-hide')).toContain('disabled');
    expect(tag(unknown, 'pet-show')).toContain('disabled');

    const onDesktop = render(
      <StartPage
        {...startProps(
          appState({
            snapshot: {
              ...(appState().snapshot as ApplicationSnapshot),
              desktop: { available: true, shown: true },
            },
          }),
        )}
      />,
    );
    expect(onDesktop).toContain('在桌面隐藏');
    expect(tag(onDesktop, 'pet-hide')).not.toContain('disabled');
    expect(tag(onDesktop, 'pet-show')).toContain('disabled');
  });

  it('宽版预览沿用真实角色和互动，设置入口保留到装扮页', () => {
    const html = render(<StartPage {...startProps(appState())} />);
    expect(html).toContain('data-testid="pet-avatar"');
    expect(html).toContain('data-testid="pet-poke"');
    expect(html).toContain('stage--wide');
    expect(html).toContain('预览状态');
    expect(html).not.toContain('start__quick');
    expect(html).not.toContain('pet-pause');
    expect(html).toContain('pet-dress');
  });
});

describe('扩展页的运行状态', () => {
  const host = (over: Partial<ConsoleSnapshot['host']> = {}): ConsoleSnapshot => ({
    version: 1,
    host: {
      version: 1,
      runtime: 'ready',
      installedPlugins: 1,
      activePlugins: 1,
      unreadyPlugins: 0,
      pendingRestartPlugins: 0,
      runningTasks: 0,
      pendingWork: 0,
      ...over,
    },
    plugins: [],
    contributions: [],
    app: { name: 'AI 桌宠', version: '0.0.0', electron: '45', node: '24', platform: 'win32-x64' },
  });

  function pluginsPage(snapshot: ConsoleSnapshot): string {
    return render(
      <PluginsPage
        snapshot={snapshot}
        loading={false}
        error={null}
        available
        onRetry={noop}
        onOpenConfig={undefined}
        onOpenPermissions={noop}
        pending={new Map()}
        onAction={noop}
        stopping={false}
        onRequestStopAll={noop}
      />,
    );
  }

  it('运行状态排在插件列表上面，空闲时不给停止入口', () => {
    const html = pluginsPage(host());
    expect(html.indexOf('运行状态')).toBeLessThan(html.indexOf('已安装'));
    expect(html).not.toContain('console-stop-all');
    expect(html).toContain('没有正在运行的任务');
  });

  it('有任务时给停止入口，计数照宿主的话说', () => {
    const html = pluginsPage(host({ runningTasks: 2, pendingWork: 3 }));
    expect(html).toContain('console-stop-all');
    expect(html).toContain('2 个任务在运行，共 3 项工作尚未结束');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  ApplicationPreferences,
  ApplicationSnapshot,
  DemoPhase,
  DemoReplyMode,
  DemoSnapshot,
} from '@pet/contracts';
import { APPLICATION_DEFAULTS } from '@pet/contracts';

import type { ApplicationOutcome, ApplicationState } from '../use-application.js';
import type { DemoOutcome, DemoState } from '../use-demo.js';
import type { ApplicationPage } from '@pet/contracts';
import { AppearancePage } from './appearance.js';
import { GenericPage } from './generic-page.js';
import { ConversationPage } from './conversation.js';
import { PersonaPage } from './persona.js';
import { StartPage } from './start.js';

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

const consoleSnapshot = null;

function sharedStart(app: ApplicationState) {
  return {
    app,
    demo: demoState(demoSnapshot()),
    snapshot: consoleSnapshot,
    loading: false,
    error: null,
    available: false,
    onRetry: noop,
    stopping: false,
    onRequestStopAll: noop,
    notify: noop,
    goToView: noop,
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
  it('没有 Key 也不是缺项：默认走离线脚本演示', () => {
    const html = renderToStaticMarkup(
      <StartPage
        {...sharedStart(appState())}
        demo={demoState(
          demoSnapshot({
            settings: {
              asrOwner: null,
              asrRevision: 0,
              modelId: null,
              voiceOwner: { pluginId: 'pet.voice-chat', instanceId: 'i', generation: 1 },
              voiceRevision: 1,
              replyMode: 'demo',
              autoSend: false,
              readError: null,
            },
          }),
        )}
      />,
    );
    expect(html).toContain('离线脚本演示（不是 AI）');
    expect(html).toContain('没有 Key 也能用');
    expect(html).not.toContain('待接入');
  });

  it('Key 只报存在本机，连接结果留给实际对话', () => {
    const html = renderToStaticMarkup(
      <StartPage
        {...sharedStart(appState())}
        demo={demoState(demoSnapshot({ keyConfigured: true }))}
      />,
    );
    expect(html).toContain('本机已存有 Key，能不能连通还没验证');
    expect(html).toContain('Key 只保存在本机');
    // 不说实现（凭据存储、日志、连接测试），也不宣称已经验证通过。
    expect(html).not.toContain('验证通过');
    expect(html).not.toMatch(/凭据存储|写进日志|连接测试/);
  });
});

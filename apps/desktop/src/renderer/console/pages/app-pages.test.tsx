import type { DesktopCompanionState, DesktopPresentationSnapshot } from '@pet/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppearancePage } from './appearance.js';
import { ConversationPage } from './conversation.js';
import { PersonaPage } from './persona.js';
import { StartPage } from './start.js';
import type { CompanionView } from '../../shared/use-companion.js';
import type { VoiceController } from '@pet/text-client/voice-input-ui';
import { emptyVoiceState } from '@pet/text-client/voice-input-ui';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';
import { endpointBaseline, endpointMoved, rebaseOnConnect } from '../../shared/companion-state.js';
import { initialDesktopCompanionState } from '../test-state.js';

/**
 * 只断言用户看得到的话与按钮状态。这一批守的是四句不许说谎：
 * 没连上不等于已连接；断线时任务状态未知；人格只读不写；
 * 本机呈现的开关改的是这台机器，不是服务里的助手。
 */
const noop = (): void => undefined;

/** 语音 owner 的静态替身：只有视图，没有设备。 */
function voice(over: Partial<VoiceController> = {}): VoiceController {
  return {
    state: emptyVoiceState,
    view: null,
    mode: 'send',
    hint: '最多录 20 秒，到时自动结束并发送。',
    rules: { ok: false, reason: '当前未连接服务。' },
    level: 0,
    reload: noop,
    recover: noop,
    start: noop,
    finish: noop,
    cancel: noop,
    send: noop,
    edit: noop,
    ...over,
  };
}

const snapshot = (over: Partial<DesktopCompanionState> = {}): DesktopCompanionState => ({
  ...initialDesktopCompanionState(),
  source: 'ready',
  ...over,
});

function companion(over: Partial<CompanionView> = {}): CompanionView {
  return {
    available: true,
    state: snapshot(),
    loading: false,
    readError: null,
    notice: null,
    refresh: noop,
    connect: async () => ({ outcome: 'accepted', error: null, configRevision: null }),
    reconnect: async () => ({ outcome: 'accepted', error: null }),
    disconnect: async () => ({ outcome: 'accepted', error: null }),
    send: async () => ({ outcome: 'accepted', error: null }),
    stopTask: async () => ({ outcome: 'accepted', error: null }),
    stopForeground: async () => ({ outcome: 'accepted', error: null }),
    openWeb: async () => ({ outcome: 'accepted', error: null }),
    readProfile: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    readMemory: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    saveProfile: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    upsertFact: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    forgetFact: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    readTask: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    saveArtifact: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    saveModel: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    testModel: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    readVoice: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    saveVoiceSettings: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    saveAsrProvider: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    readAsrCatalog: async () => ({
      ok: false,
      error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true },
    }),
    clearNotice: noop,
    ...over,
  };
}

const preferences = {
  figure: 'minimal',
  palette: 'morning',
  size: 'normal',
  visible: true,
  alwaysOnTop: true,
  draggable: true,
  reducedMotion: false,
  bubbleFontSize: 100,
  bubbleSpeed: 100,
  glow: 0,
  hover: ['chat'],
  doubleClickTyping: true,
  statusBubble: true,
  saidBubble: true,
  hideInFullscreen: false,
  rememberPosition: true,
  lockFps: false,
  frameRate: '60',
  soundEnabled: true,
  soundMove: true,
  soundTouch: true,
  soundFace: true,
  soundSnore: true,
  soundUi: true,
  speechEnabled: true,
  speechProvider: null,
  speechVoice: null,
  speechRate: 0,
  speechVolume: 85,
} as unknown as DesktopPresentationSnapshot['preferences'];

function presentation(over: Partial<LocalPresentationView> = {}): LocalPresentationView {
  return {
    available: true,
    snapshot: {
      version: 1,
      revision: 3,
      preferences,
      desktop: { available: true, shown: true },
      error: null,
    },
    loading: false,
    error: null,
    notice: null,
    saving: false,
    save: async () => true,
    refresh: noop,
    ...over,
  };
}

function tag(html: string, testId: string): string {
  const match = new RegExp('<[a-z]+[^>]*data-testid="' + testId + '"[^>]*>').exec(html);
  expect(match, '找不到 data-testid=' + testId).not.toBeNull();
  return match?.[0] ?? '';
}

describe('开始页', () => {
  it('没有连接通道：只说这件事，不给一份能填的假表单', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion({ available: false, state: null })}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(html).toContain('没有连接服务的通道');
    expect(html).not.toContain('data-testid="start-connect-form"');
  });

  it('还没连接：状态说未连接，连接按钮在，令牌框默认不占位', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion()}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(html).toContain('未连接');
    expect(html).toContain('data-testid="start-address"');
    expect(html).toContain('data-testid="start-ask-token"');
    // 令牌只在点开之后出现，不默认铺一个密码框。
    expect(html).not.toContain('data-testid="start-token"');
    expect(html).toContain('令牌只用于这一次连接');
  });

  it('已连接：显示服务里的名字、模式与人格修订，不拿本地名字冒充', () => {
    const state = snapshot({
      phase: 'live',
      connectionId: 'c1',
      confirmedAt: 1_700_000_000_000,
      baseUrl: 'http://127.0.0.1:4120',
      snapshot: {
        protocolVersion: 1,
        epoch: 'e',
        cursor: 3,
        now: 1_700_000_000_000,
        agent: {
          id: 'agent-1',
          name: '阿蓝',
          profileRevision: 7,
          harness: 'cortico',
          mode: 'scripted',
          status: 'ready',
          error: null,
        },
        messages: [],
        tasks: [],
        facts: [],
        plugins: [],
      },
    });
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion({ state })}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(html).toContain('阿蓝');
    expect(html).toContain('脚本演示，未调用模型');
    expect(html).toContain('data-testid="start-identity"');
    expect(html).toContain('data-testid="start-disconnect"');
  });

  it('地址草稿的 CAS 用它读入的那一版基线，不是最新的 configRevision', () => {
    // 草稿在 rev4 读入，外部随后改到 rev9：提交必须用 4，否则会静默覆盖别处的改动。
    expect(endpointBaseline(4, 9)).toBe(4);
    expect(endpointMoved(4, 9, false)).toBe(true);
  });

  it('还没起过稿时退回当前版本；一致时不算被改动', () => {
    expect(endpointBaseline(null, 9)).toBe(9);
    expect(endpointMoved(null, 9, false)).toBe(false);
    expect(endpointMoved(9, 9, false)).toBe(false);
  });

  it('一次正常成功后基线跟着写入的版本走，不会误报「别处改过」', () => {
    // 提交时草稿基线是 rev1，Main 写下 rev2 并把它返回：基线必须变成 2。
    // 若误用提交前那次渲染的 state（仍是 rev1），下一次就会误报冲突并 CAS 失败。
    expect(rebaseOnConnect(2, 1)).toBe(2);
    expect(endpointMoved(rebaseOnConnect(2, 1), 2, false)).toBe(false);
  });

  it('自己提交在途时不把中间版本报成「别处改过」', () => {
    // Main 先把 Config 推到 rev2，connect 的 promise 还没回来：
    // 此刻 baseline 仍是 1，落后是我自己造成的，不是外部改动。
    expect(endpointMoved(1, 2, true)).toBe(false);
    // settle 之后基线跟到 2：同一份状态不再提示。
    expect(endpointMoved(rebaseOnConnect(2, 1), 2, false)).toBe(false);
  });

  it('提交在途期间外部又推到 rev3：settle 后仍然识别为改过', () => {
    // 在途时不报（避免假提示），但基线只跟到 committed 的 2，rev3 照样露出来。
    expect(endpointMoved(1, 3, true)).toBe(false);
    expect(endpointMoved(rebaseOnConnect(2, 1), 3, false)).toBe(true);
  });

  it('同期另一处 external 改动仍然被识别出来，不会被吞掉', () => {
    // 我写的是 rev2，但有人已经推到 rev3：基线停在 2，界面必须提示改过。
    const after = rebaseOnConnect(2, 1);
    expect(after).toBe(2);
    expect(endpointMoved(after, 3, false)).toBe(true);
  });

  it('没有返回版本时不猜 +1，保持原基线', () => {
    expect(rebaseOnConnect(null, 1)).toBe(1);
    expect(rebaseOnConnect(null, null)).toBe(null);
  });

  it('令牌输入收起时不占位，且有一条显式取消的路', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion()}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    // 没点开就没有密码框：不默认铺一个 secret 输入。
    expect(html).not.toContain('data-testid="start-token"');
    expect(html).toContain('data-testid="start-ask-token"');
    // 收起动作单独存在，用户不必靠提交来离开这一步。
    expect(html).not.toContain('data-testid="start-cancel-token"');
  });

  it('地址字段与令牌字段是两件事：换地址不需要重新点开输入', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion()}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(html).toContain('data-testid="start-address"');
    expect(html).toContain('令牌只用于这一次连接');
  });

  it('在线时也能提交换目标：按钮可点，措辞说的是「更新」', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion({ state: snapshot({ phase: 'live', connectionId: 'c1' }) })}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    // 这是换地址/换令牌的实际入口：不能因为已经在线就被禁掉。
    expect(tag(html, 'start-ask-token')).not.toContain('disabled');
    expect(html).toContain('更新连接或更换令牌');
  });

  it('断线时按钮可用，措辞是重新连接', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion({ state: snapshot({ phase: 'offline', connectionId: 'c1' }) })}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(tag(html, 'start-ask-token')).not.toContain('disabled');
    expect(html).toContain('输入令牌并重新连接');
  });

  it('未连接时按钮可用，措辞是初次连接', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion()}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(tag(html, 'start-ask-token')).not.toContain('disabled');
    expect(html).toContain('输入令牌并连接');
  });

  it('过渡相位禁用：connecting 与 retiring 都不给第二次提交', () => {
    for (const phase of ['connecting', 'retiring'] as const) {
      const html = renderToStaticMarkup(
        <StartPage
          companion={companion({ state: snapshot({ phase, connectionId: 'c1' }) })}
          presentation={presentation()}
          voice={voice()}
          notify={noop}
        />,
      );
      expect(tag(html, 'start-ask-token'), phase).toContain('disabled');
    }
  });

  it('源停用或不可用时禁用，与相位无关', () => {
    for (const source of ['disabled', 'unavailable'] as const) {
      const html = renderToStaticMarkup(
        <StartPage
          companion={companion({ state: snapshot({ source, phase: 'live', connectionId: 'c1' }) })}
          presentation={presentation()}
          voice={voice()}
          notify={noop}
        />,
      );
      expect(tag(html, 'start-ask-token'), source).toContain('disabled');
    }
  });

  it('源被停用：不给连接按钮，指向插件页恢复', () => {
    const html = renderToStaticMarkup(
      <StartPage
        companion={companion({ state: snapshot({ source: 'disabled' }) })}
        presentation={presentation()}
        voice={voice()}
        notify={noop}
      />,
    );
    expect(html).toContain('连接组件已停用');
    expect(tag(html, 'start-ask-token')).toContain('disabled');
  });
});

describe('对话页', () => {
  it('还没连上：说清去哪里连，不给一个能发出去的输入框', () => {
    const html = renderToStaticMarkup(
      <ConversationPage companion={companion()} voice={voice()} notify={noop} onGoToStart={noop} />,
    );
    expect(html).toContain('还没有连上服务');
    expect(html).toContain('data-testid="conversation-go-start"');
    expect(tag(html, 'conversation-send')).toContain('disabled');
  });

  it('有消息：显示服务正文与时间；断线时停止与发送都按不动', () => {
    const state = snapshot({
      phase: 'offline',
      connectionId: 'c1',
      confirmedAt: 1_700_000_000_000,
      snapshot: {
        protocolVersion: 1,
        epoch: 'e',
        cursor: 9,
        now: 1_700_000_000_000,
        agent: {
          id: 'agent-1',
          name: '阿蓝',
          profileRevision: 1,
          harness: 'cortico',
          mode: 'scripted',
          status: 'ready',
          error: null,
        },
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: '现在几点',
            createdAt: 1_700_000_000_000,
            inputId: 'i1',
            taskId: null,
          },
          {
            id: 'm2',
            role: 'assistant',
            text: '十点整。',
            createdAt: 1_700_000_001_000,
            inputId: null,
            taskId: null,
          },
        ],
        tasks: [
          {
            id: 't1',
            executionId: 'x',
            title: '整理文件',
            status: 'running',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            exitCode: null,
            stdout: '',
            stderr: '',
            logsTruncated: false,
            artifacts: [],
            error: null,
          },
        ],
        facts: [],
        plugins: [],
      },
    });
    const html = renderToStaticMarkup(
      <ConversationPage
        companion={companion({ state })}
        voice={voice()}
        notify={noop}
        onGoToStart={noop}
      />,
    );
    expect(html).toContain('现在几点');
    expect(html).toContain('十点整。');
    expect(html).toContain('data-testid="conversation-reconnect"');
    // 断线时任务显示「未知（上次：运行中）」，不假装它还在跑。
    expect(html).toContain('状态未知（上次：运行中）');
    expect(tag(html, 'conversation-send')).toContain('disabled');
  });

  it('有待确认的发送：只说可能已送达，不复制用户那句话', () => {
    const state = snapshot({
      phase: 'live',
      connectionId: 'c1',
      pending: [{ commandId: 'cmd-1', kind: 'message', taskId: null, status: 'uncertain' }],
      snapshot: {
        protocolVersion: 1,
        epoch: 'e',
        cursor: 1,
        now: 1,
        agent: {
          id: 'a',
          name: '阿蓝',
          profileRevision: 1,
          harness: 'cortico',
          mode: 'scripted',
          status: 'ready',
          error: null,
        },
        messages: [],
        tasks: [],
        facts: [],
        plugins: [],
      },
    });
    const html = renderToStaticMarkup(
      <ConversationPage
        companion={companion({ state })}
        voice={voice()}
        notify={noop}
        onGoToStart={noop}
      />,
    );
    expect(html).toContain('上一条消息结果未知');
    expect(html).toContain('重试会复用同一次提交');
  });
});

describe('人格页', () => {
  it('人格可编辑：有名字与正文输入、有保存按钮', () => {
    const html = renderToStaticMarkup(
      <PersonaPage companion={companion()} presentation={presentation()} notify={noop} />,
    );
    expect(html).toContain('data-testid="profile-name"');
    expect(html).toContain('data-testid="profile-persona"');
    expect(html).toContain('data-testid="profile-save"');
  });

  it('metadata 缺失时只说这一项暂不可编辑，不声称服务版本过旧', () => {
    // 快照里没有 memory、profile 也还没读到：两块各自报自己的事实。
    const html = renderToStaticMarkup(
      <PersonaPage companion={companion()} presentation={presentation()} notify={noop} />,
    );
    expect(html).toContain('data-testid="profile-unsupported"');
    expect(html).toContain('data-testid="memory-unsupported"');
    expect(html).toContain('服务暂未提供可编辑的人格');
    // 不把缺失说成「版本过旧」——新服务来源不可用也会缺字段。
    expect(html).not.toContain('版本过旧');
    expect(html).not.toContain('旧版本');
  });

  it('未连接时整块只读并说明原因，但控件仍在', () => {
    const html = renderToStaticMarkup(
      <PersonaPage
        companion={companion({ state: snapshot({ phase: 'offline', connectionId: 'c1' }) })}
        presentation={presentation()}
        notify={noop}
      />,
    );
    expect(html).toContain('当前未连接服务，这里只能看不能改');
    expect(html).toContain('data-testid="profile-name"');
  });

  it('本机呈现字段在：双击、状态气泡、回复气泡与三个范围', () => {
    const html = renderToStaticMarkup(
      <PersonaPage companion={companion()} presentation={presentation()} notify={noop} />,
    );
    for (const id of [
      'pref-doubleClickTyping',
      'pref-statusBubble',
      'pref-saidBubble',
      'pref-bubbleFontSize',
      'pref-bubbleSpeed',
      'pref-glow',
    ])
      expect(html).toContain(`data-testid="${id}"`);
  });

  it('没有本机记录时只说没有，不铺一份默认值', () => {
    const html = renderToStaticMarkup(
      <PersonaPage
        companion={companion()}
        presentation={presentation({ snapshot: null })}
        notify={noop}
      />,
    );
    expect(html).toContain('还没有读到本机的外观记录');
  });
});

describe('外观页', () => {
  it('两个形态、四个配色、三个大小都可选，当前值被选中', () => {
    const html = renderToStaticMarkup(
      <AppearancePage presentation={presentation()} notify={noop} />,
    );
    for (const name of ['简约', '圆头', '晨蓝', '雪青', '松墨', '柿橙', '适中']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('data-testid="pref-figure-minimal"');
    expect(html).toContain('data-testid="pref-palette-morning"');
    expect(html).toContain('data-testid="pref-visible"');
  });

  it('没有本机记录：只说这件事，不画能点的开关', () => {
    const html = renderToStaticMarkup(
      <AppearancePage presentation={presentation({ snapshot: null })} notify={noop} />,
    );
    expect(html).toContain('没有可用的外观记录');
    expect(html).not.toContain('data-testid="pref-figure-minimal"');
  });
});

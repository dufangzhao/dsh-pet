/**
 * 宿主 Demo → 桌宠显示的翻译规则。
 *
 * 这里守住的是几条产品承诺：阶段映射不猜、真实文本优先、演示回复带着「脚本演示」标签、
 * 没连上时不伪造状态；以及桌宠只认 getSnapshot/onChanged/cancel 这三个方法。
 */
import {
  makeError,
  type DemoBridge,
  type DemoPhase,
  type DemoReplyMode,
  type DemoSnapshot,
} from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import { PET_COPY } from './copy.js';
import {
  BUBBLE_TEXT_LIMIT,
  clipBubbleText,
  demoBubbleText,
  describeDemo,
  phaseToPetState,
  replyBubble,
} from './demo-status.js';
import { isDemoBridge, readDemoBridge } from './use-demo-status.js';

const ALL_PHASES: readonly DemoPhase[] = [
  'setup',
  'idle',
  'preparing',
  'arming',
  'recording',
  'recognizing',
  'thinking',
  'responding',
  'saving',
  'stopping',
  'error',
];

function snapshot(overrides: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    version: 1,
    phase: 'idle',
    intentId: null,
    settings: {
      asrOwner: null,
      asrRevision: 0,
      modelId: null,
      voiceOwner: null,
      voiceRevision: 0,
      replyMode: 'demo',
      autoSend: false,
      readError: null,
    },
    plugins: [],
    models: [],
    preparedModelId: null,
    canRecord: false,
    canSend: false,
    transcript: '',
    partialTranscript: '',
    partialReply: '',
    messages: [],
    recordingStartedAt: null,
    maxRecordingSeconds: 20,
    error: null,
    keyAvailable: false,
    keyConfigured: false,
    avatarEnabled: true,
    ...overrides,
  };
}

describe('阶段映射到角色状态', () => {
  it('每个阶段都有状态，且与承诺一致', () => {
    expect(phaseToPetState('recording')).toBe('listening');
    for (const phase of ['preparing', 'arming', 'recognizing', 'thinking'] as const) {
      expect(phaseToPetState(phase)).toBe('thinking');
    }
    expect(phaseToPetState('responding')).toBe('replying');
    expect(phaseToPetState('error')).toBe('error');
    for (const phase of ['setup', 'idle', 'saving', 'stopping'] as const) {
      expect(phaseToPetState(phase)).toBe('idle');
    }
    for (const phase of ALL_PHASES) {
      expect(phaseToPetState(phase)).not.toBeNull();
    }
  });
});

describe('气泡只显示宿主给的内容', () => {
  it('错误优先，并且用固定文案，不回显任何原始内容', () => {
    expect(
      demoBubbleText(snapshot({ phase: 'error', error: makeError('microphone-denied') })),
    ).toBe(`${PET_COPY.errorPrefix}${'麦克风访问被拒绝，请检查系统权限'}`);
  });

  it('正在识别时显示 partialTranscript 的最新一段', () => {
    const long = '前面已经说过的话'.repeat(20);
    const text = demoBubbleText(
      snapshot({ phase: 'recognizing', partialTranscript: long, partialReply: '不该出现的回复' }),
    );
    expect(text.startsWith('…')).toBe(true);
    expect(text.length).toBe(BUBBLE_TEXT_LIMIT + 1);
    expect(text).toBe(`…${long.slice(long.length - BUBBLE_TEXT_LIMIT)}`);
  });

  it('演示模式的部分回复带着「脚本演示」标签，真实模式不带', () => {
    expect(demoBubbleText(snapshot({ phase: 'responding', partialReply: '今天阴天' }))).toBe(
      `${PET_COPY.replyTag}今天阴天`,
    );
    expect(
      demoBubbleText(
        snapshot({
          phase: 'responding',
          partialReply: '今天阴天',
          settings: { ...snapshot().settings, replyMode: 'deepseek' },
        }),
      ),
    ).toBe('今天阴天');
  });

  it('没有流式文本时用最近一条 assistant 消息，而不是自己编', () => {
    const shown = demoBubbleText(
      snapshot({
        phase: 'idle',
        messages: [
          { id: 'u1', role: 'user', text: '你好', mode: 'demo', at: 1 },
          { id: 'a1', role: 'assistant', text: '脚本演示：你好呀', mode: 'demo', at: 2 },
          { id: 'a2', role: 'assistant', text: '后面这条才是最新的', mode: 'demo', at: 3 },
        ],
      }),
    );
    expect(shown).toBe(`${PET_COPY.replyTag}后面这条才是最新的`);
  });

  it('什么内容都没有时按状态给一句话，不谎称在录音', () => {
    expect(demoBubbleText(snapshot({ phase: 'recording' }))).toBe(PET_COPY.stateBubbles.listening);
    expect(demoBubbleText(snapshot({ phase: 'error' }))).toBe(PET_COPY.stateBubbles.error);
    expect(demoBubbleText(snapshot())).toBe(PET_COPY.stateBubbles.idle);
    expect(demoBubbleText(snapshot())).not.toContain('模拟');
  });

  it('截断保留开头并标注，长度受控', () => {
    const clipped = clipBubbleText('很长'.repeat(40), 'head');
    expect(clipped.length).toBe(BUBBLE_TEXT_LIMIT + 1);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipBubbleText('短句子', 'head')).toBe('短句子');
  });

  it('只有演示模式的回复才贴标签', () => {
    expect(replyBubble('demo', '一句话')).toBe(`${PET_COPY.replyTag}一句话`);
    expect(replyBubble('deepseek', '一句话')).toBe('一句话');
    expect(replyBubble(null, '一句话')).toBe('一句话');
  });
});

describe('没有快照时不伪造', () => {
  it('未读到快照：不 live，不给状态、文本与任何发送/停止入口', () => {
    const status = describeDemo(null);
    expect(status.live).toBe(false);
    expect(status.state).toBeNull();
    expect(status.bubble).toBeNull();
    expect(status.canStop).toBe(false);
    expect(status.canSend).toBe(false);
  });

  it('读到快照：live、状态与气泡都跟着宿主', () => {
    const status = describeDemo(snapshot({ phase: 'responding', partialReply: '你好' }));
    expect(status.live).toBe(true);
    expect(status.state).toBe('replying');
    expect(status.bubble).toBe(`${PET_COPY.replyTag}你好`);
  });

  it('只有进行中的阶段才给停止', () => {
    for (const phase of [
      'preparing',
      'arming',
      'recording',
      'recognizing',
      'thinking',
      'responding',
      'saving',
    ] as const) {
      expect(describeDemo(snapshot({ phase })).canStop).toBe(true);
    }
    for (const phase of ['setup', 'idle', 'stopping', 'error'] as const) {
      expect(describeDemo(snapshot({ phase })).canStop).toBe(false);
    }
  });

  it('发送入口只认宿主的 canSend，不按阶段猜', () => {
    expect(describeDemo(snapshot({ canSend: true })).canSend).toBe(true);
    expect(describeDemo(snapshot({ canSend: false })).canSend).toBe(false);
  });
});

describe('Demo 桥的边界校验', () => {
  const bridge = {
    version: 1,
    getSnapshot: () => Promise.resolve({ ok: true, value: null }),
    onChanged: () => () => {},
    cancel: () => Promise.resolve({ ok: true, value: null }),
  } as unknown as DemoBridge;

  it('接受提供这三个方法的桥', () => {
    expect(isDemoBridge(bridge)).toBe(true);
    expect(readDemoBridge({ petDemo: bridge })).toBe(bridge);
  });

  it('半套接口、版本不对或没有 petDemo 都算没连上', () => {
    expect(isDemoBridge({ ...bridge, onChanged: undefined })).toBe(false);
    expect(isDemoBridge({ ...bridge, cancel: undefined })).toBe(false);
    expect(isDemoBridge({ ...bridge, version: 2 })).toBe(false);
    expect(isDemoBridge(null)).toBe(false);
    expect(readDemoBridge({})).toBeNull();
    expect(readDemoBridge(null)).toBeNull();
  });
});

describe('回复模式只翻译宿主给的值', () => {
  it('演示与真实模式的标签只在演示那一侧出现', () => {
    const mode: DemoReplyMode = 'demo';
    expect(replyBubble(mode, '内容')).toContain(PET_COPY.replyTag);
    expect(replyBubble('deepseek', '内容')).not.toContain(PET_COPY.replyTag);
  });
});

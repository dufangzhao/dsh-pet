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
  demoStatusLines,
  describeDemo,
  phaseToPetState,
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
    ).toBe(`${PET_COPY.demo.errorPrefix}${'麦克风访问被拒绝，请检查系统权限'}`);
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
      `${PET_COPY.demo.replyTag}今天阴天`,
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
    expect(shown).toBe(`${PET_COPY.demo.replyTag}后面这条才是最新的`);
  });

  it('什么内容都没有时按状态给一句话，保留模拟标注以外的说法', () => {
    expect(demoBubbleText(snapshot({ phase: 'recording' }))).toBe(PET_COPY.demo.bubbles.listening);
    expect(demoBubbleText(snapshot({ phase: 'error' }))).toBe(PET_COPY.demo.bubbles.error);
    expect(demoBubbleText(snapshot())).toBe(PET_COPY.demo.bubbles.idle);
    expect(demoBubbleText(snapshot())).not.toContain('模拟');
  });

  it('截断保留开头并标注，长度受控', () => {
    const clipped = clipBubbleText('很长'.repeat(40), 'head');
    expect(clipped.length).toBe(BUBBLE_TEXT_LIMIT + 1);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipBubbleText('短句子', 'head')).toBe('短句子');
  });
});

describe('面板状态行', () => {
  it('说清阶段与回复来源，演示模式明写不是 AI', () => {
    const lines = demoStatusLines(snapshot({ phase: 'recording' }));
    expect(lines[0]).toBe(`${PET_COPY.demo.phasePrefix}正在录音`);
    expect(lines[1]).toContain('离线脚本演示');
    expect(lines[1]).toContain('不是 AI');
  });

  it('回复来源未设置与真实模式各有说法', () => {
    const unset = demoStatusLines(
      snapshot({ settings: { ...snapshot().settings, replyMode: null as DemoReplyMode | null } }),
    );
    expect(unset[1]).toBe(`${PET_COPY.demo.sourcePrefix}未设置`);
    const real = demoStatusLines(
      snapshot({ settings: { ...snapshot().settings, replyMode: 'deepseek' } }),
    );
    expect(real[1]).toContain('真实 DeepSeek');
  });

  it('avatarEnabled=false 时说明没有启用角色形象，不冒充', () => {
    expect(demoStatusLines(snapshot({ avatarEnabled: true }))).toHaveLength(2);
    const off = demoStatusLines(snapshot({ avatarEnabled: false }));
    expect(off).toHaveLength(3);
    expect(off[2]).toBe(PET_COPY.demo.avatarOff);
    expect(off[2]).toContain('设置台');
  });
});

describe('没有快照时不伪造', () => {
  it('未连接：不 live，说明里写清未连接', () => {
    const status = describeDemo(null, false);
    expect(status.live).toBe(false);
    expect(status.state).toBeNull();
    expect(status.bubble).toBeNull();
    expect(status.canStop).toBe(false);
    expect(status.lines).toHaveLength(1);
    expect(status.lines[0]).toContain('未连接');
    expect(status.lines[0]).toContain('M0');
  });

  it('已连接但还没读到快照：仍然是模拟，并说明正在读取', () => {
    const status = describeDemo(null, true);
    expect(status.live).toBe(false);
    expect(status.lines).toEqual([PET_COPY.demo.reading]);
  });

  it('读到快照：live、状态、气泡与标题都跟着宿主', () => {
    const status = describeDemo(snapshot({ phase: 'responding', partialReply: '你好' }), true);
    expect(status.live).toBe(true);
    expect(status.state).toBe('replying');
    expect(status.title).toBe(PET_COPY.demo.panelTitle);
    expect(status.bubble).toBe(`${PET_COPY.demo.replyTag}你好`);
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
      expect(describeDemo(snapshot({ phase }), true).canStop).toBe(true);
    }
    for (const phase of ['setup', 'idle', 'stopping', 'error'] as const) {
      expect(describeDemo(snapshot({ phase }), true).canStop).toBe(false);
    }
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

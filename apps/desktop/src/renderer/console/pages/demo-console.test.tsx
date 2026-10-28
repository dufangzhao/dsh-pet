import type { DemoPhase, DemoSnapshot } from '@pet/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DemoOutcome, DemoState } from '../use-demo.js';
import { DemoConsole } from './demo-console.js';
import { ModelsPage } from './models.js';

/**
 * 只断言用户看得到的文字与按钮状态。这里最要紧的是两句不许说谎：
 * 离线脚本演示不是 AI；Key 存下了也不等于验证过。
 */

const base = {
  asrOwner: null,
  asrRevision: 0,
  modelId: null,
  voiceOwner: null,
  voiceRevision: 0,
  replyMode: 'demo' as const,
  autoSend: false,
  readError: null,
};

const snapshot = (over: Partial<DemoSnapshot> = {}): DemoSnapshot => ({
  version: 1,
  phase: 'idle' as DemoPhase,
  intentId: null,
  settings: base,
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
});

const OK: DemoOutcome = { ok: true, error: null };
const noop = (): void => undefined;

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

function render(value: DemoSnapshot): string {
  return renderToStaticMarkup(<DemoConsole demo={demoState(value)} notify={noop} />);
}

function buttonTag(html: string, testId: string): string {
  const pattern = '<button[^>]*data-testid="' + testId + '"[^>]*>';
  return html.match(new RegExp(pattern))?.[0] ?? '';
}

describe('本地 Demo 对话', () => {
  it('默认把回复说成离线脚本演示，不冒充 AI', () => {
    const html = render(snapshot());
    expect(html).toContain('离线脚本演示');
    expect(html).toContain('非 AI');
    expect(html).not.toContain('AI 助手');
  });

  it('选了真实 DeepSeek 也只说保存过，不说验证过', () => {
    const html = render(
      snapshot({ settings: { ...base, replyMode: 'deepseek' }, keyConfigured: true }),
    );
    expect(html).toContain('真实 DeepSeek');
    expect(html).toContain('用你的 Key 走网络');
    expect(html).not.toContain('已验证');
  });

  it('还不能发送时按钮真的禁用，录音上限用设置里给的秒数', () => {
    const html = render(snapshot({ canSend: false, canRecord: false }));
    expect(buttonTag(html, 'demo-send')).toContain('disabled');
    expect(buttonTag(html, 'demo-record')).toContain('disabled');
    expect(html).toContain('本次最长 20 秒');
  });
});

describe('模型页 Key 接入', () => {
  it('只说保存过，并说明没做连接测试', () => {
    const html = renderToStaticMarkup(
      <ModelsPage
        demo={demoState(snapshot({ keyConfigured: true }))}
        notify={noop}
        onGoToVoice={noop}
      />,
    );
    expect(html).toContain('保存过不等于已验证');
    expect(html).toContain('不做连接测试');
    expect(html).not.toContain('验证通过');
  });
});

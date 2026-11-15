import type { CompanionMessage, CompanionTask, DesktopCompanionState } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import {
  agentModeLabel,
  canConnect,
  updatesConnection,
  canSend,
  canStopTask,
  connectionView,
  petStateOf,
  sendBlockedReason,
  taskView,
  lastAssistant,
} from './companion-state.js';
import { initialDesktopCompanionState } from '../console/test-state.js';

const task = (over: Partial<CompanionTask> = {}): CompanionTask => ({
  id: 't1',
  executionId: 'e1',
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
  ...over,
});

const live = (over: Partial<DesktopCompanionState> = {}): DesktopCompanionState => ({
  ...initialDesktopCompanionState(),
  source: 'ready',
  phase: 'live',
  connectionId: 'c1',
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
  ...over,
});

describe('连接事实推导', () => {
  it('源停用优先于 phase：停用时不冒充断线，也不给连接按钮', () => {
    const state = { ...initialDesktopCompanionState(), source: 'disabled' as const };
    expect(connectionView(state).label).toBe('连接组件已停用');
    expect(canConnect(state)).toBe(false);
  });

  it('源就绪且不在过渡相位时都能提交连接目标，live 也可以', () => {
    // live 必须可提交：服务端支持在线 retire→newbind，一刀禁掉就没有换目标的入口。
    expect(canConnect(live())).toBe(true);
    expect(canConnect(live({ phase: 'idle' }))).toBe(true);
    expect(canConnect(live({ phase: 'offline' }))).toBe(true);
  });

  it('两个过渡相位不可提交：正在切换时再发一次只会打架', () => {
    expect(canConnect(live({ phase: 'connecting' }))).toBe(false);
    expect(canConnect(live({ phase: 'retiring' }))).toBe(false);
  });

  it('源不可用时一律不可提交，与相位无关', () => {
    for (const source of ['disabled', 'unavailable'] as const)
      expect(canConnect({ ...live(), source })).toBe(false);
  });

  it('有连接时这次提交是「更新」，没有时是「新建」', () => {
    expect(updatesConnection(live())).toBe(true);
    expect(updatesConnection(live({ connectionId: null, phase: 'idle' }))).toBe(false);
  });

  it('断线不能发送；在线才能', () => {
    expect(canSend(live())).toBe(true);
    expect(canSend(live({ phase: 'offline' }))).toBe(false);
  });
});

describe('任务状态只说确认过的事', () => {
  it('断线时运行中降级成「未知（上次：运行中）」', () => {
    const view = taskView(task(), live({ phase: 'offline' }));
    expect(view.label).toBe('状态未知（上次：运行中）');
    expect(view.stale).toBe(true);
  });

  it('已请求停止但服务端还没给终态：显示已发送，不是已停止', () => {
    const state = live({
      pending: [{ commandId: 's1', kind: 'stop', taskId: 't1', status: 'accepted' }],
    });
    expect(taskView(task(), state).label).toBe('停止请求已发送');
  });

  it('终态不因断线而变：已完成就是已完成', () => {
    expect(taskView(task({ status: 'completed' }), live({ phase: 'offline' })).label).toBe(
      '已完成',
    );
  });

  it('断线时不给停止按钮，在线且非终态才给', () => {
    expect(canStopTask(live(), task())).toBe(true);
    expect(canStopTask(live({ phase: 'offline' }), task())).toBe(false);
    expect(canStopTask(live(), task({ status: 'completed' }))).toBe(false);
  });
});

describe('角色状态与发送理由', () => {
  it('连接中与断开时角色是思考/出错，不是待机', () => {
    expect(petStateOf(live({ phase: 'connecting' }))).toBe('thinking');
    expect(petStateOf(live({ phase: 'offline' }))).toBe('error');
  });

  it('有未确认的发送时角色在思考，不假装已送达', () => {
    const state = live({
      pending: [{ commandId: 'm1', kind: 'message', taskId: null, status: 'uncertain' }],
    });
    expect(petStateOf(state)).toBe('thinking');
  });

  it('模型模式不可用时的理由说的是模型，不是插件', () => {
    const state = live({
      snapshot: {
        ...live().snapshot!,
        agent: { ...live().snapshot!.agent, mode: 'model', status: 'unavailable' },
      },
    });
    expect(sendBlockedReason(state)).toContain('模型当前不可用');
  });

  it('脚本与模型两种模式各有各的说法，脚本必须标出来', () => {
    expect(agentModeLabel({ mode: 'scripted', status: 'ready' })).toContain('脚本演示');
    expect(agentModeLabel({ mode: 'model', status: 'ready' })).toBe('模型回复');
  });
});

describe('桌宠只读主人私聊', () => {
  const message = (
    id: string,
    role: 'user' | 'assistant' | 'notice',
    audience?: { readonly kind: string },
  ): CompanionMessage =>
    ({
      id,
      role,
      text: id,
      createdAt: 1,
      inputId: null,
      taskId: null,
      ...(audience === undefined ? {} : { audience }),
    }) as CompanionMessage;

  it('跳过群里和别人私聊的回复，只取主人私聊那条', () => {
    const messages = [
      message('m1', 'assistant', { kind: 'owner-private' }),
      message('m2', 'assistant', { kind: 'qq-group' }),
      message('m3', 'assistant', { kind: 'person-private' }),
    ];
    // 最后一条是别人群里的回复：不能弹到主人桌面。
    expect(lastAssistant(messages)?.id).toBe('m1');
  });

  it('没有 audience 的旧消息仍按主人私聊处理', () => {
    expect(lastAssistant([message('legacy', 'assistant')])?.id).toBe('legacy');
  });

  it('只有别人的回复时返回 null，不冒充有回复', () => {
    expect(lastAssistant([message('m2', 'assistant', { kind: 'qq-group' })])).toBeNull();
  });
});

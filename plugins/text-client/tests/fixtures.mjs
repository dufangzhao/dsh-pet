/** 测试用的协议样本：字段与 packages/contracts/src/companion.ts 保持一致。 */

export const EPOCH = 'epoch-1';

export function snapshot(overrides = {}) {
  return {
    protocolVersion: 1,
    epoch: EPOCH,
    cursor: 4,
    now: 1_700_000_000_000,
    agent: {
      id: 'agent-1',
      name: '助手',
      profileRevision: 1,
      harness: 'fixture',
      mode: 'scripted',
      status: 'ready',
      error: null,
    },
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: '整理一下会议记录',
        createdAt: 1_700_000_000_000,
        inputId: 'cmd-1',
        taskId: null,
      },
      {
        id: 'm2',
        role: 'assistant',
        text: '好，我先看一遍。',
        createdAt: 1_700_000_001_000,
        inputId: null,
        taskId: null,
      },
    ],
    tasks: [],
    facts: [],
    plugins: [],
    ...overrides,
  };
}

export function task(overrides = {}) {
  return {
    id: 'task-1',
    executionId: 'exec-1',
    title: '统计字数',
    status: 'running',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_002_000,
    exitCode: null,
    stdout: '',
    stderr: '',
    logsTruncated: false,
    artifacts: [],
    error: null,
    ...overrides,
  };
}

export function event(sequence, overrides = {}) {
  return {
    id: `e${sequence}`,
    epoch: EPOCH,
    sequence,
    time: 1_700_000_000_000 + sequence,
    kind: 'task',
    data: {},
    ...overrides,
  };
}

/** 生成一段真实分帧的 SSE 文本，用来喂给流式解码器。 */
export function sseText(messages, { crlf = false } = {}) {
  const end = crlf ? '\r\n' : '\n';
  return messages
    .map((message) => {
      const lines = [];
      if (message.id !== undefined) lines.push(`id: ${message.id}`);
      lines.push(`event: ${message.event}`);
      lines.push(`data: ${message.data}`);
      return lines.join(end) + end + end;
    })
    .join('');
}

/** 与 packages/contracts/src/companion-model.ts 同形的模型视图样本。 */
export function modelView(overrides = {}) {
  return {
    profileRevision: 1,
    desired: { mode: 'scripted', connectorId: 'pet.model-connection-magpie/magpie' },
    applied: null,
    enabled: false,
    connectors: [
      {
        id: 'pet.model-connection-magpie/magpie',
        label: 'Magpie',
        synthetic: false,
        configRevision: 1,
        settings: {
          baseUrl: 'http://127.0.0.1:3425/v1',
          model: '',
          authMode: 'local-client-id',
        },
        model: null,
        credential: {
          required: false,
          available: true,
          source: 'local-client-id',
          version: 'process:1',
          writable: false,
        },
      },
    ],
    check: {
      state: 'unconfigured',
      commandId: null,
      binding: null,
      startedAt: null,
      checkedAt: null,
      elapsedMs: null,
      evidence: null,
      error: null,
    },
    error: null,
    ...overrides,
  };
}

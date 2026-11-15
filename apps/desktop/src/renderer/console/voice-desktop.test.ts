/**
 * 桌面语音适配器的回归：只经 `window.petVoice` 的固定桥，不自己上传音频。
 *
 * 守四件事：
 * 1. begin 带上渲染时捕获的选择，身份由 Main 补（渲染器不编 clientId/agentId）；
 * 2. 每一帧带递增序号，被拒就返回失败——不假装收下；
 * 3. 结束走 `released` → `finishCapture(frames)`，渲染器不持有整段音频；
 * 4. 恢复只读同一个票据，不重新上传、不重新开始采集。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopVoiceBridge, Result, VoiceCaptureResult, VoiceTicket } from '@pet/contracts';
import { makeError } from '@pet/contracts';

import { createDesktopVoiceTransport } from './voice-desktop.js';

const TICKET: VoiceTicket = {
  version: 1,
  captureId: 'cap-1',
  clientId: 'server-client',
  agentId: 'agent-1',
  serviceEpoch: 'epoch-1',
  bindingId: 'binding-1',
  finishMode: 'send',
  expiresAt: 1,
  encoding: 'f32le',
  sampleRate: 16000,
  channels: 1,
  chunkSamples: 1600,
  maxSamples: 320000,
};

const RESULT: VoiceCaptureResult = {
  ticket: TICKET,
  phase: 'final',
  samples: 2,
  cleanup: 'settled',
  outcome: { kind: 'final', text: '你好' },
  error: null,
  completedAt: 1,
};

const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** 记录调用顺序的桥：每个方法只做被记录的那件事。 */
function bridge(over: Partial<DesktopVoiceBridge> = {}): {
  bridge: DesktopVoiceBridge;
  calls: { name: string; input?: unknown }[];
} {
  const calls: { name: string; input?: unknown }[] = [];
  const record =
    <T>(name: string, value: T) =>
    async (input: unknown): Promise<Result<T>> => {
      calls.push({ name, input });
      return ok(value);
    };
  const base: DesktopVoiceBridge = {
    version: 1,
    getState: async () =>
      ok({
        version: 1,
        revision: 1,
        connectionId: 'connection-1',
        phase: 'idle',
        captureId: null,
        samples: 0,
        cleanup: 'settled',
        error: null,
      }),
    onChanged: () => () => {},
    readVoice: async () =>
      ok({
        version: 1,
        feature: {
          source: 'ready',
          configRevision: 1,
          providerRef: 'pet.asr-magpie/magpie',
          finishMode: 'send',
        },
        providers: [],
      }),
    saveVoiceSettings: async () => ({ ok: false, error: makeError('not-ready', false) }),
    saveAsrProvider: async () => ({ ok: false, error: makeError('not-ready', false) }),
    readAsrCatalog: async () => ({ ok: false, error: makeError('not-ready', false) }),
    begin: record('begin', TICKET),
    readCaptureResult: record('readCaptureResult', RESULT),
    captureReady: record('captureReady', null),
    pushAudio: record('pushAudio', null),
    finishCapture: record('finishCapture', RESULT),
    cancelCapture: record('cancelCapture', {
      version: 1,
      revision: 2,
      connectionId: 'connection-1',
      phase: 'retiring',
      captureId: 'cap-1',
      samples: 0,
      cleanup: 'pending',
      error: null,
    }),
    reportCaptureError: async () => ({ ok: false, error: makeError('not-ready', false) }),
    reportCaptureReleased: record('reportCaptureReleased', null),
    ...over,
  };
  return { bridge: base, calls };
}

const target = { connectionId: 'connection-1' };
const submit = async (): Promise<'accepted'> => 'accepted';

afterEach(() => {
  vi.unstubAllGlobals();
});

function install(bridgeValue: DesktopVoiceBridge): void {
  vi.stubGlobal('window', { petVoice: bridgeValue });
}

describe('桌面语音适配器', () => {
  it('begin 传渲染时捕获的选择，身份由 Main 补', async () => {
    const { bridge: value, calls } = bridge();
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    expect(transport).not.toBeNull();
    const result = await transport?.begin({
      captureId: 'cap-1',
      expectedFeatureRevision: 4,
      providerRef: 'pet.asr-magpie/magpie',
      bindingId: 'binding-1',
      finishMode: 'send',
    });
    expect(result?.ok).toBe(true);
    expect(calls[0]).toEqual({
      name: 'begin',
      input: {
        connectionId: 'connection-1',
        captureId: 'cap-1',
        expectedFeatureRevision: 4,
        providerRef: 'pet.asr-magpie/magpie',
        bindingId: 'binding-1',
        finishMode: 'send',
      },
    });
    // 渲染器不编造 clientId/agentId：那是 Main 从真实票据里补的。
    expect(JSON.stringify(calls[0]?.input)).not.toContain('clientId');
  });

  it('逐帧带递增序号；被拒的那一帧原样返回失败', async () => {
    let reject = false;
    const { bridge: value, calls } = bridge({
      pushAudio: async (input, payload) => {
        calls.push({ name: 'pushAudio', input: { input, size: payload.byteLength } });
        return reject ? { ok: false, error: makeError('invalid-input', false) } : ok(null);
      },
    });
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    const ticket = TICKET;
    expect((await transport?.push(ticket, new Uint8Array(8)))?.ok).toBe(true);
    expect((await transport?.push(ticket, new Uint8Array(8)))?.ok).toBe(true);
    reject = true;
    const failed = await transport?.push(ticket, new Uint8Array(8));
    expect(failed?.ok).toBe(false);
    // 失败的那一帧没有推进序号：重试仍是同一个序号，Main 不会把两帧当成一帧。
    expect(
      calls.map((call) => (call.input as { input: { sequence: number } }).input.sequence),
    ).toEqual([0, 1, 2]);
    expect((calls[0]?.input as { size: number }).size).toBe(8);
  });

  it('finish 先 ACK 释放再由 Main 上传它持有的片段', async () => {
    const { bridge: value, calls } = bridge();
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    const released = await transport?.released(TICKET);
    expect(released?.ok).toBe(true);
    const finished = await transport?.finish(TICKET, { frames: 3, samples: 4800 });
    expect(finished?.ok).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(['reportCaptureReleased', 'finishCapture']);
    expect(calls[1]?.input).toEqual({
      connectionId: 'connection-1',
      captureId: 'cap-1',
      frames: 3,
    });
    // 渲染器不发送音频本体：finishCapture 只有帧数。
    expect(JSON.stringify(calls[1]?.input)).not.toContain('Uint8Array');
  });

  it('取消只 fence，不等释放；ACK 由 released 单独完成', async () => {
    const { bridge: value, calls } = bridge();
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    await transport?.cancel(TICKET);
    expect(calls.map((call) => call.name)).toEqual(['cancelCapture']);
    await transport?.released(TICKET);
    expect(calls.map((call) => call.name)).toEqual(['cancelCapture', 'reportCaptureReleased']);
  });

  it('恢复读同一个票据，不重新上传', async () => {
    const { bridge: value, calls } = bridge();
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    const recovered = await transport?.recover(TICKET);
    expect(recovered?.ok).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(['readCaptureResult']);
    expect(calls[0]?.input).toEqual({
      connectionId: 'connection-1',
      captureId: 'cap-1',
      clientId: 'server-client',
      agentId: 'agent-1',
      serviceEpoch: 'epoch-1',
    });
    expect(calls.some((call) => call.name === 'finishCapture')).toBe(false);
  });

  it('票据不是这一次要的：不把别人的票据交给设备', async () => {
    const { bridge: value } = bridge({
      begin: async () => ok({ ...TICKET, captureId: 'other', finishMode: 'review' }),
    });
    install(value);
    const transport = createDesktopVoiceTransport(target, submit);
    const result = await transport?.begin({
      captureId: 'cap-1',
      expectedFeatureRevision: 1,
      providerRef: 'pet.asr-magpie/magpie',
      bindingId: 'binding-1',
      finishMode: 'send',
    });
    expect(result?.ok).toBe(false);
  });

  it('桥不存在就是真实状态：没有 transport，也不造一个', () => {
    vi.stubGlobal('window', {});
    expect(createDesktopVoiceTransport(target, submit)).toBeNull();
  });
});

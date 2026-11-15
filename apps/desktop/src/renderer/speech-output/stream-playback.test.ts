import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_SPEECH_BLOCK_FRAMES,
  DESKTOP_SPEECH_MAX_BLOCKS,
  SPEECH_FORMAT,
  SPEECH_TTS_PROVIDER,
  type DesktopSpeechAudioEvent,
  type SpeechVerifiedTerminal,
} from '@pet/contracts';
import { SharedSpeechPlaybackOwner } from './stream-playback.js';

/** 让已 resolve 的 setup/chain 全部跑完，而不是只推进一个 microtask。 */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

const identity = {
  connectionId: 'connection-1',
  utteranceId: 'reply-1',
  clientId: 'desktop-1',
  agentId: 'agent-1',
  serviceEpoch: 'epoch-1',
  utteranceBindingId: 'whole-1',
  segmentIndex: 0,
  requestId: 'reply-1-0',
  playbackId: 'playback-1',
  localOwner: { pluginId: 'pet.speech-output', instanceId: 'default', generation: 2 },
  localTaskId: 'local-task-1',
  localStreamId: 'local-stream-1',
  remoteBinding: { providerRef: SPEECH_TTS_PROVIDER, bindingId: 'provider-binding-1' },
};

const terminal: SpeechVerifiedTerminal = {
  outcome: 'completed',
  finishReason: 'stop',
  producedFrames: 4,
  producedBytes: 8,
  drainedFrames: 4,
  drainedBytes: 8,
  nativeSettled: true,
  transportCleanup: 'settled',
  error: null,
};

interface FakeSource {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function fixture(
  options: {
    resume?: () => Promise<void>;
    createContext?: () => unknown;
    consume?: (...args: never[]) => Promise<unknown>;
    reportPlayback?: (...args: never[]) => Promise<unknown>;
  } = {},
) {
  const sources: FakeSource[] = [];
  const context = {
    currentTime: 0,
    state: 'running' as AudioContextState,
    resume: vi.fn(options.resume ?? (async () => {})),
    createBuffer: vi.fn((_channels: number, frames: number) => ({
      getChannelData: () => new Float32Array(frames),
    })),
    createBufferSource: vi.fn(() => {
      const source: FakeSource = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
    destination: {},
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
  };
  const ok = async (..._args: unknown[]): Promise<unknown> => ({ ok: true, value: null });
  // 测试只关心 ok/抛错，回执参数用宽松替身。
  const bridge = {
    playerReady: vi.fn(ok),
    consume: vi.fn(options.consume ?? ok),
    reportPlayback: vi.fn(options.reportPlayback ?? ok),
    reportReleased: vi.fn(ok),
  };
  const created: unknown[] = [];
  const owner = new SharedSpeechPlaybackOwner(
    bridge as unknown as ConstructorParameters<typeof SharedSpeechPlaybackOwner>[0],
    () => {
      created.push(context);
      if (options.createContext !== undefined) return options.createContext() as AudioContext;
      return context as unknown as AudioContext;
    },
  );
  return { owner, bridge, context, sources, created };
}

const start = (): DesktopSpeechAudioEvent => ({
  ...identity,
  sequence: 0,
  kind: 'start',
  format: SPEECH_FORMAT,
  volume: 80,
});
const chunk = (sequence: number, frames: number): [DesktopSpeechAudioEvent, Uint8Array] => [
  { ...identity, sequence, kind: 'chunk', byteLength: frames * 2 },
  new Uint8Array(frames * 2),
];
const end = (sequence: number): DesktopSpeechAudioEvent => ({
  ...identity,
  sequence,
  kind: 'end',
  terminal,
});

afterEach(() => vi.restoreAllMocks());

describe('shared speech streaming owner', () => {
  it('reports ready only after a running context, then plays and consumes in order', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    expect(f.bridge.playerReady).toHaveBeenCalledWith({
      ...identity,
      sequence: 0,
      format: SPEECH_FORMAT,
    });
    f.owner.receive(...chunk(1, 2));
    await vi.waitFor(() => expect(f.bridge.consume).toHaveBeenCalledOnce());
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0]?.start).toHaveBeenCalledOnce();
    f.owner.close();
  });

  it('fails and cleans up when resume resolves without reaching a running context', async () => {
    const f = fixture();
    f.context.resume.mockImplementationOnce(async () => {
      f.context.state = 'suspended';
    });
    f.owner.receive(start());
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    expect(f.bridge.playerReady).not.toHaveBeenCalled();
    expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(f.context.close).toHaveBeenCalledOnce();
    f.owner.close();
  });

  it('schedules a short tail node immediately, including a single frame', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    // 2401 frames = one full block plus a 1-frame tail; the tail must not wait for end.
    f.owner.receive(...chunk(1, DESKTOP_SPEECH_BLOCK_FRAMES + 1));
    await vi.waitFor(() => expect(f.bridge.consume).toHaveBeenCalledOnce());
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1]?.start).toHaveBeenCalledOnce();
    f.owner.close();
  });

  it('does not consume until every frame of the chunk is scheduled or ended', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(...chunk(1, DESKTOP_SPEECH_BLOCK_FRAMES * (DESKTOP_SPEECH_MAX_BLOCKS + 1)));
    await vi.waitFor(() => expect(f.sources).toHaveLength(DESKTOP_SPEECH_MAX_BLOCKS));
    expect(f.bridge.consume).not.toHaveBeenCalled();
    f.sources[0]?.onended?.();
    await vi.waitFor(() => expect(f.sources).toHaveLength(DESKTOP_SPEECH_MAX_BLOCKS + 1));
    f.owner.close();
  });

  it('releases only after a verified terminal and every scheduled node ended', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(...chunk(1, 2));
    await vi.waitFor(() => expect(f.bridge.consume).toHaveBeenCalledOnce());
    f.owner.receive(end(2));
    await Promise.resolve();
    expect(f.bridge.reportPlayback).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ended' }),
    );
    f.sources[0]?.onended?.();
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 2,
        cleanup: 'settled',
      }),
    );
    expect(f.bridge.reportPlayback).toHaveBeenCalledWith({
      ...identity,
      sequence: 2,
      status: 'ended',
      endedFrames: 2,
    });
    f.owner.close();
  });

  it('fences synchronously on stop and never starts a blocked or late chunk', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(...chunk(1, DESKTOP_SPEECH_BLOCK_FRAMES * (DESKTOP_SPEECH_MAX_BLOCKS + 1)));
    await vi.waitFor(() => expect(f.sources).toHaveLength(DESKTOP_SPEECH_MAX_BLOCKS));
    // Stop must release the capacity wait instead of queueing behind it.
    f.owner.receive({ ...identity, sequence: 2, kind: 'stop' });
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 2,
        cleanup: 'settled',
      }),
    );
    const scheduled = f.sources.length;
    f.owner.receive(...chunk(2, 2));
    await Promise.resolve();
    expect(f.sources).toHaveLength(scheduled);
    expect(f.bridge.consume).not.toHaveBeenCalled();
    f.owner.close();
  });

  it('releases a real cleanup even when playerReady itself is rejected', async () => {
    const f = fixture();
    f.bridge.playerReady.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unavailable', retryable: false, messageKey: 'unavailable' },
    } as never);
    f.owner.receive(start());
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.sources).toHaveLength(0);
    f.owner.close();
  });

  it('starts close while resume is still held, and releases only after it settles', async () => {
    let settleResume: ((reject: boolean) => void) | undefined;
    let settleClose: ((reject: boolean) => void) | undefined;
    const f = fixture();
    // 真实的浏览器 resume 可能一直挂到 close 被调用才 settle——不能先等它。
    f.context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          settleResume = (shouldReject) =>
            shouldReject ? reject(new Error('aborted')) : resolve();
        }),
    );
    f.context.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          settleClose = (shouldReject) =>
            shouldReject ? reject(new Error('close failed')) : resolve();
        }),
    );
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.context.resume).toHaveBeenCalledOnce());
    f.owner.receive({ ...identity, sequence: 0, kind: 'stop' });
    // stop 必须**先发起 close**，而不是排队等 resume。
    await vi.waitFor(() => expect(f.context.close).toHaveBeenCalledOnce());
    // close 与 pending work 都没 settle 前，不能声称 released。
    expect(f.bridge.reportReleased).not.toHaveBeenCalled();
    settleResume?.(false);
    await flush();
    expect(f.bridge.reportReleased).not.toHaveBeenCalled();
    settleClose?.(false);
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    expect(f.sources).toHaveLength(0);
    expect(f.bridge.playerReady).not.toHaveBeenCalled();
    f.owner.close();
  });

  it('rejects any frame whose full identity differs, even with the same playbackId', async () => {
    const variants = [
      { connectionId: 'other-connection' },
      { clientId: 'other-client' },
      { agentId: 'other-agent' },
      { serviceEpoch: 'other-epoch' },
      { utteranceBindingId: 'other-binding' },
      { segmentIndex: 1 },
      { requestId: 'other-request' },
      { localTaskId: 'other-task' },
      { localStreamId: 'other-stream' },
      { localOwner: { ...identity.localOwner, generation: 3 } },
      { remoteBinding: { ...identity.remoteBinding, bindingId: 'other-provider-binding' } },
      { remoteBinding: { ...identity.remoteBinding, providerRef: 'pet.tts-other/magpie' } },
    ];
    // 每个变体用一个全新 owner：否则一次 fence 会掩盖后面的身份错误。
    for (const patch of variants) {
      const f = fixture();
      f.owner.receive(start());
      await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
      f.owner.receive(
        { ...identity, ...patch, sequence: 1, kind: 'chunk', byteLength: 2 },
        new Uint8Array(2),
      );
      await flush();
      expect(f.sources, JSON.stringify(patch)).toHaveLength(0);
      expect(f.bridge.consume, JSON.stringify(patch)).not.toHaveBeenCalled();
      f.owner.close();
    }
  });

  it('reports failed and releases when context creation throws, without a context to close', async () => {
    const f = fixture({
      createContext: () => {
        throw new Error('no device');
      },
    });
    f.owner.receive(start());
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(f.sources).toHaveLength(0);
    f.owner.close();
  });

  it('reports failed and releases when gain setup throws after the context exists', async () => {
    const f = fixture();
    f.context.createGain.mockImplementationOnce(() => {
      throw new Error('no gain');
    });
    f.owner.receive(start());
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    // context 已经分配，必须真实 close。
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.bridge.playerReady).not.toHaveBeenCalled();
    f.owner.close();
  });

  it('fences and stops scheduling when consume is rejected', async () => {
    let rejectConsume: (() => void) | undefined;
    const f = fixture();
    f.bridge.consume.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          rejectConsume = () => resolve({ ok: false, error: { code: 'unavailable' } });
        }),
    );
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(...chunk(1, 2));
    await vi.waitFor(() => expect(f.bridge.consume).toHaveBeenCalledOnce());
    rejectConsume?.();
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup: 'settled' }),
      ),
    );
    // 被拒之后不再排新 PCM。
    const scheduled = f.sources.length;
    f.owner.receive(...chunk(2, 2));
    await Promise.resolve();
    expect(f.sources).toHaveLength(scheduled);
    f.owner.close();
  });

  it('does not release before the ended receipt settles, then releases even if it rejects', async () => {
    const f = fixture();
    let settleEnded: ((reject: boolean) => void) | undefined;
    f.bridge.reportPlayback.mockImplementation((input: { status: string }) =>
      input.status === 'ended'
        ? new Promise((resolve, reject) => {
            settleEnded = (shouldReject) =>
              shouldReject ? reject(new Error('ipc gone')) : resolve({ ok: true, value: null });
          })
        : Promise.resolve({ ok: true, value: null }),
    );
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(...chunk(1, 2));
    await vi.waitFor(() => expect(f.bridge.consume).toHaveBeenCalledOnce());
    f.owner.receive(end(2));
    // ended 回执只有在所有 node 真的 ended 之后才发。
    f.sources[0]?.onended?.();
    await vi.waitFor(() => expect(settleEnded).toBeTypeOf('function'));
    // 回执没 settle 前不能交 released（close 已发起是允许的）。
    await flush();
    expect(f.bridge.reportReleased).not.toHaveBeenCalled();
    // 回执 reject 也必须真实收尾，不能卡死。
    settleEnded?.(true);
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup: 'settled' }),
      ),
    );
    expect(f.context.close).toHaveBeenCalledOnce();
    f.owner.close();
  });

  it('does not open a second context while the previous cleanup is still pending', async () => {
    const f = fixture();
    let finishClose: (() => void) | undefined;
    f.context.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.stop();
    await vi.waitFor(() => expect(f.context.close).toHaveBeenCalledOnce());
    // 旧 cleanup 未完成：新 start 不能开第二个 context。
    f.owner.receive({
      ...identity,
      playbackId: 'playback-2',
      sequence: 0,
      kind: 'start',
      format: SPEECH_FORMAT,
      volume: 80,
    });
    await Promise.resolve();
    expect(f.created).toHaveLength(1);
    finishClose?.();
    await vi.waitFor(() => expect(f.created).toHaveLength(2));
    f.owner.close();
  });

  it('attributes a rejected consume to the sequence that chunk was issued with', async () => {
    const f = fixture();
    // 走 catch 路径：promise 直接 reject，而不是返回 ok:false。
    f.bridge.consume.mockImplementationOnce(async () => {
      throw new Error('ipc gone');
    });
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    // 第 1 块被拒；此时 expectedSequence 已推进到 2，但 Main 只认 1。
    f.owner.receive(...chunk(1, 2));
    await vi.waitFor(() =>
      expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', sequence: 1 }),
      ),
    );
    expect(f.bridge.reportReleased).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1 }));
    // 绝不能拿未来的序号回执。
    for (const call of f.bridge.reportReleased.mock.calls)
      expect((call[0] as { sequence: number }).sequence).toBeLessThanOrEqual(1);
    f.owner.close();
  });

  it('treats a rejected playerReady RPC as preparation failure, not a hang', async () => {
    const f = fixture();
    f.bridge.playerReady.mockImplementationOnce(async () => {
      throw new Error('rpc gone');
    });
    f.owner.receive(start());
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'settled',
      }),
    );
    expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', sequence: 0 }),
    );
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.sources).toHaveLength(0);
    f.owner.close();
  });

  it('keeps an unreleased context fenced across later rejected starts', async () => {
    const f = fixture();
    f.context.close.mockImplementationOnce(async () => {
      throw new Error('close refused');
    });
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.stop();
    await vi.waitFor(() =>
      expect(f.bridge.reportReleased).toHaveBeenCalledWith({
        ...identity,
        sequence: 0,
        cleanup: 'failed',
      }),
    );
    // 被拒的新 session 没分配资源，不得用它的空清理覆盖更早的释放失败。
    for (let index = 2; index <= 4; index++) {
      const playbackId = `playback-${index}`;
      f.owner.receive({
        ...identity,
        playbackId,
        sequence: 0,
        kind: 'start',
        format: SPEECH_FORMAT,
        volume: 80,
      });
      await flush();
      expect(f.created).toHaveLength(1);
      expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', playbackId }),
      );
      await vi.waitFor(() =>
        expect(f.bridge.reportReleased).toHaveBeenCalledWith(
          expect.objectContaining({ playbackId, cleanup: 'settled' }),
        ),
      );
    }
    f.owner.close();
  });

  it('never creates a context when stop lands before the previous cleanup finishes', async () => {
    const f = fixture();
    let finishClose: (() => void) | undefined;
    f.context.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.stop();
    await vi.waitFor(() => expect(f.context.close).toHaveBeenCalledOnce());
    // 第二个 session 卡在等 prior；此刻 stop 它。
    f.owner.receive({
      ...identity,
      playbackId: 'playback-2',
      sequence: 0,
      kind: 'start',
      format: SPEECH_FORMAT,
      volume: 80,
    });
    f.owner.receive({ ...identity, playbackId: 'playback-2', sequence: 0, kind: 'stop' });
    finishClose?.();
    await flush();
    // 它从没被分配过 context，所以只应创建过第一个。
    expect(f.created).toHaveLength(1);
    f.owner.close();
  });

  it('rejects a non-even or oversized chunk payload before scheduling anything', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive({ ...identity, sequence: 1, kind: 'chunk', byteLength: 3 }, new Uint8Array(3));
    await vi.waitFor(() =>
      expect(f.bridge.reportPlayback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      ),
    );
    expect(f.sources).toHaveLength(0);
    f.owner.close();
  });

  it('ignores events from a different playback identity', async () => {
    const f = fixture();
    f.owner.receive(start());
    await vi.waitFor(() => expect(f.bridge.playerReady).toHaveBeenCalledOnce());
    f.owner.receive(
      { ...identity, playbackId: 'other', sequence: 1, kind: 'chunk', byteLength: 2 },
      new Uint8Array(2),
    );
    await Promise.resolve();
    expect(f.sources).toHaveLength(0);
    expect(f.bridge.consume).not.toHaveBeenCalled();
    f.owner.close();
  });
});

import type {
  CaptureErrorReason,
  DemoBridge,
  DemoCaptureTicket,
  DemoPhase,
  DemoSnapshot,
  Result,
} from '@pet/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { microphoneCapture, type DemoCaptureHandle } from './demo/capture.js';
import { CALL_REJECTED, COPY, UNCERTAIN, describeError } from './copy.js';
import { isConfirmedRejection } from './use-plugin-actions.js';

/**
 * 一次写操作的结果。ok 只表示"请求被接受"：之后界面看到的变化来自 changed 事件，
 * 不是这里的承诺。
 */
export interface DemoOutcome {
  ok: boolean;
  error: string | null;
}

export type DemoAction =
  | 'send'
  | 'cancel'
  | 'clear'
  | 'saveKey'
  | 'removeKey'
  | 'record'
  | 'ready'
  | 'finish'
  | 'captureError';

/** 一次录音的上行会话：序号、收尾与失败上报都只在这里。 */
export interface DemoCaptureSession {
  /** 设备起来后把真实采样率交上去；这一步没过就没有可提交的 ended。 */
  ready(sampleRate: number): Promise<DemoOutcome>;
  /** 交一段 16k 单声道 Float32 PCM：被接受之后序号才前进，拒收就拒绝。 */
  push(samples: Float32Array): Promise<void>;
  /** 采集结束：等所有分块发完再提交一次识别，只提交一次。 */
  ended(): Promise<DemoOutcome>;
  /** 采集失败：按固定原因上报，不假装识别出了东西。 */
  failed(reason: CaptureErrorReason): Promise<void>;
}

/** 全场唯一的录音会话：任何页面读到的都是同一次。 */
export interface DemoRecording {
  readonly token: string;
  readonly seconds: number;
}

export interface DemoState {
  available: boolean;
  snapshot: DemoSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  pending: ReadonlySet<DemoAction>;
  sendText: (text: string) => Promise<DemoOutcome>;
  cancel: () => Promise<DemoOutcome>;
  clearHistory: () => Promise<DemoOutcome>;
  saveProviderKey: (value: string) => Promise<DemoOutcome>;
  removeProviderKey: () => Promise<DemoOutcome>;
  recording: DemoRecording | null;
  /** 剩余秒数；到点自动结束，和手动点「结束并识别」同一条路。 */
  left: number | null;
  startRecording: () => Promise<void>;
  endRecording: () => Promise<void>;
  /** 用户主动作废这一次：只有这时候才发 cancel。 */
  cancelRecording: () => Promise<void>;
}

export interface DemoOptions {
  /** 采集事件异步到达，提示要能从这一处说出来，不在界面里复制一份状态。 */
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

const OK: DemoOutcome = { ok: true, error: null };
const BUSY: DemoOutcome = { ok: false, error: '上一个操作还没结束。' };
const UNCONFIRMED: DemoOutcome = { ok: false, error: UNCERTAIN };

/** 上行断了的固定说法：采集器只需要"这一段没交出去"，不需要桥的错误细节。 */
const PUSH_STOPPED = new Error('录音上行已停止。');

/** 服务端还认为这一次在录的两个阶段。 */
const LIVE_PHASES: ReadonlySet<DemoPhase> = new Set(['arming', 'recording']);

function currentBridge(): DemoBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.petDemo;
}

/** 已经拒绝的分块链：收尾时先咽下旧拒绝，别让它盖住这一次的结论。 */
function drain(chain: Promise<void>): Promise<void> {
  return chain.catch(() => undefined);
}

/**
 * Demo 控制台的唯一数据源与录音会话：window.petDemo。
 *
 * 阶段、文本、记录都在服务端推进，这里订阅 onChanged 静默重读，不在界面层推算。
 * 读取带递增序号，晚到的旧响应直接丢弃：一次旧 idle 不能把刚开始的录音判死。
 * 录音会话只在这里一份——切去权限页审批也不会丢麦；采集失败、外部阶段变化、窗口
 * 关闭都只放本地设备，只有用户主动取消才发 cancel，免得把服务端记下的错误清成 idle。
 */
export function useDemo({ notify }: DemoOptions): DemoState {
  const bridge = currentBridge();
  const available = bridge !== undefined;
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [loading, setLoading] = useState(bridge !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<DemoAction>>(new Set());
  const [recording, setRecording] = useState<DemoRecording | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  // 读取可能在窗口关闭之后才回来。
  const alive = useRef(true);
  const inFlight = useRef(new Set<DemoAction>());
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  });

  /** issued 是发出的最新一份，applied 是真正落到界面的那一份。 */
  const issued = useRef(0);
  const [applied, setApplied] = useState(0);
  const startedFrom = useRef(0);

  const handleRef = useRef<DemoCaptureHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recordingRef = useRef<DemoRecording | null>(null);

  const read = useCallback(async (visible: boolean) => {
    const current = currentBridge();
    if (current === undefined) {
      return;
    }
    const seq = issued.current + 1;
    issued.current = seq;
    if (visible) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await current.getSnapshot();
      // 期间又发过一次读取：这一份已经过期，丢掉，不拿旧阶段去停新录音。
      if (!alive.current || seq !== issued.current) {
        return;
      }
      if (result.ok) {
        setSnapshot(result.value);
        setError(null);
        setApplied(seq);
      } else {
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current && seq === issued.current) {
        setError(CALL_REJECTED);
      }
    } finally {
      /*
       * 最新那份读取一完成就收起 spinner，silent 重读也算：
       * 只看 visible 会永久转圈——刷新一发出就被 onChanged 的 silent 读取抢过序号，
       * 之后就再没有人清 loading。
       */
      if (alive.current && seq === issued.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read(true);
    const off = currentBridge()?.onChanged(() => {
      void read(false);
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, [read]);

  const leave = useCallback((action: DemoAction) => {
    inFlight.current.delete(action);
    setPending((current) => {
      if (!current.has(action)) {
        return current;
      }
      const next = new Set(current);
      next.delete(action);
      return next;
    });
  }, []);

  /**
   * 写操作的唯一通道：明确拒绝就照实说；桥断了说明请求可能已经到达，
   * 记为未确认并收起数据（等用户自己重新读取），不自动重试、不声称没发生。
   */
  const run = useCallback(
    async (
      action: DemoAction,
      call: (bridge: DemoBridge) => Promise<Result<DemoSnapshot | null>>,
    ): Promise<DemoOutcome> => {
      const current = currentBridge();
      if (current === undefined) {
        return { ok: false, error: COPY.missingBridge };
      }
      if (inFlight.current.has(action)) {
        return BUSY;
      }
      inFlight.current.add(action);
      setPending((state) => new Set(state).add(action));
      try {
        const result = await call(current);
        if (!result.ok) {
          if (isConfirmedRejection(result.error.code)) {
            return { ok: false, error: describeError(result.error) };
          }
          setError(UNCERTAIN);
          return UNCONFIRMED;
        }
        if (result.value !== null) {
          setSnapshot(result.value);
          setError(null);
        }
        return OK;
      } catch {
        setError(UNCERTAIN);
        return UNCONFIRMED;
      } finally {
        leave(action);
      }
    },
    [leave],
  );

  const openCapture = useCallback(
    (ticket: DemoCaptureTicket): DemoCaptureSession => {
      let sequence = 0;
      let broken = false;
      let submitted = false;
      // 分块必须按序号到达：后一段等前一段被接受之后再上行。
      let tail: Promise<void> = Promise.resolve();

      return {
        ready: (sampleRate) =>
          run('ready', (target) => target.captureReady({ token: ticket.token, sampleRate })),
        push: (samples) => {
          const payload = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
          tail = tail.then(async () => {
            if (broken) {
              throw PUSH_STOPPED;
            }
            const current = currentBridge();
            if (current === undefined) {
              broken = true;
              throw PUSH_STOPPED;
            }
            // Float32 的原样字节直接交给服务端：M1 与 sherpa 用的就是这条通道。
            const result = await current.pushAudio({ token: ticket.token, sequence }, payload);
            if (!result.ok) {
              broken = true;
              // 拒绝要交回采集器：它据此关硬件并报 failed，而不是继续走到 ended。
              throw PUSH_STOPPED;
            }
            sequence += 1;
          });
          return tail;
        },
        ended: async () => {
          await drain(tail);
          if (broken) {
            return { ok: false, error: '上行已经断了，这一次没有送去识别。' };
          }
          if (submitted) {
            return { ok: false, error: '这一次已经交过一次了。' };
          }
          submitted = true;
          return run('finish', (target) =>
            target.finishRecording({ token: ticket.token, frames: sequence }),
          );
        },
        failed: async (reason) => {
          broken = true;
          await drain(tail);
          await run('captureError', (target) =>
            target.reportCaptureError({ token: ticket.token, reason }),
          );
        },
      };
    },
    [run],
  );

  const beginRecording = useCallback(async (): Promise<DemoCaptureTicket | null> => {
    const current = currentBridge();
    if (current === undefined || inFlight.current.has('record')) {
      return null;
    }
    inFlight.current.add('record');
    setPending((state) => new Set(state).add('record'));
    try {
      const result = await current.beginRecording();
      if (!result.ok) {
        setError(describeError(result.error));
        return null;
      }
      return result.value;
    } catch {
      setError(UNCERTAIN);
      return null;
    } finally {
      leave('record');
    }
  }, [leave]);

  const clearSession = useCallback(() => {
    recordingRef.current = null;
    handleRef.current = null;
    abortRef.current = null;
    setRecording(null);
    setLeft(null);
  }, []);

  /** 只放本地资源：挂起的授权也中止、设备关掉；服务端状态由它自己的事件与提示说话。 */
  const closeLocal = useCallback(() => {
    abortRef.current?.abort();
    handleRef.current?.dispose();
    clearSession();
  }, [clearSession]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (recordingRef.current !== null || microphoneCapture === null) {
      return;
    }
    const ticket = await beginRecording();
    if (ticket === null) {
      notifyRef.current('没有开始录音。', 'danger');
      return;
    }
    const session = openCapture(ticket);
    /*
     * 会话身份就是这个 controller：先挂上、先算 arming，取消与外部阶段变化才能立刻接管。
     * 读取序号只用于忽略开始前的快照（startedFrom），不参与句柄归属：ready 一定带一次
     * changed 事件，拿它当归属就等于每次都由自己把刚开好的设备关掉。
     */
    const controller = new AbortController();
    abortRef.current = controller;
    const next: DemoRecording = {
      token: ticket.token,
      // 能录多久以票据为准：那是服务端真正接受的上限。
      seconds: Math.round(ticket.maxSamples / ticket.sampleRate),
    };
    recordingRef.current = next;
    startedFrom.current = issued.current;
    setRecording(next);
    setLeft(next.seconds);

    /** 这一次还是不是当前会话：旧会话的收尾不许清掉新的。 */
    const current = (): boolean => abortRef.current === controller && !controller.signal.aborted;

    /** 放弃这一次：abort 让还在连的采集停下；不发 cancel，服务端的错误留着。 */
    const giveUp = (message: string): void => {
      if (!current()) {
        return;
      }
      controller.abort();
      clearSession();
      notifyRef.current(message, 'danger');
    };

    let device: DemoCaptureHandle | null = null;
    try {
      device = await microphoneCapture(ticket, {
        ready: async (sampleRate) => {
          const outcome = await session.ready(sampleRate);
          if (!outcome.ok) {
            giveUp(`录音没有就绪：${outcome.error}`);
          }
        },
        push: (samples) => session.push(samples),
        ended: async () => {
          // 先认身份再提交：已经作废的这一轮不该把音频交给识别。
          if (!current()) {
            return;
          }
          const outcome = await session.ended();
          clearSession();
          notifyRef.current(
            outcome.ok ? '已开始识别。' : `结束录音失败：${outcome.error}`,
            outcome.ok ? 'ok' : 'danger',
          );
        },
        failed: (reason) => {
          if (!current()) {
            return;
          }
          device?.dispose();
          void session.failed(reason);
          clearSession();
          notifyRef.current(`录音中断（${reason}），没有送去识别。`, 'danger');
        },
        signal: controller.signal,
      });
    } catch {
      giveUp('麦克风没有开起来。');
      return;
    }
    // 迟到的设备：这一轮已经收场（用户取消 / 外部阶段变化 / ready 失败），只放掉它。
    if (!current()) {
      device?.dispose();
      return;
    }
    handleRef.current = device;
  }, [beginRecording, clearSession, openCapture]);

  /** 结束：只请求采集停止，提交识别交给 ended() 回调，不在两处各发一次。 */
  const endRecording = useCallback(async (): Promise<void> => {
    const handle = handleRef.current;
    if (handle !== null) {
      await handle.stop();
    }
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    closeLocal();
    // 用户明确作废这一次：这时才发 cancel。
    await run('cancel', (target) => target.cancel());
  }, [closeLocal, run]);

  useEffect(() => {
    if (recording === null) {
      return;
    }
    const timer = setInterval(() => {
      setLeft((value) => (value === null ? value : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  /* 到点自动结束：与手动点「结束并识别」同一条路。 */
  useEffect(() => {
    if (recording !== null && left !== null && left <= 0) {
      void endRecording();
    }
  }, [endRecording, left, recording]);

  /*
   * 服务端已经不在这一次录音上了（出错、超时或已经收完）：只放本地设备。
   * 只认开始录音之后读到的那份快照，否则一次旧 idle 会立刻掐掉刚开的麦。
   */
  useEffect(() => {
    if (recording === null || snapshot === null || applied <= startedFrom.current) {
      return;
    }
    if (!LIVE_PHASES.has(snapshot.phase)) {
      closeLocal();
    }
  }, [applied, closeLocal, recording, snapshot]);

  // 设置台关闭：只放本地设备，不替用户发 cancel。
  useEffect(
    () => () => {
      abortRef.current?.abort();
      handleRef.current?.dispose();
    },
    [],
  );

  const refresh = useCallback(() => {
    void read(true);
  }, [read]);
  const sendText = useCallback(
    (text: string) => run('send', (target) => target.sendText({ text })),
    [run],
  );
  const cancel = useCallback(() => run('cancel', (target) => target.cancel()), [run]);
  const clearHistory = useCallback(() => run('clear', (target) => target.clearHistory()), [run]);
  const saveProviderKey = useCallback(
    (value: string) => run('saveKey', (target) => target.saveProviderKey({ value })),
    [run],
  );
  const removeProviderKey = useCallback(
    () => run('removeKey', (target) => target.removeProviderKey()),
    [run],
  );

  return useMemo(
    () => ({
      available,
      snapshot,
      loading,
      error,
      refresh,
      pending,
      sendText,
      cancel,
      clearHistory,
      saveProviderKey,
      removeProviderKey,
      recording,
      left,
      startRecording,
      endRecording,
      cancelRecording,
    }),
    [
      available,
      snapshot,
      loading,
      error,
      refresh,
      pending,
      sendText,
      cancel,
      clearHistory,
      saveProviderKey,
      removeProviderKey,
      recording,
      left,
      startRecording,
      endRecording,
      cancelRecording,
    ],
  );
}

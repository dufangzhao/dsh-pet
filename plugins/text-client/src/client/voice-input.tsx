/**
 * 语音输入的受控组件：web 与桌面共用这一份，样式在 voice-input.css。
 *
 * 分成两半：
 * - `useVoiceInput` 是 owner：持有这次采集的 intent、状态机、本地锁与票据；
 * - `VoiceInput` 只把 owner 的状态画成 DOM。
 *
 * 设置台把 hook 挂在页面之上（换页不打断录音），页面只渲染视图；web 两者都在 App。
 * hook 不拥有设备也不拥有 HTTP：采样器与 `VoiceTransport` 都是调用方给的窄接口。
 *
 * 四条顺序是契约的一部分，不能调换：
 * 1. 设备**真的**放开（采样器 `finish`/`cancel` 结算）之后才 ACK `released`；
 * 2. 正常结束：释放 → ACK → 宿主上传/转写；
 * 3. 转写响应丢失：读同一个票据一次，不重传、不重录，也不当成消息的「未知」；
 * 4. 已经 ACK 过的设备没有第二次释放可等：转写阶段的取消只 fence 宿主，不补发 ACK。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { Button, Field } from '@pet/ui-kit';
import {
  type KernelError,
  type VoiceFinishMode,
  type VoiceTicket,
  type VoiceView,
} from '@pet/contracts';

import {
  beginIntent,
  canStart,
  captureLimitHint,
  editPreview,
  emptyVoiceState,
  errorText,
  finishModeLabel,
  markCancelled,
  markFailed,
  markFinishing,
  markRecording,
  markRetained,
  markReleaseFailed,
  markReleased,
  markRetiring,
  markSubmitted,
  markSubmitting,
  markTranscribing,
  markUncertain,
  planFinish,
  showPreview,
  stillOurs,
  type VoiceState,
} from './voice-form.js';
import type { VoiceSubmitOutcome, VoiceTransport } from './voice-transport.js';

/** 一次采集的控制对象：采样器给出，释放只认它的 `released`。 */
type Operation = ReturnType<VoiceSampler['start']>;

/** 采样器的最小形状：真实实现来自 `createVoiceSampler`。 */
export interface VoiceSampler {
  unavailableReason(): string | null;
  start(input: {
    readonly ticket: VoiceTicket;
    readonly onReady: (sampleRate: number) => Promise<void>;
    readonly onPush: (frame: Float32Array) => Promise<void>;
    readonly onFailed: (reason: string) => void;
    readonly onLimitReached: () => void;
    readonly onLevel?: (rms: number) => void;
    readonly workletUrl: string;
  }): {
    finish(): Promise<{ readonly frames: number; readonly samples: number }>;
    cancel(): Promise<void>;
    readonly released: Promise<void>;
  };
}

/**
 * 一次采集：票据、它自己的会话、设备句柄，三样同生共死。
 *
 * 合并成一个对象是为了让「这次采集」在异步里始终是一个整体：换目标时一起作废，
 * 释放只回发起时的会话，ASR 阶段也还知道设备是否已经 ACK——不会再出现
 * 「设备真的放开了，却因为句柄已经交出去而误报未释放」。
 */
interface Capture {
  readonly ticket: VoiceTicket;
  /** 发起这一次的会话。换目标之后 ACK 仍回它，不碰新目标。 */
  readonly transport: VoiceTransport;
  /** 采样器句柄；null 表示渲染器没有拿到设备（宿主租约仍然要结算）。 */
  handle: Operation | null;
  /** 结束序列已经跑过：设备已经停，只剩 ACK 要补。 */
  stopped: boolean;
  /** 唯一一份设备清理；重复调用拿到同一个结果。 */
  cleanup: Promise<ReleaseOutcome> | null;
  /** 设备已确认放开：ASR 阶段不再需要（也不允许）第二次 ACK。 */
  released: boolean;
  /** 已经放弃/取消过：同一份 cleanup 只结算一次。 */
  abandoned: boolean;
}

/** 释放只有三种结论：确认、设备没放开、宿主没确认。 */
type ReleaseOutcome = 'settled' | 'device-failed' | 'ack-failed';

const RELEASE_TEXT: Record<Exclude<ReleaseOutcome, 'settled'>, string> = {
  'device-failed': '麦克风没有确认放开。请重试，或重新开始一次。',
  'ack-failed': '这次录音的释放没有送达宿主。',
};

export interface VoiceInputProps {
  /** 当前目标的会话；null 表示未连接或没有目标。换目标必须换会话。 */
  readonly transport: VoiceTransport | null;
  readonly sampler: VoiceSampler;
  readonly workletUrl: string;
  /** 当前连接是否可用。 */
  readonly live: boolean;
  /** 换目标时改变；旧采集不得落到新目标上。 */
  readonly targetKey: string;
}

export interface VoiceController {
  readonly state: VoiceState;
  readonly view: VoiceView | null;
  readonly mode: VoiceFinishMode;
  readonly hint: string;
  readonly rules: { readonly ok: boolean; readonly reason: string | null };
  readonly level: number;
  /** 重新读一次视图（保存设置之后用）；不动正在进行的采集。 */
  reload(): void;
  /** 转写结果丢失时的一次显式状态读取；不重传、不重录。 */
  recover(): void;
  start(): void;
  finish(): void;
  cancel(): void;
  send(): void;
  edit(text: string): void;
}

/** 「请求可能已经被处理」才算未知；服务端明确拒绝不能假装未知。 */
function unknownOutcome(error: KernelError | null): boolean {
  return error !== null && ['network', 'timeout', 'unavailable', 'internal'].includes(error.code);
}

function newCommandId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Float32 帧 → 小端 f32le 字节；不改变采样值。 */
export function encodeFrame(frame: Float32Array): Uint8Array {
  const bytes = new Uint8Array(frame.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < frame.length; index += 1)
    view.setFloat32(index * 4, frame[index] ?? 0, true);
  return bytes;
}

/** 采样器的失败原因只有四个固定值；说清是哪一个，不给原始异常。 */
function failureText(reason: string): string {
  switch (reason) {
    case 'denied':
      return '没有获得麦克风权限。';
    case 'missing':
      return '没有找到可用的麦克风。';
    case 'format':
      return '麦克风格式不匹配。';
    default:
      return '录音中断了。';
  }
}

export function useVoiceInput({
  transport,
  sampler,
  workletUrl,
  live,
  targetKey,
}: VoiceInputProps): VoiceController {
  const [state, setState] = useState<VoiceState>(emptyVoiceState);
  const [view, setView] = useState<VoiceView | null>(null);
  const [level, setLevel] = useState(0);
  /** 显式重读视图的计数；保存设置后 +1。 */
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
  /** 同步锁：纯 setState 防不住同 tick 的双击。 */
  const inFlight = useRef<symbol | null>(null);
  const mounted = useRef(true);
  /** 当前这一次采集（票据 + 会话 + 设备）；取消、结束、恢复都只走它。 */
  const capture = useRef<Capture | null>(null);
  /** 已经尝试过的意图：内容不变的重试必须复用同一个 commandId。 */
  const attempted = useRef<{ text: string; commandId: string } | null>(null);
  /** 采样器回调里要用的最新 finish，不能捕获创建时的闭包。 */
  const finishRef = useRef<() => Promise<void>>(async () => {});

  const claim = (): symbol | null => {
    if (inFlight.current !== null) return null;
    const token = Symbol('voice');
    inFlight.current = token;
    return token;
  };
  const release = (token: symbol): void => {
    if (inFlight.current === token) inFlight.current = null;
  };

  /** 这一次还是不是界面上活着的那一次：取消、换目标、卸载之后都不是。 */
  const stillMine = useCallback(
    (target: Capture): boolean =>
      mounted.current && capture.current === target && !target.abandoned,
    [],
  );

  /** 设备还该继续出帧吗：结束序列一启动就不再收，迟到的一帧不能进上传。 */
  const streaming = useCallback(
    (target: Capture): boolean => stillMine(target) && !target.stopped,
    [stillMine],
  );

  /**
   * 设备释放：只认采样器的 `released`，ACK 只回**发起时**的会话。
   *
   * 只有一份，重复调用拿到同一个结果。已经 ACK 过（转写阶段）就没有第二次可等，
   * 直接是 settled——否则取消会把自己已经放开的设备误报成未释放。
   * 失败如实返回，不当成功：不 ACK、不上传、不冒充干净。
   */
  const cleanup = useCallback((target: Capture): Promise<ReleaseOutcome> => {
    if (target.cleanup !== null) return target.cleanup;
    target.cleanup = (async (): Promise<ReleaseOutcome> => {
      // 已经 ACK 过：转写阶段的取消没有第二次释放，也不能再发一次回执。
      if (target.released) return 'settled';
      // 还活着的设备要停；已经跑过结束序列的只差 ACK。
      if (target.handle !== null && !target.stopped) await target.handle.cancel().catch(() => {});
      // 没有设备可等时（渲染器没拿到）只剩宿主那条租约要结算。
      if (target.handle !== null) {
        try {
          await target.handle.released;
        } catch {
          return 'device-failed';
        }
      }
      let acked: Awaited<ReturnType<VoiceTransport['released']>>;
      try {
        acked = await target.transport.released(target.ticket);
      } catch {
        // ACK 自己抛错也是未确认：不能当成功，也不能让调用方一直握着锁。
        return 'ack-failed';
      }
      if (!acked.ok) return 'ack-failed';
      target.released = true;
      return 'settled';
    })();
    return target.cleanup;
  }, []);

  /**
   * 放弃这一次：先 fire 宿主 fence（不 await），再等设备真的放开并 ACK。
   *
   * 迟到的结算只作用于这一次：换目标/卸载之后既不写状态，也不碰新采集。
   * 重复调用幂等——cleanup 是同一份，第二次不会补发 ACK。
   */
  const abandon = useCallback(
    (target: Capture, fence: boolean, failure: string | null = null): void => {
      // 幂等：同一次采集只结算一次，第二次不会补发 ACK 也不会重写状态。
      if (target.abandoned) return;
      target.abandoned = true;
      // 先让服务侧拒绝迟到的帧与上传；不等它返回，否则会挡住本地释放。
      if (fence) void target.transport.cancel(target.ticket).catch(() => {});
      // 只有真的有设备待放开才说「正在释放」；已 ACK 的转写阶段不是设备问题。
      if (target.handle !== null && !target.released)
        setState((value) => markRetiring(value, '正在释放麦克风…'));
      void cleanup(target).then((outcome) => {
        // 这一次已经不是界面上那一次（换目标/卸载）：清理照做，状态一个字不写。
        if (!mounted.current || capture.current !== target) return;
        capture.current = null;
        setLevel(0);
        if (outcome !== 'settled') {
          setState((value) => markReleaseFailed(value, null, RELEASE_TEXT[outcome]));
          return;
        }
        // 释放确认之后才回到可开始的状态；失败原因作为这一轮的结果保留下来。
        setState(() =>
          failure === null ? markReleased() : markFailed(markReleased(), null, failure),
        );
      });
    },
    [cleanup],
  );

  /** 这一次已经走到本地终态：设备早已 ACK，只把记录摘掉，别挡住下一次采集。 */
  const forget = useCallback((target: Capture): void => {
    if (capture.current === target) capture.current = null;
  }, []);

  /**
   * 换目标/卸载：这一次立刻脱手，只把旧设备清理掉。
   *
   * 与 `cancel` 不同，这里**不写任何状态**：新目标有自己的采集，旧设备的迟到结算
   * （哪怕失败）只影响旧连接，不能把错误或「未释放」按到新 intent 上。
   */
  const discard = useCallback((): void => {
    generation.current += 1;
    attempted.current = null;
    inFlight.current = null;
    const target = capture.current;
    capture.current = null;
    setLevel(0);
    setState(emptyVoiceState);
    if (target === null) return;
    // 取消已经把它标记为放弃时，cleanup 还是同一份，重复调用不会补发 ACK。
    target.abandoned = true;
    void cleanup(target);
  }, [cleanup]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      const target = capture.current;
      capture.current = null;
      // 卸载也要真的等释放，但那时界面已经不在了：只做清理与 ACK，不写状态。
      if (target !== null) void cleanup(target);
    };
  }, [cleanup]);

  // 换目标或换会话：旧采集作废。会话由调用方按目标重建。
  useEffect(() => {
    discard();
  }, [targetKey, transport, discard]);

  // 读一次语音设置；目标或会话变了重读。
  useEffect(() => {
    if (!live || transport === null) {
      setView(null);
      return;
    }
    let cancelled = false;
    void transport.read().then((result) => {
      if (cancelled || !mounted.current) return;
      setView(result.ok ? result.value : null);
    });
    return () => {
      cancelled = true;
    };
  }, [live, transport, targetKey, reloadToken]);

  const captureReason = sampler.unavailableReason();
  const rules = useMemo(() => {
    const admission = canStart(state, view, live && transport !== null);
    return admission.ok && captureReason !== null
      ? { ok: false, reason: captureReason }
      : admission;
  }, [state, view, live, transport, captureReason]);
  // 文案跟的是**这一次票据**的模式：中途改设置不影响正在进行的采集。
  const mode: VoiceFinishMode = state.intent?.finishMode ?? view?.feature.finishMode ?? 'send';
  const hint = captureLimitHint(mode);

  /**
   * 提交：冻结一次 {commandId,text}，走宿主现有的消息入口。
   *
   * 真正被挡住（离线/目标过期/待确认已满）时文本留在预览里，同一个 commandId
   * 可以原样再发；不排队、不自动重试，也不动别处的草稿。
   */
  const dispatch = useCallback(
    async (text: string, reuse: string | null): Promise<void> => {
      if (transport === null) return;
      const token = claim();
      if (token === null) return;
      const started = generation.current;
      const previous = attempted.current;
      const commandId =
        reuse ??
        (previous !== null && previous.text === text ? previous.commandId : newCommandId());
      attempted.current = { text, commandId };
      setState((value) => markSubmitting(value, commandId));
      let outcome: VoiceSubmitOutcome;
      try {
        outcome = await transport.submit(commandId, text);
      } catch {
        // 派发之后才抛错：结果未知，不是「服务拒绝」；文本与同一个 commandId 都留着。
        outcome = 'uncertain';
      } finally {
        release(token);
      }
      if (!mounted.current || generation.current !== started) return;
      if (outcome === 'accepted') {
        attempted.current = null;
        setState(markSubmitted);
        return;
      }
      if (outcome === 'uncertain') {
        setState((value) => markUncertain(value, text));
        return;
      }
      setState((value) =>
        markRetained(
          value,
          text,
          commandId,
          outcome === 'skipped'
            ? '这次没有发出去：当前连接不可用或待确认已满。文本留在这里，可以稍后再发。'
            : '服务拒绝了这条消息。文本留在这里，可以稍后再发。',
        ),
      );
    },
    [transport],
  );

  /**
   * 转写结果：拿到就按票据模式落地；丢了只读同一个票据一次。
   *
   * 「转写结果未知」与「消息回执未知」是两件事：前者可以按 captureId 再读，
   * 后者只能复用同一个 commandId 重试。所以这里既不重传音频，也不自动轮询。
   */
  const settleResult = useCallback(
    async (target: Capture, text: string | null): Promise<void> => {
      if (text === null) {
        setState((value) => markFailed(value, null, '没有识别到语音。'));
        return;
      }
      if (target.ticket.finishMode === 'review') {
        setState((value) => showPreview(value, text));
        return;
      }
      await dispatch(text, null);
    },
    [dispatch],
  );

  /** 显式/合并后的状态恢复：同一个 capture/client/agent/epoch，只读一次。 */
  const recoverOnce = useCallback(
    async (target: Capture, coalesce: boolean): Promise<void> => {
      if (coalesce && inFlight.current !== null) return;
      const token = claim();
      if (token === null) return;
      if (stillMine(target)) setState((value) => markTranscribing(value));
      let result: Awaited<ReturnType<VoiceTransport['recover']>> | null = null;
      try {
        result = await target.transport.recover(target.ticket);
      } catch {
        result = null;
      } finally {
        release(token);
      }
      if (!stillMine(target)) return;
      if (result === null) {
        setState((value) => ({
          ...value,
          phase: 'transcribing',
          notice: '还没有拿到转写结果。可以再读一次，不会重新上传音频。',
        }));
        return;
      }
      if (!result.ok) {
        setState((value) => ({
          ...value,
          phase: 'transcribing',
          notice:
            result.error.code === 'not-ready' || result.error.code === 'unavailable'
              ? '这次转写已经不在服务上了。再录一次是新的输入，不会自动重传这段旧音频。'
              : '还没有拿到转写结果。可以再读一次，不会重新上传音频。',
        }));
        return;
      }
      const plan = planFinish(result.value);
      if (plan.text === null) {
        if (result.value.phase === 'transcribing' || result.value.phase === 'retiring') {
          setState((value) => ({
            ...value,
            phase: 'transcribing',
            notice: '还在转写。可以再读一次，不会重新上传音频。',
          }));
          return;
        }
        forget(target);
        setState((value) =>
          markFailed(value, result.value.error, plan.notice ?? '没有识别到语音。'),
        );
        return;
      }
      // 取消/换目标之后到达的终态：只留给服务侧，不提交到新 intent。
      if (!stillMine(target)) return;
      await settleResult(target, plan.text);
      forget(target);
    },
    [stillMine, forget, settleResult],
  );

  /** 结束：停设备 → 冲刷尾巴 → ACK 释放 → 宿主上传/转写 → 按模式发送或预览。 */
  const finish = useCallback(async (): Promise<void> => {
    const target = capture.current;
    if (target === null || target.handle === null || target.abandoned || transport === null) return;
    if (state.intent === null || !stillOurs(state, targetKey)) {
      discard();
      return;
    }
    const token = claim();
    if (token === null) return;

    let summary: { frames: number; samples: number } | null;
    let outcome: ReleaseOutcome | null = null;
    let uploaded: Awaited<ReturnType<VoiceTransport['finish']>> | null = null;
    let threw = false;
    try {
      setState((value) => markFinishing(value));
      try {
        // 采样器的 finish 已经等过轨道、尾巴、逐帧确认与上下文关闭。
        summary = await target.handle.finish();
      } catch {
        summary = null;
        // 没有完整片段就取消旧票据；不等待宿主，避免阻塞真实设备释放与 ACK。
        void target.transport.cancel(target.ticket).catch(() => {});
      }
      // 设备这一路已经结束：之后的取消只 fence ASR，不再有第二次释放可等。
      target.stopped = true;
      // 不管 finish 成功与否，释放只认 `released`：它 reject 就不 ACK、不上传。
      outcome = await cleanup(target);
      if (outcome === 'settled' && summary !== null && stillMine(target)) {
        setState((value) => markTranscribing(value));
        try {
          uploaded = await target.transport.finish(target.ticket, summary);
        } catch {
          // 抛出的上传可能已经到达服务：这是「未知」，按恢复路径读同一个票据。
          threw = true;
        }
      }
    } finally {
      // 任何一条路径都不能把锁留在手里。
      release(token);
    }
    // 这一次已经不属于当前界面（取消/换目标/卸载）：不写任何状态。
    if (!stillMine(target) || outcome === null) return;

    if (outcome !== 'settled') {
      capture.current = null;
      setState((value) => markReleaseFailed(value, null, RELEASE_TEXT[outcome]));
      return;
    }
    if (summary === null) {
      capture.current = null;
      setState((value) => markFailed(value, null, '结束录音时出错了。'));
      return;
    }
    if (threw || uploaded === null) {
      await recoverOnce(target, false);
      return;
    }
    if (!uploaded.ok) {
      if (unknownOutcome(uploaded.error)) {
        // 响应可能已经产生：读一次同一个票据，绝不重传音频。
        await recoverOnce(target, false);
        return;
      }
      capture.current = null;
      setState((value) =>
        markFailed(value, uploaded.error, errorText(uploaded.error) ?? '转写失败了。'),
      );
      return;
    }
    const plan = planFinish(uploaded.value);
    if (plan.text === null) {
      forget(target);
      setState((value) =>
        markFailed(value, uploaded.value.error, plan.notice ?? '没有识别到语音。'),
      );
      return;
    }
    if (!stillMine(target)) return;
    await settleResult(target, plan.text);
    forget(target);
  }, [state, transport, targetKey, discard, cleanup, stillMine, recoverOnce, settleResult, forget]);
  finishRef.current = finish;

  /** 开始一次采集：固定 intent，然后让采样器起设备。 */
  const start = useCallback(async (): Promise<void> => {
    if (transport === null || view === null || !rules.ok || capture.current !== null) return;
    const token = claim();
    if (token === null) return;
    const started = generation.current;
    const provider = view.providers.find((item) => item.providerRef === view.feature.providerRef);
    let begin: Awaited<ReturnType<VoiceTransport['begin']>> | null = null;
    try {
      // 只提交**这一帧渲染时**看到的配置：不 fetch 最新，也不替换用户看到的选择。
      begin = await transport.begin({
        captureId: newCommandId(),
        expectedFeatureRevision: view.feature.configRevision,
        providerRef: view.feature.providerRef,
        bindingId: provider?.bindingId ?? '',
        finishMode: view.feature.finishMode,
      });
    } catch {
      begin = null;
    } finally {
      release(token);
    }
    if (!mounted.current || generation.current !== started) {
      // 票据已经开出来了但这一次被取消/换了目标：让它过期之前先 fence 掉，别留着。
      if (begin !== null && begin.ok) void transport.cancel(begin.value).catch(() => {});
      return;
    }
    if (begin === null) {
      setState((value) => markFailed(value, null, '没能开始录音。'));
      return;
    }
    if (!begin.ok) {
      setState((value) => markFailed(value, begin.error, '没能开始录音。'));
      return;
    }

    const target: Capture = {
      ticket: begin.value,
      transport,
      handle: null,
      stopped: false,
      cleanup: null,
      released: false,
      abandoned: false,
    };
    capture.current = target;
    setState((value) =>
      beginIntent(value, {
        captureId: target.ticket.captureId,
        clientId: target.ticket.clientId,
        agentId: target.ticket.agentId,
        serviceEpoch: target.ticket.serviceEpoch,
        finishMode: target.ticket.finishMode,
        targetKey,
      }),
    );

    try {
      target.handle = sampler.start({
        ticket: target.ticket,
        workletUrl,
        onReady: async (sampleRate) => {
          if (!streaming(target)) throw new Error('stale capture');
          const ready = await target.transport.ready(target.ticket, sampleRate);
          if (!streaming(target)) throw new Error('stale capture');
          if (!ready.ok) {
            setState((value) => markFailed(value, ready.error, '麦克风没有就绪。'));
            throw new Error('not ready');
          }
          setState((value) => markRecording(value));
        },
        onPush: async (frame) => {
          if (!streaming(target)) throw new Error('stale capture');
          const pushed = await target.transport.push(target.ticket, encodeFrame(frame));
          // 宿主没真的收下这一帧：抛出去让采集器停下并报失败，绝不假装成功。
          if (!pushed.ok) throw new Error('push rejected');
        },
        onFailed: (reason) => {
          if (!streaming(target)) return;
          // 采样器自己的清理可能还在进行：释放只认 `released`。
          abandon(target, true, failureText(reason));
        },
        onLimitReached: () => {
          if (!streaming(target)) return;
          void finishRef.current();
        },
        onLevel: (rms) => {
          if (!streaming(target)) return;
          setLevel(rms);
        },
      });
    } catch {
      // 采样器可能已经拿到设备：让它自己结算，再按真实 `released` 决定是否 ACK。
      if (stillMine(target)) abandon(target, true, '没能打开麦克风。');
      return;
    }
  }, [transport, sampler, view, rules.ok, targetKey, workletUrl, streaming, stillMine, abandon]);

  /**
   * 取消：先让宿主 fence 这一次（不 await），再等设备真的放开并 ACK。
   *
   * 不能先 await 释放再通知：Main 的 cancel 要等这条 ACK 才结算，顺序反了就是死锁。
   * 已经 ACK 过的转写阶段没有设备要放开：只 fence、不补 ACK、不提交。
   */
  const cancel = useCallback((): void => {
    // 之后到达的转写/回执都不属于用户还要的这一次。
    generation.current += 1;
    attempted.current = null;
    // 取消即放弃这一次在途的宿主调用：锁不能等一个可能永远不回来的上传才放开。
    // release(token) 认的是自己的 token，迟到的 finish 不会清掉新采集的锁。
    inFlight.current = null;
    const target = capture.current;
    if (target === null) {
      setLevel(0);
      setState(markCancelled());
      return;
    }
    abandon(target, true);
  }, [abandon]);

  const send = useCallback((): void => {
    const text = state.preview?.trim() ?? '';
    if (text === '') return;
    void dispatch(text, state.submitting);
  }, [state.preview, state.submitting, dispatch]);

  const edit = useCallback((text: string): void => {
    setState((value) => editPreview(value, text));
  }, []);

  const recover = useCallback((): void => {
    const target = capture.current;
    if (target === null || !stillMine(target)) return;
    void recoverOnce(target, true);
  }, [stillMine, recoverOnce]);

  return {
    state,
    view,
    mode,
    hint,
    rules,
    level,
    reload: () => setReloadToken((value) => value + 1),
    recover,
    start: () => void start(),
    finish: () => void finish(),
    cancel,
    send,
    edit,
  };
}

export function VoiceInput({ controller }: { readonly controller: VoiceController }): JSX.Element {
  const { state, view, mode, hint, rules, level } = controller;
  const hintId = useId();
  const busy = state.phase !== 'idle' && state.phase !== 'error' && state.phase !== 'review';
  const recording = state.phase === 'recording' || state.phase === 'arming';

  return (
    <section className="tc-voice" aria-label="语音输入" data-testid="voice-input">
      {view === null ? null : (
        <p className="tc-voice__hint" id={hintId} data-testid="voice-hint">
          {finishModeLabel(mode)}·{hint}
        </p>
      )}

      {state.notice === null ? null : (
        <p className="tc-voice__note" role="status" data-testid="voice-notice">
          {state.notice}
        </p>
      )}

      <div className="tc-voice__actions">
        {state.phase === 'idle' || state.phase === 'error' ? (
          <Button
            variant="secondary"
            size="small"
            disabled={!rules.ok}
            aria-describedby={view === null ? undefined : hintId}
            data-testid="voice-start"
            onClick={controller.start}
          >
            开始录音
          </Button>
        ) : null}

        {recording ? (
          <>
            <span className="tc-voice__state" data-testid="voice-state">
              {state.phase === 'arming' ? '正在准备麦克风…' : '正在录音'}
            </span>
            {state.phase === 'recording' ? (
              <Button
                variant="primary"
                size="small"
                data-testid="voice-finish"
                onClick={controller.finish}
              >
                结束
              </Button>
            ) : null}
            <Button
              variant="quiet"
              size="small"
              data-testid="voice-cancel"
              onClick={controller.cancel}
            >
              取消
            </Button>
          </>
        ) : null}

        {busy && !recording ? (
          <>
            <span className="tc-voice__state" data-testid="voice-state">
              {state.phase === 'finishing'
                ? '正在结束录音…'
                : state.phase === 'transcribing'
                  ? '正在转写…'
                  : state.phase === 'submitting'
                    ? '正在发送…'
                    : state.phase === 'retiring'
                      ? '正在释放麦克风…'
                      : '处理中…'}
            </span>
            {state.phase === 'finishing' || state.phase === 'transcribing' ? (
              <Button
                variant="quiet"
                size="small"
                data-testid="voice-cancel"
                onClick={controller.cancel}
              >
                {state.phase === 'transcribing' ? '取消转写' : '取消'}
              </Button>
            ) : null}
            {state.phase === 'transcribing' && state.notice !== null ? (
              <Button
                variant="quiet"
                size="small"
                data-testid="voice-recover"
                onClick={controller.recover}
              >
                再读一次
              </Button>
            ) : null}
          </>
        ) : null}

        {state.phase === 'review' ? (
          <>
            <Button
              variant="primary"
              size="small"
              data-testid="voice-send"
              onClick={controller.send}
            >
              {state.submitting === null ? '发送' : '重试发送'}
            </Button>
            <Button
              variant="quiet"
              size="small"
              data-testid="voice-discard"
              onClick={controller.cancel}
            >
              放弃
            </Button>
          </>
        ) : null}
      </div>

      {rules.reason === null ? null : (
        <p className="tc-voice__note" data-testid="voice-reason">
          {rules.reason}
        </p>
      )}

      {state.phase === 'review' && state.preview !== null ? (
        <Field label="识别结果" hint="可以直接改，改完再发送">
          {({ inputId, describedBy }) => (
            <textarea
              id={inputId}
              className="pk-input tc-voice__preview"
              aria-describedby={describedBy}
              value={state.preview ?? ''}
              rows={2}
              maxLength={8000}
              data-testid="voice-preview"
              onChange={(event) => controller.edit(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      {state.phase === 'recording' ? (
        <div
          className="tc-voice__level"
          role="progressbar"
          aria-label="输入音量"
          aria-valuenow={Math.round(Math.min(1, level) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="voice-level"
        >
          <i style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} />
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <p className="tc-voice__note tc-voice__note--error" role="alert" data-testid="voice-error">
          {state.notice ?? errorText(state.error) ?? '语音输入出错了。'}
        </p>
      ) : null}
    </section>
  );
}

/**
 * 桌宠窗口读到的语音输出状态：只读快照，不自己播放、不自己存开关。
 *
 * 播放本身归 `SharedSpeechPlaybackOwner`；这里只回答"现在有没有在朗读、能不能停"，
 * 让桌宠给出一个真实可达的停止入口，而不是把它混进"停止这次回应"。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopSpeechState } from '@pet/contracts';

export interface PetSpeechStatus {
  /** 桥存在才是"这台机器有这条通道"；缺失不是静音。 */
  readonly available: boolean;
  readonly state: DesktopSpeechState | null;
  /** 有正在生成或正在播放的声音时，停止才有意义。 */
  readonly stoppable: boolean;
  stop(): Promise<void>;
}

/**
 * 可停的阶段：`preparing`（含 ready 在途）也算，因为此时已经有本机资源要收回。
 * `baselining` 不出声，停它没有意义，所以不列。
 */
const STOPPABLE = new Set(['preparing', 'streaming', 'stopping']);

export function usePetSpeechStatus(): PetSpeechStatus {
  const [state, setState] = useState<DesktopSpeechState | null>(null);
  const alive = useRef(false);
  const sequence = useRef(0);
  const available = typeof window !== 'undefined' && window.petSharedSpeech !== undefined;

  const read = useCallback(async (): Promise<void> => {
    const bridge = window.petSharedSpeech;
    if (!bridge) return;
    const request = ++sequence.current;
    try {
      const result = await bridge.getState();
      if (!alive.current || request !== sequence.current || !result.ok) return;
      setState(result.value);
    } catch {
      /* 读不到就保留上一次确认的状态，不编造。 */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const bridge = window.petSharedSpeech;
    const detach = bridge?.onChanged(() => {
      void read();
    });
    void read();
    return () => {
      alive.current = false;
      sequence.current += 1;
      detach?.();
    };
  }, [read]);

  const stop = useCallback(async (): Promise<void> => {
    const bridge = window.petSharedSpeech;
    const connectionId = state?.connectionId ?? null;
    if (!bridge || connectionId === null) return;
    try {
      const result = await bridge.stop({ connectionId });
      if (result.ok) setState(result.value);
    } catch {
      /* 失败保留原状态，由下一次真实读取纠正。 */
    }
  }, [state?.connectionId]);

  return {
    available,
    state,
    stoppable: state !== null && STOPPABLE.has(state.phase),
    stop,
  };
}

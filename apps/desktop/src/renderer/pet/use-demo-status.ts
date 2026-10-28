/**
 * 桌宠侧接宿主 Demo：读快照、订阅变化、允许停止，仅此三件事。
 *
 * 不 beginRecording、不 pushAudio、不 saveProviderKey、不 sendText——录音属于采集任务，
 * Key 与发送属于设置台。桥缺失或读取失败时保持窗口原型自己的状态，并说明原因。
 */
import type { DemoBridge, DemoSnapshot } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeDemo, type DemoStatus } from './demo-status.js';
import { PET_COPY } from './copy.js';

/**
 * 只校验桌宠真正会用的三个方法：桥在但缺这些，等同没连上，
 * 不能让界面拿着半套接口显示「已连接」。
 */
export function isDemoBridge(value: unknown): value is DemoBridge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['version'] !== 1) return false;
  return (['getSnapshot', 'onChanged', 'cancel'] as const).every(
    (name) => typeof candidate[name] === 'function',
  );
}

export function readDemoBridge(target: unknown = globalThis): DemoBridge | null {
  if (typeof target !== 'object' || target === null) return null;
  const candidate = (target as { petDemo?: unknown }).petDemo;
  return isDemoBridge(candidate) ? candidate : null;
}

export interface PetDemoView extends DemoStatus {
  /** 正在等宿主接受停止请求。 */
  stopping: boolean;
  /** 停止或读取失败的提示；成功不提示，阶段变化本身就是回执。 */
  notice: string | null;
  stop(): void;
}

export function useDemoStatus(): PetDemoView {
  const bridgeRef = useRef<DemoBridge | null>(readDemoBridge());
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const mounted = useRef(true);
  // 按钮要等下一次提交才禁用，同一帧里的第二次点击只能靠这个标记挡住。
  const stopBusy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return () => {
        mounted.current = false;
      };
    }

    /** 重读一次快照：变化事件只通知「变了」，内容仍以 getSnapshot 为准。 */
    const read = (): void => {
      void Promise.resolve()
        .then(() => bridge.getSnapshot())
        .then((reply) => {
          if (!mounted.current) return;
          if (reply.ok) {
            setSnapshot(reply.value);
            setNotice(null);
          } else {
            setNotice(PET_COPY.demo.readFailed);
          }
        })
        .catch(() => {
          if (mounted.current) setNotice(PET_COPY.demo.readFailed);
        });
    };

    let unsubscribe: (() => void) | null = null;
    try {
      const result = bridge.onChanged(read);
      unsubscribe = typeof result === 'function' ? result : null;
    } catch {
      if (mounted.current) setNotice(PET_COPY.demo.readFailed);
    }
    read();

    return () => {
      mounted.current = false;
      if (unsubscribe !== null) {
        try {
          unsubscribe();
        } catch {
          // 解除订阅本身失败不应影响卸载。
        }
      }
    };
  }, []);

  const stop = useCallback((): void => {
    const bridge = bridgeRef.current;
    if (bridge === null || stopBusy.current) return;
    stopBusy.current = true;
    setStopping(true);
    void Promise.resolve()
      .then(() => bridge.cancel())
      .then((reply) => {
        if (!mounted.current) return;
        if (reply.ok) {
          setSnapshot(reply.value);
          setNotice(null);
        } else {
          setNotice(PET_COPY.demo.stopFailed);
        }
      })
      .catch(() => {
        if (mounted.current) setNotice(PET_COPY.demo.stopFailed);
      })
      .finally(() => {
        stopBusy.current = false;
        if (mounted.current) setStopping(false);
      });
  }, []);

  return { ...describeDemo(snapshot, bridgeRef.current !== null), stopping, notice, stop };
}

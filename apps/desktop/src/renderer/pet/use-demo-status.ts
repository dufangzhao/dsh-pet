/**
 * 桌宠侧接宿主 Demo：读快照、订阅变化、允许停止、允许发一句话，仅此四件事。
 *
 * 不 beginRecording、不 pushAudio、不 saveProviderKey——录音属于采集，Key 属于设置台。
 * Core 接管回复与持久记录之前，这条订阅仍是桌宠气泡里“真实文本”的来源。
 * 桥缺失或读取失败时保持窗口原型自己的待机，并说明原因，不伪造宿主状态。
 */
import { errorMessage, type DemoBridge, type DemoSnapshot } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PET_COPY } from './copy.js';
import { describeDemo, type DemoStatus } from './demo-status.js';

/**
 * 只校验桌宠真正会用的三个方法：桥在但缺这些，等同没连上，
 * 不能让界面拿着半套接口显示「已连接」。sendText 的可用性另由快照的 canSend 决定。
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
  /** 检测到宿主 Demo 桥；没有它就没有发送与停止入口。 */
  available: boolean;
  /** 正在等宿主接受停止请求。 */
  stopping: boolean;
  /** 正在等宿主接受这次发送。 */
  sending: boolean;
  /** 停止或发送失败的提示；成功不提示，阶段变化本身就是回执。 */
  notice: string | null;
  stop(): void;
  /**
   * 日常文字输入：走宿主既有的 sendText 通道，不新建会话，也不本地回显。
   * 返回值是宿主有没有接受这一句——界面据此决定清不清草稿。
   */
  send(text: string): Promise<boolean>;
}

export function useDemoStatus(): PetDemoView {
  const bridgeRef = useRef<DemoBridge | null>(readDemoBridge());
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  // 按钮要等下一次提交才禁用，同一帧里的第二次点击只能靠这个标记挡住。
  const stopBusy = useRef(false);
  const sendBusy = useRef(false);

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
            setNotice(PET_COPY.readFailed);
          }
        })
        .catch(() => {
          if (mounted.current) setNotice(PET_COPY.readFailed);
        });
    };

    let unsubscribe: (() => void) | null = null;
    try {
      const result = bridge.onChanged(read);
      unsubscribe = typeof result === 'function' ? result : null;
    } catch {
      if (mounted.current) setNotice(PET_COPY.readFailed);
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
          setNotice(PET_COPY.stopFailed);
        }
      })
      .catch(() => {
        if (mounted.current) setNotice(PET_COPY.stopFailed);
      })
      .finally(() => {
        stopBusy.current = false;
        if (mounted.current) setStopping(false);
      });
  }, []);

  const send = useCallback((text: string): Promise<boolean> => {
    const bridge = bridgeRef.current;
    if (bridge === null || sendBusy.current) return Promise.resolve(false);
    const value = text.trim();
    if (value === '') return Promise.resolve(false);
    sendBusy.current = true;
    setSending(true);
    // sendText 只回执 null：这一句要等宿主推回来的快照才算进了记录，
    // 本地不先插一条「已发送」；失败时提示说清是哪一句没出去。
    return Promise.resolve()
      .then(() => bridge.sendText({ text: value }))
      .then((reply) => {
        if (!mounted.current) return false;
        if (reply.ok) {
          setNotice(null);
          return true;
        }
        setNotice(PET_COPY.sendFailed + errorMessage(reply.error));
        return false;
      })
      .catch(() => {
        if (mounted.current) setNotice(PET_COPY.sendFailed + PET_COPY.app.unknownFailure);
        return false;
      })
      .finally(() => {
        sendBusy.current = false;
        if (mounted.current) setSending(false);
      });
  }, []);

  return {
    ...describeDemo(snapshot),
    available: bridgeRef.current !== null,
    stopping,
    sending,
    notice,
    stop,
    send,
  };
}

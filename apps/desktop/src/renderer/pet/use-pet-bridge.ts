/**
 * 渲染器只通过 window.pet（PetPrototypeBridge）与主进程通信：
 * 没有通用 send/invoke，不注册 IPC，不传坐标，也不新增任何系统调用。
 *
 * 这里不做全局 Window 类型扩展，避免与主会话的 preload 类型声明冲突；
 * 读取时做一次结构校验，缺失时页面仍可渲染并给出提示。
 *
 * 失败处理约定（对应 qa/M0-06-bridge.md「所有调用返回显式 ok/error」）：
 * - 传输层异常（Promise reject）与协议层失败（{ ok: false }）走同一条路径，
 *   都会落到 notice，不再静默忽略。
 * - 任何回调都在组件卸载后失效：卸载后既不更新状态，也不再持有订阅。
 */
import type { PetPrototypeBridge, PetSnapshot, PetState } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PetBridgeView {
  /** 是否检测到主进程桥；false 时说明页面被单独打开。 */
  available: boolean;
  /** 最近一次主进程广播或本地预演的状态，null 表示尚未拿到。 */
  snapshot: PetSnapshot | null;
  /** 当前展示的状态；桥不可用时退化为本地模拟。 */
  state: PetState;
  /** 出错提示（通信失败或桥缺失）。 */
  notice: string | null;
  previewState(state: PetState): void;
  setInteraction(interactive: boolean): void;
  beginDrag(): void;
  endDrag(): void;
  quit(): void;
}

export function isPetPrototypeBridge(value: unknown): value is PetPrototypeBridge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['version'] !== 1) return false;
  const methods = [
    'getSnapshot',
    'setInteraction',
    'beginDrag',
    'endDrag',
    'previewState',
    'quit',
    'onSnapshot',
  ];
  return methods.every((name) => typeof candidate[name] === 'function');
}

export function readBridge(target: unknown = globalThis): PetPrototypeBridge | null {
  if (typeof target !== 'object' || target === null) return null;
  const candidate = (target as { pet?: unknown }).pet;
  return isPetPrototypeBridge(candidate) ? candidate : null;
}

/** 契约里的错误码 → 面向用户的中文提示；未知错误码退回通用失败文案。 */
export function describeBridgeError(error: unknown, fallback: string): string {
  switch (error) {
    case 'invalid-request':
      return '请求参数不被主进程接受，界面仍可查看，但状态不会同步。';
    case 'untrusted-sender':
      return '主进程拒绝了这次请求的来源，请从桌宠窗口内操作。';
    case 'unavailable':
      return '桌宠窗口暂时不可用，界面仍可查看，但状态不会同步。';
    default:
      return fallback;
  }
}

interface BridgeReplyLike<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
}

/**
 * 只在桥可用时调用，任何失败都收敛为提示，不让界面白屏。
 * 导出仅为单元测试可直接覆盖“协议层失败”这条分支。
 */
export async function callBridge<T>(
  bridge: PetPrototypeBridge | null,
  run: (bridge: PetPrototypeBridge) => Promise<BridgeReplyLike<T>>,
  onError: (message: string) => void,
  onValue: (value: T) => void,
): Promise<void> {
  if (bridge === null) return;
  try {
    const reply = await run(bridge);
    // 协议层失败（ok: false）必须与异常一样上报，不能静默丢弃。
    if (!reply.ok) {
      onError(describeBridgeError(reply.error, ''));
      return;
    }
    if (reply.value !== undefined) onValue(reply.value);
  } catch {
    onError('');
  }
}

export interface UsePetBridgeOptions {
  bridge?: PetPrototypeBridge | null;
  /** 桥缺失时的提示文案。 */
  missingNotice: string;
  /** 通信失败时的提示文案。 */
  failureNotice: string;
  /** 退出失败时的提示文案；不传则复用 failureNotice。 */
  quitFailureNotice?: string;
}

export function usePetBridge(options: UsePetBridgeOptions): PetBridgeView {
  const bridgeRef = useRef<PetPrototypeBridge | null>(options.bridge ?? null);
  const [available] = useState<boolean>(() => bridgeRef.current !== null);
  const [snapshot, setSnapshot] = useState<PetSnapshot | null>(null);
  const [localState, setLocalState] = useState<PetState>('idle');
  const [notice, setNotice] = useState<string | null>(() =>
    bridgeRef.current === null ? options.missingNotice : null,
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return () => {
        mounted.current = false;
      };
    }

    const fail = (message?: string): void => {
      if (!mounted.current) return;
      setNotice(message !== undefined && message !== '' ? message : options.failureNotice);
    };
    const accept = (next: PetSnapshot): void => {
      if (!mounted.current) return;
      setSnapshot(next);
      setLocalState(next.state);
      setNotice(null);
    };

    let unsubscribe: (() => void) | null = null;
    try {
      const result = bridge.onSnapshot((next) => {
        // 订阅回调同样可能被主进程的错误数据打穿，包一层避免白屏。
        try {
          accept(next);
        } catch {
          fail();
        }
      });
      unsubscribe = typeof result === 'function' ? result : null;
    } catch {
      fail();
    }

    void Promise.resolve()
      .then(() => bridge.getSnapshot())
      .then((reply) => {
        if (!mounted.current) return;
        if (reply.ok) accept(reply.value);
        else fail(describeBridgeError(reply.error, options.failureNotice));
      })
      .catch(() => fail());

    return () => {
      mounted.current = false;
      // 取消订阅，避免窗口销毁后仍有回调往已卸载的组件里塞状态。
      if (unsubscribe !== null) {
        try {
          unsubscribe();
        } catch {
          // 解除订阅本身失败不应影响卸载。
        }
      }
      unsubscribe = null;
    };
  }, [options.failureNotice]);

  const failNotice = options.failureNotice;
  const quitFailureNotice = options.quitFailureNotice ?? options.failureNotice;

  // 卸载后一律不再更新状态：异步回复可能比组件活得更久。
  const report = useCallback((message: string, fallback: string): void => {
    if (!mounted.current) return;
    setNotice(message === '' ? fallback : message);
  }, []);

  const applySnapshot = useCallback((value: PetSnapshot): void => {
    if (!mounted.current) return;
    setSnapshot(value);
  }, []);

  const previewState = useCallback(
    (next: PetState) => {
      if (mounted.current) setLocalState(next);
      void callBridge(
        bridgeRef.current,
        (bridge) => bridge.previewState(next),
        (message) => report(message, failNotice),
        applySnapshot,
      );
    },
    [applySnapshot, failNotice, report],
  );

  const setInteraction = useCallback(
    (interactive: boolean) => {
      void callBridge(
        bridgeRef.current,
        (bridge) => bridge.setInteraction(interactive),
        (message) => report(message, failNotice),
        applySnapshot,
      );
    },
    [applySnapshot, failNotice, report],
  );

  const beginDrag = useCallback(() => {
    void callBridge(
      bridgeRef.current,
      (bridge) => bridge.beginDrag(),
      (message) => report(message, failNotice),
      applySnapshot,
    );
  }, [applySnapshot, failNotice, report]);

  const endDrag = useCallback(() => {
    void callBridge(
      bridgeRef.current,
      (bridge) => bridge.endDrag(),
      (message) => report(message, failNotice),
      applySnapshot,
    );
  }, [applySnapshot, failNotice, report]);

  const quit = useCallback(() => {
    const bridge = bridgeRef.current;
    if (bridge === null) return;
    void callBridge<null>(
      bridge,
      (target) => target.quit(),
      // 退出失败必须让用户看到，否则点了没反应会被当成卡死。
      (message) => report(message, quitFailureNotice),
      () => undefined,
    );
  }, [quitFailureNotice, report]);

  return {
    available,
    snapshot,
    state: snapshot?.state ?? localState,
    notice,
    previewState,
    setInteraction,
    beginDrag,
    endDrag,
    quit,
  };
}

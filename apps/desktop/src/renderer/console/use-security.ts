import type { ConsoleSecuritySnapshot } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CALL_REJECTED, UNCERTAIN, describeError } from './copy.js';

export interface SecurityState {
  security: ConsoleSecuritySnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** 写操作返回的真实安全快照：直接采用，不做本地合并。 */
  applySecurity: (next: ConsoleSecuritySnapshot) => void;
  /** 写操作结果未确认：旧的安全快照不再代表现状。 */
  markUncertain: () => void;
}

/**
 * 信任、预设与待审批的唯一来源：window.petConsole.getSecurity()。
 *
 * 审批请求有时效，快照里的 pending 只是某一刻的切片。这里订阅
 * onSecurityChanged，变化时静默重读——队列以宿主为准，不在渲染层推算。
 * 静默重读失败仍然收起数据：那时我们不知道还有谁在等审批，宁可什么都不显示。
 */
export function useSecurity(): SecurityState {
  const bridge = typeof window === 'undefined' ? undefined : window.petConsole;
  const [security, setSecurity] = useState<ConsoleSecuritySnapshot | null>(null);
  const [loading, setLoading] = useState(bridge !== undefined);
  const [error, setError] = useState<string | null>(null);
  // 卸载后不再 setState：读取可能在窗口关闭之后才回来。
  const alive = useRef(true);

  const read = useCallback(async (visible: boolean) => {
    const current = typeof window === 'undefined' ? undefined : window.petConsole;
    if (current === undefined) {
      return;
    }
    if (visible) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await current.getSecurity();
      if (!alive.current) {
        return;
      }
      if (result.ok) {
        setSecurity(result.value);
        setError(null);
      } else {
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current) {
        setError(CALL_REJECTED);
      }
    } finally {
      if (alive.current && visible) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read(true);
    const current = typeof window === 'undefined' ? undefined : window.petConsole;
    // 订阅只说明“变了”，具体内容重新读一次；不拿事件载荷当数据。
    const off = current?.onSecurityChanged(() => {
      void read(false);
    });
    return () => {
      alive.current = false;
      off?.();
    };
  }, [read]);

  const applySecurity = useCallback((next: ConsoleSecuritySnapshot) => {
    setSecurity(next);
    setError(null);
  }, []);

  const markUncertain = useCallback(() => {
    setError(UNCERTAIN);
  }, []);

  return {
    security,
    loading,
    error,
    refresh: () => {
      void read(true);
    },
    applySecurity,
    markUncertain,
  };
}

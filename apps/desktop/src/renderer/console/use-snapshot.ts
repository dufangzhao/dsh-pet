import type { ConsoleSnapshot, HostStatus } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CALL_REJECTED, UNCERTAIN, describeError } from './copy.js';

export interface SnapshotState {
  /** 桥存在时为 true；缺桥时页面显示静态提示而不是错误。 */
  available: boolean;
  /** 最近一次成功读取的数据；刷新失败时保留上一份。 */
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** 用宿主直接返回的 HostStatus 覆盖快照的 host 字段，插件与贡献保持不变。 */
  applyHostStatus: (status: HostStatus) => void;
  /** 用宿主返回的完整快照覆盖当前数据。 */
  applySnapshot: (snapshot: ConsoleSnapshot) => void;
  /**
   * 标记"当前数据不能代表真实状态"。
   * 走的是同一个 error 通道：页面收起旧内容，只剩一句说明和"重新读取"。
   */
  markUncertain: () => void;
}

/**
 * 设置台唯一的真实数据来源：window.petConsole.getSnapshot()。
 *
 * 协议失败（ok:false）与拒绝（Promise reject）走同一条路径落到 error，
 * 两者都不当作成功；刷新失败保留上一次的可用数据，只是多一条提示。
 */
export function useConsoleSnapshot(): SnapshotState {
  const bridge = window.petConsole;
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [loading, setLoading] = useState(bridge !== undefined);
  const [error, setError] = useState<string | null>(null);
  // 卸载后不再 setState：读取可能在窗口关闭之后才回来。
  const alive = useRef(true);

  const read = useCallback(async () => {
    const current = window.petConsole;
    if (current === undefined) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await current.getSnapshot();
      if (!alive.current) {
        return;
      }
      if (result.ok) {
        setSnapshot(result.value);
      } else {
        setError(describeError(result.error));
      }
    } catch {
      if (alive.current) {
        setError(CALL_REJECTED);
      }
    } finally {
      if (alive.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  const applyHostStatus = useCallback((status: HostStatus) => {
    setSnapshot((current) => (current === null ? current : { ...current, host: status }));
  }, []);

  /*
   * 插件写操作返回的是操作之后的完整快照：世代号、未就绪原因和贡献点都在里面。
   * 直接采用它，而不是再发一次读取——多一次往返只会用更新的结果掩盖这次的结果。
   * 同时清掉上一次读取失败，因为现在手上已经是宿主给的真实数据。
   */
  const applySnapshot = useCallback((next: ConsoleSnapshot) => {
    setSnapshot(next);
    setError(null);
  }, []);

  /*
   * 写操作没能确认结果时，手上的快照可能已经过期（宿主那边已经变了）。
   * 沿用 error 通道让页面收起这些数据：留着就等于把旧状态当成现状展示。
   * 只有用户自己点"重新读取"才会恢复，不自动重试。
   */
  const markUncertain = useCallback(() => {
    setError(UNCERTAIN);
  }, []);

  return {
    available: bridge !== undefined,
    snapshot,
    loading,
    error,
    refresh: read,
    applyHostStatus,
    applySnapshot,
    markUncertain,
  };
}

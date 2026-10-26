import type { ConsoleSnapshot, HostStatus } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CALL_REJECTED, describeError } from './copy.js';

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

  return {
    available: bridge !== undefined,
    snapshot,
    loading,
    error,
    refresh: read,
    applyHostStatus,
  };
}

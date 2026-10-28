import type { ConsoleAuditPage, Result } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CALL_REJECTED, describeError } from './copy.js';

/** 一页 20 条：够看清最近发生了什么，又不会把设置页撑长。 */
export const AUDIT_PAGE_SIZE = 20;

export interface AuditState {
  page: ConsoleAuditPage | null;
  /** 当前这一页的第一条在整个审计里的序号（从 0 开始）。 */
  offset: number;
  loading: boolean;
  error: string | null;
  /** 'newest' 直接定位到最新一页；其余按序号读取。 */
  load: (offset: number | 'newest') => void;
  refresh: () => void;
}

/**
 * 审计的唯一来源：window.petConsole.getAudit()。
 *
 * 审计按追加顺序保存，序号 0 是最早的一条，所以“最新一页”要先问一次总数。
 * total 是累计条数、dropped 是被丢弃的条数，两者相减就是宿主还留着的条数。
 * 这一步只发生在打开审计或点“刷新”时，不影响其他页面。
 */
export function useAudit(available: boolean): AuditState {
  const [page, setPage] = useState<ConsoleAuditPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const request = useCallback(async (at: number): Promise<Result<ConsoleAuditPage> | null> => {
    const bridge = typeof window === 'undefined' ? undefined : window.petConsole;
    if (bridge === undefined) {
      return null;
    }
    try {
      return await bridge.getAudit({ offset: at, limit: AUDIT_PAGE_SIZE });
    } catch {
      return null;
    }
  }, []);

  const read = useCallback(
    async (target: number | 'newest') => {
      setLoading(true);
      setError(null);
      try {
        let at = target === 'newest' ? 0 : target;
        let result = await request(at);
        if (target === 'newest' && result !== null && result.ok) {
          const newest = Math.max(0, result.value.total - result.value.dropped - AUDIT_PAGE_SIZE);
          if (newest > 0) {
            at = newest;
            result = await request(newest);
          }
        }
        if (!alive.current) {
          return;
        }
        if (result === null) {
          setError(CALL_REJECTED);
          return;
        }
        if (!result.ok) {
          setError(describeError(result.error));
          return;
        }
        setPage(result.value);
        setOffset(at);
      } finally {
        if (alive.current) {
          setLoading(false);
        }
      }
    },
    [request],
  );

  useEffect(() => {
    alive.current = true;
    if (!available) {
      setLoading(false);
      return;
    }
    void read('newest');
    return () => {
      alive.current = false;
    };
  }, [available, read]);

  return {
    page,
    offset,
    loading,
    error,
    load: (target) => {
      void read(target);
    },
    refresh: () => {
      void read(offset);
    },
  };
}

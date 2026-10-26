import type { HostStatus } from '@pet/contracts';
import { useCallback, useState } from 'react';

import { CALL_REJECTED, describeError } from './copy.js';

export interface StopAllOutcome {
  /** 宿主返回的最新状态；失败时为 null。 */
  status: HostStatus | null;
  /** 失败原因；成功时为 null。 */
  error: string | null;
}

export interface StopAllState {
  /** 调用一次 stopAll() 并返回真实结果，由调用方决定提示文案。 */
  stop: () => Promise<StopAllOutcome>;
  /** 请求进行中：按钮据此禁用，避免重复点击。 */
  busy: boolean;
}

/**
 * “停止全部”的调用与忙碌标记。
 * 成功与否只看返回值：ok:true 才算宿主接受了命令，异常和 ok:false 都报错。
 */
export function useStopAll(): StopAllState {
  const [busy, setBusy] = useState(false);

  const stop = useCallback(async (): Promise<StopAllOutcome> => {
    const bridge = window.petConsole;
    if (bridge === undefined) {
      return { status: null, error: CALL_REJECTED };
    }
    setBusy(true);
    try {
      const result = await bridge.stopAll();
      return result.ok
        ? { status: result.value, error: null }
        : { status: null, error: describeError(result.error) };
    } catch {
      return { status: null, error: CALL_REJECTED };
    } finally {
      setBusy(false);
    }
  }, []);

  return { stop, busy };
}

import type { JSX, ReactNode } from 'react';

import { COPY } from './copy.js';
import { Button, Status } from './minimal-ui/controls.js';

export interface ConsoleStatusProps {
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  children: ReactNode;
}

/**
 * 三态外壳：缺桥、加载中、数据不可信都给出简短说明，只有拿到真实数据才渲染 children。
 *
 * error 有两个来源：读取失败，以及写操作没能确认结果（旧快照可能已经过期）。
 * 两者对用户是同一件事——手上的数据不能代表现状——所以共用这个外壳，
 * 具体原因就是宿主那一句，不再另加标题或猜测。
 */
export function ConsoleStatus({
  loading,
  error,
  available,
  onRetry,
  children,
}: ConsoleStatusProps): JSX.Element {
  if (!available) {
    return (
      <p role="alert">
        <Status tone="warn">{COPY.missingBridge}</Status>
      </p>
    );
  }
  if (loading) {
    return (
      <p className="row__value" role="status">
        {COPY.loading}
      </p>
    );
  }
  if (error !== null) {
    return (
      <div className="card__foot">
        <p role="alert">
          <Status tone="danger">{error}</Status>
        </p>
        <Button onClick={onRetry}>{COPY.retry}</Button>
      </div>
    );
  }
  return <>{children}</>;
}

import type { JSX, ReactNode } from 'react';

import { Button, EmptyState } from '@pet/ui-kit';

import { COPY } from './copy.js';

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
 * 两者对用户是同一件事——手上的数据不能代表现状——所以共用这个外壳；
 * 具体原因由 description 说明，标题不再断言"读取"失败。
 */
export function ConsoleStatus({
  loading,
  error,
  available,
  onRetry,
  children,
}: ConsoleStatusProps): JSX.Element {
  if (!available) {
    return <EmptyState title={COPY.missingBridge} description="请从桌宠的“设置”重新打开窗口。" />;
  }
  if (loading) {
    return <p className="console-muted">{COPY.loading}</p>;
  }
  if (error !== null) {
    return (
      <EmptyState
        title="状态不可用"
        description={error}
        action={
          <Button onClick={onRetry} disabled={loading}>
            {COPY.retry}
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}

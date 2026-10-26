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
 * 三态外壳：缺桥、加载中、读取失败都给出简短说明，只有拿到真实数据才渲染 children。
 * 失败时明确说明失败原因，不把空数据渲染成“正常”。
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
        title="读取失败"
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

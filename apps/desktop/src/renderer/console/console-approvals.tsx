import type { JSX } from 'react';

import { Button } from '@pet/ui-kit';

export interface ApprovalNoticeProps {
  count: number;
  /** 只负责导航到权限页；答复永远由用户在那里逐项做出。 */
  onOpen: () => void;
}

/**
 * 外壳级的待审批提示：停在任何页面都看得到，点进去处理。
 *
 * 整句播报而不是一个裸数字：读屏听到的是“有 2 个请求等待审批”，
 * 而不是不知从哪冒出来的 2。live region 常驻，内容随数量出现或清空。
 */
export function ApprovalNotice({ count, onOpen }: ApprovalNoticeProps): JSX.Element {
  return (
    <div role="status" aria-atomic="true">
      {count === 0 ? null : (
        <div className="console-notice">
          <p className="console-notice__text">
            有 {count} 个请求等待审批。每项只对那一次操作有效，超时会自动拒绝。
          </p>
          <Button size="small" onClick={onOpen}>
            去处理
          </Button>
        </div>
      )}
    </div>
  );
}

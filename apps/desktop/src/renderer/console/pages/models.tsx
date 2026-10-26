import type { JSX } from 'react';

import { EmptyState } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';

/** 模型页：模型与密钥都还不能在设置台配置。 */
export function ModelsPage(): JSX.Element {
  return (
    <ConsolePane title="模型">
      <EmptyState title="模型设置暂不可用" description="模型选择与密钥配置都还不能在这里修改。" />
    </ConsolePane>
  );
}

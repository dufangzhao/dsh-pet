import type { JSX } from 'react';

import { EmptyState, Section } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';

/** 模型页：模型与密钥都还不能在设置台配置，也不做任何承诺性展示。 */
export function ModelsPage(): JSX.Element {
  return (
    <ConsolePane title="模型" summary="对话与语音识别使用的模型。">
      <Section title="模型">
        <EmptyState title="模型设置暂不可用" description="模型选择与密钥配置都还不能在这里修改。" />
      </Section>
    </ConsolePane>
  );
}

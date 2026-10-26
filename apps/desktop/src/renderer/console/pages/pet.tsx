import type { JSX } from 'react';

import { EmptyState, Section } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';

/** 桌宠页：外观与交互设置都还没有可用的读写接口，只列已确认的待接项。 */
export function PetPage(): JSX.Element {
  return (
    <ConsolePane title="桌宠" summary="桌宠的外观与交互行为。">
      <Section title="外观">
        <EmptyState title="暂不可设置" description="角色形象与气泡样式还不能在这里修改。" />
      </Section>
      <Section title="交互">
        <EmptyState title="暂不可设置" description="快捷键与拖拽行为还不能在这里修改。" />
      </Section>
    </ConsolePane>
  );
}

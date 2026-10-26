import type { JSX } from 'react';

import { EmptyState } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';

/** 桌宠页：外观与交互设置都还没有可用的读写接口。 */
export function PetPage(): JSX.Element {
  return (
    <ConsolePane title="桌宠">
      <EmptyState
        title="桌宠设置暂不可用"
        description="角色形象、气泡样式、快捷键与拖拽行为都还不能在这里修改。"
      />
    </ConsolePane>
  );
}

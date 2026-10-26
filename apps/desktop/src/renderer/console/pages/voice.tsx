import type { JSX } from 'react';

import { EmptyState, Section } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';

/** 语音输入页：录音与识别都还没有接通，不能声称在用系统默认麦克风。 */
export function VoicePage(): JSX.Element {
  return (
    <ConsolePane title="语音输入" summary="麦克风、识别方式与快捷键。">
      <Section title="语音输入">
        <EmptyState
          title="语音输入暂不可用"
          description="录音、识别与设备选择都还不能在这里设置。"
        />
      </Section>
    </ConsolePane>
  );
}

import type { ConsoleSnapshot } from '@pet/contracts';
import type { JSX } from 'react';

import { List, ListItem, Section, UiKitDemo } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';

export interface AboutPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
}

/** 关于页：普通区只放产品信息；技术版本与组件演示收在高级区。 */
export function AboutPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
}: AboutPageProps): JSX.Element {
  return (
    <ConsolePane title="关于" summary="AI 桌宠是本机运行的桌面助手，不依赖网络也能启动。">
      <Section title="版本">
        <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
          {snapshot === null ? null : <VersionList snapshot={snapshot} />}
        </ConsoleStatus>
      </Section>

      <Section title="许可">
        <p className="console-muted">本项目以 MIT 许可发布。</p>
      </Section>

      <details className="console-advanced">
        <summary className="console-advanced__summary">高级</summary>
        <div className="console-advanced__body">
          <Section title="技术信息" description="用于排查问题，普通使用不需要关注。">
            {snapshot === null ? (
              <p className="console-muted">读取到宿主信息后显示。</p>
            ) : (
              <List label="技术信息">
                <ListItem title="应用版本" meta={snapshot.app.version} />
                <ListItem title="Electron" meta={snapshot.app.electron} />
                <ListItem title="Node" meta={snapshot.app.node} />
                <ListItem title="平台" meta={snapshot.app.platform} />
                <ListItem title="快照版本" meta={String(snapshot.version)} />
              </List>
            )}
          </Section>

          <Section title="组件演示" description="设置台共用的基础组件，在这里可以直接试用。">
            <UiKitDemo />
          </Section>
        </div>
      </details>
    </ConsolePane>
  );
}

function VersionList({ snapshot }: { snapshot: ConsoleSnapshot }): JSX.Element {
  return (
    <List label="应用信息">
      <ListItem title={snapshot.app.name} description="应用名称" />
      <ListItem title="当前版本" meta={snapshot.app.version} />
      <ListItem title="许可" meta="MIT" />
    </List>
  );
}

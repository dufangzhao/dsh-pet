import type { ConsoleSnapshot, PermissionDeclaration } from '@pet/contracts';
import type { JSX } from 'react';

import { EmptyState, List, ListItem, Section } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import { ownerKey } from '../labels.js';

export interface PermissionsPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
}

/** 权限与数据页：插件声明的权限（请求，不是授权结果），以及数据相关说明。 */
export function PermissionsPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
}: PermissionsPageProps): JSX.Element {
  return (
    <ConsolePane
      title="权限与数据"
      summary="插件声明需要的能力。这里显示的是声明，不代表已经授权。"
    >
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : <PermissionContent snapshot={snapshot} />}
      </ConsoleStatus>
    </ConsolePane>
  );
}

interface DeclaredPermission {
  key: string;
  pluginName: string;
  text: string;
}

function collect(snapshot: ConsoleSnapshot): DeclaredPermission[] {
  return snapshot.plugins.flatMap((plugin) =>
    plugin.permissions.map((permission) => {
      const text = describePermission(permission);
      // owner 三段 + 权限文本：同名插件、同 kind 不同参数都不会撞。
      return {
        key: `${ownerKey(plugin.owner)}|${permission.kind}|${text}`,
        pluginName: plugin.name,
        text,
      };
    }),
  );
}

/** 一件权限声明的人话描述；具体参数（来源、键名）一并列出，因为是只读展示。 */
function describePermission(permission: PermissionDeclaration): string {
  switch (permission.kind) {
    case 'capability-use':
      return `使用能力 ${permission.capability}`;
    case 'microphone':
      return '使用麦克风';
    case 'screen-capture':
      return '截取屏幕';
    case 'text-input':
      return '模拟键盘输入';
    case 'network':
      return `访问网络：${permission.origins.join('、')}`;
    case 'credentials':
      return `使用凭据：${permission.keys.join('、')}`;
    case 'files':
      return `访问文件（${permission.scope}，${permission.access}）`;
    case 'process':
      return `启动工作进程：${permission.workers.join('、')}`;
    case 'clipboard':
      return `读写剪贴板（${permission.access}）`;
  }
}

function PermissionContent({ snapshot }: { snapshot: ConsoleSnapshot }): JSX.Element {
  const declared = collect(snapshot);

  return (
    <>
      <Section title="插件声明">
        {declared.length === 0 ? (
          <EmptyState
            title="没有插件声明权限"
            description="插件没有向宿主申请额外能力，因此这里为空。"
          />
        ) : (
          <List label="插件权限声明">
            {declared.map((item) => (
              <ListItem key={item.key} title={item.pluginName} description={item.text} />
            ))}
          </List>
        )}
      </Section>

      <Section title="数据">
        <EmptyState title="数据管理尚未接入" description="清除对话记录与导出数据暂不可用。" />
      </Section>
    </>
  );
}

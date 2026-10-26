import { useState, type JSX } from 'react';

import { Button } from './button.js';
import { Dialog } from './dialog.js';
import { EmptyState } from './empty-state.js';
import { Field } from './field.js';
import { List, ListItem } from './list.js';
import { Section } from './section.js';
import { StatusBadge } from './status-badge.js';
import { Toast } from './toast.js';
import { useToastStore } from './toast-store.js';

/**
 * 组件示例：关于页高级区与第一阶段验收共用这一份真实实现。
 * 每个控件都带可读标签，键盘可完整操作——Tab 进入、Escape 关闭、关闭后焦点回到触发按钮。
 * 这里的按钮只演示交互，不触发任何真实操作，提示文案也不声称功能已生效。
 */
export function UiKitDemo(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const toasts = useToastStore();

  return (
    <div className="pk-demo">
      <Section title="按钮" description="主按钮只给页面里最重要的一个动作，其余用次级与文字按钮。">
        <div className="pk-demo__row">
          <Button variant="primary" onClick={() => toasts.push('按钮示例。')}>
            主要按钮
          </Button>
          <Button onClick={() => toasts.push('按钮示例。')}>次级按钮</Button>
          <Button variant="quiet" onClick={() => toasts.push('按钮示例。')}>
            文字按钮
          </Button>
          <Button disabled>不可用按钮</Button>
        </div>
        <p className="pk-demo__text">点击左侧三个按钮会给出同一条提示，仅为演示反馈。</p>
      </Section>

      <Section title="输入" description="标签、说明与错误都直接关联到控件，不靠占位符代替标签。">
        <Field label="显示名称" description="仅用于本机显示，最多 24 个字符。">
          {({ inputId, describedBy, invalid }) => (
            <input
              className="pk-input"
              id={inputId}
              type="text"
              value={name}
              maxLength={24}
              aria-describedby={describedBy}
              aria-invalid={invalid ? 'true' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="带错误的字段"
          description="有错误时控件标记为 aria-invalid，错误提示为 alert 角色并立即播报。"
          error="示例错误：这里会显示具体原因。"
        >
          {({ inputId, describedBy, invalid }) => (
            <input
              className="pk-input"
              id={inputId}
              type="text"
              defaultValue=""
              aria-describedby={describedBy}
              aria-invalid={invalid ? 'true' : undefined}
            />
          )}
        </Field>
      </Section>

      <Section title="状态">
        <div className="pk-demo__row">
          <StatusBadge>就绪</StatusBadge>
          <StatusBadge tone="ok">运行中</StatusBadge>
          <StatusBadge tone="warn">待确认</StatusBadge>
          <StatusBadge tone="danger">已停止</StatusBadge>
        </div>
      </Section>

      <Section title="列表">
        <List label="列表示例">
          <ListItem title="语音输入" description="本地识别" meta="1.0.0" />
          <ListItem title="对话" description="已启用" meta="1.2.0" />
        </List>
      </Section>

      <Section title="空状态">
        <EmptyState title="还没有审批请求" description="需要你确认的操作会出现在这里。" />
      </Section>

      <Section
        title="对话框与提示"
        description="对话框用原生 <dialog>：背后内容不可聚焦，按 Escape 关闭，关闭后焦点回到打开它的按钮。"
      >
        <div className="pk-demo__row">
          <Button onClick={() => setOpen(true)}>打开对话框</Button>
          <Button onClick={() => toasts.push('已显示通知示例。')}>显示通知</Button>
        </div>
      </Section>

      <Dialog
        open={open}
        title="示例对话框"
        onClose={() => setOpen(false)}
        footer={
          <>
            {/* 初始焦点落在最不危险的操作上，误触不会造成后果。 */}
            <Button data-autofocus onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                toasts.push('已确认示例。');
              }}
            >
              确认
            </Button>
          </>
        }
      >
        这是一个交互示例，确认后只会出现一条提示，不会改动任何设置。
      </Dialog>

      <Toast items={toasts.items} onDismiss={toasts.dismiss} />
    </div>
  );
}

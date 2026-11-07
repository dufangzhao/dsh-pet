import { useEffect, useRef, type JSX } from 'react';
import { StatusBadge } from '@pet/ui-kit';
import type { CompanionMessage, CompanionTask } from '@pet/contracts';

import { clockTime } from './format.js';
import type { ClientState } from './state.js';

const ROLE_LABELS = { user: '你', assistant: '助手', notice: '通知' } as const;

interface ConversationProps {
  readonly state: ClientState;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function Conversation({
  state,
  draft,
  onDraftChange,
  onSubmit,
}: ConversationProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const messages = state.snapshot?.messages ?? [];
  const previousCount = useRef(0);

  // 只在新增消息时贴到底部，避免每次刷新都抢走用户正在读的位置。
  useEffect(() => {
    if (messages.length === previousCount.current) return;
    previousCount.current = messages.length;
    const node = listRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const busy = state.phase !== 'live';
  const taskById = new Map((state.snapshot?.tasks ?? []).map((task) => [task.id, task]));

  return (
    <div className="tc-chat">
      <div
        className="tc-chat__log"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && state.outbox.length === 0 ? (
          <p className="tc-chat__empty">
            {busy ? '连接后即可开始。' : '还没有对话。直接写下要它做的事。'}
          </p>
        ) : (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              task={message.taskId === null ? undefined : taskById.get(message.taskId)}
            />
          ))
        )}
        {state.outbox.map((entry) => (
          <article className="tc-msg tc-msg--user tc-msg--pending" key={entry.commandId}>
            <header className="tc-msg__head">
              <span className="tc-msg__role">你</span>
              <span className="tc-msg__flag">
                {entry.uncertain ? '结果未知 · 重试不会重复发送' : '正在发送'}
              </span>
            </header>
            <p className="tc-msg__text">{entry.text}</p>
          </article>
        ))}
      </div>

      {state.snapshot?.projection?.hasMoreMessages === true ? (
        <p className="tc-note">较早的消息未显示，这里只是最近一段记录。</p>
      ) : null}

      <form
        className="tc-compose"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="tc-compose__label" htmlFor="tc-input">
          写下要说的话
        </label>
        <textarea
          id="tc-input"
          className="tc-compose__input"
          value={draft}
          rows={3}
          maxLength={8000}
          placeholder={
            busy ? '连接后才能发送，可以先把话写在这里' : 'Enter 发送，Shift + Enter 换行'
          }
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="tc-compose__foot">
          <span className="tc-compose__count">
            {draft.length === 0 ? '' : `${draft.length} / 8000`}
          </span>
          <button type="submit" className="tc-send" disabled={busy || draft.trim() === ''}>
            发送
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageRow({
  message,
  task,
}: {
  message: CompanionMessage;
  task: CompanionTask | undefined;
}): JSX.Element {
  return (
    <article className={`tc-msg tc-msg--${message.role}`}>
      <header className="tc-msg__head">
        <span className="tc-msg__role">{ROLE_LABELS[message.role]}</span>
        <time className="tc-msg__time" dateTime={new Date(message.createdAt).toISOString()}>
          {clockTime(message.createdAt)}
        </time>
        {task === undefined ? null : <span className="tc-msg__flag">任务 · {task.title}</span>}
      </header>
      <p className="tc-msg__text">{message.text}</p>
    </article>
  );
}

/** 一行助手身份：名字、真实/脚本模式、可用性。脚本模式必须明说。 */
export function AgentLine({ state }: { state: ClientState }): JSX.Element | null {
  const agent = state.snapshot?.agent;
  if (agent === undefined) return null;
  return (
    <div className="tc-agent">
      <span className="tc-agent__name">{agent.name}</span>
      <span className="tc-agent__mode">
        {agent.mode === 'scripted' ? '离线脚本回复，未调用模型' : '模型回复'}
      </span>
      {agent.status === 'unavailable' ? <StatusBadge tone="danger">不可用</StatusBadge> : null}
    </div>
  );
}

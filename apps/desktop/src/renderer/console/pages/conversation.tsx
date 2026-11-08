/**
 * 对话页：服务里的同一条记录 + 唯一输入框。
 *
 * 只显示服务确认过的消息与本地待确认条目；命令回执不写进快照，所以这里不会
 * 出现「发送成功」的假条目。断线时保留最后确认的内容与时间，把状态标成未知。
 */
import { errorMessage, type CompanionMessage } from '@pet/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Button, Status } from '../minimal-ui/controls.js';
import type { CompanionView } from '../../shared/use-companion.js';
import { newCommandId } from '../../shared/commands.js';
import {
  agentModeLabel,
  canSend,
  clockTime,
  connectionView,
  isActive,
  pendingStop,
  sendBlockedReason,
  sizeLabel,
  taskView,
} from '../../shared/companion-state.js';

export interface ConversationPageProps {
  companion: CompanionView;
  onGoToStart: () => void;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

/** 一条消息一行；notice 是服务自己的通知，样式与助手区分开。 */
function MessageRow({ message, name }: { message: CompanionMessage; name: string }): JSX.Element {
  const mine = message.role === 'user';
  const who = mine ? '你' : message.role === 'notice' ? '通知' : name;
  return (
    <li
      className={`chat-entry chat-entry--${mine ? 'user' : 'pet'}`}
      data-testid="chat-message"
      data-role={message.role}
    >
      <div className="chat-bubble">
        <p>{message.text}</p>
        <div className="chat-time">
          {who} · {clockTime(message.createdAt)}
        </div>
      </div>
    </li>
  );
}

export function ConversationPage({
  companion,
  onGoToStart,
  notify,
}: ConversationPageProps): JSX.Element {
  const state = companion.state;
  const snapshot = state?.snapshot ?? null;
  const name = snapshot?.agent.name ?? '助手';
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const inFlight = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const previousCount = useRef(0);
  const follow = useRef(true);
  /** 结果未知的那一次：内容不变的重试必须复用同一个 commandId，否则会重复提交。 */
  const uncertain = useRef<{ text: string; commandId: string } | null>(null);

  const messages = snapshot?.messages ?? [];
  const sending = state?.pending.some((entry) => entry.status === 'sending') ?? false;
  const sendable = state !== null && canSend(state) && companion.available;
  const blocked = state === null ? '正在读取连接状态…' : sendBlockedReason(state);

  // 只在新增消息时贴到底部，不抢用户正在读的位置。
  useEffect(() => {
    const node = listRef.current;
    if (node === null) return;
    if (messages.length !== previousCount.current) {
      previousCount.current = messages.length;
      if (follow.current) node.scrollTop = node.scrollHeight;
    }
  }, [messages.length]);

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (text === '' || !sendable || inFlight.current) return;
    inFlight.current = true;
    // 内容没变的重试复用同一个 commandId；内容改了就是另一件事，给新 ID。
    const previous = uncertain.current;
    const commandId =
      previous !== null && previous.text === text ? previous.commandId : newCommandId();
    try {
      const result = await companion.send(commandId, text);
      if (result.outcome === 'accepted') {
        uncertain.current = null;
        setDraft((current) => (current === draft ? '' : current));
      } else if (result.outcome === 'uncertain') {
        uncertain.current = { text, commandId };
      } else if (result.outcome === 'failed' && result.error !== null) {
        notify(`发送失败：${result.error}`, 'danger');
      }
    } finally {
      inFlight.current = false;
      input.current?.focus();
    }
  };

  /** 保存产物：只传 ID；路径由原生对话框给，渲染器不碰。 */
  const save = async (artifactId: string): Promise<void> => {
    const result = await companion.saveArtifact(artifactId);
    if (!result.ok) {
      notify(`没有保存成功：${errorMessage(result.error)}`, 'danger');
      return;
    }
    notify(
      result.value.status === 'saved'
        ? `已保存 ${result.value.name}（${sizeLabel(result.value.sizeBytes)}）`
        : '已取消，没有写入文件',
      'ok',
    );
  };

  const connection = state === null ? null : connectionView(state);
  const tasks = snapshot?.tasks ?? [];

  return (
    <section className="native-conversation-page page--chat" data-testid="conversation-chat">
      <header className="chat-head">
        <div className="chat-head__title">
          <h2>{snapshot === null ? '与服务对话' : `与 ${name} 对话`}</h2>
          <span id="conversation-chat-status" data-tone={connection?.tone ?? 'idle'}>
            {connection === null ? '尚未读取' : connection.label}
          </span>
        </div>
        {state !== null && state.connectionId !== null && state.phase === 'offline' ? (
          <Button data-testid="conversation-reconnect" onClick={() => void companion.reconnect()}>
            重新连接
          </Button>
        ) : null}
      </header>

      {state === null || snapshot === null ? (
        <article className="card" id="conversation-history">
          <div className="card__body">
            <p className="row__value" role="status">
              {companion.available
                ? '还没有连上服务。先到开始页填地址并输入访问令牌。'
                : '这台机器没有连接服务的通道。'}
            </p>
            <Button data-testid="conversation-go-start" onClick={onGoToStart}>
              去连接服务
            </Button>
          </div>
        </article>
      ) : (
        <article className="card" id="conversation-history" aria-label="同一条对话记录">
          <ul
            ref={listRef}
            className="chat-stream"
            id="conversation-stream"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="对话记录"
            tabIndex={0}
            onScroll={() => {
              const node = listRef.current;
              if (node !== null)
                follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            }}
          >
            {messages.length === 0 && state.pending.length === 0 ? (
              <li className="chat-entry chat-entry--interaction">
                <p className="chat-interaction">
                  还没有对话。直接写下要它做的事，或者给它一个能自己完成的任务。
                </p>
              </li>
            ) : null}
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} name={name} />
            ))}
            {/* 待确认条目只有 Main 的元数据，没有正文：不复制用户那句话，也不编时间。 */}
            {state.pending
              .filter((entry) => entry.kind === 'message')
              .map((entry) => (
                <li
                  className="chat-entry chat-entry--interaction"
                  key={entry.commandId}
                  data-testid="chat-pending"
                >
                  <p className="chat-interaction">
                    {entry.status === 'uncertain'
                      ? '上一条消息结果未知：可能已经送达。重试会复用同一次提交。'
                      : '上一条消息正在发送…'}
                  </p>
                </li>
              ))}
          </ul>
          {snapshot.projection?.hasMoreMessages === true ? (
            <p className="row__value">较早的消息未显示，这里只是最近一段记录。</p>
          ) : null}
        </article>
      )}

      {state !== null && state.error !== null ? (
        <p className="field__error" role="alert">
          {errorMessage(state.error)}
        </p>
      ) : null}
      {companion.notice === null ? null : (
        <p className="row__value" role="status">
          {companion.notice}
        </p>
      )}

      {/* 任务行：状态、定向停止、产物下载各就各位；停止只作用于这一行。 */}
      {state === null || tasks.length === 0 ? null : (
        <section className="card" data-testid="conversation-tasks" aria-label="最近的任务">
          <header className="card__head">
            <h2 className="card__title">最近的任务</h2>
            <Status>{tasks.length}</Status>
          </header>
          <ul className="chat-stream" style={{ maxHeight: 240 }}>
            {tasks.map((task) => {
              const view = taskView(task, state);
              const stop = pendingStop(state, task.id);
              return (
                <li className="chat-entry" key={task.id} data-testid="task-row">
                  <div className="chat-bubble">
                    <p>{task.title}</p>
                    <div className="chat-time">
                      <Status tone={view.tone === 'muted' ? 'muted' : view.tone}>
                        {view.label}
                      </Status>
                      {' · '}
                      {clockTime(task.createdAt)}
                    </div>
                    {task.artifacts.length === 0 ? null : (
                      <div className="chat-time">
                        {task.artifacts.map((artifact) => (
                          <Button
                            key={artifact.id}
                            size="small"
                            data-testid="artifact-save"
                            disabled={state.phase !== 'live'}
                            onClick={() => void save(artifact.id)}
                          >
                            {artifact.name}
                          </Button>
                        ))}
                      </div>
                    )}
                    {isActive(task.status) && state.phase === 'live' ? (
                      <Button
                        size="small"
                        data-testid="task-stop"
                        disabled={stop !== null}
                        onClick={() => void companion.stopTask(newCommandId(), task.id)}
                      >
                        {stop === null ? '停止这个任务' : '已请求停止'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {snapshot?.projection?.hasMoreTasks === true ? (
            <p className="row__value">较早的任务未列出。</p>
          ) : null}
        </section>
      )}

      <form
        className="chat-composer"
        id="conversation-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="chat-composer__field">
          <textarea
            ref={input}
            className="chat-input"
            id="conversation-input"
            rows={1}
            maxLength={8000}
            spellCheck={false}
            value={draft}
            readOnly={sending}
            aria-label="说点什么"
            aria-describedby="conversation-send-state"
            placeholder="对它说点什么…"
            data-testid="conversation-input"
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return;
              event.preventDefault();
              void submit();
            }}
          />
          <p className="chat-send-state" id="conversation-send-state" role="status">
            {sending
              ? '正在发送…'
              : blocked !== null
                ? `${blocked} 草稿会留在这里。`
                : snapshot === null
                  ? '连接后即可开始。'
                  : `${agentModeLabel(snapshot.agent)} · Enter 发送，Shift + Enter 换行`}
          </p>
        </div>
        <Button
          type="submit"
          variant="primary"
          className="chat-send"
          aria-label="发送消息"
          data-testid="conversation-send"
          disabled={!sendable || sending || !draft.trim()}
        >
          发送
        </Button>
      </form>
    </section>
  );
}

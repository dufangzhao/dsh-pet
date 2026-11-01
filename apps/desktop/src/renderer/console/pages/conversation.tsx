import { useEffect, useRef, useState, type JSX } from 'react';
import { errorMessage } from '@pet/contracts';

import { ConsoleStatus } from '../console-status.js';
import {
  clockTime,
  demoPhase,
  interactionKind,
  interactionMode,
  interactionVia,
} from '../labels.js';
import { Button, Status } from '../minimal-ui/controls.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { DemoRecorder } from './demo-console.js';

export interface ConversationPageProps {
  app: ApplicationState;
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

/** A view of the shared history and capture owner, with no local message echo. */
export function ConversationPage({ app, demo, notify }: ConversationPageProps): JSX.Element {
  const [consoleOpen, setConsoleOpen] = useState(false);
  const snapshot = demo.snapshot;
  const name = app.snapshot?.profile?.data.petName ?? '桌宠';
  const status = demo.error ? '暂不可用' : snapshot ? demoPhase(snapshot.phase).text : '尚未读取';
  return (
    <section className="native-conversation-page page--chat" data-testid="conversation-chat">
      <header className="chat-head">
        <div className="chat-head__title">
          <h2>与{name}聊天</h2>
          <span role="status">{status}</span>
        </div>
        <Button
          className="chat-console-toggle"
          aria-expanded={consoleOpen}
          aria-controls="conversation-console"
          data-testid="conversation-tools"
          onClick={() => setConsoleOpen((open) => !open)}
        >
          聊天操作
        </Button>
      </header>
      <article className="card" id="conversation-history" aria-label="同一条对话记录">
        <div className="chat-console" id="conversation-console" hidden={!consoleOpen}>
          <div className="chat-console__group">
            <p className="chat-console__label">记录</p>
            <div className="chat-console__buttons">
              <Button
                data-testid="history-refresh"
                disabled={!app.available || app.loading}
                onClick={app.refresh}
              >
                {app.loading ? '读取中…' : '刷新记录'}
              </Button>
              {app.historyEarlier ? (
                <Button
                  data-testid="history-earlier"
                  disabled={app.historyLoading}
                  onClick={app.loadEarlierHistory}
                >
                  {app.historyLoading ? '读取中…' : '加载更早记录'}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="chat-console__group">
            <p className="chat-console__label">语音</p>
            <DemoRecorder demo={demo} />
          </div>
        </div>
        {app.historyError ? (
          <p role="alert" className="field__error" data-testid="history-earlier-error">
            更早的记录没有读出来：{app.historyError}
          </p>
        ) : null}
        <ConsoleStatus
          loading={app.loading}
          error={app.error}
          available={app.available}
          onRetry={app.refresh}
        >
          {app.snapshot === null ? null : <History app={app} demo={demo} />}
        </ConsoleStatus>
      </article>
      <ConsoleStatus
        loading={demo.loading}
        error={demo.error}
        available={demo.available}
        onRetry={demo.refresh}
      >
        {null}
      </ConsoleStatus>
      {snapshot?.error ? (
        <p className="field__error" role="alert">
          {errorMessage(snapshot.error)}
        </p>
      ) : null}
      <Compose demo={demo} notify={notify} />
    </section>
  );
}

function liveText(demo: DemoState): string | null {
  const snapshot = demo.snapshot;
  if (!snapshot) return null;
  if (snapshot.phase === 'responding' && snapshot.partialReply.trim())
    return (snapshot.settings.replyMode === 'demo' ? '脚本演示｜' : '') + snapshot.partialReply;
  if (
    (snapshot.phase === 'recording' || snapshot.phase === 'recognizing') &&
    snapshot.partialTranscript.trim()
  )
    return `正在识别：${snapshot.partialTranscript}`;
  return null;
}

function History({ app, demo }: { app: ApplicationState; demo: DemoState }): JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  const follow = useRef(true);
  const first = useRef<string | null>(null);
  const previousHeight = useRef(0);
  const text = liveText(demo);
  const firstId = app.history[0]?.id ?? null;
  const lastId = app.history.at(-1)?.id ?? null;
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    if (first.current !== null && firstId !== first.current && !follow.current)
      root.scrollTop += root.scrollHeight - previousHeight.current;
    else if (follow.current) root.scrollTop = root.scrollHeight;
    first.current = firstId;
    previousHeight.current = root.scrollHeight;
  }, [firstId, lastId, text]);
  return (
    <ul
      ref={list}
      className="chat-stream"
      id="conversation-stream"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="对话记录"
      tabIndex={0}
      onScroll={() => {
        const root = list.current;
        if (root) follow.current = root.scrollHeight - root.scrollTop - root.clientHeight < 40;
      }}
    >
      {app.history.length === 0 && !text ? (
        <li className="chat-entry chat-entry--interaction">
          <p className="chat-interaction">
            还没有日常互动记录。对它说话、碰它一下，或在气泡里做一个选择，都会出现在这里。
          </p>
        </li>
      ) : null}
      {app.history.map((item) => {
        const message = item.kind === 'user' || item.kind === 'pet';
        const who =
          item.kind === 'user'
            ? (app.snapshot?.profile?.data.userName ?? '你')
            : (app.snapshot?.profile?.data.petName ?? '桌宠');
        return (
          <li
            className={`chat-entry chat-entry--${message ? item.kind : 'interaction'}`}
            key={item.id}
            data-interaction-id={item.id}
            data-interaction-kind={item.kind}
            aria-label={interactionKind(item.kind)}
          >
            {message ? (
              <span className="chat-avatar" aria-hidden="true">
                {who.slice(0, 1)}
              </span>
            ) : null}
            <div className="chat-bubble">
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>
              <div className="chat-time">
                {message ? who : interactionKind(item.kind)}
                {item.via ? ` · ${interactionVia(item.via)}` : ''} · {clockTime(item.at)}
                {item.mode === 'demo' ? <Status>{interactionMode(item.mode)}</Status> : null}
              </div>
            </div>
          </li>
        );
      })}
      {text ? (
        <li
          className={`chat-entry chat-entry--${demo.snapshot?.phase === 'responding' ? 'pet' : 'interaction'}`}
          data-testid="conversation-live"
        >
          <div className="chat-bubble">
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</p>
          </div>
        </li>
      ) : null}
    </ul>
  );
}

function Compose({
  demo,
  notify,
}: {
  demo: DemoState;
  notify: ConversationPageProps['notify'];
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const inFlight = useRef(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const sending = demo.pending.has('send');
  const canSend =
    demo.available && !demo.loading && demo.error === null && (demo.snapshot?.canSend ?? false);
  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || !canSend || sending || inFlight.current) return;
    inFlight.current = true;
    try {
      const outcome = await demo.sendText(text);
      if (outcome.ok) setDraft((current) => (current === draft ? '' : current));
      else notify(`发送失败：${outcome.error ?? '请求没有完成'}`, 'danger');
    } finally {
      inFlight.current = false;
      input.current?.focus();
    }
  };
  return (
    <form
      className="chat-composer"
      id="conversation-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="chat-composer__field">
        <textarea
          ref={input}
          className="chat-input"
          id="conversation-input"
          rows={1}
          maxLength={2000}
          spellCheck={false}
          value={draft}
          readOnly={sending}
          aria-label="说点什么"
          aria-describedby="conversation-send-state"
          placeholder="对它说点什么…"
          data-testid="demo-input"
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
            void send();
          }}
        />
        <p className="chat-send-state" id="conversation-send-state" role="status">
          {sending
            ? '正在发送…'
            : !canSend
              ? '回复尚未就绪，请检查开始页的模型连接。草稿会留在这里。'
              : 'Enter 发送，Shift + Enter 换行'}
        </p>
      </div>
      <Button
        type="submit"
        variant="primary"
        className="chat-send"
        aria-label="发送消息"
        data-testid="demo-send"
        disabled={!canSend || sending || !draft.trim()}
      >
        发送
      </Button>
    </form>
  );
}

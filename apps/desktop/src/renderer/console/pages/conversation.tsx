import { useCallback, useState, type JSX } from 'react';

import type { ApplicationInteraction } from '@pet/contracts';

import { Button, EmptyState, List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { ConsoleStatus } from '../console-status.js';
import {
  clockTime,
  demoPhase,
  interactionKind,
  interactionMode,
  interactionVia,
} from '../labels.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { DemoRecorder } from './demo-console.js';

export interface ConversationPageProps {
  app: ApplicationState;
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

/**
 * 对话页是同一条日常记录的样子，不是第二个会话：
 * 文字、语音、真实的触碰与应用提示都写在那一条时间线上，这里只读它。
 * 输入框继续走同一个发送通道（现有 DemoBridge），不新建聊天身份。
 */
export function ConversationPage({ app, demo, notify }: ConversationPageProps): JSX.Element {
  return (
    <div className="pk-split">
      <div className="pk-split__main">
        <Section
          title="今天这一条"
          description="它只是同一份记录的视图：不新建历史，也不新建聊天入口。"
          actions={
            <button
              type="button"
              className="console-action"
              data-testid="history-refresh"
              onClick={app.refresh}
              disabled={app.loading}
            >
              {app.loading ? '读取中…' : '刷新'}
            </button>
          }
        >
          <ConsoleStatus
            loading={app.loading}
            error={app.error}
            available={app.available}
            onRetry={app.refresh}
          >
            {app.snapshot === null ? null : <History app={app} />}
          </ConsoleStatus>
        </Section>

        <Section title="对它说" description="这一句会进同一条记录，回复也记在同一处。">
          <ConsoleStatus
            loading={demo.loading}
            error={demo.error}
            available={demo.available}
            onRetry={demo.refresh}
          >
            {demo.snapshot === null ? null : (
              <>
                <p className="demo-phase">
                  <StatusBadge tone={demoPhase(demo.snapshot.phase).tone}>
                    {demoPhase(demo.snapshot.phase).text}
                  </StatusBadge>
                </p>
                <DemoRecorder demo={demo} />
                <LiveText demo={demo} />
                <Compose demo={demo} notify={notify} />
              </>
            )}
          </ConsoleStatus>
        </Section>
      </div>

      <div className="pk-split__aside">
        <p className="console-muted">
          桌面上说的话、气泡里的选择与这里的输入，记的是同一只桌宠的同一份记录。
        </p>
      </div>
    </div>
  );
}

function History({ app }: { app: ApplicationState }): JSX.Element {
  const items = app.history;
  if (items.length === 0) {
    return (
      <EmptyState
        title="还没有日常互动记录"
        description="对它说话、碰它一下，或在气泡里做一个选择，都会出现在这里。"
      />
    );
  }
  return (
    <>
      {app.historyEarlier || app.historyError !== null ? (
        <div className="history-earlier">
          {app.historyEarlier ? (
            <Button
              size="small"
              disabled={app.historyLoading}
              data-testid="history-earlier"
              onClick={app.loadEarlierHistory}
            >
              {app.historyLoading ? '读取中…' : '加载更早记录'}
            </Button>
          ) : null}
          {app.historyError === null ? null : (
            <p className="pk-row__error" role="alert" data-testid="history-earlier-error">
              更早的记录没有读出来：{app.historyError}
            </p>
          )}
        </div>
      ) : null}
      <List label="日常互动记录">
        {items.map((item) => (
          <ListItem
            key={item.id}
            title={interactionKind(item.kind)}
            description={item.text}
            meta={clockTime(item.at)}
            trailing={<Chips item={item} />}
          />
        ))}
      </List>
    </>
  );
}

/** 来源与回复方式都另有文字，颜色只是帮助扫读。 */
function Chips({ item }: { item: ApplicationInteraction }): JSX.Element | null {
  const chips: JSX.Element[] = [];
  if (item.via !== undefined) {
    chips.push(
      <StatusBadge key="via" tone="neutral">
        {interactionVia(item.via)}
      </StatusBadge>,
    );
  }
  if (item.mode !== undefined) {
    chips.push(
      <StatusBadge key="mode" tone={item.mode === 'demo' ? 'warn' : 'neutral'}>
        {interactionMode(item.mode)}
      </StatusBadge>,
    );
  }
  return chips.length === 0 ? null : <>{chips}</>;
}

/** 正在听、正在想的内容一块块回来，用 aria-live 播报，不弹提示。 */
function LiveText({ demo }: { demo: DemoState }): JSX.Element | null {
  const snapshot = demo.snapshot;
  if (snapshot === null) {
    return null;
  }
  const line =
    snapshot.partialTranscript.length > 0
      ? `正在听：${snapshot.partialTranscript}`
      : snapshot.transcript.length > 0
        ? `听到：${snapshot.transcript}`
        : snapshot.partialReply.length > 0
          ? `回复中：${snapshot.partialReply}`
          : null;
  if (line === null) {
    return null;
  }
  return (
    <p className="demo-transcript" role="status" aria-live="polite">
      {line}
    </p>
  );
}

function Compose({
  demo,
  notify,
}: {
  demo: DemoState;
  notify: ConversationPageProps['notify'];
}): JSX.Element | null {
  const snapshot = demo.snapshot;
  const [draft, setDraft] = useState('');

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (text === '') {
      return;
    }
    const outcome = await demo.sendText(text);
    if (!outcome.ok) {
      notify(`发送失败：${outcome.error}`, 'danger');
      return;
    }
    // 回复要等宿主推进阶段才回来，这里只承诺"已送出"。
    setDraft('');
    notify('已送出这句话。', 'ok');
  }, [demo, draft, notify]);

  if (snapshot === null) {
    return null;
  }

  return (
    <form
      className="demo-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label className="demo-compose__label" htmlFor="conversation-input">
        说点什么
      </label>
      <p className="console-muted">
        {snapshot.canSend
          ? '这句话和回复都会出现在上面那条记录里。'
          : '现在还不能发送：先在开始页接上回复来源。'}
      </p>
      <textarea
        id="conversation-input"
        className="pk-input"
        rows={2}
        maxLength={2000}
        value={draft}
        data-testid="demo-input"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="demo-compose__actions">
        <Button
          type="submit"
          size="small"
          variant="primary"
          disabled={!snapshot.canSend || draft.trim() === '' || demo.pending.has('send')}
          data-testid="demo-send"
        >
          {demo.pending.has('send') ? '正在送出…' : '发送'}
        </Button>
      </div>
    </form>
  );
}

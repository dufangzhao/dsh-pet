import { useCallback, useState, type JSX } from 'react';

import { ConsoleStatus } from '../console-status.js';
import {
  clockTime,
  demoPhase,
  interactionKind,
  interactionMode,
  interactionVia,
} from '../labels.js';
import { Button, Card, Status } from '../minimal-ui/controls.js';
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
    <>
      <Card title="今天这一条">
        <div className="card__foot">
          <Button data-testid="history-refresh" disabled={app.loading} onClick={app.refresh}>
            {app.loading ? '读取中…' : '刷新'}
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

        {app.historyError === null ? null : (
          <p role="alert" data-testid="history-earlier-error">
            <Status tone="danger">更早的记录没有读出来：{app.historyError}</Status>
          </p>
        )}

        <ConsoleStatus
          loading={app.loading}
          error={app.error}
          available={app.available}
          onRetry={app.refresh}
        >
          {app.snapshot === null ? null : <History app={app} />}
        </ConsoleStatus>
      </Card>

      <ConsoleStatus
        loading={demo.loading}
        error={demo.error}
        available={demo.available}
        onRetry={demo.refresh}
      >
        {demo.snapshot === null ? null : (
          <>
            <Compose demo={demo} notify={notify} />
            <Card title="语音" action={<Status>{demoPhase(demo.snapshot.phase).text}</Status>}>
              <DemoRecorder demo={demo} />
              <LiveText demo={demo} />
            </Card>
          </>
        )}
      </ConsoleStatus>
    </>
  );
}

/** 时间线按升序读：越往下越新，和它说话的顺序一致。 */
function History({ app }: { app: ApplicationState }): JSX.Element {
  const items = app.history;
  if (items.length === 0) {
    return (
      <div className="rows rows--tight">
        <div className="row">
          <span className="row__text">
            <span className="row__label">还没有日常互动记录</span>
            <span className="row__desc">
              对它说话、碰它一下，或在气泡里做一个选择，都会出现在这里。
            </span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="rows rows--tight">
      {items.map((item) => (
        <div
          className="row"
          key={item.id}
          data-interaction-id={item.id}
          data-interaction-kind={item.kind}
        >
          <span className="row__text">
            <span className="row__label">{item.text}</span>
          </span>
          <span className="row__value">
            {interactionKind(item.kind)}
            {item.via === undefined ? null : ` · ${interactionVia(item.via)}`}
            {` · ${clockTime(item.at)}`}
            {item.mode === undefined ? null : <Status>{interactionMode(item.mode)}</Status>}
          </span>
        </div>
      ))}
    </div>
  );
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
    <p className="row__value" role="status" aria-live="polite">
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

  const sending = demo.pending.has('send');

  return (
    <Card
      title="对它说"
      action={
        <span className="row__value" role="status">
          {!snapshot.canSend
            ? '还不能发送：先在开始页接上回复来源'
            : sending
              ? '正在送出…'
              : '未发送'}
        </span>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="conversation-input">
            说点什么
          </label>
          <div className="inputForm" data-multiline="true">
            <textarea
              className="input"
              id="conversation-input"
              rows={3}
              maxLength={2000}
              spellCheck={false}
              value={draft}
              data-testid="demo-input"
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <span className="row__value">{draft.length} / 2000 字符</span>
        </div>

        <div className="card__foot">
          <Button
            type="submit"
            variant="primary"
            disabled={!snapshot.canSend || draft.trim() === '' || sending}
            data-testid="demo-send"
          >
            {sending ? '正在送出…' : '发送'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

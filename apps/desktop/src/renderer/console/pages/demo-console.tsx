import type { DemoPhase, DemoSnapshot } from '@pet/contracts';
import { useCallback, useState, type JSX } from 'react';

import { Button, Dialog, List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { describeError } from '../copy.js';
import { clockTime, demoPhase, demoReplyMode } from '../labels.js';
import type { DemoState } from '../use-demo.js';

export interface DemoConsoleProps {
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

/** 进行中的阶段都能被取消；空闲与出错时不给停止按钮。 */
const CANCELLABLE: ReadonlySet<DemoPhase> = new Set([
  'preparing',
  'arming',
  'recording',
  'recognizing',
  'thinking',
  'responding',
  'saving',
]);

/** 本地 Demo 对话：阶段、录音、输入与记录贴在同一块里。 */
export function DemoConsole({ demo, notify }: DemoConsoleProps): JSX.Element | null {
  const snapshot = demo.snapshot;
  const [draft, setDraft] = useState('');
  const [clearing, setClearing] = useState(false);

  const stop = useCallback(async () => {
    const outcome = await demo.cancel();
    if (outcome.ok) {
      notify('已请求停止这一次。', 'ok');
    } else {
      notify(`停止失败：${outcome.error}`, 'danger');
    }
  }, [demo, notify]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text === '') {
      return;
    }
    const outcome = await demo.sendText(text);
    if (!outcome.ok) {
      notify(`发送失败：${outcome.error}`, 'danger');
      return;
    }
    // 回复由宿主推进阶段后才回来，这里只承诺"已送出"。
    setDraft('');
    notify('已送出这句话。', 'ok');
  }, [demo, draft, notify]);

  const clear = useCallback(async () => {
    setClearing(false);
    const outcome = await demo.clearHistory();
    if (outcome.ok) {
      notify('已清空对话记录。', 'ok');
    } else {
      notify(`清空失败：${outcome.error}`, 'danger');
    }
  }, [demo, notify]);

  if (snapshot === null) {
    return null;
  }

  const phase = demoPhase(snapshot.phase);
  const busy = snapshot.phase !== 'stopping' && CANCELLABLE.has(snapshot.phase);

  return (
    <Section
      title="本地 Demo 对话"
      description={
        snapshot.settings.replyMode === 'deepseek'
          ? '真实 DeepSeek 回复：用你的 Key 走网络。'
          : '离线脚本演示，非 AI。'
      }
      actions={
        <Button
          size="small"
          variant="quiet"
          disabled={snapshot.messages.length === 0 || demo.pending.has('clear')}
          data-testid="demo-clear"
          onClick={() => setClearing(true)}
        >
          清空记录
        </Button>
      }
    >
      <p className="demo-phase">
        <StatusBadge tone={phase.tone}>{phase.text}</StatusBadge>
        {busy ? (
          <Button size="small" data-testid="demo-stop" onClick={() => void stop()}>
            停止
          </Button>
        ) : null}
      </p>

      <DemoRecorder demo={demo} />
      <DemoLiveText snapshot={snapshot} />

      {snapshot.messages.length === 0 ? (
        <p className="console-muted">还没有对话记录。</p>
      ) : (
        <List label="对话记录">
          {snapshot.messages.map((message) => (
            <ListItem
              key={message.id}
              title={message.role === 'user' ? '我说' : '桌宠说'}
              description={message.text}
              meta={`${clockTime(message.at)} · ${demoReplyMode(message.mode)}`}
            />
          ))}
        </List>
      )}

      <form
        className="demo-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="demo-compose__label" htmlFor="demo-input">
          说点什么
        </label>
        <textarea
          id="demo-input"
          data-testid="demo-input"
          className="pk-input"
          rows={2}
          maxLength={2000}
          value={draft}
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
          <span className="console-muted">
            {snapshot.canSend ? '回复会出现在上面。' : '现在还不能发送，先看下面的准备清单。'}
          </span>
        </div>
      </form>

      {snapshot.error === null ? null : (
        <p className="config-banner config-banner--danger" role="alert">
          这次没有完成：{describeError(snapshot.error)}
        </p>
      )}

      <Dialog
        open={clearing}
        title="清空对话记录？"
        onClose={() => setClearing(false)}
        footer={
          <>
            <Button data-autofocus onClick={() => setClearing(false)}>
              取消
            </Button>
            <Button variant="danger" data-testid="demo-clear-confirm" onClick={() => void clear()}>
              清空
            </Button>
          </>
        }
      >
        只清掉这段对话记录；配置、凭据和数据保留。清空后找不回来。
      </Dialog>
    </Section>
  );
}

/** 识别与回复的中间文本：变化频繁，用 aria-live 播报，不弹提示。 */
function DemoLiveText({ snapshot }: { snapshot: DemoSnapshot }): JSX.Element | null {
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

export interface DemoRecorderProps {
  demo: DemoState;
}

/**
 * 录音控制视图：会话只在 useDemo 里有一份，切去权限页审批也不会把麦关掉。
 * 这里只按当前状态给按钮——「结束并识别」只请求停止（提交识别由 ended 回调一次完成），
 * 「取消这次录音」才作废这一次。
 */
export function DemoRecorder({ demo }: DemoRecorderProps): JSX.Element | null {
  const { snapshot, recording, left, pending, startRecording, endRecording, cancelRecording } =
    demo;
  if (snapshot === null) {
    return null;
  }
  return (
    <div className="demo-recorder">
      <div className="demo-recorder__actions">
        {recording === null ? (
          <Button
            size="small"
            variant="primary"
            disabled={!snapshot.canRecord || pending.has('record')}
            data-testid="demo-record"
            onClick={() => void startRecording()}
          >
            开始录音
          </Button>
        ) : (
          <>
            <Button
              size="small"
              variant="primary"
              data-testid="demo-record-end"
              onClick={() => void endRecording()}
            >
              结束并识别
            </Button>
            <Button
              size="small"
              data-testid="demo-record-cancel"
              onClick={() => void cancelRecording()}
            >
              取消这次录音
            </Button>
          </>
        )}
        <span className="console-muted">
          {recording === null
            ? `说完点「结束并识别」才开始识别，本次最长 ${snapshot.maxRecordingSeconds} 秒。`
            : `剩余 ${Math.max(0, left ?? recording.seconds)} 秒，超时自动结束。`}
        </span>
      </div>
    </div>
  );
}

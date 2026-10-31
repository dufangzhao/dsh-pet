import { useId, useState, type JSX } from 'react';

import type { DemoSnapshot, DemoReplyMode } from '@pet/contracts';

import { saveChoice } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { describeError } from '../copy.js';
import { demoPhase } from '../labels.js';
import { Button, Card, Status, Switch } from '../minimal-ui/controls.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { useDemoSettings } from '../use-demo-settings.js';
import { DemoRecorder } from './demo-console.js';

export interface VoicePageProps {
  app: ApplicationState;
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  /** 填 Key 在开始页；这里只把它作为出口，不复制一份表单。 */
  onGoToStart: () => void;
}

/**
 * 语音输入页：能不能用语音、用哪个模型识别、说完之后怎么处理。
 *
 * 控件的值一律来自宿主那一份快照（偏好或 Demo 设置），本机不存"将要生效的值"：
 * 写失败时这一行自然回到真实的值。录音会话只有 useDemo 那一份，切页不会关麦；
 * 最长时长与录音过程由那条会话自己说，这里不另写一遍。
 */
export function VoicePage({ app, demo, notify, onGoToStart }: VoicePageProps): JSX.Element {
  const settings = useDemoSettings();
  const [saving, setSaving] = useState<string | null>(null);

  const snapshot = demo.snapshot;

  return (
    <ConsoleStatus
      loading={demo.loading}
      error={demo.error}
      available={demo.available}
      onRetry={demo.refresh}
    >
      {snapshot === null ? null : (
        <>
          <Card title="语音输入">
            {app.values === null ? null : (
              <div className="rows">
                <Switch
                  label="用语音说话"
                  checked={app.values.voiceEnabled}
                  disabled={app.saving}
                  data-testid="pref-voice-enabled"
                  onChange={(next) => void saveChoice(app, notify, { voiceEnabled: next })}
                />
              </div>
            )}

            {snapshot.settings.readError === null ? null : (
              <p role="alert">
                <Status tone="danger">
                  读不到当前配置：{describeError(snapshot.settings.readError)}。刷新后可重试。
                </Status>
              </p>
            )}

            <div className="field-row">
              <ModelField
                snapshot={snapshot}
                demo={demo}
                settings={settings}
                saving={saving}
                setSaving={setSaving}
                notify={notify}
              />
              <ReplyField
                snapshot={snapshot}
                demo={demo}
                settings={settings}
                saving={saving}
                setSaving={setSaving}
                notify={notify}
              />
            </div>

            <div className="rows">
              <AutoSendSwitch
                snapshot={snapshot}
                demo={demo}
                settings={settings}
                saving={saving}
                setSaving={setSaving}
                notify={notify}
              />
            </div>

            {snapshot.keyConfigured || snapshot.settings.replyMode !== 'deepseek' ? null : (
              <div className="card__foot">
                <Button data-testid="demo-go-start" onClick={onGoToStart}>
                  去开始页填 Key
                </Button>
              </div>
            )}
          </Card>

          <Card title="录音与识别" action={<Status>{demoPhase(snapshot.phase).text}</Status>}>
            <DemoRecorder demo={demo} />
            <LiveText snapshot={snapshot} />
            {snapshot.error === null ? null : (
              <p role="alert">
                <Status tone="danger">这次没有完成：{describeError(snapshot.error)}</Status>
              </p>
            )}
          </Card>
        </>
      )}
    </ConsoleStatus>
  );
}

interface RowProps {
  snapshot: DemoSnapshot;
  demo: DemoState;
  settings: ReturnType<typeof useDemoSettings>;
  saving: string | null;
  setSaving: (value: string | null) => void;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

function writeFailure(notify: RowProps['notify'], error: string | null): void {
  notify(`这个选择没有写进去：${error ?? '未知原因'}`, 'danger');
}

/** 选中本身就是回执：成功不弹全局提示，连点选项不会堆一串"已保存"。 */
async function chooseModel(rows: RowProps, id: string): Promise<void> {
  const { asrOwner, asrRevision } = rows.snapshot.settings;
  rows.setSaving(`model:${id}`);
  const outcome = await rows.settings.saveAsrModel(asrOwner, asrRevision, id);
  rows.demo.refresh();
  rows.setSaving(null);
  if (!outcome.ok) writeFailure(rows.notify, outcome.error);
}

/** 没下载、只能整段，都是选它之前要知道的事：合成一句附在名字后面。 */
function noteOf(model: DemoSnapshot['models'][number]): string {
  const notes = [...(model.cached ? [] : ['未下载']), ...(model.streaming ? [] : ['只整段'])];
  return notes.length === 0 ? '' : `（${notes.join('，')}）`;
}

/** 回复来源与自动发送写的是同一个对象：一次写整个，不留半个状态。 */
async function writeVoice(rows: RowProps, mode: DemoReplyMode, autoSend: boolean): Promise<void> {
  const { voiceOwner, voiceRevision } = rows.snapshot.settings;
  rows.setSaving('voice');
  const outcome = await rows.settings.saveVoice(voiceOwner, voiceRevision, mode, autoSend);
  rows.demo.refresh();
  rows.setSaving(null);
  if (!outcome.ok) writeFailure(rows.notify, outcome.error);
}

/** 识别方式：值与可选项都来自宿主，读不到配置时由卡片顶部那一句说明。 */
function ModelField(rows: RowProps): JSX.Element {
  const { asrOwner, modelId } = rows.snapshot.settings;
  const busy = rows.settings.pending.has('asr');
  const blocked = asrOwner === null || rows.snapshot.settings.readError !== null;
  const chosen = rows.snapshot.models.find((model) => model.id === modelId) ?? null;
  const labelId = useId();

  const state =
    asrOwner === null
      ? '本机还没有可写入的识别插件。'
      : rows.snapshot.models.length === 0
        ? '还没有可用的识别模型。'
        : modelId === null
          ? '还没选模型：文字对话不需要它，录音前先选一个。'
          : chosen === null
            ? `已选 ${modelId}，但它不在当前列表里。`
            : chosen.cached
              ? `已选 ${chosen.name} · 已在本机`
              : `已选 ${chosen.name} · 还没有下载`;

  return (
    <div className="field field--grow">
      <span className="field__label" id={labelId}>
        识别方式
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={labelId}>
        {rows.snapshot.models.map((model) => (
          <label className="choice" key={model.id}>
            <input
              type="radio"
              name="demo-asr-model"
              value={model.id}
              checked={modelId === model.id}
              disabled={blocked || busy || rows.saving !== null}
              data-testid={`asr-model-${model.id}`}
              onChange={() => void chooseModel(rows, model.id)}
            />
            <span className="choice__name">
              {model.name}
              {noteOf(model)}
            </span>
          </label>
        ))}
      </div>
      {state === '' ? null : (
        <span className="row__value" role="status">
          {state}
        </span>
      )}
    </div>
  );
}

/** 回复来源：离线脚本演示与真实 DeepSeek 是两件不同的事，选哪个都要说清楚它现在能不能发。 */
function ReplyField(rows: RowProps): JSX.Element {
  const { voiceOwner, replyMode, readError } = rows.snapshot.settings;
  const busy = rows.settings.pending.has('voice');
  const blocked = voiceOwner === null || readError !== null;
  const mode = replyMode ?? 'demo';
  const labelId = useId();

  const state =
    voiceOwner === null
      ? '本机还没有可写入的回复设置。'
      : mode === 'deepseek'
        ? rows.snapshot.keyConfigured
          ? '真实 DeepSeek：已存有 Key（保存过不等于已验证）。'
          : '选了真实 DeepSeek，但还没有 Key：选了也发不出去。'
        : '';

  return (
    <div className="field field--grow">
      <span className="field__label" id={labelId}>
        回复来源
      </span>
      <div className="choices" role="radiogroup" aria-labelledby={labelId}>
        <label className="choice">
          <input
            type="radio"
            name="demo-reply-mode"
            value="demo"
            checked={mode === 'demo'}
            disabled={blocked || busy || rows.saving !== null}
            data-testid="reply-mode-demo"
            onChange={() => void writeVoice(rows, 'demo', rows.snapshot.settings.autoSend)}
          />
          <span className="choice__name">离线脚本演示，非 AI</span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="demo-reply-mode"
            value="deepseek"
            checked={mode === 'deepseek'}
            disabled={blocked || busy || rows.saving !== null}
            data-testid="reply-mode-deepseek"
            onChange={() => void writeVoice(rows, 'deepseek', rows.snapshot.settings.autoSend)}
          />
          <span className="choice__name">真实 DeepSeek</span>
        </label>
      </div>
      {state === '' ? null : (
        <span className="row__value" role="status">
          {state}
        </span>
      )}
    </div>
  );
}

/** 不勾就停在识别结果上，等你确认后再发。 */
function AutoSendSwitch(rows: RowProps): JSX.Element {
  const { voiceOwner, replyMode, autoSend, readError } = rows.snapshot.settings;
  const busy = rows.settings.pending.has('voice');
  const blocked = voiceOwner === null || readError !== null;

  return (
    <Switch
      label="说完自动发送"
      checked={autoSend}
      disabled={blocked || busy || rows.saving !== null}
      data-testid="demo-auto-send"
      onChange={(next) => void writeVoice(rows, replyMode ?? 'demo', next)}
    />
  );
}

/** 正在听、听到的那一句用 aria-live 播报，不弹提示，也不另存一份草稿。 */
function LiveText({ snapshot }: { snapshot: DemoSnapshot }): JSX.Element | null {
  const line =
    snapshot.partialTranscript.length > 0
      ? `正在听：${snapshot.partialTranscript}`
      : snapshot.transcript.length > 0
        ? `听到：${snapshot.transcript}`
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

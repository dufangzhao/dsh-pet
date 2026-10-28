import { useState, type JSX } from 'react';

import type { DemoSnapshot } from '@pet/contracts';

import { Button, Section, StatusBadge } from '@pet/ui-kit';

import { saveChoice } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { describeError } from '../copy.js';
import { demoPhase } from '../labels.js';
import { SettingsRow, SettingsRows } from '../settings-shell.js';
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
 * 写失败时这一行自然回到真实的值。录音会话只有 useDemo 那一份，切页不会关麦。
 */
export function VoicePage({ app, demo, notify, onGoToStart }: VoicePageProps): JSX.Element {
  const settings = useDemoSettings();
  const [saving, setSaving] = useState<string | null>(null);

  return (
    <ConsoleStatus
      loading={demo.loading}
      error={demo.error}
      available={demo.available}
      onRetry={demo.refresh}
    >
      {demo.snapshot === null ? null : (
        <>
          <Section title="语音输入" description="录音与识别都只在本机完成，不联网，也不自动发送。">
            <SettingsRows>
              {app.values === null ? null : (
                <SettingsRow
                  label="用语音说话"
                  description="关掉后仍然可以打字对话；录音入口会跟着收起来。"
                >
                  <label className="pk-choice">
                    <input
                      type="checkbox"
                      checked={app.values.voiceEnabled}
                      disabled={app.saving}
                      data-testid="pref-voice-enabled"
                      onChange={(event) =>
                        void saveChoice(app, notify, { voiceEnabled: event.target.checked })
                      }
                    />
                    {app.values.voiceEnabled ? '开着' : '关着'}
                  </label>
                </SettingsRow>
              )}
              <ModelRow
                snapshot={demo.snapshot}
                demo={demo}
                settings={settings}
                saving={saving}
                setSaving={setSaving}
                notify={notify}
              />
            </SettingsRows>
          </Section>

          <Section
            title="回复与发送"
            description="离线脚本演示不联网、不调用模型；真实 DeepSeek 用你自己的 Key。"
          >
            <SettingsRows>
              <ReplyRow
                snapshot={demo.snapshot}
                demo={demo}
                settings={settings}
                saving={saving}
                setSaving={setSaving}
                notify={notify}
              />
            </SettingsRows>
            {!demo.snapshot.keyConfigured ? (
              <div className="demo-check__actions">
                <Button
                  size="small"
                  variant="quiet"
                  data-testid="demo-go-start"
                  onClick={onGoToStart}
                >
                  去开始页填 Key
                </Button>
              </div>
            ) : null}
          </Section>

          <Section title="录音与识别" description="说完点「结束并识别」才开始识别。">
            <p className="demo-phase">
              <StatusBadge tone={demoPhase(demo.snapshot.phase).tone}>
                {demoPhase(demo.snapshot.phase).text}
              </StatusBadge>
            </p>
            <DemoRecorder demo={demo} />
            {demo.snapshot.error === null ? null : (
              <p className="config-banner config-banner--danger" role="alert">
                这次没有完成：{describeError(demo.snapshot.error)}
              </p>
            )}
          </Section>
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

/** 识别模型：值与可选项都来自宿主，读不到配置时如实说明并给出重试。 */
function ModelRow({ snapshot, demo, settings, saving, setSaving, notify }: RowProps): JSX.Element {
  const { asrOwner, asrRevision, modelId, readError } = snapshot.settings;
  const busy = settings.pending.has('asr');
  const blocked = asrOwner === null || readError !== null;
  const chosen = snapshot.models.find((model) => model.id === modelId) ?? null;

  const choose = async (id: string): Promise<void> => {
    setSaving(`model:${id}`);
    const outcome = await settings.saveAsrModel(asrOwner, asrRevision, id);
    demo.refresh();
    setSaving(null);
    // 选中本身就是回执：成功不弹全局提示，连点模型不会堆一串“已保存”。
    if (!outcome.ok) writeFailure(notify, outcome.error);
  };

  const state =
    readError !== null
      ? `读不到当前配置：${describeError(readError)}。刷新后可重试。`
      : asrOwner === null
        ? '本机还没有可写入的识别插件。'
        : modelId === null
          ? '还没选模型：文字对话不需要它，录音前先选一个。'
          : chosen === null
            ? `已选 ${modelId}，但它不在当前列表里。`
            : chosen.cached
              ? `已选 ${chosen.name} · 已在本机`
              : `已选 ${chosen.name} · 还没有下载`;

  return (
    <SettingsRow label="识别模型" labelFor="group" description={state}>
      {({ labelledBy }) => (
        <div className="pk-choices" role="radiogroup" aria-labelledby={labelledBy}>
          {snapshot.models.length === 0 ? (
            <span className="pk-draft-actions__state">还没有可用的识别模型。</span>
          ) : null}
          {snapshot.models.map((model) => (
            <label className="pk-choice" key={model.id}>
              <input
                type="radio"
                name="demo-asr-model"
                value={model.id}
                checked={modelId === model.id}
                disabled={blocked || busy || saving !== null}
                data-testid={`asr-model-${model.id}`}
                onChange={() => void choose(model.id)}
              />
              {model.name}
              {model.cached ? null : '（未下载）'}
              {model.streaming ? null : '（只整段）'}
            </label>
          ))}
        </div>
      )}
    </SettingsRow>
  );
}

/** 回复来源与说完之后的做法：两个都写同一份 voice 配置，一次写整个对象。 */
function ReplyRow({ snapshot, demo, settings, saving, setSaving, notify }: RowProps): JSX.Element {
  const { voiceOwner, voiceRevision, replyMode, autoSend, readError } = snapshot.settings;
  const busy = settings.pending.has('voice');
  const blocked = voiceOwner === null || readError !== null;
  const mode = replyMode ?? 'demo';

  const write = async (nextMode: 'demo' | 'deepseek', nextAuto: boolean): Promise<void> => {
    setSaving(nextMode);
    const outcome = await settings.saveVoice(voiceOwner, voiceRevision, nextMode, nextAuto);
    demo.refresh();
    setSaving(null);
    // 同上：这份配置是立即生效的，选项自己就是回执，只有失败才值得一条提示。
    if (!outcome.ok) writeFailure(notify, outcome.error);
  };

  return (
    <>
      <SettingsRow
        label="回复来源"
        labelFor="group"
        description={
          readError !== null
            ? `读不到当前设置：${describeError(readError)}。`
            : blocked
              ? '本机还没有可写入的回复设置。'
              : mode === 'deepseek'
                ? snapshot.keyConfigured
                  ? '真实 DeepSeek：已存有 Key（保存过不等于已验证）。'
                  : '选了真实 DeepSeek，但还没有 Key：选了也发不出去。'
                : '离线脚本演示（不是 AI）：不需要 Key，也不联网。'
        }
      >
        {({ labelledBy }) => (
          <div className="pk-choices" role="radiogroup" aria-labelledby={labelledBy}>
            <label className="pk-choice">
              <input
                type="radio"
                name="demo-reply-mode"
                value="demo"
                checked={mode === 'demo'}
                disabled={blocked || busy || saving !== null}
                data-testid="reply-mode-demo"
                onChange={() => void write('demo', autoSend)}
              />
              离线脚本演示，非 AI
            </label>
            <label className="pk-choice">
              <input
                type="radio"
                name="demo-reply-mode"
                value="deepseek"
                checked={mode === 'deepseek'}
                disabled={blocked || busy || saving !== null}
                data-testid="reply-mode-deepseek"
                onChange={() => void write('deepseek', autoSend)}
              />
              真实 DeepSeek
            </label>
          </div>
        )}
      </SettingsRow>

      <SettingsRow label="说完自动发送" description="不勾就停在识别结果上，等你确认后再发。">
        <label className="pk-choice">
          <input
            type="checkbox"
            checked={autoSend}
            disabled={blocked || busy || saving !== null}
            data-testid="demo-auto-send"
            onChange={(event) => void write(mode, event.target.checked)}
          />
          {autoSend ? '自动发送' : '等我确认'}
        </label>
      </SettingsRow>
    </>
  );
}

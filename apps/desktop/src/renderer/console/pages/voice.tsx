import type { DemoSnapshot } from '@pet/contracts';
import { useState, type JSX } from 'react';

import { Button, Section, StatusBadge } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import { describeError } from '../copy.js';
import type { DemoState } from '../use-demo.js';
import { useDemoSettings } from '../use-demo-settings.js';
import { DemoRecorder } from './demo-console.js';

export interface VoicePageProps {
  /** Demo 的阶段、模型与设置都来自宿主那一份快照。 */
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  /** 去模型页填 DeepSeek Key。 */
  onGoToModels: () => void;
}

/**
 * 语音输入页：本地识别模型、录音与识别、回复方式。
 *
 * 控件的值一律由宿主快照渲染，本机不另存一份"将要生效的值"：
 * 保存失败时界面自然回到真实的那一个，不会把没生效的选择显示成已生效。
 */
export function VoicePage({ demo, notify, onGoToModels }: VoicePageProps): JSX.Element {
  const settings = useDemoSettings();
  const [saving, setSaving] = useState<string | null>(null);
  const snapshot = demo.snapshot;

  return (
    <ConsolePane
      title="语音输入"
      summary="模型与回复方式都存在本机设置里，选完立即写入；不会自动启用插件，也不会调用付费服务。"
    >
      <ConsoleStatus
        loading={demo.loading}
        error={demo.error}
        available={demo.available}
        onRetry={demo.refresh}
      >
        {snapshot === null ? null : (
          <>
            <ModelSection
              snapshot={snapshot}
              demo={demo}
              settings={settings}
              saving={saving}
              setSaving={setSaving}
              notify={notify}
            />
            <Section
              title="录音与识别"
              description="说完点「结束并识别」才开始识别；录音与识别都只在本机完成。"
            >
              <DemoRecorder demo={demo} />
            </Section>
            <ReplySection
              snapshot={snapshot}
              demo={demo}
              settings={settings}
              saving={saving}
              setSaving={setSaving}
              notify={notify}
              onGoToModels={onGoToModels}
            />
          </>
        )}
      </ConsoleStatus>
    </ConsolePane>
  );
}

interface SectionProps {
  /** 由外层收敛过 null 的那一份宿主快照，控件的值只认它。 */
  snapshot: DemoSnapshot;
  demo: DemoState;
  settings: ReturnType<typeof useDemoSettings>;
  saving: string | null;
  setSaving: (value: string | null) => void;
  notify: (message: string, tone: 'ok' | 'danger') => void;
}

function writeFailure(notify: SectionProps['notify'], error: string | null): void {
  notify(`这个选择没有写进去：${error ?? '未知原因'}`, 'danger');
}

function ModelSection({
  snapshot,
  demo,
  settings,
  saving,
  setSaving,
  notify,
}: SectionProps): JSX.Element {
  const { asrOwner, asrRevision, modelId, readError } = snapshot.settings;
  const busy = settings.pending.has('asr');
  const blocked = asrOwner === null || readError !== null;

  const choose = async (id: string): Promise<void> => {
    setSaving(`model:${id}`);
    const outcome = await settings.saveAsrModel(asrOwner, asrRevision, id);
    demo.refresh();
    setSaving(null);
    if (outcome.ok) {
      notify(outcome.notice ?? '已保存所选模型。', 'ok');
    } else {
      writeFailure(notify, outcome.error);
    }
  };

  return (
    <Section
      title="本地识别模型"
      description="随应用发布的识别模型，标出来源、是否已下载、是否支持流式。"
    >
      {snapshot.models.length === 0 ? (
        <p className="console-muted">还没有可用的识别模型。</p>
      ) : (
        <fieldset className="preset-group">
          <legend className="preset-group__legend">识别模型</legend>
          <p className="plugin-row__hint">
            {modelId === null
              ? '还没选模型：文字对话不需要它，录音前请选一个。'
              : '已选 ' + (snapshot.models.find((item) => item.id === modelId)?.name ?? modelId)}
          </p>
          {readError !== null ? (
            <p className="plugin-row__hint">
              读不到当前配置：{describeError(readError)}。刷新后可重试。
            </p>
          ) : null}
          {asrOwner === null ? (
            <p className="plugin-row__hint">还没有识别插件，模型暂时没处可写。</p>
          ) : null}
          {snapshot.models.map((model) => (
            <label className="preset-option" key={model.id}>
              <input
                type="radio"
                className="preset-option__radio"
                name="demo-asr-model"
                value={model.id}
                checked={modelId === model.id}
                disabled={blocked || busy || saving !== null}
                data-testid={`asr-model-${model.id}`}
                onChange={() => void choose(model.id)}
              />
              <span className="preset-option__body">
                <span className="preset-option__label">
                  {model.name}
                  <StatusBadge tone={model.cached ? 'ok' : 'warn'}>
                    {model.cached ? '已下载' : '未下载'}
                  </StatusBadge>
                  <StatusBadge tone={model.streaming ? 'ok' : 'neutral'}>
                    {model.streaming ? '支持流式' : '只整段'}
                  </StatusBadge>
                </span>
                <span className="preset-option__text">
                  {`${model.source} · ${model.id}`}
                  {model.cached ? '' : ' · 选了还要先下载。'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Section>
  );
}

function ReplySection({
  snapshot,
  demo,
  settings,
  saving,
  setSaving,
  notify,
  onGoToModels,
}: SectionProps & { onGoToModels: () => void }): JSX.Element {
  const { voiceOwner, voiceRevision, replyMode, autoSend, readError } = snapshot.settings;
  const busy = settings.pending.has('voice');
  const blocked = voiceOwner === null || readError !== null;
  const mode = replyMode ?? 'demo';

  const write = async (nextMode: 'demo' | 'deepseek', nextAuto: boolean): Promise<void> => {
    setSaving(nextMode);
    const outcome = await settings.saveVoice(voiceOwner, voiceRevision, nextMode, nextAuto);
    demo.refresh();
    setSaving(null);
    if (outcome.ok) {
      notify(outcome.notice ?? '已保存回复方式。', 'ok');
    } else {
      writeFailure(notify, outcome.error);
    }
  };

  return (
    <Section
      title="回复方式"
      description="离线脚本演示不联网、不调用模型；真实 DeepSeek 要用你自己的 Key。"
    >
      <fieldset className="preset-group">
        <legend className="preset-group__legend">回复来源</legend>
        <label className="preset-option">
          <input
            type="radio"
            className="preset-option__radio"
            name="demo-reply-mode"
            value="demo"
            checked={mode === 'demo'}
            disabled={blocked || busy || saving !== null}
            data-testid="reply-mode-demo"
            onChange={() => void write('demo', autoSend)}
          />
          <span className="preset-option__body">
            <span className="preset-option__label">离线脚本演示，非 AI</span>
            <span className="preset-option__text">回复由本机脚本生成，不联网。</span>
          </span>
        </label>
        <label className="preset-option">
          <input
            type="radio"
            className="preset-option__radio"
            name="demo-reply-mode"
            value="deepseek"
            checked={mode === 'deepseek'}
            disabled={blocked || busy || saving !== null}
            data-testid="reply-mode-deepseek"
            onChange={() => void write('deepseek', autoSend)}
          />
          <span className="preset-option__body">
            <span className="preset-option__label">真实 DeepSeek</span>
            <span className="preset-option__text">
              用你的 Key 联网请求。
              {snapshot.keyConfigured
                ? '已存有 Key（保存过不等于已验证）。'
                : '还没有 Key：选了也发不出去。'}
            </span>
          </span>
        </label>
      </fieldset>

      <label className="pk-check demo-check">
        <input
          type="checkbox"
          checked={autoSend}
          disabled={blocked || busy || saving !== null}
          data-testid="demo-auto-send"
          onChange={(event) => void write(mode, event.target.checked)}
        />
        <span>说完自动发送（不勾就停在识别结果上，等你确认后再发）</span>
      </label>

      {!snapshot.keyConfigured ? (
        <div className="demo-check__actions">
          <Button size="small" variant="quiet" data-testid="demo-go-models" onClick={onGoToModels}>
            去模型页填 Key
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

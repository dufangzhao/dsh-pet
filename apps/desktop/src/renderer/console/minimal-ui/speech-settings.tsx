import { useId, useState, type JSX } from 'react';
import {
  SPEECH_OUTPUT_MAX_TEXT,
  SPEECH_OUTPUT_PLUGIN_IDS,
  type SpeechOutputFailureReason,
  type SpeechOutputProviderSelection,
  type SpeechOutputSnapshot,
} from '@pet/contracts';
import { describeError } from '../copy.js';
import { Button, Card, Field, Select, Status, Switch, type StatusTone } from './controls.js';
import { useSpeechOutput } from './use-speech-output.js';

const providerKey = (selection: SpeechOutputProviderSelection | null): string =>
  selection ? JSON.stringify([selection.pluginId, selection.instanceId, selection.providerId]) : '';
const failureText: Readonly<Record<SpeechOutputFailureReason, string>> = {
  'unsupported-platform': '当前系统不支持 Windows 系统朗读。',
  'voice-unavailable': '指定的语音不可用，请修改语音名称，或留空使用系统默认。',
  'synthesis-failed': '语音合成失败，请检查所选声音提供者后重试。',
  'audio-budget': '这段文字生成的音频过长，请用较短的文字试听。',
  'invalid-audio': '声音提供者返回的音频格式无法播放。',
  'playback-failed': '声音未能播放，请检查系统输出设备后重试。',
};
function phaseText(snapshot: SpeechOutputSnapshot | null): { text: string; tone: StatusTone } {
  if (!snapshot) return { text: '未读取', tone: 'muted' };
  if (snapshot.phase === 'error') return { text: '声音暂不可用', tone: 'danger' };
  if (snapshot.phase === 'synthesizing') return { text: '正在准备声音', tone: 'muted' };
  if (snapshot.phase === 'playing') return { text: '正在播放', tone: 'ok' };
  return snapshot.settings.enabled
    ? { text: '已开启', tone: 'muted' }
    : { text: '已关闭', tone: 'off' };
}

/** This panel edits consumer settings; provider modules are enabled from the plugin page. */
export function SpeechSettingsPanel(): JSX.Element {
  const form = useSpeechOutput();
  const [auditionText, setAuditionText] = useState('你好，我是小蓝。很高兴陪在你身边。');
  const voiceHintId = useId();
  const previewHintId = useId();
  const { snapshot, draft } = form;
  const phase = phaseText(snapshot);
  const selectedKey = providerKey(draft?.provider ?? null);
  const providers = snapshot?.providers ?? [];
  const selected = providers.find((provider) => providerKey(provider.selection) === selectedKey);
  const systemVoice = selected?.selection.pluginId === SPEECH_OUTPUT_PLUGIN_IDS.system;
  const options = providers.map((provider) => {
    const multiple = providers.some(
      (other) =>
        other !== provider &&
        other.selection.pluginId === provider.selection.pluginId &&
        other.selection.instanceId === provider.selection.instanceId,
    );
    return {
      value: providerKey(provider.selection),
      label:
        provider.name +
        (multiple ? ' / ' + provider.selection.providerId : '') +
        (provider.active ? '' : '（不可用）'),
    };
  });
  options.unshift({ value: '', label: '请选择声音提供者' });
  if (selectedKey && !selected)
    options.push({ value: selectedKey, label: '原先选择的提供者已不可用' });
  const editable = !!snapshot?.owner && !form.readError && !form.loading && !form.saving;
  const liveError = snapshot?.reason
    ? failureText[snapshot.reason]
    : snapshot?.error
      ? describeError(snapshot.error)
      : null;
  const auditionBlocked =
    !editable ||
    form.dirty ||
    form.conflict ||
    !snapshot?.settings.enabled ||
    !selected?.active ||
    !auditionText.trim();
  const canStop = !!snapshot?.current || (snapshot?.queued ?? 0) > 0 || form.auditioning;
  const voiceInvalid = !!draft?.voice && [...draft.voice.trim()].length > 256;
  return (
    <Card
      title="语音输出"
      id="speech-output-settings"
      action={
        <span role="status">
          <Status tone={phase.tone}>
            {form.loading ? '正在读取…' : phase.text}
            {snapshot?.queued ? '，排队 ' + snapshot.queued + ' 条' : ''}
          </Status>
        </span>
      }
    >
      {form.readError ? (
        <p className="field__error" role="alert">
          {form.readError}
        </p>
      ) : null}
      {!draft || !snapshot ? (
        <div className="card__foot">
          <Button onClick={form.reload} busy={form.loading} disabled={!form.available}>
            重新读取
          </Button>
          <Button
            onClick={() => {
              void form.stop();
            }}
            busy={form.stopping}
            disabled={!form.available}
          >
            停止播放
          </Button>
        </div>
      ) : (
        <form
          className="model-form"
          onSubmit={(event) => {
            event.preventDefault();
            void form.save();
          }}
        >
          <div className="rows rows--tight">
            <Switch
              label="朗读回复"
              checked={draft.enabled}
              disabled={!editable}
              data-testid="speech-output-enabled"
              onChange={(enabled) => form.edit({ enabled })}
            />
          </div>
          <Field label="声音提供者">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={selectedKey}
                options={options}
                disabled={!editable}
                data-testid="speech-output-provider"
                onChange={(event) => {
                  const provider = providers.find(
                    (item) => providerKey(item.selection) === event.target.value,
                  );
                  form.edit({ provider: provider ? { ...provider.selection } : null });
                }}
              />
            )}
          </Field>
          {!selected?.active ? (
            <p className="field__hint">
              {selectedKey
                ? '所选提供者当前不可用，请到插件页检查模块状态和权限。'
                : '请选择一个声音提供者；不会自动切换到其他声音。'}
            </p>
          ) : selected.kind === 'tones' ? (
            <p className="field__hint">
              桌宠音调用短音回应，不朗读文字；语音名称和语速用于朗读提供者。
            </p>
          ) : null}
          <Field
            label="语音名称"
            {...(voiceInvalid ? { error: '语音名称不能超过256个字符。' } : {})}
          >
            {({ inputId, describedBy, invalid }) => (
              <input
                id={inputId}
                className="input"
                type="text"
                value={draft.voice}
                maxLength={256}
                disabled={!editable || selected?.kind === 'tones'}
                placeholder={systemVoice ? '留空使用系统默认语音' : '留空使用提供者默认语音'}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid || undefined}
                aria-describedby={[describedBy, voiceHintId].filter(Boolean).join(' ')}
                data-testid="speech-output-voice"
                onChange={(event) => form.edit({ voice: event.target.value })}
              />
            )}
          </Field>
          <p id={voiceHintId} className="field__hint">
            {systemVoice
              ? 'Windows系统朗读可填写已安装的语音名称；留空使用系统默认语音。'
              : '语音名称由所选提供者识别；留空会请求它的默认语音。'}
          </p>
          <div className="field-row">
            <Field label={'语速（' + draft.rate + '）'} className="field--grow">
              {({ inputId }) => (
                <input
                  id={inputId}
                  className="input"
                  type="range"
                  min={-10}
                  max={10}
                  step={1}
                  value={draft.rate}
                  disabled={!editable || selected?.kind === 'tones'}
                  aria-valuetext={draft.rate === 0 ? '正常' : String(draft.rate)}
                  data-testid="speech-output-rate"
                  onChange={(event) => form.edit({ rate: Number(event.target.value) })}
                />
              )}
            </Field>
            <Field label={'音量（' + draft.volume + '%）'} className="field--grow">
              {({ inputId }) => (
                <input
                  id={inputId}
                  className="input"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.volume}
                  disabled={!editable}
                  aria-valuetext={draft.volume + '%'}
                  data-testid="speech-output-volume"
                  onChange={(event) => form.edit({ volume: Number(event.target.value) })}
                />
              )}
            </Field>
          </div>
          {form.conflict ? (
            <p className="field__error" role="alert">
              设置已被别处更新，草稿已保留。重新读取会替换这份草稿，请先记下需要保留的修改。
            </p>
          ) : null}
          {form.failure ? (
            <p className="field__error" role="alert">
              {form.failure}
            </p>
          ) : null}
          <div className="card__foot">
            <Button
              type="submit"
              variant="primary"
              busy={form.saving}
              disabled={!editable || !form.dirty || form.conflict || voiceInvalid}
              data-testid="speech-output-save"
            >
              {form.saving ? '正在保存…' : '保存语音设置'}
            </Button>
            <Button
              onClick={form.reload}
              disabled={form.saving || form.loading}
              data-testid="speech-output-reload"
            >
              {form.dirty || form.conflict ? '重新读取并放弃草稿' : '重新读取'}
            </Button>
            <Status>
              {form.dirty ? '有未保存的修改' : (form.notice ?? '新回复使用已保存的设置')}
            </Status>
          </div>
          <Field label="试听文字">
            {({ inputId }) => (
              <textarea
                id={inputId}
                className="input"
                rows={2}
                value={auditionText}
                maxLength={SPEECH_OUTPUT_MAX_TEXT}
                aria-describedby={previewHintId}
                data-testid="speech-output-audition-text"
                onChange={(event) => setAuditionText(event.target.value)}
              />
            )}
          </Field>
          <p id={previewHintId} className="field__hint">
            {form.dirty
              ? '保存后可试听这份设置。'
              : '试听使用已保存的设置，并从桌宠窗口播放；总音效关闭时不会发声。'}
          </p>
          <div className="card__foot">
            <Button
              onClick={() => {
                void form.audition(auditionText);
              }}
              busy={form.auditioning}
              disabled={auditionBlocked || form.stopping}
              data-testid="speech-output-audition"
            >
              试听
            </Button>
            <Button
              onClick={() => {
                void form.stop();
              }}
              busy={form.stopping}
              disabled={!form.available || !canStop}
              data-testid="speech-output-stop"
            >
              停止播放
            </Button>
          </div>
          {liveError ? (
            <p className="field__error" role="alert" data-testid="speech-output-error">
              {liveError}
            </p>
          ) : null}
        </form>
      )}
    </Card>
  );
}

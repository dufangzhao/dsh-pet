import { useId, useState, type JSX } from 'react';
import {
  APPLICATION_DEFAULTS,
  SPEECH_FEATURE_PLUGIN_ID,
  type DesktopSpeechState,
  type SpeechReason,
  type SpeechView,
} from '@pet/contracts';
import { describeError } from '../copy.js';
import { Button, Card, Field, Select, Status, type StatusTone } from './controls.js';
import { useSharedSpeech } from './use-shared-speech.js';
import {
  adoptVolume,
  commitVolume,
  editVolume,
  EMPTY_VOLUME,
  volumeFacts,
} from './volume-draft.js';
import type { CompanionView } from '../../shared/use-companion.js';
import type { LocalPresentationView } from '../../shared/use-local-presentation.js';

const reasonText: Readonly<Record<SpeechReason, string>> = {
  'feature-disabled': '语音输出插件未启用。',
  'provider-disabled': '语音提供者当前不可用。',
  'source-unavailable': '这台机器没有可用的语音播放源。',
  'model-unconfigured': '还没有选择语音模型。',
  'key-required': '需要服务操作员写入语音密钥。',
  'unsupported-protocol': '该模型不支持普通 MiMo 流式朗读。',
  'cleanup-pending': '上一段音频还在释放，暂时不能开始。',
  'invalid-stream': '提供者返回的音频流无法播放。',
  'partial-output': '这段回复没有读完。',
  'remote-unknown': '远端结果未知，不会自动重试。',
  'playback-failed': '声音未能播放。',
  'quota-exceeded': '这一段没能排上，队列已满。',
};

/** 播放阶段只说事实：ready 不是 playing，released 不是"听到了"。 */
function phaseText(state: DesktopSpeechState | null): { text: string; tone: StatusTone } {
  if (state === null) return { text: '未读取', tone: 'muted' };
  switch (state.phase) {
    case 'baselining':
      return { text: '正在对齐新消息', tone: 'muted' };
    case 'preparing':
      return { text: '正在准备声音', tone: 'muted' };
    case 'streaming':
      return state.playing
        ? { text: '正在朗读', tone: 'ok' }
        : { text: '正在接收声音', tone: 'muted' };
    case 'stopping':
      return { text: '正在停止', tone: 'warn' };
    case 'terminal':
      return state.outcome === 'completed'
        ? { text: '已读完', tone: 'ok' }
        : state.outcome === 'cancelled'
          ? { text: '已停止', tone: 'off' }
          : { text: '这一条未完成', tone: 'danger' };
    default:
      return state.generating
        ? { text: '正在生成', tone: 'muted' }
        : { text: '待机', tone: 'muted' };
  }
}

const featureSourceText = (speech: SpeechView | null): string => {
  if (speech === null) return '未读到远端语音设置。';
  switch (speech.feature.source) {
    case 'ready':
      return '服务端语音源已就绪。';
    case 'disabled':
      return '服务端语音源未启用。';
    default:
      return '服务端语音源不可用。';
  }
};

/**
 * 语音输出卡片：本机 source 启停（走插件页）、远端 provider 表单、真实播放状态与停止。
 *
 * 本机启用/停用不在这个卡片里造第二个开关——`pet.speech-output` 的生命周期由插件页
 * 的 enable/disable 表达，这里只如实说明当前状态并给一个入口。
 */
export function SharedSpeechSettings({
  companion,
  presentation,
  onOpenPlugins,
}: {
  companion: CompanionView;
  presentation: LocalPresentationView;
  onOpenPlugins?: () => void;
}): JSX.Element {
  const form = useSharedSpeech(companion);
  const voiceHintId = useId();
  const { state, speech, draft, provider } = form;
  const phase = phaseText(state);
  // 表单必须真的属于当前配置目标：换目标后、新配置读回来之前，旧表单不可编辑。
  const target = companion.state?.connectionId ?? null;
  const ownedByTarget = form.owner !== null && form.owner.connectionId === target;
  const editable =
    !!draft &&
    ownedByTarget &&
    !form.readError &&
    !form.loading &&
    !form.saving &&
    !form.conflict &&
    form.available;
  const localSource = state?.source ?? null;
  const liveError = state?.reason
    ? reasonText[state.reason]
    : state?.error
      ? describeError(state.error)
      : form.failure;

  const sourceLine =
    localSource === 'ready'
      ? '本机语音播放源已启用。'
      : localSource === 'disabled'
        ? '本机语音播放源未启用；在插件页启用后才会朗读。'
        : '本机语音播放源不可用。';

  return (
    <Card
      title="语音输出"
      id="shared-speech-settings"
      action={
        <span role="status">
          <Status tone={phase.tone}>
            {form.loading ? '正在读取…' : phase.text}
            {state !== null && state.queued > 0 ? '，排队 ' + state.queued + ' 条' : ''}
          </Status>
        </span>
      }
    >
      <p className="row__value" data-testid="shared-speech-source">
        {sourceLine}
      </p>
      <p className="row__value" data-testid="shared-speech-feature">
        {featureSourceText(speech)}
      </p>
      {onOpenPlugins === undefined ? null : (
        <div className="card__foot">
          <Button data-testid="shared-speech-plugins" onClick={onOpenPlugins}>
            管理 {SPEECH_FEATURE_PLUGIN_ID}
          </Button>
          <Status>启用或停用是插件级操作，不在这一页另存一个开关。</Status>
        </div>
      )}

      {form.readError !== null ? (
        <p className="field__error" role="alert">
          {form.readError}
        </p>
      ) : null}

      {draft === null ? (
        <div className="card__foot">
          <Button onClick={form.reload} busy={form.loading} disabled={!form.available}>
            重新读取
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
          <Field label="网关地址">
            {({ inputId }) => (
              <input
                id={inputId}
                className="input"
                type="url"
                value={draft.baseUrl}
                maxLength={2048}
                disabled={!editable}
                autoComplete="off"
                spellCheck={false}
                data-testid="shared-speech-base-url"
                onChange={(event) => form.edit({ baseUrl: event.target.value })}
              />
            )}
          </Field>
          <Field label="模型">
            {({ inputId }) => (
              <input
                id={inputId}
                className="input"
                type="text"
                value={draft.modelRef}
                maxLength={128}
                disabled={!editable}
                autoComplete="off"
                spellCheck={false}
                placeholder="普通 MiMo TTS 模型 ID"
                data-testid="shared-speech-model"
                onChange={(event) => form.edit({ modelRef: event.target.value })}
              />
            )}
          </Field>
          <Field label="鉴权方式">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.authMode}
                disabled={!editable}
                data-testid="shared-speech-auth"
                options={[
                  { value: 'local-client-id', label: '本机 client id' },
                  { value: 'gateway-key', label: '网关密钥' },
                ]}
                onChange={(event) =>
                  form.edit({ authMode: event.target.value as 'local-client-id' | 'gateway-key' })
                }
              />
            )}
          </Field>
          <Field label="音色">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={draft.voice}
                disabled={!editable}
                data-testid="shared-speech-voice"
                options={form.voices.map((voice) => ({ value: voice, label: voice }))}
                onChange={(event) => form.edit({ voice: event.target.value as typeof draft.voice })}
              />
            )}
          </Field>
          <p id={voiceHintId} className="field__hint">
            只列普通 MiMo 的预置音色；`mimo_default` 由集群决定，建议选具体音色。
          </p>

          {provider?.credential.writable === true ? (
            <p className="field__hint">这台机器可以写入语音密钥。</p>
          ) : (
            <p className="field__hint">语音密钥由服务操作员写入，这里不提供输入框。</p>
          )}

          {form.conflict ? (
            <p className="field__error" role="alert">
              设置已被别处更新，草稿已保留。重新读取会替换这份草稿。
            </p>
          ) : null}
          {liveError !== null ? (
            <p className="field__error" role="alert" data-testid="shared-speech-error">
              {liveError}
            </p>
          ) : null}
          {form.notice === null ? null : (
            <p className="row__value" role="status">
              {form.notice}
            </p>
          )}

          <div className="card__foot">
            <Button
              type="submit"
              variant="primary"
              busy={form.saving}
              disabled={!editable || !form.dirty}
              data-testid="shared-speech-save"
            >
              {form.saving ? '正在保存…' : '保存语音提供者'}
            </Button>
            <Button
              onClick={form.reload}
              disabled={form.saving || form.loading}
              data-testid="shared-speech-reload"
            >
              {form.dirty || form.conflict ? '重新读取并放弃草稿' : '重新读取'}
            </Button>
            <Button
              onClick={() => {
                void form.readCatalog();
              }}
              busy={form.readingCatalog}
              disabled={
                !form.available ||
                !ownedByTarget ||
                provider === null ||
                provider.bindingId === null
              }
              data-testid="shared-speech-catalog"
            >
              读取目录
            </Button>
            <Button
              onClick={() => {
                void form.stop();
              }}
              busy={form.stopping}
              disabled={
                !form.available ||
                state === null ||
                (state.phase === 'idle' && !state.generating && !state.playing)
              }
              data-testid="shared-speech-stop"
            >
              停止朗读
            </Button>
          </div>
          <Status>{form.dirty ? '有未保存的修改' : '新回复使用已保存的设置'}</Status>
        </form>
      )}

      <LocalVolumeRow presentation={presentation} />

      {state === null ? null : (
        <p className="row__value" data-testid="shared-speech-facts">
          {state.generating ? '正在生成声音' : '未在生成'}
          {' · '}
          {state.playing ? '设备在播放' : '设备未播放'}
          {' · '}
          已结束 {state.endedFrames} 帧
        </p>
      )}
    </Card>
  );
}

/**
 * 本机音量：属本机 presentation，走它自己的 CAS 与保存按钮，
 * 与上面那份远端 provider 草稿互不覆盖。
 *
 * 音量在 start 时冻结进这一次朗读；要立刻安静用"停止朗读"，改音量不会掐断正在播的。
 */
function LocalVolumeRow({ presentation }: { presentation: LocalPresentationView }): JSX.Element {
  const id = useId();
  const revision = presentation.snapshot?.revision ?? null;
  const stored =
    presentation.snapshot?.preferences?.speechVolume ?? APPLICATION_DEFAULTS.speechVolume;
  /**
   * 草稿与它读到的基线绑定：外部保存改了 stored，不能把用户没保存的输入抹掉。
   * 只有我们自己保存成功、或用户显式"采用最新值"时才 rebase。
   */
  const [volume, setVolume] = useState(EMPTY_VOLUME);
  // 只有用户真的动过滑杆才算草稿；没动过就一直跟随已存值。
  const facts = volumeFacts(volume, stored, revision);
  const draft = facts.value;
  const editable = presentation.snapshot !== null && !presentation.saving;

  return (
    <div className="card__foot" data-testid="shared-speech-local-volume">
      <div className="field field--grow">
        <label className="field__label" htmlFor={id}>
          {'本机音量（' + draft + '%）'}
        </label>
        <input
          id={id}
          className="input"
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft}
          disabled={!editable}
          aria-valuetext={draft + '%'}
          data-testid="shared-speech-volume"
          onChange={(event) =>
            setVolume((state) => editVolume(state, revision, Number(event.target.value)))
          }
        />
      </div>
      <Button
        busy={presentation.saving}
        disabled={!editable || !facts.dirty || facts.externalChange}
        data-testid="shared-speech-volume-save"
        onClick={() => {
          if (facts.expectedRevision === null) return;
          // 用**捕获的**基线提交：不借最新 revision 覆盖别处的更新。
          void presentation.save({ speechVolume: draft }, facts.expectedRevision).then((ok) => {
            if (ok) setVolume(commitVolume());
          });
        }}
      >
        保存本机音量
      </Button>
      {facts.externalChange ? (
        <Button data-testid="shared-speech-volume-rebase" onClick={() => setVolume(adoptVolume())}>
          采用最新音量
        </Button>
      ) : null}
      <Status>
        {facts.externalChange
          ? '音量已被别处更新；你的修改还在，采用最新值会放弃它。'
          : facts.dirty
            ? '有未保存的音量修改'
            : '音量在每次朗读开始时冻结；要立刻安静请用停止朗读。'}
      </Status>
    </div>
  );
}

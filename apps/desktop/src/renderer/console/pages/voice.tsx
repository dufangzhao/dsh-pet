import { useId, useState, type JSX } from 'react';
import {
  TALK_KEYS,
  VOICE_INPUT_CLOUD_ORIGINS,
  voiceInputModel,
  type DemoSnapshot,
  type VoiceInputSettings,
} from '@pet/contracts';
import { ConsoleStatus } from '../console-status.js';
import { describeError } from '../copy.js';
import { demoPhase } from '../labels.js';
import {
  Button,
  Card,
  Field,
  Select as NativeSelect,
  Status,
  Switch,
} from '../minimal-ui/controls.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { useDemoSettings } from '../use-demo-settings.js';
import { useVoiceInput } from '../use-voice-input.js';
import { DemoRecorder } from './demo-console.js';
export interface VoicePageProps {
  app: ApplicationState;
  demo: DemoState;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  onGoToStart: () => void;
}
/** The draft keeps its inspected revision while device and download snapshots update. */
export function VoicePage({ app, demo, notify, onGoToStart }: VoicePageProps): JSX.Element {
  const voice = useVoiceInput(),
    legacy = useDemoSettings();
  const [draft, setDraft] = useState<{ revision: number; data: VoiceInputSettings } | null>(null);
  const [key, setKey] = useState(''),
    [touched, setTouched] = useState({ url: false, model: false });
  const stored = voice.snapshot,
    values = draft?.data ?? stored?.settings ?? null;
  const levelId = useId();
  const urlIssue = values ? cloudUrlError(values.cloudBaseUrl) : null;
  const modelIssue =
    values && !/^[a-zA-Z0-9._:/-]{1,128}$/.test(values.cloudModel)
      ? '请输入有效的转写模型名称'
      : null;
  const edit = <K extends keyof VoiceInputSettings>(
    name: K,
    value: VoiceInputSettings[K],
  ): void => {
    if (!stored) return;
    setDraft((current) => ({
      revision: current?.revision ?? stored.revision,
      data: {
        ...(current?.data ?? stored.settings),
        [name]: value,
        ...(name === 'talkKeyCode' ? { talkKeyLabel: TALK_KEYS[String(value)]?.label ?? '' } : {}),
      },
    }));
  };
  const save = async (): Promise<void> => {
    if (!draft) return;
    setTouched({ url: true, model: true });
    if (urlIssue || modelIssue) return;
    const result = await voice.saveSettings(draft.data, draft.revision);
    if (result.ok) {
      setDraft(null);
      notify('语音设置已保存。', 'ok');
      demo.refresh();
    } else notify(result.error ?? '语音设置没有保存。', 'danger');
  };
  const setEnabled = async (enabled: boolean): Promise<void> => {
    const result = await (enabled ? voice.start() : voice.stop());
    demo.refresh();
    if (!result.ok) notify(result.error ?? '语音输入没有切换。', 'danger');
  };
  const saveKey = async (value: string): Promise<void> => {
    const result = await voice.saveApiKey(value);
    if (result.ok) {
      setKey('');
      notify(value ? 'API Key 已保存。' : 'API Key 已移除。', 'ok');
    } else notify(result.error ?? 'API Key 操作没有完成。', 'danger');
  };
  const microphoneOptions = [
    { value: '', label: '跟随系统默认' },
    ...voice.microphones.map((device) => ({ value: device.id, label: device.label })),
  ];
  if (
    values?.microphoneId &&
    !microphoneOptions.some((device) => device.value === values.microphoneId)
  )
    microphoneOptions.push({ value: values.microphoneId, label: '已选设备当前不可用' });
  const selected = stored?.engines.find((engine) => engine.id === values?.engine);
  const model = values
    ? stored?.models.find((model) => model.id === voiceInputModel(values.engine))
    : null;
  const local = values?.engine === 'sensevoice' || values?.engine === 'whisper-small';
  const download = stored?.download?.modelId === model?.id ? stored?.download : null;
  const error = voice.error ?? (stored?.error ? describeError(stored.error) : null);
  const changedElsewhere = draft !== null && stored !== null && draft.revision !== stored.revision;
  return (
    <>
      <ConsoleStatus
        available={voice.available}
        loading={voice.loading && stored === null}
        error={stored === null ? voice.error : null}
        onRetry={voice.refresh}
      >
        {stored && values ? (
          <>
            <Card
              title="语音输入"
              action={
                <Status tone={stored.talkKeyActive ? 'ok' : 'muted'}>
                  {stored.talkKeyActive ? '说话键已启用' : '说话键未启动'}
                </Status>
              }
            >
              {app.values ? (
                <Switch
                  label="用语音说话"
                  checked={app.values.voiceEnabled}
                  disabled={app.saving || (!app.values.voiceEnabled && voice.busy)}
                  data-testid="pref-voice-enabled"
                  onChange={(next) => void setEnabled(next)}
                />
              ) : null}
              {app.values?.voiceEnabled && !stored.talkKeyActive ? (
                <div className="card__foot">
                  <Button
                    busy={voice.busy}
                    data-testid="voice-start"
                    onClick={() => void setEnabled(true)}
                  >
                    启动语音输入
                  </Button>
                </div>
              ) : null}
              {error ? (
                <p role="alert">
                  <Status tone="danger">{error}</Status>
                </p>
              ) : null}
              <div className="field-row">
                <Field label="识别引擎" className="field--grow">
                  {({ inputId }) => (
                    <NativeSelect
                      id={inputId}
                      value={values.engine}
                      disabled={voice.busy}
                      data-testid="voice-engine"
                      options={stored.engines.map((engine) => ({
                        value: engine.id,
                        label: engine.label,
                      }))}
                      onChange={(event) =>
                        edit('engine', event.target.value as VoiceInputSettings['engine'])
                      }
                    />
                  )}
                </Field>
                <Field label="说话键" className="field--grow">
                  {({ inputId }) => (
                    <NativeSelect
                      id={inputId}
                      value={values.talkKeyCode}
                      disabled={voice.busy}
                      data-testid="voice-talk-key"
                      options={Object.entries(TALK_KEYS).map(([value, key]) => ({
                        value,
                        label: key.label,
                      }))}
                      onChange={(event) => edit('talkKeyCode', event.target.value)}
                    />
                  )}
                </Field>
              </div>
              {selected?.reason ? (
                <p className="row__value" role="status">
                  {selected.reason}
                </p>
              ) : null}
              <p className="row__value">
                按下立即开始；按住 250 ms 后松开结束。轻按后继续录音，下一次按下结束。
              </p>
              <div className="field-row">
                <Field label="麦克风" className="field--grow">
                  {({ inputId }) => (
                    <NativeSelect
                      id={inputId}
                      value={values.microphoneId}
                      disabled={voice.busy}
                      data-testid="voice-microphone"
                      options={microphoneOptions}
                      onChange={(event) => edit('microphoneId', event.target.value)}
                    />
                  )}
                </Field>
                <Button
                  disabled={voice.busy}
                  data-testid="voice-refresh-microphones"
                  onClick={() => void voice.refreshMicrophones()}
                >
                  刷新设备
                </Button>
              </div>
              {voice.microphoneError ? (
                <p role="alert">{voice.microphoneError}</p>
              ) : voice.microphones.length === 0 ? (
                <p className="row__value">
                  尚未取得可选择的麦克风信息。开始一次录音授权后，可刷新设备列表。
                </p>
              ) : null}
              {local && model ? (
                <div className="rows">
                  <div className="row">
                    <span className="row__text">
                      <span className="row__label">{model.label}</span>
                      <span className="row__desc">
                        {(model.bytes / 1000000).toFixed(1)} MB；
                        {model.cached ? '文件已缓存，启动时校验' : '尚未下载'}
                      </span>
                    </span>
                    {!model.cached ? (
                      <Button
                        disabled={voice.busy || download?.state === 'downloading'}
                        data-testid="voice-install-model"
                        onClick={() => void voice.installModel(model.id)}
                      >
                        {download?.state === 'downloading' ? '正在下载…' : '下载模型'}
                      </Button>
                    ) : (
                      <Status tone="ok">已在本机</Status>
                    )}
                  </div>
                  {download ? (
                    <p className="row__value" role="status">
                      {download.state === 'downloading' ? (
                        <>
                          <progress
                            value={download.receivedBytes}
                            max={download.totalBytes}
                            aria-label="模型下载进度"
                          />{' '}
                          {(download.receivedBytes / 1000000).toFixed(1)} /{' '}
                          {(download.totalBytes / 1000000).toFixed(1)} MB
                        </>
                      ) : download.state === 'error' ? (
                        '下载没有完成：' +
                        (download.error ? describeError(download.error) : '当前不可用')
                      ) : (
                        '模型已下载并校验。'
                      )}
                    </p>
                  ) : null}
                </div>
              ) : values.engine === 'windows-sapi' ? (
                <p className="row__value">
                  使用 Windows 已安装的语音识别器，无需下载应用模型。与其他引擎共用上面的麦克风。
                </p>
              ) : null}
              {values.engine === 'openai' ? (
                <>
                  <div className="field-row">
                    <Field
                      label="兼容 API 地址"
                      className="field--grow"
                      {...(touched.url && urlIssue ? { error: urlIssue } : {})}
                    >
                      {({ inputId, describedBy, invalid }) => (
                        <input
                          id={inputId}
                          className="input"
                          type="url"
                          value={values.cloudBaseUrl}
                          aria-describedby={describedBy}
                          aria-invalid={invalid}
                          maxLength={512}
                          spellCheck={false}
                          autoComplete="off"
                          disabled={voice.busy}
                          data-testid="voice-api-url"
                          onBlur={() => setTouched((current) => ({ ...current, url: true }))}
                          onChange={(event) => edit('cloudBaseUrl', event.target.value)}
                        />
                      )}
                    </Field>
                    <Field
                      label="转写模型"
                      className="field--grow"
                      {...(touched.model && modelIssue ? { error: modelIssue } : {})}
                    >
                      {({ inputId, describedBy, invalid }) => (
                        <input
                          id={inputId}
                          className="input"
                          value={values.cloudModel}
                          aria-describedby={describedBy}
                          aria-invalid={invalid}
                          maxLength={128}
                          spellCheck={false}
                          autoComplete="off"
                          disabled={voice.busy}
                          data-testid="voice-api-model"
                          onBlur={() => setTouched((current) => ({ ...current, model: true }))}
                          onChange={(event) => edit('cloudModel', event.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <p className="row__value">
                    支持 OpenAI、Groq 和硅基流动的已声明 HTTPS 地址；录音完成后才会调用转写接口。
                  </p>
                  <Field label="API Key">
                    {({ inputId }) => (
                      <input
                        id={inputId}
                        className="input"
                        type="password"
                        value={key}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={4096}
                        disabled={voice.busy || !stored.credentialStorageAvailable}
                        data-testid="voice-api-key"
                        onChange={(event) => setKey(event.target.value)}
                      />
                    )}
                  </Field>
                  <div className="card__foot">
                    <Button
                      disabled={voice.busy || !key.trim() || !stored.credentialStorageAvailable}
                      data-testid="voice-save-key"
                      onClick={() => void saveKey(key)}
                    >
                      保存 Key
                    </Button>
                    {stored.keyConfigured ? (
                      <Button disabled={voice.busy} onClick={() => void saveKey('')}>
                        移除 Key
                      </Button>
                    ) : null}
                    <span className="row__value">
                      {!stored.credentialStorageAvailable
                        ? '系统凭据存储不可用'
                        : stored.keyConfigured
                          ? '已保存 Key；尚未验证转写连接'
                          : '尚未保存 Key'}
                    </span>
                  </div>
                </>
              ) : null}
              {changedElsewhere ? (
                <p role="alert">本机设置已被更新；你的草稿仍保留。重新读取后再保存。</p>
              ) : null}
              <div className="card__foot">
                <Button
                  variant="primary"
                  disabled={!draft || voice.busy || !!urlIssue || !!modelIssue}
                  busy={voice.busy && draft !== null}
                  data-testid="voice-save-settings"
                  onClick={() => void save()}
                >
                  保存语音设置
                </Button>
                <Button
                  disabled={voice.busy}
                  data-testid="voice-reload-settings"
                  onClick={() => {
                    setDraft(null);
                    setTouched({ url: false, model: false });
                    voice.refresh();
                  }}
                >
                  重新读取
                </Button>
                {draft ? <span className="row__value">有未保存的修改</span> : null}
              </div>
            </Card>
          </>
        ) : null}
      </ConsoleStatus>
      <Card
        title="录音与识别"
        action={demo.snapshot ? <Status>{demoPhase(demo.snapshot.phase).text}</Status> : undefined}
      >
        <DemoRecorder demo={demo} />
        <p className="row__value" role="status">
          {demo.snapshot?.phase === 'recording'
            ? '正在使用选定的麦克风'
            : demo.recording
              ? '正在准备麦克风'
              : '点击开始录音，检查麦克风与识别结果。'}
        </p>
        {typeof demo.level === 'number' ? (
          <div className="row">
            <label htmlFor={levelId}>输入电平</label>
            <meter
              id={levelId}
              min={0}
              max={1}
              value={demo.level}
              data-testid="voice-input-level"
            />
          </div>
        ) : demo.recording ? (
          <p className="row__value">尚未收到麦克风电平。</p>
        ) : null}
        {demo.snapshot ? (
          <>
            <LiveText snapshot={demo.snapshot} />
            {demo.snapshot.error ? (
              <p role="alert">
                <Status tone="danger">{describeError(demo.snapshot.error)}</Status>
              </p>
            ) : null}
          </>
        ) : null}
      </Card>
      {demo.snapshot ? (
        <Card title="识别后">
          <Switch
            label="说完自动发送"
            checked={demo.snapshot.settings.autoSend}
            disabled={legacy.pending.has('voice') || demo.snapshot.settings.readError !== null}
            data-testid="demo-auto-send"
            onChange={(next) => {
              const settings = demo.snapshot?.settings;
              if (!settings) return;
              void legacy
                .saveVoice(
                  settings.voiceOwner,
                  settings.voiceRevision,
                  settings.replyMode ?? 'demo',
                  next,
                )
                .then((result) => {
                  demo.refresh();
                  if (!result.ok) notify(result.error ?? '设置没有保存。', 'danger');
                });
            }}
          />
          <p className="row__value">
            {demo.snapshot.settings.replyMode === 'deepseek'
              ? '回复使用开始页所选的模型服务。'
              : '当前使用离线脚本演示回复。'}
          </p>
          <Button onClick={onGoToStart}>设置回复来源</Button>
        </Card>
      ) : null}
    </>
  );
}
function cloudUrlError(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '请输入完整的 HTTPS API 地址';
  }
  return url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !VOICE_INPUT_CLOUD_ORIGINS.some((origin) => origin === url.origin)
    ? '此地址尚未获得转写插件的网络授权；可使用 OpenAI、Groq 或硅基流动地址。'
    : null;
}
function LiveText({ snapshot }: { snapshot: DemoSnapshot }): JSX.Element | null {
  const text = snapshot.partialTranscript || snapshot.transcript;
  return text ? (
    <p className="row__value" role="status" aria-live="polite">
      {snapshot.partialTranscript ? '正在识别：' : '听到：'}
      {text}
    </p>
  ) : null;
}

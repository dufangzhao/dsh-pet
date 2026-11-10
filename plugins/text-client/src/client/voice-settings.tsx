/**
 * 语音设置：只读语音自己的视图，不复用文字模型表单。
 *
 * 与文字模型设置分开的原因很具体：语音的提供者、模型、鉴权方式是它自己的一份
 * 配置，保存它不该改文字连接、不该重建 Core、也不该结束已经受理的工作。所以
 * 这里读 `VoiceView`，只写 `providerRef`/`finishMode`/`settings`，密钥输入只在
 * 宿主说 `writable` 时出现。
 *
 * 模型目录是显式的一步：只读**已保存**绑定的网关与鉴权，候选的可选性完全照抄
 * 后端的 `selectable`/`reason`；选中只改草稿，保存仍然由主人按。
 *
 * 桌面端 `credential.writable` 恒为 false：密钥由运维在服务侧写入，渲染器没有
 * 那条通道，因此这里连密码框都不画。
 */
import { useRef, useState, type JSX } from 'react';
import { Button, Dialog, Field } from '@pet/ui-kit';
import type {
  VoiceAsrSettings,
  VoiceCandidate,
  VoiceCatalog,
  VoiceFinishMode,
  VoiceView,
} from '@pet/contracts';

/** 保存后回读的那份视图：用它把草稿对齐到服务端规范化后的值。 */
export interface VoiceSaveOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly view?: VoiceView | null;
}

/** 目录读取的结果：失败时没有候选，绝不返回一份空的成功。 */
export type VoiceCatalogRead =
  | { readonly ok: true; readonly catalog: VoiceCatalog }
  | { readonly ok: false; readonly error: string };

export interface VoiceSettingsActions {
  /** 保存功能级偏好（providerRef + finishMode），用读到的 revision 做 CAS。 */
  saveFeature(command: {
    expectedRevision: number;
    providerRef: string;
    finishMode: VoiceFinishMode;
  }): Promise<VoiceSaveOutcome>;
  /** 保存提供者设置；空 modelRef 也合法，只表示「还没选」。 */
  saveProvider(command: {
    providerRef: string;
    expectedRevision: number;
    settings: VoiceAsrSettings;
  }): Promise<VoiceSaveOutcome>;
  /**
   * 读取已保存绑定的 ASR 目录。只读当前 binding，不接受草稿里的新地址；
   * 桌面端这条桥同样存在（只读，不含密钥）。
   */
  readCatalog?(input: { providerRef: string; bindingId: string }): Promise<VoiceCatalogRead>;
  /** 只在 credential.writable 为 true 时存在。 */
  writeCredential?(command: {
    providerRef: string;
    expectedRevision: number;
    expectedCredentialVersion: string;
    value: string | null;
  }): Promise<VoiceSaveOutcome>;
}

export interface VoiceSettingsProps {
  readonly open: boolean;
  readonly view: VoiceView | null;
  readonly live: boolean;
  readonly actions: VoiceSettingsActions | null;
  readonly onClose: () => void;
}

const AUTH_LABELS: Readonly<Record<VoiceAsrSettings['authMode'], string>> = {
  'local-client-id': '本机标识（仅回环）',
  'gateway-key': '网关密钥',
};

/**
 * 候选文案只复述后端给的事实：能不能选、为什么不能选都由 projector 决定，
 * 这里不按名字再判一次 ASR。
 */
function candidateOption(candidate: VoiceCandidate): string {
  const facts = `${candidate.label} · ${candidate.modelRef}`;
  if (candidate.selectable) return facts;
  return candidate.reason === 'unsupported-protocol'
    ? `${facts}（本版本不支持该协议）`
    : `${facts}（不可选）`;
}

type CatalogState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'reading' }
  | { readonly phase: 'failed'; readonly error: string }
  | { readonly phase: 'ready'; readonly catalog: VoiceCatalog };

const IDLE_CATALOG: CatalogState = { phase: 'idle' };

/** 视图里的模型候选只有这里用到；空模型是「还没选」，不是「随便挑一个」。 */
export function VoiceSettings({
  open,
  view,
  live,
  actions,
  onClose,
}: VoiceSettingsProps): JSX.Element {
  const [providerRef, setProviderRef] = useState('');
  const [finishMode, setFinishMode] = useState<VoiceFinishMode>('send');
  const [settings, setSettings] = useState<VoiceAsrSettings | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<VoiceView | null>(null);
  const [seeded, setSeeded] = useState(false);
  const generation = useRef(0);
  /** 目录结果连同它读的那份绑定一起存：别的绑定的结果不能填这个选择框。 */
  const [catalog, setCatalog] = useState<CatalogState>(IDLE_CATALOG);
  /** 只采纳最近一次读取：重置、换提供者、再读一次都会换代。 */
  const catalogRequest = useRef(0);

  /**
   * 每次打开都从已读视图重新起稿：关掉再开不该带着上一轮未保存的编辑。
   *
   * 在渲染里做而不是 effect 里：首帧就要显示真实设置，否则静态渲染和第一帧
   * 会先铺一个空表单，看着像「什么都没读到」。打开之后后台再刷新 revision
   * 也不会覆盖用户正在改的内容——那正是契约要求的。
   */
  if (!open && seeded) {
    generation.current += 1;
    setSeeded(false);
    setKey('');
  }
  if (open && !seeded && view !== null) {
    generation.current += 1;
    setSeeded(true);
    setBaseline(view);
    setBusy(false);
    setProviderRef(view.feature.providerRef);
    setFinishMode(view.feature.finishMode);
    setSettings(
      view.providers.find((item) => item.providerRef === view.feature.providerRef)?.settings ??
        null,
    );
    setKey('');
    setNotice(null);
    catalogRequest.current += 1;
    setCatalog(IDLE_CATALOG);
  }

  const provider =
    view === null
      ? null
      : (view.providers.find((item) => item.providerRef === providerRef) ?? null);
  const providerBaseline = baseline?.providers.find((item) => item.providerRef === providerRef);
  const disabled =
    !live || actions === null || busy || provider === null || providerBaseline === undefined;

  const resetCatalog = (): void => {
    catalogRequest.current += 1;
    setCatalog(IDLE_CATALOG);
  };

  const run = async (
    kind: 'feature' | 'provider' | 'credential',
    work: () => Promise<VoiceSaveOutcome>,
  ): Promise<void> => {
    const started = generation.current;
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      if (generation.current !== started) return;
      setNotice(result.ok ? '已保存。' : (result.error ?? '没有保存。'));
      if (!result.ok || result.view == null) return;
      const savedView = result.view;
      const saved = savedView.providers.find((item) => item.providerRef === providerRef);
      // 只推进这次操作自己的 CAS 基线，其他脏草稿与版本保持原样。
      setBaseline((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              ...(kind === 'feature' ? { feature: savedView.feature } : {}),
              providers: previous.providers.map((item) =>
                item.providerRef !== providerRef || saved === undefined || kind === 'feature'
                  ? item
                  : kind === 'provider'
                    ? saved
                    : { ...item, credential: saved.credential },
              ),
            },
      );
      if (kind === 'provider') setSettings(saved?.settings ?? null);
      if (kind !== 'feature') resetCatalog();
    } catch {
      if (generation.current === started) setNotice('没有拿到保存结果，请读取最新版本后核对。');
    } finally {
      if (generation.current === started) setBusy(false);
    }
  };

  const saveFeature = (): void => {
    if (baseline === null || actions === null) return;
    void run('feature', () =>
      actions.saveFeature({
        expectedRevision: baseline.feature.configRevision,
        providerRef,
        finishMode,
      }),
    );
  };

  const saveProvider = (): void => {
    if (providerBaseline === undefined || settings === null || actions === null) return;
    void run('provider', () =>
      actions.saveProvider({
        providerRef,
        expectedRevision: providerBaseline.configRevision,
        settings,
      }),
    );
  };

  /**
   * 目录只读**已保存**的绑定：草稿里的新地址、新鉴权方式都还没有授权，
   * 不能拿它们去请求。改了就要求先保存，不在这里偷偷 fetch。
   */
  const targetDirty =
    settings !== null &&
    provider !== null &&
    (settings.baseUrl !== provider.settings.baseUrl ||
      settings.authMode !== provider.settings.authMode);
  const providerMoved = view !== null && providerRef !== view.feature.providerRef;
  const canReadCatalog =
    !disabled &&
    catalog.phase !== 'reading' &&
    provider !== null &&
    provider.bindingId !== null &&
    !targetDirty &&
    !providerMoved &&
    actions?.readCatalog !== undefined;

  const readCatalog = (): void => {
    if (!canReadCatalog || provider === null || provider.bindingId === null) return;
    if (actions?.readCatalog === undefined) return;
    const started = { providerRef, bindingId: provider.bindingId };
    const request = (catalogRequest.current += 1);
    setCatalog({ phase: 'reading' });
    void actions.readCatalog(started).then((result) => {
      // 已经重置、换了提供者或又读了一次：这份结果不再属于当前选择。
      if (catalogRequest.current !== request) return;
      // 失败/超时/权限问题都是「没读到」，不是「没有候选」；旧列表同时作废。
      setCatalog(
        result.ok
          ? { phase: 'ready', catalog: result.catalog }
          : { phase: 'failed', error: result.error },
      );
    });
  };

  // 只认当前这一帧的绑定：换了提供者或保存出了新绑定，旧列表立刻不画。
  const shownCatalog =
    catalog.phase === 'ready' &&
    catalog.catalog.providerRef === providerRef &&
    catalog.catalog.bindingId === provider?.bindingId
      ? catalog.catalog
      : null;
  const chosen =
    shownCatalog === null || settings === null
      ? ''
      : shownCatalog.candidates.some(
            (candidate) => candidate.selectable && candidate.modelRef === settings.modelRef,
          )
        ? settings.modelRef
        : '';
  const catalogHint = providerMoved
    ? '先保存转写提供者选择，再读取它自己的模型目录。'
    : targetDirty
      ? '网关地址或鉴权方式有未保存的修改：先保存，再读取已保存绑定的目录。'
      : provider === null || provider.bindingId === null
        ? '当前提供者还没有可读取的绑定：先保存网关地址与鉴权方式。'
        : '目录读的是已保存的网关与鉴权；选中的候选只改草稿，保存后才生效。';

  const saveKey = (): void => {
    if (providerBaseline === undefined || actions?.writeCredential === undefined || targetDirty)
      return;
    const value = key.trim();
    if (value === '') return;
    setKey('');
    void run('credential', async () => {
      const result = await actions.writeCredential?.({
        providerRef,
        expectedRevision: providerBaseline.configRevision,
        expectedCredentialVersion: providerBaseline.credential.version,
        value,
      });
      return result ?? { ok: false, error: '没有写入密钥。' };
    });
  };

  return (
    <Dialog
      open={open}
      title="语音输入"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          <Button
            variant="primary"
            disabled={disabled}
            data-testid="voice-settings-save"
            onClick={saveProvider}
          >
            保存提供者
          </Button>
        </>
      }
    >
      {view === null ? (
        <p className="row__value" data-testid="voice-settings-unread">
          还没有读到语音设置。连接服务后这里会显示实际的提供者与模型。
        </p>
      ) : (
        <div className="tc-voice-settings">
          <Field label="结束方式" hint="影响新开始的录音">
            {({ inputId, describedBy }) => (
              <select
                id={inputId}
                className="pk-input"
                aria-describedby={describedBy}
                value={finishMode}
                disabled={disabled}
                data-testid="voice-settings-mode"
                onChange={(event) => setFinishMode(event.target.value as VoiceFinishMode)}
              >
                <option value="send">结束后直接发送</option>
                <option value="review">结束后先预览</option>
              </select>
            )}
          </Field>

          {view.providers.length < 2 ? null : (
            <Field label="转写提供者" hint="只列已注册的原生 ASR 提供者">
              {({ inputId, describedBy }) => (
                <select
                  id={inputId}
                  className="pk-input"
                  aria-describedby={describedBy}
                  value={providerRef}
                  disabled={disabled}
                  data-testid="voice-settings-provider"
                  onChange={(event) => {
                    const next = event.target.value;
                    setProviderRef(next);
                    setKey('');
                    setSettings(
                      view.providers.find((item) => item.providerRef === next)?.settings ?? null,
                    );
                    // 换提供者就丢掉旧候选：它们属于上一个绑定，不能填这个选择框。
                    resetCatalog();
                  }}
                >
                  {view.providers.map((item) => (
                    <option key={item.providerRef} value={item.providerRef}>
                      {item.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <p className="tc-voice-settings__facts" data-testid="voice-settings-state">
            功能：{view.feature.source} · 提供者：{provider?.label ?? '未选择'} ·{' '}
            {provider === null
              ? '没有可用提供者'
              : provider.readiness === 'configured'
                ? '已配置'
                : `未就绪${provider.reason === null ? '' : `（${provider.reason}）`}`}
          </p>

          {settings === null || provider === null ? null : (
            <>
              <Field label="网关地址" hint="保存的是完整 API 基地址">
                {({ inputId, describedBy }) => (
                  <input
                    id={inputId}
                    className="pk-input"
                    aria-describedby={describedBy}
                    value={settings.baseUrl}
                    disabled={disabled}
                    spellCheck={false}
                    data-testid="voice-settings-base-url"
                    onChange={(event) => {
                      setKey('');
                      setSettings({ ...settings, baseUrl: event.target.value });
                    }}
                  />
                )}
              </Field>

              <Field label="转写模型" hint="完整的网关模型 ID；留空表示还没选">
                {({ inputId, describedBy }) => (
                  <input
                    id={inputId}
                    className="pk-input"
                    aria-describedby={describedBy}
                    value={settings.modelRef}
                    disabled={disabled}
                    spellCheck={false}
                    placeholder="vendor/mimo-asr"
                    data-testid="voice-settings-model"
                    onChange={(event) => setSettings({ ...settings, modelRef: event.target.value })}
                  />
                )}
              </Field>

              {/*
                目录只读已保存绑定的网关与鉴权。选中的候选只改草稿，仍然要按
                「保存提供者」才生效——发现和保存是两步，这里不代主人保存。
              */}
              <Field label="从目录选择" hint="读取已保存网关的 ASR 候选" description={catalogHint}>
                {({ inputId, describedBy }) => (
                  <select
                    id={inputId}
                    className="pk-input"
                    aria-describedby={describedBy}
                    value={chosen}
                    disabled={disabled || shownCatalog === null}
                    data-testid="voice-settings-candidate"
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === '') return;
                      setSettings({ ...settings, modelRef: next });
                    }}
                  >
                    <option value="">
                      {shownCatalog === null ? '还没有读取目录' : '未选择（保留手填值）'}
                    </option>
                    {(shownCatalog?.candidates ?? []).map((candidate) => (
                      <option
                        key={candidate.modelRef}
                        value={candidate.modelRef}
                        disabled={!candidate.selectable}
                      >
                        {candidateOption(candidate)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <div className="tc-voice-settings__actions">
                <Button
                  size="small"
                  disabled={!canReadCatalog}
                  data-testid="voice-settings-read-catalog"
                  onClick={readCatalog}
                >
                  {catalog.phase === 'reading' ? '正在读取…' : '读取模型'}
                </Button>
              </div>

              <p className="tc-voice-settings__facts" data-testid="voice-settings-catalog">
                {catalog.phase === 'reading'
                  ? '正在读取已保存绑定的模型目录…'
                  : catalog.phase === 'failed'
                    ? `没有读到目录：${catalog.error}。旧结果已清空，请重试或检查网关与密钥。`
                    : shownCatalog === null
                      ? '还没有读取目录。'
                      : shownCatalog.candidates.length === 0
                        ? '目录里没有可用的 ASR 候选。'
                        : `读到 ${shownCatalog.candidates.length} 个 ASR 候选，其中 ${shownCatalog.candidates.filter((item) => !item.selectable).length} 个不是本版本支持的协议。`}
              </p>

              <Field label="鉴权方式" hint="不读文字连接的密钥">
                {({ inputId, describedBy }) => (
                  <select
                    id={inputId}
                    className="pk-input"
                    aria-describedby={describedBy}
                    value={settings.authMode}
                    disabled={disabled}
                    data-testid="voice-settings-auth"
                    onChange={(event) => {
                      setKey('');
                      setSettings({
                        ...settings,
                        authMode: event.target.value as VoiceAsrSettings['authMode'],
                      });
                    }}
                  >
                    <option value="local-client-id">{AUTH_LABELS['local-client-id']}</option>
                    <option value="gateway-key">{AUTH_LABELS['gateway-key']}</option>
                  </select>
                )}
              </Field>

              <p className="tc-voice-settings__facts" data-testid="voice-settings-credential">
                密钥：{provider.credential.available ? '已提供' : '未提供'}
                {provider.credential.writable ? '' : ' · 由服务侧写入'}
              </p>

              {/* 桌面端 writable 恒为 false：连输入框都不画，避免看起来能写。 */}
              {provider.credential.writable && actions?.writeCredential !== undefined ? (
                <Field label="写入密钥" hint="只在这一次请求里存在">
                  {({ inputId, describedBy }) => (
                    <input
                      id={inputId}
                      className="pk-input"
                      type="password"
                      aria-describedby={describedBy}
                      value={key}
                      disabled={disabled}
                      autoComplete="off"
                      data-testid="voice-settings-key"
                      onChange={(event) => setKey(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}
            </>
          )}

          <div className="tc-voice-settings__actions">
            <Button
              size="small"
              disabled={disabled}
              data-testid="voice-settings-save-mode"
              onClick={saveFeature}
            >
              保存结束方式
            </Button>
            <Button
              size="small"
              disabled={!live || busy || view === null}
              data-testid="voice-settings-rebase"
              onClick={() => {
                setBaseline(view);
                setKey('');
                resetCatalog();
                setNotice('已采用最新已读版本，请核对保留的草稿后再保存。');
              }}
            >
              采用最新已读版本
            </Button>
            {provider?.credential.writable === true && actions?.writeCredential !== undefined ? (
              <Button
                size="small"
                disabled={disabled || targetDirty || key.trim() === ''}
                data-testid="voice-settings-save-key"
                onClick={saveKey}
              >
                写入密钥
              </Button>
            ) : null}
          </div>

          {notice === null ? null : (
            <p
              className="tc-voice-settings__facts"
              role="status"
              data-testid="voice-settings-notice"
            >
              {notice}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

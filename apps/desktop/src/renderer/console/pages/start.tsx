/**
 * 开始页：这台机器上要办的三件事，按要办的顺序从上到下。
 *
 * 连接模型（在用的端点与测试、目录里的厂商、模型与 Key、保存并开始）、
 * 我的桌宠（桌面上有没有这一只、能戳能说的 live 预览、隐藏/显示/装扮）、界面配色。
 * 运行状态在扩展页顶上，那里才是管它的地方；这一页不加第四块。
 *
 * 这里没有第二个录音会话，也没有第二份历史：预览的说话入口走宿主既有的那一条 sendText。
 * 测试通过、写进去了、真的切成在用了是三件不同的事，界面分开说。
 */
import { useState, type JSX } from 'react';

import type { DemoSnapshot, ModelService } from '@pet/contracts';

import { Button } from '@pet/ui-kit';

import { demoBubbleText, phaseToPetState } from '../../pet/demo-status.js';
import type { AppView } from '../app-views.js';
import { COPY } from '../copy.js';
import { type PetPreviewMic, PetPreview } from '../pet-preview.js';
import { SettingsSection } from '../settings-shell.js';
import { ThemeEditor } from '../theme-editor.js';
import { describeTest, saveMessage, type ModelConnectionState } from '../use-model-connection.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { vendorIcon } from '../vendor-icons.js';

import './start.css';

type Notify = (message: string, tone: 'ok' | 'danger') => void;

/**
 * 录不了音到底为什么：按报上来的状态排序说一句话，不写内部口吻。
 * 读不到状态、被暂停、没配识别模型是三件不同的事，别说成同一件。
 */
function micUnavailable(snapshot: DemoSnapshot | null): string | null {
  if (snapshot === null) {
    return '正在读取录音状态';
  }
  if (snapshot.paused === true) {
    return '桌宠已暂停，继续回应后可录音';
  }
  if (!snapshot.canRecord) {
    return snapshot.settings.modelId === null ? '请先在语音输入中完成设置' : '现在还不能录音';
  }
  return null;
}

const FAILED = (why: string): string => `连接没有成功：${why}`;

/**
 * 标题右边的「使用向导」：让桌宠在桌面上把引导再走一遍，这个窗口自己让开位置。
 *
 * 引导只有一份实现，在桌宠那边；宿主成功时还会把桌宠显示出来并收起设置窗。
 * 这里只报成功或宿主给的原因，不在设置台里演一遍本地引导，也不自己藏窗口。
 */
export function StartGuideAction({
  app,
  notify,
}: {
  app: ApplicationState;
  notify: Notify;
}): JSX.Element {
  const [started, setStarted] = useState(false);

  const replay = async (): Promise<void> => {
    setStarted(true);
    const outcome = await app.startGuide();
    setStarted(false);
    notify(
      outcome.ok ? '引导已经在桌宠那边开始。' : FAILED(outcome.error ?? '未知原因'),
      outcome.ok ? 'ok' : 'danger',
    );
  };

  return (
    <Button
      size="small"
      variant="quiet"
      title="由桌宠在桌面上再走一遍"
      disabled={!app.available || app.saving || started}
      data-testid="start-guide"
      onClick={() => void replay()}
    >
      使用向导
    </Button>
  );
}

export interface StartPageProps {
  app: ApplicationState;
  demo: DemoState;
  models: ModelConnectionState;
  notify: Notify;
  goToView: (view: AppView) => void;
  /** 「管理模型扩展」：模型目录由扩展提供，这一句只跳到真实的扩展入口。 */
  onOpenPlugins: () => void;
}

export function StartPage({
  app,
  demo,
  models,
  notify,
  goToView,
  onOpenPlugins,
}: StartPageProps): JSX.Element {
  const desktop = app.snapshot?.desktop ?? null;
  const ready = desktop !== null && desktop.available;
  const shown = desktop !== null && desktop.available && desktop.shown;
  const [sending, setSending] = useState(false);

  /*
   * 录音入口完全转给预览：状态、剩余秒数与三个动作都来自全场那一个录音所有者，
   * 这一页不新开 useDemo、不自己申请麦克风；没准备好时给的是宿主报出来的那句话。
   */
  const mic: PetPreviewMic | undefined = demo.available
    ? {
        canRecord: demo.snapshot?.canRecord === true,
        recording: demo.recording !== null,
        secondsLeft: demo.left,
        secondsLimit: demo.snapshot?.maxRecordingSeconds ?? null,
        unavailable: micUnavailable(demo.snapshot),
        start: () => {
          void demo.startRecording();
        },
        end: () => {
          void demo.endRecording();
        },
        cancel: () => {
          void demo.cancelRecording();
        },
      }
    : undefined;

  const setVisible = async (next: boolean): Promise<void> => {
    const outcome = await app.save({ visible: next });
    if (!outcome.ok) {
      notify(FAILED(outcome.error ?? '未知原因'), 'danger');
    }
  };

  /** 发出去的那句话走宿主既有的 demo 会话；接受了才由 PetComposer 清草稿。 */
  const onSend = async (text: string): Promise<boolean> => {
    setSending(true);
    const outcome = await demo.sendText(text);
    setSending(false);
    if (!outcome.ok) {
      notify(FAILED(outcome.error ?? '未知原因'), 'danger');
    }
    return outcome.ok;
  };

  return (
    <>
      <ModelSection models={models} onOpenPlugins={onOpenPlugins} />

      <SettingsSection
        title="我的桌宠"
        /* 只说宿主报上来的那一句：读不到显示状态就是「未就绪」，不猜它在不在桌上。 */
        state={
          !ready
            ? { text: '桌宠未就绪', tone: 'off' }
            : shown
              ? { text: '在桌面上', tone: 'on' }
              : { text: '已隐藏', tone: 'off' }
        }
      >
        <PetPreview
          values={app.values}
          agent={app.snapshot?.agent ?? null}
          state={demo.snapshot === null ? null : phaseToPetState(demo.snapshot.phase)}
          bubble={demo.snapshot === null ? null : demoBubbleText(demo.snapshot)}
          interact={app.available ? app.interact : undefined}
          mic={mic}
          onOpenVoiceSettings={() => goToView('voice')}
          onOpenDress={() => goToView('appearance')}
          composer={
            demo.available
              ? { canSend: demo.snapshot?.canSend === true, sending, onSend }
              : undefined
          }
        />
        <div className="start-petline">
          <Button
            size="small"
            disabled={!app.available || app.saving || !shown}
            data-testid="pet-hide"
            onClick={() => void setVisible(false)}
          >
            在桌面隐藏
          </Button>
          <Button
            size="small"
            disabled={!app.available || app.saving || shown}
            data-testid="pet-show"
            onClick={() => void setVisible(true)}
          >
            在桌面显示
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={!app.available}
            data-testid="pet-dress"
            onClick={() => goToView('appearance')}
          >
            装扮
          </Button>
        </div>
      </SettingsSection>

      <ThemeEditor />
    </>
  );
}

/* ---- 连接模型 ---- */

/** 芯片上的品牌标记：assets 里的 manifest 没这一家时什么都不画，名字本来就在文字里。 */
function ChipMark({ service }: { service: string }): JSX.Element | null {
  const src = vendorIcon(service);
  if (src === null) {
    return null;
  }
  return <img className="start-chip__mark" src={src} alt="" width={22} height={22} />;
}

interface ModelSectionProps {
  models: ModelConnectionState;
  onOpenPlugins: () => void;
}

/** 一家服务在目录里的那一（几）块平台：main 是芯片上那一家，alt 是要切过去的另一块。 */
interface VendorGroup {
  name: string;
  main: ModelService;
  alt?: ModelService;
}

/**
 * 一个视图看完这台机器的连接：在用的端点排第一行（带测试），目录里的厂商排第二行，
 * 选中哪家就在下面填它的模型与 Key。「保存并开始」把 Key 存进那一家自己的端点、
 * 测一次、把它设为在用，并让暂停中的会话继续接话。
 */
function ModelSection({ models, onOpenPlugins }: ModelSectionProps): JSX.Element {
  const snapshot = models.snapshot;
  const services = snapshot?.services ?? [];
  const active = snapshot?.active ?? null;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [saveLine, setSaveLine] = useState<string | null>(null);
  const [saveBad, setSaveBad] = useState(false);
  const [testLine, setTestLine] = useState<string | null>(null);
  const [testBad, setTestBad] = useState(false);

  /*
   * 平台按「一家服务」归成一组：同一家在两块平台上的端点不占两个位置，
   * 另一块用下面那句切换。所以芯片的数量是厂商数，不是端点数。
   */
  const vendors = services.reduce<VendorGroup[]>((acc, item) => {
    const found = acc.find((group) => group.name === item.service);
    if (found === undefined) {
      acc.push({ name: item.service, main: item });
      return acc;
    }
    if (found.main.region === 'intl' && item.region !== 'intl') {
      found.alt = found.main;
      found.main = item;
    } else {
      found.alt = item;
    }
    return acc;
  }, []);
  const picked =
    services.find((item) => item.id === pickedId) ??
    (active === null ? undefined : services.find((item) => item.id === active.id)) ??
    vendors.find((group) => group.main.available)?.main ??
    vendors[0]?.main;
  const firstLabel = vendors[0]?.main.label ?? 'DeepSeek';
  /** 填的就是在用的那个端点：这时 Key 留空表示沿用已保存的那一份。 */
  const inUse = picked !== undefined && active !== null && active.id === picked.id;
  const saved = snapshot?.endpoints.find((item) => item.id === picked?.id);

  /*
   * 换目标时在渲染里定下草稿，不等 effect：两秒一次的后台重读不能抹掉正在输入的东西，
   * 只有换了服务或端点才重置成那一家该显示的值。
   */
  if (picked !== undefined && draftOf !== picked.id) {
    const current =
      inUse && active !== null && active.model !== '' ? active.model : picked.defaultModel;
    setDraftOf(picked.id);
    setModelDraft(current);
    setKeyDraft('');
    setSaveLine(null);
    setTestLine(null);
  }

  const sibling =
    picked === undefined
      ? undefined
      : services.find((item) => item.service === picked.service && item.region !== picked.region);

  const save = async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const key = keyDraft.trim();
    if (key === '' && !inUse) {
      return;
    }
    const outcome = await models.saveAndStart({
      id: picked.id,
      model: modelDraft.trim(),
      ...(key === '' ? {} : { key }),
    });
    setKeyDraft('');
    setSaveBad(!outcome.ok);
    setSaveLine(saveMessage(outcome, picked.id));
  };

  const runTest = async (): Promise<void> => {
    const result = await models.testActive();
    setTestBad(!result.ok);
    setTestLine(describeTest(result));
  };

  const signIn = async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const outcome = await models.signInAndStart(picked);
    setSaveBad(!outcome.ok);
    setSaveLine(saveMessage(outcome, picked.id));
  };

  const openKeyPage = async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const outcome = await models.openServicePage(picked.id);
    if (!outcome.ok) {
      setSaveBad(true);
      setSaveLine(FAILED('打不开那家服务的页面：' + (outcome.error ?? '未知原因')));
    }
  };

  return (
    <SettingsSection title="连接模型">
      {!models.available ? (
        <p className="start-note">这台机器还没有模型连接的通道，所以这里没有可填的表单。</p>
      ) : snapshot === null ? (
        <p className="start-note">
          {models.loading ? COPY.loading : (models.error ?? '还没读到这台机器的模型配置。')}
        </p>
      ) : (
        <>
          {snapshot.notice === undefined ? null : (
            <p className="start-result is-bad" role="status">
              {snapshot.notice}
            </p>
          )}

          {active === null ? (
            <p className="start-note">{`选择一家模型服务并填写它的 API Key。不确定时先选 ${firstLabel}。`}</p>
          ) : null}

          <div className="start-picker">
            <p className="start-grouplabel">已连接的模型：</p>
            <div className="start-chipline start-chipline--current">
              {active === null ? (
                <span className="start-none">暂未连接</span>
              ) : (
                <span className="start-chip is-on">
                  {active.label + (active.model === '' ? '' : ' · ' + active.model)}
                </span>
              )}
              <Button
                size="small"
                disabled={active === null || models.testing}
                data-testid="model-test"
                onClick={() => void runTest()}
              >
                {models.testing ? '正在测试…' : '测试连接'}
              </Button>
              {testLine === null ? null : (
                <span className={testBad ? 'start-result is-bad' : 'start-result'}>{testLine}</span>
              )}
            </div>

            <p className="start-grouplabel">可选择的模型：</p>
            <div className="start-chipline">
              {vendors.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  className={group.name === picked?.service ? 'start-chip is-on' : 'start-chip'}
                  disabled={!group.main.available}
                  title={group.main.unavailableReason ?? group.main.label}
                  data-testid={'model-pick-' + group.main.id}
                  onClick={() => setPickedId(group.main.id)}
                >
                  <ChipMark service={group.name} />
                  {group.main.label}
                  {group.main.available ? null : <span className="start-chip__off">未接入</span>}
                </button>
              ))}
            </div>
          </div>

          {picked === undefined ? null : picked.auth === 'browser' ? (
            <div className="start-signin">
              <p className="start-note">这一家用浏览器登录自己的账号，不填 API Key。</p>
              <div className="start-actions">
                <Button
                  variant="primary"
                  disabled={models.signingIn || !picked.available}
                  data-testid="model-signin"
                  onClick={() => void signIn()}
                >
                  {models.signingIn ? '正在等待登录…' : '登录并连接'}
                </Button>
                {models.signingIn ? (
                  <Button size="small" onClick={() => void models.cancelSignIn()}>
                    取消
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="start-fields">
              <label className="start-field start-field--model">
                <span className="start-field__label">模型</span>
                <input
                  className="pk-input"
                  value={modelDraft}
                  list="start-model-list"
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="model-input"
                  onChange={(event) => setModelDraft(event.target.value)}
                />
              </label>
              <label className="start-field">
                <span className="start-field__label">{`${picked.label} 的 API Key`}</span>
                <input
                  className="pk-input"
                  type="password"
                  value={keyDraft}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={inUse ? '留空沿用已保存的 Key' : picked.keyHint}
                  disabled={!snapshot.credentialStorageAvailable || models.saving}
                  data-testid="key-input"
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
              </label>
              <datalist id="start-model-list">
                {picked.models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <Button
                variant="primary"
                disabled={
                  models.saving ||
                  !picked.available ||
                  modelDraft.trim() === '' ||
                  (keyDraft.trim() === '' && !inUse)
                }
                data-testid="model-save"
                onClick={() => void save()}
              >
                {models.saving ? '正在保存…' : '保存并开始'}
              </Button>
            </div>
          )}

          {picked === undefined || picked.auth === 'browser' ? null : (
            <p className="start-note">
              {saved?.keyConfigured
                ? '这一家在本机已存有 Key；留空就是继续用它。'
                : snapshot.credentialStorageAvailable
                  ? '这一家还没有存过 Key。'
                  : '本机凭据存储不可用：现在存不进去。'}
            </p>
          )}

          <div className="start-links">
            {picked === undefined ? null : (
              <button
                type="button"
                className="start-link"
                data-testid="model-getkey"
                onClick={() => void openKeyPage()}
              >
                {`前往 ${picked.label} 申请 Key`}
              </button>
            )}
            {sibling === undefined || picked === undefined ? null : (
              <button
                type="button"
                className="start-link"
                data-testid="model-region"
                onClick={() => setPickedId(sibling.id)}
              >
                {picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
              </button>
            )}
            <span className="start-links__spacer" aria-hidden="true" />
            {/* 目录由扩展提供：这句只跳到真实的扩展入口，不编任何任意 URL。 */}
            <button
              type="button"
              className="start-link"
              data-testid="model-manage"
              onClick={onOpenPlugins}
            >
              管理模型扩展
            </button>
          </div>

          {saveLine === null ? null : (
            <p className={saveBad ? 'start-result is-bad' : 'start-result'} role="status">
              {saveLine}
            </p>
          )}
        </>
      )}
    </SettingsSection>
  );
}

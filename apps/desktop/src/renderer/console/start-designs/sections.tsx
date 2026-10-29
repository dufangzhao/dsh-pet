/**
 * Start 的可复用片段：一个连接状态持有者 + 四个摆得上不同位置的片段。
 *
 * useStartSlots 在一次渲染里只调用一次，产出接好线的插槽元素；版式只决定把它们放在哪里，
 * 不再各写一份模型表单、登录轮询、录音入口或配色工作室。每个插槽在这一次渲染里只渲染一份。
 *
 * 状态归属不动：模型连接、录音会话、应用偏好与主题工作室都由设置台的唯一所有者提供，
 * 这里只做呈现与输入编排。草稿在 StartContext.draft 上，换版式不丢正在输入的模型名与 Key。
 */
import { useState, type JSX } from 'react';

import type { DemoSnapshot, ModelConnectionSnapshot, ModelService } from '@pet/contracts';

import { Button } from '@pet/ui-kit';

import { demoBubbleText, phaseToPetState } from '../../pet/demo-status.js';
import { COPY } from '../copy.js';
import { PetPreview } from '../pet-preview.js';
import { SettingsSection } from '../settings-shell.js';
import { ThemeEditor } from '../theme-editor.js';
import { describeTest, saveMessage } from '../use-model-connection.js';
import { vendorIcon } from '../vendor-icons.js';

import type { StartContext, StartDraft } from './contracts.js';
import { saveEnabled, testEnabled } from './contracts.js';

/** 一句失败的话：原因照报上来的原文，不改写。 */
export const connectFailure = (why: string): string => '连接没有成功：' + why;

/**
 * 录不了音到底为什么：读不到状态、被暂停、没配识别模型是三件不同的事，别说成同一件。
 */
export function micUnavailable(snapshot: DemoSnapshot | null): string | null {
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

/** 跨版式保留的输入草稿。Key 只活在这里：不写存储，也不进任何日志。 */
export function useStartDraft(): StartDraft {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [chatOpen, setChatOpen] = useState(false);

  return {
    pickedId,
    model,
    key,
    chatOpen,
    setPickedId,
    setModel,
    setKey,
    setChatOpen,
    resetForEndpoint(id, nextModel) {
      if (draftOf === id) {
        return;
      }
      // 换了一家才重置：两秒一次的后台重读不能抹掉正在输入的内容。
      setDraftOf(id);
      setModel(nextModel);
      setKey('');
    },
  };
}

/** 一家服务在目录里的那一（几）块平台：main 是芯片上那一家，alt 是要切过去的另一块。 */
export interface VendorGroup {
  name: string;
  main: ModelService;
  alt?: ModelService;
}

/** 把 19 个端点按厂商归组：同一家的另一块平台不占第二个位置。 */
export function vendorGroupsOf(services: readonly ModelService[]): VendorGroup[] {
  return services.reduce<VendorGroup[]>((acc, item) => {
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
}

/** 连接这一整块的状态与动作；useStartSlots 内部持有唯一一份。 */
interface ConnectModel {
  context: StartContext;
  snapshot: ModelConnectionSnapshot | null;
  services: readonly ModelService[];
  active: ModelConnectionSnapshot['active'];
  vendors: VendorGroup[];
  picked: ModelService | undefined;
  sibling: ModelService | undefined;
  inUse: boolean;
  keyConfigured: boolean;
  firstLabel: string;
  saveLine: string | null;
  saveBad: boolean;
  testLine: string | null;
  testBad: boolean;
  save(): void;
  runTest(): void;
  signIn(): void;
  openKeyPage(): void;
  pick(id: string): void;
}

function useConnectModel(context: StartContext): ConnectModel {
  const { models, draft } = context;
  const snapshot = models.snapshot;
  const services = snapshot?.services ?? [];
  const active = snapshot?.active ?? null;
  const [saveLine, setSaveLine] = useState<string | null>(null);
  const [saveBad, setSaveBad] = useState(false);
  const [testLine, setTestLine] = useState<string | null>(null);
  const [testBad, setTestBad] = useState(false);

  const vendors = vendorGroupsOf(services);
  const picked =
    services.find((item) => item.id === draft.pickedId) ??
    (active === null ? undefined : services.find((item) => item.id === active.id)) ??
    vendors.find((group) => group.main.available)?.main ??
    vendors[0]?.main;
  const inUse = picked !== undefined && active !== null && active.id === picked.id;
  if (picked !== undefined) {
    draft.resetForEndpoint(
      picked.id,
      inUse && active !== null && active.model !== '' ? active.model : picked.defaultModel,
    );
  }

  const save = async (): Promise<void> => {
    if (picked === undefined) {
      return;
    }
    const key = draft.key.trim();
    if (key === '' && !inUse) {
      return;
    }
    const outcome = await models.saveAndStart({
      id: picked.id,
      model: draft.model.trim(),
      ...(key === '' ? {} : { key }),
    });
    draft.setKey('');
    setSaveBad(!outcome.ok);
    setSaveLine(saveMessage(outcome, picked.id));
  };

  return {
    context,
    snapshot,
    services,
    active,
    vendors,
    picked,
    sibling:
      picked === undefined
        ? undefined
        : services.find((item) => item.service === picked.service && item.region !== picked.region),
    inUse,
    keyConfigured:
      snapshot?.endpoints.some((item) => item.id === picked?.id && item.keyConfigured) === true,
    firstLabel: vendors[0]?.main.label ?? 'DeepSeek',
    saveLine,
    saveBad,
    testLine,
    testBad,
    save: () => {
      void save();
    },
    runTest: () => {
      void models.testActive().then((result) => {
        setTestBad(!result.ok);
        setTestLine(describeTest(result));
      });
    },
    signIn: () => {
      if (picked === undefined) {
        return;
      }
      void models.signInAndStart(picked).then((outcome) => {
        setSaveBad(!outcome.ok);
        setSaveLine(saveMessage(outcome, picked.id));
      });
    },
    openKeyPage: () => {
      if (picked === undefined) {
        return;
      }
      void models.openServicePage(picked.id).then((outcome) => {
        if (!outcome.ok) {
          setSaveBad(true);
          setSaveLine(connectFailure('打不开那家服务的页面：' + (outcome.error ?? '未知原因')));
        }
      });
    },
    pick: (id) => draft.setPickedId(id),
  };
}

/* ---- 片段：都接同一个 ConnectModel，不再各自读一遍状态 ---- */

/** 在用的那一家 + 测试连接 + 测试结果：没有在用端点时只说暂未连接。 */
function ConnectStatus({ model }: { model: ConnectModel }): JSX.Element | null {
  const { context, snapshot, active } = model;
  if (!context.models.available || snapshot === null) {
    return null;
  }
  return (
    <div className="start-status" data-testid="start-status">
      {snapshot.notice === undefined ? null : (
        <p className="start-result is-bad" role="status">
          {snapshot.notice}
        </p>
      )}
      {active === null ? (
        <p className="start-note">
          {'选择一家模型服务并填写它的 API Key。不确定时先选 ' + model.firstLabel + '。'}
        </p>
      ) : null}
      <div className="start-chipline start-chipline--current">
        <span className="start-grouplabel">已连接的模型：</span>
        {active === null ? (
          <span className="start-none">暂未连接</span>
        ) : (
          <span className="start-chip is-on">
            {active.label + (active.model === '' ? '' : ' · ' + active.model)}
          </span>
        )}
        <Button
          size="small"
          disabled={!testEnabled(active !== null, context.models.testing)}
          data-testid="model-test"
          onClick={model.runTest}
        >
          {context.models.testing ? '正在测试…' : '测试连接'}
        </Button>
        {model.testLine === null ? null : (
          <span className={model.testBad ? 'start-result is-bad' : 'start-result'}>
            {model.testLine}
          </span>
        )}
      </div>
    </div>
  );
}

/** 厂商目录：15 家芯片，未接入的画着但点不动；另一块平台走详情里那句切换。 */
function ConnectCatalog({ model }: { model: ConnectModel }): JSX.Element | null {
  if (!model.context.models.available || model.snapshot === null) {
    return null;
  }
  return (
    <div className="start-catalog" data-testid="start-catalog">
      <span className="start-grouplabel">可选择的模型：</span>
      <div className="start-chipline">
        {model.vendors.map((group) => (
          <button
            key={group.name}
            type="button"
            className={group.name === model.picked?.service ? 'start-chip is-on' : 'start-chip'}
            disabled={!group.main.available}
            title={group.main.unavailableReason ?? group.main.label}
            data-testid={'model-pick-' + group.main.id}
            onClick={() => model.pick(group.main.id)}
          >
            <ChipMark service={group.name} />
            {group.main.label}
            {group.main.available ? null : <span className="start-chip__off">未接入</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 唯一的模型表单：模型与 Key、保存并开始、登录与取消、申请 Key 与平台切换、保存回执。 */
function ConnectForm({ model }: { model: ConnectModel }): JSX.Element {
  const { context, snapshot, picked, inUse } = model;
  const draft = context.draft;
  const models = context.models;

  if (!models.available) {
    return <p className="start-note">这台机器还没有模型连接的通道，所以这里没有可填的表单。</p>;
  }
  if (snapshot === null) {
    return (
      <p className="start-note">
        {models.loading ? COPY.loading : (models.error ?? '还没读到这台机器的模型配置。')}
      </p>
    );
  }
  if (picked === undefined) {
    return <p className="start-note">目录里还没有可接的服务。</p>;
  }

  return (
    <div className="start-connect-form" data-testid="start-connect-form">
      {picked.auth === 'browser' ? (
        <div className="start-signin">
          <p className="start-note">这一家用浏览器登录自己的账号，不填 API Key。</p>
          <div className="start-actions">
            <Button
              variant="primary"
              disabled={models.signingIn || !picked.available}
              data-testid="model-signin"
              onClick={model.signIn}
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
        <>
          <div className="start-fields">
            <label className="start-field start-field--model">
              <span className="start-field__label">模型</span>
              <input
                className="pk-input"
                value={draft.model}
                list="start-model-list"
                autoComplete="off"
                spellCheck={false}
                data-testid="model-input"
                onChange={(event) => draft.setModel(event.target.value)}
              />
            </label>
            <label className="start-field">
              <span className="start-field__label">{picked.label + ' 的 API Key'}</span>
              <input
                className="pk-input"
                type="password"
                value={draft.key}
                autoComplete="off"
                spellCheck={false}
                placeholder={inUse ? '留空沿用已保存的 Key' : picked.keyHint}
                disabled={!snapshot.credentialStorageAvailable || models.saving}
                data-testid="key-input"
                onChange={(event) => draft.setKey(event.target.value)}
              />
            </label>
            <datalist id="start-model-list">
              {picked.models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <Button
              variant="primary"
              // 这里少了取反就会把"能保存"当成"禁用"：按钮状态与 guard 反着长。
              disabled={
                !saveEnabled({
                  saving: models.saving,
                  available: picked.available,
                  model: draft.model,
                  key: draft.key,
                  targetIsActive: inUse,
                })
              }
              data-testid="model-save"
              onClick={model.save}
            >
              {models.saving ? '正在保存…' : '保存并开始'}
            </Button>
          </div>
          <p className="start-note">
            {model.keyConfigured
              ? '这一家在本机已存有 Key；留空就是继续用它。'
              : snapshot.credentialStorageAvailable
                ? '这一家还没有存过 Key。'
                : '本机凭据存储不可用：现在存不进去。'}
          </p>
        </>
      )}

      <div className="start-links">
        <button
          type="button"
          className="start-link"
          data-testid="model-getkey"
          onClick={model.openKeyPage}
        >
          {'前往 ' + picked.label + ' 申请 Key'}
        </button>
        {model.sibling === undefined ? null : (
          <button
            type="button"
            className="start-link"
            data-testid="model-region"
            onClick={() => model.pick(model.sibling?.id ?? '')}
          >
            {picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </button>
        )}
        <span className="start-links__spacer" aria-hidden="true" />
        <button
          type="button"
          className="start-link"
          data-testid="model-manage"
          onClick={context.onOpenPlugins}
        >
          管理模型扩展
        </button>
      </div>

      {model.saveLine === null ? null : (
        <p className={model.saveBad ? 'start-result is-bad' : 'start-result'} role="status">
          {model.saveLine}
        </p>
      )}
    </div>
  );
}

/** 芯片上的品牌标记：manifest 没这一家时什么都不画，名字本来就在文字里。 */
function ChipMark({ service }: { service: string }): JSX.Element | null {
  const src = vendorIcon(service);
  if (src === null) {
    return null;
  }
  return <img className="start-chip__mark" src={src} alt="" width={22} height={22} />;
}

/** 桌宠这一块：预览（说话、录音、日夜、菜单、拖动都在里面）加隐藏/显示/装扮。 */
function PetFragment({ context }: { context: StartContext }): JSX.Element | null {
  const { app, demo, notify, goToView } = context;
  const [sending, setSending] = useState(false);
  const desktop = app.snapshot?.desktop ?? null;
  const shown = desktop !== null && desktop.available && desktop.shown;

  const setVisible = async (next: boolean): Promise<void> => {
    const outcome = await app.save({ visible: next });
    if (!outcome.ok) {
      notify(connectFailure(outcome.error ?? '未知原因'), 'danger');
    }
  };

  const onSend = async (text: string): Promise<boolean> => {
    setSending(true);
    const outcome = await demo.sendText(text);
    setSending(false);
    if (!outcome.ok) {
      notify(connectFailure(outcome.error ?? '未知原因'), 'danger');
    }
    return outcome.ok;
  };

  if (!app.available) {
    return <p className="start-note">这一页还没连上应用，所以看不见桌面上是哪一只。</p>;
  }

  return (
    <div className="start-pet" data-testid="start-pet">
      <PetPreview
        values={app.values}
        agent={app.snapshot?.agent ?? null}
        state={demo.snapshot === null ? null : phaseToPetState(demo.snapshot.phase)}
        bubble={demo.snapshot === null ? null : demoBubbleText(demo.snapshot)}
        interact={app.interact}
        mic={
          demo.available
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
            : undefined
        }
        composer={
          demo.available ? { canSend: demo.snapshot?.canSend === true, sending, onSend } : undefined
        }
        onOpenVoiceSettings={() => goToView('voice')}
        onOpenDress={() => goToView('appearance')}
      />
      <div className="start-petline">
        <Button
          size="small"
          disabled={app.saving || !shown}
          data-testid="pet-hide"
          onClick={() => void setVisible(false)}
        >
          在桌面隐藏
        </Button>
        <Button
          size="small"
          disabled={app.saving || shown}
          data-testid="pet-show"
          onClick={() => void setVisible(true)}
        >
          在桌面显示
        </Button>
        <Button
          size="small"
          variant="primary"
          data-testid="pet-dress"
          onClick={() => goToView('appearance')}
        >
          装扮
        </Button>
      </div>
    </div>
  );
}

/** 桌面在不在的一句话，给要把状态放在标题旁边或状态条里的版式用。 */
export function petDesktopState(app: StartContext['app']): { text: string; tone: 'on' | 'off' } {
  const desktop = app.snapshot?.desktop ?? null;
  if (desktop === null || !desktop.available) {
    return { text: '桌宠未就绪', tone: 'off' };
  }
  return desktop.shown ? { text: '在桌面上', tone: 'on' } : { text: '已隐藏', tone: 'off' };
}

/**
 * 一次调用产出接好线的所有插槽。版式作者只需要按自己的信息层级摆放它们。
 *
 * connect 是唯一的模型表单实例；status 与 vendors 与它共享同一份回执与测试状态。
 * 每个插槽只渲染一份——渲染两次会得到第二个输入框和第二个草稿焦点。
 */
export function useStartSlots(context: StartContext) {
  const connect = useConnectModel(context);

  return {
    status: <ConnectStatus model={connect} />,
    vendors: <ConnectCatalog model={connect} />,
    connect: <ConnectForm model={connect} />,
    pet: <PetFragment context={context} />,
    theme: <ThemeEditor />,
    guide: <GuideAction app={context.app} notify={context.notify} />,
  };
}

/**
 * 那颗「使用向导」：只叫桌宠那边走一遍，不在设置台里演本地引导，也不自己藏窗口。
 * 它只要应用状态与一句提示，所以不收整个上下文——外壳标题行也能直接用同一颗。
 */
export function GuideAction({
  app,
  notify,
}: {
  app: StartContext['app'];
  notify: StartContext['notify'];
}): JSX.Element {
  const [started, setStarted] = useState(false);

  const replay = async (): Promise<void> => {
    setStarted(true);
    const outcome = await app.startGuide();
    setStarted(false);
    notify(
      outcome.ok ? '引导已经在桌宠那边开始。' : connectFailure(outcome.error ?? '未知原因'),
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

/** 带标题的一节：baseline 版式用它，别的版式可以不用（自己写自己的标题层级）。 */
export function StartSection({
  title,
  state,
  actions,
  children,
}: {
  title: string;
  state?: { text: string; tone: 'neutral' | 'on' | 'off' } | undefined;
  actions?: JSX.Element | undefined;
  children: JSX.Element | JSX.Element[] | null;
}): JSX.Element {
  return (
    <SettingsSection title={title} state={state} actions={actions}>
      {children}
    </SettingsSection>
  );
}

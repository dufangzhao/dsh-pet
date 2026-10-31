/**
 * 开始页：模型连接、桌宠与父级给的配色工作室，排法与 qa/minimal-settings-preview 的「开始」逐块对应。
 *
 * 状态与动作全部来自 useStartModel：这里不建第二份草稿、不直接调桥、不猜结果。
 * 服务目录是宿主给的那一份（一行一家，含未接入的与另一块平台），不是预览里的固定七家；
 * 桌宠画的是真正的 PetAvatar，形态、配色、大小与桌面上那一只读同一份偏好。
 * 预览状态与明暗只改这一格的呈现（本地 React 状态），不写主题、不动 Main 或任务；
 * 真正的配色工作室由父级从原所有者传进来（themeStudio），这里不新开一份主题状态。
 */
import { useId, useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import {
  MODEL_REASONING_EFFORTS,
  type ApplicationSnapshot,
  type ModelReasoningEffort,
  type PetState,
} from '@pet/contracts';

import { PetAvatar } from '../../pet/PetAvatar.js';
import { PET_PALETTES } from '../pet-preview.js';
import { usePokeableAvatar } from '../preview-behavior.js';
import { activeNote } from '../start-designs/behavior.js';
import type { StartModel } from '../start-designs/use-start-model.js';
import { vendorIcon } from '../vendor-icons.js';
import { Button, Card, Field, Select, Status, type StatusTone } from './controls.js';

/** 思考强度四个说法：值由契约给，字只在这里列一份。 */
const REASONING_EFFORT_LABEL: Readonly<Record<ModelReasoningEffort, string>> = {
  default: '自动',
  low: '低',
  medium: '中',
  high: '高',
};

/**
 * 代理状态到角色状态的映射：与 pet-preview.tsx 那张表同义。
 * 那一份没有导出，这里只照抄四行，语义仍由同一处契约决定。
 */
const AGENT_PET_STATE: Readonly<Record<ApplicationSnapshot['agent']['state'], PetState>> = {
  starting: 'thinking',
  ready: 'idle',
  stopped: 'idle',
  error: 'error',
};

/** 预览状态的三颗按钮：只换角色这一格的状态，不产生录音或回复。 */
const PREVIEW_POSES: readonly { pose: PetState; glyph: string; label: string; title: string }[] = [
  { pose: 'idle', glyph: '○', label: '预览待机', title: '待机' },
  { pose: 'listening', glyph: '◉', label: '预览聆听', title: '聆听' },
  { pose: 'replying', glyph: '↗', label: '预览回应', title: '回应' },
];

export interface MinimalStartProps {
  model: StartModel;
  /** 配色工作室的现有所有者；没有就整块不出现，不演一份假的。 */
  themeStudio?: ReactNode;
}

export function MinimalStart({ model, themeStudio }: MinimalStartProps): JSX.Element {
  return (
    <>
      <ModelCard model={model} />
      <PetCard model={model} />
      {themeStudio === undefined ? null : (
        <div className="start__theme" data-testid="start-theme">
          {themeStudio}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- 模型连接 */

/** 这一节此刻的整体读法：读不到桥、正在读、没读到、在用、存过没用、还没接过。 */
function connectionStatus(model: StartModel): { tone: StatusTone; text: string } {
  switch (model.phase) {
    case 'no-bridge':
      return { tone: 'warn', text: '这台机器还没有模型连接的通道，所以这里没有可填的表单。' };
    case 'loading':
      return { tone: 'off', text: '正在读这台机器的模型配置…' };
    case 'read-failed':
      return { tone: 'danger', text: model.error ?? '这台机器的模型配置没读到。' };
    case 'in-use':
      return { tone: 'ok', text: model.snapshotLabel ?? '在用的那一家没报出名字' };
    case 'in-use-paused':
      return { tone: 'warn', text: model.snapshotLabel ?? '在用的那一家没报出名字' };
    case 'saved-only':
      return { tone: 'off', text: '本机存过配置，还没在用' };
    case 'nothing-yet':
      return { tone: 'off', text: '还没有在用连接' };
  }
}

/** 模型名这一栏的一句话：只说「取列表」这件事，不替保存或连接作证。 */
function modelListLine(list: StartModel['modelList']): string {
  if (list.fetching) {
    return '正在向这一家取模型名…';
  }
  if (list.error !== null) {
    return list.error;
  }
  if (list.notice !== null) {
    return list.notice;
  }
  return list.options.length === 0 ? '这一家现在没有可列的模型名，可以直接打。' : '';
}

function ModelCard({ model }: { model: StartModel }): JSX.Element {
  const statusId = useId() + '-status';
  const status = connectionStatus(model);
  const action = (
    <span data-testid="start-status">
      <Status tone={status.tone}>{status.text}</Status>
      {model.phase === 'in-use-paused' ? (
        <>
          {' · '}
          <span data-testid="start-paused">
            <Status tone="warn">回应已暂停</Status>
          </span>
        </>
      ) : null}
      {model.phase === 'read-failed' ? (
        <>
          {' '}
          <Button size="small" onClick={model.refresh}>
            重新读取
          </Button>
        </>
      ) : null}
    </span>
  );

  return (
    <Card title="模型连接" id="model-connection-card" action={action}>
      {model.notice === null ? null : (
        <p className="model-action-status" data-testid="start-notice">
          {model.notice}
        </p>
      )}
      {model.phase === 'no-bridge' || model.phase === 'read-failed' ? null : (
        <ConnectForm model={model} statusId={statusId} />
      )}
    </Card>
  );
}

function ConnectForm({
  model,
  statusId,
}: {
  model: StartModel;
  statusId: string;
}): JSX.Element | null {
  const [showKey, setShowKey] = useState(false);
  const picked = model.picked;

  if (picked === undefined) {
    // 正在读的时候，卡片头上已经说了同一件事，这里不再重复一句。
    return model.loading ? null : (
      <p className="model-action-status" data-testid="start-connect-empty">
        目录里还没有可接的服务。
      </p>
    );
  }

  /* auth 种类与「这一屏的主要动作是登录还是写回」是两件事：已经登录过这一家时，
     改的是模型名与思考强度，走的还是那颗「保存并开始」。 */
  const browserSignIn = picked.auth === 'browser';
  const needsSignIn = browserSignIn && !model.keySaved;

  return (
    <form
      className="model-form"
      data-testid="start-connect-form"
      data-mark={model.mark ?? 'draft'}
      onSubmit={(event) => {
        event.preventDefault();
        if (needsSignIn) {
          model.signIn();
        } else {
          model.save();
        }
      }}
    >
      <div className="field-row">
        <Field label="服务" className="field--grow">
          {(control) => (
            <Select
              id={control.inputId}
              aria-describedby={control.describedBy}
              aria-invalid={control.invalid || undefined}
              value={picked.id}
              disabled={model.busy.saving}
              data-testid="model-provider-select"
              options={model.choices.map((choice) => {
                const icon = providerIcon(choice.row.name);
                return {
                  value: choice.service.id,
                  label: choice.service.label,
                  ...(icon === undefined ? {} : { icon }),
                };
              })}
              onChange={(event) => model.pick(event.target.value)}
            />
          )}
        </Field>

        <Field label="思考强度" className="field--grow">
          {(control) => (
            <Select
              id={control.inputId}
              aria-describedby={control.describedBy}
              aria-invalid={control.invalid || undefined}
              value={model.reasoningEffort}
              disabled={model.busy.saving}
              data-testid="model-reasoning-effort"
              options={MODEL_REASONING_EFFORTS.map((effort) => ({
                value: effort,
                label: REASONING_EFFORT_LABEL[effort],
              }))}
              onChange={(event) => {
                model.setReasoningEffort(event.target.value as ModelReasoningEffort);
              }}
            />
          )}
        </Field>
      </div>

      <div className="field-row">
        <Field label="模型名" className="field--grow">
          {(control) => (
            <div className="model-inline">
              <div className="inputForm">
                <input
                  className="input"
                  id={control.inputId}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid || undefined}
                  type="text"
                  value={model.model}
                  autoComplete="off"
                  spellCheck={false}
                  list={statusId + '-models'}
                  data-testid="model-input"
                  onChange={(event) => model.setModel(event.target.value)}
                />
                <datalist id={statusId + '-models'}>
                  {model.modelList.options.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <Button
                className="btn--compact"
                busy={model.modelList.fetching}
                disabled={model.modelList.fetching || !model.modelList.allowed}
                aria-describedby={statusId}
                data-testid="model-fetch"
                onClick={model.getModels}
              >
                {model.modelList.fetching ? '获取中' : '获取模型'}
              </Button>
            </div>
          )}
        </Field>
      </div>

      {browserSignIn ? null : (
        <Field
          label={picked.label + ' 的 API Key'}
          {...(model.keyBlock === null ? {} : { error: model.keyBlock })}
        >
          {(control) => (
            <div className="inputForm">
              <input
                className="input"
                id={control.inputId}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid || undefined}
                type={showKey ? 'text' : 'password'}
                value={model.key}
                placeholder="输入 API Key"
                autoComplete="off"
                spellCheck={false}
                disabled={model.keyBlock !== null || model.busy.saving}
                data-testid="key-input"
                onChange={(event) => model.setKey(event.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                aria-pressed={showKey}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                onClick={() => setShowKey((now) => !now)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                  <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                </svg>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                  <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                  <path d="M3 3l18 18" />
                </svg>
              </button>
            </div>
          )}
        </Field>
      )}

      <p
        className="model-action-status"
        id={statusId}
        role="status"
        data-testid="model-list-result"
        data-state={model.modelList.error === null ? 'plain' : 'error'}
      >
        {modelListLine(model.modelList)}
      </p>

      {browserSignIn ? (
        <>
          <p className="model-action-status">
            {
              '这一家用浏览器登录自己的账号，不填 API Key。登录完成只是这台机器读到了登录，能不能接上还要看随后那一次写入。'
            }
          </p>
          {needsSignIn ? null : (
            <p className="model-action-status" data-testid="model-signin-signed">
              {
                '这台机器已经登录过这一家，不用再登录一次：改完模型名或思考强度，用那颗「保存并开始」。'
              }
            </p>
          )}
          {model.signing === null ? null : (
            <p className="model-action-status" role="status" data-testid="model-signin-line">
              {model.signing}
            </p>
          )}
        </>
      ) : null}

      <div className="card__foot">
        {needsSignIn ? (
          <Button
            type="submit"
            variant="primary"
            busy={model.busy.signingIn}
            disabled={!model.can.signIn}
            data-testid="model-signin"
          >
            {model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            busy={model.busy.saving}
            disabled={!model.can.save}
            data-testid="model-save"
          >
            {model.busy.saving ? '正在写入这台机器…' : '保存并开始'}
          </Button>
        )}
        {needsSignIn && model.busy.signingIn ? (
          <Button data-testid="model-signin-cancel" onClick={model.cancelSignIn}>
            取消这次登录
          </Button>
        ) : null}
        <Button
          busy={model.busy.testing}
          disabled={!model.can.test}
          aria-describedby={statusId}
          data-testid="model-test"
          onClick={model.test}
        >
          {model.busy.testing ? '正在探测…' : '测试连接'}
        </Button>
        {model.tested === null ? null : (
          <Status tone={model.tested.passed ? 'ok' : 'danger'}>{model.tested.text}</Status>
        )}
        <Button variant="ghost" data-testid="model-getkey" onClick={model.openKeyPage}>
          {'去 ' + picked.label + ' 申请 Key'}
        </Button>
        {model.sibling === undefined ? null : (
          <Button variant="ghost" data-testid="model-region" onClick={model.switchRegion}>
            {picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </Button>
        )}
        <Button variant="ghost" data-testid="model-manage" onClick={model.openPlugins}>
          管理模型扩展
        </Button>
      </div>

      {model.can.save || needsSignIn ? null : (
        <p className="model-action-status" data-testid="model-save-reason">
          {model.reasons.save}
        </p>
      )}
      {/* 两颗按钮常常因为同一个原因按不下去：同一句话只写一次。 */}
      {model.can.test || model.reasons.test === model.reasons.save ? null : (
        <p className="model-action-status" data-testid="model-test-reason">
          {model.reasons.test}
        </p>
      )}

      <SaveReceipt model={model} />
    </form>
  );
}

/** 写进本机、探测过没过、这台机器现在用不用它——三条事实分开摆，不合成一句「已连接」。 */
function SaveReceipt({ model }: { model: StartModel }): JSX.Element | null {
  const receipt = model.saved;
  if (receipt === null) {
    return null;
  }
  const who = activeNote({
    receiptActive: receipt.active || model.activeId === model.saveTargetId,
    activeId: model.activeId,
    activeLabel: model.activeLabel,
    writtenId: model.saveTargetId ?? '',
  });
  return (
    <div data-testid="model-receipt">
      <p className="start__values">
        {'写进本机 '}
        <Status tone={receipt.saved ? 'ok' : 'danger'}>
          {receipt.saved ? '已保存' : '没保存'}
        </Status>
        {' · 这一次探测 '}
        <Status tone={receipt.tested ? 'ok' : 'warn'}>{receipt.tested ? '通过' : '没通过'}</Status>
        {' · 现在在用 '}
        <Status tone={who.tone === 'on' ? 'ok' : who.tone === 'off' ? 'off' : 'warn'}>
          {who.text}
        </Status>
      </p>
      <p className="model-action-status" role="status">
        {receipt.text}
      </p>
    </div>
  );
}

/** 一家厂商的那一枚图形：manifest 里没有这一家就不画，名字本来就在文字上。 */
function providerIcon(service: string): ReactNode {
  const src = vendorIcon(service);
  if (src === null) {
    return undefined;
  }
  return <img className="opt__mark" src={src} alt="" width={20} height={20} />;
}

/* -------------------------------------------------------------------- 桌宠 */

function PetCard({ model }: { model: StartModel }): JSX.Element {
  const values = model.pet.values;
  const palette = values?.palette ?? 'morning';
  const colors = PET_PALETTES[palette];
  const size = values?.size ?? 'normal';
  const figure = values?.figure ?? 'minimal';
  const [pose, setPose] = useState<PetState | null>(null);
  const [dark, setDark] = useState(false);
  const { expression, sceneRef, poke } = usePokeableAvatar(model.pet.interact);
  const petState = pose ?? model.pet.state ?? AGENT_PET_STATE[model.pet.agent?.state ?? 'stopped'];

  return (
    <Card title="桌宠" id="start-pet-card">
      {model.appAvailable ? (
        <>
          <div
            ref={sceneRef}
            className="stage stage--wide"
            role="region"
            aria-label="桌宠预览"
            data-palette={palette}
            data-scene-dark={dark ? 'true' : 'false'}
            {...(pose === null ? {} : { 'data-preview-pose': pose })}
            data-testid="start-pet"
            style={
              {
                '--pet-body-top': colors.top,
                '--pet-body-bottom': colors.bottom,
                '--pet-face': colors.face,
                '--halo': colors.halo,
              } as CSSProperties
            }
          >
            <button
              type="button"
              className="stage-theme"
              aria-label="切换预览场景明暗"
              aria-pressed={dark}
              onClick={() => setDark((now) => !now)}
            >
              ☼
            </button>

            <button
              type="button"
              className="stage__pet pet-preview"
              data-size={size}
              data-figure={figure}
              aria-label="与桌宠互动"
              data-testid="pet-poke"
              disabled={model.pet.interact === undefined}
              onClick={poke}
            >
              <PetAvatar
                state={petState}
                expression={expression}
                figure={figure}
                name={values?.petName ?? null}
              />
            </button>
            <span className="stage__ground" aria-hidden="true" />

            <div className="stage-toolbar" role="group" aria-label="预览状态">
              {PREVIEW_POSES.map((option) => (
                <button
                  key={option.pose}
                  type="button"
                  className="stage-tool"
                  aria-label={option.label}
                  title={option.title}
                  aria-pressed={pose === option.pose}
                  onClick={() => setPose((now) => (now === option.pose ? null : option.pose))}
                >
                  {option.glyph}
                </button>
              ))}
            </div>
          </div>

          <div className="preview-window-actions">
            <Button
              variant="ghost"
              busy={model.busy.visibility}
              disabled={!model.desktopAvailable || !model.desktopShown}
              data-testid="pet-hide"
              onClick={() => model.setDesktopVisible(false)}
            >
              在桌面隐藏
            </Button>
            <Button
              variant="ghost"
              disabled={!model.desktopAvailable || model.desktopShown || model.busy.visibility}
              data-testid="pet-show"
              onClick={() => model.setDesktopVisible(true)}
            >
              在桌面显示
            </Button>
            <Button
              variant="primary"
              data-testid="pet-dress"
              onClick={() => model.goToView('appearance')}
            >
              装扮
            </Button>
          </div>
        </>
      ) : (
        <p className="model-action-status" data-testid="start-pet">
          这一页还没连上应用，所以看不见桌面上是哪一只。
        </p>
      )}
    </Card>
  );
}

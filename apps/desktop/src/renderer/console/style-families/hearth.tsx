/**
 * Hearth（炉边）：一整套「温暖的宠物产品」的呈现，不是 pet bench 换色。
 *
 * 这一家自己的东西都在本文件与 hearth.css 里：炉火色的纸与巧克力墨、Candara/Corbel 的字、
 * 大圆角厚卡与落在纸上的软影子、填进去就变深的柔底输入格、按到底的胶囊按钮、
 * 一家一张的大选择卡（真 radio 圆圈 + 厂商标记 + 此刻那句话），以及桌宠那格里画出来的「窝」。
 * 判断与动作只有 use-start-model 那一份；预览与配色走 style-families 的 headless 适配器，
 * 控件的形状与语义由这一家自己写——不借 pet bench 的板件，也不套旧复制品。
 *
 * board=true 画这一套控件自己的状态样板：每块都能真按、真填、真开关，但都不冒充后台结果。
 */
import { useId, useState, type ButtonHTMLAttributes, type JSX, type ReactNode } from 'react';

import type { ModelService } from '@pet/contracts';

import { PetAvatar } from '../../pet/PetAvatar.js';
import { SCHEME_NAME_MAX } from '../original-ui/theme-controller.js';
import type { AppView } from '../app-views.js';
import { MARK_TEXT, activeNote, providerNote } from '../start-designs/behavior.js';
import type { ProviderMark } from '../start-designs/behavior.js';
import type { ProviderChoice, StartModel } from '../start-designs/use-start-model.js';
import {
  THEMES,
  THEME_APPEARANCE_LABELS,
  THEME_MODE_NAMES,
  allSchemes,
  schemeSwatches,
  type ThemeMode,
  type ThemeToken,
} from '../theme.js';
import { vendorIcon } from '../vendor-icons.js';
import type { FamilyProps, StyleFamily } from './contracts.js';
import { useFamilyPreview, type FamilyPreview } from './use-family-preview.js';
import { useFamilyTheme, type FamilyTheme, type FamilyThemeSeed } from './use-family-theme.js';

import './character.css';
import './hearth.css';

/**
 * 评审用的呈现种子：浅与黑各一份，只写炉边要在意的那几格，其余跟着本机记录走。
 * 只贴在这一扇窗的根节点上；把窗口交还给记录（改格、换方案、保存）之后就按记录说话。
 */
export const HEARTH_SEED: FamilyThemeSeed = {
  light: {
    paper: '#f6e9d2',
    'paper-2': '#efe0c5',
    sheet: '#fdf6ea',
    'sheet-2': '#f7ebd8',
    'sheet-3': '#eeddc0',
    ink: '#3a2418',
    'ink-soft': '#6b4a35',
    'ink-dim': '#8a6a52',
    line: '#e3cdab',
    'line-2': '#d3b78d',
    'line-strong': '#a3765a',
    accent: '#b53a5b',
    'accent-2': '#8e2743',
    'on-accent': '#fff3e6',
    ok: '#3f7a4f',
    warn: '#a4712a',
    danger: '#a8342a',
    'bubble-bg': '#f3dcae',
    'bubble-ink': '#3a2418',
    'tool-result': '#6b4a35',
  },
  dark: {
    paper: '#241a14',
    'paper-2': '#2b1f18',
    sheet: '#33251d',
    'sheet-2': '#3d2c22',
    'sheet-3': '#48342a',
    ink: '#f5e5d3',
    'ink-soft': '#d6bda6',
    'ink-dim': '#b39a80',
    line: '#4a3529',
    'line-2': '#5e4433',
    'line-strong': '#9c7a5e',
    accent: '#e2845f',
    'accent-2': '#f0a87f',
    'on-accent': '#2b1408',
    ok: '#7fc79a',
    warn: '#e3b96f',
    danger: '#f0938a',
    'bubble-bg': '#5a3a26',
    'bubble-ink': '#f8e7d2',
  },
};

const NAV_VIEWS: readonly (readonly [AppView, string])[] = [
  ['appearance', '装扮'],
  ['voice', '语音'],
  ['conversation', '时间线'],
];

type Tone = 'on' | 'off' | 'ok' | 'warn' | 'danger' | 'neutral';

/* ---------------------------------------------------------------- 板件 */

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'soft' | 'text' | undefined;
  /** 正在等这台机器给结果：真的禁用、真的 aria-busy，在等什么由调用方写清楚。 */
  busy?: boolean;
}

/** 胶囊按钮：按下去整颗沉进自己的暖色底托；一屏只有一颗是实心樱桃色（主操作）。 */
function Pill({
  variant = 'soft',
  busy = false,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: PillProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      data-busy={busy ? 'true' : undefined}
      className={'hth-pill hth-pill--' + variant + (className === undefined ? '' : ' ' + className)}
    >
      <span className="hth-pill__label">{children}</span>
    </button>
  );
}

interface ControlBinding {
  inputId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/** 柔底字段：名称在上，格子是一个填了暖色的窝；补充与失败落在格子下面，不进可访问名称。 */
function HearthField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  children: ReactNode | ((control: ControlBinding) => ReactNode);
}): JSX.Element {
  const id = useId();
  const inputId = id + '-input';
  const hintId = id + '-hint';
  const errorId = id + '-error';
  const describedBy =
    [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
      .filter(Boolean)
      .join(' ') || undefined;
  const slot =
    typeof children === 'function'
      ? children({ inputId, describedBy, invalid: error !== undefined })
      : children;
  return (
    <div className="hth-field" data-bad={error === undefined ? 'false' : 'true'}>
      <label className="hth-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="hth-field__well">{slot}</div>
      {hint === undefined ? null : (
        <p className="hth-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="hth-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** 胶囊开关：原生 checkbox 加 role=switch，圆销走到哪一边就是哪一档。 */
function HearthSwitch({
  label,
  hint,
  pressed,
  disabled = false,
  onChange,
  testid,
}: {
  label: string;
  hint?: ReactNode | undefined;
  pressed: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
  testid?: string | undefined;
}): JSX.Element {
  const id = useId();
  const hintId = id + '-hint';
  return (
    <span className="hth-switch" data-pressed={pressed ? 'true' : 'false'}>
      <span className="hth-switch__copy">
        <label className="hth-switch__name" htmlFor={id}>
          {label}
        </label>
        {hint === undefined ? null : (
          <span className="hth-switch__hint" id={hintId}>
            {hint}
          </span>
        )}
      </span>
      <span className="hth-switch__track">
        <input
          id={id}
          className="hth-switch__input"
          type="checkbox"
          role="switch"
          checked={pressed}
          disabled={disabled}
          aria-describedby={hint === undefined ? undefined : hintId}
          data-testid={testid}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span className="hth-switch__knob" aria-hidden="true" />
      </span>
    </span>
  );
}

/** 状态卡：一盏灯、一句话、必要时下面再一句；字一直在，颜色只是复认。 */
function HearthStatus({
  tone,
  children,
  sub,
  testid,
}: {
  tone: Tone;
  children: ReactNode;
  sub?: ReactNode | undefined;
  testid?: string | undefined;
}): JSX.Element {
  return (
    <p className="hth-status" data-tone={tone} data-testid={testid}>
      <span className="hth-status__dot" aria-hidden="true" />
      <span className="hth-status__body">
        <span className="hth-status__word">{children}</span>
        {sub === undefined ? null : <span className="hth-status__sub">{sub}</span>}
      </span>
    </p>
  );
}

/** 厚卡：这一家唯一的容器——22 圆角、暖色边、一层落在纸上的影子。 */
function HearthCard({
  title,
  note,
  aside,
  children,
  testid,
}: {
  title: string;
  note?: string | undefined;
  aside?: ReactNode | undefined;
  children: ReactNode;
  testid?: string | undefined;
}): JSX.Element {
  const id = useId();
  return (
    <section className="hth-card" data-testid={testid} aria-labelledby={id}>
      <header className="hth-card__head">
        <div className="hth-card__names">
          <h2 className="hth-card__title" id={id}>
            {title}
          </h2>
          {note === undefined ? null : <p className="hth-card__note">{note}</p>}
        </div>
        {aside === undefined ? null : <div className="hth-card__aside">{aside}</div>}
      </header>
      <div className="hth-card__body">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- 目录 */

/**
 * 一家一张大卡：真 radio 圆圈、厂商标记、名字与这一家此刻的一句话。
 * 没接进来的那一家仍然看得见，但原生 disabled 让圆圈按不动，原因写在 title 上。
 */
function HearthChoiceCard({
  choice,
  groupName,
  onPick,
}: {
  choice: ProviderChoice;
  groupName: string;
  onPick(id: string): void;
}): JSX.Element {
  const service = choice.service;
  const src = vendorIcon(choice.row.name);
  return (
    <label
      className="hth-choice"
      data-mark={choice.mark}
      data-current={choice.current ? 'true' : 'false'}
      title={service.unavailableReason ?? service.label}
    >
      <input
        className="hth-choice__radio"
        type="radio"
        name={groupName}
        value={service.id}
        checked={choice.current}
        disabled={!service.available}
        data-testid={'model-pick-' + service.id}
        onChange={() => {
          onPick(service.id);
        }}
      />
      <span className="hth-choice__circle" aria-hidden="true">
        <span className="hth-choice__dot" />
      </span>
      {src === null ? (
        <span className="hth-choice__mark hth-choice__mark--empty" aria-hidden="true" />
      ) : (
        <img className="hth-choice__mark" src={src} alt="" width={26} height={26} />
      )}
      <span className="hth-choice__copy">
        <span className="hth-choice__name">{service.label}</span>
        <span className="hth-choice__note">
          {providerNote(choice.mark, service.auth, choice.dirty)}
        </span>
      </span>
      <span className="hth-choice__region">
        {service.region === 'cn' ? '中国大陆' : '国际'} ·{' '}
        {service.auth === 'browser' ? '浏览器登录' : 'API Key'}
      </span>
    </label>
  );
}

function HearthProvider({ model }: { model: StartModel }): JSX.Element {
  const groupName = useId();
  return (
    <div className="hth-provider" data-testid="start-provider">
      <div className="hth-provider__bar">
        <HearthField label="找一家服务" hint="按名称、标识或可填的模型名筛；空着就是整份目录。">
          {({ inputId, describedBy }) => (
            <input
              id={inputId}
              className="hth-input"
              type="search"
              value={model.query}
              placeholder="例如 Kimi、glm、deepseek"
              spellCheck={false}
              autoComplete="off"
              aria-describedby={describedBy}
              data-testid="model-provider-search"
              onChange={(event) => {
                model.setQuery(event.target.value);
              }}
            />
          )}
        </HearthField>
        <span className="hth-provider__count" data-testid="model-provider-count">
          {model.choices.length + ' / ' + model.rows.length + ' 家'}
        </span>
      </div>

      {model.choices.length === 0 ? (
        <p className="hth-empty" data-testid="model-provider-empty">
          {'这里没有 matching「' +
            model.query.trim() +
            '」的一家。改一个字试试，或去管理模型扩展看看这家接进来了没有。'}
        </p>
      ) : (
        <fieldset className="hth-choices">
          <legend className="hth-choices__legend">挑一家来连</legend>
          {model.choices.map((choice) => (
            <HearthChoiceCard
              key={choice.service.id}
              choice={choice}
              groupName={groupName}
              onPick={model.pick}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 回执 */

/** 三条事实分开的账本：写进本机没有、这次探测过没过、这台机器现在用不用它。 */
function HearthLedger({ model }: { model: StartModel }): JSX.Element | null {
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
    <dl className="hth-ledger" data-testid="model-receipt">
      <div className="hth-ledger__row">
        <dt>写进本机</dt>
        <dd>
          <HearthStatus tone={receipt.saved ? 'ok' : 'danger'}>
            {receipt.saved ? '已保存' : '没保存'}
          </HearthStatus>
        </dd>
      </div>
      <div className="hth-ledger__row">
        <dt>这一次探测</dt>
        <dd>
          <HearthStatus tone={receipt.tested ? 'ok' : 'warn'}>
            {receipt.tested ? '通过' : '没通过'}
          </HearthStatus>
        </dd>
      </div>
      <div className="hth-ledger__row">
        <dt>现在在用</dt>
        <dd>
          <HearthStatus tone={who.tone === 'warn' ? 'off' : who.tone}>{who.text}</HearthStatus>
        </dd>
      </div>
      <p className="hth-ledger__line" role="status">
        {receipt.text}
      </p>
    </dl>
  );
}

/* ---------------------------------------------------------------- 接线 */

function HearthConnect({ model }: { model: StartModel }): JSX.Element {
  const [revealKey, setRevealKey] = useState(false);
  if (!model.available) {
    return <HearthConnectionStatus model={model} />;
  }
  if (model.picked === undefined) {
    return (
      <p className="hth-empty" data-testid="start-connect-empty">
        {model.loading ? '正在读这台机器的模型配置…' : '目录里还没有可接的服务。'}
      </p>
    );
  }

  const browserSignIn = model.picked.auth === 'browser';
  const mark: ProviderMark | null = model.mark;

  return (
    <form
      className="hth-connect"
      data-testid="start-connect-form"
      data-mark={mark ?? 'draft'}
      onSubmit={(event) => {
        event.preventDefault();
        if (browserSignIn) {
          model.signIn();
        } else {
          model.save();
        }
      }}
    >
      <h3 className="hth-connect__who">
        <span className="hth-connect__name">{model.picked.label}</span>
        <HearthStatus
          tone={mark === 'in-use' ? 'ok' : mark === 'unavailable' ? 'off' : 'warn'}
          sub={
            model.dirty
              ? '这次改动还没保存'
              : model.keySaved
                ? '本机存过 Key'
                : model.picked.region === 'cn'
                  ? '中国大陆平台'
                  : '国际平台'
          }
        >
          {mark === null ? '—' : MARK_TEXT[mark]}
        </HearthStatus>
      </h3>

      {browserSignIn ? (
        <div className="hth-connect__signin">
          <p className="hth-para">
            这一家用浏览器登录自己的账号，不填 API Key。登录完成只是这台机器读到了登录，
            能不能接上还要看随后那一次写入。
          </p>
          <div className="hth-row">
            <Pill
              type="submit"
              variant="primary"
              busy={model.busy.signingIn}
              disabled={!model.can.signIn}
              data-testid="model-signin"
            >
              {model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
            </Pill>
            {model.busy.signingIn ? (
              <Pill data-testid="model-signin-cancel" onClick={model.cancelSignIn}>
                取消这次登录
              </Pill>
            ) : null}
          </div>
          {model.signing === null ? null : (
            <p className="hth-wait" role="status" data-testid="model-signin-line">
              {model.signing}
            </p>
          )}
        </div>
      ) : (
        <div className="hth-connect__fields">
          <HearthField
            label="模型名"
            hint={
              model.picked.models.length > 0
                ? '可以直接打，也可以点下面这几格里已经列出的名字。'
                : undefined
            }
            error={model.model.trim() === '' ? '模型名不能空着。' : undefined}
          >
            {({ inputId, describedBy, invalid }) => (
              <input
                id={inputId}
                className="hth-input"
                value={model.model}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                data-testid="model-input"
                onChange={(event) => {
                  model.setModel(event.target.value);
                }}
              />
            )}
          </HearthField>

          {model.picked.models.length === 0 ? null : (
            <div className="hth-suggestions" role="group" aria-label="这一家列出的模型名">
              {model.picked.models.map((name) => (
                <Pill
                  key={name}
                  variant="text"
                  data-testid={'model-suggest-' + name}
                  onClick={() => {
                    model.setModel(name);
                  }}
                >
                  {name}
                </Pill>
              ))}
            </div>
          )}

          <HearthField
            label={model.picked.label + ' 的 API Key'}
            hint={
              model.inUse
                ? '留空就沿用这台机器上已经存着的那一份。'
                : model.keySaved
                  ? '这家在本机存过 Key；填新的会覆盖它。'
                  : model.picked.keyHint
            }
            error={model.keyBlock ?? undefined}
          >
            {({ inputId, describedBy, invalid }) => (
              <span className="hth-keyrow">
                <input
                  id={inputId}
                  className="hth-input"
                  type={revealKey ? 'text' : 'password'}
                  value={model.key}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={model.keyBlock !== null || model.busy.saving}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  data-testid="key-input"
                  onChange={(event) => {
                    model.setKey(event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="hth-reveal"
                  aria-pressed={revealKey}
                  data-testid="key-reveal"
                  onClick={() => {
                    setRevealKey((next) => !next);
                  }}
                >
                  {revealKey ? '藏起来' : '看一下'}
                </button>
              </span>
            )}
          </HearthField>

          <Pill
            type="submit"
            variant="primary"
            busy={model.busy.saving}
            disabled={!model.can.save}
            data-testid="model-save"
          >
            {model.busy.saving ? '正在写入这台机器…' : '保存并开始'}
          </Pill>
        </div>
      )}

      <div className="hth-row hth-row--tools">
        <Pill
          busy={model.busy.testing}
          disabled={!model.can.test}
          data-testid="model-test"
          onClick={model.test}
        >
          {model.busy.testing ? '正在探测…' : '测试连接'}
        </Pill>
        {model.tested === null ? null : (
          <HearthStatus tone={model.tested.passed ? 'ok' : 'danger'}>
            {model.tested.text}
          </HearthStatus>
        )}
        <span className="hth-row__fill" aria-hidden="true" />
        <Pill variant="text" data-testid="model-getkey" onClick={model.openKeyPage}>
          {'去 ' + model.picked.label + ' 申请 Key'}
        </Pill>
        {model.sibling === undefined ? null : (
          <Pill variant="text" data-testid="model-region" onClick={model.switchRegion}>
            {model.picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </Pill>
        )}
        <Pill variant="text" data-testid="model-manage" onClick={model.openPlugins}>
          管理模型扩展
        </Pill>
      </div>

      {model.can.save || browserSignIn ? null : (
        <p className="hth-hold" data-testid="model-save-reason">
          {model.reasons.save}
        </p>
      )}
      {model.can.test ? null : (
        <p className="hth-hold" data-testid="model-test-reason">
          {model.reasons.test}
        </p>
      )}

      <HearthLedger model={model} />
    </form>
  );
}

/* ---------------------------------------------------------------- 状态 */

/** 这一页此刻的真实读法：没有桥、正在读、读失败、没接过、存过没在用、在用（含暂停）。 */
function HearthConnectionStatus({ model }: { model: StartModel }): JSX.Element {
  if (model.phase === 'no-bridge') {
    return (
      <div className="hth-statusline" data-testid="start-status">
        <HearthStatus tone="warn" sub="这台机器还没有模型连接的通道，所以这里没有可填的表单。">
          没有连接通道
        </HearthStatus>
      </div>
    );
  }
  if (model.phase === 'read-failed') {
    return (
      <div className="hth-statusline" data-testid="start-status">
        <HearthStatus tone="danger" sub={model.error ?? '这台机器的模型配置没读到。'}>
          没读到配置
        </HearthStatus>
        <Pill onClick={model.refresh}>重新读取</Pill>
      </div>
    );
  }
  if (model.phase === 'loading') {
    return (
      <div className="hth-statusline" data-testid="start-status">
        <HearthStatus tone="neutral">正在读这台机器的模型配置…</HearthStatus>
      </div>
    );
  }
  const tone: Tone =
    model.phase === 'in-use' ? 'ok' : model.phase === 'in-use-paused' ? 'warn' : 'off';
  const words =
    model.phase === 'in-use' || model.phase === 'in-use-paused'
      ? (model.snapshotLabel ?? '在用的那一家没报出名字')
      : model.phase === 'saved-only'
        ? '本机存过配置，还没在用'
        : '还没有在用连接';
  return (
    <div className="hth-statusline" data-testid="start-status">
      <HearthStatus tone={tone}>{words}</HearthStatus>
      {model.phase === 'in-use-paused' ? (
        <span className="hth-flag" data-testid="start-paused">
          回应已暂停
        </span>
      ) : null}
      {model.notice === null ? null : (
        <span className="hth-flag" data-testid="start-notice">
          {model.notice}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 桌宠 */

/** 画出来的「窝」：窗、垫子、水碗与一枚爪印，颜色全跟这一家的令牌走。 */
function HearthNookArt(): JSX.Element {
  return (
    <svg className="hth-nook__art" viewBox="0 0 220 150" aria-hidden="true" focusable="false">
      <g className="hth-nook__window">
        <rect x="18" y="12" width="74" height="56" rx="12" />
        <path d="M55 12v56M18 40h74" />
      </g>
      <circle className="hth-nook__sun" cx="70" cy="30" r="9" />
      <ellipse className="hth-nook__cushion" cx="132" cy="112" rx="80" ry="26" />
      <path className="hth-nook__cushion-top" d="M60 104c24-16 120-16 144 0" />
      <path className="hth-nook__bowl" d="M16 122h44l-7 16H23z" />
      <g className="hth-nook__paw">
        <ellipse cx="196" cy="70" rx="9" ry="7" />
        <circle cx="184" cy="58" r="4" />
        <circle cx="196" cy="54" r="4" />
        <circle cx="208" cy="58" r="4" />
      </g>
    </svg>
  );
}

/** 菜单里那一行：id 与 locator 两家共用一套说法，字样是这一家自己的。 */
export interface HearthMenuItem {
  readonly id: 'chat' | 'mic' | 'cancel' | 'voice' | 'light' | 'dress' | 'close';
  readonly testid: string;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * 窝里那一层菜单能做的哪几件事：完全由 preview 那一位所有者给的事实决定。
 *
 * 没有会话就不列说话；没接到录音就不列录音；只有真的在录才列「丢掉这一次」；
 * 语音设置与去装扮只有外壳真的给了那两条入口才出现。
 */
export function hearthMenuItems(preview: FamilyPreview): readonly HearthMenuItem[] {
  const items: HearthMenuItem[] = [
    {
      id: 'chat',
      testid: 'pet-menu-chat',
      label: '对它说一句',
      disabled: !preview.composer.present,
    },
  ];
  if (preview.mic.present) {
    items.push({
      id: 'mic',
      testid: 'pet-menu-mic',
      label: preview.mic.pressed ? '结束这一次录音' : '用录音说一句',
      disabled: preview.mic.disabled,
    });
  }
  if (preview.mic.pressed) {
    items.push({ id: 'cancel', testid: 'pet-menu-cancel', label: '丢掉这一次', disabled: false });
  }
  if (preview.entries.voice !== undefined) {
    items.push({ id: 'voice', testid: 'pet-menu-voice', label: '语音设置', disabled: false });
  }
  items.push({
    id: 'light',
    testid: 'pet-menu-light',
    label: preview.night ? '窝里的灯改回白天' : '窝里的灯切成夜里',
    disabled: false,
  });
  if (preview.entries.dress !== undefined) {
    items.push({ id: 'dress', testid: 'pet-menu-dress', label: '去装扮', disabled: false });
  }
  items.push({ id: 'close', testid: 'pet-menu-close', label: '关闭', disabled: false });
  return items;
}

export function HearthPetMenu({
  preview,
  menuId,
}: {
  preview: FamilyPreview;
  menuId: string;
}): JSX.Element {
  const run = (id: HearthMenuItem['id']): void => {
    if (id === 'chat') preview.composer.setOpen(true);
    else if (id === 'mic') preview.mic.toggle();
    else if (id === 'cancel') preview.mic.cancel();
    else if (id === 'voice') preview.entries.voice?.();
    else if (id === 'light') preview.setNight(!preview.night);
    else if (id === 'dress') preview.entries.dress?.();
    // 无论挑了哪一行，这层菜单都收起来；「关闭」就是只收起来。
    preview.menu.close();
  };
  return (
    <div
      className="hth-nook__menu"
      id={menuId}
      role="menu"
      data-testid="pet-menu-body"
      aria-label="这一格桌宠能做的那几件事"
    >
      <h3 className="hth-nook__menu-title">这一格能做的那几件事</h3>
      {hearthMenuItems(preview).map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="hth-nook__menu-item"
          disabled={item.disabled}
          data-testid={item.testid}
          onClick={() => {
            run(item.id);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function HearthPet({ model }: { model: StartModel }): JSX.Element {
  const preview: FamilyPreview = useFamilyPreview(model);
  const menuId = useId();
  return (
    <HearthCard
      title="我的桌宠"
      note="窝里的说话、录音、日夜与挪动都接到这台机器上。"
      aside={
        <>
          <HearthStatus tone={model.desktop.mark === 'on' ? 'on' : 'off'}>
            {model.desktop.text}
          </HearthStatus>
          <HearthStatus tone={model.paused ? 'warn' : 'neutral'}>
            {model.paused ? '回应已暂停' : '照常回应'}
          </HearthStatus>
        </>
      }
      testid="start-pet"
    >
      {!preview.available ? (
        <p className="hth-empty">这一页还没连上应用，所以看不见桌面上是哪一只。</p>
      ) : (
        <>
          <div
            className="hth-nook"
            ref={preview.stage.ref}
            data-testid={preview.stage['data-testid']}
            data-light={preview.stage['data-light']}
            aria-label={preview.stage['aria-label']}
            onPointerLeave={preview.stage.onPointerLeave}
            onBlur={preview.stage.onBlur}
            onContextMenu={preview.stage.onContextMenu}
          >
            <button
              type="button"
              className="hth-nook__menu-open"
              aria-haspopup="menu"
              aria-expanded={preview.menu.open}
              {...(preview.menu.open ? { 'aria-controls': menuId } : {})}
              data-testid="pet-menu"
              onClick={preview.menu.toggle}
            >
              这一格的那几件事
            </button>
            {preview.menu.open ? <HearthPetMenu preview={preview} menuId={menuId} /> : null}
            <HearthNookArt />
            {preview.bubble === null ? null : (
              <p className="hth-nook__say" role="status">
                {preview.bubble}
              </p>
            )}
            <span
              className="sf-figure hth-nook__figure"
              data-size={model.pet.values?.size ?? 'normal'}
              style={preview.figure.vars}
            >
              <button type="button" className="hth-nook__pet" {...preview.avatar}>
                <PetAvatar
                  state={preview.figure.state}
                  expression={preview.figure.expression}
                  figure={preview.figure.figure}
                  name={preview.figure.name}
                />
              </button>
            </span>
          </div>

          <div className="hth-pet__rail">
            <HearthSwitch
              label="暂时不回应"
              hint="只是让它先不开口，录音与预览还在这里。"
              pressed={model.paused}
              disabled={model.busy.pausing}
              testid="pet-pause"
              onChange={model.togglePaused}
            />
            <HearthSwitch
              label="对它说一句"
              hint="写完这句按回车，或点右边那颗胶囊。"
              pressed={preview.composer.open}
              disabled={!preview.composer.present}
              testid="pet-chat-toggle"
              onChange={preview.composer.setOpen}
            />
            {preview.mic.present ? (
              <HearthSwitch
                label={preview.mic.label}
                hint={preview.mic.hint}
                pressed={preview.mic.pressed}
                disabled={preview.mic.disabled}
                testid="pet-mic-toggle"
                onChange={() => {
                  preview.mic.toggle();
                }}
              />
            ) : null}
            {preview.mic.pressed ? (
              <Pill variant="text" data-testid="pet-mic-cancel" onClick={preview.mic.cancel}>
                丢掉这一次
              </Pill>
            ) : null}
            <HearthSwitch
              label="窝里的灯"
              hint="只改这一格的明暗，不动设置台与桌面的配色。"
              pressed={preview.night}
              testid="pet-light-toggle"
              onChange={preview.setNight}
            />
          </div>

          {preview.composer.present && preview.composer.open ? (
            <div className="hth-composer">
              <HearthField label={preview.composer.label} hint={preview.composer.hint}>
                {({ inputId }) => (
                  <input
                    id={inputId}
                    className="hth-input"
                    type="text"
                    value={preview.composer.text}
                    placeholder={preview.composer.placeholder}
                    disabled={!preview.composer.canSend || preview.composer.sending}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="pet-composer-input"
                    onChange={(event) => {
                      preview.composer.setText(event.target.value);
                    }}
                    onKeyDown={preview.composer.onKeyDown}
                  />
                )}
              </HearthField>
              <Pill
                variant="primary"
                busy={preview.composer.sending}
                disabled={!preview.composer.canSubmit}
                data-testid="pet-composer-send"
                onClick={preview.composer.send}
              >
                {preview.composer.sending ? '正在说…' : '说给它听'}
              </Pill>
            </div>
          ) : null}

          <div className="hth-row">
            <Pill
              busy={model.busy.visibility}
              disabled={!model.desktopShown}
              data-testid="pet-hide"
              onClick={() => {
                model.setDesktopVisible(false);
              }}
            >
              在桌面隐藏
            </Pill>
            <Pill
              disabled={model.desktopShown || model.busy.visibility}
              data-testid="pet-show"
              onClick={() => {
                model.setDesktopVisible(true);
              }}
            >
              在桌面显示
            </Pill>
            {preview.entries.dress === undefined ? null : (
              <Pill variant="text" data-testid="pet-dress" onClick={preview.entries.dress}>
                去装扮
              </Pill>
            )}
            {preview.entries.voice === undefined ? null : (
              <Pill variant="text" data-testid="pet-voice" onClick={preview.entries.voice}>
                语音设置
              </Pill>
            )}
          </div>
        </>
      )}
    </HearthCard>
  );
}

/* ---------------------------------------------------------------- 配色 */

/** 词表是扁平的一串：按 token.group 归并成这一家的几段，顺序仍是词表的顺序。 */
export function groupHearthTokens(
  tokens: readonly ThemeToken[],
): { readonly group: string; readonly items: ThemeToken[] }[] {
  const out: { group: string; items: ThemeToken[] }[] = [];
  for (const token of tokens) {
    const bucket = out.find((item) => item.group === token.group);
    if (bucket === undefined) out.push({ group: token.group, items: [token] });
    else bucket.items.push(token);
  }
  return out;
}

function HearthColors({ theme }: { theme: FamilyTheme }): JSX.Element {
  const { snapshot, actions, tokens, seeded } = theme;
  const record = snapshot.record;
  const schemes = allSchemes(record);
  const appearance = snapshot.appearance;
  const groupName = useId();
  const modeName = useId();

  return (
    <div className="hth-colors" data-testid="start-theme">
      <section className="hth-colors__inner" data-testid="theme-studio" aria-label="界面配色">
        <p className="hth-para" data-testid="theme-seeded" data-seeded={seeded ? 'true' : 'false'}>
          {seeded
            ? '现在看到的是炉边这一家的呈现种子：改一格或换方案，就把这一扇窗交回本机记录。'
            : '这一家已经接到本机记录：改哪格都还是试色，保存才写进去。'}
        </p>

        <fieldset className="hth-modes">
          <legend className="hth-modes__legend">明暗挡位</legend>
          {THEMES.map((mode: ThemeMode) => (
            <label
              className="hth-mode"
              key={mode}
              data-on={record.mode === mode ? 'true' : 'false'}
            >
              <input
                className="hth-mode__radio"
                type="radio"
                name={groupName}
                value={mode}
                checked={record.mode === mode}
                data-testid={'theme-mode-' + mode}
                onChange={() => {
                  actions.chooseMode(mode);
                }}
              />
              <span className="hth-mode__name">{THEME_MODE_NAMES[mode]}</span>
              <span className="hth-mode__note">
                {mode === 'light' ? '一直浅色' : mode === 'dark' ? '一直黑夜' : '跟着系统走'}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="hth-schemes">
          <legend className="hth-schemes__legend">配色方案</legend>
          {schemes.map((scheme) => {
            const on = scheme.id === record.selectedId;
            return (
              <label className="hth-scheme" key={scheme.id} data-on={on ? 'true' : 'false'}>
                <input
                  className="hth-scheme__radio"
                  type="radio"
                  name={modeName}
                  value={scheme.id}
                  checked={on}
                  data-testid={'theme-scheme-' + scheme.id}
                  onChange={() => {
                    actions.chooseScheme(scheme.id);
                  }}
                />
                <span className="hth-scheme__band" aria-hidden="true">
                  {schemeSwatches(scheme, appearance).map((color, index) => (
                    <span key={index} style={{ background: color }} />
                  ))}
                </span>
                <span className="hth-scheme__name">{scheme.name}</span>
                <span className="hth-scheme__note">
                  {scheme.builtin === true ? '内置' : '自定义'} ·{' '}
                  {THEME_APPEARANCE_LABELS[appearance]}变体
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="hth-field hth-field--name">
          <label className="hth-field__label" htmlFor="hth-scheme-name">
            方案名
          </label>
          <div className="hth-field__well">
            <input
              id="hth-scheme-name"
              className="hth-input"
              type="text"
              value={snapshot.name}
              maxLength={SCHEME_NAME_MAX}
              aria-describedby="hth-scheme-name-hint"
              data-testid="theme-scheme-name"
              onChange={(event) => {
                actions.setName(event.target.value);
              }}
            />
          </div>
          <p className="hth-field__hint" id="hth-scheme-name-hint">
            另存或覆盖时用它；最长 40 字。
          </p>
        </div>

        {groupHearthTokens(tokens).map((bucket) => (
          <div className="hth-tokens" key={bucket.group}>
            <h3 className="hth-tokens__group">{bucket.group}</h3>
            <div className="hth-tokens__grid">
              {bucket.items.map((token) => {
                const value = snapshot.draft[token.key] ?? '#000000';
                const invalid = snapshot.invalidKeys.has(token.key);
                return (
                  <div className="hth-dial" key={token.key} data-bad={invalid ? 'true' : 'false'}>
                    <input
                      className="hth-dial__pick"
                      type="color"
                      value={value}
                      aria-label={token.label + '选色'}
                      data-testid={'theme-token-' + token.key + '-picker'}
                      onChange={(event) => {
                        actions.editToken(token.key, event.target.value, 'picker');
                      }}
                    />
                    <span className="hth-dial__label">{token.label}</span>
                    <input
                      className="hth-dial__hex"
                      type="text"
                      value={snapshot.hexText[token.key] ?? value.toUpperCase()}
                      maxLength={7}
                      spellCheck={false}
                      aria-label={token.label + '的十六进制'}
                      aria-invalid={invalid || undefined}
                      data-testid={'theme-token-' + token.key + '-hex'}
                      onChange={(event) => {
                        actions.editToken(token.key, event.target.value, 'hex');
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <p className="hth-hold" data-tone={snapshot.status.tone} role="status">
          {snapshot.status.text}
        </p>

        <div className="hth-row hth-row--tools">
          <Pill
            disabled={!snapshot.previewActive}
            data-testid="theme-undo-preview"
            onClick={actions.undoPreview}
          >
            撤销预览
          </Pill>
          <Pill data-testid="theme-copy" onClick={actions.copyAsNew}>
            复制为新方案
          </Pill>
          {snapshot.canWrite ? (
            <Pill
              variant="text"
              className="hth-pill--warn-text"
              data-testid="theme-delete"
              onClick={actions.requestDelete}
            >
              {snapshot.deleteArmed ? '再次点击确认删除' : '删除方案'}
            </Pill>
          ) : null}
          <Pill variant="primary" data-testid="theme-save" onClick={actions.save}>
            {snapshot.canWrite ? '保存当前方案' : '另存为自定义'}
          </Pill>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- 样板 */

const BOARD_TONES: readonly (readonly [Tone, string])[] = [
  ['on', '在桌面上'],
  ['off', '已隐藏'],
  ['ok', '已保存'],
  ['warn', '已保存未测'],
  ['danger', '连接没成功'],
  ['neutral', '还没读过'],
];

const BOARD_CHOICES = [
  { id: 'warm', name: '炉边一号', note: '样板：就是这一家', available: true },
  { id: 'cozy', name: '炉边二号', note: '样板：可选', available: true },
  { id: 'cold', name: '炉边三号', note: '样板：这一格演示按不动的样子', available: false },
];

/**
 * 这一套控件自己的状态样板：每块都是真的能按、能填、能开关的原生控件，
 * 只有本地状态——不冒充任何后台回执，也不画一个没有来源的假数据。
 */
function HearthBoard(): JSX.Element {
  const groupName = useId();
  const [picked, setPicked] = useState('warm');
  const [pause, setPause] = useState(false);
  const [lamp, setLamp] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [word, setWord] = useState('');
  const tooShort = word.trim() !== '' && word.trim().length < 4;

  return (
    <div className="hth-board" data-testid="hearth-board">
      <p className="hth-board__lead">
        下面是炉边这套控件自己的状态样板：能按、能填、能开关，状态都写在原生控件上。
        样板上的话不是后台回执——Start 那一屏里的「已保存 / 探测过 / 在用」只在真动作之后才出现。
      </p>

      <HearthCard title="胶囊按钮" note="primary 一屏只有一颗；busy 是真的 disabled 加 aria-busy。">
        <div className="hth-row">
          <Pill variant="primary">保存并开始</Pill>
          <Pill>在桌面显示</Pill>
          <Pill variant="text">去申请 Key</Pill>
          <Pill busy={pressing} onClick={() => setPressing(true)}>
            {pressing ? '正在写入这台机器…' : '点我演示等待'}
          </Pill>
          <Pill disabled>没读到配置时</Pill>
        </div>
      </HearthCard>

      <HearthCard
        title="柔底字段"
        note="名称在上、格子是暖色的窝；失败那句用 role=alert 立即播报。"
      >
        <div className="hth-board__fields">
          <HearthField label="模型名" hint="可以直接打，空白就用这一家的默认值。">
            {({ inputId }) => (
              <input
                id={inputId}
                className="hth-input"
                type="text"
                value={word}
                placeholder="deepseek-flash"
                autoComplete="off"
                spellCheck={false}
                data-testid="board-field-input"
                onChange={(event) => {
                  setWord(event.target.value);
                }}
              />
            )}
          </HearthField>
          <HearthField
            label="API Key"
            hint="只活在这一次运行里，不写进任何文件。"
            error={tooShort ? '这一格看着还没贴全：' + word.trim().length + ' 位。' : undefined}
          >
            {({ inputId, describedBy, invalid }) => (
              <input
                id={inputId}
                className="hth-input"
                type="password"
                defaultValue="sk-demo"
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                data-testid="board-key-input"
                onChange={() => {
                  setLocked(true);
                }}
              />
            )}
          </HearthField>
        </div>
        {locked ? (
          <p className="hth-field__hint" data-testid="board-locked-note">
            这一格已经动了：本地样板只记着「动过」，不写进这台机器。
          </p>
        ) : null}
      </HearthCard>

      <HearthCard title="大选择卡" note="真 radio 圆圈：方向键在一组里走，选中那一家整张卡变暖。">
        <fieldset className="hth-choices">
          <legend className="hth-choices__legend">挑一家（样板）</legend>
          {BOARD_CHOICES.map((item) => {
            const service: ModelService = {
              id: item.id,
              label: item.name,
              region: 'cn',
              service: item.id,
              defaultModel: '',
              models: [],
              keyHint: '',
              keyUrl: '',
              auth: 'api-key',
              available: item.available,
              ...(item.available ? {} : { unavailableReason: item.note }),
            };
            const choice: ProviderChoice = {
              service,
              row: { name: item.id, main: service },
              current: picked === item.id,
              mark: item.available ? (picked === item.id ? 'draft' : 'available') : 'unavailable',
              keySaved: false,
              dirty: false,
            };
            return (
              <HearthChoiceCard
                key={item.id}
                choice={choice}
                groupName={groupName}
                onPick={(id) => {
                  setPicked(id);
                }}
              />
            );
          })}
        </fieldset>
      </HearthCard>

      <HearthCard title="胶囊开关" note="原生 checkbox 加 role=switch：空格与读屏都交给浏览器。">
        <div className="hth-pet__rail">
          <HearthSwitch
            label="暂时不回应"
            hint="样板：只翻本地状态"
            pressed={pause}
            testid="board-pause"
            onChange={setPause}
          />
          <HearthSwitch
            label="窝里的灯"
            hint="样板：开是夜里"
            pressed={lamp}
            testid="board-lamp"
            onChange={setLamp}
          />
          <HearthSwitch
            label="这台机器不给录音"
            hint="样板：原生 disabled"
            pressed={false}
            disabled
            onChange={() => undefined}
          />
        </div>
      </HearthCard>

      <HearthCard title="状态卡" note="字一直在，灯只是复认：灰度截图与小屏放大都读得懂。">
        <div className="hth-board__tones">
          {BOARD_TONES.map(([tone, text]) => (
            <HearthStatus
              key={tone}
              tone={tone}
              sub={tone === 'danger' ? '下一步：检查网络或换一家' : undefined}
            >
              {text}
            </HearthStatus>
          ))}
        </div>
      </HearthCard>

      <HearthCard title="窝" note="桌宠那格画的这一幅：窗、垫子、水碗与一枚爪印。">
        <div className="hth-nook" data-light="day">
          <HearthNookArt />
        </div>
      </HearthCard>
    </div>
  );
}

/* ---------------------------------------------------------------- 门面 */

function HearthNav({ model, board }: { model: StartModel; board: boolean }): JSX.Element {
  return (
    <nav className="hth-nav" aria-label="设置台的其他几页">
      <span className="hth-nav__here" aria-current="page">
        {board ? '炉边样板' : '开始'}
      </span>
      {NAV_VIEWS.map(([view, label]) => (
        <button
          key={view}
          type="button"
          className="hth-nav__tile"
          data-testid={'hearth-nav-' + view}
          onClick={() => {
            model.goToView(view);
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

/** 一扇完整的窗：炉边的顶栏、暖纸底、厚卡列与脚边那条状态，都是这一家自己的形状。 */
export function HearthFamily({ model, board, guide }: FamilyProps): JSX.Element {
  const theme = useFamilyTheme(HEARTH_SEED);
  return (
    <div
      className="sf-hearth"
      data-testid="family-hearth"
      data-board={board ? 'true' : 'false'}
      style={{ ...theme.vars, colorScheme: theme.colorScheme }}
    >
      <header className="hth-top">
        <span className="hth-top__brand">
          <svg className="hth-top__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              className="hth-top__flame"
              d="M12 3c3 4 5 6 5 9a5 5 0 1 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3-1-3 0-6 1-8Z"
            />
            <ellipse className="hth-top__log" cx="12" cy="20" rx="8" ry="2.2" />
          </svg>
          <span className="hth-top__name">炉边</span>
          <span className="hth-top__sub">桌宠的开始页</span>
        </span>
        <HearthNav model={model} board={board} />
        {guide === undefined ? null : <span className="hth-top__guide">{guide}</span>}
        <span className="hth-top__presence">
          <HearthStatus tone={model.desktop.mark === 'on' ? 'on' : 'off'}>
            {model.desktop.text}
          </HearthStatus>
        </span>
      </header>

      {board ? (
        <HearthBoard />
      ) : (
        <main className="hth-main">
          <div className="hth-main__wire">
            <HearthCard
              title="连接模型"
              note="先挑一家，再填它的模型名与 Key。"
              aside={<HearthConnectionStatus model={model} />}
            >
              <HearthProvider model={model} />
              <HearthConnect model={model} />
            </HearthCard>
            <HearthColors theme={theme} />
          </div>
          <div className="hth-main__side">
            <HearthPet model={model} />
          </div>
        </main>
      )}

      <footer className="hth-foot">
        <span className="hth-foot__note">
          {model.available
            ? model.dirty
              ? '这一家的改动还没写进这台机器'
              : '这台机器的配置已读到'
            : '这台机器还没有模型连接的通道'}
        </span>
        {model.paused ? (
          <span className="hth-flag" data-testid="foot-paused">
            回应已暂停
          </span>
        ) : null}
      </footer>
    </div>
  );
}

export const HEARTH_FAMILY: StyleFamily = {
  id: 'hearth',
  name: '炉边',
  description: '温暖的宠物产品世界：柔底字段、大选择卡（真 radio）、胶囊开关与厚卡。',
  Component: HearthFamily,
};

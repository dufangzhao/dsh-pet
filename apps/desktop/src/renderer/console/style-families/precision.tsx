/**
 * Precision：仪器化的控制台。系统无衬线 + 等宽机位号、平直描边动作、原生下拉挑服务、
 * 左列表右详情分屏、一行一事的读数与插销开关、顶部挡位导航（一次只看一个分区）。
 *
 * 这一族不借 pet bench 的板件，也不与 Folio 共用任何一个控件构造：挑服务是 <select> 加表格行，
 * 开关是 role=switch 的一行，状态是 dt/dd 读数，导航是挡位；
 * Folio 那边是文字目录、划勾选择、通栏章节与目次导航，元素层级完全不同。
 *
 * 状态与动作全部来自 StartModel 与 style-families 的两个 headless 适配器：
 * 草稿、所有者、录音会话都住在这一层之上，这里只决定怎么画、怎么按。
 */
import '../style-families/character.css';
import './precision.css';

import { useId, useState, type JSX, type ReactNode } from 'react';

import { PetAvatar } from '../../pet/PetAvatar.js';
import {
  THEME_APPEARANCE_LABELS,
  THEME_MODE_NAMES,
  allSchemes,
  groupedThemeTokens,
} from '../theme.js';
import { FAMILY_PREVIEW_TESTIDS, useFamilyPreview } from './use-family-preview.js';
import { useFamilyTheme, type FamilyThemeSeed } from './use-family-theme.js';

import type { ThemeMode } from '../theme.js';
import type { StartModel } from '../start-designs/use-start-model.js';
import { MARK_TEXT, activeNote, providerNote } from '../start-designs/behavior.js';

import type { FamilyProps } from './contracts.js';

/** 呈现种子：仪器灰加钢青，浅与黑各一份。只贴在这一扇窗的根节点上，换家族不写本机记录。 */
export const PRECISION_SEED: FamilyThemeSeed = {
  light: {
    paper: '#f1f2f3',
    'paper-2': '#e8eaeb',
    sheet: '#fafbfb',
    'sheet-2': '#f2f4f5',
    'sheet-3': '#e3e6e9',
    ink: '#14181b',
    'ink-soft': '#47515a',
    'ink-dim': '#6c767f',
    line: '#d5d9dc',
    'line-2': '#bbc2c8',
    'line-strong': '#767f89',
    accent: '#245d7c',
    'accent-2': '#173f59',
    'on-accent': '#f4f9fb',
  },
  dark: {
    paper: '#191c1f',
    'paper-2': '#141719',
    sheet: '#1f2428',
    'sheet-2': '#252b30',
    'sheet-3': '#2c3338',
    ink: '#e8edf1',
    'ink-soft': '#b3bdc6',
    'ink-dim': '#8b969f',
    line: '#333c43',
    'line-2': '#414c54',
    'line-strong': '#6d7a84',
    accent: '#66b0d6',
    'accent-2': '#8fcbe8',
    'on-accent': '#0e1519',
  },
};

/** 评审用：整窗之外还能单独要这一族的控件与状态板。 */
export interface PrecisionFamilyProps extends FamilyProps {
  /** 「使用向导」由评审外壳给（它才持有应用所有者）；没给就不画，不演一颗按得动的假按钮。 */
  readonly guide?: ReactNode | undefined;
  /** 评审与走查要逐分区取样：这只是初始挡位，切换仍然由这一族的导航自己管。 */
  readonly openPanel?: Panel | undefined;
}

export type Panel = 'connect' | 'presence' | 'palette' | 'board';

const PANELS: ReadonlyArray<{ id: Panel; label: string; hint: string }> = [
  { id: 'connect', label: '接线', hint: '服务目录与这一家的端点' },
  { id: 'presence', label: '在场', hint: '桌面预览、回应、说话与录音' },
  { id: 'palette', label: '配色', hint: '36 格调色与本机方案' },
  { id: 'board', label: '控件板', hint: '这一族控件的真实状态' },
];

const PHASE_TEXT: Readonly<Record<string, string>> = {
  'no-bridge': '通道未接',
  loading: '读取中',
  'read-failed': '读取失败',
  'nothing-yet': '未接入',
  'saved-only': '已存未用',
  'in-use': '运行中',
  'in-use-paused': '运行中·暂缓',
};

const STATE_TEXT: Readonly<Record<string, string>> = {
  idle: '待着',
  listening: '在听',
  thinking: '在想',
  replying: '在说',
  error: '出错了',
};

export function PrecisionFamily({
  model,
  board,
  guide,
  openPanel = 'connect',
}: PrecisionFamilyProps): JSX.Element {
  const theme = useFamilyTheme(PRECISION_SEED);
  const [panel, setPanel] = useState<Panel>(openPanel);
  const shown: Panel = board ? 'board' : panel;

  return (
    <div
      className="sf-precision"
      style={theme.vars}
      data-color-scheme={theme.colorScheme}
      data-panel={shown}
      data-seeded={theme.seeded ? 'true' : 'false'}
      data-testid="sf-precision"
    >
      <header className="px-bar">
        <span className="px-bar__brand">
          <i className="px-bar__mark" aria-hidden="true" />
          PRECISION
          <span className="px-bar__sub">桌面宠物控制台</span>
        </span>
        <StatusStrip model={model} />
        <span className="px-bar__tail">{guide ?? null}</span>
      </header>

      <nav className="px-panels" aria-label="控制台分区">
        <div className="px-panels__tabs" role="tablist" aria-orientation="horizontal">
          {PANELS.map((item) => {
            const on = item.id === shown;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={'px-tab-' + item.id}
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                className={on ? 'px-tab is-on' : 'px-tab'}
                title={item.hint}
                data-testid={'px-panel-' + item.id}
                onClick={() => setPanel(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <span className="px-panels__note" data-testid="px-panel-note">
          {board
            ? '控件板只演示这一族控件自身的样子与状态，不写本机、不发请求。'
            : '一次一个分区；换分区不改状态，正在输入的草稿还在。'}
        </span>
      </nav>

      <main
        className="px-body"
        id={'px-region-' + shown}
        role="region"
        aria-labelledby={'px-tab-' + shown}
      >
        {shown === 'connect' ? <ConnectPanel model={model} /> : null}
        {shown === 'presence' ? <PresencePanel model={model} /> : null}
        {shown === 'palette' ? <PalettePanel theme={theme} /> : null}
        {shown === 'board' ? <PrecisionBoard /> : null}
      </main>

      <footer className="px-foot">
        <span className="px-foot__cell">Precision / 仪器版</span>
        <span
          className="px-foot__cell"
          data-tone={theme.seeded ? 'seed' : 'record'}
          data-testid="px-theme-source"
        >
          {theme.seeded ? '配色＝这一族的呈现种子' : '配色＝本机记录'}
        </span>
        <span className="px-foot__fill" aria-hidden="true" />
        <span className="px-foot__cell" data-testid="px-foot-phase">
          {PHASE_TEXT[model.phase] ?? '状态未知'}
        </span>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- 标题条读数 */

function StatusStrip({ model }: { model: StartModel }): JSX.Element {
  const paused = model.phase === 'in-use-paused';
  return (
    <dl className="px-strip" data-testid="start-status">
      <Cell
        k="在用"
        v={model.snapshotLabel ?? '—'}
        tone={model.phase === 'in-use' || paused ? 'live' : 'idle'}
      />
      <Cell
        k="回应"
        v={paused ? '暂缓' : '正常'}
        tone={paused ? 'warn' : 'idle'}
        testid="start-paused"
      />
      {model.notice === null ? null : (
        <Cell k="宿主" v={model.notice} tone="info" testid="start-notice" />
      )}
      {model.error === null ? null : (
        <Cell k="读取" v={model.error} tone="bad" testid="start-error" />
      )}
    </dl>
  );
}

function Cell({
  k,
  v,
  tone,
  testid,
}: {
  k: string;
  v: ReactNode;
  tone: 'live' | 'idle' | 'warn' | 'info' | 'bad';
  testid?: string | undefined;
}): JSX.Element {
  return (
    <div
      className="px-strip__cell"
      data-tone={tone}
      {...(testid === undefined ? {} : { 'data-testid': testid })}
    >
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ 平直控件 */

interface PxButtonProps {
  tone?: 'outline' | 'solid' | 'ghost' | 'danger' | undefined;
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  testid?: string | undefined;
  title?: string | undefined;
  onPress?: () => void;
  children: ReactNode;
}

/**
 * 描边动作：一根线框，没有板底、没有下压位移——按下只换线色与底色。
 * solid 一屏最多一颗（保存并开始 / 登录）；ghost 只有一根下划线，用在行内。
 */
function PxButton({
  tone = 'outline',
  busy = false,
  disabled = false,
  type = 'button',
  testid,
  title,
  onPress,
  children,
}: PxButtonProps): JSX.Element {
  return (
    <button
      type={type}
      className={'px-btn px-btn--' + tone}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      title={title}
      data-testid={testid}
      data-tone={tone}
      {...(onPress === undefined ? {} : { onClick: onPress })}
    >
      {busy ? <i className="px-busy" aria-hidden="true" /> : null}
      <span className="px-btn__text">{children}</span>
    </button>
  );
}

interface PxFieldProps {
  label: string;
  value: string;
  onChange(next: string): void;
  hint?: string | undefined;
  error?: string | undefined;
  kind?: 'text' | 'password' | 'search';
  mono?: boolean;
  disabled?: boolean;
  placeholder?: string | undefined;
  list?: string | undefined;
  testid?: string | undefined;
  ariaLabel?: string | undefined;
}

/** 上标签、下读数的字段：名称只进 label，补充与失败原因走 aria-describedby。 */
function PxField({
  label,
  value,
  onChange,
  hint,
  error,
  kind = 'text',
  mono = false,
  disabled = false,
  placeholder,
  list,
  testid,
  ariaLabel,
}: PxFieldProps): JSX.Element {
  const id = useId();
  const noteId = id + '-note';
  const hasNote = hint !== undefined || error !== undefined;
  return (
    <div
      className="px-field"
      data-mono={mono ? 'true' : 'false'}
      data-state={error === undefined ? 'idle' : 'bad'}
    >
      <label className="px-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="px-input"
        type={kind}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        list={list}
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={error !== undefined || undefined}
        {...(hasNote ? { 'aria-describedby': noteId } : {})}
        data-testid={testid}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hasNote ? (
        <p className="px-field__note" id={noteId} data-tone={error === undefined ? 'hint' : 'bad'}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

/** 一行一事的插销开关：整行是 label，方销在右，值另外用文字写一遍。 */
function PxSwitchRow({
  label,
  hint,
  pressed,
  disabled = false,
  testid,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  pressed: boolean;
  disabled?: boolean;
  testid?: string | undefined;
  onChange(next: boolean): void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="px-row" data-pressed={pressed ? 'true' : 'false'}>
      <label className="px-row__label" htmlFor={id}>
        <span className="px-row__name">{label}</span>
        {hint === undefined ? null : <span className="px-row__hint">{hint}</span>}
      </label>
      <span className="px-switch" aria-hidden="true">
        <input
          id={id}
          className="px-switch__input"
          type="checkbox"
          role="switch"
          checked={pressed}
          disabled={disabled}
          data-testid={testid}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <i className="px-switch__knob" />
      </span>
      <span className="px-row__value" data-tone={pressed ? 'on' : 'off'}>
        {pressed ? '开' : '关'}
      </span>
    </div>
  );
}

/** 原生下拉：可用性与平台写在 option 文案里，接不进来的那一行 disabled。 */
function PxSelect({
  label,
  value,
  options,
  hint,
  testid,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; text: string; disabled?: boolean }>;
  hint?: string | undefined;
  testid?: string | undefined;
  onChange(next: string): void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="px-field">
      <label className="px-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="px-selectwrap">
        <select
          id={id}
          className="px-select"
          value={value}
          {...(hint === undefined ? {} : { 'aria-describedby': id + '-hint' })}
          data-testid={testid}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {options.length === 0 ? <option value="">目录为空</option> : null}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled === true ? true : undefined}
            >
              {option.text}
            </option>
          ))}
        </select>
        <i className="px-selectwrap__caret" aria-hidden="true" />
      </span>
      {hint === undefined ? null : (
        <p className="px-field__note" id={id + '-hint'} data-tone="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** dt/dd 读数：端点信息、遥测、回执都用这一个形状，值永远跟在一个事实后面。 */
function PxMeasure({
  rows,
  testid,
}: {
  rows: Array<{ k: string; v: ReactNode; tone?: 'live' | 'idle' | 'warn' | 'bad' | 'ok' }>;
  testid?: string | undefined;
}): JSX.Element {
  return (
    <dl className="px-measure" data-testid={testid}>
      {rows.map((row) => (
        <div className="px-measure__row" key={row.k} data-tone={row.tone ?? 'idle'}>
          <dt>{row.k}</dt>
          <dd>{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PxNote({
  tone,
  testid,
  children,
}: {
  tone: 'info' | 'warn' | 'bad' | 'ok';
  testid?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <p
      className="px-note"
      data-tone={tone}
      role={tone === 'bad' ? 'alert' : 'status'}
      data-testid={testid}
    >
      {children}
    </p>
  );
}

function ColumnHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode | undefined;
}): JSX.Element {
  return (
    <div className="px-col__head">
      <h2 className="px-col__title">{title}</h2>
      {aside ?? null}
    </div>
  );
}

/* -------------------------------------------------------------------- 接线面板 */

function ConnectPanel({ model }: { model: StartModel }): JSX.Element {
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const rows = onlyAvailable
    ? model.choices.filter((choice) => choice.service.available)
    : model.choices;

  return (
    <div className="px-split">
      <section className="px-col" aria-label="服务目录" data-testid="start-provider">
        <ColumnHead
          title="服务目录"
          aside={
            <span className="px-count" data-testid="model-provider-count">
              {rows.length + ' / ' + model.rows.length + ' 家'}
            </span>
          }
        />

        <PxSelect
          label="挑一家"
          value={model.picked?.id ?? ''}
          hint="原生下拉：方向键选，选中即换这一家；接不进来的看得见但选不到。"
          testid="model-provider-select"
          onChange={model.pick}
          options={model.choices.map((choice) => ({
            value: choice.service.id,
            text:
              choice.service.label +
              ' · ' +
              (choice.service.region === 'cn' ? '中国大陆平台' : '国际平台') +
              ' · ' +
              MARK_TEXT[choice.mark],
            disabled: !choice.service.available,
          }))}
        />

        <PxField
          label="筛目录"
          kind="search"
          value={model.query}
          placeholder="名称、标识或模型名"
          ariaLabel="筛服务"
          hint="空白就是整份目录。"
          testid="model-provider-search"
          onChange={model.setQuery}
        />

        <PxSwitchRow
          label="只看接得进来的"
          pressed={onlyAvailable}
          testid="px-filter-available"
          onChange={setOnlyAvailable}
        />

        {rows.length === 0 ? (
          <PxNote tone="warn" testid="model-provider-empty">
            {'目录里没有符合「' +
              model.query.trim() +
              '」的服务。改一个字试试，或去管理模型扩展看看这家接进来了没有。'}
          </PxNote>
        ) : (
          <table className="px-table">
            <thead>
              <tr>
                <th scope="col" className="px-table__th px-table__th--idx">
                  序
                </th>
                <th scope="col" className="px-table__th">
                  服务
                </th>
                <th scope="col" className="px-table__th px-table__th--mono">
                  端点标识
                </th>
                <th scope="col" className="px-table__th">
                  此刻
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((choice, index) => (
                <tr
                  key={choice.service.id}
                  data-selected={choice.current ? 'true' : 'false'}
                  aria-current={choice.current ? 'true' : undefined}
                >
                  <td className="px-table__idx">{String(index + 1).padStart(2, '0')}</td>
                  <td>
                    <button
                      type="button"
                      className="px-rowbtn"
                      disabled={!choice.service.available}
                      title={choice.service.unavailableReason ?? choice.service.label}
                      data-testid={'model-pick-' + choice.service.id}
                      onClick={() => {
                        model.pick(choice.service.id);
                      }}
                    >
                      {choice.service.label}
                    </button>
                  </td>
                  <td className="px-table__mono">{choice.service.id}</td>
                  <td className="px-table__state" data-mark={choice.mark}>
                    {providerNote(choice.mark, choice.service.auth, choice.dirty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <DetailColumn model={model} />
    </div>
  );
}

/** 右栏：正在挑的这一家的端点、凭据、动作与回执。 */
function DetailColumn({ model }: { model: StartModel }): JSX.Element {
  if (!model.available) {
    return (
      <section className="px-col px-col--detail" data-testid="start-connect-empty">
        <ColumnHead title="端点详情" />
        <PxNote tone="warn">这台机器还没有模型连接的通道，所以这里没有可填的端点表单。</PxNote>
      </section>
    );
  }
  if (model.picked === undefined) {
    return (
      <section className="px-col px-col--detail" data-testid="start-connect-empty">
        <ColumnHead title="端点详情" />
        <PxNote tone="info">
          {model.loading ? '正在读这台机器的模型配置…' : '目录里还没有可接的服务。'}
        </PxNote>
      </section>
    );
  }

  const picked = model.picked;
  const browserSignIn = picked.auth === 'browser';
  const using = model.saved === null ? null : whoUsing(model);

  return (
    <section
      className="px-col px-col--detail"
      aria-label="端点详情"
      data-testid="start-connect-form"
    >
      <ColumnHead
        title={picked.label}
        aside={
          <span className="px-tag" data-mark={model.mark ?? 'draft'} data-testid="px-detail-mark">
            {model.mark === null ? '—' : MARK_TEXT[model.mark]}
          </span>
        }
      />

      <PxMeasure
        rows={[
          { k: '端点标识', v: <code>{picked.id}</code> },
          { k: '平台', v: picked.region === 'cn' ? '中国大陆' : '国际' },
          { k: '接入方式', v: browserSignIn ? '浏览器登录' : 'API Key' },
          {
            k: '本机 Key',
            v: model.keySaved ? '已存' : '没有',
            tone: model.keySaved ? 'ok' : 'idle',
          },
          {
            k: '改动',
            v: model.dirty ? '有，还没保存' : '与本机一致',
            tone: model.dirty ? 'warn' : 'idle',
          },
        ]}
      />

      {browserSignIn ? (
        <div className="px-actions" data-testid="px-signin-block">
          <PxButton
            tone="solid"
            busy={model.busy.signingIn}
            disabled={!model.can.signIn}
            testid="model-signin"
            onPress={model.signIn}
          >
            {model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
          </PxButton>
          {model.busy.signingIn ? (
            <PxButton testid="model-signin-cancel" onPress={model.cancelSignIn}>
              取消这次登录
            </PxButton>
          ) : null}
          {model.can.signIn ? null : <PxNote tone="warn">{model.reasons.signIn}</PxNote>}
        </div>
      ) : (
        <form
          className="px-form"
          onSubmit={(event) => {
            event.preventDefault();
            model.save();
          }}
        >
          <PxField
            label="模型名"
            mono
            value={model.model}
            list="px-model-list"
            hint={picked.models.length > 0 ? '可以直接打，也可以从这家列出的名字里挑。' : undefined}
            error={model.model.trim() === '' ? '模型名不能空着。' : undefined}
            testid="model-input"
            onChange={model.setModel}
          />
          <datalist id="px-model-list">
            {picked.models.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <PxField
            label={picked.label + ' 的 API Key'}
            kind="password"
            mono
            value={model.key}
            disabled={model.keyBlock !== null || model.busy.saving}
            hint={
              model.inUse
                ? '留空就沿用这台机器上已经存着的那一份。'
                : model.keySaved
                  ? '这家在本机存过 Key；填新的会覆盖它。'
                  : picked.keyHint
            }
            error={model.keyBlock ?? undefined}
            testid="key-input"
            onChange={model.setKey}
          />

          <div className="px-actions">
            <PxButton
              type="submit"
              tone="solid"
              busy={model.busy.saving}
              disabled={!model.can.save}
              testid="model-save"
            >
              {model.busy.saving ? '正在写入这台机器…' : '保存并开始'}
            </PxButton>
            <PxButton
              busy={model.busy.testing}
              disabled={!model.can.test}
              testid="model-test"
              onPress={model.test}
            >
              {model.busy.testing ? '正在探测…' : '测试连接'}
            </PxButton>
          </div>
        </form>
      )}

      <div className="px-actions px-actions--quiet">
        <PxButton tone="ghost" testid="model-getkey" onPress={model.openKeyPage}>
          {'去 ' + picked.label + ' 申请 Key'}
        </PxButton>
        {model.sibling === undefined ? null : (
          <PxButton tone="ghost" testid="model-region" onPress={model.switchRegion}>
            {picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </PxButton>
        )}
        <PxButton tone="ghost" testid="model-manage" onPress={model.openPlugins}>
          管理模型扩展
        </PxButton>
        <PxButton tone="ghost" testid="model-refresh" onPress={model.refresh}>
          重新读取
        </PxButton>
      </div>

      {model.signing === null ? null : (
        <PxNote tone="info" testid="model-signin-line">
          {model.signing}
        </PxNote>
      )}
      {model.can.test ? null : (
        <PxNote tone="warn" testid="model-test-reason">
          {model.reasons.test}
        </PxNote>
      )}
      {model.can.save || browserSignIn ? null : (
        <PxNote tone="warn" testid="model-save-reason">
          {model.reasons.save}
        </PxNote>
      )}
      {model.tested === null ? null : (
        <PxNote tone={model.tested.passed ? 'ok' : 'bad'} testid="model-test-line">
          {model.tested.text}
        </PxNote>
      )}
      {model.saved === null ? null : (
        <div className="px-receipt" data-testid="model-receipt">
          <h3 className="px-receipt__title">这一次的结果</h3>
          <PxMeasure
            rows={[
              {
                k: '写进本机',
                v: model.saved.saved ? '已保存' : '没保存',
                tone: model.saved.saved ? 'ok' : 'bad',
              },
              {
                k: '本次探测',
                v: model.saved.tested ? '通过' : '没通过',
                tone: model.saved.tested ? 'ok' : 'warn',
              },
              { k: '现在在用', v: using?.text ?? '—', tone: using?.tone ?? 'idle' },
            ]}
          />
          <p className="px-receipt__line" role="status">
            {model.saved.text}
          </p>
        </div>
      )}
    </section>
  );
}

function whoUsing(model: StartModel): { tone: 'ok' | 'warn' | 'idle'; text: string } {
  const note = activeNote({
    receiptActive: model.saved?.active === true || model.activeId === model.saveTargetId,
    activeId: model.activeId,
    activeLabel: model.activeLabel,
    writtenId: model.saveTargetId ?? '',
  });
  return {
    tone: note.tone === 'on' ? 'ok' : note.tone === 'warn' ? 'warn' : 'idle',
    text: note.text,
  };
}

/* -------------------------------------------------------------------- 在场面板 */

function PresencePanel({ model }: { model: StartModel }): JSX.Element {
  const view = useFamilyPreview(model);

  if (!view.available) {
    return (
      <section className="px-col" data-testid="start-pet">
        <ColumnHead title="在场" />
        <PxNote tone="warn">这一页还没连上应用，所以看不见桌面上是哪一只，也戳不到它。</PxNote>
      </section>
    );
  }

  return (
    <div className="px-split px-split--presence" data-testid="start-pet" ref={view.menu.ref}>
      <section className="px-col" aria-label="预览">
        <ColumnHead
          title="桌面上这一只"
          aside={
            <span
              className="px-tag"
              data-mark={model.desktop.mark === 'on' ? 'in-use' : 'unavailable'}
            >
              {model.desktop.text}
            </span>
          }
        />

        <div
          className="px-stage"
          ref={view.stage.ref}
          data-light={view.stage['data-light']}
          data-draggable={view.draggable ? 'true' : 'false'}
          aria-label={view.stage['aria-label']}
          data-testid={FAMILY_PREVIEW_TESTIDS.stage}
          onPointerLeave={view.stage.onPointerLeave}
          onBlur={view.stage.onBlur}
          onContextMenu={view.stage.onContextMenu}
        >
          <button
            type="button"
            className="px-figure"
            style={view.avatar.style}
            aria-label={view.avatar['aria-label']}
            title={view.avatar.title}
            data-testid={FAMILY_PREVIEW_TESTIDS.avatar}
            onPointerDown={view.avatar.onPointerDown}
            onPointerMove={view.avatar.onPointerMove}
            onPointerUp={view.avatar.onPointerUp}
            onPointerCancel={view.avatar.onPointerCancel}
            onClick={view.avatar.onClick}
            onKeyDown={view.avatar.onKeyDown}
          >
            <span
              className="px-figure__body sf-figure"
              data-size={view.figure.figure === 'round' ? 'normal' : 'normal'}
              style={view.figure.vars}
            >
              <PetAvatar
                state={view.figure.state}
                expression={view.figure.expression}
                figure={view.figure.figure}
                name={view.figure.name}
              />
            </span>
          </button>
          {view.bubble === null ? null : (
            <p className="px-bubble" role="status" data-testid="px-bubble">
              {view.bubble}
            </p>
          )}
          <span className="px-stage__ground" aria-hidden="true" />
        </div>

        <PxMeasure
          testid="px-presence-readout"
          rows={[
            { k: '角色状态', v: STATE_TEXT[view.figure.state] ?? view.figure.state, tone: 'live' },
            {
              k: '表情',
              v: view.figure.expression === 'neutral' ? '—' : view.figure.expression,
            },
            { k: '形态', v: view.figure.figure === 'round' ? '圆头' : '简约' },
            {
              k: '说话',
              v: view.composer.present
                ? view.composer.canSend
                  ? '可以发'
                  : '现在还不能发'
                : '会话未接',
              tone: view.composer.present && view.composer.canSend ? 'ok' : 'idle',
            },
            {
              k: '录音',
              v: view.mic.present
                ? view.mic.disabled
                  ? '现在不能录'
                  : view.mic.pressed
                    ? '正在录'
                    : '可以录'
                : '会话未接',
              tone: view.mic.present && !view.mic.disabled ? 'ok' : 'idle',
            },
          ]}
        />
      </section>

      <section className="px-col px-col--rail" aria-label="桌面动作">
        <ColumnHead title="这一格的控制" />

        <div className="px-rows">
          <PxSwitchRow
            label="暂时不回应"
            hint="只是让它先不开口；录音入口与预览都还在这一格里。"
            pressed={model.paused}
            disabled={model.busy.pausing}
            testid="pet-pause"
            onChange={model.togglePaused}
          />
          <PxSwitchRow
            label="这块预览的灯"
            hint="只改这一格的明暗，不动控制台挡位，也不动桌面。"
            pressed={view.night}
            testid={FAMILY_PREVIEW_TESTIDS.light}
            onChange={view.setNight}
          />
        </div>

        <div className="px-actions">
          <PxButton
            busy={model.busy.visibility}
            disabled={!model.desktopShown}
            testid="pet-hide"
            onPress={() => {
              model.setDesktopVisible(false);
            }}
          >
            在桌面隐藏
          </PxButton>
          <PxButton
            busy={model.busy.visibility}
            disabled={model.desktopShown}
            testid="pet-show"
            onPress={() => {
              model.setDesktopVisible(true);
            }}
          >
            在桌面显示
          </PxButton>
        </div>

        <div className="px-actions px-actions--quiet">
          {view.entries.dress === undefined ? null : (
            <PxButton tone="ghost" testid="pet-dress" onPress={view.entries.dress}>
              装扮
            </PxButton>
          )}
          {view.entries.voice === undefined ? null : (
            <PxButton tone="ghost" testid="pet-voice" onPress={view.entries.voice}>
              语音输入设置
            </PxButton>
          )}
          <PxButton tone="ghost" testid={FAMILY_PREVIEW_TESTIDS.menu} onPress={view.menu.toggle}>
            {view.menu.open ? '收起预览菜单' : '预览菜单'}
          </PxButton>
        </div>

        {view.menu.open ? (
          <div className="px-menu" role="group" aria-label="预览菜单" data-testid="px-menu-body">
            <p className="px-menu__line">右键这一格或按菜单键都可以再收起来。</p>
            <div className="px-actions">
              <PxButton
                testid={FAMILY_PREVIEW_TESTIDS.chat}
                onPress={() => {
                  view.composer.setOpen(!view.composer.open);
                }}
              >
                {view.composer.open ? '收起这句话' : '写一句话给它'}
              </PxButton>
            </div>
          </div>
        ) : null}

        {view.composer.present ? (
          <div className="px-inline">
            <label className="px-field__label" htmlFor="px-composer-input">
              {view.composer.label}
            </label>
            <input
              id="px-composer-input"
              className="px-input"
              type="text"
              value={view.composer.text}
              placeholder={view.composer.placeholder}
              aria-label={view.composer.label}
              data-testid={FAMILY_PREVIEW_TESTIDS.composer}
              onChange={(event) => {
                view.composer.setText(event.target.value);
              }}
              onKeyDown={view.composer.onKeyDown}
            />
            <PxButton
              tone="solid"
              busy={view.composer.sending}
              disabled={!view.composer.canSubmit}
              testid={FAMILY_PREVIEW_TESTIDS.send}
              onPress={view.composer.send}
            >
              {view.composer.sending ? '正在发…' : '发送'}
            </PxButton>
            {!view.composer.canSend ? (
              <p className="px-field__note" data-tone="hint">
                {view.composer.hint}
              </p>
            ) : null}
          </div>
        ) : (
          <PxNote tone="info">这条会话现在不在，所以这一格里没有可发的文字。</PxNote>
        )}

        {view.mic.present ? (
          <div className="px-inline">
            <PxButton
              tone={view.mic.pressed ? 'danger' : 'outline'}
              disabled={view.mic.disabled}
              title={view.mic.hint}
              testid={FAMILY_PREVIEW_TESTIDS.mic}
              onPress={view.mic.toggle}
            >
              {view.mic.label}
            </PxButton>
            {view.mic.pressed ? (
              <PxButton
                tone="ghost"
                testid={FAMILY_PREVIEW_TESTIDS.micCancel}
                onPress={view.mic.cancel}
              >
                取消这次录音
              </PxButton>
            ) : null}
            <p className="px-inline__hint">{view.mic.hint}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- 配色面板 */

const TOKEN_GROUPS = groupedThemeTokens();

function PalettePanel({ theme }: { theme: ReturnType<typeof useFamilyTheme> }): JSX.Element {
  const { snapshot, actions } = theme;
  const schemes = allSchemes(snapshot.record);
  const modes: ThemeMode[] = ['light', 'dark', 'system'];

  return (
    <div className="px-palette" data-testid="start-theme">
      <section className="px-col" aria-label="挡位与方案">
        <ColumnHead
          title="配色"
          aside={
            <span className="px-tag" data-tone={snapshot.status.tone} data-testid="px-theme-status">
              {snapshot.status.text}
            </span>
          }
        />

        <fieldset className="px-fieldset">
          <legend className="px-fieldset__legend">挡位</legend>
          {modes.map((mode) => (
            <label
              className="px-radio"
              key={mode}
              data-checked={snapshot.record.mode === mode ? 'true' : 'false'}
            >
              <input
                type="radio"
                name="px-theme-mode"
                value={mode}
                checked={snapshot.record.mode === mode}
                data-testid={'theme-mode-' + mode}
                onChange={() => {
                  actions.chooseMode(mode);
                }}
              />
              <span className="px-radio__box" aria-hidden="true" />
              <span className="px-radio__text">
                {THEME_MODE_NAMES[mode]}
                <i className="px-radio__glyph" aria-hidden="true" />
              </span>
            </label>
          ))}
        </fieldset>

        <PxSelect
          label="方案"
          value={snapshot.schemeId}
          hint="内置方案不可覆盖；调色后另存为自定义才写本机。"
          testid="theme-scheme-select"
          onChange={actions.chooseScheme}
          options={schemes.map((scheme) => ({ value: scheme.id, text: scheme.name }))}
        />

        <PxField
          label="方案名"
          value={snapshot.name}
          hint={
            '浅色与黑夜是两份各自保存的配色；这一格改的是「' +
            THEME_APPEARANCE_LABELS[snapshot.appearance] +
            '」。'
          }
          testid="theme-name"
          onChange={actions.setName}
        />

        <div className="px-swatches" data-testid="theme-swatches">
          {TOKEN_GROUPS.map((group) => (
            <span className="px-swatches__group" key={group.group}>
              {group.tokens.slice(0, 6).map((token) => (
                <i
                  className="px-swatches__chip"
                  key={token.key}
                  title={token.label + ' · ' + (snapshot.draft[token.key] ?? '')}
                  style={{ backgroundColor: snapshot.draft[token.key] ?? '#000000' }}
                />
              ))}
            </span>
          ))}
        </div>

        <div className="px-actions">
          <PxButton tone="solid" testid="theme-save" onPress={actions.save}>
            保存到本机
          </PxButton>
          <PxButton testid="theme-copy" onPress={actions.copyAsNew}>
            另存为自定义
          </PxButton>
          <PxButton
            disabled={!snapshot.previewActive}
            testid="theme-undo"
            onPress={actions.undoPreview}
          >
            撤销未保存的试色
          </PxButton>
          <PxButton
            tone={snapshot.deleteArmed ? 'danger' : 'outline'}
            disabled={!snapshot.canWrite}
            testid="theme-delete"
            onPress={actions.requestDelete}
          >
            {snapshot.deleteArmed ? '再点一次确认删除' : '删除这个自定义方案'}
          </PxButton>
        </div>
      </section>

      <section className="px-col px-col--tokens" aria-label="36 格调色">
        <ColumnHead
          title="36 格"
          aside={
            <span className="px-count" data-testid="px-token-count">
              {Object.keys(snapshot.draft).length + ' 格 · ' + TOKEN_GROUPS.length + ' 组'}
            </span>
          }
        />
        {TOKEN_GROUPS.map((group) => (
          <div className="px-group" key={group.group}>
            <h3 className="px-group__title">{group.group}</h3>
            <table className="px-table px-table--tokens">
              <tbody>
                {group.tokens.map((token) => {
                  const value = snapshot.draft[token.key] ?? '';
                  const typed = snapshot.hexText[token.key] ?? value.toUpperCase();
                  const invalid = snapshot.invalidKeys.has(token.key);
                  return (
                    <tr key={token.key} data-invalid={invalid ? 'true' : 'false'}>
                      <td className="px-table__label">
                        <span>{token.label}</span>
                        <code>{'--' + token.key}</code>
                      </td>
                      <td>
                        <input
                          className="px-color"
                          type="color"
                          value={value}
                          aria-label={token.label + ' 的取色器'}
                          data-testid={'theme-token-' + token.key}
                          onChange={(event) => {
                            actions.editToken(token.key, event.target.value, 'picker');
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="px-input px-input--hex"
                          type="text"
                          value={typed}
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={token.label + ' 的十六进制'}
                          aria-invalid={invalid || undefined}
                          data-testid={'theme-hex-' + token.key}
                          onChange={(event) => {
                            actions.editToken(token.key, event.target.value, 'hex');
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- 控件板 */

/**
 * 这一族的控件状态板：每一颗都是上面那几个控件本身，能按、能填、能开。
 * 样例只演示外观：不写本机、不发请求，所以这里没有任何"已保存"式的假回执。
 */
function PrecisionBoard(): JSX.Element {
  const [pressed, setPressed] = useState(true);
  const [pending, setPending] = useState(false);
  const [choice, setChoice] = useState('steel');

  return (
    <div className="px-board" data-testid="px-board" data-sample="true">
      <section className="px-board__block" aria-label="动作">
        <h2 className="px-col__title">动作</h2>
        <div className="px-actions">
          <PxButton testid="px-board-btn-outline">描边</PxButton>
          <PxButton tone="solid" testid="px-board-btn-solid">
            实心（一屏一颗）
          </PxButton>
          <PxButton tone="ghost" testid="px-board-btn-ghost">
            行内
          </PxButton>
          <PxButton tone="danger" testid="px-board-btn-danger">
            危险
          </PxButton>
          <PxButton disabled testid="px-board-btn-disabled">
            按不动
          </PxButton>
          <PxButton
            tone="solid"
            busy={pending}
            testid="px-board-btn-pending"
            onPress={() => {
              setPending(true);
              window.setTimeout(() => setPending(false), 900);
            }}
          >
            {pending ? '正在等结果…' : '按下演示等待态'}
          </PxButton>
        </div>
      </section>

      <section className="px-board__block" aria-label="字段与下拉">
        <h2 className="px-col__title">输入</h2>
        <div className="px-board__pair">
          <PxField
            label="正常"
            mono
            value="deepseek-flash"
            testid="px-board-field"
            onChange={() => undefined}
          />
          <PxField
            label="带补充"
            value=""
            hint="空白就是一种状态，不是失败。"
            testid="px-board-field-hint"
            onChange={() => undefined}
          />
          <PxField
            label="失败原因写在下面"
            value=""
            error="模型名不能空着。"
            testid="px-board-field-error"
            onChange={() => undefined}
          />
          <PxField
            label="不可用"
            value="sk-..."
            disabled
            testid="px-board-field-disabled"
            onChange={() => undefined}
          />
          <PxSelect
            label="原生下拉"
            value={choice}
            testid="px-board-select"
            onChange={setChoice}
            options={[
              { value: 'steel', text: '钢青 · 默认' },
              { value: 'slate', text: '石板 · 备选' },
              { value: 'none', text: '这一项选不到', disabled: true },
            ]}
          />
        </div>
      </section>

      <section className="px-board__block" aria-label="开关与读数">
        <h2 className="px-col__title">一行一事</h2>
        <div className="px-rows">
          <PxSwitchRow
            label="开着的插销"
            pressed={pressed}
            testid="px-board-switch"
            onChange={setPressed}
          />
          <PxSwitchRow
            label="关着的插销"
            pressed={!pressed}
            testid="px-board-switch-off"
            onChange={setPressed}
          />
          <PxSwitchRow
            label="按不动的插销"
            pressed
            hint="原因写在读数里，不靠颜色。"
            disabled
            testid="px-board-switch-disabled"
            onChange={() => undefined}
          />
        </div>
        <PxMeasure
          testid="px-board-measure"
          rows={[
            { k: '在用', v: 'DeepSeek · deepseek-flash', tone: 'live' },
            { k: '本次探测', v: '没通过', tone: 'warn' },
            { k: '写进本机', v: '没保存', tone: 'bad' },
            { k: '本机 Key', v: '已存', tone: 'ok' },
          ]}
        />
        <PxNote tone="info">这一段是样例：不写本机，也不代表任何后台结果。</PxNote>
      </section>

      <section className="px-board__block" aria-label="目录行">
        <h2 className="px-col__title">目录行</h2>
        <table className="px-table">
          <thead>
            <tr>
              <th scope="col" className="px-table__th px-table__th--idx">
                序
              </th>
              <th scope="col" className="px-table__th">
                服务
              </th>
              <th scope="col" className="px-table__th px-table__th--mono">
                端点标识
              </th>
              <th scope="col" className="px-table__th">
                此刻
              </th>
            </tr>
          </thead>
          <tbody>
            <tr data-selected="true" aria-current="true">
              <td className="px-table__idx">01</td>
              <td>
                <button type="button" className="px-rowbtn">
                  DeepSeek
                </button>
              </td>
              <td className="px-table__mono">deepseek-cn</td>
              <td className="px-table__state" data-mark="in-use">
                在用
              </td>
            </tr>
            <tr data-selected="false">
              <td className="px-table__idx">02</td>
              <td>
                <button type="button" className="px-rowbtn">
                  Moonshot
                </button>
              </td>
              <td className="px-table__mono">kimi-intl</td>
              <td className="px-table__state" data-mark="available">
                可选，填 API Key
              </td>
            </tr>
            <tr data-selected="false" data-disabled="true">
              <td className="px-table__idx">03</td>
              <td>
                <button type="button" className="px-rowbtn" disabled>
                  这一家还没接进来
                </button>
              </td>
              <td className="px-table__mono">none-yet</td>
              <td className="px-table__state" data-mark="unavailable">
                未接入
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

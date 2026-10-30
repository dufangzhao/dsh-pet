/**
 * Folio：一本摊开的册子。米色纸面、宋体系衬线标题、只有下划线的字段、
 * 用文字排的目录（没有下拉框也没有瓦片）、用勾作记号的选定、纯文字的动作词，
 * 回执是一张带骑缝线的单据；导航是左边的目次与页码，不是一排挡位。
 *
 * 这一族的控件与 Precision 不共用一个构造：那边的 <select>、表格行、插销开关、dt/dd 读数，
 * 这边一个都不用；这边是 <label> 包住的划线输入、条目式索引、勾选记号、文字动作与骑缝单据。
 * 也不借 pet bench 的板件（pb-*）与旧的 StartSlots / OriginalPreview / Studio。
 *
 * 状态与动作全部来自 StartModel 与 style-families 的两个 headless 适配器。
 */
import '../style-families/character.css';
import './folio.css';

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

import type { FamilyProps, StyleFamily } from './contracts.js';

/** 呈现种子：米色纸与墨色，浅与黑各一份（黑＝夜读纸，仍是纸，不是仪器灰）。 */
export const FOLIO_SEED: FamilyThemeSeed = {
  light: {
    paper: '#f4efe2',
    'paper-2': '#ece4d3',
    sheet: '#f9f5ea',
    'sheet-2': '#f1e9d9',
    'sheet-3': '#e6dcc7',
    ink: '#241d13',
    'ink-soft': '#4f4535',
    'ink-dim': '#7a6f5c',
    line: '#d9cfb9',
    'line-2': '#c3b79b',
    'line-strong': '#8c7f66',
    accent: '#7d4a1f',
    'accent-2': '#5c3514',
    'on-accent': '#faf4e8',
  },
  dark: {
    paper: '#1e1b16',
    'paper-2': '#17150f',
    sheet: '#242019',
    'sheet-2': '#2b261d',
    'sheet-3': '#332d22',
    ink: '#ece4d3',
    'ink-soft': '#c6bca6',
    'ink-dim': '#9a8f78',
    line: '#3c3528',
    'line-2': '#4b4232',
    'line-strong': '#7d7159',
    accent: '#d6a55c',
    'accent-2': '#e8c187',
    'on-accent': '#1c160c',
  },
};

/** 评审用：整本之外还能单独要这一族的控件样张。 */
export interface FolioFamilyProps extends FamilyProps {
  /** 「使用向导」由评审外壳持有；没交进来就不画一颗能按的假按钮。 */
  readonly guide?: ReactNode | undefined;
  /** 评审与走查要逐页取样：这只是初始页，翻页仍然由本族的目次自己管。 */
  readonly openLeaf?: Leaf | undefined;
}

export type Leaf = 'provider' | 'entry' | 'presence' | 'palette' | 'specimen';

const LEAVES: ReadonlyArray<{ id: Leaf; number: string; label: string; note: string }> = [
  { id: 'provider', number: '一', label: '服务索引', note: '目录用文字排，挑中打一个勾' },
  { id: 'entry', number: '二', label: '这家门户', note: '模型名与 Key 都是划线的空位' },
  { id: 'presence', number: '三', label: '桌宠这一页', note: '预览、说话、录音与暂时不回应' },
  { id: 'palette', number: '四', label: '颜色版式', note: '36 格是四开的一张色表' },
  { id: 'specimen', number: '伍', label: '控件样张', note: '这一族控件自己的样子与状态' },
];

const PHASE_LINE: Readonly<Record<string, string>> = {
  'no-bridge': '这台机器还没有模型连接的通道。',
  loading: '正在读这台机器的模型配置…',
  'read-failed': '这台机器的模型配置没读到。',
  'nothing-yet': '还没有在用连接。',
  'saved-only': '本机存过配置，还没在用。',
  'in-use': '接上了，可以说话。',
  'in-use-paused': '接上了，但它先不回应。',
};

const STATE_LINE: Readonly<Record<string, string>> = {
  idle: '它待着',
  listening: '它在听',
  thinking: '它在想',
  replying: '它在说',
  error: '它说错了',
};

/** 登记处直接拿这一份：名字与说明讲的是控件构造的差别，不是配色换了几格。 */
export const FOLIO_FAMILY: StyleFamily = {
  id: 'folio',
  name: 'Folio 稿纸',
  description:
    '米色纸与墨色、宋体系衬线标题、目次与页码式导航、文字排的服务索引（打勾选定）、只有下划线的字段、纯文字动作与骑缝存根。',
  Component: FolioFamily,
};

export function FolioFamily({
  model,
  board,
  guide,
  openLeaf = 'provider',
}: FolioFamilyProps): JSX.Element {
  const theme = useFamilyTheme(FOLIO_SEED);
  const [leaf, setLeaf] = useState<Leaf>(openLeaf);
  const shown: Leaf = board ? 'specimen' : leaf;
  const current = LEAVES.find((item) => item.id === shown) ?? LEAVES[0];

  return (
    <div
      className="sf-folio"
      style={theme.vars}
      data-color-scheme={theme.colorScheme}
      data-leaf={shown}
      data-seeded={theme.seeded ? 'true' : 'false'}
      data-testid="sf-folio"
    >
      <div className="fl-sheet">
        {/* 天头：书名行与宿主那一句话；册子先说明它是第几页。 */}
        <header className="fl-head">
          <span className="fl-head__title">桌宠册 · 起始页</span>
          <span className="fl-head__rule" aria-hidden="true" />
          <span className="fl-head__folio" data-testid="fl-head-folio">
            {current?.number ?? '—'} · {current?.label ?? ''}
          </span>
          {guide === undefined ? null : <span className="fl-head__aside">{guide}</span>}
        </header>

        <div className="fl-plate" data-testid="start-status">
          <p className="fl-plate__line">
            <span className="fl-plate__key">此刻</span>
            <b className="fl-plate__value">{model.snapshotLabel ?? '没有在用连接'}</b>
            <em className="fl-plate__note">{PHASE_LINE[model.phase] ?? '状态还没读到。'}</em>
          </p>
          {model.paused ? (
            <p className="fl-plate__line" data-testid="start-paused">
              <span className="fl-plate__key">回应</span>
              <em className="fl-plate__note">暂时不回应已勾上，它先不开口。</em>
            </p>
          ) : null}
          {model.notice === null ? null : (
            <p className="fl-plate__line" data-testid="start-notice">
              <span className="fl-plate__key">宿主</span>
              <em className="fl-plate__note">{model.notice}</em>
            </p>
          )}
          {model.error === null ? null : (
            <p className="fl-plate__line" data-testid="start-error">
              <span className="fl-plate__key">读题</span>
              <em className="fl-plate__note fl-plate__note--bad">{model.error}</em>
            </p>
          )}
        </div>

        <div className="fl-guts">
          {/* 目次：左边一栏就是这一族的导航，条目式，不是挡位。 */}
          <nav className="fl-toc" aria-label="目次">
            <p className="fl-toc__caption">目次</p>
            <ol className="fl-toc__list">
              {LEAVES.map((item) => (
                <li className="fl-toc__item" key={item.id} data-current={item.id === shown}>
                  <button
                    type="button"
                    className="fl-toc__link"
                    title={item.note}
                    data-testid={'fl-leaf-' + item.id}
                    onClick={() => setLeaf(item.id)}
                  >
                    <span className="fl-toc__number">{item.number}</span>
                    <span className="fl-toc__label">{item.label}</span>
                    <span className="fl-toc__leader" aria-hidden="true" />
                    <span className="fl-toc__mark" aria-hidden="true">
                      {item.id === shown ? '✓' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="fl-toc__foot" data-testid="fl-theme-source">
              {theme.seeded ? '颜色＝本册呈现种子' : '颜色＝本机记录'}
            </p>
          </nav>

          <main className="fl-body" data-testid="fl-body">
            {shown === 'provider' ? <IndexLeaf model={model} /> : null}
            {shown === 'entry' ? <EntryLeaf model={model} /> : null}
            {shown === 'presence' ? <PresenceLeaf model={model} /> : null}
            {shown === 'palette' ? <PaletteLeaf theme={theme} /> : null}
            {shown === 'specimen' ? <FolioSpecimen /> : null}
          </main>
        </div>

        {/* 地脚：页脚一句，说明这本册子没有把状态演出来。 */}
        <footer className="fl-foot">
          <span className="fl-foot__word">Folio · 册子版</span>
          <span className="fl-foot__rule" aria-hidden="true" />
          <span className="fl-foot__num" data-testid="fl-foot-count">
            {model.choices.length + ' / ' + model.rows.length + ' 家'}
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 本族控件 */

function FlChapter({
  number,
  title,
  lead,
  children,
}: {
  number: string;
  title: string;
  lead?: ReactNode | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="fl-chapter" aria-labelledby={'fl-h-' + number}>
      <h2 className="fl-chapter__title" id={'fl-h-' + number}>
        <span className="fl-chapter__number">{number}、</span>
        {title}
      </h2>
      {lead === undefined ? null : <p className="fl-chapter__lead">{lead}</p>}
      <div className="fl-chapter__body">{children}</div>
    </section>
  );
}

interface FlActionProps {
  word: string;
  onPress?: (() => void) | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  type?: 'button' | 'submit';
  testid?: string | undefined;
  emphasis?: boolean | undefined;
  note?: string | undefined;
}

/** 文字动作：没有框、没有底色，只有正文里的一根下划线；按下换墨色与字重。 */
function FlAction({
  word,
  onPress,
  busy = false,
  disabled = false,
  type = 'button',
  testid,
  emphasis = false,
  note,
}: FlActionProps): JSX.Element {
  return (
    <span className="fl-actionwrap">
      <button
        type={type}
        className="fl-action"
        data-emphasis={emphasis ? 'true' : 'false'}
        disabled={disabled || busy}
        aria-busy={busy ? true : undefined}
        data-testid={testid}
        {...(onPress === undefined ? {} : { onClick: onPress })}
      >
        <span className="fl-action__word">{word}</span>
        {busy ? <span className="fl-action__pending" aria-hidden="true" /> : null}
      </button>
      {note === undefined ? null : <span className="fl-action__note">{note}</span>}
    </span>
  );
}

interface FlRuledProps {
  label: string;
  value: string;
  onChange(next: string): void;
  kind?: 'text' | 'password' | 'search';
  note?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  list?: string | undefined;
  testid?: string | undefined;
  ariaLabel?: string | undefined;
}

/** 划线字段：名称在左、空位在右，只有一根下划线；补充与失败都在这根线下面。 */
function FlRuled({
  label,
  value,
  onChange,
  kind = 'text',
  note,
  error,
  disabled = false,
  placeholder,
  list,
  testid,
  ariaLabel,
}: FlRuledProps): JSX.Element {
  const id = useId();
  const noteId = id + '-note';
  const hasNote = note !== undefined || error !== undefined;
  return (
    <div className="fl-ruled" data-state={error === undefined ? 'idle' : 'bad'}>
      <label className="fl-ruled__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="fl-ruled__input"
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
        <p className="fl-ruled__note" id={noteId} data-tone={error === undefined ? 'note' : 'bad'}>
          {error ?? note}
        </p>
      ) : null}
    </div>
  );
}

/** 勾选记号：一行文字 + 一枚真 checkbox，勾上的记号用「✓」这个字形。 */
function FlCheckRow({
  word,
  note,
  pressed,
  disabled = false,
  testid,
  onChange,
}: {
  word: string;
  note?: string | undefined;
  pressed: boolean;
  disabled?: boolean | undefined;
  testid?: string | undefined;
  onChange(next: boolean): void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="fl-check" data-checked={pressed ? 'true' : 'false'}>
      <input
        id={id}
        className="fl-check__input"
        type="checkbox"
        checked={pressed}
        disabled={disabled}
        data-testid={testid}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label className="fl-check__mark" htmlFor={id} aria-hidden="true">
        ✓
      </label>
      <label className="fl-check__word" htmlFor={id}>
        {word}
        {note === undefined ? null : <span className="fl-check__note">{note}</span>}
      </label>
    </div>
  );
}

/** 骑缝单据：一件事实一行，行与行之间一条细线，值排在右边。 */
function FlReceipt({
  rows,
  testid,
}: {
  rows: Array<{ k: string; v: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'idle' | undefined }>;
  testid?: string | undefined;
}): JSX.Element {
  return (
    <dl className="fl-receipt" data-testid={testid}>
      {rows.map((row) => (
        <div className="fl-receipt__row" key={row.k} data-tone={row.tone ?? 'idle'}>
          <dt>{row.k}</dt>
          <span className="fl-receipt__rule" aria-hidden="true" />
          <dd>{row.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlMarginal({
  tone,
  testid,
  children,
}: {
  tone: 'note' | 'warn' | 'bad' | 'ok';
  testid?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <p
      className="fl-marginal"
      data-tone={tone}
      role={tone === 'bad' ? 'alert' : 'status'}
      data-testid={testid}
    >
      <span className="fl-marginal__mark" aria-hidden="true">
        ※
      </span>
      {children}
    </p>
  );
}

/* ------------------------------------------------------------ 一、服务索引 */

/**
 * 目录是一栏排印文字：搜索是纸上的一根线，条目是「名称 · 平台 —— 状态」这样的行文。
 * 挑中它在行首打一个勾；这里没有下拉框，也没有卡片，与 Precision 的表格行不是一回事。
 */
function IndexLeaf({ model }: { model: StartModel }): JSX.Element {
  const [onlyVisible, setOnlyVisible] = useState(false);
  const listed = onlyVisible
    ? model.choices.filter((choice) => choice.service.available)
    : model.choices;
  const empty = listed.length === 0;

  return (
    <FlChapter
      number="一"
      title="服务索引"
      lead={<>目录按厂商排，一家一块平台各占一行。挑一家就在行首打个勾，接下来第二章填它的空位。</>}
    >
      <div className="fl-index__search" data-testid="start-provider">
        <FlRuled
          label="找一家"
          kind="search"
          value={model.query}
          placeholder="名称、标识或模型名"
          ariaLabel="筛服务"
          note="留白就是整份目录。"
          testid="model-provider-search"
          onChange={model.setQuery}
        />
        <span className="fl-index__count" data-testid="model-provider-count">
          {listed.length + ' 家列出 / 共 ' + model.rows.length + ' 家'}
        </span>
      </div>

      <FlCheckRow
        word="只看接得进来的"
        note="没接进来的那几家仍然看得见，只是点不动，原因写在这一行上。"
        pressed={onlyVisible}
        testid="fl-filter-available"
        onChange={setOnlyVisible}
      />

      {empty ? (
        <FlMarginal tone="warn" testid="model-provider-empty">
          {'纸上没有匹配「' +
            model.query.trim() +
            '」的一家。改一个字，或者去管理模型扩展看看这家接进来了没有。'}
        </FlMarginal>
      ) : (
        <ol className="fl-index" data-testid="fl-index">
          {listed.map((choice, index) => (
            <li
              className="fl-index__entry"
              key={choice.service.id}
              data-current={choice.current ? 'true' : 'false'}
              data-mark={choice.mark}
              data-disabled={choice.service.available ? 'false' : 'true'}
            >
              <span className="fl-index__number">{String(index + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="fl-index__pick"
                disabled={!choice.service.available}
                title={choice.service.unavailableReason ?? choice.service.label}
                aria-pressed={choice.current}
                data-testid={'model-pick-' + choice.service.id}
                onClick={() => {
                  model.pick(choice.service.id);
                }}
              >
                <span className="fl-index__tick" aria-hidden="true">
                  {choice.current ? '✓' : ''}
                </span>
                <span className="fl-index__name">{choice.service.label}</span>
                <span className="fl-index__rule" aria-hidden="true" />
                <span className="fl-index__state">
                  {providerNote(choice.mark, choice.service.auth, choice.dirty)}
                </span>
              </button>
              <p className="fl-index__meta">
                <span className="fl-index__mono">{choice.service.id}</span>
                <span aria-hidden="true"> · </span>
                {choice.service.region === 'cn' ? '中国大陆平台' : '国际平台'}
                <span aria-hidden="true"> · </span>
                {choice.service.auth === 'browser' ? '用浏览器登录' : '填 API Key'}
                {choice.mark === 'draft' || choice.mark === 'in-use' ? null : (
                  <em className="fl-index__tag">{MARK_TEXT[choice.mark]}</em>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="fl-verbs">
        <FlAction word="重新读取这一页" testid="model-refresh" onPress={model.refresh} />
        <FlAction word="管理模型扩展" testid="model-manage" onPress={model.openPlugins} />
        <FlAction
          word="翻到第二章"
          testid="fl-goto-entry"
          onPress={() => undefined}
          note="或直接点目次「二」"
        />
      </div>
    </FlChapter>
  );
}

/* -------------------------------------------------------------- 二、这家门户 */

function EntryLeaf({ model }: { model: StartModel }): JSX.Element {
  if (!model.available) {
    return (
      <FlChapter number="二" title="这家门户">
        <FlMarginal tone="warn" testid="start-connect-empty">
          这台机器还没有模型连接的通道，所以这一章没有可填的空位。
        </FlMarginal>
      </FlChapter>
    );
  }
  if (model.picked === undefined) {
    return (
      <FlChapter number="二" title="这家门户">
        <FlMarginal tone="note" testid="start-connect-empty">
          {model.loading ? '正在读这台机器的模型配置…' : '目录里还没有可接的一家。'}
        </FlMarginal>
      </FlChapter>
    );
  }

  const picked = model.picked;
  const browserSignIn = picked.auth === 'browser';
  const using = model.saved === null ? null : whoUsing(model);

  return (
    <FlChapter
      number="二"
      title="这家门户"
      lead={
        <>
          {picked.label} · {picked.region === 'cn' ? '中国大陆平台' : '国际平台'} ——{' '}
          {model.mark === null ? '还没定' : MARK_TEXT[model.mark]}
          {model.dirty ? '；这次改动还没保存' : ''}
        </>
      }
    >
      <div data-testid="start-connect-form">
        <FlReceipt
          testid="fl-entry-head"
          rows={[
            { k: '端点', v: picked.id },
            { k: '接入', v: browserSignIn ? '浏览器登录' : 'API Key' },
            {
              k: '本机 Key',
              v: model.keySaved ? '存过了' : '还没有',
              tone: model.keySaved ? 'ok' : 'idle',
            },
            {
              k: '改动',
              v: model.dirty ? '有，未保存' : '与本机一致',
              tone: model.dirty ? 'warn' : 'idle',
            },
          ]}
        />

        {browserSignIn ? (
          <div className="fl-signin" data-testid="px-signin-block">
            <FlMarginal tone="note">
              这一家用浏览器登录自己的账号，不填 API
              Key。登录完成只是这台机器读到了登录，能不能接上还要看随后那一次写入。
            </FlMarginal>
            <div className="fl-verbs">
              <FlAction
                word={model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
                emphasis
                busy={model.busy.signingIn}
                disabled={!model.can.signIn}
                testid="model-signin"
                onPress={model.signIn}
              />
              {model.busy.signingIn ? (
                <FlAction
                  word="取消这次登录"
                  testid="model-signin-cancel"
                  onPress={model.cancelSignIn}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <form
            className="fl-form"
            onSubmit={(event) => {
              event.preventDefault();
              model.save();
            }}
          >
            <FlRuled
              label="模型名"
              value={model.model}
              list="fl-model-list"
              note={
                picked.models.length > 0 ? '可以直接写，也可以从这家列出的名字里挑。' : undefined
              }
              error={model.model.trim() === '' ? '模型名这一处不能空着。' : undefined}
              testid="model-input"
              onChange={model.setModel}
            />
            <datalist id="fl-model-list">
              {picked.models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

            <FlRuled
              label={picked.label + ' 的 Key'}
              kind="password"
              value={model.key}
              disabled={model.keyBlock !== null || model.busy.saving}
              note={
                model.inUse
                  ? '留空就沿用这台机器上已经存着的那一份。'
                  : model.keySaved
                    ? '这家在本机存过 Key；写新的会盖掉它。'
                    : picked.keyHint
              }
              error={model.keyBlock ?? undefined}
              testid="key-input"
              onChange={model.setKey}
            />

            <div className="fl-verbs">
              <FlAction
                type="submit"
                word={model.busy.saving ? '正在写进这台机器…' : '保存并开始'}
                emphasis
                busy={model.busy.saving}
                disabled={!model.can.save}
                testid="model-save"
              />
              <FlAction
                word={model.busy.testing ? '正在试这一家…' : '测试连接'}
                busy={model.busy.testing}
                disabled={!model.can.test}
                testid="model-test"
                onPress={model.test}
              />
            </div>
          </form>
        )}

        <div className="fl-verbs fl-verbs--quiet">
          <FlAction
            word={'去 ' + picked.label + ' 申请 Key'}
            testid="model-getkey"
            onPress={model.openKeyPage}
          />
          {model.sibling === undefined ? null : (
            <FlAction
              word={picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
              testid="model-region"
              onPress={model.switchRegion}
            />
          )}
        </div>

        {model.signing === null ? null : (
          <FlMarginal tone="note" testid="model-signin-line">
            {model.signing}
          </FlMarginal>
        )}
        {model.can.test ? null : (
          <FlMarginal tone="warn" testid="model-test-reason">
            {model.reasons.test}
          </FlMarginal>
        )}
        {model.can.save || browserSignIn ? null : (
          <FlMarginal tone="warn" testid="model-save-reason">
            {model.reasons.save}
          </FlMarginal>
        )}
        {model.tested === null ? null : (
          <FlMarginal tone={model.tested.passed ? 'ok' : 'bad'} testid="model-test-line">
            {model.tested.text}
          </FlMarginal>
        )}
        {model.saved === null ? null : (
          <div className="fl-slip" data-testid="model-receipt">
            <p className="fl-slip__head">存根 · 这一次的结果</p>
            <FlReceipt
              rows={[
                {
                  k: '写进本机',
                  v: model.saved.saved ? '存下了' : '没存下',
                  tone: model.saved.saved ? 'ok' : 'bad',
                },
                {
                  k: '这一次试',
                  v: model.saved.tested ? '通过' : '没通过',
                  tone: model.saved.tested ? 'ok' : 'warn',
                },
                { k: '现在在用', v: using?.text ?? '—', tone: using?.tone ?? 'idle' },
              ]}
            />
            <p className="fl-slip__line" role="status">
              {model.saved.text}
            </p>
          </div>
        )}
      </div>
    </FlChapter>
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

/* ---------------------------------------------------------- 三、桌宠这一页 */

function PresenceLeaf({ model }: { model: StartModel }): JSX.Element {
  const view = useFamilyPreview(model);

  if (!view.available) {
    return (
      <FlChapter number="三" title="桌宠这一页">
        <FlMarginal tone="warn" testid="start-pet">
          这一页还没连上应用，所以看不见桌面上是哪一只，也戳不到它。
        </FlMarginal>
      </FlChapter>
    );
  }

  return (
    <FlChapter
      number="三"
      title="桌宠这一页"
      lead={<>{model.desktop.text} —— 预览里的说话、录音、日夜与挪动都接到这台机器上。</>}
    >
      <div className="fl-plate-pet" data-testid="start-pet" ref={view.menu.ref}>
        <div
          className="fl-scene"
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
            className="fl-figure"
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
            <span className="fl-figure__body sf-figure" style={view.figure.vars}>
              <PetAvatar
                state={view.figure.state}
                expression={view.figure.expression}
                figure={view.figure.figure}
                name={view.figure.name}
              />
            </span>
          </button>
          {view.bubble === null ? null : (
            <p className="fl-said" role="status" data-testid="fl-bubble">
              {view.bubble}
            </p>
          )}
        </div>

        <FlReceipt
          testid="fl-presence-lines"
          rows={[
            { k: '它此刻', v: STATE_LINE[view.figure.state] ?? view.figure.state },
            {
              k: '神情',
              v: view.figure.expression === 'neutral' ? '—' : view.figure.expression,
            },
            { k: '形态', v: view.figure.figure === 'round' ? '圆头' : '简约' },
            {
              k: '说话',
              v: view.composer.present
                ? view.composer.canSend
                  ? '可以写给它'
                  : '这会儿还不能写'
                : '这条会话不在',
              tone: view.composer.present && view.composer.canSend ? 'ok' : 'idle',
            },
            {
              k: '录音',
              v: view.mic.present
                ? view.mic.disabled
                  ? '这会儿不能录'
                  : view.mic.pressed
                    ? '正在录'
                    : '可以录'
                : '这条会话不在',
              tone: view.mic.present && !view.mic.disabled ? 'ok' : 'idle',
            },
          ]}
        />

        <div className="fl-checks">
          <FlCheckRow
            word="暂时不回应"
            note="只是让它先不开口；这一页的说话与录音还都在。"
            pressed={model.paused}
            disabled={model.busy.pausing}
            testid="pet-pause"
            onChange={model.togglePaused}
          />
          <FlCheckRow
            word="这一页的夜灯"
            note="只改这块纸面的明暗，不动控制台挡位，也不动桌面。"
            pressed={view.night}
            testid={FAMILY_PREVIEW_TESTIDS.light}
            onChange={view.setNight}
          />
          <FlCheckRow
            word="在桌面上留着它"
            note={model.busy.visibility ? '正在改这台机器上的可见性…' : undefined}
            pressed={model.desktopShown}
            disabled={model.busy.visibility}
            testid="pet-visible"
            onChange={(next) => {
              model.setDesktopVisible(next);
            }}
          />
        </div>

        {view.composer.present ? (
          <div className="fl-say">
            <label className="fl-say__label" htmlFor="fl-composer">
              {view.composer.label}
            </label>
            <input
              id="fl-composer"
              className="fl-say__input"
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
            <div className="fl-verbs">
              <FlAction
                word={view.composer.sending ? '正在送过去…' : '写给它'}
                emphasis
                busy={view.composer.sending}
                disabled={!view.composer.canSubmit}
                testid={FAMILY_PREVIEW_TESTIDS.send}
                onPress={view.composer.send}
              />
              {!view.composer.canSend ? (
                <span className="fl-say__note">{view.composer.hint}</span>
              ) : null}
            </div>
          </div>
        ) : (
          <FlMarginal tone="note">这条会话现在不在，所以这一页没有可写的地方。</FlMarginal>
        )}

        {view.mic.present ? (
          <div className="fl-verbs fl-verbs--quiet">
            <FlAction
              word={view.mic.label}
              disabled={view.mic.disabled}
              note={view.mic.hint}
              testid={FAMILY_PREVIEW_TESTIDS.mic}
              onPress={view.mic.toggle}
            />
            {view.mic.pressed ? (
              <FlAction
                word="取消这次录音"
                testid={FAMILY_PREVIEW_TESTIDS.micCancel}
                onPress={view.mic.cancel}
              />
            ) : null}
            <FlAction
              word={view.menu.open ? '把这一页的便签收起来' : '给这一页夹一张便签'}
              testid={FAMILY_PREVIEW_TESTIDS.menu}
              onPress={view.menu.toggle}
            />
          </div>
        ) : null}

        {view.menu.open ? (
          <div className="fl-note-card" role="group" aria-label="便签" data-testid="fl-note-card">
            <p className="fl-note-card__line">再按一次右键，或点这条动作，就把便签抽掉。</p>
            <div className="fl-verbs">
              {view.entries.dress === undefined ? null : (
                <FlAction word="去装扮那一页" testid="pet-dress" onPress={view.entries.dress} />
              )}
              {view.entries.voice === undefined ? null : (
                <FlAction word="去语音输入那一页" testid="pet-voice" onPress={view.entries.voice} />
              )}
              <FlAction
                word={view.composer.open ? '把话收回去' : '写一句话给它'}
                testid={FAMILY_PREVIEW_TESTIDS.chat}
                onPress={() => {
                  view.composer.setOpen(!view.composer.open);
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </FlChapter>
  );
}

/* -------------------------------------------------------- 四、颜色版式 */

const TOKEN_GROUPS = groupedThemeTokens();

function PaletteLeaf({ theme }: { theme: ReturnType<typeof useFamilyTheme> }): JSX.Element {
  const { snapshot, actions } = theme;
  const schemes = allSchemes(snapshot.record);
  const modes: ThemeMode[] = ['light', 'dark', 'system'];

  return (
    <FlChapter
      number="四"
      title="颜色版式"
      lead={
        <>
          36 格分五组排在这张色表上。浅色与黑夜是两份各自存的配色，现在动的是「
          {THEME_APPEARANCE_LABELS[snapshot.appearance]}」。
        </>
      }
    >
      <div className="fl-palette" data-testid="start-theme">
        <FlReceipt
          testid="fl-theme-status"
          rows={[
            { k: '方案', v: snapshot.schemeName },
            { k: '说明', v: snapshot.schemeNote },
            {
              k: '回执',
              v: snapshot.status.text,
              tone: snapshot.status.tone === 'danger' ? 'bad' : 'idle',
            },
            {
              k: '试色',
              v: snapshot.previewActive ? '正在预览，还没保存' : '没有未保存的试色',
              tone: snapshot.previewActive ? 'warn' : 'idle',
            },
          ]}
        />

        <fieldset className="fl-modes">
          <legend className="fl-modes__legend">挡位</legend>
          {modes.map((mode) => (
            <div
              className="fl-check fl-check--inline"
              key={mode}
              data-checked={snapshot.record.mode === mode ? 'true' : 'false'}
            >
              <input
                className="fl-check__input"
                type="radio"
                name="fl-theme-mode"
                id={'fl-mode-' + mode}
                value={mode}
                checked={snapshot.record.mode === mode}
                data-testid={'theme-mode-' + mode}
                onChange={() => {
                  actions.chooseMode(mode);
                }}
              />
              <label className="fl-check__mark" htmlFor={'fl-mode-' + mode} aria-hidden="true">
                ✓
              </label>
              <label className="fl-check__word" htmlFor={'fl-mode-' + mode}>
                {THEME_MODE_NAMES[mode]}
              </label>
            </div>
          ))}
        </fieldset>

        <div className="fl-index__search">
          <label className="fl-ruled__label" htmlFor="fl-scheme">
            挑一个已存方案
          </label>
          <select
            id="fl-scheme"
            className="fl-scheme"
            value={snapshot.schemeId}
            aria-describedby="fl-scheme-note"
            data-testid="theme-scheme-select"
            onChange={(event) => {
              actions.chooseScheme(event.target.value);
            }}
          >
            {schemes.map((scheme) => (
              <option key={scheme.id} value={scheme.id}>
                {scheme.name}
              </option>
            ))}
          </select>
          <p className="fl-ruled__note" id="fl-scheme-note" data-tone="note">
            挑方案就是把这一扇窗交给本机记录；内置方案不能覆盖，调完色另存一份才写进去。
          </p>
        </div>

        <FlRuled
          label="方案名"
          value={snapshot.name}
          note="名字只到 40 个字。"
          testid="theme-name"
          onChange={actions.setName}
        />

        <div className="fl-verbs">
          <FlAction word="保存这一份" emphasis testid="theme-save" onPress={actions.save} />
          <FlAction word="另存一份自定义" testid="theme-copy" onPress={actions.copyAsNew} />
          <FlAction
            word="撤掉没保存的试色"
            disabled={!snapshot.previewActive}
            testid="theme-undo"
            onPress={actions.undoPreview}
          />
          <FlAction
            word={snapshot.deleteArmed ? '再点一次才真删' : '删掉这个自定义方案'}
            disabled={!snapshot.canWrite}
            testid="theme-delete"
            onPress={actions.requestDelete}
          />
        </div>

        {TOKEN_GROUPS.map((group) => (
          <div className="fl-colour" key={group.group}>
            <h3 className="fl-colour__title">{group.group}</h3>
            <ul className="fl-colour__list">
              {group.tokens.map((token) => {
                const value = snapshot.draft[token.key] ?? '';
                const typed = snapshot.hexText[token.key] ?? value.toUpperCase();
                const invalid = snapshot.invalidKeys.has(token.key);
                return (
                  <li
                    className="fl-colour__cell"
                    key={token.key}
                    data-invalid={invalid ? 'true' : 'false'}
                  >
                    <span
                      className="fl-colour__swatch"
                      aria-hidden="true"
                      style={{ backgroundColor: value }}
                    />
                    <label className="fl-colour__label" htmlFor={'fl-token-' + token.key}>
                      {token.label}
                      <span className="fl-colour__key">--{token.key}</span>
                    </label>
                    <input
                      id={'fl-hex-' + token.key}
                      className="fl-colour__hex"
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
                    <input
                      id={'fl-token-' + token.key}
                      className="fl-colour__pick"
                      type="color"
                      value={value}
                      aria-label={token.label + ' 的取色器'}
                      data-testid={'theme-token-' + token.key}
                      onChange={(event) => {
                        actions.editToken(token.key, event.target.value, 'picker');
                      }}
                    />
                    {invalid ? (
                      <span className="fl-colour__bad">这一格认不出来，没写进草稿</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </FlChapter>
  );
}

/* ------------------------------------------------------------ 伍、控件样张 */

/**
 * 这一族的样张：每一颗都是上面那几个控件本身，能按、能填、能勾。
 * 样张只说明样子，不冒充后台结果——这里没有"已保存"这种假存根。
 */
function FolioSpecimen(): JSX.Element {
  const [checked, setChecked] = useState(true);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('deepseek-flash');

  return (
    <FlChapter
      number="伍"
      title="控件样张"
      lead="下面这几排是这一族的控件本身：能按、能填、能勾，但不写本机、不发请求。"
    >
      <div className="fl-specimen" data-testid="fl-specimen" data-sample="true">
        <section className="fl-specimen__block" aria-label="文字动作">
          <h3 className="fl-specimen__title">文字动作</h3>
          <div className="fl-verbs">
            <FlAction
              word="普通的动作词"
              emphasis
              onPress={() => undefined}
              testid="fl-board-emphasis"
            />
            <FlAction word="寻常的动作" onPress={() => undefined} testid="fl-board-action" />
            <FlAction word="按不动的动作" disabled testid="fl-board-disabled" />
            <FlAction
              word={pending ? '正在等这台机器…' : '按下演示等待'}
              busy={pending}
              testid="fl-board-pending"
              onPress={() => {
                setPending(true);
                window.setTimeout(() => setPending(false), 900);
              }}
            />
            <FlAction
              word="带注记的动作"
              note="注记在动作右边，用辞典体的字。"
              onPress={() => undefined}
            />
          </div>
        </section>

        <section className="fl-specimen__block" aria-label="划线字段">
          <h3 className="fl-specimen__title">划线字段</h3>
          <FlRuled label="填好了" value={draft} testid="fl-board-field" onChange={setDraft} />
          <FlRuled
            label="带补充"
            value=""
            note="留白也是一种状态，不是错。"
            testid="fl-board-note"
            onChange={() => undefined}
          />
          <FlRuled
            label="写错了"
            value=""
            error="这一处不能空着。"
            testid="fl-board-error"
            onChange={() => undefined}
          />
          <FlRuled
            label="不能填"
            value="sk-..."
            disabled
            testid="fl-board-disabled-field"
            onChange={() => undefined}
          />
        </section>

        <section className="fl-specimen__block" aria-label="勾选记号">
          <h3 className="fl-specimen__title">勾选记号</h3>
          <FlCheckRow
            word="勾上的"
            pressed={checked}
            testid="fl-board-check"
            onChange={setChecked}
          />
          <FlCheckRow
            word="没勾的"
            pressed={!checked}
            testid="fl-board-check-off"
            onChange={setChecked}
          />
          <FlCheckRow
            word="勾上了但按不动"
            pressed
            note="原因写在旁边，不靠颜色。"
            disabled
            testid="fl-board-check-disabled"
            onChange={() => undefined}
          />
        </section>

        <section className="fl-specimen__block" aria-label="骑缝单据">
          <h3 className="fl-specimen__title">骑缝单据</h3>
          <FlReceipt
            testid="fl-board-receipt"
            rows={[
              { k: '写进本机', v: '存下了', tone: 'ok' },
              { k: '这一次试', v: '没通过', tone: 'warn' },
              { k: '现在在用', v: '当前没有在用连接', tone: 'idle' },
              { k: '本机 Key', v: '存过了', tone: 'ok' },
            ]}
          />
          <FlMarginal tone="note">样张就是样张：这一段不代表任何后台结果。</FlMarginal>
        </section>

        <section className="fl-specimen__block" aria-label="索引条目">
          <h3 className="fl-specimen__title">索引条目</h3>
          <ol className="fl-index">
            <li className="fl-index__entry" data-current="true" data-mark="in-use">
              <span className="fl-index__number">01</span>
              <button
                type="button"
                className="fl-index__pick"
                aria-pressed={true}
                onClick={() => undefined}
              >
                <span className="fl-index__tick" aria-hidden="true">
                  ✓
                </span>
                <span className="fl-index__name">在用的这一家</span>
                <span className="fl-index__rule" aria-hidden="true" />
                <span className="fl-index__state">在用，这次改动还没保存</span>
              </button>
              <p className="fl-index__meta">
                <span className="fl-index__mono">deepseek-cn</span>
                <span aria-hidden="true"> · </span>
                中国大陆平台
              </p>
            </li>
            <li
              className="fl-index__entry"
              data-current="false"
              data-mark="unavailable"
              data-disabled="true"
            >
              <span className="fl-index__number">02</span>
              <button
                type="button"
                className="fl-index__pick"
                disabled
                aria-pressed={false}
                onClick={() => undefined}
              >
                <span className="fl-index__tick" aria-hidden="true" />
                <span className="fl-index__name">还没接进来的这一家</span>
                <span className="fl-index__rule" aria-hidden="true" />
                <span className="fl-index__state">未接入</span>
              </button>
              <p className="fl-index__meta">
                <span className="fl-index__mono">none-yet</span>
                <span aria-hidden="true"> · </span>
                国际平台
              </p>
            </li>
          </ol>
        </section>
      </div>
    </FlChapter>
  );
}

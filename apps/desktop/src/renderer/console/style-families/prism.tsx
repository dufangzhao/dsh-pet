/**
 * Prism（棱镜）：一整套「暗色环境玻璃桌面」的呈现，与炉边不是同一套板件换了明暗。
 *
 * 这一家自己的形状：分层半透明的面板与内部一道亮线、等宽小字号的机读标签、
 * 没有底色的内嵌字段（只有左侧一道键名与一条亮线）、右侧常驻的信号列（灯 + 话，没有编出来的数字）、
 * 底部浮动的动作条（图标键 + 看得见的名字，开合用 aria-pressed），
 * 以及挑服务用的命令面板：原生 <dialog> + showModal、上下键与回车在真 listbox 里走、
 * Esc 关掉并把焦点还给那一颗触发键、Tab 在面板内部绕圈、Ctrl/⌘+K 唤起。
 * 判断与动作只有 use-start-model 那一份；预览与配色走 style-families 的 headless 适配器。
 *
 * 图标只用已装的 morphicons 2.0.2 与自家 24 格形状；不引第二种图标包，也不下载字体。
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { MorphIcon, type IconNode } from 'morphicons/react';

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
import './prism.css';

/** 冷石墨底 + 两道色（霜蓝与琥珀）：浅档也在暗色环境里，Prism 不做纯白版本。 */
export const PRISM_SEED: FamilyThemeSeed = {
  light: {
    paper: '#e9eef3',
    'paper-2': '#dfe6ee',
    sheet: '#f3f6fa',
    'sheet-2': '#e8edf4',
    'sheet-3': '#d8e0e9',
    ink: '#141b22',
    'ink-soft': '#485665',
    'ink-dim': '#6c7a89',
    line: '#c8d2dd',
    'line-2': '#aab8c6',
    'line-strong': '#6f849a',
    accent: '#1c5f86',
    'accent-2': '#0f4566',
    'on-accent': '#eef7ff',
    ok: '#176b57',
    warn: '#8a5a12',
    danger: '#a8332c',
    'bubble-bg': '#dfeaf3',
    'bubble-ink': '#141b22',
  },
  dark: {
    paper: '#0e1319',
    'paper-2': '#121821',
    sheet: '#171f29',
    'sheet-2': '#1d2632',
    'sheet-3': '#25303d',
    ink: '#e6edf5',
    'ink-soft': '#aab9c8',
    'ink-dim': '#7f8fa0',
    line: '#28323f',
    'line-2': '#3a4757',
    'line-strong': '#6b7d92',
    accent: '#7fc4e8',
    'accent-2': '#b0dcf3',
    'on-accent': '#07202c',
    ok: '#74d3ae',
    warn: '#e8bd72',
    danger: '#f49a92',
    'bubble-bg': '#1e2c3a',
    'bubble-ink': '#e6edf5',
  },
};

const NAV_VIEWS: readonly (readonly [AppView, string])[] = [
  ['appearance', '装扮'],
  ['voice', '语音'],
  ['conversation', '记录'],
  ['persona', '设定'],
];

/* ------------------------------------------------------ 命令面板的纯逻辑 */

/** 上下键绕回两端；空列表不绕出一个不存在的行。 */
export function prismMove(index: number, size: number, delta: number): number {
  if (size <= 0) {
    return 0;
  }
  const wrapped = (index + delta) % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

export function prismIndexOf(id: string, ids: readonly string[]): number {
  const at = ids.indexOf(id);
  return at < 0 ? 0 : at;
}

export type PrismKeyAction = 'up' | 'down' | 'first' | 'last' | 'choose' | 'close' | null;

/** 面板里那几个键：上下与 Home/End 移动，回车挑，Esc 关；其余留给浏览器与输入框。 */
export function prismKeyAction(key: string): PrismKeyAction {
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowUp') return 'up';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'Enter') return 'choose';
  if (key === 'Escape') return 'close';
  return null;
}

/** 唤起命令面板的组合键：Ctrl+K 或 ⌘+K。 */
export function prismSummonKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
}

/**
 * Tab 只在面板内部绕圈：顺序是「搜索框 → 那一项 → 关闭」。
 * 返回 null 表示这一发 Tab 不用管（浏览器自己走得出这个环）。
 */
export function prismTabTarget(count: number, position: number, shift: boolean): number | null {
  if (count <= 0 || position < 0) {
    return null;
  }
  if (shift) {
    return position === 0 ? count - 1 : null;
  }
  return position === count - 1 ? 0 : null;
}

/* ------------------------------------------------------------ 自家字形 */

const node = (d: string): IconNode => [['path', { d }]];

const GLYPHS = {
  /** 回应：双竖线是在跑，三角是已暂停。 */
  response: {
    off: node('M9.4 5.5v13M14.6 5.5v13'),
    on: node('M8.5 5.6 18 12l-9.5 6.4Z'),
  },
  /** 桌面上有没有这一只。 */
  presence: {
    off: node('M4.4 4.4 19.6 19.6M6.6 7.1C8.3 6.6 10.1 6.4 12 6.4c5.4 0 8.4 3.6 9.2 5.6'),
    on: node('M2.8 12C6 7.4 18 7.4 21.2 12 18 16.6 6 16.6 2.8 12Z'),
  },
  /** 这块面板的灯。 */
  light: {
    off: node('M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z'),
    on: node('M20 14.8A8.6 8.6 0 1 1 9.2 4a6.9 6.9 0 0 0 10.8 10.8Z'),
  },
  /** 说话：话筒与方块。 */
  voice: {
    off: node('M12 4.4a2.6 2.6 0 0 1 2.6 2.6v4.4a2.6 2.6 0 0 1-5.2 0V7A2.6 2.6 0 0 1 12 4.4Z'),
    on: node('M7.8 7.8h8.4v8.4H7.8Z'),
  },
  /** 搜索与关闭：命令面板的两端。 */
  search: node('M10.5 3.6a6.9 6.9 0 1 0 0 13.8 6.9 6.9 0 0 0 0-13.8ZM15.6 15.6 20 20'),
  close: node('M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5'),
  /** 写入、探测、跳转：三颗动作键。 */
  save: node('M6 4.4h9L19.6 9v10.6H6ZM9.2 4.4v5.2h6'),
  probe: node(
    'M12 3.4v5.2M12 20.4v-5.2M3.4 12h5.2M20.4 12h-5.2M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z',
  ),
  link: node(
    'M10.2 13.8a3.6 3.6 0 0 1 0-5.1l2.6-2.6a3.6 3.6 0 0 1 5.1 5.1l-1.3 1.3M13.8 10.2a3.6 3.6 0 0 1 0 5.1l-2.6 2.6a3.6 3.6 0 0 1-5.1-5.1l1.3-1.3',
  ),
  region: node(
    'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2ZM3.6 12h16.8M12 3.4c2.6 2.4 3.8 5.4 3.8 8.6s-1.2 6.2-3.8 8.6c-2.6-2.4-3.8-5.4-3.8-8.6s1.2-6.2 3.8-8.6Z',
  ),
  dress: node(
    'M8.4 3.8 12 7.4l3.6-3.6M4.6 9.4 8.4 7.2v11.6h7.2V7.2l3.8 2.2v8.4a2.2 2.2 0 0 1-2.2 2.2H6.8a2.2 2.2 0 0 1-2.2-2.2Z',
  ),
  send: node('M4 12 20 5l-6 15-3.2-6z'),
  undo: node('M8.4 8.4H4.6V4.6M8.4 8.4A6 6 0 1 1 6 12.6'),
  copy: node('M9 9h9.4v9.4H9ZM6 15H4.6V4.6h10.4V6'),
  trash: node('M5 7.4h14M9.4 7.4V4.6h5.2v2.8M6.8 7.4 8 20h8l1.2-12.6'),
} as const;

interface PrismKeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 图标与名字一起在场：只有图标的按钮在这套面板里不算说得清。 */
  name: string;
  glyph: IconNode;
  /** 开合类动作用 aria-pressed；不传就只是一颗动作键。 */
  pressed?: boolean | undefined;
  busy?: boolean;
  tone?: 'default' | 'primary' | 'danger' | undefined;
}

/** 图标键：面板底部那颗浮动的键，按下去亮线抬起、名字不变色只加粗。 */
function PrismKey({
  name,
  glyph,
  pressed,
  busy = false,
  tone = 'default',
  type = 'button',
  disabled = false,
  className,
  ...rest
}: PrismKeyProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      data-busy={busy ? 'true' : undefined}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      data-tone={tone}
      className={'pr-key' + (className === undefined ? '' : ' ' + className)}
    >
      <span className="pr-key__glyph" aria-hidden="true">
        <MorphIcon
          icon={glyph}
          reducedMotion="user"
          strokeWidth={1.6}
          size={18}
          color="currentColor"
        />
      </span>
      <span className="pr-key__name">{name}</span>
    </button>
  );
}

/** 内嵌字段：左侧一个等宽键名，输入格只有底边一道亮线；补充与失败在格下另起一行。 */
function PrismField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  children:
    | ReactNode
    | ((control: {
        inputId: string;
        describedBy: string | undefined;
        invalid: boolean;
      }) => ReactNode);
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
    <div className="pr-field" data-bad={error === undefined ? 'false' : 'true'}>
      <label className="pr-field__key" htmlFor={inputId}>
        {label}
      </label>
      <div className="pr-field__slot">{slot}</div>
      {hint === undefined ? null : (
        <p className="pr-field__note" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="pr-field__bad" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type PrismTone = 'on' | 'off' | 'ok' | 'warn' | 'danger' | 'neutral';

/** 一盏灯与一句话：只报宿主说过的话，不编指标；字一直在，灯只是复认。 */
function PrismSignal({
  tone,
  children,
  note,
  testid,
}: {
  tone: PrismTone;
  children: ReactNode;
  note?: ReactNode | undefined;
  testid?: string | undefined;
}): JSX.Element {
  return (
    <p className="pr-signal" data-tone={tone} data-testid={testid}>
      <span className="pr-signal__lamp" aria-hidden="true" />
      <span className="pr-signal__body">
        <span className="pr-signal__word">{children}</span>
        {note === undefined ? null : <span className="pr-signal__note">{note}</span>}
      </span>
    </p>
  );
}

/** 一层面板：半透明、内部一道亮线；layer 只是深度，不是第二种容器系统。 */
function PrismPane({
  title,
  meta,
  aside,
  children,
  testid,
  layer = 1,
}: {
  title: string;
  meta?: string | undefined;
  aside?: ReactNode | undefined;
  children: ReactNode;
  testid?: string | undefined;
  layer?: 1 | 2;
}): JSX.Element {
  const id = useId();
  return (
    <section
      className="pr-pane"
      data-layer={String(layer)}
      data-testid={testid}
      aria-labelledby={id}
    >
      <header className="pr-pane__head">
        <div>
          <h2 className="pr-pane__title" id={id}>
            {title}
          </h2>
          {meta === undefined ? null : <p className="pr-pane__meta">{meta}</p>}
        </div>
        {aside === undefined ? null : <div className="pr-pane__aside">{aside}</div>}
      </header>
      <div className="pr-pane__body">{children}</div>
    </section>
  );
}
/* -------------------------------------------------------- 面板内焦点绕圈 */

/** 面板里那几个能停住焦点的位置：谁标了 data-pr-focus 谁在环上。 */
export function prismFocusRing(container: HTMLElement | null): HTMLElement[] {
  if (container === null) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[data-pr-focus]'));
}

/** 只在两端接手：环内中间的位置交给浏览器自己走 Tab。 */
export function prismFocusNext(
  ring: readonly HTMLElement[],
  active: HTMLElement | null,
  shift: boolean,
): HTMLElement | null {
  if (ring.length === 0 || active === null) {
    return null;
  }
  const position = ring.indexOf(active);
  const target = prismTabTarget(ring.length, position, shift);
  return target === null ? null : (ring[target] ?? null);
}

/* ------------------------------------------------------------ 命令面板 */

/**
 * 挑一家服务：命令面板而不是目录网格。
 *
 * 原生 <dialog> + showModal；搜索框就是这扇面板的唯一编辑入口，
 * 上下键与 Home/End 在真 listbox 里走、回车挑、Esc 关；Tab 在「搜索框 → 目录 → 关闭」之间绕圈；
 * 关掉之后焦点回到那一项触发它的键。未接入的那一家看得见、挑不动，原因写在行尾。
 */
function PrismChooser({ model }: { model: StartModel }): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openedOnce = useRef(false);

  const ids = useMemo(() => model.choices.map((choice) => choice.service.id), [model.choices]);
  const size = ids.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      openedOnce.current = true;
      inputRef.current?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // 关掉的这一发才把焦点还给触发键：首帧 open=false 不许抢焦点。
  useEffect(() => {
    if (open || !openedOnce.current) {
      return;
    }
    triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (prismSummonKey(event)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // 查询一变就回到列表第一行：不指着一行已经不存在的位置。
  useEffect(() => {
    setIndex(0);
  }, [model.query]);

  const choose = (choice: ProviderChoice): void => {
    if (!choice.service.available) {
      return;
    }
    model.pick(choice.service.id);
    setOpen(false);
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const action = prismKeyAction(event.key);
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action === 'close') {
      setOpen(false);
      return;
    }
    if (action === 'choose') {
      const current = model.choices[index];
      if (current !== undefined) {
        choose(current);
      }
      return;
    }
    if (action === 'up') {
      setIndex(prismMove(index, size, -1));
      return;
    }
    if (action === 'down') {
      setIndex(prismMove(index, size, 1));
      return;
    }
    setIndex(action === 'first' ? 0 : Math.max(0, size - 1));
  };

  const onDialogKey = (event: ReactKeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = prismFocusNext(prismFocusRing(ringRef.current), active, event.shiftKey);
    if (next === null) {
      return;
    }
    event.preventDefault();
    next.focus();
  };

  const current = model.choices.find((choice) => choice.current);

  return (
    <div className="pr-chooser" data-testid="start-provider">
      <div className="pr-chooser__bar">
        <button
          type="button"
          ref={triggerRef}
          className="pr-key pr-key--summon"
          data-testid="model-provider-open"
          onClick={() => {
            setOpen(true);
          }}
        >
          <span className="pr-key__glyph" aria-hidden="true">
            <MorphIcon
              icon={GLYPHS.search}
              reducedMotion="user"
              strokeWidth={1.6}
              size={18}
              color="currentColor"
            />
          </span>
          <span className="pr-key__name">挑一家服务</span>
          <span className="pr-chooser__kbd" aria-hidden="true">
            Ctrl K
          </span>
        </button>
        <span className="pr-chooser__count" data-testid="model-provider-count">
          {size + ' / ' + model.rows.length + ' 家'}
        </span>
      </div>

      <p className="pr-chooser__now">
        {current === undefined
          ? '没有正在给这一栏的一家：打开命令面板挑一家。'
          : '这一栏给的是 ' +
            current.service.label +
            '：' +
            providerNote(current.mark, current.service.auth, current.dirty)}
      </p>

      <dialog
        ref={dialogRef}
        className="pr-command"
        data-testid="model-provider-dialog"
        data-open={open ? 'true' : 'false'}
        aria-label="挑一家服务"
        onCancel={() => {
          setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
        }}
        onKeyDown={onDialogKey}
      >
        <div className="pr-command__ring" ref={ringRef}>
          <PrismField label="找一家服务" hint="按名称、标识或可填的模型名筛；空着就是整份目录。">
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                ref={inputRef}
                data-autofocus="true"
                className="pr-inset"
                type="search"
                value={model.query}
                placeholder="例如 Kimi、glm、deepseek"
                spellCheck={false}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-controls={listId}
                aria-activedescendant={size === 0 ? undefined : listId + '-' + ids[index]}
                role="combobox"
                aria-expanded="true"
                aria-label="在这扇目录里找一家服务"
                data-pr-focus="0"
                data-testid="model-provider-search"
                onChange={(event) => {
                  model.setQuery(event.target.value);
                }}
                onKeyDown={onSearchKey}
              />
            )}
          </PrismField>

          {size === 0 ? (
            <p className="pr-empty" data-testid="model-provider-empty">
              {'目录里没有「' +
                model.query.trim() +
                '」这一家。改一个字试试，或去管理模型扩展看看接进来了没有。'}
            </p>
          ) : (
            <ul
              className="pr-options"
              id={listId}
              role="listbox"
              aria-label="模型服务目录"
              tabIndex={0}
              data-pr-focus="1"
            >
              {model.choices.map((choice, at) => {
                const service = choice.service;
                const src = vendorIcon(choice.row.name);
                return (
                  <li
                    key={service.id}
                    id={listId + '-' + service.id}
                    className="pr-option"
                    role="option"
                    aria-selected={choice.current}
                    aria-disabled={service.available ? undefined : true}
                    data-mark={choice.mark}
                    data-active={at === index ? 'true' : 'false'}
                    data-testid={'model-pick-' + service.id}
                    title={service.unavailableReason ?? service.label}
                    onClick={() => {
                      setIndex(at);
                      choose(choice);
                    }}
                  >
                    <span className="pr-option__mark" aria-hidden="true">
                      {src === null ? null : <img src={src} alt="" width={18} height={18} />}
                    </span>
                    <span className="pr-option__name">{service.label}</span>
                    <span className="pr-option__note">
                      {providerNote(choice.mark, service.auth, choice.dirty)}
                    </span>
                    <span className="pr-option__region">
                      {service.region === 'cn' ? '中国大陆' : '国际'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="pr-command__foot">
            <span className="pr-command__hint">上下键走目录，回车挑这一家，Esc 关掉。</span>
            <PrismKey
              name="关闭"
              glyph={GLYPHS.close}
              data-pr-focus="2"
              data-testid="model-provider-close"
              onClick={() => {
                setOpen(false);
              }}
            />
          </div>
        </div>
      </dialog>
    </div>
  );
}

/* ------------------------------------------------------------ 接线与回执 */

/** 一种值键：没有图标，只有等宽的一串——填模型名与安静动作都用它。 */
function PrismValueKey({
  children,
  selected = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }): JSX.Element {
  return (
    <button
      {...rest}
      type="button"
      data-selected={selected ? 'true' : 'false'}
      className="pr-value"
    >
      {children}
    </button>
  );
}

function PrismLedger({ model }: { model: StartModel }): JSX.Element | null {
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
    <dl className="pr-ledger" data-testid="model-receipt">
      <div className="pr-ledger__row" data-tone={receipt.saved ? 'ok' : 'danger'}>
        <dt>写进本机</dt>
        <dd>{receipt.saved ? '已保存' : '没保存'}</dd>
      </div>
      <div className="pr-ledger__row" data-tone={receipt.tested ? 'ok' : 'warn'}>
        <dt>这一次探测</dt>
        <dd>{receipt.tested ? '通过' : '没通过'}</dd>
      </div>
      <div className="pr-ledger__row" data-tone={who.tone}>
        <dt>现在在用</dt>
        <dd>{who.text}</dd>
      </div>
      <p className="pr-ledger__line" role="status">
        {receipt.text}
      </p>
    </dl>
  );
}

function PrismConnect({ model }: { model: StartModel }): JSX.Element {
  const [revealKey, setRevealKey] = useState(false);
  if (!model.available || model.picked === undefined) {
    return (
      <p className="pr-empty" data-testid="start-connect-empty">
        {model.loading
          ? '正在读这台机器的模型配置…'
          : model.available
            ? '目录里还没有可接的服务。'
            : '这台机器还没有模型连接的通道，所以这里没有可填的表单。'}
      </p>
    );
  }

  const browserSignIn = model.picked.auth === 'browser';
  const mark: ProviderMark | null = model.mark;

  return (
    <form
      className="pr-connect"
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
      <div className="pr-connect__who">
        <span className="pr-connect__name">{model.picked.label}</span>
        <PrismSignal
          tone={mark === 'in-use' ? 'ok' : mark === 'unavailable' ? 'off' : 'warn'}
          note={
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
        </PrismSignal>
      </div>

      {browserSignIn ? (
        <div className="pr-connect__signin">
          <p className="pr-note">
            这一家用浏览器登录自己的账号，不填 API Key。登录完成只是这台机器读到了登录，
            能不能接上还要看随后那一次写入。
          </p>
          <div className="pr-dock pr-dock--inline">
            <PrismKey
              name={model.busy.signingIn ? '正在等登录结果…' : '登录并连接'}
              glyph={GLYPHS.link}
              tone="primary"
              type="submit"
              busy={model.busy.signingIn}
              disabled={!model.can.signIn}
              data-testid="model-signin"
            />
            {model.busy.signingIn ? (
              <PrismKey
                name="取消这次登录"
                glyph={GLYPHS.close}
                data-testid="model-signin-cancel"
                onClick={model.cancelSignIn}
              />
            ) : null}
          </div>
          {model.signing === null ? null : (
            <p className="pr-wait" role="status" data-testid="model-signin-line">
              {model.signing}
            </p>
          )}
        </div>
      ) : (
        <div className="pr-connect__fields">
          <PrismField
            label="模型名"
            hint={
              model.picked.models.length > 0
                ? '可以直接打，也可以点下面那一排这一家列出的名字。'
                : undefined
            }
            error={model.model.trim() === '' ? '模型名不能空着。' : undefined}
          >
            {({ inputId, describedBy, invalid }) => (
              <input
                id={inputId}
                className="pr-inset"
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
          </PrismField>

          {model.picked.models.length === 0 ? null : (
            <div className="pr-values" role="group" aria-label="这一家列出的模型名">
              {model.picked.models.map((name) => (
                <PrismValueKey
                  key={name}
                  selected={model.model === name}
                  data-testid={'model-suggest-' + name}
                  onClick={() => {
                    model.setModel(name);
                  }}
                >
                  {name}
                </PrismValueKey>
              ))}
            </div>
          )}

          <PrismField
            label="API Key"
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
              <span className="pr-keyline">
                <input
                  id={inputId}
                  className="pr-inset"
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
                <PrismKey
                  name={revealKey ? '藏起来' : '看一下'}
                  glyph={revealKey ? GLYPHS.presence.on : GLYPHS.presence.off}
                  pressed={revealKey}
                  className="pr-key--tight"
                  data-testid="key-reveal"
                  onClick={() => {
                    setRevealKey((next) => !next);
                  }}
                />
              </span>
            )}
          </PrismField>

          {/* 主操作是一整道亮梁，不是第四颗键：这一屏里只有它会写入这台机器。 */}
          <button
            type="submit"
            className="pr-beam"
            aria-busy={model.busy.saving ? true : undefined}
            disabled={!model.can.save || model.busy.saving}
            data-testid="model-save"
          >
            <span className="pr-beam__glyph" aria-hidden="true">
              <MorphIcon
                icon={GLYPHS.save}
                reducedMotion="user"
                strokeWidth={1.6}
                size={18}
                color="currentColor"
              />
            </span>
            <span className="pr-beam__label">
              {model.busy.saving ? '正在写入这台机器…' : '保存并开始'}
            </span>
          </button>
        </div>
      )}

      <div className="pr-dock">
        <PrismKey
          name={model.busy.testing ? '正在探测…' : '测试连接'}
          glyph={GLYPHS.probe}
          busy={model.busy.testing}
          disabled={!model.can.test}
          data-testid="model-test"
          onClick={model.test}
        />
        <PrismValueKey data-testid="model-getkey" onClick={model.openKeyPage}>
          {'去 ' + model.picked.label + ' 申请 Key'}
        </PrismValueKey>
        {model.sibling === undefined ? null : (
          <PrismValueKey data-testid="model-region" onClick={model.switchRegion}>
            {model.picked.region === 'cn' ? '改用国际平台' : '改用中国大陆平台'}
          </PrismValueKey>
        )}
        <PrismValueKey data-testid="model-manage" onClick={model.openPlugins}>
          管理模型扩展
        </PrismValueKey>
      </div>

      {model.tested === null ? null : (
        <PrismSignal tone={model.tested.passed ? 'ok' : 'danger'}>{model.tested.text}</PrismSignal>
      )}
      {model.can.save || browserSignIn ? null : (
        <p className="pr-hold" data-testid="model-save-reason">
          {model.reasons.save}
        </p>
      )}
      {model.can.test ? null : (
        <p className="pr-hold" data-testid="model-test-reason">
          {model.reasons.test}
        </p>
      )}

      <PrismLedger model={model} />
    </form>
  );
}

/* ---------------------------------------------------------------- 信号 */

/** 右边那一列：只有这台机器说过的事，没有编出来的延迟、百分比或分数。 */
function PrismSignals({ model }: { model: StartModel }): JSX.Element {
  if (model.phase === 'no-bridge') {
    return (
      <div className="pr-signals" data-testid="start-status">
        <PrismSignal tone="warn" note="这台机器还没有模型连接的通道。">
          没有连接通道
        </PrismSignal>
      </div>
    );
  }
  if (model.phase === 'read-failed') {
    return (
      <div className="pr-signals" data-testid="start-status">
        <PrismSignal tone="danger" note={model.error ?? '这台机器的模型配置没读到。'}>
          没读到配置
        </PrismSignal>
        <PrismKey
          name="重新读取"
          glyph={GLYPHS.undo}
          data-testid="status-refresh"
          onClick={model.refresh}
        />
      </div>
    );
  }
  if (model.phase === 'loading') {
    return (
      <div className="pr-signals" data-testid="start-status">
        <PrismSignal tone="neutral">正在读这台机器的模型配置…</PrismSignal>
      </div>
    );
  }
  const tone: PrismTone =
    model.phase === 'in-use' ? 'ok' : model.phase === 'in-use-paused' ? 'warn' : 'off';
  const words =
    model.phase === 'in-use' || model.phase === 'in-use-paused'
      ? (model.snapshotLabel ?? '在用的那一家没报出名字')
      : model.phase === 'saved-only'
        ? '本机存过配置，还没在用'
        : '还没有在用连接';
  return (
    <div className="pr-signals" data-testid="start-status">
      <PrismSignal tone={tone}>{words}</PrismSignal>
      {model.phase === 'in-use-paused' ? (
        <PrismSignal tone="warn" testid="start-paused">
          回应已暂停
        </PrismSignal>
      ) : null}
      {model.notice === null ? null : (
        <PrismSignal tone="neutral" testid="start-notice">
          {model.notice}
        </PrismSignal>
      )}
      <PrismSignal tone={model.desktop.mark === 'on' ? 'on' : 'off'}>
        {model.desktop.text}
      </PrismSignal>
      {model.dirty ? <PrismSignal tone="warn">这一家的改动还没写进这台机器</PrismSignal> : null}
      {model.keySaved ? <PrismSignal tone="neutral">本机存过这一家的 Key</PrismSignal> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- 桌宠 */

/** 工具面板里那一行：id 与 locator 与炉边共用一套说法，字样与形状是这一家自己的。 */
export interface PrismMenuItem {
  readonly id: 'chat' | 'mic' | 'cancel' | 'voice' | 'light' | 'dress' | 'close';
  readonly testid: string;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * 这一层工具面板列的是这台机器现在真能做的事：没接到会话就不列说话，没接到录音就不列录音，
 * 只有真的在录才列「丢掉这一次」，语音设置与去装扮只有外壳给了那两条入口才出现。
 */
export function prismMenuItems(preview: FamilyPreview): readonly PrismMenuItem[] {
  const items: PrismMenuItem[] = [
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
    label: preview.night ? '这块面板改回白天' : '这块面板切成夜里',
    disabled: false,
  });
  if (preview.entries.dress !== undefined) {
    items.push({ id: 'dress', testid: 'pet-menu-dress', label: '去装扮', disabled: false });
  }
  items.push({ id: 'close', testid: 'pet-menu-close', label: '关闭', disabled: false });
  return items;
}

export function PrismPetMenu({
  preview,
  menuId,
}: {
  preview: FamilyPreview;
  menuId: string;
}): JSX.Element {
  const run = (id: PrismMenuItem['id']): void => {
    if (id === 'chat') preview.composer.setOpen(true);
    else if (id === 'mic') preview.mic.toggle();
    else if (id === 'cancel') preview.mic.cancel();
    else if (id === 'voice') preview.entries.voice?.();
    else if (id === 'light') preview.setNight(!preview.night);
    else if (id === 'dress') preview.entries.dress?.();
    // 挑了哪一行都把这层收起来；「关闭」就是只收起来。
    preview.menu.close();
  };
  return (
    <div
      className="pr-menu"
      id={menuId}
      role="menu"
      data-testid="pet-menu-body"
      aria-label="这一格桌宠能做的那几件事"
    >
      <h3 className="pr-menu__title">这一格能做的那几件事</h3>
      {prismMenuItems(preview).map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="pr-menu__item"
          disabled={item.disabled}
          data-testid={item.testid}
          onClick={() => {
            run(item.id);
          }}
        >
          <span className="pr-menu__bullet" aria-hidden="true" />
          <span className="pr-menu__label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function PrismPet({ model }: { model: StartModel }): JSX.Element {
  const preview = useFamilyPreview(model);
  const menuId = useId();
  if (!preview.available) {
    return (
      <PrismPane title="我的桌宠" testid="start-pet">
        <p className="pr-empty">这一页还没连上应用，所以看不见桌面上是哪一只。</p>
      </PrismPane>
    );
  }
  return (
    <PrismPane
      title="我的桌宠"
      meta="说话、录音、灯与挪动都接到这台机器上。"
      testid="start-pet"
      layer={2}
    >
      <div
        className="pr-stage"
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
          className="pr-key pr-stage__menu-open"
          aria-haspopup="menu"
          aria-expanded={preview.menu.open}
          {...(preview.menu.open ? { 'aria-controls': menuId } : {})}
          data-testid="pet-menu"
          onClick={preview.menu.toggle}
        >
          <span className="pr-key__glyph" aria-hidden="true">
            <MorphIcon
              icon={GLYPHS.copy}
              reducedMotion="user"
              strokeWidth={1.6}
              size={18}
              color="currentColor"
            />
          </span>
          <span className="pr-key__name">这一格的那几件事</span>
        </button>
        {preview.menu.open ? <PrismPetMenu preview={preview} menuId={menuId} /> : null}
        {preview.bubble === null ? null : (
          <p className="pr-stage__say" role="status">
            {preview.bubble}
          </p>
        )}
        <span
          className="sf-figure pr-stage__figure"
          data-size={model.pet.values?.size ?? 'normal'}
          style={preview.figure.vars}
        >
          <button type="button" className="pr-stage__pet" {...preview.avatar}>
            <PetAvatar
              state={preview.figure.state}
              expression={preview.figure.expression}
              figure={preview.figure.figure}
              name={preview.figure.name}
            />
          </button>
        </span>
      </div>

      {preview.composer.present && preview.composer.open ? (
        <div className="pr-composer">
          <PrismField label={preview.composer.label} hint={preview.composer.hint}>
            {({ inputId }) => (
              <input
                id={inputId}
                className="pr-inset"
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
          </PrismField>
          <PrismKey
            name={preview.composer.sending ? '正在说…' : '说给它听'}
            glyph={GLYPHS.send}
            tone="primary"
            busy={preview.composer.sending}
            disabled={!preview.composer.canSubmit}
            data-testid="pet-composer-send"
            onClick={preview.composer.send}
          />
        </div>
      ) : null}

      {/* 这一家把所有动作收进底部那道浮起来的动作条：图标 + 看得见的名字。 */}
      <div className="pr-dock">
        <PrismKey
          name={model.paused ? '已暂停回应' : '暂时不回应'}
          glyph={GLYPHS.response.on}
          pressed={model.paused}
          busy={model.busy.pausing}
          data-testid="pet-pause"
          onClick={() => {
            model.togglePaused(!model.paused);
          }}
        />
        <PrismKey
          name="对它说一句"
          glyph={GLYPHS.voice.off}
          pressed={preview.composer.open}
          disabled={!preview.composer.present}
          data-testid="pet-chat-toggle"
          onClick={() => {
            preview.composer.setOpen(!preview.composer.open);
          }}
        />
        {preview.mic.present ? (
          <PrismKey
            name={preview.mic.label}
            glyph={preview.mic.pressed ? GLYPHS.voice.on : GLYPHS.voice.off}
            pressed={preview.mic.pressed}
            disabled={preview.mic.disabled}
            title={preview.mic.hint}
            data-testid="pet-mic-toggle"
            onClick={preview.mic.toggle}
          />
        ) : null}
        {preview.mic.pressed ? (
          <PrismValueKey data-testid="pet-mic-cancel" onClick={preview.mic.cancel}>
            丢掉这一次
          </PrismValueKey>
        ) : null}
        <PrismKey
          name={preview.night ? '面板改回白天' : '面板切成夜里'}
          glyph={preview.night ? GLYPHS.light.on : GLYPHS.light.off}
          pressed={preview.night}
          data-testid="pet-light-toggle"
          onClick={() => {
            preview.setNight(!preview.night);
          }}
        />
        <PrismKey
          name="在桌面隐藏"
          glyph={GLYPHS.presence.on}
          busy={model.busy.visibility}
          disabled={!model.desktopShown}
          data-testid="pet-hide"
          onClick={() => {
            model.setDesktopVisible(false);
          }}
        />
        <PrismKey
          name="在桌面显示"
          glyph={GLYPHS.presence.off}
          disabled={model.desktopShown || model.busy.visibility}
          data-testid="pet-show"
          onClick={() => {
            model.setDesktopVisible(true);
          }}
        />
        {preview.entries.dress === undefined ? null : (
          <PrismKey
            name="去装扮"
            glyph={GLYPHS.dress}
            data-testid="pet-dress"
            onClick={preview.entries.dress}
          />
        )}
        {preview.entries.voice === undefined ? null : (
          <PrismValueKey data-testid="pet-voice" onClick={preview.entries.voice}>
            语音设置
          </PrismValueKey>
        )}
      </div>
    </PrismPane>
  );
}

/* ---------------------------------------------------------------- 配色 */

/** 词表是扁平的一串：按 token.group 归并成这一家的几段仪表。 */
export function groupPrismTokens(
  tokens: readonly ThemeToken[],
): { readonly group: string; readonly items: ThemeToken[] }[] {
  const out: { group: string; items: ThemeToken[] }[] = [];
  for (const token of tokens) {
    const bucket = out.find((item) => item.group === token.group);
    if (bucket === undefined) {
      out.push({ group: token.group, items: [token] });
    } else {
      bucket.items.push(token);
    }
  }
  return out;
}

const MODE_GLYPH: Readonly<Record<ThemeMode, IconNode>> = {
  light: GLYPHS.light.off,
  dark: GLYPHS.light.on,
  system: GLYPHS.region,
};

function PrismColors({ theme }: { theme: FamilyTheme }): JSX.Element {
  const { snapshot, actions, tokens, seeded } = theme;
  const record = snapshot.record;
  const schemes = allSchemes(record);
  const appearance = snapshot.appearance;

  return (
    <div data-testid="start-theme">
      <PrismPane
        title="界面配色"
        meta={
          seeded
            ? '这一家的呈现种子贴在窗上：改一格或换方案就把这扇窗交回本机记录。'
            : '这一扇窗已交给本机记录：改哪格都还是试色，保存才写进去。'
        }
        testid="theme-studio"
        layer={2}
      >
        <div className="pr-row" data-seeded={seeded ? 'true' : 'false'}>
          {THEMES.map((mode: ThemeMode) => (
            <PrismKey
              key={mode}
              name={THEME_MODE_NAMES[mode]}
              glyph={MODE_GLYPH[mode]}
              pressed={record.mode === mode}
              data-testid={'theme-mode-' + mode}
              onClick={() => {
                actions.chooseMode(mode);
              }}
            />
          ))}
        </div>

        <PrismField label="方案名" hint="另存或覆盖时用它；最长 40 字。">
          {({ inputId }) => (
            <input
              id={inputId}
              className="pr-inset"
              type="text"
              value={snapshot.name}
              maxLength={SCHEME_NAME_MAX}
              data-testid="theme-scheme-name"
              onChange={(event) => {
                actions.setName(event.target.value);
              }}
            />
          )}
        </PrismField>

        <ul className="pr-schemes">
          {schemes.map((scheme) => {
            const on = scheme.id === record.selectedId;
            return (
              <li className="pr-scheme" key={scheme.id} data-on={on ? 'true' : 'false'}>
                <button
                  type="button"
                  className="pr-scheme__pick"
                  aria-current={on ? 'true' : undefined}
                  data-testid={'theme-scheme-' + scheme.id}
                  onClick={() => {
                    actions.chooseScheme(scheme.id);
                  }}
                >
                  <span className="pr-scheme__band" aria-hidden="true">
                    {schemeSwatches(scheme, appearance).map((color, index) => (
                      <span key={index} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="pr-scheme__name">{scheme.name}</span>
                  <span className="pr-scheme__note">
                    {scheme.builtin === true ? '内置' : '自定义'} ·{' '}
                    {THEME_APPEARANCE_LABELS[appearance]}变体
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {groupPrismTokens(tokens).map((bucket) => (
          <div className="pr-instruments" key={bucket.group}>
            <h3 className="pr-instruments__group">{bucket.group}</h3>
            {bucket.items.map((token) => {
              const value = snapshot.draft[token.key] ?? '#000000';
              const invalid = snapshot.invalidKeys.has(token.key);
              return (
                <div
                  className="pr-instrument"
                  key={token.key}
                  data-bad={invalid ? 'true' : 'false'}
                >
                  <span
                    className="pr-instrument__strip"
                    aria-hidden="true"
                    style={{ background: value }}
                  />
                  <span className="pr-instrument__label">{token.label}</span>
                  <input
                    className="pr-instrument__pick"
                    type="color"
                    value={value}
                    aria-label={token.label + '选色'}
                    data-testid={'theme-token-' + token.key + '-picker'}
                    onChange={(event) => {
                      actions.editToken(token.key, event.target.value, 'picker');
                    }}
                  />
                  <input
                    className="pr-instrument__hex"
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
        ))}

        <PrismSignal
          tone={
            snapshot.status.tone === 'danger'
              ? 'danger'
              : snapshot.status.tone === 'ok'
                ? 'ok'
                : 'neutral'
          }
        >
          {snapshot.status.text}
        </PrismSignal>

        <div className="pr-dock">
          <PrismKey
            name="撤销预览"
            glyph={GLYPHS.undo}
            disabled={!snapshot.previewActive}
            data-testid="theme-undo-preview"
            onClick={actions.undoPreview}
          />
          <PrismKey
            name="复制为新方案"
            glyph={GLYPHS.copy}
            data-testid="theme-copy"
            onClick={actions.copyAsNew}
          />
          {snapshot.canWrite ? (
            <PrismKey
              name={snapshot.deleteArmed ? '再次点击确认删除' : '删除方案'}
              glyph={GLYPHS.trash}
              tone="danger"
              data-testid="theme-delete"
              onClick={actions.requestDelete}
            />
          ) : null}
          <PrismKey
            name={snapshot.canWrite ? '保存当前方案' : '另存为自定义'}
            glyph={GLYPHS.save}
            tone="primary"
            data-testid="theme-save"
            onClick={actions.save}
          />
        </div>
      </PrismPane>
    </div>
  );
}

/* ---------------------------------------------------------------- 样板 */

const BOARD_OPTIONS = [
  { id: 'pane', label: '分层面板', note: '样板：这一条只是这一家的一层' },
  { id: 'dock', label: '动作条', note: '样板：图标键与看得见的名字' },
  { id: 'signal', label: '信号列', note: '样板：灯加一句话，没有编出来的数字' },
];

const BOARD_TONES: readonly (readonly [PrismTone, string])[] = [
  ['on', '在桌面上'],
  ['off', '已隐藏'],
  ['ok', '已保存'],
  ['warn', '已保存未测'],
  ['danger', '连接没成功'],
  ['neutral', '还没读过'],
];

/**
 * 这一家控件自己的状态样板：命令面板、内嵌字段、图标键、值键、信号行与浮起动作条都能真开、真填、真按，
 * 状态只活在这块样板里。样板上的文字不是后台回执——Start 那一屏里的「已保存 / 探测过 / 在用」只在真动作之后出现。
 */
function PrismBoard(): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState('pane');
  const [lamp, setLamp] = useState(false);
  const [mute, setMute] = useState(false);
  const [name, setName] = useState('');
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  const needle = query.trim();
  const rows = BOARD_OPTIONS.filter((item) => needle === '' || item.label.includes(needle));
  const size = rows.length;
  const chosenLabel = rows.find((item) => item.id === chosen)?.label ?? chosen;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <div className="pr-board" data-testid="prism-board">
      <p className="pr-board__lead">
        这一页是棱镜这套控件自己的状态样板：能开、能填、能按、能开关，状态只在这块样板里。
        样板上的文字不是后台回执——Start 那一屏里的「已保存 / 探测过 / 在用」只在真动作之后才出现。
      </p>

      <PrismPane
        title="命令面板"
        meta="原生 dialog：Esc 关、上下键走目录、回车挑这一条。"
        layer={2}
      >
        <PrismKey
          name="打开样板面板"
          glyph={GLYPHS.search}
          data-testid="board-summon"
          onClick={() => {
            setOpen(true);
          }}
        />
        <p className="pr-note">{'样板当前选的是：' + chosenLabel}</p>
        <dialog
          ref={dialogRef}
          className="pr-command"
          data-testid="board-command"
          aria-label="样板面板"
          onCancel={() => {
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') {
              return;
            }
            const active =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const next = prismFocusNext(prismFocusRing(ringRef.current), active, event.shiftKey);
            if (next === null) {
              return;
            }
            event.preventDefault();
            next.focus();
          }}
        >
          <div className="pr-command__ring" ref={ringRef}>
            <PrismField label="在这块样板里找一条" hint="空着就是整份样板清单。">
              {({ inputId }) => (
                <input
                  id={inputId}
                  ref={inputRef}
                  data-autofocus="true"
                  data-pr-focus="0"
                  className="pr-inset"
                  type="search"
                  value={query}
                  spellCheck={false}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={
                    size === 0 ? undefined : listId + '-' + (rows[index]?.id ?? '')
                  }
                  data-testid="board-search"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setIndex(0);
                  }}
                  onKeyDown={(event) => {
                    const action = prismKeyAction(event.key);
                    if (action === null) {
                      return;
                    }
                    event.preventDefault();
                    if (action === 'close') {
                      setOpen(false);
                    } else if (action === 'choose') {
                      const row = rows[index];
                      if (row !== undefined) {
                        setChosen(row.id);
                        setOpen(false);
                      }
                    } else if (action === 'up') {
                      setIndex(prismMove(index, size, -1));
                    } else if (action === 'down') {
                      setIndex(prismMove(index, size, 1));
                    } else {
                      setIndex(action === 'first' ? 0 : Math.max(0, size - 1));
                    }
                  }}
                />
              )}
            </PrismField>
            <ul className="pr-options" id={listId} role="listbox" tabIndex={0} data-pr-focus="1">
              {rows.map((item, at) => (
                <li
                  key={item.id}
                  id={listId + '-' + item.id}
                  className="pr-option"
                  role="option"
                  aria-selected={item.id === chosen}
                  data-active={at === index ? 'true' : 'false'}
                  onClick={() => {
                    setChosen(item.id);
                    setOpen(false);
                  }}
                >
                  <span className="pr-option__name">{item.label}</span>
                  <span className="pr-option__note">{item.note}</span>
                </li>
              ))}
            </ul>
            <div className="pr-command__foot">
              <span className="pr-command__hint">Esc 关掉这块样板面板。</span>
              <PrismKey
                name="关闭"
                glyph={GLYPHS.close}
                data-pr-focus="2"
                data-testid="board-close"
                onClick={() => {
                  setOpen(false);
                }}
              />
            </div>
          </div>
        </dialog>
      </PrismPane>

      <PrismPane title="内嵌字段与值键" meta="字段没有底色，只有一道亮线；值键是等宽的一串。">
        <PrismField label="模型名" hint="可以直接打，空白就用这一家的默认值。">
          {({ inputId }) => (
            <input
              id={inputId}
              className="pr-inset"
              type="text"
              value={name}
              placeholder="deepseek-flash"
              autoComplete="off"
              spellCheck={false}
              data-testid="board-field-input"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </PrismField>
        <PrismField
          label="API Key"
          hint="只活在这一次运行里，不写进任何文件。"
          error={
            name.trim() !== '' && name.trim().length < 4
              ? '这一格看着还没打完：' + name.trim().length + ' 字。'
              : undefined
          }
        >
          {({ inputId, describedBy, invalid }) => (
            <input
              id={inputId}
              className="pr-inset"
              type="password"
              defaultValue="sk-sample"
              autoComplete="off"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              data-testid="board-key-input"
              onChange={() => undefined}
            />
          )}
        </PrismField>
        <div className="pr-values" role="group" aria-label="样板值键">
          <PrismValueKey
            selected={name === 'deepseek-flash'}
            onClick={() => {
              setName('deepseek-flash');
            }}
          >
            deepseek-flash
          </PrismValueKey>
          <PrismValueKey
            selected={name === 'deepseek-reasoner'}
            onClick={() => {
              setName('deepseek-reasoner');
            }}
          >
            deepseek-reasoner
          </PrismValueKey>
        </div>
      </PrismPane>

      <PrismPane title="图标键与动作条" meta="开合用 aria-pressed；名字一直在图标旁边。">
        <div className="pr-dock pr-dock--inline">
          <PrismKey
            name={mute ? '已暂停回应' : '暂时不回应'}
            glyph={GLYPHS.response.on}
            pressed={mute}
            data-testid="board-pause"
            onClick={() => {
              setMute((next) => !next);
            }}
          />
          <PrismKey
            name={lamp ? '面板切回白天' : '面板切成夜里'}
            glyph={GLYPHS.light.on}
            pressed={lamp}
            data-testid="board-lamp"
            onClick={() => {
              setLamp((next) => !next);
            }}
          />
          <PrismKey name="这一颗按不动" glyph={GLYPHS.probe} disabled />
        </div>
      </PrismPane>

      <PrismPane title="信号行" meta="样板：灯只复认这句话，含义全在文字里。">
        <div className="pr-signals">
          {BOARD_TONES.map(([tone, text]) => (
            <PrismSignal
              key={tone}
              tone={tone}
              note={tone === 'danger' ? '下一步：检查网络或换一家' : undefined}
            >
              {text}
            </PrismSignal>
          ))}
        </div>
      </PrismPane>
    </div>
  );
}

/* ---------------------------------------------------------------- 门面 */

/** 左边的竖轨：图标 + 看得见的名字；当前这一页是文字，不是一颗按不动的键。 */
function PrismRail({ model, board }: { model: StartModel; board: boolean }): JSX.Element {
  return (
    <nav className="pr-rail" aria-label="设置台的其他几页">
      <span className="pr-rail__here" aria-current="page">
        <span className="pr-rail__glyph" aria-hidden="true">
          <MorphIcon
            icon={GLYPHS.save}
            reducedMotion="user"
            strokeWidth={1.6}
            size={18}
            color="currentColor"
          />
        </span>
        <span className="pr-rail__name">{board ? '样板' : '开始'}</span>
      </span>
      {NAV_VIEWS.map(([view, label]) => (
        <button
          key={view}
          type="button"
          className="pr-rail__item"
          data-testid={'prism-nav-' + view}
          onClick={() => {
            model.goToView(view);
          }}
        >
          <span className="pr-rail__glyph" aria-hidden="true">
            <MorphIcon
              icon={
                view === 'appearance'
                  ? GLYPHS.dress
                  : view === 'voice'
                    ? GLYPHS.voice.off
                    : view === 'conversation'
                      ? GLYPHS.link
                      : GLYPHS.region
              }
              reducedMotion="user"
              strokeWidth={1.6}
              size={18}
              color="currentColor"
            />
          </span>
          <span className="pr-rail__name">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** 一扇完整的窗：玻璃顶栏、竖轨、分层正文、右边信号列与脚下一行状态。 */
export function PrismFamily({ model, board, guide }: FamilyProps): JSX.Element {
  const theme = useFamilyTheme(PRISM_SEED);
  return (
    <div
      className="sf-prism"
      data-testid="family-prism"
      data-board={board ? 'true' : 'false'}
      style={{ ...theme.vars, colorScheme: theme.colorScheme }}
    >
      <header className="pr-bar">
        <span className="pr-bar__brand">
          <svg className="pr-bar__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path className="pr-bar__prism" d="M12 3 21 19H3z" />
            <path className="pr-bar__beam" d="M2 8h6M14 15h8M14 18h6" />
          </svg>
          <span className="pr-bar__name">棱镜</span>
          <span className="pr-bar__sub">桌宠的开始页 · 暗色环境</span>
        </span>
        {model.available ? null : (
          <span className="pr-bar__quiet">这台机器还没有模型连接的通道</span>
        )}
        {guide === undefined ? null : <span className="pr-bar__guide">{guide}</span>}
      </header>

      <div className="pr-shell">
        <PrismRail model={model} board={board} />
        <main className="pr-stack">
          {board ? (
            <PrismBoard />
          ) : (
            <>
              <PrismPane title="连接模型" meta="命令面板挑一家，这一栏只填这一家的模型名与 Key。">
                <PrismChooser model={model} />
                <PrismConnect model={model} />
              </PrismPane>
              <PrismPet model={model} />
              <PrismColors theme={theme} />
            </>
          )}
        </main>
        <aside className="pr-side">
          {board ? (
            <PrismPane title="信号列" meta="样板右侧这一列留给信号行。" layer={2}>
              <div className="pr-signals">
                <PrismSignal tone="neutral">这块样板不接 model 的动作</PrismSignal>
              </div>
            </PrismPane>
          ) : (
            <PrismSignals model={model} />
          )}
        </aside>
      </div>

      <footer className="pr-foot">
        <span className="pr-foot__note">
          {model.available
            ? model.paused
              ? '回应已暂停：这台机器还在用这一家'
              : 'Ctrl 加 K 打开命令面板'
            : '没有通道时这一屏只读，不画按得动的假控件'}
        </span>
      </footer>
    </div>
  );
}

export const PRISM_FAMILY: StyleFamily = {
  id: 'prism',
  name: '棱镜',
  description: '暗色环境玻璃桌面：命令面板挑服务、内嵌字段、图标键动作条与信号列。',
  Component: PrismFamily,
};

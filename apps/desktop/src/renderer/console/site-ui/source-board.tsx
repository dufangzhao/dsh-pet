/**
 * 源码对照板：左边是网站原件（vendored 的字节，一字未改），右边是本站真接进去的那一件。
 *
 * 最小可达的三对：按钮、输入栏、开关。右边那些状态格是真的控件——能 tab 进去看焦点、能点、
 * disabled/busy/error 都是真属性，不是画出来的样子；左边那一格由 raw-example.tsx 用 shadow root
 * 装上游字节，上游的 .button/.input/.switch 与设置台的类名互相进不去。
 *
 * 这块板是评审用的：由 Start 上那一条入口打开（只有未打包的 --start-design-lab 实例看得见），
 * 关掉回到 Start 时正在输入的模型名与 Key 还在——那份草稿住在 pages/start.tsx 的 model 里，
 * 在这块板之上。这里不读宿主、不写存储、不碰录音与凭据。
 */
import './source-board.css';

import { useState, type JSX, type ReactNode } from 'react';

import { RawSourceExample } from './raw-example.js';
import { RAW_SOURCES, type RawSourceSlug } from './raw-source.js';
import { SiteGlyphIcon, SiteMorphIcon, SITE_GLYPH_NAMES } from './site-icons.js';
import { SourceButton } from './source-button.js';
import { SourceField, SourceInput } from './source-input.js';
import { SourceSwitch } from './source-switch.js';
import { SOURCE_SURFACE_CLASS } from './source-surface.js';

/** 评审与 QA 对齐用的定位名：一块一处，不各写各的。 */
export const SOURCE_BOARD_SELECTORS = {
  root: 'site-source-board',
  /** 一对 = 上游原件 + 本机集成件，按上游 slug 命名。 */
  pair: (slug: RawSourceSlug): string => 'source-pair-' + slug,
  raw: (slug: RawSourceSlug): string => 'raw-' + slug,
  adaptedButton: 'source-adapted-button',
  adaptedInput: 'source-adapted-input',
  adaptedSwitch: 'source-adapted-switch',
  glyphDemo: 'source-glyph-demo',
  allGlyphs: 'source-glyphs-all',
  extensions: 'source-extensions',
  close: 'source-board-close',
  open: 'site-source-open',
} as const;

interface PairFact {
  slug: RawSourceSlug;
  title: string;
  kept: string;
  adapted: string;
  extended: string;
}

const TRIO: readonly [PairFact, PairFact, PairFact] = [
  {
    slug: 'afraid-squid-51',
    title: '按钮 afraid-squid-51',
    kept: '40px 一格、2px var(--main-color) 描边、5px 圆角、4px 4px 硬偏移投影、17px/600 字、按下时投影归零并 translate(3px, 3px)',
    adapted:
      '宽度 120px 改成下限并加 12px 内边距托住长动作词；高度仍是原件的 40px（按钮是 border-box，外高与上游一致）；六个 token 从元素上收到 .su-source 一层；文字换成站里的说法',
    extended:
      'disabled 压暗、busy 停在按下那一格并加 aria-busy、小密度档只换高度与 15px 字、键盘焦点环、prefers-reduced-motion',
  },
  {
    slug: 'polite-stingray-67',
    title: '输入栏 polite-stingray-67',
    kept: '内容尺寸 200×40、2px 描边、5px 圆角、4px 4px 硬投影、15px/600 字、5px 10px 内边距、::placeholder 用 --font-color-sub 且 0.8 透明、焦点换成 --input-focus 那一圈 2px',
    adapted:
      '宽度改成随栏伸缩（原件 200px 内容宽 → 这一栏的满宽）；外高 54 → 40：上游是 content-box（40 + 上下 5px 内边距 + 2px 描边 = 54），本站按 border-box 统一成 40px 那一档控件高度，少掉的正是那 14px 内 padding；' +
      '上游拿 placeholder 当名称（Password），本站把名称交给原生 <label htmlFor>，placeholder 只留举例，另加名称块 .su-field；类型按用途给——这一件上游示范是 type=password，Key 那一栏照用 password，模型名那一栏用 type=text（应用类型适配，不是另一件控件）',
    extended:
      'disabled、aria-invalid 的错误描边（同一圈 2px 只换色）、hint/error 的 aria-describedby 关联与 role=alert',
  },
  {
    slug: 'empty-penguin-100',
    title: '开关 empty-penguin-100',
    kept: '70×36 一格、100px 圆轨 + 2px 描边 + 4px 4px 硬投影、30px 圆钮（left 2px / bottom 1px）、钮上是 off/on 那一句 14px/600 的字、checked 时整轨 translateX(-32px) 而钮 translateX(32px)、0.3s 过渡、未开时轨色 --input-out-of-focus、开时 --input-focus',
    adapted:
      '上游不写名称：这里让原生 <label> 包住 checkbox 与名称，可访问名称只指那一句名称、补充走 aria-describedby；钮上的字换成中文，位置/字号/行高不变',
    extended:
      '键盘焦点环（用原件自己的 --input-focus）、disabled 压暗、prefers-reduced-motion 停掉那 0.3s',
  },
];

function State({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="su-board__state">
      <span className="su-board__state-label">{label}</span>
      <div className="su-board__line">{children}</div>
    </div>
  );
}

function Pair({ fact, children }: { fact: PairFact; children: ReactNode }): JSX.Element {
  const source = RAW_SOURCES[fact.slug];
  return (
    <section className="su-board__pair" data-testid={SOURCE_BOARD_SELECTORS.pair(fact.slug)}>
      <h3 className="su-board__name">{fact.title}</h3>
      <div className="su-board__cells">
        <div className="su-board__cell">
          <p className="su-board__cell-title">网站原件（未改一字节）</p>
          <RawSourceExample slug={fact.slug} />
        </div>
        <div className="su-board__cell">
          <p className="su-board__cell-title">本机集成件（真实控件）</p>
          <div className="su-board__states">{children}</div>
        </div>
      </div>
      <dl className="su-board__facts">
        <div>
          <dt>保留</dt>
          <dd>{fact.kept}</dd>
        </div>
        <div>
          <dt>适配</dt>
          <dd>{fact.adapted}</dd>
        </div>
        <div>
          <dt>延伸</dt>
          <dd>{fact.extended}</dd>
        </div>
        <div>
          <dt>出处</dt>
          <dd>
            <a className="su-board__link" href={source.permalink} target="_blank" rel="noreferrer">
              {source.permalink}
            </a>
            <span className="su-board__hash">
              {source.vendoredFile + ' · sha256 ' + source.sha256.slice(0, 12)}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export interface SourceBoardProps {
  /** 关掉这块板，回到 Start。没有就不画这条退路。 */
  onBack?: () => void;
}

export function SourceBoard({ onBack }: SourceBoardProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState('deepseek-chat');
  const [key, setKey] = useState('');
  const [paused, setPaused] = useState(true);
  const [shown, setShown] = useState(true);

  /** 等一秒就回来：这一格只看「等待」长什么样，不碰任何宿主动作。 */
  const showBusy = (): void => {
    setBusy(true);
    setTimeout(() => setBusy(false), 1000);
  };

  const boardClass = 'su-board ' + SOURCE_SURFACE_CLASS;

  return (
    <div className={boardClass} data-testid={SOURCE_BOARD_SELECTORS.root}>
      <header className="su-board__head">
        <h2 className="su-board__title">源码对照板</h2>
        <p className="su-board__note">
          来源：Uiverse.io by andrew-demchenk0（MIT；uiverse-io/galaxy @ adbd2ad，vendored 在
          site-ui/upstream/）+ morphicons 2.0.2 与 Tabler outline 的 17 枚字形（MIT；vendored 在
          site-ui/assets/）。逐件 SHA-256、上游 raw URL 与接到的文件都在
          site-ui/source-manifest.json。
        </p>
        {onBack === undefined ? null : (
          <p className="su-board__toolbar">
            <button
              type="button"
              className="su-board__close"
              data-testid={SOURCE_BOARD_SELECTORS.close}
              onClick={onBack}
            >
              回 Start
            </button>
            <span className="su-board__hint">正在输入的模型名与 Key 不在这块板上，回去还在。</span>
          </p>
        )}
      </header>

      <div className="su-board__pairs">
        <Pair fact={TRIO[0]}>
          <State label="正常（tab 进来就是原件那一圈焦点色）">
            <SourceButton
              data-testid={SOURCE_BOARD_SELECTORS.adaptedButton}
              onClick={() => undefined}
            >
              保存并开始
            </SourceButton>
          </State>
          <State label="等待（停在按下那一格 + aria-busy）">
            <SourceButton busy={busy} onClick={showBusy}>
              {busy ? '正在写入这台机器…' : '点一下看等待'}
            </SourceButton>
          </State>
          <State label="不能按 / 小密度 + 一枚 vendored 字形">
            <SourceButton disabled>测试连接</SourceButton>
            <SourceButton
              size="small"
              leading={<SiteGlyphIcon name="player-play" size={16} />}
              onClick={() => undefined}
            >
              登录并连接
            </SourceButton>
          </State>
        </Pair>

        <Pair fact={TRIO[1]}>
          <State label="正常">
            <SourceField label="模型名" hint="可以直接打，也可以从这家列出的名字里挑。">
              {(control) => (
                <SourceInput
                  id={control.inputId}
                  aria-describedby={control.describedBy}
                  data-testid={SOURCE_BOARD_SELECTORS.adaptedInput}
                  value={model}
                  placeholder="deepseek-chat"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setModel(event.target.value)}
                />
              )}
            </SourceField>
          </State>
          <State label="空着（同一圈描边换错误色 + role=alert）">
            <SourceField
              label="这家服务的 API Key"
              hint="留空就沿用这台机器上已经存着的那一份。"
              error="这一家要填 API Key 才能写进这台机器。"
            >
              {(control) => (
                <SourceInput
                  id={control.inputId}
                  aria-describedby={control.describedBy}
                  invalid={control.invalid}
                  type="password"
                  value={key}
                  placeholder="sk-…"
                  autoComplete="off"
                  onChange={(event) => setKey(event.target.value)}
                />
              )}
            </SourceField>
          </State>
          <State label="这一栏本机存不住（disabled）">
            <SourceInput
              readOnly
              disabled
              value=""
              placeholder="这台机器还没读到配置"
              aria-label="读不到的配置"
            />
          </State>
        </Pair>

        <Pair fact={TRIO[2]}>
          <State label="开着 / 关着（同一件，钮上是「开」「关」）">
            <SourceSwitch
              label="暂时不回应"
              hint="只是让它先不开口，录音与预览还在这里。"
              pressed={paused}
              data-testid={SOURCE_BOARD_SELECTORS.adaptedSwitch}
              onChange={setPaused}
            />
            <SourceSwitch label="在桌面显示这一只" pressed={shown} onChange={setShown} />
          </State>
          <State label="按不动（还没读到配置）">
            <SourceSwitch
              label="跟随日落换夜相"
              pressed={false}
              disabled
              onChange={() => undefined}
            />
          </State>
          <State label="两态一对的 vendored 字形（换一态就形变）">
            <button
              type="button"
              className="su-board__morph"
              data-testid={SOURCE_BOARD_SELECTORS.glyphDemo}
              onClick={() => setShown((next) => !next)}
            >
              <SiteMorphIcon
                active={shown}
                off="eye-off"
                on="eye"
                label={shown ? '显示中' : '已隐藏'}
              />
              <span>{shown ? 'eye' : 'eye-off'}</span>
            </button>
          </State>
        </Pair>

        <section className="su-board__pair" data-testid={SOURCE_BOARD_SELECTORS.extensions}>
          <h3 className="su-board__name">同作者的另外两件：选项组与卡片材质（已接）</h3>
          <div className="su-board__cells">
            <div className="su-board__cell">
              <p className="su-board__cell-title">网站原件（未改一字节）</p>
              <RawSourceExample slug="stupid-seahorse-9" label="分段单选 stupid-seahorse-9" />
              <p className="su-board__note">
                接到侧栏那三个明暗挡位（浅色 / 黑夜 / 跟随系统）：格宽按挡位数分、原生
                fieldset/legend 给组名、radio 的可访问名称走完整那一句话，窄栏里改成纵向三块。
              </p>
            </div>
            <div className="su-board__cell">
              <p className="su-board__cell-title">网站原件（未改一字节）</p>
              <RawSourceExample slug="afraid-cougar-9" label="整卡表单 afraid-cougar-9" />
              <p className="su-board__note">
                只取那张卡的材质当段落外壳（2px 描边、5px 圆角、4px 4px 硬投影、20px
                内边距与间隔）： Start 三节用的就是它。它的登录/注册两行、翻转卡与 flip
                业务没有移植。
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="su-board__pair" data-testid={SOURCE_BOARD_SELECTORS.allGlyphs}>
        <h3 className="su-board__name">Tabler outline 的 17 枚（vendored 数据）</h3>
        <div className="su-board__glyphs">
          {SITE_GLYPH_NAMES.map((name) => (
            <span className="su-board__glyph" key={name}>
              <SiteGlyphIcon name={name} size={20} label={name} />
              <span className="su-board__glyph-name">{name}</span>
            </span>
          ))}
        </div>
        <p className="su-board__note">
          线宽 2；弹簧用库里发布的那一个 preset 名 smooth（网站上这一格默认显示的是
          snappy，两个都是库里的名字）。 逐枚 SHA-256 与上游 raw URL 记在 source-manifest.json，原始
          SVG 在 assets/icons/。
        </p>
      </section>
    </div>
  );
}

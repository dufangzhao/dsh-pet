/**
 * 原创控件样板台：把这套控件的真实状态一块块摆出来，供 1200×800、880×600、
 * 深浅两挡、放大与键盘走查时对照。
 *
 * 这里不假装后端：每一块都是能真的按、真的填、真的开关的东西——
 * 按钮的悬停与按下请用自己的手去试（板上写明这一点），禁用与等待是本真的 DOM 状态。
 * 想要一个没有后端就不能存在的“假数据源”，这里一律不做。
 */
import { useState, type JSX, type ReactNode } from 'react';

import { Button, Disclosure, Field, Notice, Status, Tile, Toggle } from './kit.js';
import { BrandMark, CatIcon, HideIcon, MoonIcon, PawIcon } from '../icons.js';

const TONES = ['neutral', 'on', 'off', 'ok', 'warn', 'danger'] as const;
const STATUS_WORDS: Readonly<Record<(typeof TONES)[number], string>> = {
  neutral: '未设置',
  on: '在桌面上',
  off: '已隐藏',
  ok: '已连接',
  warn: '已保存未测',
  danger: '连接失败',
};

/** 一块样板：标题说要对照什么，下面是真控件。 */
function Sample({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="pb-board__sample" aria-label={title}>
      <header className="pb-board__head">
        <h3 className="pb-board__title">{title}</h3>
        <p className="pb-board__note">{note}</p>
      </header>
      <div className="pb-board__parts">{children}</div>
    </section>
  );
}

export function OriginalControlBoard(): JSX.Element {
  const [sound, setSound] = useState(true);
  const [night, setNight] = useState(false);
  const [picked, setPicked] = useState('deepseek');
  const [receipt, setReceipt] = useState(true);
  const [name, setName] = useState('');
  const [key, setKey] = useState('sk-1234');
  const [mode, setMode] = useState('light');
  const [language, setLanguage] = useState('cn');

  /* 每块样板的失败原因只说在它自己那一格上：Key 贴到一半就该 Key 那格报错，模型名不替它挨骂。 */
  const keyShort = key.trim().length > 0 && key.trim().length < 20;

  return (
    <div className="pb-board" data-testid="original-control-board">
      <Sample
        title="品牌与自家字形"
        note="标记、猫、肉垫、隐藏、夜：全部是本项目的 24 格 1.6 线宽字形，不是外部图标包。"
      >
        <span className="pb-board__glyphs">
          <BrandMark />
          <CatIcon />
          <PawIcon />
          <HideIcon />
          <MoonIcon />
        </span>
      </Sample>

      <Sample
        title="板扣按钮 · 四种语气"
        note="悬停与按下用真手去试：按下去板面落到板底那道搁置上。"
      >
        <Button>在桌面显示</Button>
        <Button variant="primary">保存并开始</Button>
        <Button variant="quiet">使用向导</Button>
        <Button variant="danger">停用</Button>
        <Button size="small">测试连接</Button>
      </Sample>

      <Sample
        title="板扣按钮 · 禁用与等待结果"
        note="等待时自动禁用并标 aria-busy；文案要说清在等什么。"
      >
        <Button disabled>保存并开始</Button>
        <Button variant="primary" busy>
          正在保存…
        </Button>
        <Button variant="danger" busy size="small">
          正在测试…
        </Button>
      </Sample>

      <Sample
        title="铭牌字段"
        note="铭牌压在板子上沿，名称即控件的可访问名称；失败那句用 role=alert 立即播报。"
      >
        <Field label="模型名称" hint="留空就用这一家的默认值">
          <input
            className="pb-input"
            value={name}
            placeholder="deepseek-chat"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field
          label="DeepSeek 的 API Key"
          hint="只活在这一次运行里，不写进任何文件"
          {...(keyShort
            ? { error: '这把 Key 只有 ' + key.trim().length + ' 位，看起来还没贴全。' }
            : {})}
        >
          <input
            className="pb-input"
            type="password"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
        </Field>
        <Field label="回复语言" hint="只影响它说什么语言">
          <select
            className="pb-select"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
            }}
          >
            <option value="cn">简体中文</option>
            <option value="intl">English</option>
          </select>
        </Field>
      </Sample>

      <Sample
        title="插销开关"
        note="原生 checkbox 加 role=switch：空格键与读屏都是浏览器自己的能力。"
      >
        <Toggle
          label="开机后自己出现在桌面"
          hint="下次启动也记得"
          pressed={sound}
          onChange={setSound}
        />
        <Toggle label="跟随日落换夜相" pressed={night} onChange={setNight} />
        <Toggle label="这台机器不给录音" pressed={false} disabled onChange={() => undefined} />
      </Sample>

      <Sample title="单选板 · 主题三态" note="选中那档自己落成强调板；没有滑动轨道。">
        <span className="pb-choice" role="radiogroup" aria-label="明暗挡位">
          {(
            [
              ['light', '浅色'],
              ['dark', '黑夜'],
              ['system', '跟随系统'],
            ] as const
          ).map(([value, label]) => (
            <label className="pb-choice__option" key={value}>
              <input
                type="radio"
                name="board-theme"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                }}
              />
              <span className="pb-choice__text">{label}</span>
            </label>
          ))}
        </span>
      </Sample>

      <Sample title="状态牌" note="文字一直在，灯只是复认：截图转灰度也能读懂。">
        {TONES.map((tone) => (
          <Status tone={tone} key={tone}>
            {STATUS_WORDS[tone]}
          </Status>
        ))}
      </Sample>

      <Sample
        title="回执条"
        note="失败打断播报，成功只报一句；右边那颗按钮是真动作（把这条收起来）。"
      >
        <Notice tone="ok">已保存，桌宠现在开始用这家模型回应。</Notice>
        <Notice tone="warn">配置已保存，但还没测过连接。</Notice>
        {receipt ? (
          <Notice
            tone="danger"
            action={
              <Button size="small" variant="quiet" onClick={() => setReceipt(false)}>
                收起
              </Button>
            }
          >
            连接没有成功：这台机器没有访问那家服务的网络。
          </Notice>
        ) : null}
        <Notice live={false}>下面这三段只是说明，不播报，也不会因为一次保存而消失。</Notice>
      </Sample>

      <Sample
        title="选择瓦片 · 服务目录"
        note="右下角那枚方销只表达“就是这一家”；名称与状态都在文字里。"
      >
        <div className="pb-board__tiles">
          <Tile
            selected={picked === 'deepseek'}
            note={picked === 'deepseek' ? '在用' : '已存有 Key'}
            onClick={() => {
              setPicked('deepseek');
            }}
          >
            DeepSeek
          </Tile>
          <Tile
            selected={picked === 'kimi'}
            onClick={() => {
              setPicked('kimi');
            }}
          >
            Kimi
          </Tile>
          <Tile selected={false} note="未接入" disabled>
            智谱 GLM
          </Tile>
        </div>
      </Sample>

      <Sample
        title="抽屉段"
        note="原生 details：折叠状态本身可 Tab、可回车，窄屏不需要第二份逻辑。"
      >
        <Disclosure label="界面配色的 36 格" hint="改哪格、怎么回滚都在这里" defaultOpen>
          <p className="pb-board__body">
            展开体里只放内容本身，不再套第二种卡片。配色工作室、模型表单与预览台都共用这一层节奏。
          </p>
        </Disclosure>
      </Sample>
    </div>
  );
}

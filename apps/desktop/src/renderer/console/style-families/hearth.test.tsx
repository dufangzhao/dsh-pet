/**
 * Hearth 这一家盯四件事：
 * 1) 它真的画的是这一族的控件（大选择卡＝真 radio、开关＝role=switch、按钮＝胶囊 submit），
 *    而不是 pet bench 那套板件换个颜色；
 * 2) 能不能按、为什么按不动，读的还是 model 那一份判断，没动过的东西不冒充回执；
 * 3) 草稿与配色只有那一个所有者：输入框的值来自 model，36 格与挡位来自本机记录；
 * 4) 样板台不接 Start 的动作，也不画假连接。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FOREIGN_KIT, countOf, stubModel } from './stub-model.js';
import {
  HEARTH_SEED,
  HearthFamily,
  HearthPetMenu,
  groupHearthTokens,
  hearthMenuItems,
} from './hearth.js';
import { THEME_TOKENS } from '../theme.js';

import type { FamilyPreview } from './use-family-preview.js';
import type { FamilyProps } from './contracts.js';

/** 这一层菜单只读 preview 那一份事实：夹具给的就是那几个 present/pressed 值。 */
function previewStub(
  over: {
    mic?: { present: boolean; pressed: boolean; disabled?: boolean };
    composerPresent?: boolean;
    voice?: boolean;
    dress?: boolean;
    night?: boolean;
  } = {},
): FamilyPreview {
  const mic = over.mic ?? { present: true, pressed: false };
  return {
    mic: {
      present: mic.present,
      pressed: mic.pressed,
      disabled: mic.disabled ?? false,
      toggle: () => undefined,
      cancel: () => undefined,
    },
    composer: { present: over.composerPresent ?? true, open: false, setOpen: () => undefined },
    entries: {
      ...(over.voice === false ? {} : { voice: () => undefined }),
      ...(over.dress === false ? {} : { dress: () => undefined }),
    },
    night: over.night ?? false,
    setNight: () => undefined,
    menu: { open: true, toggle: () => undefined, close: () => undefined, show: () => undefined },
  } as unknown as FamilyPreview;
}

const view = (over: Partial<FamilyProps> = {}): string =>
  renderToStaticMarkup(
    <HearthFamily
      model={over.model ?? stubModel()}
      board={over.board ?? false}
      {...(over.guide === undefined ? {} : { guide: over.guide })}
    />,
  );

describe('Hearth 的控件体系', () => {
  it('整扇窗是这一家自己的：根节点与动作 locator 都在 family-hearth 下面', () => {
    const html = view();
    expect(html).toContain('class="sf-hearth"');
    expect(html).toContain('data-testid="family-hearth"');
    for (const id of [
      'start-status',
      'start-provider',
      'model-provider-search',
      'start-connect-form',
      'model-input',
      'key-input',
      'model-save',
      'model-test',
      'model-getkey',
      'model-manage',
      'start-pet',
      'pet-pause',
      'pet-hide',
      'pet-show',
      'start-theme',
    ]) {
      expect(html).toContain('data-testid="' + id + '"');
    }
  });

  it('目录是一家一张大卡：真 radio 圆圈、fieldset 分组，按不动的那一家是原生 disabled', () => {
    const html = view();
    expect(html).toContain('<fieldset class="hth-choices"');
    expect(html).toContain('<legend class="hth-choices__legend">');
    // 三处都用真 radio：目录三家、明暗三挡、方案三张
    expect(countOf(html, 'type="radio"')).toBe(9);
    expect(countOf(html, 'data-testid="model-pick-')).toBe(3);
    expect(html).toContain('data-mark="unavailable"');
    // 未接入那一家：radio 真的按不动，而不是靠 CSS 装样子
    expect(html).toMatch(/type="radio"[^>]*disabled[^>]*data-testid="model-pick-glm-cn"/);
    // 挑服务不是下拉框，也不是一行按钮
    expect(html).not.toContain('<select');
    expect(html).not.toContain('role="listbox"');
  });

  it('预览场景就是那块真的窝：locator 落在带 ref 的 div 上，不藏替身', () => {
    const html = view();
    expect(countOf(html, 'data-testid="pet-stage"')).toBe(1);
    expect(html).toMatch(
      /<div class="hth-nook" data-testid="pet-stage" data-light="day" aria-label="桌宠预览"/,
    );
    expect(countOf(html, 'data-testid="pet-poke"')).toBe(1);
  });

  it('开关是 role=switch，主操作是表单里唯一的 submit：不借旧板件，也不与别族共用构造', () => {
    const html = view();
    const board = view({ board: true });
    expect(countOf(html, 'role="switch"')).toBeGreaterThan(2);
    expect(countOf(html, 'type="submit"')).toBe(1);
    expect(html).toContain('class="hth-pill hth-pill--primary"');
    for (const marker of FOREIGN_KIT) {
      expect(html).not.toContain(marker);
      expect(board).not.toContain(marker);
    }
    expect(html).not.toContain('sf-prism');
    expect(html).not.toContain('sf-precision');
    expect(html).not.toContain('fl-');
  });

  it('按不动的时候原因说在同一页上：disabled 取的是判断的反面', () => {
    const blocked = view({
      model: stubModel({
        can: { save: false, test: false, signIn: false },
        reasons: {
          save: '模型名不能空着。',
          test: '还没有在用的连接：先保存一家，再测它。',
          signIn: '这一家在这台机器上还没接进来。',
        },
      }),
    });
    expect(blocked).toContain('data-testid="model-save-reason"');
    expect(blocked).toContain('模型名不能空着。');
    expect(blocked).toMatch(
      /data-testid="model-save"[^>]*disabled|disabled[^>]*data-testid="model-save"/,
    );
    expect(blocked).toContain('data-testid="model-test-reason"');
  });

  it('等待是真状态：aria-busy 与那句“正在写入这台机器”一起出现', () => {
    const busy = view({
      model: stubModel({
        busy: {
          saving: true,
          testing: true,
          signingIn: false,
          sending: false,
          visibility: false,
          pausing: false,
        },
      }),
    });
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('正在写入这台机器…');
    expect(busy).toContain('正在探测…');
  });

  it('回执只在真回执之后出现，三条事实分开摆', () => {
    expect(view()).not.toContain('data-testid="model-receipt"');
    const receipt = view({
      model: stubModel({
        saved: { saved: false, tested: false, active: false, text: '这台机器没收下这次写入。' },
      }),
    });
    expect(receipt).toContain('data-testid="model-receipt"');
    for (const line of ['写进本机', '这一次探测', '现在在用']) {
      expect(receipt).toContain('<dt>' + line + '</dt>');
    }
    expect(receipt).toContain('这台机器没收下这次写入。');
  });

  it('草稿只有 model 那一份：输入框显示的是它给的值', () => {
    const html = view({ model: stubModel({ model: 'deepseek-reasoner', key: 'sk-typed' }) });
    expect(html).toContain('value="deepseek-reasoner"');
    expect(html).toContain('value="sk-typed"');
    // 这一家列出的模型名是真的动作，不是 datalist 影子
    expect(html).toContain('data-testid="model-suggest-deepseek-cn-flash"');
    expect(html).not.toContain('<datalist');
  });

  it('没有会话就少画控件，不画一颗按得动的假按钮', () => {
    const off = view({
      model: stubModel({
        available: false,
        phase: 'no-bridge',
        pet: { ...stubModel().pet, mic: undefined, composer: undefined },
      }),
    });
    expect(off).toContain('没有连接通道');
    expect(off).not.toContain('data-testid="start-connect-form"');
    expect(off).not.toContain('data-testid="pet-mic-toggle"');
    expect(off).not.toContain('data-testid="pet-composer-input"');

    const paused = view({ model: stubModel({ phase: 'in-use-paused', paused: true }) });
    expect(paused).toContain('data-testid="start-paused"');
    expect(paused).toContain('data-testid="foot-paused"');
    // 暂停那颗开关真的处于开
    expect(paused).toMatch(
      /data-testid="pet-pause"[^>]*checked|checked[^>]*data-testid="pet-pause"/,
    );
  });

  it('窝里那一层菜单：可见触发键在场景里，默认收起，不画空的 surface', () => {
    const html = view();
    expect(countOf(html, 'data-testid="pet-menu"')).toBe(1);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="pet-menu-body"');
    // 触发键在带 ref 的那块场景 div 里面：点外收起的 hook 才不会被自己顶掉
    expect(html.indexOf('data-testid="pet-menu"')).toBeGreaterThan(
      html.indexOf('data-testid="pet-stage"'),
    );
  });

  it('那一层菜单列的就是这台机器真能做的事，行行都是原生 button', () => {
    const open = renderToStaticMarkup(<HearthPetMenu preview={previewStub()} menuId="m" />);
    expect(open).toContain('data-testid="pet-menu-body"');
    expect(open).toContain('role="menu"');
    // 说一句 / 录音 / 语音设置 / 灯 / 去装扮 / 关闭
    expect(countOf(open, 'role="menuitem"')).toBe(6);
    for (const id of [
      'pet-menu-chat',
      'pet-menu-mic',
      'pet-menu-voice',
      'pet-menu-light',
      'pet-menu-dress',
      'pet-menu-close',
    ]) {
      expect(open).toContain('data-testid="' + id + '"');
    }
    expect(open).toContain('窝里的灯切成夜里');
    expect(open).toContain('hth-nook__menu-item');

    // 只有真的在录才列「丢掉这一次」；话没说通就没有那一行
    const recording = hearthMenuItems(previewStub({ mic: { present: true, pressed: true } }));
    expect(recording.map((item) => item.id)).toContain('cancel');
    expect(recording.find((item) => item.id === 'mic')?.label).toBe('结束这一次录音');
    const noSession = hearthMenuItems(
      previewStub({
        mic: { present: false, pressed: false },
        composerPresent: false,
        voice: false,
        dress: false,
      }),
    );
    expect(noSession.map((item) => item.id)).toEqual(['chat', 'light', 'close']);
    expect(noSession[0]?.disabled).toBe(true);
    // 没接到录音的那一家：这一行压根不出现
    expect(
      hearthMenuItems(previewStub({ mic: { present: false, pressed: false } })).map(
        (item) => item.id,
      ),
    ).not.toContain('mic');
  });

  it('配色是这一家的种子加本机记录：36 格、三挡、方案都在', () => {
    const html = view();
    expect(html).toContain('data-seeded="true"');
    expect(html).toContain('--paper:#f6e9d2');
    expect(countOf(html, 'data-testid="theme-token-')).toBe(THEME_TOKENS.length * 2);
    expect(countOf(html, 'data-testid="theme-mode-')).toBe(3);
    expect(countOf(html, 'data-testid="theme-scheme-')).toBeGreaterThan(1);
    expect(html).toContain('data-testid="theme-save"');
    expect(html).toContain('data-testid="theme-undo-preview"');
    // 种子是浅黑各一份：词表是索引签名，取格子用方括号。
    expect(HEARTH_SEED.dark?.['paper']).toBe('#241a14');
  });

  it('36 格按词表的分组归并，顺序不变', () => {
    const groups = groupHearthTokens(THEME_TOKENS);
    expect(groups.map((group) => group.group)).toEqual([
      '背景层级',
      '文字与边界',
      '交互与状态',
      '控制台时间线',
      '图表系列',
    ]);
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(THEME_TOKENS.length);
  });

  it('样板台只画样板：不接 Start 的动作，也不冒充后台回执', () => {
    const board = view({ board: true });
    expect(board).toContain('data-testid="hearth-board"');
    expect(board).toContain('状态样板');
    expect(board).not.toContain('data-testid="model-save"');
    expect(board).not.toContain('data-testid="start-connect-form"');
    expect(board).not.toContain('data-testid="model-receipt"');
    // 样板里的控件仍然是真控件：radio、switch、字段都在
    expect(board).toContain('type="radio"');
    expect(board).toContain('role="switch"');
    expect(board).toContain('class="hth-field__well"');
  });

  it('向导只有外壳给进来才画', () => {
    expect(view()).not.toContain('start-guide');
    expect(
      view({
        guide: (
          <button type="button" data-testid="start-guide">
            使用向导
          </button>
        ),
      }),
    ).toContain('data-testid="start-guide"');
  });
});

/**
 * Prism 这一家盯四件事：
 * 1) 挑服务真的是命令面板（原生 dialog + listbox + 键盘），不是目录网格、不是下拉框，也不是 radio 卡；
 * 2) 开合用 aria-pressed 图标键、字段是无底色内嵌格——与炉边是两套控件，不是同一套换明暗；
 * 3) 能不能按、为什么按不动仍然读 model 那一份判断；信号列只报这台机器说过的事；
 * 4) 命令面板的键盘数学与焦点绕圈是真的，样板台不接 Start 的动作。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { THEME_TOKENS } from '../theme.js';
import { FOREIGN_KIT, countOf, stubModel } from './stub-model.js';
import {
  PRISM_SEED,
  PrismFamily,
  PrismPetMenu,
  groupPrismTokens,
  prismMenuItems,
  prismFocusNext,
  prismKeyAction,
  prismMove,
  prismSummonKey,
  prismTabTarget,
} from './prism.js';

import type { FamilyPreview } from './use-family-preview.js';
import type { FamilyProps } from './contracts.js';

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
    <PrismFamily
      model={over.model ?? stubModel()}
      board={over.board ?? false}
      {...(over.guide === undefined ? {} : { guide: over.guide })}
    />,
  );

describe('Prism 的命令面板', () => {
  it('挑一家 = 原生 dialog + 真 listbox：不是 radio 卡，也不是下拉框', () => {
    const html = view();
    expect(html).toContain('data-testid="model-provider-dialog"');
    expect(html).toContain('role="listbox"');
    expect(countOf(html, 'role="option"')).toBe(3);
    expect(countOf(html, 'data-testid="model-pick-')).toBe(3);
    expect(html).toContain('data-testid="model-provider-open"');
    expect(html).toContain('data-testid="model-provider-close"');
    // 搜索框是这一扇面板里的 combobox，activedescendant 指向第一行
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-activedescendant=');
    expect(html).toContain('data-autofocus="true"');
    // 这一家不用 radio、不用 select 挑服务
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<fieldset');
  });

  it('未接入那一家看得见但挑不动：aria-disabled 落在真 option 上', () => {
    const html = view();
    expect(html).toContain('data-testid="model-pick-glm-cn"');
    expect(html).toMatch(
      /aria-disabled="true"[^>]*data-testid="model-pick-glm-cn"|data-testid="model-pick-glm-cn"[^>]*aria-disabled="true"/,
    );
    expect(html).toContain('这台机器上还没装这一家');
  });

  it('键盘数学：上下绕回两端，Home/End 到边，回车挑，Esc 关', () => {
    expect(prismMove(0, 3, -1)).toBe(2);
    expect(prismMove(2, 3, 1)).toBe(0);
    expect(prismMove(1, 0, 1)).toBe(0);
    expect(prismKeyAction('ArrowDown')).toBe('down');
    expect(prismKeyAction('ArrowUp')).toBe('up');
    expect(prismKeyAction('Home')).toBe('first');
    expect(prismKeyAction('End')).toBe('last');
    expect(prismKeyAction('Enter')).toBe('choose');
    expect(prismKeyAction('Escape')).toBe('close');
    expect(prismKeyAction('a')).toBeNull();
    expect(prismSummonKey({ key: 'k', ctrlKey: true, metaKey: false })).toBe(true);
    expect(prismSummonKey({ key: 'K', ctrlKey: false, metaKey: true })).toBe(true);
    expect(prismSummonKey({ key: 'k', ctrlKey: false, metaKey: false })).toBe(false);
  });

  it('焦点只在面板两端接手：环内中间位置仍由浏览器自己走', () => {
    const ring = [{ id: 'search' }, { id: 'list' }, { id: 'close' }] as unknown as Parameters<
      typeof prismFocusNext
    >[0];
    expect(prismTabTarget(3, 2, false)).toBe(0);
    expect(prismTabTarget(3, 0, true)).toBe(2);
    expect(prismTabTarget(3, 1, false)).toBeNull();
    expect(prismTabTarget(0, 0, false)).toBeNull();
    expect(prismFocusNext(ring, null, false)).toBeNull();
    const last = ring[2];
    expect(prismFocusNext(ring, last ?? null, false)).toBe(ring[0]);
  });
});

describe('Prism 的控件体系', () => {
  it('整扇窗是这一家自己的：动作 locator 都在 family-prism 下面', () => {
    const html = view();
    expect(html).toContain('class="sf-prism"');
    expect(html).toContain('data-testid="family-prism"');
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

  it('开合是 aria-pressed 的图标键，字段是无底色内嵌格：不是炉边那一套', () => {
    const html = view();
    const board = view({ board: true });
    for (const marker of FOREIGN_KIT) {
      expect(html).not.toContain(marker);
      expect(board).not.toContain(marker);
    }
    expect(html).not.toContain('hth-');
    expect(html).toContain('class="pr-key__name"');
    expect(html).toContain('class="pr-inset"');
    expect(html).toContain('class="pr-field__key"');
    // 暂停那颗键用 aria-pressed，不是 role=switch，也不是勾选框
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('type="checkbox"');
    // 暂停那颗键的开合跟着 model.paused
    const paused = view({ model: stubModel({ paused: true }) });
    expect(paused).toMatch(
      /aria-pressed="true"[^>]*data-testid="pet-pause"|data-testid="pet-pause"[^>]*aria-pressed="true"/,
    );
    expect(view()).toMatch(
      /aria-pressed="false"[^>]*data-testid="pet-pause"|data-testid="pet-pause"[^>]*aria-pressed="false"/,
    );
    expect(countOf(html, 'aria-pressed=')).toBeGreaterThan(3);
  });

  it('预览场景就是那块真的舞台：locator 落在带 ref 的 div 上，不藏替身', () => {
    const html = view();
    expect(countOf(html, 'data-testid="pet-stage"')).toBe(1);
    expect(html).toMatch(
      /<div class="pr-stage" data-testid="pet-stage" data-light="day" aria-label="桌宠预览"/,
    );
    expect(countOf(html, 'data-testid="pet-poke"')).toBe(1);
  });

  it('导航是竖轨：当前这一页是文字，其余四页是真的跳转动作', () => {
    const html = view();
    expect(html).toContain('aria-current="page"');
    expect(countOf(html, 'data-testid="prism-nav-')).toBe(4);
    expect(html).not.toContain('href=');
  });

  it('按不动与等待都写在原生控件上，原因说在同一页', () => {
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
  });

  it('信号列只报这台机器说过的事：没测过不说测过，没回执不摆账本', () => {
    const html = view();
    expect(html).toContain('data-testid="start-status"');
    expect(html).not.toContain('data-testid="model-receipt"');
    // 不编指标：没有延迟、命中率这类没来源的数
    expect(html).not.toMatch(/\d+\s?ms/);

    const receipt = view({
      model: stubModel({
        saved: { saved: true, tested: false, active: true, text: '已写入这台机器。' },
      }),
    });
    expect(receipt).toContain('data-testid="model-receipt"');
    for (const line of ['写进本机', '这一次探测', '现在在用']) {
      expect(receipt).toContain('<dt>' + line + '</dt>');
    }

    const paused = view({
      model: stubModel({ phase: 'in-use-paused', paused: true, dirty: true }),
    });
    expect(paused).toContain('data-testid="start-paused"');
    expect(paused).toContain('这一家的改动还没写进这台机器');

    const clean = view();
    expect(clean).not.toContain('这一家的改动还没写进这台机器');
  });

  it('没有会话就少画控件：不画一颗按得动的假键，也不画假舞台', () => {
    const off = view({
      model: stubModel({
        available: false,
        phase: 'no-bridge',
        appAvailable: false,
        pet: { ...stubModel().pet, mic: undefined, composer: undefined },
      }),
    });
    expect(off).toContain('这台机器还没有模型连接的通道');
    expect(off).not.toContain('data-testid="start-connect-form"');
    expect(off).not.toContain('data-testid="pet-composer-input"');
    expect(off).not.toContain('data-testid="pet-poke"');
    expect(off).not.toContain('data-testid="pet-mic-toggle"');
  });

  it('舞台那一层工具面板：可见触发键在场景里，默认收起，不画空的 surface', () => {
    const html = view();
    expect(countOf(html, 'data-testid="pet-menu"')).toBe(1);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="pet-menu-body"');
    expect(html.indexOf('data-testid="pet-menu"')).toBeGreaterThan(
      html.indexOf('data-testid="pet-stage"'),
    );
  });

  it('工具面板那一行行都是原生 button，列的只有这台机器现在真能做的事', () => {
    const open = renderToStaticMarkup(<PrismPetMenu preview={previewStub()} menuId="m" />);
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
    expect(open).toContain('这块面板切成夜里');
    // 这一家的面板是玻璃行，不是炉边那套暖卡，也不是旧板件
    expect(open).toContain('pr-menu__item');
    expect(open).not.toContain('hth-');

    const recording = prismMenuItems(previewStub({ mic: { present: true, pressed: true } }));
    expect(recording.map((item) => item.id)).toContain('cancel');
    const noSession = prismMenuItems(
      previewStub({
        mic: { present: false, pressed: false },
        composerPresent: false,
        voice: false,
        dress: false,
      }),
    );
    expect(noSession.map((item) => item.id)).toEqual(['chat', 'light', 'close']);
    // 不能按的那一行用原生 disabled，不是一颗看着能按的假键
    const blocked = renderToStaticMarkup(
      <PrismPetMenu
        preview={previewStub({ mic: { present: true, pressed: false, disabled: true } })}
        menuId="m"
      />,
    );
    expect(blocked).toMatch(
      /disabled=""[^>]*data-testid="pet-menu-mic"|data-testid="pet-menu-mic"[^>]*disabled=""/,
    );
  });

  it('配色：36 格仪表、三挡图标键、方案用 aria-current，种子是暗色', () => {
    const html = view();
    expect(html).toContain('data-seeded="true"');
    expect(html).toContain('--paper:#e9eef3');
    expect(countOf(html, 'data-testid="theme-token-')).toBe(THEME_TOKENS.length * 2);
    expect(countOf(html, 'data-testid="theme-mode-')).toBe(3);
    expect(countOf(html, 'data-testid="theme-scheme-')).toBeGreaterThan(1);
    expect(html).toContain('data-testid="theme-save"');
    expect(html).toContain('aria-current="true"');
    expect(PRISM_SEED.dark?.['accent']).toBe('#7fc4e8');
    expect(PRISM_SEED.light?.['accent']).toBe('#1c5f86');
  });

  it('36 格按词表分组归并，顺序不变', () => {
    const groups = groupPrismTokens(THEME_TOKENS);
    expect(groups.map((group) => group.group)).toEqual([
      '背景层级',
      '文字与边界',
      '交互与状态',
      '控制台时间线',
      '图表系列',
    ]);
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(THEME_TOKENS.length);
  });

  it('样板台只画样板：命令面板是真的，但不接 Start 的动作', () => {
    const board = view({ board: true });
    expect(board).toContain('data-testid="prism-board"');
    expect(board).toContain('data-testid="board-command"');
    expect(board).toContain('role="listbox"');
    expect(board).not.toContain('data-testid="model-save"');
    expect(board).not.toContain('data-testid="start-connect-form"');
    expect(board).not.toContain('data-testid="model-receipt"');
    expect(board).toContain('aria-pressed=');
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

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PetMenu, type PetMenuProps } from './PetMenu.js';
import { parseCssRules } from './contrast.js';

const base: PetMenuProps = {
  name: '小蓝',
  canStop: false,
  stopping: false,
  onStop: () => {},
  guideDisabled: false,
  guideBusy: false,
  onGuide: () => {},
  quitDisabled: false,
  onQuit: () => {},
};
const render = (props: Partial<PetMenuProps> = {}) =>
  renderToStaticMarkup(<PetMenu {...base} {...props} />);
function button(html: string, id: string): string {
  const tag = new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0];
  expect(tag, id).toBeDefined();
  return tag ?? '';
}

afterEach(() => vi.unstubAllGlobals());

describe('紧凑菜单投影真实动作', () => {
  it('六格顺序与参考语义一致，划眼是隐藏桌宠', () => {
    const html = render();
    const actions = ['chat', 'voice', 'theme', 'sound', 'hide', 'appearance'];
    const positions = actions.map((action) => html.indexOf(`data-testid="pet-menu-${action}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(button(html, 'pet-menu-hide')).toContain('aria-label="隐藏桌宠"');
    expect(html).not.toContain('字幕');
    expect(html).not.toContain('Coopanion');
  });

  it('无回调或未知开关状态时明确禁用，不伪造已开启状态', () => {
    const html = render();
    for (const action of ['pause', 'chat', 'voice', 'theme', 'sound', 'hide', 'appearance']) {
      const tag = button(html, `pet-menu-${action}`);
      expect(tag).toContain('disabled');
      expect(tag).toContain('暂不可用');
      expect(tag).not.toContain('aria-pressed=');
    }
    expect(html).not.toContain('pet-menu__key');
  });

  it('开关与快捷键来自父快照，等待回执时不接受重复操作', () => {
    const html = render({
      paused: false,
      onTogglePause: () => {},
      chatOpen: true,
      onChat: () => {},
      voiceEnabled: true,
      talkKeyLabel: 'Alt×2',
      onToggleVoice: () => {},
      voicePending: true,
      appearance: 'dark',
      onToggleTheme: () => {},
      soundEnabled: false,
      onToggleSound: () => {},
      onHide: () => {},
      onAppearance: () => {},
    });
    expect(button(html, 'pet-menu-pause')).toContain('aria-pressed="false"');
    expect(button(html, 'pet-menu-chat')).toContain('aria-pressed="true"');
    expect(button(html, 'pet-menu-voice')).toContain('aria-busy="true"');
    expect(button(html, 'pet-menu-voice')).toContain('disabled');
    expect(html).toContain('Alt×2');
    expect(button(html, 'pet-menu-theme')).toContain('aria-label="切换为浅色"');
    expect(button(html, 'pet-menu-sound')).toContain('aria-pressed="false"');
    expect(button(html, 'pet-menu-sound')).toContain('aria-label="开启音效"');
    expect(button(html, 'pet-menu-hide')).not.toContain('disabled');
  });

  it('头像更多区保留原有引导、停止、继续提示与关闭，不自动调用动作', () => {
    const action = vi.fn();
    const html = render({
      canStop: true,
      stopping: true,
      onStop: action,
      onGuide: action,
      onResumeDialog: action,
      onClose: action,
      onQuit: action,
    });
    expect(button(html, 'pet-menu-more')).toContain('aria-expanded="false"');
    expect(html).toMatch(/class="pet-menu__more"[^>]*hidden/);
    for (const id of ['pet-guide', 'pet-stop', 'pet-resume-dialog', 'pet-menu-close'])
      expect(button(html, id)).toContain('<button');
    expect(button(html, 'pet-stop')).toContain('disabled');
    expect(action).not.toHaveBeenCalled();
    expect(render()).not.toContain('data-testid="pet-stop"');
  });

  it('设置仍由既有launcher决定可用性，名字不造默认值且保留完整title', () => {
    expect(button(render(), 'pet-settings')).toContain('disabled');
    const open = vi.fn();
    vi.stubGlobal('window', { petSettings: { open } });
    expect(button(render(), 'pet-settings')).not.toContain('disabled');
    expect(open).not.toHaveBeenCalled();
    const name = '一个很长但真实的桌宠名字';
    expect(render({ name })).toContain(`title="${name}"`);
    expect(render({ name: null })).not.toContain('data-testid="pet-name"');
    expect(render({ name: null })).not.toContain('小蓝');
  });

  it('参考尺寸与键盘焦点规则独立于明暗主题，减少动画明确覆盖', () => {
    const css = readFileSync(new URL('./pet.css', import.meta.url), 'utf8');
    const rules = parseCssRules(css);
    const rule = (selector: string) =>
      rules.find((item) => item.selector === selector && item.conditions.length === 0)
        ?.declarations;
    const panels = rules.filter(
      (item) => item.selector === '.pet-root__panel' && item.conditions.length === 0,
    );
    expect(panels.at(-1)?.declarations['width']).toBe('min(216px, calc(100% - 24px))');
    expect(rule('.pet-menu')?.['min-height']).toBe('165px');
    expect(rule('.pet-menu__header')?.['flex']).toBe('0 0 39px');
    expect(rule('.pet-menu__grid')?.['grid-template-columns']).toBe('repeat(3, minmax(0, 1fr))');
    expect(rule('.pet-menu__tile')?.['width']).toBe('46px');
    expect(rule('.pet-menu__tile')?.['height']).toBe('46px');
    expect(rule('.pet-menu__tile:focus-visible')?.['outline']).toContain('solid');
    expect(
      rules.some(
        (item) =>
          item.selector === '.pet-menu' &&
          item.conditions.some((condition) => condition.includes('prefers-reduced-motion')) &&
          item.declarations['animation']?.includes('none'),
      ),
    ).toBe(true);
  });
});

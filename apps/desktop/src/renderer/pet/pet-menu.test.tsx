import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PetMenu, type PetMenuProps } from './PetMenu.js';
import { parseCssRules } from './contrast.js';

const base: PetMenuProps = {
  name: '小蓝',
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
  it('日常四格是聊天、明暗、音效与设置；装扮与语音不在共享组合里', () => {
    const html = render({ chatOpen: false, onChat: () => {}, appearance: 'light' });
    for (const id of ['pet-menu-chat', 'pet-menu-theme', 'pet-settings']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(html).not.toContain('pet-menu-voice');
    expect(html).not.toContain('pet-menu-appearance');
    expect(html).not.toContain('字幕');
    expect(html).not.toContain('Coopanion');
  });

  it('没有连接与没有本机呈现时明确禁用，不伪造已开启状态', () => {
    const html = render();
    for (const id of ['pet-menu-chat', 'pet-menu-theme', 'pet-menu-sound']) {
      const tag = button(html, id);
      expect(tag).toContain('disabled');
      expect(tag).not.toContain('aria-pressed=');
    }
    // 暂停与引导两条旧入口在共享组合里根本不存在。
    expect(html).not.toContain('pet-menu-pause');
    expect(html).not.toContain('pet-guide');
  });

  it('开关来自父级投影，等待回执时不接受重复操作', () => {
    const html = render({
      chatOpen: true,
      onChat: () => {},
      appearance: 'dark',
      onToggleAppearance: () => {},
      soundEnabled: false,
      onToggleSound: () => {},
      soundPending: true,
    });
    expect(button(html, 'pet-menu-chat')).toContain('aria-pressed="true"');
    expect(button(html, 'pet-menu-theme')).toContain('aria-label="切换为浅色"');
    expect(button(html, 'pet-menu-sound')).toContain('aria-pressed="false"');
    expect(button(html, 'pet-menu-sound')).toContain('aria-label="开启音效"');
    expect(button(html, 'pet-menu-sound')).toContain('disabled');
  });

  it('停止这次回应只在能停时出现，且不等同于取消任务', () => {
    const action = vi.fn();
    const html = render({ canStop: true, stopping: true, onStop: action, onClose: action });
    expect(button(html, 'pet-stop')).toContain('disabled');
    expect(html).toContain('pet-menu-close');
    expect(action).not.toHaveBeenCalled();
    expect(render()).not.toContain('data-testid="pet-stop"');
  });

  it('设置仍由既有 launcher 决定可用性，名字不造默认值且保留完整 title', () => {
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

  it('连接状态与名字分成两行，连接没说就不占位', () => {
    expect(render({ connectionLabel: '已连接' })).toContain('data-testid="pet-menu-connection"');
    expect(render()).not.toContain('data-testid="pet-menu-connection"');
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

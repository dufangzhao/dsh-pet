import type { PetPresentationTheme } from '@pet/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PetTools, type PetToolsProps } from './PetTools.js';
import { petPresentationStyle } from './use-pet-settings.js';

const tools: PetToolsProps = {
  register: null,
  hover: ['chat'],
  chatOpen: false,
  canChat: true,
  onChat: () => {},
};

describe('悬停工具只画服务里真有的入口', () => {
  it('只有文字聊天这一枚圆形按钮，状态由连接决定', () => {
    const html = renderToStaticMarkup(<PetTools {...tools} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('pet-chat');
    expect(html).toContain('aria-expanded="false"');
    // 共享组合里没有本机语音输入：不画一个按不动的麦克风。
    expect(html).not.toContain('pet-mic');
    expect(html).not.toContain('按住说话');
  });

  it('没有连接通道时聊天入口禁用，并说明原因', () => {
    const unavailable = renderToStaticMarkup(<PetTools {...tools} canChat={false} />);
    expect(unavailable).toMatch(/<button[^>]*data-testid="pet-chat"[^>]*disabled/);
    expect(unavailable).toContain('没有连接服务的通道');
  });

  it('悬停配置里没有 chat 时整条工具不出现', () => {
    const html = renderToStaticMarkup(<PetTools {...tools} hover={[]} />);
    expect(html).not.toContain('pet-chat');
    expect(html.match(/<button/g)).toBeNull();
  });
});

describe('设置主题直接映射到 pet CSS 变量', () => {
  const theme: PetPresentationTheme = {
    appearance: 'dark',
    colors: {
      surface: '#20252b',
      surfaceQuiet: '#30363d',
      ink: '#f4f7fb',
      inkQuiet: '#bdc7d4',
      line: '#687483',
      field: '#171c22',
      primary: '#9cc4ff',
      onPrimary: '#152740',
    },
  };
  it('深色模式使用共享表面、文字、输入和主色，角色本身的墨色独立', () => {
    const style = petPresentationStyle(theme, 120, 50);
    expect(style).toMatchObject({
      colorScheme: 'dark',
      '--pet-surface': theme.colors.surface,
      '--pet-surface-quiet': theme.colors.surfaceQuiet,
      '--pet-ink': theme.colors.ink,
      '--pet-ink-soft': theme.colors.inkQuiet,
      '--pet-control-line': theme.colors.line,
      '--pet-field': theme.colors.field,
      '--pet-accent': theme.colors.primary,
      '--pet-on-primary': theme.colors.onPrimary,
      '--pet-bubble-font': '15.6px',
      '--pet-glow': '9px',
    });
    expect(style).not.toHaveProperty('--pet-character-ink');
  });
  it('没有主题快照时使用本地 CSS 默认值，不发明一次设置保存', () => {
    expect(petPresentationStyle(null, 100, 0)).toEqual({
      '--pet-bubble-font': '13px',
      '--pet-glow': '0px',
    });
  });
});

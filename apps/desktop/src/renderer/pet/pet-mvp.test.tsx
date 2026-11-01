import type { PetPresentationTheme } from '@pet/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PetTools, type PetToolsProps } from './PetTools.js';
import { petPresentationStyle } from './use-pet-settings.js';

const tools: PetToolsProps = {
  register: null,
  hover: ['chat', 'voice'],
  chatOpen: false,
  canChat: true,
  canRecord: true,
  recording: false,
  pending: false,
  talkKeyLabel: 'F8',
  onChat: () => {},
  onVoice: () => {},
};

describe('悬停工具反映已配置的真实能力', () => {
  it('默认只有聊天和语音两个圆形按钮，快捷键取自快照', () => {
    const html = renderToStaticMarkup(<PetTools {...tools} />);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('F8');
    expect(html).not.toContain('右 Alt');
    expect(html).not.toContain('按住说话');
    expect(html).not.toContain('轻按切换');
    expect(renderToStaticMarkup(<PetTools {...tools} talkKeyLabel="右 Alt" />)).toContain(
      '>右Alt<',
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-pressed="false"');
  });
  it('不显示未选中的入口，不把未就绪的麦克风当成可用', () => {
    const chat = renderToStaticMarkup(<PetTools {...tools} hover={['chat']} />);
    expect(chat).toContain('pet-chat');
    expect(chat).not.toContain('pet-mic');
    const unavailable = renderToStaticMarkup(<PetTools {...tools} canRecord={false} />);
    expect(unavailable).toMatch(/<button[^>]*data-testid="pet-mic"[^>]*disabled/);
  });
  it('正在录音时保留明确的结束入口，等待回执时禁用重复请求', () => {
    const recording = renderToStaticMarkup(<PetTools {...tools} canRecord={false} recording />);
    expect(recording).toContain('aria-pressed="true"');
    expect(recording).toContain('结束录音并发送');
    expect(recording).not.toMatch(/<button[^>]*data-testid="pet-mic"[^>]*disabled/);
    expect(renderToStaticMarkup(<PetTools {...tools} recording pending />)).toMatch(
      /<button[^>]*data-testid="pet-mic"[^>]*disabled/,
    );
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

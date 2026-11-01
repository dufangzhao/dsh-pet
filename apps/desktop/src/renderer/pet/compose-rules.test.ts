import { describe, expect, it } from 'vitest';

import { canSubmitDraft, draftAfterSubmit, isSubmitEnter } from './compose-rules.js';

describe('发送按钮只在有内容、且宿主能发时才可用', () => {
  const ready = { canSend: true, sending: false };

  it('空白与纯空格都不能发，有内容才可以', () => {
    expect(canSubmitDraft('', ready)).toBe(false);
    expect(canSubmitDraft('   ', ready)).toBe(false);
    expect(canSubmitDraft('你好', ready)).toBe(true);
    expect(canSubmitDraft('  你好  ', ready)).toBe(true);
  });

  it('宿主说不能发、或上一次还在途时一律不发', () => {
    expect(canSubmitDraft('你好', { canSend: false, sending: false })).toBe(false);
    expect(canSubmitDraft('你好', { canSend: true, sending: true })).toBe(false);
  });
});

describe('草稿只在宿主接受之后才清空', () => {
  it('接受就清空，失败原样保留好让用户重试', () => {
    expect(draftAfterSubmit('你好', true)).toBe('');
    expect(draftAfterSubmit('你好', false)).toBe('你好');
    expect(draftAfterSubmit('  你好  ', false)).toBe('  你好  ');
  });
});

describe('回车只在不是输入法选词时才算发送', () => {
  it('普通回车发送；组词中的回车不发送', () => {
    expect(isSubmitEnter({ key: 'Enter' })).toBe(true);
    expect(isSubmitEnter({ key: 'Enter', isComposing: false })).toBe(true);
    expect(isSubmitEnter({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isSubmitEnter({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSubmitEnter({ key: 'Enter', shiftKey: true, isComposing: true })).toBe(false);
    // 组词阶段浏览器给的 keyCode 是 229，有些输入法只给这个。
    expect(isSubmitEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(isSubmitEnter({ key: 'a' })).toBe(false);
  });
});

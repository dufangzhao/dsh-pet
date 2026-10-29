/**
 * 预览台共用的那几条互动规则：挪位置的边界、录音按钮上那句话的优先级。
 *
 * 旧预览与 original-ui 的原创预览读的是同一份，所以这里测一次就够——
 * 换板面不该带出第二套判定（戳/拖的分界与焦点那条在 pet-preview.test.ts）。
 */
import { describe, expect, it } from 'vitest';

import {
  DRAG_LIFT_PX,
  clampDragOffset,
  micButtonHint,
  micButtonLabel,
  type PetPreviewMic,
} from './preview-behavior.js';

const mic = (over: Partial<PetPreviewMic> = {}): PetPreviewMic => ({
  canRecord: true,
  recording: false,
  secondsLeft: null,
  unavailable: null,
  secondsLimit: null,
  start: () => {},
  end: () => {},
  cancel: () => {},
  ...over,
});

describe('在这格场景里挪位置', () => {
  it('横向按格子宽度夹住，纵向只许抬起来、不许沉到台沿下面', () => {
    const moved = clampDragOffset(500, -200, 400);
    expect(moved.x).toBe(110); // 400/2 - 90
    expect(moved.y).toBe(-DRAG_LIFT_PX);
    expect(clampDragOffset(-500, -20, 400).x).toBe(-110);
  });

  it('格子比角色身位还窄时不给出负的边界，往下按也不沉', () => {
    expect(clampDragOffset(20, 30, 120)).toEqual({ x: 0, y: 0 });
    expect(clampDragOffset(10, 8, 400).y).toBe(0);
  });
});

describe('录音那颗按钮上的话', () => {
  it('在录就报剩多久；宿主没报秒数就不编一个数', () => {
    expect(micButtonLabel(mic({ recording: true, secondsLeft: 17 }))).toBe('剩 17 秒');
    expect(micButtonLabel(mic({ recording: true }))).toBe('正在录音');
    expect(micButtonLabel(mic())).toBe('录音');
  });

  it('提示的优先级：先说为什么不能按，再说正在发生什么，最后才说上限', () => {
    expect(micButtonHint(mic({ canRecord: false, unavailable: '还没连上麦克风' }))).toBe(
      '还没连上麦克风',
    );
    expect(micButtonHint(mic({ unavailable: '还没连上麦克风', recording: true }))).toBe(
      '还没连上麦克风',
    );
    expect(micButtonHint(mic({ recording: true }))).toContain('点此结束');
    expect(micButtonHint(mic({ secondsLimit: 60 }))).toBe('用语音对它说一句，最长 60 秒');
    expect(micButtonHint(mic())).toBe('用语音对它说一句');
  });
});

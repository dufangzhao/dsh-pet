import { describe, expect, it } from 'vitest';

import { pointerWasDrag, shouldCloseChat } from './pet-preview.js';

/**
 * 输入框收不收，只看焦点还在不在这一块里，以及宿主那句还在不在途。
 *
 * 首轮 native 实测：焦点从输入框移到发送按钮时，blur 里读 document.activeElement
 * 只短暂拿到 body，输入框在点击到达之前就被拆掉，宿主完全没收到这句话。
 * 这里锁的就是这两条不许再退回去。
 */
describe('预览里的说话入口什么时候收起', () => {
  it('焦点还在场景内（点的是同一个框里的发送按钮）：不收', () => {
    expect(shouldCloseChat(true, false)).toBe(false);
  });

  /**
   * 戳与拖动共用同一次按下：判定只看位移。
   * 分不开就会在挪位置的那一下多记一条戳，或者反过来把戳当拖动吞掉。
   */
  describe('戳一下与挪位置的界限', () => {
    it('阈值以内还是戳', () => {
      expect(pointerWasDrag(0)).toBe(false);
      expect(pointerWasDrag(6)).toBe(false);
    });

    it('超过阈值算挪位置，只记拖动', () => {
      expect(pointerWasDrag(7)).toBe(true);
    });
  });

  it('焦点确实走开了：收', () => {
    expect(shouldCloseChat(false, false)).toBe(true);
  });

  it('在途时焦点离开也不收：拆掉就把刚发出去的那句变成没有回执的等待', () => {
    expect(shouldCloseChat(false, true)).toBe(false);
  });

  it('焦点在且仍在途：不收', () => {
    expect(shouldCloseChat(true, true)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import type { ApplicationHistoryPage, ApplicationInteraction } from '@pet/contracts';

import { EMPTY_EARLIER, cursorWentBack, mergeHistory, withEarlierPage } from './history-page.js';

function event(cursor: number, text = '事件 ' + cursor): ApplicationInteraction {
  return { id: 'event-' + cursor, cursor, at: cursor * 1000, kind: 'application', text };
}

function page(
  items: ApplicationInteraction[],
  before: number | null,
  more: boolean,
): ApplicationHistoryPage {
  return { items, cursor: items.at(-1)?.cursor ?? 0, before, more };
}

describe('时间线合并：快照那一段 + 更早几页', () => {
  it('按 cursor 升序，重叠的事件只留一份（以宿主快照那份为准）', () => {
    const latest = [event(5, '快照里的 5'), event(6)];
    const older = [event(3), event(4), event(5, '更早那一页的 5')];
    const merged = mergeHistory(older, latest);
    expect(merged.map((item) => item.cursor)).toEqual([3, 4, 5, 6]);
    expect(merged.find((item) => item.cursor === 5)?.text).toBe('快照里的 5');
  });

  it('没有更早的页时就是快照本身，也按 cursor 排好', () => {
    expect(mergeHistory([], [event(2), event(1)]).map((item) => item.cursor)).toEqual([1, 2]);
    expect(mergeHistory([], [])).toEqual([]);
  });
});

describe('收下一页更早的记录', () => {
  it('补在前面，并只采用宿主给的 before / more', () => {
    const first = withEarlierPage(EMPTY_EARLIER, page([event(7), event(8)], 7, true));
    expect(first.items.map((item) => item.cursor)).toEqual([7, 8]);
    expect(first.before).toBe(7);
    expect(first.more).toBe(true);

    const second = withEarlierPage(first, page([event(5), event(6)], 5, false));
    expect(second.items.map((item) => item.cursor)).toEqual([5, 6, 7, 8]);
    expect(second.before).toBe(5);
    expect(second.more).toBe(false);
  });

  it('同一页重复回来时不会贴两遍', () => {
    const first = withEarlierPage(EMPTY_EARLIER, page([event(7), event(8)], 7, true));
    const again = withEarlierPage(first, page([event(7), event(8)], 7, true));
    expect(again.items.map((item) => item.cursor)).toEqual([7, 8]);
  });
});

describe('清空记录后更早的投影必须作废', () => {
  it('cursor 回退才算清空；前进或不变都不是', () => {
    expect(cursorWentBack(9, 0)).toBe(true);
    expect(cursorWentBack(4, 3)).toBe(true);
    expect(cursorWentBack(9, 9)).toBe(false);
    expect(cursorWentBack(9, 10)).toBe(false);
    // 还没读到过快照：没有可比的前值，不能当成清空。
    expect(cursorWentBack(null, 0)).toBe(false);
  });
});

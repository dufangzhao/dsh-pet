import { describe, expect, it } from 'vitest';

import {
  clampIntoDisplay,
  dragPosition,
  ensureVisible,
  fitInsideWorkArea,
  FULL_VISIBLE_MARGIN_DIP,
  initialBounds,
  intersectionSize,
  isFullyInside,
  isVisibleEnough,
  MIN_VISIBLE_EDGE_DIP,
  restoreVisible,
  roundRect,
  selectDisplay,
  type DisplayLike,
} from './pet-geometry.js';

const main: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

/** 主屏左侧的副屏：负坐标、150% 缩放，Windows 上很常见。 */
const leftHiDpi: DisplayLike = {
  id: 2,
  bounds: { x: -2560, y: -200, width: 2560, height: 1440 },
  workArea: { x: -2560, y: -200, width: 2560, height: 1400 },
  scaleFactor: 1.5,
};

/** 主屏右侧的副屏：125% 缩放。 */
const right: DisplayLike = {
  id: 3,
  bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
  workArea: { x: 1920, y: 0, width: 1280, height: 984 },
  scaleFactor: 1.25,
};

const displays = [main, leftHiDpi, right];

describe('dragPosition', () => {
  it('按光标 DIP 差值平移，不因缩放比例二次换算', () => {
    const start = { x: 100, y: 200, width: 360, height: 420 };
    const cursor = { x: 500, y: 600 };
    expect(dragPosition(start, cursor, { x: 560, y: 640 })).toEqual({ x: 160, y: 240 });
  });

  it('支持负坐标屏幕上的拖拽', () => {
    const start = { x: -2400, y: -100, width: 360, height: 420 };
    const cursor = { x: -2400, y: -100 };
    expect(dragPosition(start, cursor, { x: -2600, y: 40 })).toEqual({ x: -2600, y: 40 });
  });

  it('返回整数 DIP，避免亚像素累积漂移', () => {
    const start = { x: 0, y: 0, width: 360, height: 420 };
    expect(dragPosition(start, { x: 0, y: 0 }, { x: 10.6, y: -4.4 })).toEqual({ x: 11, y: -4 });
  });
});

describe('isVisibleEnough / ensureVisible', () => {
  it('完全在屏幕内时不移动窗口', () => {
    const bounds = { x: 200, y: 200, width: 360, height: 420 };
    expect(ensureVisible(bounds, displays)).toEqual(bounds);
  });

  it('只剩一条边可抓时也不强行吸附，避免拖拽中窗口跳动', () => {
    const bounds = { x: 1870, y: 900, width: 360, height: 420 };
    expect(isVisibleEnough(bounds, displays)).toBe(true);
    expect(ensureVisible(bounds, displays)).toEqual(bounds);
  });

  it('屏幕被移除、窗口完全在屏幕外时拉回最近屏幕的可见区域', () => {
    // 窗口中心离右侧副屏最近，因此应被夹进右侧副屏而不是主屏。
    const bounds = { x: 5000, y: 300, width: 360, height: 420 };
    expect(isVisibleEnough(bounds, displays)).toBe(false);
    const recovered = ensureVisible(bounds, displays);
    const area = right.workArea;
    expect(recovered.x).toBe(area.x + area.width - MIN_VISIBLE_EDGE_DIP);
    expect(recovered.x + recovered.width).toBeGreaterThan(area.x);
    expect(isVisibleEnough(recovered, displays)).toBe(true);
  });

  it('负坐标屏幕被移除后也能回到主屏可见区域', () => {
    const bounds = { x: -3000, y: 100, width: 360, height: 420 };
    const recovered = ensureVisible(bounds, [main, right]);
    expect(isVisibleEnough(recovered, [main, right])).toBe(true);
    expect(recovered.x).toBeGreaterThanOrEqual(main.workArea.x - 360);
  });

  it('夹取时至少留下最小可抓取边', () => {
    const bounds = { x: -10000, y: -10000, width: 360, height: 420 };
    const clamped = clampIntoDisplay(bounds, main);
    expect(clamped.x).toBe(main.workArea.x - 360 + MIN_VISIBLE_EDGE_DIP);
    expect(clamped.y).toBe(main.workArea.y - 420 + MIN_VISIBLE_EDGE_DIP);
  });

  it('没有屏幕信息时原样返回，不抛异常', () => {
    const bounds = { x: 10, y: 10, width: 360, height: 420 };
    expect(ensureVisible(bounds, [])).toEqual(bounds);
  });
});

describe('restoreVisible（拖拽结束/显示器变化后的完整可见）', () => {
  it('只剩 48DIP 透明边时，ensureVisible 不动但 restoreVisible 把窗口完整夹回', () => {
    // 窗口右下角超出主屏，屏幕上只剩一条可抓的边——旧逻辑认为“够可见”就不动。
    const bounds = { x: 1870, y: 900, width: 360, height: 420 };
    expect(ensureVisible(bounds, displays)).toEqual(bounds);

    const target = selectDisplay(bounds, displays);
    expect(target).not.toBeNull();
    const restored = restoreVisible(bounds, displays);
    expect(restored).not.toEqual(bounds);
    // 完整落在（交集更大的）目标屏工作区内，角色与退出按钮都不会被裁掉。
    const area = (target as DisplayLike).workArea;
    expect(restored.x).toBeGreaterThanOrEqual(area.x);
    expect(restored.y).toBeGreaterThanOrEqual(area.y);
    expect(restored.x + restored.width).toBeLessThanOrEqual(area.x + area.width);
    expect(restored.y + restored.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it('完整夹入时留出可读的边距，而不是紧贴任务栏', () => {
    const bounds = { x: 5000, y: 5000, width: 360, height: 420 };
    const target = selectDisplay(bounds, displays);
    expect(target?.id).toBe(right.id);
    const restored = restoreVisible(bounds, displays);
    const area = right.workArea;
    expect(restored.x).toBe(area.x + area.width - 360 - FULL_VISIBLE_MARGIN_DIP);
    expect(restored.y).toBe(area.y + area.height - 420 - FULL_VISIBLE_MARGIN_DIP);
  });

  it('已经完整可见时不做任何位移，避免无意义的抖动', () => {
    const bounds = { x: 200, y: 200, width: 360, height: 420 };
    expect(restoreVisible(bounds, displays)).toEqual(bounds);
  });

  it('小屏放不下整个窗口时尽量多留可见像素，而不是只留 48DIP 透明边', () => {
    const tiny: DisplayLike = {
      id: 9,
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      workArea: { x: 0, y: 0, width: 320, height: 200 },
      scaleFactor: 1,
    };
    // 工作区比窗口还小，完整夹入不可能。
    expect(fitInsideWorkArea({ x: -900, y: -900, width: 360, height: 420 }, tiny)).toBeNull();
    const restored = restoreVisible({ x: -900, y: -900, width: 360, height: 420 }, [tiny]);
    // 窗口盖满整个工作区：可见面积最大化，而不是只留 48DIP 透明边。
    const visible = intersectionSize(restored, tiny.workArea);
    expect(visible.width).toBe(tiny.workArea.width);
    expect(visible.height).toBe(tiny.workArea.height);
    // 越界的那一侧不会离屏幕更远：窗口必然与工作区相交。
    expect(restored.x).toBeLessThanOrEqual(tiny.workArea.x);
    expect(restored.x + restored.width).toBeGreaterThanOrEqual(
      tiny.workArea.x + tiny.workArea.width,
    );
    // 仍然满足“能抓住”的最低要求，且比只留 48DIP 时可见得多。
    expect(isVisibleEnough(restored, [tiny])).toBe(true);
    expect(visible.width).toBeGreaterThan(MIN_VISIBLE_EDGE_DIP);
  });

  it('小屏兜底从另一侧越界时同样盖满工作区，而不是留在屏幕外', () => {
    const tiny: DisplayLike = {
      id: 9,
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      workArea: { x: 0, y: 0, width: 320, height: 200 },
      scaleFactor: 1,
    };
    const restored = restoreVisible({ x: 900, y: 900, width: 360, height: 420 }, [tiny]);
    const visible = intersectionSize(restored, tiny.workArea);
    expect(visible.width).toBe(tiny.workArea.width);
    expect(visible.height).toBe(tiny.workArea.height);
  });

  it('负坐标副屏上同样按工作区完整夹入', () => {
    const bounds = { x: -6000, y: -3000, width: 360, height: 420 };
    const restored = restoreVisible(bounds, displays);
    const area = leftHiDpi.workArea;
    expect(restored.x).toBe(area.x + FULL_VISIBLE_MARGIN_DIP);
    expect(restored.y).toBe(area.y + FULL_VISIBLE_MARGIN_DIP);
    expect(selectDisplay(restored, displays)?.id).toBe(leftHiDpi.id);
  });

  it('没有显示器信息时原样返回，不抛异常', () => {
    const bounds = { x: 10, y: 10, width: 360, height: 420 };
    expect(restoreVisible(bounds, [])).toEqual(bounds);
  });
});

describe('isFullyInside', () => {
  it('完全落在工作区内为真，越界一点也为假', () => {
    const area = main.workArea;
    expect(isFullyInside({ x: 100, y: 100, width: 360, height: 420 }, area)).toBe(true);
    expect(isFullyInside({ x: -1, y: 100, width: 360, height: 420 }, area)).toBe(false);
    expect(
      isFullyInside({ x: area.x + area.width - 359, y: 100, width: 360, height: 420 }, area),
    ).toBe(false);
  });
});

describe('fitInsideWorkArea', () => {
  it('放得下时返回夹取结果，放不下时返回 null 交给兜底', () => {
    const fits = fitInsideWorkArea({ x: 5000, y: 5000, width: 360, height: 420 }, main);
    expect(fits).not.toBeNull();
    expect(fits?.width).toBe(360);

    const wide = fitInsideWorkArea({ x: 0, y: 0, width: 5000, height: 420 }, main);
    expect(wide).toBeNull();
  });

  it('margin 为 0 时允许贴边但不越界', () => {
    const fitted = fitInsideWorkArea({ x: 9999, y: 9999, width: 360, height: 420 }, main, 0);
    expect(fitted).toEqual({
      x: main.workArea.x + main.workArea.width - 360,
      y: main.workArea.y + main.workArea.height - 420,
      width: 360,
      height: 420,
    });
  });
});

describe('selectDisplay', () => {
  it('按交集面积选择跨屏窗口所在的主屏', () => {
    // 1700..2060 与主屏交集 220，与右屏交集 140，主屏胜出。
    const bounds = { x: 1700, y: 100, width: 360, height: 420 };
    expect(selectDisplay(bounds, displays)?.id).toBe(main.id);
  });

  it('跨屏窗口以交集更大的那一侧为准', () => {
    const bounds = { x: 1800, y: 100, width: 360, height: 420 };
    expect(selectDisplay(bounds, displays)?.id).toBe(right.id);
  });

  it('负坐标屏幕上按交集选择', () => {
    const bounds = { x: -2400, y: -100, width: 360, height: 420 };
    expect(selectDisplay(bounds, displays)?.id).toBe(leftHiDpi.id);
  });

  it('没有交集时退化为中心距离最近', () => {
    const bounds = { x: 6000, y: 3000, width: 360, height: 420 };
    expect(selectDisplay(bounds, displays)?.id).toBe(right.id);
  });

  it('没有屏幕时返回 null', () => {
    expect(selectDisplay({ x: 0, y: 0, width: 10, height: 10 }, [])).toBeNull();
  });
});

describe('initialBounds', () => {
  it('放在主屏可用区域右下角并避开任务栏', () => {
    const bounds = initialBounds(main.workArea, { width: 360, height: 420 }, displays);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(main.workArea.x + main.workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(main.workArea.y + main.workArea.height);
    expect(bounds.y + bounds.height).toBeGreaterThan(1000);
  });

  it('可用区域小于窗口时仍保证可见', () => {
    const tiny: DisplayLike = {
      id: 9,
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      workArea: { x: 0, y: 0, width: 320, height: 200 },
      scaleFactor: 1,
    };
    const bounds = initialBounds(tiny.workArea, { width: 360, height: 420 }, [tiny]);
    expect(isVisibleEnough(bounds, [tiny])).toBe(true);
  });
});

describe('roundRect', () => {
  it('把 DIP 取整，避免 Windows 上出现半像素模糊', () => {
    expect(roundRect({ x: 1.4, y: -1.6, width: 359.5, height: 420.2 })).toEqual({
      x: 1,
      y: -2,
      width: 360,
      height: 420,
    });
  });
});

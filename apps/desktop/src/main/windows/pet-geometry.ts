/**
 * 桌宠窗口的纯几何工具（Electron DIP，不涉及设备像素）。
 *
 * 这里只做数学计算，不引用 electron，便于在 Vitest 中直接覆盖负坐标多屏、
 * 不同缩放比例与屏幕移除后的可见恢复。真实多屏行为仍须在真机上验收，
 * 纯几何测试不能替代 OS 证据。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  /** 显示器完整边界，DIP。 */
  bounds: Rect;
  /** 去掉任务栏等保留区后的可用区域，DIP。 */
  workArea: Rect;
  scaleFactor: number;
}

/** 拖拽或屏幕变化后，窗口至少要在目标屏幕上留下的一条可见边。 */
export const MIN_VISIBLE_EDGE_DIP = 48;

/** 窗口能完整放进目标工作区时的留边，避免紧贴任务栏或屏幕边缘。 */
export const FULL_VISIBLE_MARGIN_DIP = 8;

function clamp(value: number, a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return Math.min(Math.max(value, low), high);
}

export function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function intersectionSize(a: Rect, b: Rect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

export function intersectionArea(a: Rect, b: Rect): number {
  const size = intersectionSize(a, b);
  return size.width * size.height;
}

export function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * 拖拽位移只累加光标的 DIP 差值。
 *
 * 光标点由主进程 screen.getCursorScreenPoint() 提供，渲染器从不传坐标；
 * 这里不做 scaleFactor 换算，因为光标与窗口边界都已经是 DIP。
 */
export function dragPosition(startBounds: Rect, startCursor: Point, cursor: Point): Point {
  return {
    x: Math.round(startBounds.x + (cursor.x - startCursor.x)),
    y: Math.round(startBounds.y + (cursor.y - startCursor.y)),
  };
}

/** 只要与任一屏幕的交集宽高都达到 minVisibleEdge，就认为用户还能抓住窗口。 */
export function isVisibleEnough(
  bounds: Rect,
  displays: readonly DisplayLike[],
  minVisibleEdge: number = MIN_VISIBLE_EDGE_DIP,
): boolean {
  return displays.some((display) => {
    const size = intersectionSize(bounds, display.bounds);
    return size.width >= minVisibleEdge && size.height >= minVisibleEdge;
  });
}

/** 交集最大的屏幕；都不相交时取中心最近的屏幕；没有屏幕时返回 null。 */
export function selectDisplay(bounds: Rect, displays: readonly DisplayLike[]): DisplayLike | null {
  let best: DisplayLike | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const area = intersectionArea(bounds, display.bounds);
    if (area > bestArea) {
      bestArea = area;
      best = display;
    }
  }
  if (best !== null) return best;

  const center = rectCenter(bounds);
  let nearest: DisplayLike | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const distance = distanceSquared(center, rectCenter(display.bounds));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = display;
    }
  }
  return nearest;
}

/** 把窗口夹进一块屏幕的可用区域，同时保证仍留下 minVisibleEdge 的可抓取边。 */
export function clampIntoDisplay(
  bounds: Rect,
  display: DisplayLike,
  minVisibleEdge: number = MIN_VISIBLE_EDGE_DIP,
): Rect {
  const area = display.workArea;
  const x = clamp(
    bounds.x,
    area.x - bounds.width + minVisibleEdge,
    area.x + area.width - minVisibleEdge,
  );
  const y = clamp(
    bounds.y,
    area.y - bounds.height + minVisibleEdge,
    area.y + area.height - minVisibleEdge,
  );
  return roundRect({ ...bounds, x, y });
}

/**
 * 可见恢复（拖拽中/屏幕变化时用）：仍能抓住就不动，避免窗口被“吸”回屏幕；
 * 完全不可见（例如所在屏幕被移除）时，才夹进最近或交集最大的屏幕。
 *
 * 只保证“留一条可抓的边”，因此拖拽过程中不会产生吸附感；
 * 拖拽结束后的完整可见由 restoreVisible 负责。
 */
export function ensureVisible(
  bounds: Rect,
  displays: readonly DisplayLike[],
  minVisibleEdge: number = MIN_VISIBLE_EDGE_DIP,
): Rect {
  const rounded = roundRect(bounds);
  if (displays.length === 0) return rounded;
  if (isVisibleEnough(rounded, displays, minVisibleEdge)) return rounded;

  const display = selectDisplay(rounded, displays);
  if (display === null) return rounded;
  return clampIntoDisplay(rounded, display, minVisibleEdge);
}

/** 目标工作区能完整容纳窗口（留 margin 边距）时，返回完整夹入后的矩形。 */
export function fitInsideWorkArea(
  bounds: Rect,
  display: DisplayLike,
  margin: number = FULL_VISIBLE_MARGIN_DIP,
): Rect | null {
  const area = display.workArea;
  // 小屏或超大窗口放不下时不做“完整夹入”，交给 ensureVisible 的兜底逻辑。
  if (bounds.width + margin * 2 > area.width) return null;
  if (bounds.height + margin * 2 > area.height) return null;
  const x = clamp(bounds.x, area.x + margin, area.x + area.width - bounds.width - margin);
  const y = clamp(bounds.y, area.y + margin, area.y + area.height - bounds.height - margin);
  return roundRect({ ...bounds, x, y });
}

/** 窗口是否已经完全落在这块工作区内（不要求留边距）。 */
export function isFullyInside(bounds: Rect, area: Rect): boolean {
  return (
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + bounds.width <= area.x + area.width &&
    bounds.y + bounds.height <= area.y + area.height
  );
}

/**
 * 拖拽结束或显示器/DPI 变化后的可见恢复。
 *
 * 与 ensureVisible 的区别：这里不再只满足于“留一条 48DIP 的透明边”，
 * 只要目标屏工作区放得下，就把整个窗口（角色、气泡、退出按钮）夹回可见范围；
 * 屏幕本身比窗口还小时，让窗口盖满工作区以最大化可见面积。
 *
 * 已经完全可见的窗口原样返回，所以显示器事件不会造成无意义抖动。
 * 拖拽过程中的跟手移动不能调用它，否则会产生吸附。
 */
export function restoreVisible(
  bounds: Rect,
  displays: readonly DisplayLike[],
  margin: number = FULL_VISIBLE_MARGIN_DIP,
): Rect {
  const rounded = roundRect(bounds);
  if (displays.length === 0) return rounded;

  const display = selectDisplay(rounded, displays);
  if (display === null) return rounded;

  // 已经完全可见就不动：显示器事件不该让窗口轻微抖动一下。
  if (isFullyInside(rounded, display.workArea)) return rounded;

  const fitted = fitInsideWorkArea(rounded, display, margin);
  if (fitted !== null) return fitted;

  // 小屏放不下整个窗口：让窗口尽量盖满工作区（可见面积最大化），
  // 而不是只留一条 48DIP 的透明边。
  const area = display.workArea;
  return roundRect({
    ...rounded,
    x: clamp(rounded.x, area.x + area.width - rounded.width, area.x),
    y: clamp(rounded.y, area.y + area.height - rounded.height, area.y),
  });
}

/** 首次显示放在主屏可用区域右下角，并保证不会被任务栏或负坐标屏幕裁掉。 */
export function initialBounds(
  workArea: Rect,
  size: { width: number; height: number },
  displays: readonly DisplayLike[],
  margin = 24,
): Rect {
  return ensureVisible(
    {
      x: workArea.x + workArea.width - size.width - margin,
      y: workArea.y + workArea.height - size.height - margin,
      width: size.width,
      height: size.height,
    },
    displays,
  );
}

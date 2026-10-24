/**
 * 命中区判定：窗口默认鼠标穿透，只有指针落在角色实际绘制的形状或真实按钮上时才请求交互。
 *
 * 纯函数，方便单元测试；坐标一律是窗口内的 CSS 像素（不涉及屏幕坐标）。
 *
 * 为什么不用一个矩形包住角色：角色是椭圆身体 + 两只尖耳朵的 SVG，
 * 外接矩形（更别说再套一层含气泡的容器）里有大量完全透明的角，
 * 用矩形做命中会让这些空白也吃掉鼠标，违背“透明处穿透”的约定。
 * 因此这里按 viewBox 里真实画出来的图形做命中：椭圆 + 三角形多边形。
 */
export interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointLike {
  x: number;
  y: number;
}

export interface HitEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface HitPolygon {
  points: readonly PointLike[];
}

export type HitShape =
  | ({ kind: 'rect' } & HitRect)
  | ({ kind: 'ellipse' } & HitEllipse)
  | ({ kind: 'polygon' } & HitPolygon);

/** 给命中区留一点余量，避免 1px 抖动导致穿透状态来回切换。 */
export const HIT_PADDING_PX = 4;

/** 角色 SVG 的绘制坐标系，必须与 PetAvatar.tsx 的 viewBox 保持一致。 */
export const PET_AVATAR_VIEWBOX = { width: 160, height: 160 } as const;

/** 躯干椭圆（略大于描边本体，保证视觉上按到哪就是哪）。 */
export const PET_AVATAR_BODY: HitEllipse = { cx: 80, cy: 80, rx: 53, ry: 49 };

/** 两只耳朵的三角形，与 PetAvatar 的 path 顶点一致。 */
export const PET_AVATAR_EARS: readonly HitPolygon[] = [
  {
    points: [
      { x: 44, y: 44 },
      { x: 36, y: 16 },
      { x: 66, y: 34 },
    ],
  },
  {
    points: [
      { x: 116, y: 44 },
      { x: 124, y: 16 },
      { x: 94, y: 34 },
    ],
  },
];

export function toHitRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HitRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

export function expandHitRect(rect: HitRect, padding: number = HIT_PADDING_PX): HitRect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  };
}

export function isPointInHitRect(point: PointLike, rect: HitRect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

export function isPointInHitEllipse(point: PointLike, ellipse: HitEllipse, padding = 0): boolean {
  const rx = ellipse.rx + padding;
  const ry = ellipse.ry + padding;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (point.x - ellipse.cx) / rx;
  const dy = (point.y - ellipse.cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** 射线法：判断点是否落在多边形内（三角形耳朵用）。 */
export function isPointInHitPolygon(point: PointLike, polygon: HitPolygon): boolean {
  const points = polygon.points;
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i] as PointLike;
    const b = points[j] as PointLike;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

export function isPointInHitShape(
  point: PointLike,
  shape: HitShape,
  padding: number = HIT_PADDING_PX,
): boolean {
  switch (shape.kind) {
    case 'rect':
      return isPointInHitRect(point, expandHitRect(shape, padding));
    case 'ellipse':
      return isPointInHitEllipse(point, shape, padding);
    case 'polygon':
      // 多边形不做外扩：外扩需要真正的偏移算法，尖角处反而会漏判。
      return isPointInHitPolygon(point, shape);
  }
}

export function isPointInHitShapes(
  point: PointLike,
  shapes: readonly HitShape[],
  padding: number = HIT_PADDING_PX,
): boolean {
  return shapes.some((shape) => isPointInHitShape(point, shape, padding));
}

/** 矩形命中区集合（面板按钮等真实矩形）的便捷入口，保持旧签名。 */
export function isPointInteractive(
  point: PointLike,
  rects: readonly HitRect[],
  padding: number = HIT_PADDING_PX,
): boolean {
  return rects.some((rect) => isPointInHitRect(point, expandHitRect(rect, padding)));
}

export interface ViewBoxMapping {
  left: number;
  top: number;
  scale: number;
}

/**
 * 把 SVG 的 viewBox 映射到元素在视口里的矩形。
 * 与浏览器默认的 preserveAspectRatio="xMidYMid meet" 一致：等比缩放后居中。
 */
export function mapViewBox(
  rect: { left: number; top: number; width: number; height: number },
  viewBox: { width: number; height: number } = PET_AVATAR_VIEWBOX,
): ViewBoxMapping {
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
    return { left: rect.left, top: rect.top, scale: 0 };
  }
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  return {
    left: rect.left + (rect.width - viewBox.width * scale) / 2,
    top: rect.top + (rect.height - viewBox.height * scale) / 2,
    scale,
  };
}

function mapPoint(point: PointLike, mapping: ViewBoxMapping): PointLike {
  return {
    x: mapping.left + point.x * mapping.scale,
    y: mapping.top + point.y * mapping.scale,
  };
}

/**
 * 角色在视口里的真实命中形状：只有躯干椭圆与两只耳朵。
 * 气泡、透明角落、装饰性圆点都不参与，指针落在那里应保持穿透。
 */
export function avatarHitShapes(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HitShape[] {
  const mapping = mapViewBox(rect);
  if (mapping.scale <= 0) return [];
  const center = mapPoint({ x: PET_AVATAR_BODY.cx, y: PET_AVATAR_BODY.cy }, mapping);
  const shapes: HitShape[] = [
    {
      kind: 'ellipse',
      cx: center.x,
      cy: center.y,
      rx: PET_AVATAR_BODY.rx * mapping.scale,
      ry: PET_AVATAR_BODY.ry * mapping.scale,
    },
  ];
  for (const ear of PET_AVATAR_EARS) {
    shapes.push({
      kind: 'polygon',
      points: ear.points.map((point) => mapPoint(point, mapping)),
    });
  }
  return shapes;
}

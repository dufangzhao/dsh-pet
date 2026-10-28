/**
 * 物理互动的判定：只按真实证据决定要不要向宿主记一条事件。
 *
 * 三条硬约束：
 * - 窗口是否真的移动，只看主进程给出的权威 bounds，渲染器不自己算屏幕坐标；
 * - 证据不足（还没读到 bounds）就什么都不记，宁可不记也不编造时间线；
 * - blush/happy 是宿主真正应用表情之后的回执，不属于这里的物理动作，渲染器不自造。
 */
import type { PetBounds } from '@pet/contracts';

/** 桌宠能真实做出来的动作，取自 ApplicationBridge.interact 的 kind 子集。 */
export type PetGesture = 'poke' | 'pat' | 'drag';

/**
 * 按住多久算“摸头”而不是“戳一下”。
 *
 * 可用的物理证据只有三种：按下时长、是否发起了拖拽、窗口有没有真的移动。
 * 光标轨迹由主进程读取，渲染器拿不到，所以长按是这里唯一能把“抚摸”和“轻戳”
 * 分开的信号；短于这个时长按住仍然是戳。
 */
export const PAT_HOLD_MS = 420;

export interface GestureEvidence {
  /** 按下时是否真的向主进程发起了拖拽（draggable=false 或发起失败时为 false）。 */
  readonly startedDrag: boolean;
  /** 按下瞬间的窗口边界；null 表示还没有权威快照。 */
  readonly before: PetBounds | null;
  /** 松手后主进程回执里的窗口边界；null 表示回执还没到。 */
  readonly after: PetBounds | null;
  /** 按下到松手的时长（毫秒）。 */
  readonly heldMs: number;
}

/** 返回要记录的动作；null 表示证据不足，这次不记录。 */
export function classifyGesture(evidence: GestureEvidence): PetGesture | null {
  // 没发起拖拽：只可能是在原地按住，时长是唯一区分依据。
  if (!evidence.startedDrag) return evidence.heldMs >= PAT_HOLD_MS ? 'pat' : 'poke';
  const before = evidence.before;
  const after = evidence.after;
  if (before === null || after === null) return null;
  if (before.x !== after.x || before.y !== after.y) return 'drag';
  // 发起了拖拽但窗口一格没动：这仍是一次原地按压。
  return evidence.heldMs >= PAT_HOLD_MS ? 'pat' : 'poke';
}

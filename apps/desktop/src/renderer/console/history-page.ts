import type { ApplicationHistoryPage, ApplicationInteraction } from '@pet/contracts';

/**
 * 更早那几页在界面上的临时投影。
 *
 * 宿主快照只带最近一段记录；更早的部分要靠 bridge.getHistory 分页取回。
 * 但界面不该因此多出第二个聊天状态：这里只记「补在最前面的那几页」和
 * 「下一次从哪个 cursor 之前继续读」，宿主下一次推快照时仍以它为准。
 */
export interface EarlierHistory {
  readonly items: readonly ApplicationInteraction[];
  /** 下一次请求的 before；undefined 表示还没读过更早的页。 */
  readonly before: number | null | undefined;
  readonly more: boolean;
}

export const EMPTY_EARLIER: EarlierHistory = { items: [], before: undefined, more: false };

/**
 * 宿主把 cursor 退回去了，说明记录被清空（或换了一条时间线）。
 * 这时更早补回来的那几页属于旧的那条，必须整块作废；null 代表还没读到过快照。
 */
export function cursorWentBack(previous: number | null, next: number): boolean {
  return previous !== null && next < previous;
}

/**
 * 时间线：宿主给的那一段 + 更早补回来的几页，按 cursor 去重后升序。
 *
 * 重叠是正常的：读更早一页期间宿主又推来快照，同一事件会同时出现在两边。
 * 同一 cursor 以宿主快照那份为准，因为它的字段更完整。
 */
export function mergeHistory(
  older: readonly ApplicationInteraction[],
  latest: readonly ApplicationInteraction[],
): ApplicationInteraction[] {
  const held = new Set(latest.map((item) => item.cursor));
  const merged = [...latest, ...older.filter((item) => !held.has(item.cursor))];
  return merged.sort((left, right) => left.cursor - right.cursor);
}

/**
 * 收下一页更早的记录。
 *
 * before / more 只认宿主给的值，不在本地推算：下一页从哪儿继续、
 * 还有没有更早的记录，都是宿主才知道的事。
 */
export function withEarlierPage(
  current: EarlierHistory,
  page: ApplicationHistoryPage,
): EarlierHistory {
  const held = new Set(current.items.map((item) => item.cursor));
  const added = page.items.filter((item) => !held.has(item.cursor));
  return { items: [...added, ...current.items], before: page.before, more: page.more };
}

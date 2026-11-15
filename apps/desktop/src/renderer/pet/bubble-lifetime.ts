/**
 * 气泡留多久：字越多留得越久，但夹在 4.5 秒到 20 秒之间。
 *
 * speed 是「消失速度」百分比：100 是正常，越大越快走。
 */
export function bubbleLifetime(text: string, speed: number): number {
  return Math.round(
    (Math.min(20000, Math.max(4500, 2500 + Array.from(text).length * 100)) * 100) / speed,
  );
}

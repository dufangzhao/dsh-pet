/**
 * 四套配色就是「配色」这项设置本身，取值与桌宠窗口 pet.css 逐格一致。
 *
 * 装扮页的小色块与开始页的预览都读这一张表，不在别处再写一遍。
 */
import type { ApplicationPreferences } from '@pet/contracts';

export const PET_PALETTES: Readonly<
  Record<
    ApplicationPreferences['palette'],
    { top: string; bottom: string; face: string; halo: string }
  >
> = {
  morning: { top: '#eef4ff', bottom: '#b9cdf2', face: '#f9fcff', halo: '#7fa8ff' },
  lavender: { top: '#f3efff', bottom: '#c8baf0', face: '#faf7ff', halo: '#a48fe6' },
  pine: { top: '#e2f1e9', bottom: '#9cc3b0', face: '#f4fbf7', halo: '#5f9d81' },
  orange: { top: '#fff1e2', bottom: '#f4c49a', face: '#fff8f1', halo: '#e8944f' },
};

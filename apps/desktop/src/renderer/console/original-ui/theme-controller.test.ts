/**
 * 配色工作室控制器的真行为：草稿与试色不落记录、认不出的十六进制不进草稿、
 * 删除要两次点击且四秒自己收回、别处写记录时草稿重新起稿、存不进本机就报没存住。
 *
 * 这里只测行为，不复读 36 个常量，也不碰 DOM：板面形状由组件与原生验收负责。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SCHEME_ID,
  THEME_TOKEN_KEYS,
  committedPalette,
  currentScheme,
  defaultStoredTheme,
  readThemeState,
  writeThemeState,
  type ThemePalette,
} from '../theme.js';
import {
  DELETE_ARM_MS,
  createThemeStudioController,
  type ThemeStudioController,
  type ThemeStudioSnapshot,
} from './theme-controller.js';

/** 内存版本机存储：这一节的持久化本来就只依赖 localStorage。 */
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    },
    configurable: true,
  });
  return data;
}

function fullPalette(overrides: Partial<ThemePalette> = {}): ThemePalette {
  const base: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) base[key] = '#101010';
  return { ...base, ...overrides } as ThemePalette;
}

let storage: Map<string, string>;
let controller: ThemeStudioController;
let seen: ThemeStudioSnapshot[];

function open(): void {
  controller = createThemeStudioController();
  seen = [];
  controller.subscribe(() => seen.push(controller.getSnapshot()));
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = installStorage();
  writeThemeState(defaultStoredTheme());
  open();
});

afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe('试色与草稿的生命周期', () => {
  it('改一格只是试色：草稿变了，本机记录一个字节都没动', () => {
    const before = storage.get('pet.console.theme');
    controller.editToken('accent', '#ff0000', 'picker');
    expect(controller.getSnapshot().draft['accent']).toBe('#ff0000');
    expect(controller.getSnapshot().previewActive).toBe(true);
    expect(storage.get('pet.console.theme')).toBe(before);
    expect(readThemeState().custom).toHaveLength(0);
  });

  it('撤销预览把草稿退回记录里那份，试色不再算数', () => {
    controller.editToken('accent', '#ff0000', 'hex');
    controller.undoPreview();
    const snapshot = controller.getSnapshot();
    expect(snapshot.previewActive).toBe(false);
    expect(snapshot.draft).toEqual(committedPalette());
    expect(snapshot.hexText['accent']).toBeUndefined();
  });

  it('卸载之后不再收记录广播，但别处的试色仍由记录自己说话', () => {
    controller.dispose();
    const calls = seen.length;
    writeThemeState({ ...readThemeState(), mode: 'dark' });
    expect(seen).toHaveLength(calls);
  });
});

describe('十六进制的边界', () => {
  it('认不出的那一格只标红：草稿仍是完整合法的一份', () => {
    controller.editToken('paper', '#12', 'hex');
    const snapshot = controller.getSnapshot();
    expect(snapshot.invalidKeys.has('paper')).toBe(true);
    expect(snapshot.hexText['paper']).toBe('#12');
    expect(snapshot.draft['paper']).toBe(committedPalette()['paper']);
  });

  it('接着打对就恢复，且把值回填到选色块那一个控件', () => {
    controller.editToken('paper', '#zz', 'hex');
    controller.editToken('paper', '#0A0A0A', 'hex');
    const snapshot = controller.getSnapshot();
    expect(snapshot.invalidKeys.has('paper')).toBe(false);
    expect(snapshot.draft['paper']).toBe('#0a0a0a');
    expect(snapshot.hexText['paper']).toBe('#0A0A0A');
  });
});

describe('保存、另存与两个明暗变体', () => {
  it('内置方案按保存是另存为自定义：原有自定义一个不少，顺序照旧', () => {
    const seeded = writeThemeState({
      ...defaultStoredTheme(),
      custom: [
        {
          id: 'custom-old',
          name: '旧的',
          note: '',
          palettes: { light: fullPalette(), dark: fullPalette() },
          custom: true,
        },
      ],
    });
    expect(seeded.ok).toBe(true);
    controller.chooseScheme(DEFAULT_SCHEME_ID);
    controller.editToken('accent', '#ff0000', 'picker');
    controller.save();
    const state = readThemeState();
    expect(state.custom.map((s) => s.name)).toEqual(['旧的', '原件 自定义']);
    expect(state.selectedId).toBe(state.custom[1]!.id);
  });

  it('覆盖保存只动当前明暗变体，另一半原样留着', () => {
    controller.save(); // 内置 → 自定义
    controller.editToken('accent', '#ff0000', 'picker');
    controller.save();
    controller.chooseMode('dark');
    controller.editToken('accent', '#00ff00', 'picker');
    controller.save();
    const scheme = currentScheme(readThemeState());
    expect(scheme.palettes['light']['accent']).toBe('#ff0000');
    expect(scheme.palettes['dark']['accent']).toBe('#00ff00');
    // 黑夜那两次保存不该在浅色里留下痕迹：纸底仍是品牌浅色那份。
    expect(scheme.palettes['light']['paper']).toBe('#fff');
    expect(scheme.palettes['dark']['paper']).toBe('#17181c');
  });
});

describe('删除的二次确认', () => {
  it('第一次只是武装，第二次才删并退回默认方案', () => {
    controller.save();
    expect(controller.getSnapshot().canWrite).toBe(true);
    controller.requestDelete();
    expect(controller.getSnapshot().deleteArmed).toBe(true);
    expect(controller.getSnapshot().status.tone).toBe('danger');
    expect(readThemeState().custom).toHaveLength(1);
    controller.requestDelete();
    expect(readThemeState().custom).toHaveLength(0);
    expect(readThemeState().selectedId).toBe(DEFAULT_SCHEME_ID);
  });

  it('四秒没确认自己收回，且不写记录', () => {
    controller.save();
    const before = storage.get('pet.console.theme');
    controller.requestDelete();
    vi.advanceTimersByTime(DELETE_ARM_MS);
    const snapshot = controller.getSnapshot();
    expect(snapshot.deleteArmed).toBe(false);
    expect(snapshot.status.text).toContain('已取消删除');
    expect(storage.get('pet.console.theme')).toBe(before);
  });

  it('内置方案没有删除这一步', () => {
    controller.requestDelete();
    expect(controller.getSnapshot().deleteArmed).toBe(false);
  });
});

describe('记录是唯一的源', () => {
  it('别处换了挡位：草稿从新变体重新起，删除武装收回', () => {
    controller.editToken('accent', '#ff0000', 'picker');
    controller.requestDelete();
    writeThemeState({ ...readThemeState(), mode: 'dark' });
    const snapshot = controller.getSnapshot();
    expect(snapshot.appearance).toBe('dark');
    expect(snapshot.previewActive).toBe(false);
    expect(snapshot.deleteArmed).toBe(false);
    expect(snapshot.draft).toEqual(currentScheme(readThemeState()).palettes['dark']);
  });

  it('存不进本机时说的是没存住，不报成功', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
      },
      configurable: true,
    });
    controller.editToken('accent', '#ff0000', 'picker');
    controller.save();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status.tone).toBe('danger');
    expect(snapshot.status.text).toContain('QuotaExceeded');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SCHEME_ID,
  THEME_TOKENS,
  allSchemes,
  currentScheme,
  defaultStoredTheme,
  groupedThemeTokens,
  normalizeHex,
  migrateSchemeId,
  normalizePalette,
  paletteDeclarations,
  readStoredTheme,
  readThemeState,
  removeScheme,
  saveCurrentScheme,
  saveSchemeAs,
  schemeSwatches,
  selectScheme,
  storeTheme,
  subscribeTheme,
  writeThemeState,
  type StoredTheme,
  type ThemePalette,
} from './theme.js';

/** 一个内存版的本机存储：这一节的持久化本来就只依赖 localStorage。 */
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  return data;
}

const oneToken = (key: string, value: string): ThemePalette =>
  Object.fromEntries(
    THEME_TOKENS.map((token) => [token.key, token.key === key ? value : '#000000']),
  );

describe('十六进制', () => {
  it('三位简写展开成六位、大小写归一，多余空格去掉', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('  #ABCDEF  ')).toBe('#abcdef');
    expect(normalizeHex('#112233')).toBe('#112233');
  });

  it('认不出的输入一律给 null，编辑器据此只标红不写草稿', () => {
    for (const bad of ['', '#ab', '#gggggg', 'rgb(1,2,3)', '#1234567', 'zzz']) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe('token 词表', () => {
  it('一共 36 格，分五组，组的顺序就是词表顺序', () => {
    expect(THEME_TOKENS).toHaveLength(36);
    expect(groupedThemeTokens().map((bucket) => bucket.group)).toEqual([
      '背景层级',
      '文字与边界',
      '交互与状态',
      '控制台时间线',
      '图表系列',
    ]);
    expect(groupedThemeTokens().map((bucket) => bucket.tokens.length)).toEqual([5, 6, 6, 8, 11]);
  });

  it('补齐缺格，并且只留词表里的键：野键不该变成全站 CSS 变量', () => {
    const normalized = normalizePalette(
      { paper: '#010203', '--injected': '#f00' },
      oneToken('paper', '#000000'),
    );
    expect(Object.keys(normalized)).toEqual([...THEME_TOKENS.map((t) => t.key)]);
    expect(normalized['paper']).toBe('#010203');
    expect(normalized['danger']).toBe('#000000');
  });

  it('落到文档上的声明同时给出 ui-kit 那一层的别名', () => {
    const names = paletteDeclarations(normalizePalette({}, oneToken('paper', '#010203'))).map(
      ([n]) => n,
    );
    expect(names).toContain('--paper');
    expect(names).toContain('--pk-bg');
    expect(names).toContain('--pk-accent');
    expect(names.filter((n) => n.startsWith('--pk-')).length).toBeGreaterThan(10);
  });
});

describe('旧存储的迁移', () => {
  beforeEach(() => installStorage());

  it('裸挡位字符串仍然有效：迁成“挡位照旧 + 默认方案”', () => {
    installStorage({ 'pet.console.theme': 'dark' });
    expect(readStoredTheme()).toBe('dark');
    expect(readThemeState()).toEqual({ selectedId: DEFAULT_SCHEME_ID, mode: 'dark', custom: [] });
  });

  it('读不懂的值按未设置处理，不抛给首屏', () => {
    for (const raw of ['{', 'null', '"light"', '42']) {
      installStorage({ 'pet.console.theme': raw });
      expect(readThemeState()).toEqual(defaultStoredTheme());
    }
  });

  it('只改挡位不动方案与自定义配色', () => {
    installStorage();
    const custom = saveSchemeAs(defaultStoredTheme(), {
      name: '我的',
      palette: oneToken('accent', '#123456'),
      appearance: 'light',
    }).state;
    writeThemeState(custom);
    storeTheme('dark');
    const next = readThemeState();
    expect(next.mode).toBe('dark');
    expect(next.selectedId).toBe(custom.selectedId);
    expect(next.custom).toHaveLength(1);
  });
});

describe('旧内置身份的迁移', () => {
  beforeEach(() => installStorage());

  /** 一条像样的旧记录：选中旧内置、挡位是黑夜、还有一份写满 36 格的自定义方案。 */
  function legacyRecord(selectedId: string): string {
    const custom = {
      id: 'custom-keep',
      name: '我的',
      note: '别丢',
      palettes: {
        light: Object.fromEntries(THEME_TOKENS.map((t) => [t.key, '#123abc'])),
        dark: Object.fromEntries(THEME_TOKENS.map((t) => [t.key, '#654321'])),
      },
    };
    return JSON.stringify({ selectedId, mode: 'dark', custom: [custom] });
  }

  it('旧内置称呼换成同色系的新方案，挡位与自定义一个值都不动', () => {
    const expected: Record<string, string> = {
      mint: 'jade-dawn',
      navigator: 'slate-harbor',
      'crab-daisy': 'clay-ember',
    };
    for (const [legacy, mine] of Object.entries(expected)) {
      installStorage({ 'pet.console.theme': legacyRecord(legacy) });
      const state = readThemeState();
      expect(state.selectedId).toBe(mine);
      expect(state.mode).toBe('dark');
      expect(state.custom).toHaveLength(1);
      expect(state.custom[0]!.name).toBe('我的');
      expect(Object.keys(state.custom[0]!.palettes['light'])).toHaveLength(THEME_TOKENS.length);
      expect(state.custom[0]!.palettes['dark']['accent']).toBe('#654321');
    }
  });

  it('写回去的记录只用新方案 id：旧称呼不再出现', () => {
    installStorage({ 'pet.console.theme': legacyRecord('mint') });
    const state = readThemeState();
    expect(writeThemeState(state).ok).toBe(true);
    const raw = localStorage.getItem('pet.console.theme') ?? '';
    expect(raw).toContain('jade-dawn');
    expect(raw).not.toContain('"mint"');
  });

  it('旧内置不再作为方案存在，界面上只剩自有那三套', () => {
    const ids = allSchemes(defaultStoredTheme()).map((scheme) => scheme.id);
    expect(ids).toEqual(['slate-harbor', 'jade-dawn', 'clay-ember']);
    for (const legacy of ['mint', 'navigator', 'crab-daisy']) {
      expect(migrateSchemeId(legacy)).not.toBe(legacy);
    }
    // 自定义 id 与未知 id 都不该被别名改写。
    expect(migrateSchemeId('custom-keep')).toBe('custom-keep');
    expect(migrateSchemeId('gone')).toBe('gone');
  });
});

describe('记录的写入', () => {
  it('写成功与写不进是两件事：读回来核对过才叫 ok', () => {
    installStorage();
    expect(writeThemeState(defaultStoredTheme()).ok).toBe(true);

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
      },
      configurable: true,
    });
    const result = writeThemeState({ ...defaultStoredTheme(), mode: 'dark' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('QuotaExceeded');
  });

  it('订阅者拿到写入后的记录，退订之后不再打扰', () => {
    installStorage();
    const seen: StoredTheme[] = [];
    const off = subscribeTheme((state) => seen.push(state));
    writeThemeState(defaultStoredTheme());
    off();
    writeThemeState({ ...defaultStoredTheme(), mode: 'light' });
    expect(seen).toHaveLength(1);
  });
});

describe('方案与调色板', () => {
  beforeEach(() => installStorage());

  it('内置在前、自定义在后；色带是底纸 / 主卡纸 / 主强调 / 一个系列色', () => {
    const state = defaultStoredTheme();
    expect(allSchemes(state).map((s) => s.id)).toEqual(['slate-harbor', 'jade-dawn', 'clay-ember']);
    // 默认那一套就是网站原件那一份：白底白卡、#2d8cf0 强调、同族低饱和蓝作系列色。
    expect(schemeSwatches(allSchemes(state)[0]!, 'light')).toEqual([
      '#fff',
      '#fff',
      '#2d8cf0',
      '#5a7fa8',
    ]);
  });

  it('指向一个不存在的方案时退回默认方案，而不是把界面画成空白', () => {
    const orphan: StoredTheme = { ...defaultStoredTheme(), selectedId: 'custom-gone' };
    expect(currentScheme(orphan).id).toBe(DEFAULT_SCHEME_ID);
    expect(selectScheme(orphan, 'custom-gone')).toBeNull();
  });

  it('另存为只覆盖当前明暗变体，另一份从源方案原样拷过来', () => {
    const base = selectScheme(defaultStoredTheme(), 'jade-dawn')!;
    const saved = saveSchemeAs(base, {
      name: '我的薄荷',
      palette: oneToken('accent', '#123456'),
      appearance: 'light',
    });
    const scheme = saved.state.custom[0]!;
    expect(scheme.palettes['light']['accent']).toBe('#123456');
    // 黑夜那份必须是翠晓自己的绿，而不是浅色配色的暗抄本。
    expect(scheme.palettes['dark']['accent']).toBe('#8cc17c');
    expect(saved.state.selectedId).toBe(scheme.id);
  });

  it('内置方案不可覆盖；自定义方案保存只动当前变体', () => {
    const brand = currentScheme(defaultStoredTheme());
    expect(
      saveCurrentScheme(defaultStoredTheme(), {
        name: 'x',
        palette: { ...brand.palettes['light'], ok: '#0f0f0f' },
        appearance: 'light',
        schemeId: DEFAULT_SCHEME_ID,
      }),
    ).toBeNull();

    const saved = saveSchemeAs(defaultStoredTheme(), {
      name: '我的',
      palette: { ...brand.palettes['dark'], ok: '#0f0f0f' },
      appearance: 'dark',
    });
    const id = saved.state.selectedId;
    const dark = saved.state.custom[0]!.palettes['dark'];
    const next = saveCurrentScheme(saved.state, {
      name: '  改名  ',
      palette: { ...dark, accent: '#abcdef' },
      appearance: 'dark',
      schemeId: id,
    })!;
    const scheme = next.custom.find((s) => s.id === id)!;
    expect(scheme.name).toBe('改名');
    expect(scheme.palettes['dark']['accent']).toBe('#abcdef');
    expect(scheme.palettes['dark']['ok']).toBe('#0f0f0f');
    // 浅色那份从没被碰过：黑夜的两次保存不该在浅色里留下痕迹。
    expect(scheme.palettes['light']).toEqual(brand.palettes['light']);
  });

  it('名字太长截到 40 字；空名字退回“源方案 副本”', () => {
    const long = saveSchemeAs(defaultStoredTheme(), {
      name: '颜'.repeat(50),
      palette: oneToken('paper', '#010203'),
      appearance: 'light',
    });
    expect(long.state.custom[0]!.name).toHaveLength(40);
    const empty = saveSchemeAs(defaultStoredTheme(), {
      name: '   ',
      palette: oneToken('paper', '#010203'),
      appearance: 'light',
    });
    expect(empty.state.custom[0]!.name).toBe('原件 副本');
  });

  it('删掉正选中的方案回到默认方案；删别的不动当前选择', () => {
    const saved = saveSchemeAs(defaultStoredTheme(), {
      name: '我的',
      palette: oneToken('paper', '#010203'),
      appearance: 'light',
    });
    const id = saved.state.selectedId;
    const removed = removeScheme(saved.state, id)!;
    expect(removed.custom).toHaveLength(0);
    expect(removed.selectedId).toBe(DEFAULT_SCHEME_ID);
    expect(removeScheme(saved.state, 'not-there')).toBeNull();

    const two = saveSchemeAs(saved.state, {
      name: '另一个',
      palette: oneToken('paper', '#010203'),
      appearance: 'light',
    });
    expect(removeScheme(two.state, id)!.selectedId).toBe(two.state.selectedId);
  });
});

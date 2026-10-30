import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsShell,
  type SettingsNavItem,
  type SettingsShellProps,
} from './settings-shell.js';

/**
 * 外壳只该做两件事：把父级给的入口画出来并标出当前项，把插槽放回该放的位置。
 * 这里断言语义（aria-current、label→控件、describedBy、折叠态的来源）与 QA 用的 testid，
 * 不断言像素。原创外壳对外的名字是 settings-shell / settings-sidebar / settings-main / settings-content，
 * data-rail 只有 expanded 与 collapsed 两种。
 */
const items: readonly SettingsNavItem[] = [
  { id: 'persona', label: '人设' },
  { id: 'voice', label: '语音输入' },
  { id: 'extensions', label: '扩展', quiet: true },
  { id: 'about', label: '关于', quiet: true },
];

function shell(over: Partial<SettingsShellProps> = {}): string {
  const props: SettingsShellProps = {
    items,
    selected: 'voice',
    onSelect: () => undefined,
    brand: 'AI 桌宠',
    title: '语音输入',
    children: <p>内容</p>,
    ...over,
  };
  return renderToStaticMarkup(<SettingsShell {...props} />);
}

describe('设置台外壳', () => {
  it('当前入口只有一个 aria-current，选中的是父级给的那个 id', () => {
    const html = shell();
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('<span class="pb-nav__text">语音输入</span>');
  });

  it('恢复入口排在日常入口之后，没有恢复入口时不出现第二条列表', () => {
    const html = shell();
    expect(html.indexOf('pb-rail__list--quiet')).toBeGreaterThan(html.indexOf('人设'));
    expect(html).toContain('关于');
    expect(shell({ items: items.filter((item) => item.quiet !== true) })).not.toContain('--quiet');
  });

  it('四个对外锚点始终在，插槽各归其位；没给内容时连容器一起不出现', () => {
    const bare = shell();
    for (const id of ['settings-shell', 'settings-sidebar', 'settings-main', 'settings-content']) {
      expect(bare).toContain('data-testid="' + id + '"');
    }
    expect(bare).not.toContain('pb-main__notice');
    expect(bare).not.toContain('pb-main__actions');
    expect(bare).not.toContain('pb-main__header-extra');
    const filled = shell({
      notice: <p>有 1 项等你确认</p>,
      header: <p>应用运行中</p>,
      footer: <p>主题</p>,
      actions: <button type="button">使用向导</button>,
    });
    expect(filled).toContain('有 1 项等你确认');
    expect(filled).toContain('应用运行中');
    expect(filled).toContain('主题');
    expect(filled).toContain('<button type="button">使用向导</button>');
  });

  it('内容区可被程序化聚焦，跳转按钮是按钮而不是锚点', () => {
    const html = shell();
    expect(html).toMatch(/<main class="pb-main"[^>]*tabindex="-1"/);
    expect(html).toContain('<button type="button" class="pb-shell__skip"');
    expect(html).not.toContain('href=');
  });
});

describe('侧栏折叠', () => {
  it('本机记着折叠就折叠，没有记录时展开', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'pet.console.rail' ? 'collapsed' : null),
      setItem: () => undefined,
    });
    expect(shell()).toContain('data-rail="collapsed"');
    vi.unstubAllGlobals();
    expect(shell()).toContain('data-rail="expanded"');
  });

  it('存储读不到时按展开处理，折叠按钮仍然在', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('受限环境');
      },
      setItem: () => undefined,
    });
    const html = shell();
    vi.unstubAllGlobals();
    expect(html).toContain('data-rail="expanded"');
    expect(html).toContain('aria-label="收起侧栏"');
    expect(html).toContain('aria-expanded="true"');
  });

  it('折叠不改变可访问名称：文字仍在按钮里，图标只是装饰', () => {
    const html = shell();
    expect(html).toContain('title="语音输入"');
    expect(html).toContain('<span class="pb-nav__text">语音输入</span>');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/class="pb-nav__icon"/g)).toHaveLength(items.length);
  });

  it('品牌那一行是自家标记加产品名', () => {
    const html = shell();
    expect(html).toContain('role="img" aria-label="AI 桌宠"');
    expect(html).toContain('<span class="pb-rail__brand-name">AI 桌宠</span>');
  });
});

describe('分节', () => {
  it('标题右边挂的是给出来的真实状态，用的是 kit 的状态牌；标题本身就是这一节的名称', () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="我的桌宠" state={{ text: '在桌面上', tone: 'on' }}>
        <p>预览</p>
      </SettingsSection>,
    );
    expect(html).toContain('class="su-status" data-tone="on"');
    expect(html).toContain('在桌面上');
    const labelledBy = /<section class="pb-sheet" aria-labelledby="([^"]+)">/.exec(html)?.[1];
    const titleId = /<h2 class="pb-sheet__title" id="([^"]+)">/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(titleId).toBe(labelledBy);
  });

  it('没有状态、说明与操作时不画空容器', () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="连接模型">
        <p>卡片</p>
      </SettingsSection>,
    );
    expect(html).not.toContain('pb-status');
    expect(html).not.toContain('pb-sheet__description');
    expect(html).not.toContain('pb-sheet__actions');
    expect(html).toContain('卡片');
  });
});

describe('设置行', () => {
  it('持有控件的行把标签接到控件 id，并把说明与错误串进 aria-describedby', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="称呼你" description="它这样叫你" error="这个名字太长了。">
        {({ inputId, describedBy, invalid }) => (
          <input
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid ? true : undefined}
          />
        )}
      </SettingsRow>,
    );

    const forId = /<label class="pb-row__name"[^>]*for="([^"]+)">/.exec(html)?.[1];
    const inputId = /<input id="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(forId).toBe(inputId);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toContain('-description');
    expect(describedBy).toContain('-error');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it('控件组的行用 aria-labelledby 标注名称，不留指向不存在控件的 label', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="说话风格" labelFor="group">
        {({ labelledBy }) => (
          <div role="radiogroup" aria-labelledby={labelledBy}>
            <input type="radio" name="style" id="quiet" />
            <label htmlFor="quiet">安静</label>
          </div>
        )}
      </SettingsRow>,
    );
    const nameId = /<span class="pb-row__name" id="([^"]+)">说话风格/.exec(html)?.[1];
    expect(nameId).toBeTruthy();
    expect(/aria-labelledby="([^"]+)"/.exec(html)?.[1]).toBe(nameId);
    expect(html).not.toContain('<label class="pb-row__name"');
  });

  it('只展示当前值的行不造指向不存在控件的 label', () => {
    const html = renderToStaticMarkup(
      <SettingsRows>
        <SettingsRow label="回复语言" hint="只影响它的回复">
          简体中文
        </SettingsRow>
      </SettingsRows>,
    );
    expect(html).toContain('class="pb-rows"');
    expect(html).not.toContain('<label');
    expect(html).toContain('简体中文');
    expect(html).toContain('只影响它的回复');
  });

  it('放不下的那一行退成上下两段，不挤掉控件', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="API Key" wide>
        sk-…
      </SettingsRow>,
    );
    expect(html).toContain('class="pb-row pb-row--stack"');
  });
});

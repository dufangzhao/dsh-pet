import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SettingsRow,
  SettingsRows,
  SettingsShell,
  type SettingsNavItem,
  type SettingsShellProps,
} from './settings-shell.js';

/**
 * 外壳只该做两件事：把父级给的入口画出来并标出当前项，把插槽放回该放的位置。
 * 这里断言语义（aria-current、label→控件、describedBy），不断言像素。
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
    expect(html).toContain('aria-current="page">语音输入</button>');
  });

  it('恢复入口排在日常入口之后，没有恢复入口时不出现第二条列表', () => {
    const html = shell();
    expect(html.indexOf('pk-settings__list--quiet')).toBeGreaterThan(html.indexOf('人设'));
    expect(html).toContain('关于');
    expect(shell({ items: items.filter((item) => item.quiet !== true) })).not.toContain('--quiet');
  });

  it('插槽各归其位；没给内容时连容器都不出现', () => {
    expect(shell()).not.toContain('pk-settings__notice');
    const filled = shell({
      notice: <p>有 1 项等你确认</p>,
      header: <p>应用运行中</p>,
      footer: <p>主题</p>,
    });
    expect(filled).toContain('pk-settings__notice');
    expect(filled).toContain('有 1 项等你确认');
    expect(filled).toContain('应用运行中');
    expect(filled).toContain('主题');
  });

  it('内容区可被程序化聚焦，跳转按钮是按钮而不是锚点', () => {
    const html = shell();
    expect(html).toMatch(/<main class="pk-settings__main" tabindex="-1">/);
    expect(html).toContain('<button type="button" class="pk-settings__skip">');
    expect(html).not.toContain('href=');
  });
});

describe('设置行', () => {
  it('持有控件的行把标签接到控件 id，并把说明与错误串进 aria-describedby', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="称呼你" description="它这样叫你" error="这个名字太长了。">
        {({ inputId, describedBy, invalid }) => (
          <input
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            aria-invalid={invalid ? true : undefined}
          />
        )}
      </SettingsRow>,
    );

    const forId = /<label class="pk-row__name"[^>]*for="([^"]+)">/.exec(html)?.[1];
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
    const nameId = /<span class="pk-row__name" id="([^"]+)">说话风格/.exec(html)?.[1];
    expect(nameId).toBeTruthy();
    expect(/aria-labelledby="([^"]+)"/.exec(html)?.[1]).toBe(nameId);
    expect(html).not.toContain('<label class="pk-row__name"');
  });

  it('只展示当前值的行不造指向不存在控件的 label', () => {
    const html = renderToStaticMarkup(
      <SettingsRows>
        <SettingsRow label="回复语言" hint="只影响它的回复">
          简体中文
        </SettingsRow>
      </SettingsRows>,
    );
    expect(html).toContain('class="pk-rows"');
    expect(html).not.toContain('<label');
    expect(html).toContain('简体中文');
    expect(html).toContain('只影响它的回复');
  });
});

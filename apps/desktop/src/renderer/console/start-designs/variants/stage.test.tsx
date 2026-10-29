import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { STAGE_DESIGN, stageTrayState } from './stage.js';

import type { StartContext, StartSlots } from '../contracts.js';
import type { StartModel } from '../use-start-model.js';

const slot = (name: string): React.ReactElement => <span data-slot={name} />;

const slots: StartSlots = {
  status: slot('status'),
  provider: slot('provider'),
  connect: slot('connect'),
  pet: slot('pet'),
  theme: slot('theme'),
};

function context(over: Partial<StartModel> = {}): StartContext {
  return {
    app: { values: null, snapshot: null, available: false, saving: false },
    demo: {},
    notify: () => undefined,
    goToView: () => undefined,
    onOpenPlugins: () => undefined,
    model: {
      snapshotLabel: null,
      desktop: { mark: 'off', text: '桌宠未就绪' },
      desktopShown: false,
      ...over,
    },
  } as unknown as StartContext;
}

/**
 * native 抓到的竞争：两段抽屉共用一个互斥状态。点开配色时接线那段被改成关闭，
 * 原生 details 跟着发一次 toggle(false)；无条件清空会把刚打开的配色又关掉。
 */
describe('stage 的两段抽屉', () => {
  it('兄弟段的关闭事件不许清掉刚打开的那一段', () => {
    // 没在用连接：默认替用户把接线那段打开
    let tray = stageTrayState('connect', 'connect', true);
    expect(tray).toBe('connect');
    // 用户点配色：打开 theme
    tray = stageTrayState(tray, 'theme', true);
    expect(tray).toBe('theme');
    // 这一次点击让 connect 的 open 变成 false，原生事件跟着报关闭——不许关掉 theme
    tray = stageTrayState(tray, 'connect', false);
    expect(tray).toBe('theme');
  });

  it('关掉自己那一段才清空；再点开另一段照常切换', () => {
    expect(stageTrayState('theme', 'theme', false)).toBeNull();
    expect(stageTrayState(null, 'connect', true)).toBe('connect');
    expect(stageTrayState('connect', 'connect', false)).toBeNull();
    expect(stageTrayState('connect', 'theme', true)).toBe('theme');
    // 已经没开着东西时收到的关闭事件不改状态
    expect(stageTrayState(null, 'connect', false)).toBeNull();
  });

  it('没接上时替用户把接线那段打开；配色段没开就不挂载', () => {
    const html = renderToStaticMarkup(STAGE_DESIGN.render(context(), slots));
    expect(html).toContain('data-slot="connect"');
    expect(html.match(/<details[^>]*\bopen/g)).toHaveLength(1);
    expect(html).not.toContain('data-slot="theme"');
  });

  /**
   * 两段不一样是有意的：接线收起只是看不见，草稿（模型名与 Key）跟着 details 留在内存里，
   * 不该因为收起就丢；配色收起必须把工作室卸掉，由控制器撤掉没保存的试色。
   */
  it('已经接上时不替用户点开任何一段：接线收起仍在树里，配色不挂载', () => {
    const html = renderToStaticMarkup(
      STAGE_DESIGN.render(context({ snapshotLabel: 'DeepSeek · deepseek-flash' }), slots),
    );
    expect(html.match(/<details[^>]*\bopen/g)).toBeNull();
    expect(html).toContain('data-slot="connect"');
    expect(html).not.toContain('data-slot="theme"');
    expect(html).toContain('data-slot="pet"');
  });
});

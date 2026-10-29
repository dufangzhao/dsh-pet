import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StartContext, StartSlots } from '../contracts.js';
import { SPINE_DESIGN } from './spine.js';

/**
 * spine 守的是两条承诺：三段都能自己开合，且没接模型时后面两段照样进得去
 * （离线演示本来就能用）。这里用真的组件与真的展开状态，插槽给的是假内容——
 * 版式只负责摆放它们，插槽内部已被共享契约测过。
 */
const slot = (name: string): React.ReactElement => <span data-slot={name} />;

const slots: StartSlots = {
  status: slot('status'),
  vendors: slot('vendors'),
  connect: slot('connect'),
  pet: slot('pet'),
  theme: slot('theme'),
};

function context(over: Partial<StartContext> = {}): StartContext {
  const base = {
    app: { values: null, snapshot: null, available: false, saving: false },
    models: { snapshot: null, available: true, loading: false, error: null },
    demo: {},
    draft: {},
    notify: () => undefined,
    goToView: () => undefined,
    onOpenPlugins: () => undefined,
  };
  return { ...base, ...over } as unknown as StartContext;
}

const render = (): string => renderToStaticMarkup(SPINE_DESIGN.render(context(), slots));

describe('spine 版式', () => {
  it('三段都在，各自可展开且不互相门控', () => {
    const html = render();
    for (const id of ['connect', 'pet', 'theme']) {
      expect(html).toContain('data-testid="spine-toggle-' + id + '"');
    }
    // 没接模型（snapshot=null）时后面几段仍然进得去；模型与桌宠只是收起，内容不拆。
    expect(html).toContain('data-slot="pet"');
    expect(html).toContain('data-slot="connect"');
    // 配色段按 house rule 收起即卸载：未保存的试色由工作室自己的离场清理撤掉，
    // 所以关着的时候树里根本没有它（打开后才会挂载）。
    expect(html).not.toContain('data-slot="theme"');
  });

  it('默认展开前两段，配色那段收起但进得去；状态由 aria-expanded 说', () => {
    const html = render();
    expect(html).toContain('data-step="connect"');
    expect(html.indexOf('aria-expanded="true"')).toBeLessThan(
      html.indexOf('aria-expanded="false"'),
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    // 收起的区域本身还在（按钮 aria-controls 有靶子），只有配色内容被卸掉。
    expect(html).toContain('id="sd-spine-theme" hidden');
    expect(html).not.toContain('data-slot="theme"');
  });

  it('状态标记读真实来源：没读到快照时说桌宠没在桌面上、灯按当前配色', () => {
    const html = render();
    expect(html).toContain('桌宠没在桌面上');
    expect(html).toContain('现在是浅色配色');
    expect(html).toContain('正在回应');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StartContext, StartSlots } from '../contracts.js';
import { SPINE_DEFAULT_STEPS, SPINE_DESIGN, spineStepState } from './spine.js';

import type { StartModel } from '../use-start-model.js';

/**
 * spine 守的两条承诺没换：三段都能自己开合，且没接模型时后面两段照样进得去
 * （离线演示本来就能用）。插槽给的是假内容——版式只负责摆放，插槽内部由控件回归测。
 */
const slot = (name: string): React.ReactElement => <span data-slot={name} />;

const slots: StartSlots = {
  status: slot('status'),
  provider: slot('provider'),
  connect: slot('connect'),
  pet: slot('pet'),
  theme: slot('theme'),
};

function context(over: Partial<StartModel> = {}): StartContext {
  const model = {
    available: true,
    loading: false,
    error: null,
    notice: null,
    phase: 'nothing-yet',
    paused: false,
    snapshotLabel: null,
    rows: [],
    choices: [],
    query: '',
    desktop: { mark: 'off', text: '桌宠未就绪' },
    desktopShown: false,
    appAvailable: false,
    ...over,
  } as unknown as StartModel;
  return {
    app: { values: null, snapshot: null, available: false, saving: false },
    models: { snapshot: null, available: true, loading: false, error: null },
    demo: {},
    notify: () => undefined,
    goToView: () => undefined,
    onOpenPlugins: () => undefined,
    model,
  } as unknown as StartContext;
}

const render = (over: Partial<StartModel> = {}): string =>
  renderToStaticMarkup(SPINE_DESIGN.render(context(over), slots));

describe('spine 的开合状态', () => {
  /**
   * 原生 <details open> 挂载时也会发一次 toggle。以前这里盲翻转，
   * 默认展开的那一段会被这一下关掉；现在只认事件报上来的值。
   */
  it('开合按事件报的值定状态，不是每次都取反', () => {
    const opened = spineStepState(SPINE_DEFAULT_STEPS, 'connect', true);
    expect(opened.connect).toBe(true);
    expect(spineStepState(opened, 'connect', false).connect).toBe(false);
    expect(spineStepState(SPINE_DEFAULT_STEPS, 'theme', true)).toEqual({
      connect: true,
      pet: true,
      theme: true,
    });
    // 别段不受这一次事件影响
    expect(spineStepState(SPINE_DEFAULT_STEPS, 'connect', false).pet).toBe(true);
  });
});

describe('spine 版式', () => {
  it('三段都在，各自可展开且不互相门控', () => {
    const html = render();
    expect(html.match(/<details/g)).toHaveLength(3);
    // 没接模型（snapshotLabel=null）时后面几段仍然进得去。
    expect(html).toContain('data-slot="pet"');
    expect(html).toContain('data-slot="connect"');
    // 配色那段默认收起就卸载：试色由工作室自己的离场清理撤掉。
    expect(html).not.toContain('data-slot="theme"');
  });

  it('默认展开前两段；配色那段打开后才挂载', () => {
    const html = render();
    expect(html).toContain('data-step="connect"');
    expect(html.match(/<details[^>]*\bopen/g)).toHaveLength(2);
  });

  it('桌宠在不在、连没连上，读的都是真状态那一句', () => {
    expect(render()).toContain('桌宠未就绪');
    expect(render({ snapshotLabel: 'DeepSeek · deepseek-flash' })).toContain('已经接上，可以说话');
  });
});

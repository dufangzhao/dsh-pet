/**
 * Precision 的回归只盯两件事：
 * 1) 这一族真的画的是「原生下拉 + 表格行 + role=switch 的一行 + dt/dd 读数 + 挡位导航」，
 *    不是 pet bench 的板件换一层 CSS；
 * 2) 能不能按、按不下去时那句原因，读的都是 model 那份真判断；回执只在真写过之后出现。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FOREIGN_KIT, countOf, stubModel } from './stub-model.js';
import { PRECISION_SEED, PrecisionFamily, type Panel } from './precision.js';

import type { StartModel } from '../start-designs/use-start-model.js';

function view(
  over: { panel?: Panel; board?: boolean; model?: StartModel; guide?: ReactNode } = {},
): string {
  return renderToStaticMarkup(
    <PrecisionFamily
      model={over.model ?? stubModel()}
      board={over.board ?? false}
      {...(over.panel === undefined ? {} : { openPanel: over.panel })}
      {...(over.guide === undefined ? {} : { guide: over.guide })}
    />,
  );
}

describe('Precision 的控件体系', () => {
  it('挑一家是原生下拉，目录是一行一家的表格，未接入的那行选不到', () => {
    const html = view({ panel: 'connect' });
    expect(html).toContain('<select');
    expect(html).toContain('data-testid="model-provider-select"');
    expect(html).toContain('<option value="glm-cn" disabled');
    expect(countOf(html, 'model-pick-')).toBe(3);
    expect(html).toContain('<tr data-selected="true"');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('<dl class="px-strip"');
    // 这一栏里的开关就是 role=switch 那一行，不是插销板也不是胶囊。
    expect(countOf(html, 'role="switch"')).toBe(1);
    // 挡位导航一次只看一个分区。
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('data-testid="px-board"');
  });

  it('不借旧板件，也没有把旧 Start 控件搬进来', () => {
    const window = view({ panel: 'connect' });
    const board = view({ board: true });
    for (const marker of FOREIGN_KIT) {
      expect(window).not.toContain(marker);
      expect(board).not.toContain(marker);
    }
  });

  it('读不到、按不动、正在写，各说一句真的', () => {
    const loading = view({
      model: stubModel({ picked: undefined, loading: true, phase: 'loading' }),
    });
    expect(loading).toContain('正在读这台机器的模型配置…');
    expect(loading).toContain('data-testid="start-connect-empty"');

    const blocked = view({
      model: stubModel({
        model: '',
        can: { save: false, test: true, signIn: true },
        reasons: { save: '模型名不能空着。', test: null, signIn: null },
      }),
    });
    expect(blocked).toContain('data-testid="model-save"');
    expect(blocked).toContain('disabled');
    expect(blocked).toContain('data-testid="model-save-reason"');
    expect(blocked).toContain('模型名不能空着。');

    const saving = view({ model: stubModel({ busy: { ...stubModel().busy, saving: true } }) });
    expect(saving).toContain('aria-busy="true"');
    expect(saving).toContain('正在写入这台机器…');

    const failed = view({
      model: stubModel({ phase: 'read-failed', error: '这台机器的模型配置没读到。' }),
    });
    expect(failed).toContain('data-tone="bad"');
    expect(failed).toContain('这台机器的模型配置没读到。');
  });

  it('回执只在真有过一次写入之后出现；样张里没有假回执，也不与整窗同屏', () => {
    expect(view()).not.toContain('data-testid="model-receipt"');
    const receipted = view({
      model: stubModel({
        saved: { saved: true, tested: false, active: true, text: '这台机器记下了这次写入。' },
        tested: { ran: true, passed: false, text: '刚才那一次探测没通过。' },
      }),
    });
    expect(receipted).toContain('data-testid="model-receipt"');
    expect(receipted).toContain('这台机器记下了这次写入。');
    expect(receipted).toContain('刚才那一次探测没通过。');

    const board = view({ board: true });
    expect(board).toContain('data-testid="px-board"');
    expect(board).toContain('data-sample="true"');
    expect(board).toContain('disabled');
    expect(board).not.toContain('data-testid="model-receipt"');
    expect(board).not.toContain('data-testid="start-connect-form"');
  });

  it('说话与录音的可用性读会话那一位所有者，不演一个能按的样子', () => {
    const on = view({ panel: 'presence' });
    expect(on).toContain('data-testid="pet-composer-input"');
    expect(on).toContain('data-testid="pet-mic-toggle"');
    expect(on).toContain('data-testid="pet-pause"');
    expect(countOf(on, 'role="switch"')).toBe(2);
    // 戳一下的 testid 落在真实那颗按钮上，页面上没有替身节点。
    expect(on).toContain('<button type="button" class="px-figure"');
    expect(countOf(on, 'data-testid="pet-poke"')).toBe(1);
    expect(on).toContain('data-testid="pet-stage"');

    const off = view({
      panel: 'presence',
      model: stubModel({ pet: { ...stubModel().pet, mic: undefined, composer: undefined } }),
    });
    expect(off).toContain('这条会话现在不在');
    expect(off).not.toContain('data-testid="pet-mic-toggle"');
    expect(off).not.toContain('data-testid="pet-composer-send"');

    const noApp = view({ panel: 'presence', model: stubModel({ appAvailable: false }) });
    expect(noApp).toContain('这一页还没连上应用');
  });

  it('配色那一页是 36 格的表，动作读的是同一个控制器', () => {
    const html = view({ panel: 'palette' });
    expect(html).toContain('data-testid="start-theme"');
    expect(countOf(html, 'theme-token-')).toBe(36);
    expect(countOf(html, 'theme-hex-')).toBe(36);
    expect(html).toContain('data-testid="theme-save"');
    expect(html).toContain('data-testid="theme-undo"');
    expect(html).toContain('data-testid="theme-mode-system"');
    // 内置方案不能删，删除那颗按不动。
    expect(html).toContain('删除这个自定义方案');
  });

  it('呈现种子是本族自己的中性灰，交给记录之后不再贴色；向导只有外壳给进来才画', () => {
    const html = view();
    expect(PRECISION_SEED.light?.['paper']).toBe('#f1f2f3');
    expect(PRECISION_SEED.dark?.['paper']).toBe('#191c1f');
    expect(html).toContain('data-seeded="true"');
    expect(html).toContain('--paper:#f1f2f3');
    expect(html).toContain('配色＝这一族的呈现种子');
    expect(html).not.toContain('start-guide');
    expect(
      view({
        guide: (
          <button type="button" data-testid="start-guide">
            使用向导
          </button>
        ),
      }),
    ).toContain('data-testid="start-guide"');
  });
});

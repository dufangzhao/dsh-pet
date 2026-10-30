/**
 * Workbench 这一家守两件事：它是**自己那一整扇窗**（不是设置台外壳里的一块内容），
 * 以及它摆的还是那一份接好线的控件——同一批 locator、同一份 model，没有第二个状态持有者。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WORKBENCH_FAMILY } from './workbench.js';
import { stubModel } from './stub-model.js';

import type { FamilyProps } from './contracts.js';

const Family = WORKBENCH_FAMILY.Component!;

const view = (over: Partial<FamilyProps> = {}): string =>
  renderToStaticMarkup(
    <Family
      model={over.model ?? stubModel()}
      board={over.board ?? false}
      {...(over.guide === undefined ? {} : { guide: over.guide })}
    />,
  );

describe('Workbench 整窗', () => {
  it('自己画标题板、状态栏、正文与页脚，不吃设置台外壳', () => {
    const markup = view();
    expect(markup).toContain('data-testid="workbench-window"');
    expect(markup).toContain('data-family="workbench"');
    expect(markup).toContain('class="wb__bar"');
    expect(markup).toContain('class="wb__rail"');
    expect(markup).toContain('class="wb__foot"');
    for (const forbidden of ['settings-shell', 'pb-rail', 'pb-modes', 'console-nav']) {
      expect(markup.includes(forbidden), '不该出现 ' + forbidden).toBe(false);
    }
  });

  it('接线与桌宠都接在同一份 model 上：locator 与状态词都是真的', () => {
    const markup = view();
    for (const id of [
      'model-input',
      'key-input',
      'model-save',
      'model-test',
      'start-theme',
      'pet-pause',
    ]) {
      expect(markup).toContain('data-testid="' + id + '"');
    }
    expect(markup).toContain('DeepSeek · deepseek-chat');
    expect(markup).toContain('在桌面上');
    expect(markup).toContain('data-testid="model-pick-deepseek-cn"');
    // 向导由评审外壳给：这一家自己不该先画一颗。
    expect(markup).not.toContain('data-testid="start-guide"');
  });

  it('向导由评审外壳给：给就摆进栏里，不给就不画一颗按得动的假按钮', () => {
    expect(view()).not.toContain('使用向导');
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

  it('样板台是另一面：摆这一族的控件状态，不接 Start 的动作', () => {
    const markup = view({ board: true });
    expect(markup).toContain('data-view="board"');
    expect(markup).toContain('data-testid="original-control-board"');
    expect(markup).not.toContain('data-testid="model-save"');
  });

  it('读不到模型连接时说的是没通道，不画一张能填的假表单', () => {
    const markup = view({
      model: stubModel({ available: false, phase: 'no-bridge', picked: undefined }),
    });
    expect(markup).toContain('这台机器还没有模型连接的通道');
    expect(markup).not.toContain('data-testid="key-input"');
  });
});

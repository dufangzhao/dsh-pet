import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ConfigDefinition, JsonObject } from '@pet/contracts';

import { ConfigForm } from './config-form.js';
import { buildConfigForm } from './config-schema.js';
import { initialDraft } from './config-draft.js';

/**
 * 渲染回归：未设置的可选项不能去取草稿值，否则第一次渲染就会抛错。
 * 这组断言只依赖语义（标签、分组、开关），不依赖任何具体字段名。
 */
const definition: ConfigDefinition = {
  version: 1,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', title: '名称' },
      group: {
        type: 'object',
        title: '分组',
        additionalProperties: false,
        properties: { flag: { type: 'boolean', title: '开关' } },
      },
      list: { type: 'array', title: '条目', items: { type: 'string' } },
      note: { type: 'string', title: '备注' },
      fixed: { type: 'string', const: 'v1', title: '固定项' },
      blank: { type: 'null', title: '空值项' },
    },
  },
  defaults: {},
  fields: [],
};

const root = buildConfigForm(definition);

function render(data: JsonObject | null): string {
  return renderToStaticMarkup(
    <ConfigForm
      root={root}
      draft={initialDraft(root, data, definition.defaults)}
      errors={{}}
      disabled={false}
      onChange={() => undefined}
      onPresence={() => undefined}
      onAddItem={() => undefined}
      onRemoveItem={() => undefined}
    />,
  );
}

describe('Schema 表单渲染', () => {
  it('未设置的可选项只渲染开关，不读取草稿值', () => {
    const html = render(null);
    expect(html).toContain('备注');
    expect(html).toContain('未设置，保存时不写入这一项。');
    // 开关的可访问名称带着字段标题，键盘和读屏都能定位。
    expect(html).toContain('aria-label="备注：设置此项"');
  });

  it('可选的对象与数组也用开关表达"未设置"', () => {
    const html = render(null);
    expect(html).toContain('aria-label="分组：设置此项"');
    expect(html).toContain('aria-label="条目：设置此项"');
    // 未设置时不应该展开成 fieldset。
    expect(html).not.toContain('<fieldset');
  });

  it('已设置的嵌套对象渲染为 fieldset，标题就是 legend', () => {
    const html = render({ name: 'x', group: { flag: true } });
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend class="config-group__legend">分组</legend>');
  });

  it('必填字段没有开关；设置后的 const 与 null 只展示不可编辑', () => {
    expect(render(null)).not.toContain('aria-label="名称：设置此项"');

    // const 与 null 一旦存在，就不该再给编辑控件。
    const html = render({ name: 'x', fixed: 'v1', blank: null });
    expect(html).toContain('固定为 v1');
    expect(html).toContain('这一项固定为空值（null）。');
  });
});

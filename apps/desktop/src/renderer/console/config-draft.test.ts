import type { ConfigDefinition, JsonObject } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import { buildConfigForm, type ConfigNode } from './config-schema.js';
import {
  addItem,
  buildCandidate,
  draftAt,
  initialDraft,
  removeItem,
  replaceAt,
  setPresence,
} from './config-draft.js';

/**
 * 夹具刻意覆盖受限 Schema 的各类关键字，但断言只依赖语义、不依赖这些字段名：
 * 换成别的插件定义，同样的规则仍然成立。
 */
const definition: ConfigDefinition = {
  version: 1,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', title: '名称', minLength: 2, maxLength: 12 },
      engine: { type: 'string', title: '引擎', enum: ['a', 'b'], default: 'a' },
      options: {
        type: 'object',
        title: '选项',
        additionalProperties: false,
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean', default: false },
          threads: { type: 'integer', default: 2, minimum: 1, maximum: 4 },
        },
      },
      words: {
        type: 'array',
        title: '词条',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      },
      key: { type: 'string', format: 'credential-ref', enum: ['asr-key'], title: '凭据' },
      note: { type: 'string', title: '备注' },
      ratio: { type: 'number', title: '比例', minimum: 0, maximum: 1 },
      nothing: { type: 'null', title: '空值' },
      mode: { const: 'm2', title: '版本' },
    },
  },
  defaults: {
    name: '',
    engine: 'a',
    options: { enabled: false, threads: 2 },
    words: ['w'],
    mode: 'm2',
  },
  fields: [
    { pointer: '/name', type: 'string', apply: 'restart' },
    { pointer: '/engine', type: 'string', apply: 'reload' },
    { pointer: '/options', type: 'object', apply: 'reload' },
    { pointer: '/words', type: 'array', apply: 'immediate' },
  ],
};

const root = buildConfigForm(definition);

/** 按顶层属性名取渲染树节点；测试不关心声明顺序。 */
function node(key: string): ConfigNode {
  const found = root.properties.find((candidate) => candidate.key === key);
  if (found === undefined) {
    throw new Error(`缺少字段 ${key}`);
  }
  return found;
}

const start = (data: JsonObject | null = null) => initialDraft(root, data, definition.defaults);

/** 起手先填好必填的名称，后面的用例只关心各自那一条规则。 */
const ready = () => replaceAt(start(), ['name'], { t: 'text', v: 'ab' });

describe('required 只约束属性存在', () => {
  it('必填字符串允许合法空串，长度不足才报错', () => {
    const built = buildCandidate(root, start());
    expect(built).toMatchObject({ ok: false, errors: { '/name': '至少 2 个字符。' } });
  });

  it('没有长度限制的必填字符串可以保存空串', () => {
    const loose = buildConfigForm({
      ...definition,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: { label: { type: 'string' } },
      },
      defaults: {},
    });
    expect(buildCandidate(loose, initialDraft(loose, null, {}))).toEqual({
      ok: true,
      value: { label: '' },
    });
  });

  it('可选对象整体关掉时，不报它内部必填子项的错', () => {
    const draft = setPresence(ready(), ['options'], node('options'), false);
    expect(buildCandidate(root, draft)).toMatchObject({ ok: true });
  });
});

describe('未设置与合法空值分开', () => {
  it('可选字段未设置时保存结果里没有这个键', () => {
    const built = buildCandidate(root, ready());
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(Object.hasOwn(built.value, 'note')).toBe(false);
    expect(Object.hasOwn(built.value, 'key')).toBe(false);
    expect(Object.hasOwn(built.value, 'ratio')).toBe(false);
  });

  it('显式设置后的空串、false、0、null 都保留', () => {
    let draft = ready();
    draft = setPresence(draft, ['note'], node('note'), true);
    draft = setPresence(draft, ['ratio'], node('ratio'), true);
    draft = replaceAt(draft, ['ratio'], { t: 'number', v: '0' });
    draft = setPresence(draft, ['nothing'], node('nothing'), true);
    draft = setPresence(draft, ['key'], node('key'), true);
    draft = replaceAt(draft, ['key'], { t: 'choice', v: '"asr-key"' });
    draft = replaceAt(draft, ['options', 'enabled'], { t: 'bool', v: false });

    const built = buildCandidate(root, draft);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(built.value['note']).toBe('');
    expect(built.value['ratio']).toBe(0);
    expect(built.value['nothing']).toBeNull();
    expect(built.value['key']).toBe('asr-key');
    expect((built.value['options'] as JsonObject)['enabled']).toBe(false);
  });

  it('清空数组是合法值，不是"未设置"', () => {
    const draft = removeItem(ready(), ['words'], 0);
    expect(draftAt(draft, ['words'])).toEqual({ t: 'array', v: [] });
    // minItems 1 让它不合法，但错误来自条数而不是"缺失"。
    expect(buildCandidate(root, draft)).toMatchObject({
      ok: false,
      errors: { '/words': '至少 1 项。' },
    });
  });
});

describe('数组与枚举', () => {
  it('maxItems 与 uniqueItems 按宿主的语义检查', () => {
    let draft = replaceAt(ready(), ['words', 0], { t: 'text', v: 'same' });
    draft = addItem(root, draft, ['words']);
    draft = replaceAt(draft, ['words', 1], { t: 'text', v: 'same' });
    expect(buildCandidate(root, draft)).toMatchObject({
      ok: false,
      errors: { '/words': '不能有重复项。' },
    });

    draft = replaceAt(draft, ['words', 1], { t: 'text', v: 'other' });
    draft = addItem(root, draft, ['words']);
    draft = replaceAt(draft, ['words', 2], { t: 'text', v: 'third' });
    draft = addItem(root, draft, ['words']);
    draft = replaceAt(draft, ['words', 3], { t: 'text', v: 'fourth' });
    expect(buildCandidate(root, draft)).toMatchObject({
      ok: false,
      errors: { '/words': '最多 3 项。' },
    });
  });

  it('枚举没选时报错，选了就写回原值', () => {
    expect(
      buildCandidate(root, replaceAt(ready(), ['engine'], { t: 'choice', v: '' })),
    ).toMatchObject({ ok: false, errors: { '/engine': '请选择一项。' } });
    const built = buildCandidate(root, replaceAt(ready(), ['engine'], { t: 'choice', v: '"b"' }));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(built.value['engine']).toBe('b');
  });

  it('const 字段不接受编辑，始终写回固定值', () => {
    const built = buildCandidate(root, ready());
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(built.value['mode']).toBe('m2');
    expect(draftAt(ready(), ['mode'])).toEqual({ t: 'const', v: 'm2' });
  });
});

describe('数字与嵌套对象', () => {
  it('整数、越界与非数字各有明确提示', () => {
    const base = ready();
    expect(
      buildCandidate(root, replaceAt(base, ['options', 'threads'], { t: 'number', v: '1.5' })),
    ).toMatchObject({ ok: false, errors: { '/options/threads': '请输入整数。' } });
    expect(
      buildCandidate(root, replaceAt(base, ['options', 'threads'], { t: 'number', v: '9' })),
    ).toMatchObject({ ok: false, errors: { '/options/threads': '不大于 4。' } });
    expect(
      buildCandidate(root, replaceAt(base, ['options', 'threads'], { t: 'number', v: 'x' })),
    ).toMatchObject({ ok: false, errors: { '/options/threads': '请输入数字。' } });
  });

  it('嵌套对象里的错误路径指向具体字段，不是整块', () => {
    const withRatio = setPresence(ready(), ['ratio'], node('ratio'), true);
    const built = buildCandidate(root, replaceAt(withRatio, ['ratio'], { t: 'number', v: '2' }));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('unreachable');
    expect(built.errors['/ratio']).toBe('不大于 1。');
    expect(built.errors['/options']).toBeUndefined();
  });
});

describe('起点：默认值与已有记录', () => {
  it('首次保存使用 defaults，可选但有默认值的顶层字段也要带上', () => {
    const draft = initialDraft(root, null, { engine: 'b', words: ['x'] });
    expect(draftAt(draft, ['engine'])).toEqual({ t: 'choice', v: '"b"' });
    expect(draftAt(draft, ['words'])).toEqual({ t: 'array', v: [{ t: 'text', v: 'x' }] });
    // 名称必填又没有默认值：起点是空串，提交时才报长度不足。
    expect(draftAt(draft, ['name'])).toEqual({ t: 'text', v: '' });
  });

  it('已有记录里缺失的可选项保持缺失，不按 Schema 默认值补回', () => {
    const draft = initialDraft(
      root,
      { name: 'ab', options: { enabled: true, threads: 1 } },
      definition.defaults,
    );
    expect(draftAt(draft, ['options', 'enabled'])).toEqual({ t: 'bool', v: true });
    // engine 有默认值但记录里没有：保持未设置，不偷偷补成默认值。
    const built = buildCandidate(root, draft);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(Object.hasOwn(built.value, 'engine')).toBe(false);
    expect(Object.hasOwn(built.value, 'words')).toBe(false);
  });

  it('已有记录保留真实空值，不会被默认值覆盖', () => {
    const draft = initialDraft(
      root,
      { name: 'ab', engine: 'a', options: { enabled: false, threads: 2 }, words: [], note: '' },
      definition.defaults,
    );
    expect(draftAt(draft, ['note'])).toEqual({ t: 'text', v: '' });
    expect(draftAt(draft, ['words'])).toEqual({ t: 'array', v: [] });
  });
});

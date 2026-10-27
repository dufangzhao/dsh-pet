/**
 * 表单草稿：把受限 Schema 的字段值编成可编辑结构，再编回候选配置。
 *
 * 与宿主 packages/host-kernel/src/config/schema.ts 对齐的几条约定：
 * - required 只约束"属性是否存在"，不约束内容。合法空串、false、0、null、空数组
 *   都是真值，不能和"未设置"混为一谈；可选字段因此带一个显式的"设置此项"开关。
 * - 枚举与 const 按规范化 JSON 文本比较，和宿主的 enum/const 判定一致。
 * - 数字用原始文本保存，输入到一半的 "-" 或 "1." 不会被就地改写。
 */
import type { JsonObject, JsonValue } from '@pet/contracts';

import type { ConfigNode } from './config-schema.js';

export type Draft =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'number'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'null' }
  | { readonly t: 'const'; readonly v: JsonValue }
  /** 枚举候选：v 是选中项的规范化文本，空串表示还没选。 */
  | { readonly t: 'choice'; readonly v: string }
  | { readonly t: 'object'; readonly v: Readonly<Record<string, Draft>> }
  | { readonly t: 'array'; readonly v: readonly Draft[] };

export type DraftPath = readonly (string | number)[];

/** 键是界面路径（如 /options/threads、/words/0），不是 Schema 指针。 */
export type ConfigErrors = Readonly<Record<string, string>>;

export type BuildResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly errors: ConfigErrors };

const REQUIRED = '必填。';
const NOT_A_NUMBER = '请输入数字。';
const NOT_AN_INTEGER = '请输入整数。';
const UNSUPPORTED = '该字段类型暂不支持。';
const UNIQUE = '不能有重复项。';
const CHOOSE = '请选择一项。';

/** 与宿主相同的规范化：对象键排序后序列化，用于 enum/const/uniqueItems 比较。 */
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonical(item)).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
      .join(',') +
    '}'
  );
}

export function pointerOf(path: DraftPath): string {
  return path.length === 0 ? '' : '/' + path.map(String).join('/');
}

/** 按路径取出草稿节点；路径与渲染树同构，取不到说明调用方给错了路径。 */
export function draftAt(draft: Draft, path: DraftPath): Draft {
  let current = draft;
  for (const key of path) {
    if (typeof key === 'number') {
      const item = current.t === 'array' ? current.v[key] : undefined;
      if (item === undefined) {
        throw new Error('草稿路径不存在');
      }
      current = item;
    } else {
      const child = current.t === 'object' ? current.v[key] : undefined;
      if (child === undefined) {
        throw new Error('草稿路径不存在');
      }
      current = child;
    }
  }
  return current;
}

/** 只在路径上重建容器，其余分支保持引用不变。 */
export function replaceAt(draft: Draft, path: DraftPath, next: Draft): Draft {
  if (path.length === 0) {
    return next;
  }
  const head = path[0];
  if (head === undefined) {
    return next;
  }
  const rest = path.slice(1);
  if (typeof head === 'number') {
    if (draft.t !== 'array') {
      throw new Error('草稿路径不匹配');
    }
    return {
      t: 'array',
      v: draft.v.map((item, index) => (index === head ? replaceAt(item, rest, next) : item)),
    };
  }
  if (draft.t !== 'object') {
    throw new Error('草稿路径不匹配');
  }
  const child = draft.v[head];
  if (child === undefined) {
    throw new Error('草稿路径不存在');
  }
  return { t: 'object', v: { ...draft.v, [head]: replaceAt(child, rest, next) } };
}

/** 可选字段开关：插入时按 Schema 播种，移除时整条属性一起消失。 */
export function setPresence(
  draft: Draft,
  path: DraftPath,
  node: ConfigNode,
  present: boolean,
): Draft {
  if (path.length === 0) {
    return draft;
  }
  const parentPath = path.slice(0, -1);
  const key = path.at(-1)!;
  const parent = draftAt(draft, parentPath);
  if (parent.t !== 'object' || typeof key !== 'string') {
    throw new Error('只能切换对象属性的设置状态');
  }
  const next: Record<string, Draft> = { ...parent.v };
  if (present) {
    next[key] = seedDraft(node);
  } else {
    delete next[key];
  }
  return replaceAt(draft, parentPath, { t: 'object', v: next });
}

function seedChildren(node: ConfigNode): Record<string, Draft> {
  const children: Record<string, Draft> = {};
  for (const child of node.properties) {
    if (child.required) {
      children[child.key] = seedDraft(child);
    }
  }
  return children;
}

/** 字段起点：有默认值用默认值，否则给该类型的最小空值。 */
export function seedDraft(node: ConfigNode): Draft {
  if (node.constant !== undefined) {
    return { t: 'const', v: node.constant };
  }
  if (node.choices !== undefined) {
    return { t: 'choice', v: node.defaultValue === undefined ? '' : canonical(node.defaultValue) };
  }
  if (node.defaultValue !== undefined) {
    return fromValue(node, node.defaultValue);
  }
  switch (node.kind) {
    case 'string':
      return { t: 'text', v: '' };
    case 'number':
    case 'integer':
      return { t: 'number', v: '' };
    case 'boolean':
      return { t: 'bool', v: false };
    case 'null':
      return { t: 'null' };
    case 'object':
      return { t: 'object', v: seedChildren(node) };
    case 'array':
      return { t: 'array', v: [] };
    case 'unsupported':
      return { t: 'null' };
  }
}

/** 已有数据 → 草稿。缺失的可选属性保持未设置，缺失的必填属性按 Schema 播种。 */
export function fromValue(node: ConfigNode, value: JsonValue): Draft {
  if (node.constant !== undefined) {
    return { t: 'const', v: node.constant };
  }
  if (node.choices !== undefined) {
    return { t: 'choice', v: canonical(value) };
  }
  switch (node.kind) {
    case 'object': {
      const source =
        value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const entries: Record<string, Draft> = {};
      for (const child of node.properties) {
        const childValue = Object.hasOwn(source, child.key) ? source[child.key] : undefined;
        if (childValue !== undefined) {
          entries[child.key] = fromValue(child, childValue);
        } else if (child.required) {
          entries[child.key] = seedDraft(child);
        }
      }
      return { t: 'object', v: entries };
    }
    case 'array': {
      const item = node.item;
      if (item === null || !Array.isArray(value)) {
        return { t: 'array', v: [] };
      }
      return { t: 'array', v: value.map((entry) => fromValue(item, entry)) };
    }
    case 'string':
      return { t: 'text', v: typeof value === 'string' ? value : '' };
    case 'number':
    case 'integer':
      return { t: 'number', v: typeof value === 'number' ? String(value) : '' };
    case 'boolean':
      return { t: 'bool', v: value === true };
    case 'null':
      return { t: 'null' };
    case 'unsupported':
      return { t: 'null' };
  }
}

/**
 * 表单起点：有记录就用记录，没有记录就用 definition.defaults。
 *
 * 首次保存不能只用"必填字段的空值"起步——定义里可选但有默认值的字段
 * 也应该带上默认值，否则用户第一次填完保存，会和宿主自己 initialize 出的
 * 记录不一致。反过来，已有记录里缺失的可选项一律保持缺失，不按 Schema 补回。
 */
export function initialDraft(
  root: ConfigNode,
  data: JsonObject | null,
  defaults: JsonObject,
): Draft {
  return fromValue(root, data ?? defaults);
}

/** 草稿的稳定文本表示：判断"有没有改动"只需要一次比较。 */
export function draftKey(draft: Draft): string {
  return JSON.stringify(draft);
}

const lengthOf = (value: string): number => [...value].length;

type Built = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false };

function buildArray(
  node: ConfigNode,
  draft: Draft,
  path: DraftPath,
  errors: Record<string, string>,
): JsonValue[] {
  const items = draft.t === 'array' ? draft.v : [];
  const values: JsonValue[] = [];
  let failed = false;
  for (const [index, entry] of items.entries()) {
    const itemPath = [...path, index];
    if (node.item === null) {
      errors[pointerOf(itemPath)] = UNSUPPORTED;
      failed = true;
      continue;
    }
    const built = buildNode(node.item, entry, itemPath, errors);
    if (built.ok) {
      values.push(built.value);
    } else {
      failed = true;
    }
  }
  if (node.minItems !== undefined && items.length < node.minItems) {
    errors[pointerOf(path)] = `至少 ${node.minItems} 项。`;
  } else if (node.maxItems !== undefined && items.length > node.maxItems) {
    errors[pointerOf(path)] = `最多 ${node.maxItems} 项。`;
  } else if (
    node.uniqueItems &&
    !failed &&
    new Set(values.map((value) => canonical(value))).size !== values.length
  ) {
    errors[pointerOf(path)] = UNIQUE;
  }
  return values;
}

function buildNode(
  node: ConfigNode,
  draft: Draft,
  path: DraftPath,
  errors: Record<string, string>,
): Built {
  const pointer = pointerOf(path);
  if (node.constant !== undefined) {
    return { ok: true, value: node.constant };
  }
  if (node.choices !== undefined) {
    const picked =
      draft.t === 'choice'
        ? node.choices.find((choice) => canonical(choice) === draft.v)
        : undefined;
    if (picked === undefined) {
      errors[pointer] = CHOOSE;
      return { ok: false };
    }
    return { ok: true, value: picked };
  }
  switch (node.kind) {
    case 'null':
      return { ok: true, value: null };
    case 'unsupported':
      errors[pointer] = UNSUPPORTED;
      return { ok: false };
    case 'boolean':
      return { ok: true, value: draft.t === 'bool' ? draft.v : false };
    case 'string': {
      const value = draft.t === 'text' ? draft.v : '';
      const length = lengthOf(value);
      if (node.minLength !== undefined && length < node.minLength) {
        errors[pointer] = `至少 ${node.minLength} 个字符。`;
        return { ok: false };
      }
      if (node.maxLength !== undefined && length > node.maxLength) {
        errors[pointer] = `最多 ${node.maxLength} 个字符。`;
        return { ok: false };
      }
      return { ok: true, value };
    }
    case 'number':
    case 'integer': {
      const raw = draft.t === 'number' ? draft.v.trim() : '';
      if (raw === '') {
        errors[pointer] = REQUIRED;
        return { ok: false };
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        errors[pointer] = NOT_A_NUMBER;
        return { ok: false };
      }
      if (node.kind === 'integer' && !Number.isSafeInteger(value)) {
        errors[pointer] = NOT_AN_INTEGER;
        return { ok: false };
      }
      if (node.minimum !== undefined && value < node.minimum) {
        errors[pointer] = `不小于 ${node.minimum}。`;
        return { ok: false };
      }
      if (node.maximum !== undefined && value > node.maximum) {
        errors[pointer] = `不大于 ${node.maximum}。`;
        return { ok: false };
      }
      return { ok: true, value };
    }
    case 'object': {
      const entries = draft.t === 'object' ? draft.v : {};
      const value: JsonObject = {};
      let failed = false;
      for (const child of node.properties) {
        const childDraft = entries[child.key];
        const childPath = [...path, child.key];
        if (childDraft === undefined) {
          if (child.required) {
            errors[pointerOf(childPath)] = REQUIRED;
            failed = true;
          }
          continue;
        }
        const built = buildNode(child, childDraft, childPath, errors);
        if (built.ok) {
          value[child.key] = built.value;
        } else {
          failed = true;
        }
      }
      return failed ? { ok: false } : { ok: true, value };
    }
    case 'array':
      return { ok: true, value: buildArray(node, draft, path, errors) };
  }
}

/** 草稿 → 候选配置。错误一次全部给出，不只报第一条。 */
export function buildCandidate(root: ConfigNode, draft: Draft): BuildResult {
  const errors: Record<string, string> = {};
  const built = buildNode(root, draft, [], errors);
  if (!built.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const value = built.value;
  return {
    ok: true,
    value: value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {},
  };
}

/** 数组增删；路径指向数组本身。 */
export function addItem(root: ConfigNode, draft: Draft, path: DraftPath): Draft {
  const node = nodeAt(root, path);
  const current = draftAt(draft, path);
  if (node.item === null || current.t !== 'array') {
    return draft;
  }
  return replaceAt(draft, path, { t: 'array', v: [...current.v, seedDraft(node.item)] });
}

export function removeItem(draft: Draft, path: DraftPath, index: number): Draft {
  const current = draftAt(draft, path);
  if (current.t !== 'array') {
    return draft;
  }
  return replaceAt(draft, path, {
    t: 'array',
    v: current.v.filter((_, position) => position !== index),
  });
}

/** 按路径取渲染树节点；路径与草稿同构。 */
export function nodeAt(root: ConfigNode, path: DraftPath): ConfigNode {
  let current = root;
  for (const key of path) {
    if (typeof key === 'number') {
      if (current.item === null) {
        throw new Error('渲染树路径越界');
      }
      current = current.item;
    } else {
      const child = current.properties.find((candidate) => candidate.key === key);
      if (child === undefined) {
        throw new Error('渲染树路径不存在');
      }
      current = child;
    }
  }
  return current;
}

/**
 * 受限 Schema → 渲染树。
 *
 * 宿主只接受固定关键字集合（见 packages/host-kernel/src/config/schema.ts），
 * 这里按同一份集合读取，不引入通用 JSON Schema 库：界面要的是"一个字段长什么样"。
 * 生效方式直接取 definition.fields 里已经解析好的值，不重复实现继承。
 */
import type { ConfigApplyMode, ConfigDefinition, JsonObject, JsonValue } from '@pet/contracts';

export type ConfigKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  /** 宿主不会下发；只有定义本身不合约时才走到这里。 */
  | 'unsupported';

export interface ConfigNode {
  readonly kind: ConfigKind;
  readonly key: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly apply: ConfigApplyMode;
  readonly required: boolean;
  /** enum 的候选值；没有 enum 时为 undefined。 */
  readonly choices: readonly JsonValue[] | undefined;
  /** const 的固定值；没有 const 时为 undefined。 */
  readonly constant: JsonValue | undefined;
  readonly credentialRef: boolean;
  readonly minLength: number | undefined;
  readonly maxLength: number | undefined;
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly minItems: number | undefined;
  readonly maxItems: number | undefined;
  readonly uniqueItems: boolean;
  readonly defaultValue: JsonValue | undefined;
  readonly properties: readonly ConfigNode[];
  readonly item: ConfigNode | null;
}

const KINDS: readonly string[] = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
];

function record(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const count = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' ? value : undefined;

/** 把定义读成渲染树；字段顺序沿用插件声明顺序。 */
export function buildConfigForm(definition: ConfigDefinition): ConfigNode {
  const modes = new Map(definition.fields.map((field) => [field.pointer, field.apply]));

  const build = (raw: JsonObject, key: string, pointer: string, required: boolean): ConfigNode => {
    const type = text(raw['type']) ?? '';
    const kind: ConfigKind = KINDS.includes(type) ? (type as ConfigKind) : 'unsupported';
    const properties: ConfigNode[] = [];
    let item: ConfigNode | null = null;

    if (kind === 'object') {
      const declared = new Set(
        Array.isArray(raw['required'])
          ? raw['required'].filter((value): value is string => typeof value === 'string')
          : [],
      );
      for (const [childKey, childRaw] of Object.entries(record(raw['properties']) ?? {})) {
        const child = record(childRaw);
        if (child !== null) {
          properties.push(build(child, childKey, `${pointer}/${childKey}`, declared.has(childKey)));
        }
      }
    } else if (kind === 'array') {
      const child = record(raw['items']);
      // 数组项与数组共用同一个指针：宿主也不为项单列生效方式。
      if (child !== null) {
        item = build(child, key, pointer, true);
      }
    }

    return {
      kind,
      key,
      title: text(raw['title']) ?? key,
      description: text(raw['description']),
      apply: modes.get(pointer) ?? 'reload',
      required,
      choices: Array.isArray(raw['enum']) ? raw['enum'] : undefined,
      constant: raw['const'],
      credentialRef: raw['format'] === 'credential-ref',
      minLength: count(raw['minLength']),
      maxLength: count(raw['maxLength']),
      minimum: count(raw['minimum']),
      maximum: count(raw['maximum']),
      minItems: count(raw['minItems']),
      maxItems: count(raw['maxItems']),
      uniqueItems: raw['uniqueItems'] === true,
      defaultValue: raw['default'],
      properties,
      item,
    };
  };

  return build(definition.schema, '', '', true);
}

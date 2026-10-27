import {
  makeError,
  type ConfigApplyMode,
  type ConfigDefinition,
  type JsonObject,
  type JsonValue,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { freezeJson } from '../runtime/identity.js';
export const CONFIG_MAX_VALUE_BYTES = 48 * 1024;
export type { ConfigField } from '@pet/contracts';
export interface PreparedConfigDefinition extends ConfigDefinition {
  validate(value: unknown): Result<JsonObject>;
  changeMode(before: JsonObject, after: JsonObject): ConfigApplyMode | null;
}
type Kind = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
interface Node {
  type: Kind;
  schema: JsonObject;
  properties: Record<string, Node>;
  item: Node | undefined;
}
const obj = (value: JsonValue | undefined): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const scalar = (value: JsonValue): boolean => value === null || typeof value !== 'object';
const canonical = (value: JsonValue | undefined): string =>
  value === undefined
    ? 'undefined'
    : value === null || typeof value !== 'object'
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? '[' + value.map(canonical).join(',') + ']'
        : '{' +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
            .join(',') +
          '}';
const fail = <T>(): Result<T> => ({ ok: false, error: makeError('invalid-input', false) });
const own = (value: object, key: string) => Object.hasOwn(value, key);
function matches(node: Node, value: JsonValue, annotations = true): boolean {
  const s = node.schema;
  if (annotations) {
    if (own(s, 'const') && canonical(s['const']) !== canonical(value)) return false;
    if (Array.isArray(s['enum']) && !s['enum'].some((v) => canonical(v) === canonical(value)))
      return false;
  }
  switch (node.type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (node.type !== 'integer' || Number.isSafeInteger(value)) &&
        (s['minimum'] === undefined || value >= (s['minimum'] as number)) &&
        (s['maximum'] === undefined || value <= (s['maximum'] as number))
      );
    case 'string': {
      if (typeof value !== 'string') return false;
      const length = [...value].length;
      return length >= ((s['minLength'] as number) ?? 0) && length <= (s['maxLength'] as number);
    }
    case 'array':
      return (
        Array.isArray(value) &&
        value.length >= ((s['minItems'] as number) ?? 0) &&
        value.length <= (s['maxItems'] as number) &&
        value.every((v) => matches(node.item!, v)) &&
        (!s['uniqueItems'] || new Set(value.map(canonical)).size === value.length)
      );
    case 'object': {
      const record = obj(value);
      if (!record) return false;
      return (
        Object.keys(record).every((key) => own(node.properties, key)) &&
        ((s['required'] as string[] | undefined) ?? []).every((key) => own(record, key)) &&
        Object.entries(record).every(([key, val]) => matches(node.properties[key]!, val))
      );
    }
  }
}
export function prepareConfigDefinition(
  input: unknown,
  credentialKeys: readonly string[] = [],
): Result<PreparedConfigDefinition> {
  const checked = jsonPreflight(input);
  if (!checked.ok) return fail();
  const declaration = obj(checked.value);
  if (
    !declaration ||
    Object.keys(declaration).some((k) => !['version', 'schema', 'apply'].includes(k)) ||
    !Number.isSafeInteger(declaration['version']) ||
    (declaration['version'] as number) < 1
  )
    return fail();
  const source = obj(declaration['schema']);
  if (!source || Buffer.byteLength(JSON.stringify(source), 'utf8') > 16384) return fail();
  const modes = obj(declaration['apply']);
  if (declaration['apply'] !== undefined && !modes) return fail();
  let count = 0;
  const nodes = new Map<string, Node>();
  const credentials = new Set(credentialKeys);
  try {
    const build = (raw: JsonObject, pointer: string, depth: number, track = true): Node => {
      if (depth > 8 || ++count > 256) throw new Error('Schema budget');
      const type = raw['type'];
      if (
        typeof type !== 'string' ||
        !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type)
      )
        throw new Error('Unsupported type');
      const allowed = new Set([
        'type',
        'title',
        'description',
        'default',
        'enum',
        'const',
        ...(type === 'object'
          ? ['properties', 'required', 'additionalProperties']
          : type === 'array'
            ? ['items', 'minItems', 'maxItems', 'uniqueItems']
            : type === 'string'
              ? ['minLength', 'maxLength', 'format']
              : type === 'number' || type === 'integer'
                ? ['minimum', 'maximum']
                : []),
      ]);
      if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('Unsupported keyword');
      for (const [key, max] of [
        ['title', 256],
        ['description', 1024],
      ] as const)
        if (raw[key] !== undefined && (typeof raw[key] !== 'string' || [...raw[key]].length > max))
          throw new Error('Invalid annotation');
      const schema: JsonObject = { ...raw };
      const node: Node = {
        type: type as Kind,
        schema,
        properties: Object.create(null) as Record<string, Node>,
        item: undefined,
      };
      if (track && pointer) nodes.set(pointer, node);
      if (
        raw['enum'] !== undefined &&
        (!Array.isArray(raw['enum']) ||
          !raw['enum'].length ||
          raw['enum'].length > 64 ||
          !raw['enum'].every(scalar) ||
          new Set(raw['enum'].map(canonical)).size !== raw['enum'].length)
      )
        throw new Error('Invalid enum');
      if (own(raw, 'const') && !scalar(raw['const']!)) throw new Error('Invalid const');
      const bound = (key: string, max: number, def?: number) => {
        const value = raw[key] ?? def;
        if (value === undefined) return;
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
          throw new Error('Invalid bound');
        schema[key] = value;
      };
      if (type === 'object') {
        if (raw['additionalProperties'] !== false) throw new Error('Object must be closed');
        const properties = raw['properties'] === undefined ? {} : obj(raw['properties']);
        if (!properties || Object.keys(properties).length > 64)
          throw new Error('Invalid properties');
        const normalized: JsonObject = {};
        for (const [key, value] of Object.entries(properties)) {
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key)) throw new Error('Invalid field');
          const child = obj(value);
          if (!child) throw new Error('Invalid field schema');
          if (
            child['type'] === 'string' &&
            /^(apikey|password|accesstoken|clientsecret|secret|authorization)$/.test(
              key.replace(/[_-]/g, '').toLowerCase(),
            ) &&
            child['format'] !== 'credential-ref'
          )
            throw new Error('Secret fields require broker references');
          const built = build(child, pointer + '/' + key, depth + 1, track);
          node.properties[key] = built;
          normalized[key] = built.schema;
        }
        schema['properties'] = normalized;
        if (
          raw['required'] !== undefined &&
          (!Array.isArray(raw['required']) ||
            raw['required'].some((k) => typeof k !== 'string' || !own(properties, k)) ||
            new Set(raw['required']).size !== raw['required'].length)
        )
          throw new Error('Invalid required');
      } else if (type === 'array') {
        const item = obj(raw['items']);
        if (!item) throw new Error('Array items required');
        node.item = build(item, '', depth + 1, false);
        schema['items'] = node.item.schema;
        bound('minItems', 256);
        bound('maxItems', 256, 256);
        if (((schema['minItems'] as number) ?? 0) > (schema['maxItems'] as number))
          throw new Error('Invalid item range');
        if (raw['uniqueItems'] !== undefined && typeof raw['uniqueItems'] !== 'boolean')
          throw new Error('Invalid uniqueness');
      } else if (type === 'string') {
        bound('minLength', 4096);
        bound('maxLength', 4096, 4096);
        if (((schema['minLength'] as number) ?? 0) > (schema['maxLength'] as number))
          throw new Error('Invalid length');
        if (raw['format'] !== undefined) {
          if (
            raw['format'] !== 'credential-ref' ||
            !Array.isArray(raw['enum']) ||
            !raw['enum'].every((id) => typeof id === 'string' && credentials.has(id))
          )
            throw new Error('Invalid credential reference');
        }
      } else if (type === 'integer' || type === 'number') {
        for (const key of ['minimum', 'maximum'])
          if (
            raw[key] !== undefined &&
            (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))
          )
            throw new Error('Invalid numeric bound');
        if (type === 'integer') {
          schema['minimum'] = Math.max(
            -Number.MAX_SAFE_INTEGER,
            (raw['minimum'] as number) ?? -Number.MAX_SAFE_INTEGER,
          );
          schema['maximum'] = Math.min(
            Number.MAX_SAFE_INTEGER,
            (raw['maximum'] as number) ?? Number.MAX_SAFE_INTEGER,
          );
        }
        if (
          schema['minimum'] !== undefined &&
          schema['maximum'] !== undefined &&
          (schema['minimum'] as number) > (schema['maximum'] as number)
        )
          throw new Error('Invalid numeric range');
      }
      if (own(raw, 'default') && !matches(node, raw['default']!))
        throw new Error('Invalid default');
      return node;
    };
    const root = build(source, '', 0);
    if (root.type !== 'object') return fail();
    const explicit = new Map<string, ConfigApplyMode>();
    for (const [key, value] of Object.entries(modes ?? {})) {
      const pointer = key.startsWith('/') ? key : '/' + key;
      if (
        !nodes.has(pointer) ||
        typeof value !== 'string' ||
        !['immediate', 'reload', 'restart'].includes(value) ||
        explicit.has(pointer)
      )
        return fail();
      explicit.set(pointer, value as ConfigApplyMode);
    }
    const mode = (pointer: string): ConfigApplyMode => {
      for (let path = pointer; path; path = path.slice(0, path.lastIndexOf('/'))) {
        const found = explicit.get(path);
        if (found) return found;
      }
      return 'reload';
    };
    const fields = freezeJson(
      [...nodes].map(([pointer, node]) => ({ pointer, type: node.type, apply: mode(pointer) })),
    );
    const defaults: JsonObject = {};
    for (const [key, node] of Object.entries(root.properties))
      if (own(node.schema, 'default')) defaults[key] = structuredClone(node.schema['default']!);
    const changedModes = (
      node: Node,
      before: JsonValue | undefined,
      after: JsonValue | undefined,
      pointer: string,
    ): ConfigApplyMode[] => {
      if (canonical(before) === canonical(after)) return [];
      const left = obj(before),
        right = obj(after);
      if (node.type === 'object' && left && right)
        return Object.entries(node.properties).flatMap(([key, child]) =>
          changedModes(child, left[key], right[key], pointer + '/' + key),
        );
      return [pointer ? mode(pointer) : 'reload'];
    };
    const validate = (value: unknown): Result<JsonObject> => {
      const safe = jsonPreflight(value);
      if (
        !safe.ok ||
        !obj(safe.value) ||
        Buffer.byteLength(JSON.stringify(safe.value), 'utf8') > CONFIG_MAX_VALUE_BYTES ||
        !matches(root, safe.value)
      )
        return fail();
      return { ok: true, value: freezeJson(safe.value as JsonObject) };
    };
    return {
      ok: true,
      value: Object.freeze({
        version: declaration['version'] as number,
        schema: freezeJson(root.schema),
        defaults: freezeJson(defaults),
        fields,
        validate,
        changeMode: (before: JsonObject, after: JsonObject): ConfigApplyMode | null => {
          if (canonical(before) === canonical(after)) return null;
          const selected = changedModes(root, before, after, '');
          return selected.includes('restart')
            ? 'restart'
            : selected.includes('reload')
              ? 'reload'
              : 'immediate';
        },
      }),
    };
  } catch {
    return fail();
  }
}

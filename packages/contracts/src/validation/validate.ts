/**
 * Host-side validation entry (`@pet/contracts/validation`).
 *
 * Three stages, always in this order:
 *   1. JSON preflight — no getters, no cycles, budgets, dangerous keys.
 *   2. JSON Schema — shape, closed objects, patterns, ranges.
 *   3. Semantics — uniqueness, cross references, SemVer compatibility, budgets.
 *
 * Every failure is a fixed `KernelError`; the failing value never appears in a
 * message. Nothing here performs I/O, network access or entry execution.
 */

import semver from 'semver';
import { types } from 'node:util';
import type { KernelError, Result } from '../errors.js';
import { makeError } from '../errors.js';
import type { JsonValue } from '../json.js';
import type { ControlMessage } from '../control.js';
import { CONTROL_MAX_MESSAGE_BYTES } from '../control.js';
import type { MediaFrame, StreamHeader } from '../media.js';
import type { PluginManifest, PlatformTarget } from '../manifest.js';
import { PLATFORM_TARGETS } from '../manifest.js';
import { SEMVER_PATTERN } from '../patterns.js';
import { jsonPreflight, utf8ByteLength, type JsonPreflightCode } from './json-preflight.js';
import { contractValidators } from './registry.js';
import {
  SemanticFailure,
  assertOnlyKeys,
  assertSafeSchemaTree,
  assertUnique,
  type SemanticCode,
} from './semantic.js';

export type { JsonPreflightCode } from './json-preflight.js';
export { jsonPreflight, utf8ByteLength, JSON_PREFLIGHT_CODES } from './json-preflight.js';
export type { SemanticCode } from './semantic.js';
export { SemanticFailure, isRecord } from './semantic.js';

export interface CompatibilityTarget {
  hostApiVersion: string;
  platform: PlatformTarget;
}

const CONFIG_SCHEMA_FORBIDDEN_KEYS = [
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
  'contentSchema',
] as const;

const MANIFEST_KEYS = [
  'schemaVersion',
  'id',
  'version',
  'displayName',
  'description',
  'license',
  'host',
  'platforms',
  'entries',
  'provides',
  'consumes',
  'contributes',
  'config',
  'permissions',
  'resources',
] as const;

function preflightError(code: JsonPreflightCode): KernelError {
  switch (code) {
    case 'circular':
    case 'accessor':
    case 'function':
    case 'symbol':
    case 'bigint':
    case 'undefined':
    case 'non-finite-number':
    case 'dangerous-key':
    case 'unsupported-object':
    case 'depth-exceeded':
    case 'keys-exceeded':
    case 'bytes-exceeded':
      return makeError('invalid-input', false);
    case 'not-json':
    default:
      return makeError('invalid-input', false);
  }
}

function schemaError(): KernelError {
  return makeError('invalid-input', false);
}

function semanticError(code: SemanticCode): KernelError {
  return code === 'incompatible-host' ||
    code === 'unsupported-platform' ||
    code === 'prerelease-host'
    ? makeError('not-ready', false)
    : makeError('invalid-input', false);
}

/** Run preflight + Schema + semantics and map every failure onto a fixed error. */
function validateWith<T>(
  input: unknown,
  run: (value: unknown) => T,
  options: { maxBytes?: number } = {},
): Result<T> {
  const preflight = jsonPreflight(input);
  if (!preflight.ok) return { ok: false, error: preflightError(preflight.code) };
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && utf8ByteLength(JSON.stringify(preflight.value)) > maxBytes) {
    return { ok: false, error: schemaError() };
  }
  try {
    return { ok: true, value: run(preflight.value) };
  } catch (error) {
    if (error instanceof SemanticFailure) {
      return { ok: false, error: semanticError(error.code) };
    }
    return { ok: false, error: makeError('invalid-input', false) };
  }
}

/** Shape gate shared by every Schema-backed validator. */
function assertSchema(valid: boolean): void {
  if (!valid) throw new SemanticFailure('shape');
}

export function validateManifest(input: unknown): Result<PluginManifest> {
  return validateWith(input, (value) => {
    const { manifest } = contractValidators();
    assertSchema(manifest(value));

    const record = value as Record<string, unknown>;
    assertOnlyKeys(record, MANIFEST_KEYS);
    const manifestValue = value as PluginManifest;

    const providerIds: string[] = [];
    for (const provider of manifestValue.provides ?? []) {
      providerIds.push(provider.id);
      assertOnlyKeys(provider as unknown as Record<string, unknown>, [
        'id',
        'capability',
        'features',
      ]);
    }
    assertUnique(providerIds, 'duplicate-id');

    const consumed: string[] = [];
    for (const consumption of manifestValue.consumes ?? []) {
      consumed.push(consumption.capability);
      assertOnlyKeys(consumption as unknown as Record<string, unknown>, [
        'capability',
        'optional',
        'features',
      ]);
    }
    assertUnique(consumed, 'duplicate-capability');

    const contributionIds: string[] = [];
    const commandIds = new Set<string>();
    for (const contribution of manifestValue.contributes ?? []) {
      contributionIds.push(contribution.id);
      if (contribution.kind === 'command') commandIds.add(contribution.id);
    }
    assertUnique(contributionIds, 'duplicate-id');
    // Buttons and hotkeys may only reference a command declared in this manifest;
    // a command's own `handler` is a plugin-local handler name, not a reference.
    for (const contribution of manifestValue.contributes ?? []) {
      if (contribution.kind === 'shortcut-button' || contribution.kind === 'hotkey') {
        if (!commandIds.has(contribution.command)) {
          throw new SemanticFailure('unknown-command');
        }
      }
    }

    const workerIds = Object.keys(manifestValue.entries.workers ?? {});
    for (const permission of manifestValue.permissions ?? []) {
      if (permission.kind === 'process') {
        for (const worker of permission.workers) {
          if (!workerIds.includes(worker)) throw new SemanticFailure('unknown-worker');
        }
      }
      if (permission.kind === 'network') {
        assertUnique(permission.origins, 'duplicate-origin');
      }
      if (permission.kind === 'credentials') {
        assertUnique(permission.keys, 'duplicate-id');
      }
    }

    const resourceIds: string[] = [];
    for (const resource of manifestValue.resources ?? []) {
      resourceIds.push(resource.id);
      assertOnlyKeys(resource as unknown as Record<string, unknown>, [
        'id',
        'url',
        'bytes',
        'sha256',
        'license',
        'shared',
      ]);
    }
    assertUnique(resourceIds, 'duplicate-id');

    if (manifestValue.config !== undefined) {
      assertOnlyKeys(manifestValue.config as unknown as Record<string, unknown>, [
        'version',
        'schema',
        'apply',
      ]);
      assertSafeSchemaTree(manifestValue.config.schema as JsonValue, CONFIG_SCHEMA_FORBIDDEN_KEYS, [
        'javascript:',
      ]);
      assertLocalRefs(manifestValue.config.schema as JsonValue);
    }

    return manifestValue;
  });
}

function assertLocalRefs(value: JsonValue): void {
  const stack: JsonValue[] = [value];
  while (stack.length > 0) {
    const current = stack.pop() as JsonValue;
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === '$ref') {
        if (typeof item !== 'string' || !item.startsWith('#/')) {
          throw new SemanticFailure('unsafe-config-schema');
        }
      }
      stack.push(item);
    }
  }
}

/** Host/API compatibility. Shape problems are `invalid-input`; a mismatch is `not-ready`. */
export function checkCompatibility(
  manifest: PluginManifest,
  target: CompatibilityTarget,
): Result<null> {
  const validated = validateManifest(manifest);
  if (!validated.ok) return { ok: false, error: validated.error };

  const version = validated.value.version;
  const range = validated.value.host;
  if (!new RegExp(SEMVER_PATTERN).test(version) || semver.valid(version) === null) {
    return { ok: false, error: makeError('invalid-input', false) };
  }
  const parsedRange = semver.validRange(range);
  if (parsedRange === null) return { ok: false, error: makeError('invalid-input', false) };

  // The host API version is strict too: `semver.valid` alone would accept a
  // `v`-prefixed or whitespace-padded string.
  const hostApiVersion = target.hostApiVersion;
  if (
    typeof hostApiVersion !== 'string' ||
    !new RegExp(SEMVER_PATTERN).test(hostApiVersion) ||
    semver.valid(hostApiVersion) === null
  ) {
    return { ok: false, error: makeError('invalid-input', false) };
  }
  if (!(PLATFORM_TARGETS as readonly string[]).includes(target.platform)) {
    return { ok: false, error: makeError('invalid-input', false) };
  }

  // A pre-release host is never treated as stable-compatible by default, which
  // is exactly what `includePrerelease: false` enforces.
  if (!semver.satisfies(hostApiVersion, parsedRange, { includePrerelease: false })) {
    return { ok: false, error: makeError('not-ready', false) };
  }

  if (!validated.value.platforms.includes(target.platform)) {
    return { ok: false, error: makeError('not-ready', false) };
  }
  return { ok: true, value: null };
}

export function validateControlMessage(input: unknown): Result<ControlMessage> {
  return validateWith(
    input,
    (value) => {
      const { controlMessage } = contractValidators();
      assertSchema(controlMessage(value));
      const message = value as ControlMessage;
      if (message.type === 'response') {
        const result = message.result;
        if (result.ok === false) assertErrorConsistent(result.error);
      }
      if (message.type === 'stream-end' && message.error !== undefined) {
        assertErrorConsistent(message.error);
      }
      return message;
    },
    { maxBytes: CONTROL_MAX_MESSAGE_BYTES },
  );
}

function assertErrorConsistent(error: { code: string; messageKey: string }): void {
  if (error.messageKey !== `errors.${error.code}`) throw new SemanticFailure('unknown-field');
}

export function validateStreamHeader(input: unknown): Result<StreamHeader> {
  return validateWith(input, (value) => {
    const { streamHeader } = contractValidators();
    assertSchema(streamHeader(value));
    return value as StreamHeader;
  });
}

/** Media is not JSON: inspect descriptors and native typed-array slots, then own a copy. */
export function validateMediaFrame(input: unknown): Result<MediaFrame> {
  const invalid = (): Result<MediaFrame> => ({
    ok: false,
    error: makeError('invalid-input', false),
  });
  try {
    if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input))
      return invalid();
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return invalid();
    if (
      Object.getOwnPropertySymbols(input).length ||
      Object.getOwnPropertyNames(input).sort().join(',') !== 'header,payload'
    )
      return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const h = descriptors['header'],
      p = descriptors['payload'];
    if (!h || !p || !('value' in h) || !('value' in p) || !h.enumerable || !p.enumerable)
      return invalid();
    const header = validateStreamHeader(h.value);
    if (!header.ok) return { ok: false, error: header.error };
    const payload: unknown = p.value;
    if (!types.isUint8Array(payload) || types.isProxy(payload)) return invalid();
    const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const backing: unknown = Object.getOwnPropertyDescriptor(typed, 'buffer')?.get?.call(payload);
    const offset: unknown = Object.getOwnPropertyDescriptor(typed, 'byteOffset')?.get?.call(
      payload,
    );
    const length: unknown = Object.getOwnPropertyDescriptor(typed, 'byteLength')?.get?.call(
      payload,
    );
    if (
      !types.isArrayBuffer(backing) ||
      typeof offset !== 'number' ||
      length !== header.value.byteLength
    )
      return invalid();
    const source = new Uint8Array(backing, offset, header.value.byteLength);
    const owned = new Uint8Array(header.value.byteLength);
    owned.set(source);
    return { ok: true, value: { header: header.value, payload: owned } };
  } catch {
    return invalid();
  }
}

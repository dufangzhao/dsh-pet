import type { JsonObject, ResponsesConnectionSettings } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import type { ModelConnectionDescription } from './model-connection-types.js';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const hasControl = (text: string): boolean =>
  [...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function record(value: unknown, keys: readonly string[]): JsonObject {
  const checked = jsonPreflight(value);
  if (
    !checked.ok ||
    checked.value === null ||
    typeof checked.value !== 'object' ||
    Array.isArray(checked.value) ||
    Object.keys(checked.value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new KernelFault('invalid-input');
  return checked.value;
}

/** The fixed Responses settings boundary, shared by the plugin and the public projection. */
export function parseResponsesConnectionSettings(value: unknown): ResponsesConnectionSettings {
  const config = record(value, ['baseUrl', 'model', 'authMode']);
  const baseUrl = config['baseUrl'];
  const model = config['model'];
  const authMode = config['authMode'];
  if (
    typeof baseUrl !== 'string' ||
    !baseUrl ||
    baseUrl.length > 2048 ||
    hasControl(baseUrl) ||
    typeof model !== 'string' ||
    model.length > 128 ||
    hasControl(model) ||
    model !== model.trim() ||
    (authMode !== 'local-client-id' && authMode !== 'gateway-key')
  )
    throw new KernelFault('invalid-input');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new KernelFault('invalid-input');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname))) ||
    (authMode === 'local-client-id' && !loopback.has(url.hostname))
  )
    throw new KernelFault('invalid-input');
  const normalized = url.href.replace(/\/+$/, '');
  if (normalized.length > 2048) throw new KernelFault('invalid-input');
  return { baseUrl: normalized, model, authMode };
}

/** A projector is plugin code; no object or extra member it returned is a browser DTO. */
export function validateModelConnectionDescription(value: unknown): ModelConnectionDescription {
  const description = record(value, [
    'label',
    'synthetic',
    'settings',
    'model',
    'credentialRequired',
    'credentialWritable',
  ]);
  const label = description['label'];
  const synthetic = description['synthetic'];
  const model = description['model'];
  const required = description['credentialRequired'];
  const writable = description['credentialWritable'];
  if (
    typeof label !== 'string' ||
    !label ||
    label.length > 80 ||
    hasControl(label) ||
    typeof synthetic !== 'boolean' ||
    typeof required !== 'boolean' ||
    typeof writable !== 'boolean' ||
    (!required && writable) ||
    (model !== null &&
      (typeof model !== 'string' || !model || model.length > 128 || hasControl(model)))
  )
    throw new KernelFault('invalid-input');
  const settings =
    description['settings'] === null
      ? null
      : parseResponsesConnectionSettings(description['settings']);
  if (
    settings &&
    ((settings.model || null) !== model || required !== (settings.authMode === 'gateway-key'))
  )
    throw new KernelFault('invalid-input');
  return {
    label,
    synthetic,
    settings,
    model,
    credentialRequired: required,
    credentialWritable: writable,
  };
}

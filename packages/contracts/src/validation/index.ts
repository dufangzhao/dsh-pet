/**
 * `@pet/contracts/validation` — the host-side validation entry.
 *
 * Importing this subpath pulls in Ajv and semver; the browser-safe root entry
 * deliberately does not. No I/O, no network, no code generation of plugin
 * entries happens here.
 */

export {
  checkCompatibility,
  validateControlMessage,
  validateManifest,
  validateMediaFrame,
  validateStreamHeader,
  JSON_PREFLIGHT_CODES,
  SemanticFailure,
  isRecord,
  jsonPreflight,
  utf8ByteLength,
} from './validate.js';

export type { CompatibilityTarget, JsonPreflightCode, SemanticCode } from './validate.js';

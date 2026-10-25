/**
 * Every regular-expression source used by a contract Schema.
 *
 * Patterns are exported as strings so the same source feeds both the JSON
 * Schema data (root entry, no runtime dependency) and the RegExp checks in
 * `@pet/contracts/validation`.
 *
 * All patterns reject CR/LF explicitly: JavaScript `$` also matches before a
 * trailing newline, which would otherwise let `"abc\n"` pass a whole-string
 * pattern.
 */

import { KERNEL_ERROR_CODES } from './errors.js';
import { LOCAL_ID_MAX_LENGTH, PLUGIN_ID_MAX_LENGTH } from './ids.js';

/** No CR or LF anywhere in the value. */
const NO_NEWLINE = '(?![\\s\\S]*[\\r\\n])';

export const PLUGIN_ID_PATTERN =
  '^' +
  NO_NEWLINE +
  '(?=.{1,' +
  PLUGIN_ID_MAX_LENGTH +
  '}$)' +
  '[a-z](?:[a-z0-9]|[-.](?=[a-z0-9]))*$';

export const LOCAL_ID_PATTERN =
  '^' +
  NO_NEWLINE +
  '(?!__proto__$)(?!prototype$)(?!constructor$)' +
  '(?=.{1,' +
  LOCAL_ID_MAX_LENGTH +
  '}$)' +
  '[A-Za-z0-9][A-Za-z0-9._-]*$';

/** `domain.name@major`: lowercase-led segments, at least one dot, positive major. */
export const CAPABILITY_ID_PATTERN =
  '^' + NO_NEWLINE + '[a-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9]+)+@[1-9][0-9]{0,9}$';

/** Simplified BCP 47: a 2-3 letter primary subtag plus optional 2-8 char subtags. */
export const BCP47_LANGUAGE_PATTERN = '^' + NO_NEWLINE + '[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$';

/** Full SemVer 2.0.0, anchored; a `v` prefix or surrounding space cannot match. */
export const SEMVER_PATTERN =
  '^' +
  NO_NEWLINE +
  '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)' +
  '(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)' +
  '(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?' +
  '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';

/** Lexical pre-filter for a SemVer range; semantics are checked with semver. */
export const SEMVER_RANGE_PATTERN = '^' + NO_NEWLINE + '[0-9A-Za-z.*+^~<>=|() -]+$';

/** Windows reserved device names, spelled without a case-insensitive flag. */
const RESERVED_DEVICE =
  '(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll][Ll]?|[Cc][Oo][Mm][0-9]|[Ll][Pp][Tt][0-9])';

/** Package-relative path: forward slashes, no absolute/drive/ADS/backslash/empty segment. */
export const RELATIVE_PATH_PATTERN =
  '^' +
  NO_NEWLINE +
  '(?!/)' + // no absolute path
  '(?!.*\\\\)' + // no backslash
  '(?!.*//)' + // no empty segment
  '(?!.*/$)' + // no trailing slash: a directory is not an entry
  '(?!.*(?:^|/)\\.{1,2}(?:/|$))' + // no . or .. segment
  '(?!.*[ .](?:/|$))' + // no trailing dot or space on a segment
  '(?!.*(?:^|/)' +
  RESERVED_DEVICE +
  '(?:\\.[^/]*)?(?:/|$))' + // no reserved device name
  '(?!.*:)' + // no drive letter, ADS or scheme
  '.+$';

/** Canonical HTTPS origin: lowercase, no default port, no userinfo/path/query/fragment. */
export const HTTPS_ORIGIN_PATTERN =
  '^' +
  NO_NEWLINE +
  'https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?' +
  '(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*' +
  '(?::(?!443$)[1-9][0-9]{0,4})?$'; // 443 is the default port and must be omitted

/** HTTPS URL: no whitespace, no userinfo in the authority, no fragment. */
export const HTTPS_URL_PATTERN = '^' + NO_NEWLINE + 'https://[^\\s/?#@]+(?:[/?][^\\s#]*)?$';

export const SHA256_HEX_PATTERN = '^' + NO_NEWLINE + '[0-9a-f]{64}$';

export const ERROR_MESSAGE_KEY_PATTERN =
  '^' + NO_NEWLINE + 'errors\\.' + '(?:' + KERNEL_ERROR_CODES.join('|') + ')$';

/**
 * Compilation of the frozen contract Schemas with Ajv.
 *
 * Ajv is constructed once, lazily, from Schema *data* exported by the root
 * entry. `strict: true` and `allowUnionTypes: false` keep the Schemas honest;
 * unknown keywords and overlapping `oneOf` branches fail loudly at compile time
 * instead of silently accepting a document.
 */

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import {
  CONTRACT_SCHEMA_DEFS_ID,
  CONTRACT_SCHEMA_DIALECT,
  PLUGIN_MANIFEST_SCHEMA,
} from '../manifest.js';
import { PERMISSION_DECLARATION_SCHEMA } from '../permission.js';
import { CONTRIBUTION_DECLARATION_SCHEMA } from '../contribution.js';
import { RESOURCE_DECLARATION_SCHEMA } from '../resource.js';
import { STREAM_HEADER_SCHEMA } from '../media.js';
import { CONTROL_MESSAGE_SCHEMA } from '../control.js';
import { KERNEL_ERROR_SCHEMA, OWNER_REF_SCHEMA } from '../shared-schemas.js';

export interface CompiledContractSchemas {
  manifest: ValidateFunction;
  controlMessage: ValidateFunction;
  streamHeader: ValidateFunction;
}

interface Registry {
  ajv: Ajv2020;
  validators: CompiledContractSchemas;
}

let registry: Registry | null = null;

function build(): Registry {
  // Ajv2020 registers the draft 2020-12 meta-schema, which every contract
  // Schema declares; the default `Ajv` entry only knows draft-07.
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: false,
    validateFormats: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    $data: false,
  });

  ajv.addSchema(
    {
      $id: CONTRACT_SCHEMA_DEFS_ID,
      $schema: CONTRACT_SCHEMA_DIALECT,
      $defs: {
        permission: PERMISSION_DECLARATION_SCHEMA,
        contribution: CONTRIBUTION_DECLARATION_SCHEMA,
        resource: RESOURCE_DECLARATION_SCHEMA,
        kernelError: KERNEL_ERROR_SCHEMA,
        ownerRef: OWNER_REF_SCHEMA,
      },
    },
    CONTRACT_SCHEMA_DEFS_ID,
  );

  const manifest = ajv.compile(PLUGIN_MANIFEST_SCHEMA);
  const controlMessage = ajv.compile(CONTROL_MESSAGE_SCHEMA);
  const streamHeader = ajv.compile(STREAM_HEADER_SCHEMA);

  return { ajv, validators: { manifest, controlMessage, streamHeader } };
}

/** Compiled validators, created on first use and reused afterwards. */
export function contractValidators(): CompiledContractSchemas {
  registry ??= build();
  return registry.validators;
}

/** Escape hatch for tests that need the underlying instance (never re-exported from the root). */
export function contractAjv(): Ajv2020 {
  registry ??= build();
  return registry.ajv;
}

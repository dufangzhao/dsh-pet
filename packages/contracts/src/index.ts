/**
 * `@pet/contracts` root entry.
 *
 * Browser-safe by construction: this entry exports only types, pure constants,
 * fixed error copy and JSON Schema *data*. It must never import Node, Electron,
 * Ajv or semver, and must not run code generation on import — the executable
 * validators live in `@pet/contracts/validation`.
 *
 * The M0 prototype bridge (`pet-prototype.ts`) is re-exported unchanged.
 */

export * from './pet-prototype.js';

export * from './json.js';
export * from './ids.js';
export * from './errors.js';
export * from './patterns.js';
export * from './shared-schemas.js';
export * from './manifest.js';
export * from './permission.js';
export * from './contribution.js';
export * from './resource.js';
export * from './lifecycle.js';
export * from './capability.js';
export * from './task.js';
export * from './media.js';
export * from './control.js';
export * from './host-status.js';
export * from './console.js';
export * from './config.js';
export * from './security.js';
export * from './local-asr.js';
export * from './demo.js';

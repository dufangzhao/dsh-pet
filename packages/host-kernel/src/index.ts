/** Host-only authorities. These objects must never be returned through a plugin SDK. */
export * from './credentials/index.js';
export type * from './runtime/types.js';
export * from './runtime/cordis-driver.js';
export * from './runtime/plugin-manager.js';
export * from './runtime/discovery.js';
export * from './runtime/capability-registry.js';
export type { InstanceIdentity } from './runtime/identity.js';

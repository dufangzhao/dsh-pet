/**
 * Read-only host status bridge (M1-04 follow-up contract).
 *
 * The main process owns the host state; a renderer may only ask for one snapshot
 * over one fixed channel. The bridge stays deliberately narrow: a version and a
 * parameterless `getStatus`. There is no generic send/invoke, no path, no
 * credential and no configuration surface.
 *
 * Browser safe by construction: this module exports types, pure constants and
 * Schema *data* only. It imports no Node, Electron, Ajv or semver module and
 * compiles nothing on import. This module adds no executable status validator;
 * consumers validate the data at their trusted boundary when needed.
 */

import type { JsonSchema } from './json.js';
import type { Result } from './errors.js';

/** The one read-only channel the host status bridge is allowed to use. */
export const HOST_IPC = {
  status: 'host:v1:status',
} as const;

/** Runtime lifecycle states the host is allowed to report. */
export const HOST_RUNTIME_STATES = ['starting', 'ready', 'failed', 'stopped'] as const;

export type HostRuntimeState = (typeof HOST_RUNTIME_STATES)[number];

/**
 * One immutable snapshot of host state.
 *
 * Every counter is a non-negative safe integer; the host owns the values and a
 * renderer never contributes to them.
 */
export interface HostStatus {
  version: 1;
  runtime: HostRuntimeState;
  installedPlugins: number;
  activePlugins: number;
  unreadyPlugins: number;
  pendingRestartPlugins: number;
  runningTasks: number;
  pendingWork: number;
}

/** Read-only, parameterless view of host state. Carries no path, key or config. */
export interface HostStatusBridge {
  readonly version: 1;
  getStatus(): Promise<Result<HostStatus>>;
}

const COUNT_SCHEMA: JsonSchema = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};

/** Plain JSON Schema data: closed object, fixed version, no dynamic code. */
export const HOST_STATUS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'runtime',
    'installedPlugins',
    'activePlugins',
    'unreadyPlugins',
    'pendingRestartPlugins',
    'runningTasks',
    'pendingWork',
  ],
  properties: {
    version: { const: 1 },
    runtime: { enum: [...HOST_RUNTIME_STATES] },
    installedPlugins: COUNT_SCHEMA,
    activePlugins: COUNT_SCHEMA,
    unreadyPlugins: COUNT_SCHEMA,
    pendingRestartPlugins: COUNT_SCHEMA,
    runningTasks: COUNT_SCHEMA,
    pendingWork: COUNT_SCHEMA,
  },
};

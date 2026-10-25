/**
 * Identifier vocabulary shared by manifests, owners, tasks and streams.
 *
 * The identifiers are plain string aliases on purpose: the runtime validators
 * in `@pet/contracts/validation` are the authority, and branding them would
 * force every manifest reader to cast.
 */

export type PluginId = string;
export type LocalId = string;
export type CapabilityId = string;

/** Upper bound for {@link PluginId}, in UTF-16 code units. */
export const PLUGIN_ID_MAX_LENGTH = 128;

/** Upper bound for {@link LocalId}, in UTF-16 code units. */
export const LOCAL_ID_MAX_LENGTH = 128;

/** Highest value accepted for `OwnerRef.generation`. */
export const OWNER_GENERATION_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Host-assigned channel identity. The host binds it to the transport; a payload
 * carrying an `OwnerRef` is never itself an authorization credential.
 */
export interface OwnerRef {
  pluginId: PluginId;
  instanceId: LocalId;
  generation: number;
}

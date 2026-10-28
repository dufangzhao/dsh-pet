import type { PluginHostServices } from '@pet/plugin-sdk';
import type {
  ContributionDeclaration,
  JsonObject,
  JsonValue,
  OwnerRef,
  PluginManifest,
} from '@pet/contracts';
export interface RegisteredContribution {
  readonly owner: Readonly<OwnerRef>;
  readonly id: string;
  readonly declaration: Readonly<ContributionDeclaration>;
}

export type Disposer = () => void | Promise<void>;
export interface CapabilityCallContext {
  readonly taskId: string;
  readonly signal: AbortSignal;
  readonly deadline?: number;
}
export type CapabilityMethod = (
  context: CapabilityCallContext,
  input: JsonValue,
) => Promise<JsonValue>;
export type CapabilityMethods = Readonly<Record<string, CapabilityMethod>>;
export interface ActivationRegistrar {
  provide(providerId: string, methods: CapabilityMethods): void;
  contribute(contributionId: string, handler?: CapabilityMethod): void;
}
export interface PluginRuntimeContext extends ActivationRegistrar {
  readonly dataDirectory?: string;
  readonly host?: PluginHostServices;
  readonly owner: Readonly<OwnerRef>;
  readonly signal: AbortSignal;
  readonly config: Readonly<JsonObject>;
  effect(create: () => Disposer): void;
}
export interface PluginModule {
  migrateConfig?(request: {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly data: Readonly<JsonObject>;
    readonly signal: AbortSignal;
  }): Promise<JsonObject>;
  activate(context: PluginRuntimeContext): void | Disposer | Promise<void | Disposer>;
}
export interface RuntimeActivation {
  readonly dataDirectory?: string;
  readonly host?: PluginHostServices;
  readonly owner: Readonly<OwnerRef>;
  readonly manifest: PluginManifest;
  readonly entryPath: string;
  readonly config: JsonObject;
  readonly signal: AbortSignal;
}
export interface RuntimeSession {
  readonly ready: Promise<void>;
  stop(): Promise<void>;
}
export interface RuntimeDriver {
  start(activation: RuntimeActivation, registrar: ActivationRegistrar): RuntimeSession;
}
export type PluginLoader = (activation: RuntimeActivation) => Promise<PluginModule>;

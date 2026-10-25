import {
  makeError,
  type CapabilityBinding,
  type CapabilityId,
  type JsonObject,
  type OwnerRef,
  type ProviderDeclaration,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { types } from 'node:util';
import type { CapabilityMethod, CapabilityMethods } from './types.js';
import {
  featureSubset,
  freezeJson,
  instanceKey,
  sameOwner,
  type InstanceIdentity,
} from './identity.js';
export interface ProviderSelector extends InstanceIdentity {
  readonly providerId: string;
}
export interface ProviderMetadata {
  readonly owner: OwnerRef;
  readonly declaration: ProviderDeclaration;
}
interface ProviderRecord extends ProviderMetadata {
  readonly methods: CapabilityMethods;
}
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function providerKey(value: ProviderSelector): string {
  return JSON.stringify([value.pluginId, value.instanceId, value.providerId]);
}
function selectionKey(value: InstanceIdentity, capability: string): string {
  return JSON.stringify([value.pluginId, value.instanceId, capability]);
}

/** Host-only registry. SDK consumers receive RPC facades, never the returned method references. */
export class CapabilityRegistry {
  readonly #providers = new Map<string, ProviderRecord>();
  readonly #selections = new Map<string, ProviderSelector>();
  readonly #bindings = new WeakSet<object>();
  constructor(
    private readonly active: (owner: OwnerRef) => boolean,
    private readonly generationLive: (owner: OwnerRef) => boolean = active,
  ) {}
  private live(owner: OwnerRef): boolean {
    try {
      return this.active(owner) === true;
    } catch {
      return false;
    }
  }

  register(owner: OwnerRef, declaration: ProviderDeclaration, methods: CapabilityMethods): void {
    const key = providerKey({ ...owner, providerId: declaration.id });
    if (this.#providers.has(key)) throw new Error('Duplicate provider');
    if (
      !methods ||
      typeof methods !== 'object' ||
      types.isProxy(methods) ||
      Object.getOwnPropertySymbols(methods).length
    )
      throw new Error('Invalid method table');
    const names = Object.getOwnPropertyNames(methods);
    if (!names.length || names.length > 64) throw new Error('Invalid method table');
    const copy: Record<string, CapabilityMethod> = Object.create(null) as Record<
      string,
      CapabilityMethod
    >;
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(methods, name);
      if (
        !idPattern.test(name) ||
        forbidden.has(name) ||
        !d ||
        !('value' in d) ||
        typeof d.value !== 'function'
      )
        throw new Error('Invalid method table');
      copy[name] = d.value as CapabilityMethod;
    }
    const checked = jsonPreflight(declaration);
    if (!checked.ok) throw new Error('Invalid provider declaration');
    this.#providers.set(key, {
      owner: Object.freeze({ ...owner }),
      declaration: freezeJson(checked.value as unknown as ProviderDeclaration),
      methods: Object.freeze(copy),
    });
  }
  unregister(owner: OwnerRef): void {
    for (const [key, value] of this.#providers)
      if (sameOwner(value.owner, owner)) this.#providers.delete(key);
  }
  select(
    consumer: InstanceIdentity,
    capability: CapabilityId,
    provider: ProviderSelector | null,
  ): void {
    const key = selectionKey(consumer, capability);
    if (provider) this.#selections.set(key, Object.freeze({ ...provider }));
    else this.#selections.delete(key);
  }
  resolveSelection(
    consumer: InstanceIdentity,
    capability: CapabilityId,
    required?: JsonObject,
  ): Result<ProviderMetadata> {
    const selector = this.#selections.get(selectionKey(consumer, capability));
    if (!selector) return { ok: false, error: makeError('not-ready') };
    const record = this.#providers.get(providerKey(selector));
    if (
      !record ||
      record.declaration.capability !== capability ||
      !this.live(record.owner) ||
      !featureSubset(required, record.declaration.features)
    )
      return { ok: false, error: makeError('not-ready') };
    return {
      ok: true,
      value: freezeJson(structuredClone({ owner: record.owner, declaration: record.declaration })),
    };
  }
  bind(
    consumer: OwnerRef,
    capability: CapabilityId,
    required?: JsonObject,
  ): Result<CapabilityBinding> {
    if (!this.live(consumer)) return { ok: false, error: makeError('stale-owner') };
    const selected = this.resolveSelection(consumer, capability, required);
    if (!selected.ok) return selected;
    const binding = freezeJson({
      capability,
      consumer: { ...consumer },
      provider: { ...selected.value.owner },
      providerId: selected.value.declaration.id,
    });
    this.#bindings.add(binding);
    return { ok: true, value: binding };
  }
  resolveBound(binding: CapabilityBinding, method: string): Result<CapabilityMethod> {
    if (!binding || typeof binding !== 'object' || !this.#bindings.has(binding))
      return { ok: false, error: makeError('invalid-input', false) };
    try {
      if (!this.generationLive(binding.consumer) || !this.generationLive(binding.provider))
        return { ok: false, error: makeError('stale-owner') };
    } catch {
      return { ok: false, error: makeError('stale-owner') };
    }
    const record = this.#providers.get(
      providerKey({ ...binding.provider, providerId: binding.providerId }),
    );
    if (
      !record ||
      !sameOwner(record.owner, binding.provider) ||
      record.declaration.capability !== binding.capability
    )
      return { ok: false, error: makeError('stale-owner') };
    const handler = record.methods[method];
    return handler
      ? { ok: true, value: handler }
      : { ok: false, error: makeError('invalid-input', false) };
  }
  list(capability?: CapabilityId): readonly ProviderMetadata[] {
    return [...this.#providers.values()]
      .filter(
        (value) =>
          this.live(value.owner) && (!capability || value.declaration.capability === capability),
      )
      .map((value) =>
        freezeJson(structuredClone({ owner: value.owner, declaration: value.declaration })),
      );
  }
  forgetConsumer(consumer: InstanceIdentity): void {
    for (const [key] of this.#selections) {
      const value = JSON.parse(key) as [string, string, string];
      if (instanceKey(consumer) === instanceKey({ pluginId: value[0], instanceId: value[1] }))
        this.#selections.delete(key);
    }
  }
}

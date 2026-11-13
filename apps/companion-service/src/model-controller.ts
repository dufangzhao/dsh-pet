import { randomUUID } from 'node:crypto';
import {
  makeError,
  type CompanionModelBindingView,
  type CompanionModelCheckView,
  type CompanionModelCommandResult,
  type CompanionModelConnectorView,
  type CompanionModelCredentialCommand,
  type CompanionModelSaveCommand,
  type CompanionModelTestCommand,
  type CompanionModelView,
  type JsonObject,
  type KernelError,
  type OwnerRef,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { CredentialError, KernelFault, SecretRedactor } from '@pet/host-kernel';
import {
  COMPANION_HOST_ID,
  MAGPIE_CONNECTION,
  ModelConnections,
  emptyModelCheck,
  validateModelConnectionDescription,
  parseResponsesConnectionSettings,
  type AuthorizedResponseTransport,
  type CompanionPluginHost,
  type CompanionRuntime,
  type ModelConnectionDescription,
  type ModelConnectionRegistration,
  type ResponseClient,
} from '@pet/companion-runtime';
import { createAuthorizedModelClient } from './model-client.js';
import { isNativeProtocolError } from './native-provider.mjs';

const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function body(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  const checked = jsonPreflight(value);
  if (
    !checked.ok ||
    checked.value === null ||
    typeof checked.value !== 'object' ||
    Array.isArray(checked.value)
  )
    throw new KernelFault('invalid-input');
  const record = checked.value;
  if (
    !required.every((key) => Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new KernelFault('invalid-input');
  return record;
}
function problem(error: unknown): KernelError {
  if (error instanceof KernelFault) return error.error;
  if (error instanceof CredentialError) return makeError(error.code, false);
  if (isNativeProtocolError(error)) return makeError('unavailable', false);
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  return makeError(
    status === 401 || status === 403
      ? 'auth-failed'
      : status === 429
        ? 'rate-limited'
        : status === 400 || status === 404
          ? 'unavailable'
          : 'network',
  );
}
interface CredentialSlot {
  target: string;
  version: string;
  value: string | undefined;
  source: 'none' | 'environment' | 'memory';
}

export class ModelConnectionController {
  readonly connections: ModelConnections;
  private readonly processGeneration = randomUUID();
  private readonly slots = new Map<string, CredentialSlot>();
  private readonly redactor = new SecretRedactor();
  private appliedKey: string | null = null;
  private appliedCredentialVersion: string | null = null;
  private check: CompanionModelCheckView = emptyModelCheck(false);
  private error: KernelError | null = null;
  private checking: Promise<void> | undefined;
  private checkAbort: AbortController | undefined;
  private closed = false;

  constructor(
    readonly host: CompanionPluginHost,
    readonly runtime: CompanionRuntime,
    registrations: readonly ModelConnectionRegistration[],
    participationTransport?: (owner: OwnerRef, baseUrl: string) => AuthorizedResponseTransport,
  ) {
    this.connections = new ModelConnections(host, registrations, (owner, baseUrl) => {
      const key = this.connections
        .list()
        .find(([, registration]) => registration.manifest.id === owner.pluginId)?.[0];
      if (!key) throw new KernelFault('not-ready');
      if (this.connections.purpose(key) === 'qq-participation') {
        if (!participationTransport) throw new KernelFault('not-ready');
        return participationTransport(owner, baseUrl);
      }
      const slot = this.slots.get(key);
      if (!slot) throw new KernelFault('not-ready');
      const auth = JSON.parse(slot.target) as [string, string | null, string | null];
      if (auth[1] !== baseUrl) throw new KernelFault('permission-denied');
      const apiKey = auth[2] === 'local-client-id' ? 'magpie-dsh-pet' : slot.value;
      if (!apiKey) throw new KernelFault('not-ready');
      const providerFactory = this.connections.registration(key).connection.nativeProvider;
      return createAuthorizedModelClient(host, owner.pluginId, {
        baseUrl,
        apiKey,
        ...(providerFactory ? { providerFactory } : {}),
      });
    });
  }

  private version(): string {
    return `${this.processGeneration}:${randomUUID()}`;
  }

  private slot(key: string, description: ModelConnectionDescription): CredentialSlot {
    const target = JSON.stringify([
      key,
      description.settings?.baseUrl ?? null,
      description.settings?.authMode ?? null,
    ]);
    let slot = this.slots.get(key);
    if (!slot || slot.target !== target) {
      slot = { target, version: this.version(), value: undefined, source: 'none' };
      this.slots.set(key, slot);
    }
    return slot;
  }

  private async configured(key: string): Promise<{
    config: JsonObject;
    revision: number;
    description: ModelConnectionDescription;
    slot: CredentialSlot;
  }> {
    const registration = this.connections.registration(key);
    if (this.connections.purpose(key) !== 'foreground') throw new KernelFault('invalid-input');
    if (!this.host.verifySource(registration.manifest.id)) throw new KernelFault('package-changed');
    const snapshot = await this.host.configs.get(identity(registration.manifest.id));
    if (!snapshot.ok) throw new KernelFault(snapshot.error.code);
    const description = validateModelConnectionDescription(
      registration.connection.describeConfig(snapshot.value.data),
    );
    if (this.redactor.contains(JSON.stringify(description))) throw new KernelFault('invalid-input');
    const slot = this.slot(key, description);
    return { config: snapshot.value.data, revision: snapshot.value.revision, description, slot };
  }

  private async desired(): Promise<{
    connectorId: string;
    mode: 'scripted' | 'model';
    profileRevision: number;
    data: JsonObject;
  }> {
    const profile = await this.runtime.profile();
    const selected = profile.data['modelConnection'];
    const mode = profile.data['modelMode'];
    return {
      connectorId: typeof selected === 'string' ? selected : MAGPIE_CONNECTION,
      mode: mode === 'model' || mode === 'scripted' ? mode : this.runtime.options.mode,
      profileRevision: profile.revision,
      data: profile.data,
    };
  }

  async seedEnvironment(key: string, apiKey: string, baseUrl: string): Promise<void> {
    const current = await this.configured(key);
    const target = parseResponsesConnectionSettings({
      baseUrl,
      model: current.description.model ?? '',
      authMode: 'gateway-key',
    });
    if (
      !current.description.credentialRequired ||
      current.description.settings?.baseUrl !== target.baseUrl
    )
      throw new KernelFault('invalid-input');
    this.validateKey(apiKey);
    this.redactor.add(apiKey);
    current.slot.value = apiKey;
    current.slot.source = 'environment';
    current.slot.version = this.version();
  }

  private validateKey(value: unknown): asserts value is string {
    if (
      typeof value !== 'string' ||
      !value ||
      Buffer.byteLength(value) > 4096 ||
      Buffer.from(value, 'utf8').toString('utf8') !== value ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new KernelFault('invalid-input');
  }

  private retireCredential(key: string): void {
    const slot = this.slots.get(key);
    if (slot) {
      slot.value = undefined;
      slot.source = 'none';
      slot.version = this.version();
    }
  }

  isChecking(): boolean {
    return this.checking !== undefined;
  }

  async initialize(): Promise<void> {
    const desired = await this.desired();
    this.connections.select(desired.connectorId);
    try {
      await this.activateConnection(desired.connectorId);
      if (desired.mode === 'scripted' && !this.appliedKey) this.error = null;
    } catch (error) {
      this.error = problem(error);
    }
  }

  private async activateConnection(key: string): Promise<void> {
    const current = await this.configured(key);
    if (
      !current.description.model ||
      (current.description.credentialRequired && !current.slot.value)
    ) {
      this.error = makeError('not-ready');
      return;
    }
    // Retain the attempted owner even on activation failure: pending_restart blocks replacement.
    this.appliedKey = key;
    await this.connections.enable(key);
    if (!this.connections.binding(key)) throw new KernelFault('not-ready');
    this.appliedCredentialVersion = current.slot.version;
    this.error = null;
  }

  private async retire(): Promise<void> {
    await this.runtime.retireForeground();
    if (this.appliedKey) await this.connections.disable(this.appliedKey);
    this.appliedKey = null;
    this.appliedCredentialVersion = null;
  }

  private async activate(): Promise<void> {
    const desired = await this.desired();
    this.connections.select(desired.connectorId);
    await this.activateConnection(desired.connectorId);
    if (desired.mode === 'scripted' || this.appliedKey) await this.runtime.activateForeground();
    if (desired.mode === 'scripted' && !this.appliedKey) this.error = null;
    this.runtime.notify();
  }

  async foreground(
    owner: Parameters<ModelConnections['clientFor']>[0],
  ): Promise<{ mode: 'scripted' | 'model'; model?: string; client?: ResponseClient }> {
    const desired = await this.desired();
    if (desired.mode === 'scripted') return { mode: 'scripted' };
    const current = await this.configured(desired.connectorId);
    const binding = this.connections.binding(desired.connectorId);
    if (
      !binding ||
      binding.revision !== current.revision ||
      this.appliedCredentialVersion !== current.slot.version
    )
      throw new KernelFault('not-ready');
    return { mode: 'model', model: binding.model, client: this.connections.clientFor(owner) };
  }

  async view(): Promise<CompanionModelView> {
    const desired = await this.desired();
    const connectors: CompanionModelConnectorView[] = [];
    let selected: Awaited<ReturnType<ModelConnectionController['configured']>> | undefined;
    let sourceError: KernelError | null = null;
    for (const [key, registration] of this.connections.list('foreground')) {
      try {
        const current = await this.configured(key);
        if (key === desired.connectorId) selected = current;
        const { description, slot } = current;
        const noSecret = !description.credentialRequired;
        connectors.push({
          id: key,
          label: description.label,
          synthetic: description.synthetic,
          configRevision: current.revision,
          settings: description.settings,
          model: description.model,
          credential: {
            required: description.credentialRequired,
            available: noSecret || Boolean(slot.value),
            source: noSecret
              ? description.settings?.authMode === 'local-client-id'
                ? 'local-client-id'
                : 'not-required'
              : slot.source,
            version: slot.version,
            writable: description.credentialWritable,
          },
        });
      } catch (error) {
        if (key === desired.connectorId) sourceError = problem(error);
        let slot = this.slots.get(key);
        if (!slot) {
          slot = { target: '', version: this.version(), value: undefined, source: 'none' };
          this.slots.set(key, slot);
        }
        connectors.push({
          id: key,
          label: (registration.manifest.displayName['en'] ?? registration.manifest.id).slice(0, 80),
          synthetic: false,
          configRevision: 0,
          settings: null,
          model: null,
          credential: {
            required: true,
            available: false,
            source: 'none',
            version: slot.version,
            writable: false,
          },
        });
      }
    }
    const binding = this.connections.binding(desired.connectorId);
    const policy = selected
      ? this.host.permissionControl.inspect(
          identity(this.connections.registration(desired.connectorId).manifest.id),
        )
      : null;
    const allowed = !sourceError && policy && !policy.blocked && policy.preset !== 'deny';
    const applied: CompanionModelBindingView | null =
      allowed &&
      selected &&
      binding &&
      binding.revision === selected.revision &&
      this.appliedKey === desired.connectorId &&
      this.appliedCredentialVersion === selected.slot.version
        ? {
            connectorId: desired.connectorId,
            configRevision: binding.revision,
            credentialVersion: selected.slot.version,
          }
        : null;
    if (
      !this.checking &&
      this.check.binding &&
      (!selected ||
        this.check.binding.connectorId !== desired.connectorId ||
        this.check.binding.configRevision !== selected.revision ||
        this.check.binding.credentialVersion !== selected.slot.version ||
        (this.check.state === 'verified' && !applied))
    )
      this.check = emptyModelCheck(Boolean(selected?.description.model));
    if (!this.check.commandId) this.check = emptyModelCheck(Boolean(selected?.description.model));
    return {
      profileRevision: desired.profileRevision,
      desired: { mode: desired.mode, connectorId: desired.connectorId },
      applied,
      enabled: Boolean(applied && desired.mode === 'model' && this.runtime.isModelEnabled()),
      connectors,
      check: this.check,
      error:
        sourceError ??
        (policy && (policy.blocked || policy.preset === 'deny')
          ? makeError('permission-denied')
          : this.error) ??
        (desired.mode === 'model' && !applied ? makeError('not-ready') : null),
    };
  }

  async save(input: unknown): Promise<CompanionModelCommandResult> {
    const record = body(
      input,
      ['commandId', 'expectedProfileRevision', 'connectorId', 'expectedConfigRevision', 'mode'],
      ['config'],
    );
    if (
      !id(record['commandId']) ||
      typeof record['connectorId'] !== 'string' ||
      !revision(record['expectedProfileRevision']) ||
      !revision(record['expectedConfigRevision']) ||
      !['scripted', 'model'].includes(String(record['mode']))
    )
      throw new KernelFault('invalid-input');
    const command = record as unknown as CompanionModelSaveCommand;
    return this.runtime.withModelControl(async () => {
      let applicationChanged = false;
      try {
        const desired = await this.desired();
        const current = await this.configured(command.connectorId);
        let config = command.config ?? current.config;
        const registration = this.connections.registration(command.connectorId);
        const description = validateModelConnectionDescription(
          registration.connection.describeConfig(config),
        );
        if (description.settings) config = { ...config, ...description.settings };
        if (this.redactor.contains(JSON.stringify(config)))
          throw new KernelFault('permission-denied');
        const definition = this.host.configs.definition(identity(registration.manifest.id));
        if (!definition?.validate(config).ok) throw new KernelFault('invalid-input');
        const lookup = {
          commandId: command.commandId,
          kind: 'model.save',
          payload: record as JsonObject,
        };
        const known = await this.runtime.state('getCommand', lookup);
        if (
          !known &&
          (current.revision !== command.expectedConfigRevision ||
            desired.profileRevision !== command.expectedProfileRevision)
        )
          throw new KernelFault('conflict');
        if (
          known &&
          !equal(config, current.config) &&
          current.revision !== command.expectedConfigRevision
        )
          throw new KernelFault('conflict');
        const desiredMatches =
          desired.connectorId === command.connectorId && desired.mode === command.mode;
        if (known && !desiredMatches && desired.profileRevision !== command.expectedProfileRevision)
          throw new KernelFault('conflict');
        const receipt = known ?? (await this.runtime.state('recordCommand', lookup));
        if (!equal(config, current.config)) {
          const saved = await this.host.configs.save(
            identity(registration.manifest.id),
            config,
            current.revision,
          );
          if (!saved.ok) throw new KernelFault(saved.error.code);
          applicationChanged =
            desired.connectorId === command.connectorId &&
            saved.value.snapshot.revision !== current.revision;
        }
        if (!desiredMatches) {
          const saved = await this.host.configs.save(
            identity(COMPANION_HOST_ID),
            { ...desired.data, modelConnection: command.connectorId, modelMode: command.mode },
            desired.profileRevision,
          );
          if (!saved.ok) throw new KernelFault(saved.error.code);
          applicationChanged = true;
        }
        this.check = emptyModelCheck(Boolean(description.model));
        applicationChanged = true;
        // Once the new selection commits, retire its predecessor's key before cleanup can fail.
        // Broker-owned native work remains tracked and physically drained by retire().
        if (desired.connectorId !== command.connectorId) {
          this.retireCredential(desired.connectorId);
          this.connections.invalidate(desired.connectorId);
        }
        await this.retire();
        await this.activate();
        return { receipt, view: await this.view() };
      } catch (error) {
        if (applicationChanged) this.error = problem(error);
        throw error;
      }
    });
  }

  async credential(input: unknown): Promise<CompanionModelView> {
    const record = body(input, [
      'connectorId',
      'expectedConfigRevision',
      'expectedCredentialVersion',
      'apiKey',
    ]);
    if (
      typeof record['connectorId'] !== 'string' ||
      !revision(record['expectedConfigRevision']) ||
      typeof record['expectedCredentialVersion'] !== 'string' ||
      record['expectedCredentialVersion'].length > 128
    )
      throw new KernelFault('invalid-input');
    const command = record as unknown as CompanionModelCredentialCommand;
    if (command.apiKey !== null) this.validateKey(command.apiKey);
    return this.runtime.withModelControl(async () => {
      let applicationChanged = false;
      try {
        const desired = await this.desired();
        const current = await this.configured(command.connectorId);
        if (
          desired.connectorId !== command.connectorId ||
          current.revision !== command.expectedConfigRevision ||
          current.slot.version !== command.expectedCredentialVersion
        )
          throw new KernelFault('conflict');
        if (!current.description.credentialWritable) throw new KernelFault('permission-denied');
        applicationChanged = true;
        await this.retire();
        if (command.apiKey !== null) this.redactor.add(command.apiKey);
        current.slot.value = command.apiKey ?? undefined;
        current.slot.source = command.apiKey === null ? 'none' : 'memory';
        current.slot.version = this.version();
        this.check = emptyModelCheck(Boolean(current.description.model));
        await this.activate();
        return this.view();
      } catch (error) {
        if (applicationChanged) this.error = problem(error);
        throw error;
      }
    });
  }

  async test(input: unknown): Promise<CompanionModelCommandResult> {
    const record = body(input, [
      'commandId',
      'connectorId',
      'expectedConfigRevision',
      'expectedCredentialVersion',
    ]);
    if (
      !id(record['commandId']) ||
      typeof record['connectorId'] !== 'string' ||
      !revision(record['expectedConfigRevision']) ||
      typeof record['expectedCredentialVersion'] !== 'string' ||
      record['expectedCredentialVersion'].length > 128
    )
      throw new KernelFault('invalid-input');
    const command = record as unknown as CompanionModelTestCommand;
    const lookup = {
      commandId: command.commandId,
      kind: 'model.test',
      payload: record as JsonObject,
    };
    // A duplicate receipt never admits I/O, even after restart or while its first use is pending.
    const known = await this.runtime.state('getCommand', lookup);
    if (known) return { receipt: known, view: await this.view() };
    return this.runtime.withModelControl(async () => {
      const target = this.connections.registration(command.connectorId);
      if (!this.host.verifySource(target.manifest.id)) throw new KernelFault('package-changed');
      const policy = this.host.permissionControl.inspect(identity(target.manifest.id));
      if (policy?.blocked || policy?.preset === 'deny') throw new KernelFault('permission-denied');
      const view = await this.view();
      const binding = view.applied;
      if (
        command.connectorId !== view.desired.connectorId ||
        !binding ||
        command.expectedConfigRevision !== binding.configRevision ||
        command.expectedCredentialVersion !== binding.credentialVersion
      )
        throw new KernelFault(binding ? 'conflict' : 'not-ready');
      const current = await this.configured(command.connectorId);
      if (!current.description.model) throw new KernelFault('not-ready');
      const client = this.connections.clientFor(this.host.owner());
      const receipt = await this.runtime.state('recordCommand', lookup);
      // The atomic insertion is authoritative even if a pre-lock lookup observed absence.
      if (receipt.status === 'duplicate') return { receipt, view: await this.view() };
      this.checkAbort = new AbortController();
      const timeout = AbortSignal.timeout(15000);
      const signal = AbortSignal.any([timeout, this.checkAbort.signal]);
      const started = performance.now();
      this.check = {
        state: 'validating',
        commandId: command.commandId,
        binding,
        startedAt: Date.now(),
        checkedAt: null,
        elapsedMs: null,
        evidence: null,
        error: null,
      };
      const work = (async () => {
        let error: KernelError | null = null;
        try {
          const generation = await client.respond(
            {
              model: current.description.model ?? '',
              input: [{ type: 'message', role: 'user', content: 'Reply with OK.' }],
              max_output_tokens: 256,
            },
            { signal, diagnostic: true, role: 'probe', onEvent: () => {} },
          );
          if (
            generation.response.status !== 'completed' ||
            !generation.response.output.some(
              (item) =>
                item.type === 'message' &&
                item.role === 'assistant' &&
                item.content.some((part) => part.type === 'output_text' && part.text.trim()),
            )
          )
            throw new KernelFault('unavailable');
        } catch (cause) {
          const policy = this.host.permissionControl.inspect(
            identity(this.connections.registration(command.connectorId).manifest.id),
          );
          error = !this.host.verifySource(
            this.connections.registration(command.connectorId).manifest.id,
          )
            ? makeError('package-changed')
            : policy?.blocked || policy?.preset === 'deny'
              ? makeError('permission-denied')
              : timeout.aborted
                ? makeError('timeout')
                : this.checkAbort?.signal.aborted
                  ? makeError('cancelled')
                  : problem(cause);
        }
        if (this.check.commandId === command.commandId && equal(this.check.binding, binding))
          this.check = {
            ...this.check,
            state: error ? 'failed' : 'verified',
            error,
            checkedAt: Date.now(),
            elapsedMs: Math.round(performance.now() - started),
            evidence: current.description.synthetic ? 'synthetic' : 'network',
          };
      })();
      this.checking = work;
      void work.then(() => {
        if (this.checking === work) {
          this.checking = undefined;
          this.checkAbort = undefined;
        }
        this.runtime.notify();
      });
      this.runtime.notify();
      return { receipt, view: await this.view() };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.checkAbort?.abort();
    await this.checking;
    for (const slot of this.slots.values()) slot.value = undefined;
    this.redactor.clear();
  }
}

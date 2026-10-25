import { createHash, randomUUID } from 'node:crypto';
import {
  makeError,
  LOCAL_ID_PATTERN,
  type KernelErrorCode,
  type OwnerRef,
  type PermissionDeclaration,
  type PluginManifest,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { freezeJson, instanceKey, sameOwner, type InstanceIdentity } from '../runtime/identity.js';
import { ownerFrom } from '../runtime/worker-protocol.js';
import { configIdentity } from '../config/store.js';
import { PermissionAudit, type AuditEntry, type AuditSource, type AuditEvent } from './audit.js';
import {
  normalizePermission,
  permissionSubset,
  presetDecision,
  PERMISSION_PRESETS,
  type PermissionPreset,
} from './policy.js';
export interface PermissionLease {
  readonly signal: AbortSignal;
  isValid(): boolean;
  close(): void;
}
export interface ApprovalPrompt {
  readonly requestId: string;
  readonly owner: OwnerRef;
  readonly taskId: string;
  readonly permission: PermissionDeclaration;
  readonly permissionDigest: string;
  readonly policyEpoch: number;
}
export interface ApprovalDecision {
  requestId: string;
  owner: OwnerRef;
  taskId: string;
  permissionDigest: string;
  approved: boolean;
}
export interface ApprovalChannel {
  request(prompt: ApprovalPrompt, signal: AbortSignal): Promise<ApprovalDecision>;
}
export interface PermissionHost {
  fingerprint(identity: InstanceIdentity): string | null;
  describe(owner: OwnerRef): { manifest: PluginManifest; digest: string } | null;
  isLive(owner: OwnerRef): boolean;
  ownerSignal(owner: OwnerRef): AbortSignal | null;
  taskSignal(taskId: string, requester: OwnerRef): AbortSignal | null;
}
export interface PermissionOptions {
  host: PermissionHost;
  approval?: ApprovalChannel;
  audit?: PermissionAudit;
  approvalTimeoutMs?: number;
}
export interface PermissionClient {
  run<T>(
    taskId: string,
    permission: unknown,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Result<T>>;
}
export interface PermissionService {
  isTrusted(identity: InstanceIdentity, digest: string): boolean;
  authorize(
    owner: OwnerRef,
    taskId: string,
    permission: unknown,
    signal?: AbortSignal,
  ): Promise<Result<PermissionLease>>;
  run<T>(
    owner: OwnerRef,
    taskId: string,
    permission: unknown,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Result<T>>;
  issueClient(owner: OwnerRef): PermissionClient;
  close(): void;
  diagnostics(): { pending: number; leases: number; closed: boolean };
}
export interface PermissionControl {
  confirmTrust(identity: InstanceIdentity, digest: string, approved: boolean): boolean;
  setPreset(identity: InstanceIdentity, preset: PermissionPreset): boolean;
  revoke(identity: InstanceIdentity): boolean;
  resume(identity: InstanceIdentity): boolean;
  snapshotAudit(offset?: number, limit?: number): ReturnType<PermissionAudit['snapshot']>;
}
interface Policy {
  epoch: number;
  preset: PermissionPreset;
  blocked: boolean;
}
interface Active {
  identity: InstanceIdentity;
  controller: AbortController;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = <T>(code: KernelErrorCode): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const coreOwner: OwnerRef = { pluginId: 'core.permissions', instanceId: 'host', generation: 1 };
class PermissionEngine {
  readonly #policies = new Map<string, Policy>();
  readonly #trusted = new Map<string, string>();
  readonly #active = new Set<Active>();
  readonly #audit: PermissionAudit;
  readonly #lifetime = new AbortController();
  readonly #leases = new WeakMap<
    PermissionLease,
    { prompt: ApprovalPrompt; source: AuditSource }
  >();
  #pending = 0;
  #askWork = 0;
  #operations = 0;
  #leaseCount = 0;
  #closed = false;
  readonly #timeout: number;
  constructor(private readonly options: PermissionOptions) {
    this.#audit = options.audit ?? new PermissionAudit();
    this.#timeout = options.approvalTimeoutMs ?? 30000;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 60000)
      throw new Error('Invalid approval timeout');
  }
  private policy(identity: InstanceIdentity): Policy {
    const key = instanceKey(identity);
    let policy = this.#policies.get(key);
    if (!policy) {
      if (this.#policies.size >= 1024) throw new Error('Permission policy limit');
      policy = { epoch: 1, preset: 'ask', blocked: false };
      this.#policies.set(key, policy);
    }
    return policy;
  }
  private invalidate(identity: InstanceIdentity): void {
    this.policy(identity).epoch++;
    for (const active of [...this.#active])
      if (instanceKey(active.identity) === instanceKey(identity)) active.controller.abort();
  }
  isTrusted(identity: InstanceIdentity, value: string): boolean {
    const id = configIdentity(identity);
    if (this.#closed || !id || typeof value !== 'string') return false;
    try {
      return (
        this.#trusted.get(instanceKey(id)) === value && this.options.host.fingerprint(id) === value
      );
    } catch {
      return false;
    }
  }
  control(): PermissionControl {
    return Object.freeze({
      confirmTrust: (identity: InstanceIdentity, value: string, approved: boolean) => {
        const id = configIdentity(identity);
        if (
          this.#closed ||
          !id ||
          typeof value !== 'string' ||
          !/^[0-9a-f]{64}$/.test(value) ||
          typeof approved !== 'boolean'
        )
          return false;
        if (approved) {
          try {
            if (this.options.host.fingerprint(id) !== value) return false;
          } catch {
            return false;
          }
        }
        this.invalidate(id);
        if (approved) this.#trusted.set(instanceKey(id), value);
        else this.#trusted.delete(instanceKey(id));
        return true;
      },
      setPreset: (identity: InstanceIdentity, preset: PermissionPreset) => {
        const id = configIdentity(identity);
        if (this.#closed || !id || !PERMISSION_PRESETS.includes(preset)) return false;
        this.invalidate(id);
        const policy = this.policy(id);
        policy.preset = preset;
        policy.blocked = false;
        return true;
      },
      revoke: (identity: InstanceIdentity) => {
        const id = configIdentity(identity);
        if (this.#closed || !id) return false;
        this.invalidate(id);
        this.policy(id).blocked = true;
        return true;
      },
      resume: (identity: InstanceIdentity) => {
        const id = configIdentity(identity);
        if (this.#closed || !id) return false;
        this.invalidate(id);
        this.policy(id).blocked = false;
        return true;
      },
      snapshotAudit: (offset?: number, limit?: number) => this.#audit.snapshot(offset, limit),
    });
  }
  private declares(manifest: PluginManifest, permission: PermissionDeclaration): boolean {
    try {
      const safe = jsonPreflight(manifest.permissions);
      if (!safe.ok || !Array.isArray(safe.value)) return false;
      const declarations = safe.value.map(normalizePermission);
      return (
        declarations.every((value) => value !== null) &&
        declarations.some((value) => value !== null && permissionSubset(permission, value))
      );
    } catch {
      return false;
    }
  }
  private audit(
    prompt: ApprovalPrompt,
    event: AuditEvent,
    source: AuditSource,
    errorCode?: KernelErrorCode,
  ): boolean {
    try {
      const entry: AuditEntry = {
        id: prompt.requestId,
        at: Date.now(),
        owner: prompt.owner,
        taskId: prompt.taskId,
        kind: prompt.permission.kind,
        targetHash: prompt.permissionDigest,
        event,
        source,
        ...(errorCode ? { errorCode } : {}),
      };
      this.#audit.append(entry);
      return true;
    } catch {
      return false;
    }
  }
  async authorize(
    rawOwner: OwnerRef,
    taskId: string,
    input: unknown,
    extraSignal?: AbortSignal,
  ): Promise<Result<PermissionLease>> {
    const owner = ownerFrom(rawOwner),
      permission = normalizePermission(input);
    const safeTask =
      typeof taskId === 'string' &&
      new RegExp(LOCAL_ID_PATTERN).test(taskId) &&
      !['constructor', 'prototype', '__proto__'].includes(taskId)
        ? taskId
        : 'invalid';
    const identity = owner
      ? { pluginId: owner.pluginId, instanceId: owner.instanceId }
      : { pluginId: coreOwner.pluginId, instanceId: coreOwner.instanceId };
    let policy: Policy;
    try {
      policy = this.policy(identity);
    } catch {
      return failure('quota-exceeded');
    }
    const prompt: ApprovalPrompt = freezeJson({
      requestId: randomUUID(),
      owner: owner ?? coreOwner,
      taskId: safeTask,
      permission: permission ?? { kind: 'capability-use', capability: 'core.invalid@1' },
      permissionDigest: digest(permission ?? 'invalid'),
      policyEpoch: policy.epoch,
    });
    if (!this.audit(prompt, 'requested', 'control')) return failure('unavailable');
    const reject = (code: KernelErrorCode, source: AuditSource) => {
      this.audit(prompt, code === 'cancelled' ? 'cancelled' : 'denied', source, code);
      return failure<PermissionLease>(code);
    };
    if (
      !owner ||
      !permission ||
      safeTask === 'invalid' ||
      (extraSignal !== undefined && !(extraSignal instanceof AbortSignal))
    )
      return reject('invalid-input', 'invalid');
    if (this.#closed) return reject('permission-denied', 'stale');
    if (this.#active.size >= 128 || this.#askWork >= 64)
      return reject('quota-exceeded', 'unavailable');
    let description: ReturnType<PermissionHost['describe']>;
    let ownerSignal: AbortSignal | null, taskSignal: AbortSignal | null;
    try {
      description = this.options.host.describe(owner);
      ownerSignal = this.options.host.ownerSignal(owner);
      taskSignal = this.options.host.taskSignal(taskId, owner);
    } catch {
      return reject('permission-denied', 'stale');
    }
    if (
      !description ||
      description.manifest.id !== owner.pluginId ||
      !/^[0-9a-f]{64}$/.test(description.digest) ||
      !ownerSignal ||
      !taskSignal
    )
      return reject('permission-denied', 'stale');
    if (!this.isTrusted(identity, description.digest)) return reject('permission-denied', 'stale');
    if (!this.declares(description.manifest, permission))
      return reject('permission-denied', 'undeclared');
    const active: Active = { identity, controller: new AbortController() };
    this.#active.add(active);
    const signal = AbortSignal.any([
      this.#lifetime.signal,
      active.controller.signal,
      ownerSignal,
      taskSignal,
      ...(extraSignal ? [extraSignal] : []),
    ]);
    const epoch = policy.epoch;
    const trustDigest = description.digest;
    const valid = () => {
      try {
        const current = this.options.host.describe(owner);
        return (
          !this.#closed &&
          !signal.aborted &&
          !policy.blocked &&
          policy.epoch === epoch &&
          this.options.host.isLive(owner) &&
          this.options.host.taskSignal(taskId, owner) === taskSignal &&
          this.isTrusted(identity, trustDigest) &&
          current?.digest === trustDigest &&
          this.declares(current.manifest, permission)
        );
      } catch {
        return false;
      }
    };
    if (!valid()) {
      this.#active.delete(active);
      return reject(signal.aborted ? 'cancelled' : 'permission-denied', 'stale');
    }
    let source: AuditSource = 'preset';
    const decision = presetDecision(policy.preset, permission);
    if (decision === 'deny') {
      this.#active.delete(active);
      return reject('permission-denied', 'preset');
    }
    if (decision === 'ask') {
      source = 'approval';
      if (!this.options.approval) {
        this.#active.delete(active);
        return reject('permission-denied', 'unavailable');
      }
      this.#pending++;
      const deadline = performance.now() + this.#timeout;
      const asking = new AbortController();
      const askSignal = AbortSignal.any([signal, asking.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let detach = () => {};
      this.#askWork++;
      const waiting = Promise.resolve()
        .then(() => {
          if (askSignal.aborted) throw new Error('Cancelled');
          return this.options.approval!.request(prompt, askSignal);
        })
        .finally(() => {
          this.#askWork--;
        });
      const answer = await new Promise<
        { kind: 'decision'; value: unknown } | { kind: 'cancelled' | 'timeout' | 'failed' }
      >((resolve) => {
        timer = setTimeout(() => {
          resolve({ kind: 'timeout' });
          asking.abort();
        }, this.#timeout);
        const abort = () => resolve({ kind: 'cancelled' });
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        detach = () => signal.removeEventListener('abort', abort);
        void waiting.then(
          (value) => resolve({ kind: 'decision', value }),
          () => resolve({ kind: 'failed' }),
        );
      });
      if (timer) clearTimeout(timer);
      detach();
      asking.abort();
      this.#pending--;
      const expired = performance.now() >= deadline;
      if (answer.kind !== 'decision' || !valid() || expired) {
        this.#active.delete(active);
        return reject(
          answer.kind === 'timeout' || expired
            ? 'timeout'
            : signal.aborted || answer.kind === 'cancelled'
              ? 'cancelled'
              : 'permission-denied',
          source,
        );
      }
      const checked = jsonPreflight(answer.value);
      const row =
        checked.ok &&
        checked.value &&
        typeof checked.value === 'object' &&
        !Array.isArray(checked.value)
          ? checked.value
          : null;
      const responding = row && ownerFrom(row['owner']);
      if (
        !row ||
        Object.keys(row).sort().join(',') !== 'approved,owner,permissionDigest,requestId,taskId' ||
        row['approved'] !== true ||
        row['requestId'] !== prompt.requestId ||
        row['taskId'] !== taskId ||
        row['permissionDigest'] !== prompt.permissionDigest ||
        !responding ||
        !sameOwner(responding, owner)
      ) {
        this.#active.delete(active);
        return reject('permission-denied', source);
      }
    }
    if (!valid() || !this.audit(prompt, 'approved', source)) {
      this.#active.delete(active);
      return reject('permission-denied', source);
    }
    if (!valid()) {
      this.#active.delete(active);
      return reject('permission-denied', 'stale');
    }
    this.#leaseCount++;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', revoked);
      this.#active.delete(active);
      this.#leaseCount--;
      active.controller.abort();
      if (!this.audit(prompt, 'closed', source)) throw new Error('Permission audit unavailable');
    };
    const revoked = () => {
      if (!closed) this.audit(prompt, 'revoked', source);
      try {
        close();
      } catch {
        /* denied leases remain unusable */
      }
    };
    const lease: PermissionLease = Object.freeze({
      signal,
      isValid: () => !closed && valid(),
      close,
    });
    this.#leases.set(lease, { prompt, source });
    signal.addEventListener('abort', revoked, { once: true });
    if (signal.aborted) {
      revoked();
      return reject('cancelled', 'stale');
    }
    return { ok: true, value: lease };
  }
  async run<T>(
    owner: OwnerRef,
    taskId: string,
    permission: unknown,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Result<T>> {
    if (typeof operation !== 'function') return failure('invalid-input');
    if (this.#operations >= 64) return failure('quota-exceeded');
    const authorized = await this.authorize(owner, taskId, permission, signal);
    if (!authorized.ok) return authorized;
    const lease = authorized.value,
      metadata = this.#leases.get(lease)!;
    let result: Result<T>;
    try {
      if (!lease.isValid()) result = failure('permission-denied');
      else if (this.#operations >= 64) {
        result = failure('quota-exceeded');
        this.audit(metadata.prompt, 'failed', metadata.source, 'quota-exceeded');
      } else if (!this.audit(metadata.prompt, 'started', metadata.source))
        result = failure('unavailable');
      else {
        this.#operations++;
        const work = Promise.resolve()
          .then(() => {
            if (!lease.isValid()) throw new Error('Permission revoked');
            return operation(lease.signal);
          })
          .finally(() => {
            this.#operations--;
          });
        let detach = () => {};
        const outcome = await new Promise<
          { kind: 'done'; value: T } | { kind: 'cancelled' | 'failed' }
        >((resolve) => {
          const abort = () => resolve({ kind: 'cancelled' });
          if (lease.signal.aborted) abort();
          else lease.signal.addEventListener('abort', abort, { once: true });
          detach = () => lease.signal.removeEventListener('abort', abort);
          void work.then(
            (value) => resolve({ kind: 'done', value }),
            () => resolve({ kind: 'failed' }),
          );
        });
        detach();
        result =
          outcome.kind === 'done' && lease.isValid()
            ? { ok: true, value: outcome.value }
            : failure(
                outcome.kind === 'failed'
                  ? 'internal'
                  : lease.signal.aborted
                    ? 'cancelled'
                    : 'permission-denied',
              );
        if (
          !this.audit(
            metadata.prompt,
            result.ok ? 'completed' : 'failed',
            metadata.source,
            result.ok ? undefined : result.error.code,
          )
        )
          result = failure('unavailable');
      }
    } catch {
      this.audit(metadata.prompt, 'failed', metadata.source, 'internal');
      result = failure('internal');
    } finally {
      try {
        lease.close();
      } catch {
        result = failure('unavailable');
      }
    }
    return result;
  }
  issueClient(rawOwner: OwnerRef): PermissionClient {
    const owner = ownerFrom(rawOwner);
    return Object.freeze({
      run: <T>(
        taskId: string,
        permission: unknown,
        operation: (signal: AbortSignal) => Promise<T>,
        signal?: AbortSignal,
      ) =>
        owner
          ? this.run(owner, taskId, permission, operation, signal)
          : Promise.resolve(failure<T>('stale-owner')),
    });
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lifetime.abort();
    this.#trusted.clear();
  }
  diagnostics() {
    return { pending: this.#pending, leases: this.#leaseCount, closed: this.#closed };
  }
  service(): PermissionService {
    return Object.freeze({
      isTrusted: (identity: InstanceIdentity, value: string) => this.isTrusted(identity, value),
      authorize: (owner: OwnerRef, taskId: string, permission: unknown, signal?: AbortSignal) =>
        this.authorize(owner, taskId, permission, signal),
      run: <T>(
        owner: OwnerRef,
        taskId: string,
        permission: unknown,
        operation: (signal: AbortSignal) => Promise<T>,
        signal?: AbortSignal,
      ) => this.run(owner, taskId, permission, operation, signal),
      issueClient: (owner: OwnerRef) => this.issueClient(owner),
      close: () => this.close(),
      diagnostics: () => this.diagnostics(),
    });
  }
}
export function createPermissionKernel(options: PermissionOptions): {
  service: PermissionService;
  control: PermissionControl;
} {
  const kernel = new PermissionEngine(options);
  return Object.freeze({ service: kernel.service(), control: kernel.control() });
}

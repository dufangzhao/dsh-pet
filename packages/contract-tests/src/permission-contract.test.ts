/**
 * M1-07 permission kernel contract tests.
 *
 * Scope: the host-side kernel exported by @pet/host-kernel and the permission
 * declarations in @pet/contracts. These tests are independent of the host
 * implementation: the owner, manifest, liveness, signals and approval channel
 * are all supplied by a fixed fake host, and no file, network, GUI or audio
 * resource is touched.
 *
 * Covered acceptance items: SEC-01 (unauthorized request denied and audited),
 * SEC-05 (revocation), SEC-09 (stop/start does not revive a lease), SEC-10
 * (missing approval channel denies), SEC-11 (cancel while waiting), SEC-12 (a
 * second identical operation needs a second approval), plus cross-origin/key/
 * worker/access subsets, HTTPS origin normalisation, forged or replayed
 * decisions, service/control/client surface isolation, audit redaction,
 * budgets, exceptions and timeouts.
 *
 * Tests whose title ends in "(exposed gap)" are expected to fail until the
 * implementation closes the gap; they are kept as failing on purpose rather
 * than being weakened.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  PermissionAudit,
  createPermissionKernel,
  type ApprovalChannel,
  type ApprovalDecision,
  type ApprovalPrompt,
  type InstanceIdentity,
  type PermissionHost,
  type PermissionOptions,
  type PermissionPreset,
} from '@pet/host-kernel';
import type { OwnerRef, PermissionDeclaration, PluginManifest, Result } from '@pet/contracts';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

type RequestFn = (prompt: ApprovalPrompt, signal: AbortSignal) => Promise<ApprovalDecision>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deterministic barrier between microtask and macrotask turns. Never used with fake timers. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error('unexpected failure: ' + result.error.code);
  return result.value;
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('expected at least one collected value');
  return value;
}

const approvePrompt = (prompt: ApprovalPrompt): ApprovalDecision => ({
  requestId: prompt.requestId,
  owner: prompt.owner,
  taskId: prompt.taskId,
  permissionDigest: prompt.permissionDigest,
  approved: true,
});

const denyPrompt = (prompt: ApprovalPrompt): ApprovalDecision => ({
  ...approvePrompt(prompt),
  approved: false,
});

function makeManifest(id: string, permissions: PermissionDeclaration[]): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    version: '1.0.0',
    displayName: { 'zh-CN': '权限契约测试' },
    description: { 'zh-CN': '仅用于契约测试' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.js' },
    permissions,
  };
}

interface HostEntry {
  readonly owner: OwnerRef;
  readonly manifest: PluginManifest;
  digest: string;
  live: boolean;
  ownerAbort: AbortController;
  readonly tasks: Map<string, AbortController>;
}

const ownerKey = (owner: OwnerRef): string =>
  JSON.stringify([owner.pluginId, owner.instanceId, owner.generation]);

/** A fixed fake host: the test owns every answer the kernel may ask for. */
class FakeHost {
  readonly entries = new Map<string, HostEntry>();
  readonly host: PermissionHost = {
    fingerprint: (identity) =>
      [...this.entries.values()]
        .filter(
          (entry) =>
            entry.owner.pluginId === identity.pluginId &&
            entry.owner.instanceId === identity.instanceId,
        )
        .sort((a, b) => b.owner.generation - a.owner.generation)[0]?.digest ?? null,
    describe: (owner) => {
      const entry = this.entries.get(ownerKey(owner));
      return entry ? { manifest: entry.manifest, digest: entry.digest } : null;
    },
    isLive: (owner) => this.entries.get(ownerKey(owner))?.live ?? false,
    ownerSignal: (owner) => this.entries.get(ownerKey(owner))?.ownerAbort.signal ?? null,
    taskSignal: (taskId, owner) =>
      this.entries.get(ownerKey(owner))?.tasks.get(taskId)?.signal ?? null,
  };

  add(
    pluginId: string,
    permissions: PermissionDeclaration[] = [],
    options: { instanceId?: string; digest?: string; generation?: number; tasks?: string[] } = {},
  ): OwnerRef {
    const owner: OwnerRef = {
      pluginId,
      instanceId: options.instanceId ?? 'main',
      generation: options.generation ?? 1,
    };
    const tasks = new Map<string, AbortController>();
    for (const taskId of options.tasks ?? ['task-1']) tasks.set(taskId, new AbortController());
    this.entries.set(ownerKey(owner), {
      owner,
      manifest: makeManifest(pluginId, permissions),
      digest: options.digest ?? DIGEST_A,
      live: true,
      ownerAbort: new AbortController(),
      tasks,
    });
    return owner;
  }

  digestOf(owner: OwnerRef): string {
    const entry = this.entries.get(ownerKey(owner));
    if (!entry) throw new Error('unknown owner');
    return entry.digest;
  }

  setDigest(owner: OwnerRef, digest: string): void {
    const entry = this.entries.get(ownerKey(owner));
    if (!entry) throw new Error('unknown owner');
    entry.digest = digest;
  }

  /** Disable the instance: liveness false and the owner signal aborted. */
  stopOwner(owner: OwnerRef): void {
    const entry = this.entries.get(ownerKey(owner));
    if (!entry) throw new Error('unknown owner');
    entry.live = false;
    entry.ownerAbort.abort();
  }

  /** Re-enable the instance with a brand new signal (a new generation of liveness). */
  reviveOwner(owner: OwnerRef): void {
    const entry = this.entries.get(ownerKey(owner));
    if (!entry) throw new Error('unknown owner');
    entry.live = true;
    entry.ownerAbort = new AbortController();
  }

  endTask(owner: OwnerRef, taskId: string): void {
    this.entries.get(ownerKey(owner))?.tasks.get(taskId)?.abort();
  }
}

interface Harness {
  readonly fake: FakeHost;
  readonly owner: OwnerRef;
  readonly identity: InstanceIdentity;
  readonly digest: string;
  readonly kernel: ReturnType<typeof createPermissionKernel>;
}

const kernels: Array<ReturnType<typeof createPermissionKernel>> = [];

afterEach(() => {
  for (const kernel of kernels.splice(0)) kernel.service.close();
  vi.useRealTimers();
});

interface SetupOptions {
  permissions?: PermissionDeclaration[];
  preset?: PermissionPreset;
  approval?: ApprovalChannel;
  audit?: PermissionAudit;
  approvalTimeoutMs?: number;
  trust?: boolean;
}

function setup(options: SetupOptions = {}): Harness {
  const fake = new FakeHost();
  const owner = fake.add('test.plugin', options.permissions ?? [], { tasks: ['task-1', 'task-2'] });
  const kernelOptions: PermissionOptions = { host: fake.host };
  if (options.approval !== undefined) kernelOptions.approval = options.approval;
  if (options.audit !== undefined) kernelOptions.audit = options.audit;
  if (options.approvalTimeoutMs !== undefined)
    kernelOptions.approvalTimeoutMs = options.approvalTimeoutMs;
  const kernel = createPermissionKernel(kernelOptions);
  kernels.push(kernel);
  const identity: InstanceIdentity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
  const digest = fake.digestOf(owner);
  if (options.trust !== false) kernel.control.confirmTrust(identity, digest, true);
  if (options.preset !== undefined) kernel.control.setPreset(identity, options.preset);
  return { fake, owner, identity, digest, kernel };
}

interface RecordingApproval extends ApprovalChannel {
  readonly request: Mock<RequestFn>;
  readonly prompts: ApprovalPrompt[];
  readonly signals: AbortSignal[];
}

/** Approval channel that records every prompt and the abort signal it was handed. */
function recordingApproval(
  respond: (
    prompt: ApprovalPrompt,
    signal: AbortSignal,
  ) => Promise<ApprovalDecision> | ApprovalDecision = approvePrompt,
): RecordingApproval {
  const prompts: ApprovalPrompt[] = [];
  const signals: AbortSignal[] = [];
  const request = vi.fn<RequestFn>(async (prompt, signal) => {
    prompts.push(prompt);
    signals.push(signal);
    return respond(prompt, signal);
  });
  return { request, prompts, signals };
}

const microphone: PermissionDeclaration = { kind: 'microphone' };

describe('trust and declaration scope (SEC-01)', () => {
  it('denies every sensitive request until the host confirms trust', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval, trust: false });
    const operation = vi.fn(async () => 'recorded');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
    expect(h.kernel.service.isTrusted(h.identity, h.digest)).toBe(false);
    expect(h.kernel.control.confirmTrust(h.identity, h.digest, true)).toBe(true);
    expect(h.kernel.service.isTrusted(h.identity, h.digest)).toBe(true);
  });

  it('denies operations once the host digest changes', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    h.fake.setDigest(h.owner, DIGEST_B);
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'x');
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).not.toHaveBeenCalled();
    expect(h.kernel.control.confirmTrust(h.identity, DIGEST_C, true)).toBe(false);
    expect(h.kernel.service.isTrusted(h.identity, DIGEST_C)).toBe(false);
    h.fake.setDigest(h.owner, DIGEST_C);
    expect(h.kernel.control.confirmTrust(h.identity, DIGEST_C, true)).toBe(true);
    expect(h.kernel.service.isTrusted(h.identity, DIGEST_C)).toBe(true);
  });

  it('reports a stale digest as untrusted after the host digest changes (exposed gap)', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    h.fake.setDigest(h.owner, DIGEST_B);
    // The host-recorded digest changed, so the old trust record must not answer true.
    expect(h.kernel.service.isTrusted(h.identity, h.digest)).toBe(false);
  });

  it('denies an undeclared permission without asking the host', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'captured');
    const result = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'screen-capture' },
      operation,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
    const entries = h.kernel.control.snapshotAudit().entries;
    expect(
      entries.some(
        (entry) =>
          entry.event === 'denied' &&
          entry.source === 'undeclared' &&
          entry.kind === 'screen-capture',
      ),
    ).toBe(true);
  });

  it('never widens a declared origin set', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'network', origins: ['https://a.example.com'] }],
      approval,
    });
    const operation = vi.fn(async () => 'uploaded');
    const widened = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com', 'https://b.example.com'] },
      operation,
    );
    expect(widened).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('matches a request against any single declared permission entry', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [
        { kind: 'network', origins: ['https://a.example.com'] },
        { kind: 'network', origins: ['https://b.example.com'] },
      ],
      approval,
    });
    const operation = vi.fn(async () => 'ok');
    const result = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://b.example.com'] },
      operation,
    );
    expect(result).toEqual({ ok: true, value: 'ok' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('requires the exact declared capability id', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'capability-use', capability: 'demo.echo@1' }],
      approval,
    });
    const wrong = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'capability-use',
      capability: 'demo.echo@2',
    });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    const right = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'capability-use',
      capability: 'demo.echo@1',
    });
    expect(right.ok).toBe(true);
    if (right.ok) right.value.close();
    expect(approval.request).toHaveBeenCalledTimes(1);
  });

  it('keeps file scope exact and never widens read to write', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
      approval,
    });
    const widenedAccess = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'files',
      scope: 'plugin-data',
      access: 'read-write',
    });
    expect(widenedAccess).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    const otherScope = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'files',
      scope: 'resources',
      access: 'read',
    });
    expect(otherScope).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    const exact = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'files',
      scope: 'plugin-data',
      access: 'read',
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) exact.value.close();
  });

  it('lets a read-write declaration serve a read request', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'files', scope: 'resources', access: 'read-write' }],
      approval,
    });
    const result = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'files', scope: 'resources', access: 'read' },
      async () => 'read',
    );
    expect(result).toEqual({ ok: true, value: 'read' });
  });

  it('requires declared credential keys and worker ids', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [
        { kind: 'credentials', keys: ['api-key'] },
        { kind: 'process', workers: ['worker-a'] },
      ],
      approval,
    });
    const extraKey = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'credentials',
      keys: ['api-key', 'other-key'],
    });
    expect(extraKey).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    const extraWorker = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'process',
      workers: ['worker-a', 'worker-b'],
    });
    expect(extraWorker).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    const exactKey = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'credentials',
      keys: ['api-key'],
    });
    expect(exactKey.ok).toBe(true);
    if (exactKey.ok) exactKey.value.close();
    const exactWorker = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'process',
      workers: ['worker-a'],
    });
    expect(exactWorker.ok).toBe(true);
    if (exactWorker.ok) exactWorker.value.close();
  });

  it('accepts only canonical HTTPS origins', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'network', origins: ['https://a.example.com'] }],
      approval,
    });
    const nonCanonical: unknown[] = [
      { kind: 'network', origins: ['https://a.example.com:443'] },
      { kind: 'network', origins: ['HTTPS://a.example.com'] },
      { kind: 'network', origins: ['https://A.example.com'] },
      { kind: 'network', origins: ['http://a.example.com'] },
      { kind: 'network', origins: ['https://a.example.com/path'] },
      { kind: 'network', origins: ['https://a.example.com?q=1'] },
      { kind: 'network', origins: [] },
      { kind: 'network', origins: ['https://a.example.com', 'https://a.example.com'] },
    ];
    for (const permission of nonCanonical) {
      const result = await h.kernel.service.authorize(h.owner, 'task-1', permission);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    }
    const explicitPort = await h.kernel.service.authorize(h.owner, 'task-1', {
      kind: 'network',
      origins: ['https://a.example.com:8443'],
    });
    // Not declared, so it is a scope denial rather than a shape denial.
    expect(explicitPort).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('rejects permission objects that add fields or use an unknown kind', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const malformed: unknown[] = [
      null,
      'microphone',
      [],
      { kind: 'microphone', extra: true },
      { kind: 'unknown' },
      { kind: 'files', scope: 'plugin-data', access: 'append' },
      { kind: 'capability-use' },
    ];
    for (const permission of malformed) {
      const result = await h.kernel.service.authorize(h.owner, 'task-1', permission);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    }
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('rejects an invalid owner, task id or caller signal', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const badOwner = await h.kernel.service.authorize(
      { pluginId: 'Not-Valid', instanceId: 'main', generation: 1 },
      'task-1',
      microphone,
    );
    expect(badOwner).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    const badTask = await h.kernel.service.authorize(h.owner, '', microphone);
    expect(badTask).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    const badSignal = await h.kernel.service.authorize(
      h.owner,
      'task-1',
      microphone,
      {} as AbortSignal,
    );
    expect(badSignal).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('allows a declared-origin subset but not a reordered superset', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [
        { kind: 'network', origins: ['https://a.example.com', 'https://b.example.com'] },
      ],
      approval,
    });
    const subset = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://b.example.com'] },
      async () => 'ok',
    );
    expect(subset).toEqual({ ok: true, value: 'ok' });
    const superset = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://b.example.com', 'https://c.example.com'] },
      async () => 'ok',
    );
    expect(superset).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  });

  it('denies every kind when the manifest declares no permissions', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [], approval });
    for (const permission of [
      microphone,
      { kind: 'clipboard', access: 'read' } as PermissionDeclaration,
      { kind: 'files', scope: 'plugin-data', access: 'read' } as PermissionDeclaration,
    ]) {
      const result = await h.kernel.service.run(h.owner, 'task-1', permission, async () => 'x');
      expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    }
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('does not accept a caller-supplied signal as task identity', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const foreign = new AbortController();
    const result = await h.kernel.service.authorize(
      h.owner,
      'task-unknown',
      microphone,
      foreign.signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).not.toHaveBeenCalled();
  });
});

describe('presets (SEC-10, SEC-12)', () => {
  it('asks on every request under the default preset and denies without a channel', async () => {
    const h = setup({ permissions: [microphone] });
    const operation = vi.fn(async () => 'recorded');
    const firstRun = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    const secondRun = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(firstRun).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(secondRun).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    const entries = h.kernel.control.snapshotAudit().entries;
    expect(entries.some((entry) => entry.source === 'unavailable')).toBe(true);
  });

  it('refuses everything under the deny preset without consulting the channel', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], preset: 'deny', approval });
    const operation = vi.fn(async () => 'recorded');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
    expect(
      h.kernel.control
        .snapshotAudit()
        .entries.some((entry) => entry.event === 'denied' && entry.source === 'preset'),
    ).toBe(true);
  });

  it('auto-allows declared capability, microphone, worker, plugin-data and readonly resources under local', async () => {
    const permissions: PermissionDeclaration[] = [
      { kind: 'capability-use', capability: 'demo.echo@1' },
      microphone,
      { kind: 'process', workers: ['worker-a'] },
      { kind: 'files', scope: 'plugin-data', access: 'read-write' },
      { kind: 'files', scope: 'resources', access: 'read' },
    ];
    const approval = recordingApproval();
    const h = setup({ permissions, preset: 'local', approval });
    for (const permission of permissions) {
      const operation = vi.fn(async () => 'done');
      const result = await h.kernel.service.run(h.owner, 'task-1', permission, operation);
      expect(result).toEqual({ ok: true, value: 'done' });
      expect(operation).toHaveBeenCalledTimes(1);
    }
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('refuses declared network access under the local preset', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'network', origins: ['https://a.example.com'] }],
      preset: 'local',
      approval,
    });
    const operation = vi.fn(async () => 'uploaded');
    const result = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com'] },
      operation,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
  });

  it('still asks for screen capture, text input, clipboard and user-selected files under local', async () => {
    const permissions: PermissionDeclaration[] = [
      { kind: 'screen-capture' },
      { kind: 'text-input' },
      { kind: 'clipboard', access: 'read' },
      { kind: 'files', scope: 'user-selected', access: 'read' },
    ];
    const approval = recordingApproval();
    const h = setup({ permissions, preset: 'local', approval });
    for (const permission of permissions) {
      const result = await h.kernel.service.run(h.owner, 'task-1', permission, async () => 'done');
      expect(result).toEqual({ ok: true, value: 'done' });
    }
    expect(approval.request).toHaveBeenCalledTimes(permissions.length);
  });

  it('keeps the local preset closed until trust is confirmed', async () => {
    const h = setup({ permissions: [microphone], preset: 'local', trust: false });
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'done');
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  });

  it('treats an undeclared network request under local as undeclared, not askable', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], preset: 'local', approval });
    const result = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com'] },
      async () => 'x',
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).not.toHaveBeenCalled();
  });
});

describe('approval prompts and decisions', () => {
  it('carries exactly the documented prompt fields', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const lease = unwrap(await h.kernel.service.authorize(h.owner, 'task-1', microphone));
    lease.close();
    const prompt = first(approval.prompts);
    expect(Object.keys(prompt).sort()).toEqual([
      'owner',
      'permission',
      'permissionDigest',
      'policyEpoch',
      'requestId',
      'taskId',
    ]);
    expect(prompt.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(prompt.owner).toEqual(h.owner);
    expect(prompt.taskId).toBe('task-1');
    expect(prompt.permission).toEqual({ kind: 'microphone' });
    expect(prompt.permissionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isSafeInteger(prompt.policyEpoch)).toBe(true);
    expect(prompt.policyEpoch).toBeGreaterThan(0);
    expect(Object.isFrozen(prompt)).toBe(true);
  });

  it('stamps a new policy epoch after a control change', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'one');
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    expect(h.kernel.control.resume(h.identity)).toBe(true);
    await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'two');
    const epochs = approval.prompts.map((prompt) => prompt.policyEpoch);
    expect(epochs).toHaveLength(2);
    expect(Math.max(...epochs)).toBeGreaterThan(Math.min(...epochs));
  });

  it('derives the permission digest from the normalised request', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [
        { kind: 'network', origins: ['https://a.example.com'] },
        { kind: 'network', origins: ['https://b.example.com'] },
      ],
      approval,
    });
    await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com'] },
      async () => 1,
    );
    await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com'] },
      async () => 2,
    );
    await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://b.example.com'] },
      async () => 3,
    );
    const one = approval.prompts[0];
    const two = approval.prompts[1];
    const three = approval.prompts[2];
    expect(one?.permissionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(two?.permissionDigest).toBe(one?.permissionDigest);
    expect(three?.permissionDigest).not.toBe(one?.permissionDigest);
  });

  it('runs the operation once when the decision matches exactly', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toEqual({ ok: true, value: 'value' });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(h.kernel.service.diagnostics().leases).toBe(0);
  });

  it('answers a second identical operation with a second approval (SEC-12)', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toEqual({
      ok: true,
      value: 'value',
    });
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toEqual({
      ok: true,
      value: 'value',
    });
    expect(approval.request).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(first(approval.prompts).requestId).not.toBe(approval.prompts[1]?.requestId);
  });

  it('rejects a decision that answers a different request id', async () => {
    const approval = recordingApproval((prompt) => ({
      ...approvePrompt(prompt),
      requestId: 'not-the-request',
    }));
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects a decision that approves for another owner generation', async () => {
    const approval = recordingApproval((prompt) => ({
      ...approvePrompt(prompt),
      owner: { ...prompt.owner, generation: prompt.owner.generation + 1 },
    }));
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects a decision for a different target digest', async () => {
    const approval = recordingApproval((prompt) => ({
      ...approvePrompt(prompt),
      permissionDigest: DIGEST_B,
    }));
    const h = setup({ permissions: [microphone], approval });
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'value');
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  });

  it('rejects a decision with an extra field, a false approval or a non-record answer', async () => {
    const answers: Array<(prompt: ApprovalPrompt) => unknown> = [
      (prompt) => ({ ...approvePrompt(prompt), extra: true }),
      (prompt) => denyPrompt(prompt),
      () => null,
      () => 'yes',
      () => 42,
      () => [],
      () => ({ approved: true }),
    ];
    for (const answer of answers) {
      const approval = recordingApproval((prompt) => answer(prompt) as ApprovalDecision);
      const h = setup({ permissions: [microphone], approval });
      const operation = vi.fn(async () => 'value');
      const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
      expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('does not accept a replayed decision for a later request', async () => {
    const decisions: ApprovalDecision[] = [];
    const approval = recordingApproval((prompt) => {
      if (decisions.length === 0) decisions.push(approvePrompt(prompt));
      return first(decisions);
    });
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toEqual({
      ok: true,
      value: 'value',
    });
    const replayed = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(replayed).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('hands the channel a defensive copy of the requested permission', async () => {
    const entered = deferred<ApprovalPrompt>();
    const gate = deferred<ApprovalDecision>();
    const approval = recordingApproval(async (prompt) => {
      entered.resolve(prompt);
      return gate.promise;
    });
    const h = setup({ permissions: [microphone], approval });
    const permission: { kind: string } = { kind: 'microphone' };
    const running = h.kernel.service.run(h.owner, 'task-1', permission, async () => 'value');
    await entered.promise;
    permission.kind = 'screen-capture';
    const prompt = first(approval.prompts);
    expect(prompt.permission).toEqual({ kind: 'microphone' });
    gate.resolve(approvePrompt(prompt));
    expect(await running).toEqual({ ok: true, value: 'value' });
  });
});

describe('cancellation, timeout and budget', () => {
  it('retracts a pending prompt on caller cancel and discards the late answer (SEC-11)', async () => {
    const entered = deferred<ApprovalPrompt>();
    const gate = deferred<ApprovalDecision>();
    const approval = recordingApproval(async (prompt) => {
      entered.resolve(prompt);
      return gate.promise;
    });
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'late');
    const caller = new AbortController();
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation, caller.signal);
    await entered.promise;
    caller.abort();
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(first(approval.signals).aborted).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    gate.resolve(approvePrompt(first(approval.prompts)));
    await flush();
    expect(
      h.kernel.control.snapshotAudit().entries.some((entry) => entry.event === 'approved'),
    ).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('retracts a pending prompt when the task ends and discards the late answer (SEC-11)', async () => {
    const entered = deferred<ApprovalPrompt>();
    const gate = deferred<ApprovalDecision>();
    const approval = recordingApproval(async (prompt) => {
      entered.resolve(prompt);
      return gate.promise;
    });
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'late');
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    await entered.promise;
    h.fake.endTask(h.owner, 'task-1');
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(operation).not.toHaveBeenCalled();
    gate.resolve(approvePrompt(first(approval.prompts)));
    await flush();
    expect(operation).not.toHaveBeenCalled();
  });

  it('times out an unanswered approval without starting the operation', async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const approval = recordingApproval(() => {
      entered.resolve();
      return new Promise<ApprovalDecision>(() => {});
    });
    const h = setup({ permissions: [microphone], approval, approvalTimeoutMs: 500 });
    const operation = vi.fn(async () => 'value');
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    await entered.promise;
    vi.advanceTimersByTime(499);
    expect(h.kernel.service.diagnostics().pending).toBe(1);
    vi.advanceTimersByTime(1);
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(operation).not.toHaveBeenCalled();
    expect(h.kernel.service.diagnostics().pending).toBe(0);
    expect(first(approval.signals).aborted).toBe(true);
    expect(
      h.kernel.control
        .snapshotAudit()
        .entries.some((entry) => entry.event === 'denied' && entry.errorCode === 'timeout'),
    ).toBe(true);
  });

  it('rejects an out-of-range approval timeout', () => {
    const fake = new FakeHost();
    expect(() => createPermissionKernel({ host: fake.host, approvalTimeoutMs: 0 })).toThrow();
    expect(() => createPermissionKernel({ host: fake.host, approvalTimeoutMs: 60_001 })).toThrow();
    expect(() => createPermissionKernel({ host: fake.host, approvalTimeoutMs: 1.5 })).toThrow();
  });

  it('refuses more than 64 simultaneous approvals', async () => {
    const pending: AbortSignal[] = [];
    const allEntered = deferred<void>();
    const request = vi.fn<RequestFn>(async (_prompt, signal) => {
      pending.push(signal);
      if (pending.length === 64) allEntered.resolve();
      return new Promise<ApprovalDecision>(() => {});
    });
    const h = setup({ permissions: [microphone], approval: { request } });
    const runs = Array.from({ length: 64 }, () =>
      h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'value'),
    );
    await allEntered.promise;
    expect(h.kernel.service.diagnostics().pending).toBe(64);
    const overflow = await h.kernel.service.authorize(h.owner, 'task-1', microphone);
    expect(overflow).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
    h.kernel.service.close();
    const settled = await Promise.allSettled(runs);
    expect(settled.every((entry) => entry.status === 'fulfilled')).toBe(true);
  });

  it('releases the approval budget after an unanswered prompt times out', async () => {
    vi.useFakeTimers();
    const approval: ApprovalChannel = {
      request: async () => new Promise<ApprovalDecision>(() => {}),
    };
    const h = setup({ permissions: [microphone], approval, approvalTimeoutMs: 100 });
    for (let index = 0; index < 64; index += 1) {
      const running = h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'value');
      vi.advanceTimersByTime(100);
      expect(await running).toMatchObject({ ok: false, error: { code: 'timeout' } });
    }
    const running = h.kernel.service.authorize(h.owner, 'task-1', microphone);
    vi.advanceTimersByTime(100);
    const after = await running;
    expect(after.ok ? 'ok' : after.error.code).not.toBe('quota-exceeded');
  });

  it('never leaks an operation exception into the result or the audit', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, async () => {
      throw new Error('boom-secret');
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(result)).not.toContain('boom-secret');
    const audit = h.kernel.control.snapshotAudit();
    expect(JSON.stringify(audit)).not.toContain('boom-secret');
    expect(
      audit.entries.some((entry) => entry.event === 'failed' && entry.errorCode === 'internal'),
    ).toBe(true);
    expect(h.kernel.service.diagnostics().leases).toBe(0);
  });

  it('refuses to start when the audit sink fails', async () => {
    class FailingAudit extends PermissionAudit {
      override append(): void {
        throw new Error('audit-sink-unavailable');
      }
    }
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval, audit: new FailingAudit() });
    const operation = vi.fn(async () => 'value');
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(operation).not.toHaveBeenCalled();
    expect(approval.request).not.toHaveBeenCalled();
  });
});

describe('revocation and instance generations (SEC-05, SEC-09)', () => {
  it('revokes a waiting approval and refuses new requests immediately', async () => {
    const entered = deferred<ApprovalPrompt>();
    const gate = deferred<ApprovalDecision>();
    const approval = recordingApproval(async (prompt) => {
      entered.resolve(prompt);
      return gate.promise;
    });
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'late');
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    await entered.promise;
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(first(approval.signals).aborted).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    gate.resolve(approvePrompt(first(approval.prompts)));
    await flush();
    expect(
      h.kernel.control.snapshotAudit().entries.some((entry) => entry.event === 'approved'),
    ).toBe(false);
    const blocked = await h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).toHaveBeenCalledTimes(1);
  });

  it('aborts a granted lease when the instance is revoked', async () => {
    const started = deferred<void>();
    const gate = deferred<string>();
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    let operationSignal: AbortSignal | undefined;
    const operation = vi.fn(async (signal: AbortSignal) => {
      operationSignal = signal;
      started.resolve();
      return gate.promise;
    });
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    await started.promise;
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(operationSignal?.aborted).toBe(true);
    expect(h.kernel.service.diagnostics().leases).toBe(0);
    expect(
      h.kernel.control.snapshotAudit().entries.some((entry) => entry.event === 'revoked'),
    ).toBe(true);
    gate.resolve('late');
    await flush();
  });

  it('requires an explicit control decision to resume and a fresh approval after it', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'value');
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toEqual({
      ok: true,
      value: 'value',
    });
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    expect(h.kernel.control.resume(h.identity)).toBe(true);
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, operation)).toEqual({
      ok: true,
      value: 'value',
    });
    expect(approval.request).toHaveBeenCalledTimes(2);
  });

  it('clears a revocation through an explicit preset change', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    expect(h.kernel.control.setPreset(h.identity, 'deny')).toBe(true);
    expect(
      await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'x'),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(h.kernel.control.setPreset(h.identity, 'ask')).toBe(true);
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'x')).toEqual({
      ok: true,
      value: 'x',
    });
  });

  it('invalidates old leases when the owner stops and does not revive them (SEC-09)', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const lease = unwrap(await h.kernel.service.authorize(h.owner, 'task-1', microphone));
    expect(lease.isValid()).toBe(true);
    h.fake.stopOwner(h.owner);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.isValid()).toBe(false);
    h.fake.reviveOwner(h.owner);
    expect(lease.isValid()).toBe(false);
    lease.close();
    const again = await h.kernel.service.authorize(h.owner, 'task-1', microphone);
    expect(again.ok).toBe(true);
    if (again.ok) again.value.close();
    expect(approval.request).toHaveBeenCalledTimes(2);
  });

  it('invalidates only the lease bound to the finished task', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const leaseA = unwrap(await h.kernel.service.authorize(h.owner, 'task-1', microphone));
    const leaseB = unwrap(await h.kernel.service.authorize(h.owner, 'task-2', microphone));
    h.fake.endTask(h.owner, 'task-1');
    expect(leaseA.isValid()).toBe(false);
    expect(leaseB.isValid()).toBe(true);
    leaseA.close();
    leaseB.close();
  });

  it('does not restore trust, preset or leases in a rebuilt service', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval, preset: 'local' });
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'value')).toEqual({
      ok: true,
      value: 'value',
    });
    h.kernel.service.close();
    const rebuilt = createPermissionKernel({ host: h.fake.host, approval });
    kernels.push(rebuilt);
    expect(rebuilt.service.isTrusted(h.identity, h.digest)).toBe(false);
    const result = await rebuilt.service.run(h.owner, 'task-1', microphone, async () => 'value');
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  });

  it('aborts pending approvals and refuses later requests after close', async () => {
    const entered = deferred<ApprovalPrompt>();
    const gate = deferred<ApprovalDecision>();
    const approval = recordingApproval(async (prompt) => {
      entered.resolve(prompt);
      return gate.promise;
    });
    const h = setup({ permissions: [microphone], approval });
    const operation = vi.fn(async () => 'late');
    const running = h.kernel.service.run(h.owner, 'task-1', microphone, operation);
    await entered.promise;
    h.kernel.service.close();
    expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(first(approval.signals).aborted).toBe(true);
    expect(operation).not.toHaveBeenCalled();
    expect(h.kernel.service.diagnostics().closed).toBe(true);
    expect(await h.kernel.service.authorize(h.owner, 'task-1', microphone)).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    gate.resolve(approvePrompt(first(approval.prompts)));
    await flush();
  });

  it('closes idempotently', () => {
    const h = setup();
    h.kernel.service.close();
    expect(() => h.kernel.service.close()).not.toThrow();
    expect(h.kernel.service.diagnostics().closed).toBe(true);
  });
});

describe('control surface arguments', () => {
  it('rejects malformed control arguments instead of trusting them', () => {
    const h = setup();
    expect(h.kernel.control.confirmTrust(h.identity, 'not-a-digest', true)).toBe(false);
    expect(h.kernel.control.confirmTrust(h.identity, DIGEST_A.toUpperCase(), true)).toBe(false);
    expect(
      h.kernel.control.confirmTrust({ pluginId: 'Bad', instanceId: 'main' }, DIGEST_A, true),
    ).toBe(false);
    expect(h.kernel.control.setPreset(h.identity, 'allow-everything' as PermissionPreset)).toBe(
      false,
    );
    expect(
      h.kernel.control.revoke({ pluginId: 'test.plugin' } as unknown as InstanceIdentity),
    ).toBe(false);
    expect(h.kernel.control.resume(null as unknown as InstanceIdentity)).toBe(false);
  });

  it('keeps a revoked instance denied even after a re-confirm of the same digest', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    expect(h.kernel.control.revoke(h.identity)).toBe(true);
    expect(h.kernel.control.confirmTrust(h.identity, h.digest, true)).toBe(true);
    const result = await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'x');
    expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(approval.request).not.toHaveBeenCalled();
  });
});

describe('surface isolation', () => {
  it('exposes control authorities only on the control surface', () => {
    const h = setup();
    expect(Object.keys(h.kernel.service).sort()).toEqual([
      'authorize',
      'close',
      'diagnostics',
      'isTrusted',
      'issueClient',
      'run',
    ]);
    expect(Object.keys(h.kernel.control).sort()).toEqual([
      'confirmTrust',
      'inspect',
      'resume',
      'revoke',
      'setPreset',
      'snapshotAudit',
    ]);
    for (const name of [
      'confirmTrust',
      'inspect',
      'setPreset',
      'revoke',
      'resume',
      'snapshotAudit',
    ])
      expect(Object.hasOwn(h.kernel.service, name)).toBe(false);
    expect(Object.isFrozen(h.kernel.service)).toBe(true);
    expect(Object.isFrozen(h.kernel.control)).toBe(true);
  });

  it('returns a frozen lease with only signal, isValid and close', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const lease = unwrap(await h.kernel.service.authorize(h.owner, 'task-1', microphone));
    expect(Object.keys(lease).sort()).toEqual(['close', 'isValid', 'signal']);
    expect(Object.isFrozen(lease)).toBe(true);
    expect(lease.signal).toBeInstanceOf(AbortSignal);
    expect(lease.isValid()).toBe(true);
    lease.close();
    expect(lease.isValid()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(h.kernel.service.diagnostics().leases).toBe(0);
  });

  it('binds a client to one owner and refuses an invalid owner', async () => {
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval });
    const client = h.kernel.service.issueClient(h.owner);
    expect(Object.keys(client)).toEqual(['run']);
    expect(Object.isFrozen(client)).toBe(true);
    const operation = vi.fn(async () => 'ok');
    expect(await client.run('task-1', microphone, operation)).toEqual({ ok: true, value: 'ok' });
    expect(operation).toHaveBeenCalledTimes(1);

    const stranger = h.fake.add('test.stranger', [microphone]);
    const strangerClient = h.kernel.service.issueClient(stranger);
    const denied = await strangerClient.run('task-1', microphone, operation);
    expect(denied).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).toHaveBeenCalledTimes(1);

    const forged = h.kernel.service.issueClient({
      pluginId: 'Not-Valid',
      instanceId: 'main',
      generation: 1,
    });
    expect(await forged.run('task-1', microphone, operation)).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
  });
});

describe('audit trail', () => {
  it('records request, decision, start, result and close as metadata only', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [
        { kind: 'network', origins: ['https://a.example.com'] },
        { kind: 'credentials', keys: ['api-key-secret'] },
      ],
      approval,
    });
    const ok = await h.kernel.service.run(
      h.owner,
      'task-1',
      { kind: 'network', origins: ['https://a.example.com'] },
      async () => 'result-secret',
    );
    expect(ok.ok).toBe(true);
    const failing = await h.kernel.service.run(
      h.owner,
      'task-2',
      { kind: 'credentials', keys: ['api-key-secret'] },
      async () => {
        throw new Error('boom-secret');
      },
    );
    expect(failing).toMatchObject({ ok: false, error: { code: 'internal' } });

    const snapshot = h.kernel.control.snapshotAudit();
    const allowed = [
      'at',
      'errorCode',
      'event',
      'id',
      'kind',
      'owner',
      'source',
      'targetHash',
      'taskId',
    ];
    for (const entry of snapshot.entries)
      expect(Object.keys(entry).every((key) => allowed.includes(key))).toBe(true);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain('a.example.com');
    expect(text).not.toContain('api-key-secret');
    expect(text).not.toContain('result-secret');
    expect(text).not.toContain('boom-secret');
    expect(snapshot.entries.map((entry) => entry.event).slice(0, 5)).toEqual([
      'requested',
      'approved',
      'started',
      'completed',
      'closed',
    ]);
    expect(snapshot.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.targetHash))).toBe(true);
  });

  it('keeps a bounded ring and exposes the total and drop counters', async () => {
    const audit = new PermissionAudit(4);
    const approval = recordingApproval();
    const h = setup({ permissions: [microphone], approval, audit });
    expect(await h.kernel.service.run(h.owner, 'task-1', microphone, async () => 'value')).toEqual({
      ok: true,
      value: 'value',
    });
    const snapshot = h.kernel.control.snapshotAudit();
    expect(snapshot.total).toBe(5);
    expect(snapshot.dropped).toBe(1);
    expect(snapshot.entries).toHaveLength(4);
  });

  it('rejects an invalid audit page', () => {
    const audit = new PermissionAudit();
    expect(() => audit.snapshot(-1)).toThrow();
    expect(() => audit.snapshot(0, 0)).toThrow();
    expect(() => audit.snapshot(0, 101)).toThrow();
    expect(audit.snapshot(0, 100)).toEqual({ entries: [], total: 0, dropped: 0 });
  });

  it('does not throw across the contract boundary when a host declaration is malformed (exposed gap)', async () => {
    const approval = recordingApproval();
    const h = setup({
      permissions: [{ kind: 'network' } as unknown as PermissionDeclaration],
      approval,
    });
    const operation = vi.fn(async () => 'value');
    // A malformed host declaration must fail closed as a Result, never as a throw:
    // a thrown TypeError would escape the fixed error taxonomy at the boundary.
    let outcome: Result<unknown>;
    try {
      outcome = await h.kernel.service.run(
        h.owner,
        'task-1',
        { kind: 'network', origins: ['https://a.example.com'] },
        operation,
      );
    } catch (error) {
      throw new Error(
        'permission kernel threw instead of returning a Result: ' +
          (error instanceof Error ? error.name : 'unknown'),
        { cause: error },
      );
    }
    expect(outcome).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(operation).not.toHaveBeenCalled();
  });
});

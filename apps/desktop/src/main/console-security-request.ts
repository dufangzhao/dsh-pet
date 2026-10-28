import {
  PERMISSION_PRESETS,
  makeError,
  type ConsoleApprovalDecision,
  type ConsoleAuditPage,
  type ConsoleSecurityChange,
  type ConsoleSecuritySnapshot,
  type ConsoleSnapshot,
  type KernelError,
  type PermissionPreset,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { ownerFrom, record, exactKeys } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
export type SecurityAction = 'get' | 'trust' | 'preset' | 'approval' | 'audit' | 'restore';
type SecurityHost = Pick<
  DesktopHost,
  | 'manager'
  | 'permissionControl'
  | 'approvals'
  | 'describeTrust'
  | 'verifyTrust'
  | 'availableBuiltins'
  | 'restoreBuiltin'
>;
export class ConsoleSecurityRequests {
  readonly #pending = new Set<string>();
  constructor(
    private readonly host: SecurityHost,
    private readonly snapshot: () => ConsoleSnapshot,
    private readonly changed: () => void = () => {},
  ) {}
  read(): ConsoleSecuritySnapshot {
    return {
      sessionOnly: true,
      availableBuiltins: this.host.availableBuiltins(),
      plugins: this.snapshot().plugins.map((plugin) => {
        const identity = { pluginId: plugin.owner.pluginId, instanceId: plugin.owner.instanceId };
        const policy = this.host.permissionControl.inspect(identity);
        if (!policy) throw new Error('Permission state unavailable');
        const source = this.host.describeTrust(plugin.owner);
        return {
          ...plugin,
          digest: source?.digest ?? null,
          trusted: source?.trusted === true,
          preset: policy.preset,
          blocked: policy.blocked,
        };
      }),
      pending: this.host.approvals.snapshot(),
    };
  }
  async handle(
    source: PetRequestSource,
    action: SecurityAction,
    args: readonly unknown[],
  ): Promise<Result<ConsoleSecuritySnapshot | ConsoleSecurityChange | ConsoleAuditPage>> {
    if (!isTrustedPetSource(source)) return fail('permission-denied');
    try {
      if (action === 'get')
        return args.length ? fail('invalid-input') : { ok: true, value: this.read() };
      if (args.length !== 1) return fail('invalid-input');
      const parsed = jsonPreflight(args[0]);
      const body = parsed.ok ? record(parsed.value) : null;
      if (!body) return fail('invalid-input');
      if (action === 'audit') {
        const offset = body['offset'],
          limit = body['limit'];
        if (
          !exactKeys(body, ['offset', 'limit']) ||
          !Number.isSafeInteger(offset) ||
          (offset as number) < 0 ||
          !Number.isSafeInteger(limit) ||
          (limit as number) < 1 ||
          (limit as number) > 100
        )
          return fail('invalid-input');
        return {
          ok: true,
          value: this.host.permissionControl.snapshotAudit(offset as number, limit as number),
        };
      }
      if (action === 'restore') {
        if (
          !exactKeys(body, ['pluginId', 'expectedDigest']) ||
          typeof body['pluginId'] !== 'string' ||
          body['pluginId'].length > 128 ||
          typeof body['expectedDigest'] !== 'string' ||
          !/^[0-9a-f]{64}$/.test(body['expectedDigest'])
        )
          return fail('invalid-input');
        const key = 'restore:' + body['pluginId'];
        if (this.#pending.has(key))
          return {
            ok: true,
            value: {
              snapshot: this.snapshot(),
              security: this.read(),
              operationError: makeError('rate-limited', false),
            },
          };
        this.#pending.add(key);
        try {
          const restored = await this.host.restoreBuiltin(body['pluginId'], body['expectedDigest']);
          this.changed();
          return {
            ok: true,
            value: {
              snapshot: this.snapshot(),
              security: this.read(),
              operationError: restored.ok ? null : restored.error,
            },
          };
        } finally {
          this.#pending.delete(key);
        }
      }
      const expectedKeys =
        action === 'trust'
          ? ['owner', 'expectedDigest', 'approved']
          : action === 'preset'
            ? ['owner', 'preset']
            : ['requestId', 'owner', 'taskId', 'permissionDigest', 'approved'];
      if (!exactKeys(body, expectedKeys)) return fail('invalid-input');
      const owner = ownerFrom(body['owner']);
      if (!owner) return fail('invalid-input');
      if (
        action === 'trust' &&
        (typeof body['approved'] !== 'boolean' ||
          typeof body['expectedDigest'] !== 'string' ||
          !/^[0-9a-f]{64}$/.test(body['expectedDigest']))
      )
        return fail('invalid-input');
      if (action === 'preset' && !PERMISSION_PRESETS.includes(body['preset'] as PermissionPreset))
        return fail('invalid-input');
      if (
        action === 'approval' &&
        (typeof body['approved'] !== 'boolean' ||
          typeof body['requestId'] !== 'string' ||
          body['requestId'].length > 128 ||
          typeof body['taskId'] !== 'string' ||
          body['taskId'].length > 128 ||
          typeof body['permissionDigest'] !== 'string' ||
          !/^[0-9a-f]{64}$/.test(body['permissionDigest']))
      )
        return fail('invalid-input');
      const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
      const plugin = this.host.manager.get(identity),
        lifetime = this.host.manager.ownerSignal(owner);
      const reply = (operationError: KernelError | null): Result<ConsoleSecurityChange> => ({
        ok: true,
        value: { snapshot: this.snapshot(), security: this.read(), operationError },
      });
      if (!plugin || plugin.owner.generation !== owner.generation || !lifetime || lifetime.aborted)
        return reply(makeError('stale-owner', false));
      if (action === 'approval') {
        const answered = this.host.approvals.answer(body as unknown as ConsoleApprovalDecision);
        return reply(answered ? null : makeError('not-ready', false));
      }
      const key = JSON.stringify([identity.pluginId, identity.instanceId]);
      if (this.#pending.has(key)) return reply(makeError('rate-limited', false));
      this.#pending.add(key);
      try {
        let error: KernelError | null = null;
        if (action === 'preset') {
          if (!this.host.permissionControl.setPreset(identity, body['preset'] as PermissionPreset))
            error = makeError('not-ready', false);
        } else {
          const descriptor = this.host.describeTrust(owner);
          if (!descriptor || descriptor.digest !== body['expectedDigest'])
            return reply(makeError('package-changed', false));
          if (body['approved'] === true) {
            const unchanged = await this.host.verifyTrust(owner, descriptor.digest);
            if (lifetime.aborted) return reply(makeError('stale-owner', false));
            if (!unchanged) {
              this.host.permissionControl.confirmTrust(identity, descriptor.digest, false);
              this.host.permissionControl.revoke(identity);
              if (!plugin.protected) await this.host.manager.disable(identity);
              error = makeError('package-changed', false);
            } else if (
              !this.host.permissionControl.confirmTrust(identity, descriptor.digest, true) ||
              !this.host.permissionControl.resume(identity)
            )
              error = makeError('not-ready', false);
          } else {
            if (
              plugin.protected &&
              (this.host.manager.isLive(owner) || plugin.state === 'activating')
            )
              return reply(makeError('permission-denied', false));
            this.host.permissionControl.confirmTrust(identity, descriptor.digest, false);
            this.host.permissionControl.revoke(identity);
            if (!plugin.protected) {
              const stopped = await this.host.manager.disable(identity);
              if (!stopped.ok) error = stopped.error;
              else if (stopped.value.state !== 'disabled')
                error = stopped.value.reason ?? makeError('not-ready', false);
            }
          }
        }
        this.changed();
        return reply(error);
      } finally {
        this.#pending.delete(key);
      }
    } catch {
      return fail('unavailable');
    }
  }
}

import { VOICE_CAPTURE_PLUGIN_ID, type OwnerRef } from '@pet/contracts';
import { KernelFault, type PermissionLease } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';

export interface VoiceMicrophoneLease {
  readonly owner: OwnerRef;
  readonly signal: AbortSignal;
  readonly settled: Promise<void>;
  valid(): boolean;
  sourceValid(): boolean;
  isCurrent(): Promise<boolean>;
}
export interface VoiceCaptureHost {
  acquire(signal: AbortSignal, released: Promise<void>): Promise<VoiceMicrophoneLease>;
}

/** Physical release, rather than logical task cancellation, ends this native microphone task. */
export class SharedVoiceCaptureHost implements VoiceCaptureHost {
  constructor(private readonly host: DesktopHost) {}
  async acquire(signal: AbortSignal, released: Promise<void>): Promise<VoiceMicrophoneLease> {
    const identity = { pluginId: VOICE_CAPTURE_PLUGIN_ID, instanceId: 'default' };
    const entry = this.host.manager.get(identity);
    const trust = entry && this.host.describeTrust(entry.owner);
    const policy = this.host.permissionControl.inspect(identity);
    if (
      !entry ||
      !this.host.manager.isActive(entry.owner) ||
      !trust?.trusted ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny'
    )
      throw new KernelFault('not-ready');
    const sourceSignal = this.host.manager.signal(entry.owner);
    const sourceValid = () => {
      const active = this.host.permissionControl.inspect(identity);
      return (
        !signal.aborted &&
        !!sourceSignal &&
        !sourceSignal.aborted &&
        this.host.manager.isActive(entry.owner) &&
        !!active &&
        active.epoch === policy.epoch &&
        !active.blocked &&
        active.preset !== 'deny'
      );
    };
    const current = async () => {
      if (!sourceValid()) return false;
      const verified = await this.host.verifyTrust(entry.owner, trust.digest);
      return verified && sourceValid();
    };
    if (!(await current())) throw new KernelFault('stale-owner');
    return new Promise<VoiceMicrophoneLease>((resolve, reject) => {
      const task = this.host.tasks.run(
        entry.owner,
        async (context) => {
          let permission: PermissionLease | undefined;
          try {
            const granted = await this.host.permissions.authorize(
              entry.owner,
              context.taskId,
              { kind: 'microphone' },
              context.signal,
            );
            if (!granted.ok) throw new KernelFault(granted.error.code);
            permission = granted.value;
            if (!(await current()) || !permission.isValid()) throw new KernelFault('stale-owner');
            resolve({
              owner: entry.owner,
              signal: AbortSignal.any([context.signal, permission.signal, signal]),
              settled: task.ok ? task.value.settled : Promise.resolve(),
              valid: () =>
                !signal.aborted && !context.signal.aborted && permission?.isValid() === true,
              sourceValid,
              isCurrent: current,
            });
            await released;
          } catch (error) {
            reject(error);
            throw error;
          } finally {
            permission?.close();
          }
          return null;
        },
        { signal },
      );
      if (!task.ok) {
        reject(new KernelFault(task.error.code));
        return;
      }
      void task.value.result.then((result) => {
        if (!result.ok) reject(new KernelFault(result.error.code));
      });
      void task.value.settled.then(() => task.value.release());
    });
  }
}

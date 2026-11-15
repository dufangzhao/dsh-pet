import { randomUUID } from 'node:crypto';
import {
  SPEECH_FEATURE_PLUGIN_ID,
  SPEECH_INSTANCE_ID,
  SPEECH_CONTROL_CAPABILITY,
  makeError,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import {
  KernelFault,
  TaskMediaPeer,
  type MediaReadEndpoint,
  type MediaWriteEndpoint,
  type PermissionLease,
} from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
type SpeechHostKernel = {
  readonly manager: Pick<DesktopHost['manager'], 'isActive' | 'signal'> & {
    get(identity: { pluginId: string; instanceId: string }): { owner: OwnerRef } | null | undefined;
  };
  readonly tasks: DesktopHost['tasks'];
  readonly permissions: Pick<DesktopHost['permissions'], 'authorize'>;
  readonly permissionControl: Pick<DesktopHost['permissionControl'], 'inspect'>;
  describeTrust(owner: OwnerRef): { trusted: boolean; digest: string } | null;
  verifyTrust(owner: OwnerRef, digest: string): Promise<boolean>;
};

export interface SpeechPlaybackSource {
  readonly owner: OwnerRef;
  readonly signal: AbortSignal;
}
export interface SpeechPlaybackLease extends SpeechPlaybackSource {
  readonly taskId: string;
  readonly streamId: string;
  readonly reader: MediaReadEndpoint;
  readonly writer: MediaWriteEndpoint;
  readonly settled: Promise<void>;
  isCurrent(): Promise<boolean>;
  cancelMedia(): void;
}
export interface SpeechPlaybackHost {
  readSource(): Promise<Result<SpeechPlaybackSource>>;
  acquire(signal: AbortSignal, completion: Promise<void>): Promise<SpeechPlaybackLease>;
}
const sameOwner = (a: OwnerRef, b: OwnerRef): boolean =>
  a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation;
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
};
/** Local task/media lifetime ends after actual network pump and Pet release join. */
export class SharedSpeechHost implements SpeechPlaybackHost {
  constructor(private readonly host: SpeechHostKernel) {}
  async readSource(): Promise<Result<SpeechPlaybackSource>> {
    const identity = { pluginId: SPEECH_FEATURE_PLUGIN_ID, instanceId: SPEECH_INSTANCE_ID };
    const entry = this.host.manager.get(identity);
    const trust = entry && this.host.describeTrust(entry.owner);
    const policy = this.host.permissionControl.inspect(identity);
    const signal = entry && this.host.manager.signal(entry.owner);
    if (!entry || !signal || !this.host.manager.isActive(entry.owner))
      return { ok: false, error: makeError('not-ready', false) };
    if (
      !trust?.trusted ||
      !policy ||
      policy.blocked ||
      policy.preset === 'deny' ||
      !(await this.host.verifyTrust(entry.owner, trust.digest)) ||
      signal.aborted ||
      !this.host.manager.isActive(entry.owner)
    )
      return { ok: false, error: makeError('permission-denied', false) };
    const adopted = this.host.permissionControl.inspect(identity);
    if (!adopted || adopted.epoch !== policy.epoch || adopted.blocked || adopted.preset === 'deny')
      return { ok: false, error: makeError('permission-denied', false) };
    return { ok: true, value: { owner: entry.owner, signal } };
  }
  async acquire(signal: AbortSignal, completion: Promise<void>): Promise<SpeechPlaybackLease> {
    const source = unwrap(await this.readSource());
    const identity = { pluginId: source.owner.pluginId, instanceId: source.owner.instanceId };
    const trust = this.host.describeTrust(source.owner);
    const policy = this.host.permissionControl.inspect(identity);
    if (!trust?.trusted || !policy || signal.aborted) throw new KernelFault('stale-owner');
    const valid = () => {
      const active = this.host.permissionControl.inspect(identity);
      return (
        !signal.aborted &&
        !source.signal.aborted &&
        this.host.manager.isActive(source.owner) &&
        active?.epoch === policy.epoch &&
        !active.blocked &&
        active.preset !== 'deny'
      );
    };
    const current = async () =>
      valid() && (await this.host.verifyTrust(source.owner, trust.digest)) && valid();
    return new Promise<SpeechPlaybackLease>((resolve, reject) => {
      const task = this.host.tasks.run(
        source.owner,
        async (context) => {
          let permission: PermissionLease | undefined;
          let producer: TaskMediaPeer | undefined, consumer: TaskMediaPeer | undefined;
          try {
            permission = unwrap(
              await this.host.permissions.authorize(
                source.owner,
                context.taskId,
                { kind: 'capability-use', capability: SPEECH_CONTROL_CAPABILITY },
                context.signal,
              ),
            );
            if (!(await current()) || !permission.isValid()) throw new KernelFault('stale-owner');
            const ownedSignal = AbortSignal.any([
              signal,
              source.signal,
              context.signal,
              permission.signal,
            ]);
            const reference = {
              owner: source.owner,
              taskId: context.taskId,
              streamId: randomUUID(),
            };
            const signalFor = (owner: OwnerRef, taskId: string) =>
              sameOwner(owner, source.owner) && taskId === context.taskId ? ownedSignal : null;
            const a: TaskMediaPeer = new TaskMediaPeer({
              signalFor,
              write: async (frame) => b.receive(frame),
              control: (message) =>
                b.control({
                  ...message,
                  protocol: 1,
                  id: randomUUID(),
                  sessionId: 'speech',
                  owner: source.owner,
                }),
            });
            const b: TaskMediaPeer = new TaskMediaPeer({
              signalFor,
              write: async (frame) => a.receive(frame),
              control: (message) =>
                a.control({
                  ...message,
                  protocol: 1,
                  id: randomUUID(),
                  sessionId: 'speech',
                  owner: source.owner,
                }),
            });
            producer = a;
            consumer = b;
            const reader = unwrap(b.createReader(reference));
            const writer = unwrap(a.createWriter(reference));
            unwrap(b.grantInitial(reference));
            resolve({
              owner: source.owner,
              signal: ownedSignal,
              taskId: context.taskId,
              streamId: reference.streamId,
              reader,
              writer,
              settled: task.ok ? task.value.settled : Promise.resolve(),
              isCurrent: async () =>
                !ownedSignal.aborted && permission?.isValid() === true && (await current()),
              cancelMedia: () => {
                a.close();
                b.close();
              },
            });
            await completion;
          } catch (error) {
            reject(error);
            throw error;
          } finally {
            producer?.close();
            consumer?.close();
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

import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  companionAudienceKey,
  isCompanionInputOrigin,
  isCompanionRecordId,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type RuntimeInputAccess,
} from '@pet/companion-runtime';
import type { HostMaterialStore } from './material-store.js';
import { openOwnedFile } from './server.js';

export type ReplyAttachmentSelection = {
  readonly kind: 'artifact' | 'material';
  readonly id: string;
};
export type ReplyMaterialResolver = (
  selection: ReplyAttachmentSelection,
  origin: CompanionInputOrigin,
  access: RuntimeInputAccess,
) => Promise<CompanionMaterialRef>;
export interface ReplyMaterialOptions {
  readonly host: Pick<CompanionPluginHost, 'runFor' | 'permissions' | 'manager'>;
  readonly runtime: Pick<CompanionRuntime, 'state'>;
  readonly materials: Pick<HostMaterialStore, 'put' | 'withMaterial'>;
  readonly artifactRoots: ReadonlyMap<string, string>;
}

/** Selected canonical IDs only; participant authority and source leases stay host-private. */
export function createReplyMaterialResolver(options: ReplyMaterialOptions): ReplyMaterialResolver {
  const roots = new Map(options.artifactRoots);
  return async (selection, suppliedOrigin, suppliedAccess) => {
    if (
      !selection ||
      !['artifact', 'material'].includes(selection.kind) ||
      !isCompanionRecordId(selection.id) ||
      Object.keys(selection).length !== 2 ||
      Object.keys(selection).some((key) => key !== 'kind' && key !== 'id') ||
      !isCompanionInputOrigin(suppliedOrigin) ||
      suppliedOrigin.kind === 'legacy-unknown' ||
      suppliedAccess.scope.kind !== 'conversation' ||
      suppliedAccess.scope.principalId !== suppliedOrigin.principalId ||
      companionAudienceKey(suppliedAccess.scope.audience) !==
        companionAudienceKey(suppliedOrigin.audience)
    )
      throw new KernelFault('permission-denied');
    selection = { ...selection };
    const origin = structuredClone(suppliedOrigin);
    const scope = structuredClone(suppliedAccess.scope);
    const signal = suppliedAccess.signal;
    const checkAuthority = suppliedAccess.check.bind(suppliedAccess);
    const check = async (): Promise<void> => {
      if (signal.aborted) throw new KernelFault('permission-denied');
      await checkAuthority();
      if (signal.aborted) throw new KernelFault('permission-denied');
    };
    const access: RuntimeInputAccess = { scope, signal, check };
    await check();
    const input = await options.runtime.state('getInput', { id: origin.inputId, scope }, signal);
    if (!isDeepStrictEqual(input.origin, origin)) throw new KernelFault('permission-denied');
    await check();
    if (selection.kind === 'material') {
      return options.materials.withMaterial(
        selection.id,
        access,
        async (reference, bytes, materialSignal) => {
          // Derived provenance names this reply input; historical origins never become action grants.
          await check();
          if (reference.kind === 'voice') throw new KernelFault('unavailable');
          const id = `reply-material-${createHash('sha256')
            .update(
              JSON.stringify([
                origin.inputId,
                origin.principalId,
                companionAudienceKey(origin.audience),
                reference.id,
                reference.sha256,
              ]),
            )
            .digest('hex')}`;
          return options.materials.put(
            {
              id,
              inputId: origin.inputId,
              kind: reference.kind,
              name: reference.name,
              mediaType: reference.mediaType,
              durationMs: reference.durationMs,
            },
            bytes,
            { ...access, signal: AbortSignal.any([access.signal, materialSignal]) },
          );
        },
      );
    }
    const artifact = await options.runtime.state(
      'getArtifact',
      { id: selection.id, scope },
      signal,
    );
    await check();
    const task = await options.runtime.state('getTask', { id: artifact.taskId, scope }, signal);
    await check();
    const listed = task.artifacts.find((item) => item.id === selection.id);
    if (
      artifact.id !== selection.id ||
      task.id !== artifact.taskId ||
      (origin.kind === 'work-result' && origin.taskId !== artifact.taskId) ||
      !listed ||
      listed.taskId !== artifact.taskId ||
      listed.name !== artifact.name ||
      listed.sizeBytes !== artifact.sizeBytes ||
      listed.mediaType !== artifact.mediaType
    )
      throw new KernelFault('permission-denied');
    if (task.status !== 'completed' || task.exitCode !== 0 || task.error !== null)
      throw new KernelFault('not-ready');
    const root = roots.get(artifact.provider);
    if (!root || !path.isAbsolute(root)) throw new KernelFault('unavailable');
    const parts = artifact.relativePath.split('/');
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        parts[0] ?? '',
      ) ||
      parts[1] !== 'artifacts' ||
      parts.slice(2).join('/') !== artifact.name ||
      !artifact.name ||
      artifact.name.length > 240 ||
      !artifact.name.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(part)) ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0 ||
      artifact.sizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES
    )
      throw new KernelFault('permission-denied');
    // A stable selection/origin identity plus the store's immutable verified SHA binds retries to bytes.
    const id = `reply-artifact-${createHash('sha256')
      .update(
        JSON.stringify([
          origin.inputId,
          origin.principalId,
          companionAudienceKey(origin.audience),
          artifact.id,
          artifact.taskId,
          artifact.provider,
          artifact.relativePath,
        ]),
      )
      .digest('hex')}`;
    return withSourceAuthority(
      options.host,
      artifact.provider,
      [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
      async (sourceSignal, context) => {
        const active = options.host.manager.signal(context.owner);
        if (!active || !options.host.manager.isActive(context.owner))
          throw new KernelFault('stale-owner');
        const signal = AbortSignal.any([access.signal, sourceSignal, active]);
        const current: RuntimeInputAccess = {
          scope,
          signal,
          check: async () => {
            if (signal.aborted || !options.host.manager.isActive(context.owner))
              throw new KernelFault('permission-denied');
            await check();
            if (signal.aborted || !options.host.manager.isActive(context.owner))
              throw new KernelFault('permission-denied');
          },
        };
        await current.check();
        const file = await openOwnedFile(root, artifact.relativePath);
        try {
          const before = await file.stat();
          if (before.size !== artifact.sizeBytes) throw new KernelFault('conflict');
          const bytes: AsyncIterable<Uint8Array> = {
            async *[Symbol.asyncIterator]() {
              let position = 0;
              while (position < before.size) {
                await current.check();
                const buffer = Buffer.alloc(Math.min(65_536, before.size - position));
                const read = await file.read(buffer, 0, buffer.length, position);
                await current.check();
                if (!read.bytesRead) throw new KernelFault('conflict');
                position += read.bytesRead;
                yield buffer.subarray(0, read.bytesRead);
              }
              await current.check();
              // Reuse the same reader policy when checking that the named artifact still denotes this file.
              const named = await openOwnedFile(root, artifact.relativePath);
              try {
                const after = await file.stat(),
                  next = await named.stat();
                if (
                  [after, next].some(
                    (info) =>
                      info.dev !== before.dev ||
                      info.ino !== before.ino ||
                      info.size !== before.size ||
                      info.nlink !== 1 ||
                      info.mtimeMs !== before.mtimeMs ||
                      info.ctimeMs !== before.ctimeMs,
                  )
                )
                  throw new KernelFault('conflict');
              } finally {
                await named.close();
              }
            },
          };
          const image = artifact.mediaType.startsWith('image/');
          return await options.materials.put(
            {
              id,
              inputId: origin.inputId,
              kind: image ? 'image' : 'file',
              name: artifact.name,
              mediaType: image ? artifact.mediaType : 'application/octet-stream',
            },
            bytes,
            current,
          );
        } finally {
          await file.close();
        }
      },
      { signal },
    );
  };
}

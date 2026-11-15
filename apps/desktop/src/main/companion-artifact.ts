import { randomUUID } from 'node:crypto';
import { open, lstat, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  makeError,
  type CompanionArtifact,
  type DesktopArtifactSave,
  type Result,
} from '@pet/contracts';
import { fetchArtifact, type ClientTransport } from '@pet/text-client/protocol';
import type {
  DesktopArtifactDestination,
  DesktopCompanionSource,
} from './companion-client-types.js';

/** Private per-save provenance. Only this module records a successful physical rename. */
export interface ArtifactSaveCommit {
  readonly source: DesktopCompanionSource;
  readonly connectionId: string;
}
const committedSaves = new WeakMap<ArtifactSaveCommit, Result<DesktopArtifactSave>>();
export function isCommittedArtifactSave(
  value: unknown,
  commit: ArtifactSaveCommit | undefined,
  source: DesktopCompanionSource,
): boolean {
  return (
    commit?.source === source && committedSaves.has(commit) && committedSaves.get(commit) === value
  );
}

/** A native user choice is the only source of a local destination; bytes never cross JSON IPC. */
export async function saveCompanionArtifact(
  transport: ClientTransport,
  artifact: CompanionArtifact,
  destination: DesktopArtifactDestination,
  senderId: number,
  signal: AbortSignal,
  current: () => boolean,
  commit?: ArtifactSaveCommit,
): Promise<Result<DesktopArtifactSave>> {
  if (artifact.sizeBytes > 64 * 1024 * 1024)
    return { ok: false, error: makeError('quota-exceeded', false) };
  const selected = await destination.choose(artifact.name, senderId, signal);
  if (!current() || signal.aborted) return { ok: false, error: makeError('stale-owner', false) };
  if (selected === null)
    return { ok: true, value: { status: 'cancelled', name: artifact.name, sizeBytes: 0 } };
  if (!path.isAbsolute(selected)) return { ok: false, error: makeError('invalid-input', false) };
  const target = path.resolve(selected);
  const directory = path.dirname(target);
  const temporary = path.resolve(directory, '.companion-' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', 0o600);
  const owned = await file.stat();
  let published = false;
  try {
    const result = await fetchArtifact(transport, artifact.id, signal);
    if (!result.ok) return result;
    const response = result.value;
    const size = response.headers.get('content-length');
    if (size !== null && Number(size) !== artifact.sizeBytes) {
      await response.body?.cancel();
      return { ok: false, error: makeError('conflict', false) };
    }
    if (!response.body) return { ok: false, error: makeError('unavailable', false) };
    const reader = response.body.getReader();
    let count = 0;
    try {
      for (;;) {
        if (!current() || signal.aborted)
          return { ok: false, error: makeError('stale-owner', false) };
        const next = await reader.read();
        if (next.done) break;
        count += next.value.byteLength;
        if (count > artifact.sizeBytes || count > 64 * 1024 * 1024)
          return { ok: false, error: makeError('quota-exceeded', false) };
        // FileHandle.write may make a short write; writeFile drains the whole chunk.
        await file.writeFile(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (count !== artifact.sizeBytes) return { ok: false, error: makeError('conflict', false) };
    await file.sync();
    await file.close();
    // No publication begins after retirement; the controller waits an entered rename before replacement.
    if (!current() || signal.aborted) return { ok: false, error: makeError('stale-owner', false) };
    await rename(temporary, target);
    published = true;
    const saved: Result<DesktopArtifactSave> = {
      ok: true,
      value: { status: 'saved', name: artifact.name, sizeBytes: count },
    };
    if (commit) committedSaves.set(commit, saved);
    return saved;
  } finally {
    await file.close();
    if (!published) {
      const stat = await lstat(temporary).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null;
        throw error;
      });
      // Never remove a path substituted after the exclusive create.
      if (
        stat &&
        !stat.isSymbolicLink() &&
        stat.ino === owned.ino &&
        stat.dev === owned.dev &&
        path.dirname(temporary) === directory
      )
        await unlink(temporary);
    }
  }
}

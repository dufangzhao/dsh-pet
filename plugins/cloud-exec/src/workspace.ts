import { constants } from 'node:fs';
import { chown, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CloudExecutionArtifact, CloudExecutionRequest } from './types.js';

/** Every existing ancestor must be a real directory, including the configured root. */
export async function checkedDirectory(directory: string, create = false): Promise<string> {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error('unsafe-workspace');
  }
  return absolute;
}

export async function createWorkspace(
  root: string,
  jobId: string,
  request: CloudExecutionRequest,
): Promise<string> {
  await checkedDirectory(root, true);
  const job = path.join(root, jobId);
  await mkdir(job, { mode: 0o700 });
  const work = path.join(job, 'work');
  await mkdir(work, { mode: 0o700 });
  await writeFile(path.join(job, 'code.mjs'), request.code, { flag: 'wx', mode: 0o444 });
  for (const file of request.files ?? []) {
    const target = path.join(work, file.path);
    await checkedDirectory(path.dirname(target), true);
    await writeFile(target, file.content, { flag: 'wx', mode: 0o600 });
  }
  // Containers never run as root, even when the service itself does.
  if (process.getuid?.() === 0) {
    await chown(work, 65534, 65534);
    for (const file of request.files ?? []) {
      const target = path.join(work, file.path);
      let parent = path.dirname(target);
      while (parent !== work) {
        await chown(parent, 65534, 65534);
        parent = path.dirname(parent);
      }
      await chown(target, 65534, 65534);
    }
  }
  return job;
}

/** Called only after all container processes have stopped. Retained files are never mounted. */
export async function retainArtifacts(
  root: string,
  jobId: string,
  outputs: NonNullable<CloudExecutionRequest['outputs']>,
  maxBytes: number,
): Promise<CloudExecutionArtifact[]> {
  const job = await checkedDirectory(path.join(root, jobId));
  const work = await checkedDirectory(path.join(job, 'work'));
  const retained = path.join(job, 'artifacts');
  await checkedDirectory(retained, true);
  const artifacts: CloudExecutionArtifact[] = [];
  let bytes = 0;
  for (const output of outputs) {
    const source = path.resolve(work, output.path);
    if (!source.startsWith(`${work}${path.sep}`)) throw new Error('unsafe-artifact');
    await checkedDirectory(path.dirname(source));
    const info = await lstat(source);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      (await realpath(source)) !== source
    )
      throw new Error('unsafe-artifact');
    bytes += info.size;
    if (bytes > maxBytes) throw new Error('artifact-budget');
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: Buffer;
    try {
      const opened = await file.stat();
      if (
        !opened.isFile() ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        opened.size !== info.size
      )
        throw new Error('unsafe-artifact');
      content = Buffer.alloc(info.size);
      const result = await file.read(content, 0, content.length, 0);
      if (result.bytesRead !== info.size) throw new Error('changed-artifact');
    } finally {
      await file.close();
    }
    const target = path.join(retained, output.path);
    await checkedDirectory(path.dirname(target), true);
    try {
      const durable = await open(target, 'wx', 0o600);
      try {
        await durable.writeFile(content);
        await durable.sync();
      } finally {
        await durable.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Recovery can revisit collection after a crash between artifact publication and the receipt.
      const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await existing.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.size !== content.length ||
          !(await existing.readFile()).equals(content)
        )
          throw new Error('changed-artifact', { cause: error });
      } finally {
        await existing.close();
      }
    }
    artifacts.push({
      path: output.path,
      relativePath: `${jobId}/artifacts/${output.path}`,
      mediaType: output.mediaType ?? 'application/octet-stream',
      sizeBytes: info.size,
    });
  }
  return artifacts;
}

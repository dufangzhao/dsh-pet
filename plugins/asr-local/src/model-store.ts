import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { VOICE_INPUT_LOCAL_MODELS, type LocalAsrModel } from '@pet/contracts';
const equalPath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function localModel(id: unknown): LocalAsrModel {
  const model = VOICE_INPUT_LOCAL_MODELS.find((model) => model.id === id);
  if (!model) throw new Error('unsupported-model');
  return model;
}
export async function modelPresent(root: string, id: unknown): Promise<boolean> {
  const model = localModel(id),
    directory = path.resolve(root, model.id);
  try {
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !equalPath(await fs.realpath(directory), directory)
    )
      return false;
    for (const file of model.files) {
      const stat = await fs.lstat(path.join(directory, file.name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}
/** The engine process verifies the pinned bytes before loading; no downloader or network. */
export async function verifyLocalModel(root: string, id: unknown): Promise<Record<string, string>> {
  const model = localModel(id),
    directory = path.resolve(root, model.id);
  if (!(await modelPresent(root, id))) throw new Error('model-missing');
  const files: Record<string, string> = {};
  for (const file of model.files) {
    const target = path.join(directory, file.name),
      before = await fs.stat(target);
    const hash = createHash(file.sha256 ? 'sha256' : 'sha1');
    if (file.gitBlobSha1) hash.update(Buffer.from('blob ' + file.bytes + String.fromCharCode(0)));
    for await (const chunk of createReadStream(target, { highWaterMark: 1024 * 1024 }))
      hash.update(chunk);
    const after = await fs.stat(target);
    if (
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      hash.digest('hex') !== (file.sha256 ?? file.gitBlobSha1)
    )
      throw new Error('model-integrity');
    files[file.name] = target;
  }
  return files;
}

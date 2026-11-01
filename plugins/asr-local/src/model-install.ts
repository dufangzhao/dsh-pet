import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { LocalAsrFile } from '@pet/contracts';
import { localModel } from './model-store.js';
async function safeDirectory(directory: string): Promise<void> {
  const full = path.resolve(directory),
    parsed = path.parse(full);
  let current = parsed.root;
  for (const piece of full.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, piece);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('model-integrity');
  }
}
function hashFor(file: LocalAsrFile): ReturnType<typeof createHash> {
  const hash = createHash(file.sha256 ? 'sha256' : 'sha1');
  if (file.gitBlobSha1) hash.update('blob ' + file.bytes + String.fromCharCode(0));
  return hash;
}
async function existing(target: string, file: LocalAsrFile): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes)
    throw new Error('model-integrity');
  const hash = hashFor(file);
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  if (hash.digest('hex') !== (file.sha256 ?? file.gitBlobSha1)) throw new Error('model-integrity');
  return true;
}
function redirectAllowed(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === '443') &&
    ['modelscope.cn', 'aliyuncs.com', 'huggingface.co', 'hf.co', 'xethub.hf.co'].some(
      (host) => url.hostname === host || url.hostname.endsWith('.' + host),
    )
  );
}
async function responseFor(
  url: string,
  signal: AbortSignal,
  request: typeof fetch,
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (!redirectAllowed(current)) throw new Error('network');
    const response = await request(current, {
      signal,
      redirect: 'manual',
      headers: { accept: 'application/octet-stream' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('network');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('network');
    }
    return response;
  }
  throw new Error('network');
}
/** Fixed catalogue only; exact bytes and pinned hashes gate atomic, non-overwriting publication. */
export async function installLocalModel(
  root: string,
  id: string,
  signal: AbortSignal,
  progress: (received: number, total: number) => void,
  request: typeof fetch = fetch,
): Promise<void> {
  const model = localModel(id),
    directory = path.resolve(root, model.id),
    total = model.files.reduce((sum, file) => sum + file.bytes, 0);
  let received = 0;
  await safeDirectory(directory);
  progress(0, total);
  for (const file of model.files) {
    signal.throwIfAborted();
    const target = path.join(directory, file.name);
    if (await existing(target, file)) {
      received += file.bytes;
      progress(received, total);
      continue;
    }
    const temporary = path.join(directory, '.' + file.name + '.' + randomUUID() + '.part');
    const handle = await fs.open(temporary, 'wx');
    let count = 0;
    try {
      const response = await responseFor(file.url, signal, request),
        reader = response.body?.getReader();
      if (!reader) throw new Error('network');
      const hash = hashFor(file);
      try {
        for (;;) {
          signal.throwIfAborted();
          const item = await reader.read();
          if (item.done) break;
          count += item.value.length;
          if (count > file.bytes) throw new Error('model-integrity');
          hash.update(item.value);
          await handle.writeFile(item.value);
          progress(received + count, total);
        }
      } finally {
        await reader.cancel();
      }
      if (count !== file.bytes || hash.digest('hex') !== (file.sha256 ?? file.gitBlobSha1))
        throw new Error('model-integrity');
      await handle.sync();
      await handle.close();
      await fs.link(temporary, target);
      received += count;
      progress(received, total);
    } finally {
      await handle.close();
      await fs.rm(temporary, { force: true });
    }
  }
}

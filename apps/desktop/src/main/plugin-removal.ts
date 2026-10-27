import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { Installation, PluginSnapshot } from '@pet/host-kernel';
const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
/** Remove only a registered immediate user package; config, vault and data live elsewhere. */
export async function removeUserPlugin(
  root: string,
  plugin: PluginSnapshot,
  installation: Installation,
): Promise<boolean> {
  if (
    !path.isAbsolute(root) ||
    !path.isAbsolute(installation.directory) ||
    installation.origin !== 'user' ||
    plugin.origin !== 'user' ||
    plugin.protected
  )
    return false;
  const parent = path.resolve(root),
    directory = path.resolve(installation.directory);
  if (!samePath(path.dirname(directory), parent) || samePath(directory, parent)) return false;
  for (const target of [parent, directory]) {
    const stat = await fs.lstat(target);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(await fs.realpath(target), target)
    )
      return false;
  }
  await fs.rm(directory, { recursive: true });
  return true;
}

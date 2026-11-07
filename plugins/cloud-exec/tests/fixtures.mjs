import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { DockerExecutor, parseConfig } from '../src/index.ts';

export const owner = { pluginId: 'pet.cloud-exec', instanceId: 'test', generation: 1 };
export const image = process.env['PET_CLOUD_EXEC_IMAGE'] ?? 'pet-cloud-exec-unit:unused';
if (process.env['PET_CLOUD_EXEC_DOCKER_TEST'] === '1' && !process.env['PET_CLOUD_EXEC_IMAGE']) {
  throw new Error(
    'Set PET_CLOUD_EXEC_IMAGE to an already installed Node image; tests never pull images.',
  );
}
const scratch = fileURLToPath(new URL('../.cache/', import.meta.url));

export async function fixture(t, overrides = {}) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'test-'));
  const config = parseConfig({ image, timeoutMs: 10_000, ...overrides });
  assert.equal(config.ok, true);
  const executor = new DockerExecutor({ workspaceRoot: root, config: config.value, owner });
  t.after(async () => {
    await executor.close();
    // Verify the exact fixture root before recursive deletion; no shared data roots are used.
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), scratch.replace(/\/$/, ''));
    assert.ok(path.basename(root).startsWith('test-'));
    await rm(root, { recursive: true });
  });
  return { root, executor, config: config.value };
}

export function task(controller = new AbortController()) {
  return { taskId: randomUUID(), signal: controller.signal };
}

export async function marker(root, name = 'ready') {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    for (const job of await readdir(root)) {
      try {
        await access(path.join(root, job, 'work', name));
        return job;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await setTimeout(25);
  }
  throw new Error('job did not reach marker');
}

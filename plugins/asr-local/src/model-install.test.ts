import { afterEach, expect, it, vi } from 'vitest';
import type * as Contracts from '@pet/contracts';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.mock('@pet/contracts', async (original) => ({
  ...(await original<typeof Contracts>()),
  VOICE_INPUT_LOCAL_MODELS: [
    {
      id: 'installer-fixture',
      files: [
        {
          name: 'model.int8.onnx',
          bytes: 13,
          sha256: 'a1fff0ffefb9eace7230c24e50731f0a91c62f9cefdfe77121c2f607125dffae',
          url: 'https://huggingface.co/fixture/public/resolve/1111111111111111111111111111111111111111/model.int8.onnx',
        },
      ],
    },
  ],
}));
import { installLocalModel } from './model-install.js';
const roots: string[] = [];
async function root(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-model-install-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('publishes only measured pinned bytes, then verifies cached data without another download', async () => {
  const directory = await root(),
    progress = vi.fn(),
    request = vi.fn(async () => new Response('test content\n'));
  await installLocalModel(
    directory,
    'installer-fixture',
    new AbortController().signal,
    progress,
    request,
  );
  const target = path.join(directory, 'installer-fixture/model.int8.onnx');
  expect(await fs.readFile(target, 'utf8')).toBe('test content\n');
  expect(progress).toHaveBeenLastCalledWith(13, 13);
  await installLocalModel(
    directory,
    'installer-fixture',
    new AbortController().signal,
    progress,
    request,
  );
  expect(request).toHaveBeenCalledOnce();
});
it('rejects a failed hash, cleans the partial, and preserves an existing corrupted file', async () => {
  const directory = await root(),
    request = vi.fn(async () => new Response('wrong bytes!!'));
  await expect(
    installLocalModel(
      directory,
      'installer-fixture',
      new AbortController().signal,
      () => {},
      request,
    ),
  ).rejects.toThrow('model-integrity');
  expect(await fs.readdir(path.join(directory, 'installer-fixture'))).toEqual([]);
  await fs.writeFile(path.join(directory, 'installer-fixture/model.int8.onnx'), 'other-owner');
  request.mockClear();
  await expect(
    installLocalModel(
      directory,
      'installer-fixture',
      new AbortController().signal,
      () => {},
      request,
    ),
  ).rejects.toThrow('model-integrity');
  expect(request).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(directory, 'installer-fixture/model.int8.onnx'), 'utf8')).toBe(
    'other-owner',
  );
});
it('does not follow an unowned redirect or write through a linked cache directory', async () => {
  const directory = await root(),
    outside = await root(),
    request = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://not-a-model-source.invalid/file' },
        }),
    );
  await expect(
    installLocalModel(
      directory,
      'installer-fixture',
      new AbortController().signal,
      () => {},
      request,
    ),
  ).rejects.toThrow('network');
  expect(request).toHaveBeenCalledOnce();
  await fs.rm(path.join(directory, 'installer-fixture'), { recursive: true });
  await fs.symlink(outside, path.join(directory, 'installer-fixture'), 'junction');
  request.mockClear();
  await expect(
    installLocalModel(
      directory,
      'installer-fixture',
      new AbortController().signal,
      () => {},
      request,
    ),
  ).rejects.toThrow('model-integrity');
  expect(request).not.toHaveBeenCalled();
  expect(await fs.readdir(outside)).toEqual([]);
});

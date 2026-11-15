import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
const base = JSON.parse(
  await readFile(new URL('../model-connection-magpie/plugin.json', import.meta.url), 'utf8'),
);
const manifest = {
  ...base,
  id: 'pet.qq-participation-magpie',
  displayName: { en: 'QQ participation model', 'zh-CN': 'QQ 主动参与判断模型' },
  description: {
    en: 'Independent Magpie model binding for deciding whether to participate in a QQ group',
    'zh-CN': '通过独立的 Magpie 模型连接判断是否参与群聊',
  },
};
const manifestPath = fileURLToPath(new URL('./plugin.json', import.meta.url));
await writeFile(
  manifestPath,
  await format(JSON.stringify(manifest), {
    ...(await resolveConfig(manifestPath)),
    parser: 'json',
  }),
);
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  packages: 'external',
});

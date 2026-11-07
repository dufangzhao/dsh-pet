import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

// 源码测试直接用 Node 的类型擦除；只有 JSX 需要 esbuild 转换。
// 构建产物才走 workspace 包的正式入口。
const root = new URL('../../../', import.meta.url);

const CSS_STUB = 'data:text/javascript,export default {}';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@pet/contracts') {
      return { url: new URL('packages/contracts/src/index.ts', root).href, shortCircuit: true };
    }
    if (specifier === '@pet/ui-kit') {
      return { url: new URL('packages/ui-kit/src/index.ts', root).href, shortCircuit: true };
    }
    if (specifier.endsWith('.css')) return { url: CSS_STUB, shortCircuit: true };
    // 源码里写 `./x.js`（ESM 约定），测试时解析到同名 .ts/.tsx。
    if (
      specifier.startsWith('.') &&
      specifier.endsWith('.js') &&
      context.parentURL?.startsWith('file:')
    ) {
      for (const extension of ['.ts', '.tsx']) {
        const source = new URL(specifier.replace(/\.js$/, extension), context.parentURL);
        if (existsSync(fileURLToPath(source))) return { url: source.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const result = transformSync(source, {
      loader: 'tsx',
      format: 'esm',
      jsx: 'automatic',
      target: 'es2022',
      sourcefile: url,
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  },
});

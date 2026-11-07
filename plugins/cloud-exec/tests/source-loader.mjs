import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dependency-free source tests use Node's TS erasure. Production builds use workspace packages.
const root = new URL('../../../', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@pet/contracts') {
      return { url: new URL('packages/contracts/src/errors.ts', root).href, shortCircuit: true };
    }
    if (specifier === '@pet/plugin-sdk') {
      return { url: new URL('packages/plugin-sdk/src/index.ts', root).href, shortCircuit: true };
    }
    if (specifier.endsWith('.js') && context.parentURL?.includes('/plugins/cloud-exec/src/')) {
      const source = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(source))) return { url: source.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

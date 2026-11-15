import 'tsx';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Tests may run before the parent links new workspace packages. These are the
// real workspace modules and installed AJV, not replacements for Core or ports.
const root = new URL('../../../', import.meta.url);
const contractsRequire = createRequire(new URL('packages/contracts/package.json', root));
const ajvUrl = pathToFileURL(contractsRequire.resolve('ajv')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@pet/contracts')
      return nextResolve(new URL('packages/contracts/src/index.ts', root).href, context);
    if (specifier === '@pet/plugin-sdk')
      return nextResolve(new URL('packages/plugin-sdk/src/index.ts', root).href, context);
    if (specifier === 'ajv') return nextResolve(ajvUrl, context);
    return nextResolve(specifier, context);
  },
});

import { app } from 'electron';
import path from 'node:path';
import { createProductionLocalHost } from '../local-host/composition.js';
import { runLocalHostElectron } from '../local-host/main.js';

const profiles = process.argv.filter((argument) => argument.startsWith('--local-host-profile='));
const profile = profiles[0]?.slice('--local-host-profile='.length);
if (profiles.length !== 1 || !profile || !path.isAbsolute(profile))
  throw new Error('Local host requires one absolute private profile');

const composition = createProductionLocalHost({ dataDirectory: path.join(profile, 'plugin-data') });
// Electron must finish evaluating its entry before ready can fire.
void runLocalHostElectron({
  profileDirectory: profile,
  packageVersion: app.getVersion(),
  ...composition,
}).catch(() => {
  process.stderr.write('Local host startup failed.\n');
  app.exit(1);
});

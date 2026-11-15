import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompanionService } from '../../../apps/companion-service/src/service.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'companion-browser-'));
const token = randomUUID() + randomUUID();
const service = await createCompanionService({
  dataDirectory: path.join(root, 'data'), token, mode: 'scripted',
  ...(process.env.PET_CLOUD_EXEC_IMAGE ? { image: process.env.PET_CLOUD_EXEC_IMAGE } : {}),
});
const infoPath = path.join(root, 'connection.json');
await writeFile(infoPath, JSON.stringify({ url: service.url, token, dataDirectory: path.join(root, 'data') }),
  { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ url: service.url, infoPath }));
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void service.close().then(() => console.log('Preview closed'), () => {
    console.error('Preview cleanup was not fully confirmed');
    process.exitCode = 1;
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

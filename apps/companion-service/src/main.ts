import path from 'node:path';
import { createCompanionService } from './service.js';
import { KernelFault } from '@pet/host-kernel';

const token = process.env['COMPANION_TOKEN'];
if (!token || Buffer.byteLength(token) < 24) {
  console.error('Set COMPANION_TOKEN to an operator-chosen value of at least 24 bytes.');
  process.exitCode = 1;
} else {
  const port = Number(process.env['COMPANION_PORT'] ?? '4120');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid service port');
  const mode = process.env['COMPANION_MODE'] ?? 'scripted';
  if (mode !== 'scripted' && mode !== 'model') throw new Error('Invalid companion mode');
  try {
    const service = await createCompanionService({
      dataDirectory: path.resolve(process.env['COMPANION_DATA_DIR'] ?? '.companion-data'),
      token,
      port,
      hostname: process.env['COMPANION_HOST'] ?? '127.0.0.1',
      mode,
      ...(process.env['COMPANION_ORIGIN'] ? { publicOrigin: process.env['COMPANION_ORIGIN'] } : {}),
      ...(process.env['COMPANION_EXEC_IMAGE']
        ? { image: process.env['COMPANION_EXEC_IMAGE'] }
        : {}),
      ...(process.env['COMPANION_MODEL'] ? { model: process.env['COMPANION_MODEL'] } : {}),
      ...(process.env['COMPANION_MODEL_BASE_URL']
        ? { modelBaseUrl: process.env['COMPANION_MODEL_BASE_URL'] }
        : {}),
      ...(process.env['COMPANION_MODEL_API_KEY']
        ? { modelApiKey: process.env['COMPANION_MODEL_API_KEY'] }
        : {}),
      ...(process.env['COMPANION_NAME'] ? { name: process.env['COMPANION_NAME'] } : {}),
      ...(process.env['COMPANION_PERSONA'] ? { persona: process.env['COMPANION_PERSONA'] } : {}),
      onError: (error) => {
        if (!(error instanceof KernelFault) || error.error.code === 'internal')
          console.error('Companion request failed; inspect the retained task outcome.');
      },
    });
    console.log(`Companion text service: ${service.url}`);
    console.log(
      `Mode: ${mode === 'scripted' ? 'labeled offline script (no model call)' : 'configured model'}`,
    );
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void service.close().catch(() => {
        console.error('Service cleanup was not fully confirmed.');
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    console.error(
      `Companion could not start: ${error instanceof KernelFault ? error.error.code : 'internal'}`,
    );
    process.exitCode = 1;
  }
}

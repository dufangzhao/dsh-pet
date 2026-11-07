import { register } from 'tsx/esm/api';

register();
const { createCompanionService } = await import('../../../apps/companion-service/src/service.ts');
let service;
try {
  service = await createCompanionService({
    dataDirectory: process.env.PET_RECOVERY_ROOT,
    token: process.env.PET_RECOVERY_TOKEN,
    image: process.env.PET_RECOVERY_IMAGE,
  });
  process.on('message', async ({ id, operation }) => {
    try {
      let value = null;
      if (operation === 'reconcile') await service.runtime.reconcileExecution();
      else if (operation === 'diagnostics') value = service.runtime.diagnostics();
      else if (operation === 'close') await service.close();
      else throw new Error('Unknown fixture control operation');
      process.send({ id, value }, () => {
        if (operation === 'close') process.disconnect();
      });
    } catch (error) {
      process.send({ id, error: error.stack ?? String(error) });
    }
  });
  process.send({ type: 'ready', url: service.url });
} catch (error) {
  process.send({ type: 'fatal', error: error.stack ?? String(error) }, () => process.disconnect());
  process.exitCode = 1;
}

import { runCordisProbe } from './cordis-probe.js';

try {
  const report = await runCordisProbe();
  if (!process.send) throw new Error('M0 probe requires an owned IPC child');
  process.send({ type: 'm0.result', report });
} catch (error) {
  process.send?.({
    type: 'm0.error',
    message: error instanceof Error ? error.message : 'unknown error',
  });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}

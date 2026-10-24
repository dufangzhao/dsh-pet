import { describe, expect, it } from 'vitest';
import { verifyAsyncDisposal, verifyDependencies, verifyRollback } from './cordis-probe.js';

describe('Cordis 4.0.5 M0 acceptance', () => {
  it('waits for dependencies and reclaims resources across three cycles', async () => {
    const report = await verifyDependencies();
    expect(report.starts).toBe(3);
    expect(report.stops).toBe(3);
    expect(report.timers).toBe(0);
    expect(report.residualExternalListeners).toBe(0);
  });
  it.each(['sync', 'async'] as const)('rolls back a %s activation failure', async (mode) => {
    expect((await verifyRollback(mode)).residualResources).toBe(0);
  });
  it('awaits async cleanup, is idempotent, and rejects new effects after disposal', async () => {
    expect((await verifyAsyncDisposal()).order).toEqual(['second', 'first']);
  });
});

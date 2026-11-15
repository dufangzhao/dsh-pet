import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';

// Real service, real SQLite and real Docker plugin; no model or remote service is contacted.
export async function startService(image, name) {
  assert.ok(typeof image === 'string' && image.length > 0, 'PET_CLOUD_EXEC_IMAGE is required');
  register();
  const { createCompanionService } = await import('../../../apps/companion-service/src/service.ts');
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-desktop-qa-'));
  const token = randomUUID() + randomUUID();
  const service = await createCompanionService({ dataDirectory, token, image,
    hostname: '127.0.0.1', port: 0, mode: 'scripted', ...(name ? { name } : {}) });
  const request = async (route, body) => {
    const response = await fetch(service.url + route, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(value.ok, true, `service ${route} failed: ${response.status}`);
    return value.value;
  };
  return {
    url: service.url, token, dataDirectory, name,
    snapshot: () => request('/api/snapshot'),
    task: (id) => request(`/api/tasks/${encodeURIComponent(id)}`),
    startTask: (command) => request('/api/tasks', command),
    stopTask: (id, commandId) => request(`/api/tasks/${encodeURIComponent(id)}/stop`, { commandId }),
    async artifact(id) {
      const response = await fetch(`${service.url}/api/artifacts/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 200);
      return Buffer.from(await response.arrayBuffer());
    },
    close: () => service.close(),
  };
}

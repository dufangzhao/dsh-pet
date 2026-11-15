import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createCompanionService } from './service.js';
import type { CompanionProfileView, Result } from '@pet/contracts';
it('profile read is authenticated, bounded, canonical and exposes no raw Config', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-profile-'));
  if (
    path.dirname(directory) !== tmpdir() ||
    !path.basename(directory).startsWith('companion-profile-')
  )
    throw new Error('Unexpected temporary path');
  const token = 'profile-read-fixture-token-001';
  const service = await createCompanionService({
    dataDirectory: directory,
    token,
    name: '🙂'.repeat(40),
    persona: 'Canonical persona',
    mode: 'scripted',
  });
  try {
    expect((await fetch(service.url + '/api/profile')).status).toBe(401);
    const response = await fetch(service.url + '/api/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = (await response.json()) as Result<CompanionProfileView>;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('profile missing');
    expect(Object.keys(result.value).sort()).toEqual([
      'agentId',
      'management',
      'name',
      'persona',
      'revision',
    ]);
    expect(result.value).toMatchObject({
      agentId: (await service.runtime.snapshot()).agent.id,
      name: '🙂'.repeat(40),
      persona: 'Canonical persona',
      revision: (await service.runtime.profile()).revision,
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);
    expect(
      (
        await fetch(service.url + '/api/profile', {
          headers: { Authorization: `Bearer ${token}`, Origin: 'https://foreign.test' },
        })
      ).status,
    ).toBe(403);
    expect((await service.runtime.snapshot()).messages).toHaveLength(0);
  } finally {
    await service.close();
    await rm(directory, { recursive: true });
  }
});

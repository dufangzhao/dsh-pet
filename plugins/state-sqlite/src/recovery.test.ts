import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SqliteState } from './state.js';

it('retains verified recovery evidence without inventing a terminal outcome or duplicate event', () => {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), 'companion-state-recovery-'));
  const state = new SqliteState({ dataDirectory });
  try {
    const accepted = state.createTask({
      commandId: 'recovery-task',
      executionId: 'execution-recovery',
      title: 'Retain the partial artifact',
      code: 'await new Promise(() => {});',
    });
    if (!accepted.ok) throw new Error(accepted.error.code);
    const taskId = accepted.value.task.id;
    expect(state.updateTask({ taskId, status: 'running' }).ok).toBe(true);
    expect(state.recover().ok).toBe(true);
    const evidence = {
      taskId,
      status: 'unknown' as const,
      exitCode: 137,
      error: null,
      stdout: 'The file was written before the service stopped.',
      artifacts: [
        {
          id: 'artifact-recovery',
          taskId,
          name: 'effect.txt',
          mediaType: 'text/plain',
          sizeBytes: 5,
          provider: 'pet.cloud-exec',
          relativePath: 'job/artifacts/effect.txt',
        },
      ],
    };
    const recovered = state.updateTask(evidence);
    if (!recovered.ok) throw new Error(recovered.error.code);
    expect(recovered.value.status).toBe('unknown');
    expect(recovered.value.exitCode).toBe(137);
    expect(recovered.value.artifacts).toHaveLength(1);
    expect(state.getTaskByExecution({ executionId: 'execution-recovery' })).toEqual(recovered);
    const before = state.snapshot();
    expect(state.updateTask(evidence)).toEqual(recovered);
    expect(state.snapshot()).toEqual(before);
  } finally {
    state.close();
  }
});

import { expect, it } from 'vitest';
import { SPEECH_FORMAT, type CompanionMessage, type SpeechBegin } from '@pet/contracts';
import type { SharedSpeechPorts } from '@pet/companion-runtime';
import { SharedSpeechOutput } from './index.js';
const begin: SpeechBegin = {
  utteranceId: 'u',
  clientId: 'c',
  agentId: 'a',
  serviceEpoch: 'e',
  providerRef: 'pet.tts-magpie/magpie',
  bindingId: 'b',
  messageId: 'm',
  eventSequence: 1,
  expectedFeatureRevision: 1,
  volume: 85,
};
function ports(
  message: () => Promise<CompanionMessage & { role: 'assistant' }>,
): SharedSpeechPorts {
  return {
    bind: () => async () => {},
    settled: () => {},
    canonicalMessage: message,
    captureBinding: async () => ({
      providerRef: begin.providerRef,
      bindingId: 'b',
      sourcePluginId: 'pet.tts-magpie',
      instanceId: 'default',
      providerId: 'magpie',
      sourceGeneration: 1,
      configRevision: 1,
      credentialVersion: 'v',
      policyEpoch: 1,
      sourceFingerprint: 'fp',
      settings: {
        baseUrl: 'http://127.0.0.1:3425/v1',
        modelRef: 'xiaomi/mimo-v2.5-tts',
        authMode: 'local-client-id',
        protocol: 'mimo-native-pcm16-sse',
        voice: 'Mia',
      },
      format: SPEECH_FORMAT,
    }),
    synthesize: async () => {
      throw new Error('No native work is allowed in these admission tests');
    },
  };
}
it('same immutable fields with reordered JSON keys deduplicate, conflicting fields do not cancel the healthy intent', async () => {
  const feature = new SharedSpeechOutput(
    ports(async () => ({
      id: 'm',
      role: 'assistant',
      text: 'text',
      createdAt: 0,
      inputId: null,
      taskId: null,
    })),
    new AbortController().signal,
  );
  try {
    const receipt = await feature.begin(begin);
    const { volume, ...otherFields } = begin;
    expect(await feature.begin({ volume, ...otherFields })).toEqual(receipt);
    await expect(feature.begin({ ...begin, volume: 84 })).rejects.toMatchObject({
      error: { code: 'conflict' },
    });
    expect(
      (await feature.status({ utteranceId: 'u', clientId: 'c', agentId: 'a', serviceEpoch: 'e' }))
        .phase,
    ).toBe('planned');
  } finally {
    await feature.close();
  }
});
it('cancel-before-begin fences and cancel during canonical preparation joins actual admission work', async () => {
  let resolve: (message: CompanionMessage & { role: 'assistant' }) => void = () => {};
  const gate = new Promise<CompanionMessage & { role: 'assistant' }>((done) => {
    resolve = done;
  });
  const feature = new SharedSpeechOutput(
    ports(() => gate),
    new AbortController().signal,
  );
  const key = { utteranceId: 'u', clientId: 'c', agentId: 'a', serviceEpoch: 'e' };
  const work = feature.begin(begin).then(
    () => null,
    (error: unknown) => error,
  );
  await Promise.resolve();
  let cancelled = false;
  const cancellation = feature.cancel(key).then((value) => {
    cancelled = true;
    return value;
  });
  await Promise.resolve();
  expect(cancelled).toBe(false);
  expect((await feature.status(key)).cleanup).toBe('pending');
  resolve({ id: 'm', role: 'assistant', text: 'text', createdAt: 0, inputId: null, taskId: null });
  expect(await work).toMatchObject({ error: { code: 'cancelled' } });
  expect(await cancellation).toMatchObject({ outcome: 'cancelled', cleanup: 'settled' });
  const absent = { ...key, utteranceId: 'fence' };
  expect(await feature.cancel(absent)).toMatchObject({ receipt: null, outcome: 'cancelled' });
  await expect(feature.begin({ ...begin, ...absent })).rejects.toMatchObject({
    error: { code: 'cancelled' },
  });
  await feature.close();
});

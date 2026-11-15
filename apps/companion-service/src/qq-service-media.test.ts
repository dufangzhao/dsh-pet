import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { CompanionTask } from '@pet/contracts';
import {
  bounded,
  dockerForJob,
  hashBytes,
  mediaService,
  pngBytes,
  syntheticModel,
  tool,
  waveBytes,
  type MediaServiceFixture,
  type NativeOutput,
} from './qq-service-media-fixture.js';

const fixtures: MediaServiceFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close();
});
const byMessage =
  (id: string) =>
  (event: MediaServiceFixture['terminals'][number]): boolean =>
    event.admission.origin.kind === 'qq' && event.admission.origin.messageId === id;
function binaryBytes(): Buffer {
  const bytes = Buffer.alloc(32768);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
  return bytes;
}
function sayOnce(text: string) {
  return syntheticModel(({ input, step }) =>
    step === 0 ? [tool('say', { inputId: input.id, text })] : [],
  );
}

it('real private image/file/WAV streams cross Host media, final codec/ASR and native Core before a text receipt', async () => {
  const model = sayOnce('All three real inbound materials were handled.');
  const f = await mediaService(model.client);
  fixtures.push(f);
  await f.configureAudio();
  const image = pngBytes(),
    file = binaryBytes(),
    voice = waveBytes();
  f.assets.set('image-input', { name: 'actual.png', bytes: image });
  f.assets.set('file-input', { name: 'actual.bin', bytes: file });
  f.assets.set('voice-input', { name: 'actual.wav', bytes: voice });
  const terminal = f.terminal(byMessage('-801'));
  f.send(-801, 'private', [
    { type: 'text', data: { text: 'Inspect these current materials.' } },
    { type: 'image', data: { file: 'image-input', name: 'actual.png', file_size: image.length } },
    { type: 'file', data: { file_id: 'file-input', name: 'actual.bin', file_size: file.length } },
    { type: 'record', data: { file: 'voice-input', name: 'actual.wav', file_size: voice.length } },
  ]);
  const event = await terminal;
  expect(event.admission).toMatchObject({ phase: 'completed', cleanup: 'settled' });
  expect(event.grant.role).toBe('member');
  const message = await f.service.runtime.state('inputMessage', {
    id: event.admission.id,
    scope: { kind: 'management' },
  });
  expect(message.text).toContain('ASR_FROM_REAL_CODEC');
  expect(message.materials?.map((material) => material.kind)).toEqual(['image', 'file', 'voice']);
  for (const [index, bytes] of [image, file, voice].entries()) {
    const material = message.materials?.[index];
    if (!material) throw new Error('Missing canonical material');
    expect(material.sha256).toBe(hashBytes(bytes));
    expect(material.sizeBytes).toBe(bytes.length);
    const response = await f.request(`/api/materials/${material.id}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  }
  expect(f.asr).toHaveLength(1);
  expect(f.asr[0]?.samples).toBe(4000);
  const first = model.calls.find((call) => call.input.id === event.admission.id && call.step === 0);
  if (!first) throw new Error('No actual Core request');
  expect(first.input.text).toContain('ASR_FROM_REAL_CODEC');
  expect(first.reference.materials?.map((material) => material.kind)).toEqual([
    'image',
    'file',
    'voice',
  ]);
  expect(JSON.stringify(first.request.input)).toContain(
    `data:image/png;base64,${image.toString('base64')}`,
  );
  expect((await f.delivery(event)).outcome).toBe('accepted');
  expect(f.packets.filter((packet) => packet.action.startsWith('download_file_'))).toHaveLength(3);
  expect(f.tts).toHaveLength(0);
  expect(f.errors).toEqual([]);
}, 60000);

it('group canonical text requires an actual native acceptance before real TTS/SILK staging and record-send', async () => {
  const model = sayOnce('A complete group reply before optional voice.');
  const f = await mediaService(model.client);
  fixtures.push(f);
  await f.configureAudio();
  await f.voiceOutput(true);
  const gate = f.holdText();
  const terminal = f.terminal(byMessage('-802'));
  f.send(-802, 'group', [
    { type: 'text', data: { text: 'Reply with optional voice after text.' } },
  ]);
  const event = await terminal;
  await bounded(gate.entered, 'actual outgoing text frame');
  expect(f.tts).toHaveLength(0);
  expect(f.uploads).toHaveLength(0);
  const pending = await f.service.runtime.state('deliveries', { scope: { kind: 'management' } });
  expect(
    pending.deliveries.find((delivery) => delivery.messageIds.includes(event.outputs[0]?.id ?? ''))
      ?.outcome,
  ).toBe('pending');
  gate.release();
  const delivery = await f.delivery(event);
  expect(delivery.outcome).toBe('accepted');
  expect(f.tts).toEqual([
    { text: 'A complete group reply before optional voice.', textAccepted: true },
  ]);
  const voice = delivery.parts.find((part) => part.requirement === 'optional-voice');
  if (voice?.content.kind !== 'voice' || !voice.content.material)
    throw new Error('No actual encoded voice');
  const voiceMaterial = voice.content.material;
  expect(voiceMaterial.mediaType).toBe('audio/silk');
  const uploaded = f.uploads.find((value) => value.sha256 === voiceMaterial.sha256);
  if (!uploaded) throw new Error('No staged actual codec bytes');
  expect(uploaded.bytes.subarray(0, 10)).toEqual(Buffer.from('\x02#!SILK_V3'));
  expect(uploaded.bytes.subarray(0, 4).toString()).not.toBe('RIFF');
  expect(uploaded.bytes.length).toBe(voice.content.material.sizeBytes);
  const messages = f.packets.filter((packet) => packet.action === 'send_group_msg');
  expect(messages).toHaveLength(2);
  expect(JSON.stringify(messages[1]?.params)).toContain('record');
  expect(JSON.stringify(messages[1]?.params)).toContain(uploaded.path);
  expect(voice.upload?.receipt?.transferId).toBe(uploaded.transferId);
  expect(voice.send?.receipt?.messageId).not.toBeNull();
  expect(f.errors).toEqual([]);
}, 60000);

it('a real unknown text response leaves canonical text but starts zero TTS or upload requests', async () => {
  const f = await mediaService(sayOnce('Do not synthesize after unknown delivery.').client);
  fixtures.push(f);
  await f.configureAudio();
  await f.voiceOutput(true);
  const gate = f.holdText(),
    terminal = f.terminal(byMessage('-803'));
  f.send(-803, 'private', [
    { type: 'text', data: { text: 'A controlled uncertain text receipt.' } },
  ]);
  const event = await terminal;
  await bounded(gate.entered, 'text awaiting native receipt');
  expect(f.tts).toHaveLength(0);
  gate.release('unknown');
  const delivery = await f.delivery(event);
  expect(delivery.outcome).toBe('unknown');
  expect(delivery.parts[0]?.send?.outcome).toBe('unknown');
  expect(event.outputs[0]?.text).toBe('Do not synthesize after unknown delivery.');
  expect(f.tts).toHaveLength(0);
  expect(f.uploads).toHaveLength(0);
  expect(f.packets.filter((packet) => packet.action === 'send_private_msg')).toHaveLength(1);
}, 60000);

it('opaque binary input reaches one real pinned container and its reply-only artifact is published once after a short disconnect', async () => {
  const file = binaryBytes();
  const model = syntheticModel(({ input, reference, history, step, request }): NativeOutput => {
    if (input.kind === 'work-result') {
      expect(request.tools?.map((entry) => entry.name)).toEqual(['say']);
      if (step !== 0) return [];
      const task = history.tasks?.find((value) => value.id === input.taskId);
      const artifact = task?.artifacts.find(
        (value) => value.name === 'copy.bin' || value.name.endsWith('/copy.bin'),
      );
      if (!artifact) throw new Error('Reply-only context omitted its actual result artifact');
      return [
        tool('say', {
          inputId: input.id,
          text: 'The copied binary is attached.',
          attachments: [{ kind: 'artifact', id: artifact.id }],
        }),
      ];
    }
    if (step === 0) {
      const material = reference.materials?.find((value) => value.kind === 'file');
      if (!material) throw new Error('Current native input omitted the opaque binary material ID');
      return [
        tool('start_work', {
          inputId: input.id,
          title: 'Copy one binary input',
          materials: [{ materialId: material.id, inputName: 'incoming/source.bin' }],
          code: "import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';\nawait appendFile('effects.txt','once\\n');\nawait writeFile('started.txt','real container executing');\nawait new Promise(r=>setTimeout(r,3000));\nconst data=await readFile('incoming/source.bin');\nawait mkdir('result',{recursive:true});\nawait writeFile('result/copy.bin',data);",
          outputs: [
            { path: 'result/copy.bin', mediaType: 'application/octet-stream' },
            { path: 'effects.txt', mediaType: 'text/plain' },
          ],
        }),
      ];
    }
    return step === 1
      ? [tool('say', { inputId: input.id, text: 'The independent work was accepted.' })]
      : [];
  });
  const f = await mediaService(model.client, true);
  fixtures.push(f);
  f.assets.set('work-file', { name: 'source.bin', bytes: file });
  const started = f.started(),
    firstTerminal = f.terminal(byMessage('-804'));
  f.send(-804, 'private', [
    {
      type: 'text',
      data: {
        text: 'Create one background task to copy this binary, then send the resulting artifact.',
      },
    },
    { type: 'file', data: { file_id: 'work-file', name: 'source.bin', file_size: file.length } },
  ]);
  const first = await firstTerminal;
  expect((await f.delivery(first)).outcome).toBe('accepted');
  const job = await started;
  expect(await dockerForJob(job)).not.toBe('');
  await f.reconnect();
  const task = await f.state<CompanionTask | undefined>(
    async () => {
      const snapshot = await f.service.runtime.state('snapshot', { scope: { kind: 'management' } });
      return snapshot.tasks.find((value) => value.title === 'Copy one binary input');
    },
    (value) =>
      Boolean(
        value &&
        ['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(value.status),
      ),
  );
  if (!task) throw new Error('No terminal real worker task');
  expect(task.status).toBe('completed');
  expect(task.exitCode).toBe(0);
  const result = await f.terminal(
    (event) =>
      event.admission.origin.kind === 'work-result' && event.admission.origin.taskId === task.id,
  );
  expect(result.grant.role).toBe('reply-only');
  const delivery = await f.delivery(result);
  expect(delivery.outcome).toBe('accepted');
  const artifact = task.artifacts.find(
    (value) => value.name === 'copy.bin' || value.name.endsWith('/copy.bin'),
  );
  const effects = task.artifacts.find((value) => value.name === 'effects.txt');
  if (!artifact || !effects) throw new Error('Missing actual worker artifacts');
  expect(f.errors).toEqual([]);
  expect((await f.request(`/api/artifacts/${artifact.id}`)).status).toBe(403);
  const storedEffects = await f.service.runtime.state('getArtifact', {
    id: effects.id,
    scope: { kind: 'management' },
  });
  expect(storedEffects.provider).toBe('pet.cloud-exec');
  const ownedRoot = await realpath(path.join(f.root, 'plugin-data/pet.cloud-exec/jobs'));
  const effectsPath = path.resolve(ownedRoot, storedEffects.relativePath);
  expect(effectsPath.startsWith(`${ownedRoot}${path.sep}`)).toBe(true);
  expect(await realpath(effectsPath)).toBe(effectsPath);
  expect(await readFile(effectsPath, 'utf8')).toBe('once\n');
  const material = result.outputs.flatMap((message) => message.materials ?? [])[0];
  if (!material) throw new Error('Canonical reply did not preserve artifact material');
  expect(material.sha256).toBe(hashBytes(file));
  expect(material.sizeBytes).toBe(file.length);
  const download = await f.request(`/api/materials/${material.id}`);
  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(file);
  const staged = f.uploads.filter((value) => value.sha256 === hashBytes(file));
  expect(staged).toHaveLength(1);
  expect(staged[0]?.bytes).toEqual(file);
  const publishes = f.packets.filter((packet) => packet.action === 'upload_private_file');
  expect(publishes).toHaveLength(1);
  expect(
    f.packets.filter(
      (packet) =>
        packet.action === 'send_private_msg' &&
        JSON.stringify(packet.params['message']).includes('"type":"file"'),
    ),
  ).toHaveLength(0);
  const filePart = delivery.parts.find((part) => part.requirement === 'required-media');
  expect(filePart?.upload).toMatchObject({
    operation: 'upload-and-send',
    outcome: 'accepted',
    cleanup: 'settled',
    receipt: { fileId: 'native-file-1' },
  });
  expect(filePart?.send).toBeNull();
  expect(model.calls.filter((call) => call.input.kind === 'user' && call.step === 0)).toHaveLength(
    1,
  );
  expect(await dockerForJob(job)).toBe('');
  expect(f.errors).toHaveLength(1);
  expect(f.errors[0]).toMatchObject({ error: { code: 'permission-denied' } });
}, 60000);

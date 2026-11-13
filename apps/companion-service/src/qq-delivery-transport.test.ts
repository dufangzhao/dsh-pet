import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  makeError,
  type CompanionMaterialRef,
  type QQAccountRef,
  type QQDeliveryPart,
  type QQDeliveryView,
  type Result,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQMediaSource } from '@pet/companion-runtime';
import type { OfficialDriverHttpResult } from '../../../plugins/qq-official/src/driver.js';
import type {
  OfficialMediaInput,
  OfficialMediaResult,
  OfficialMediaIo,
  OfficialMediaOperationResult,
} from '../../../plugins/qq-official/src/media-types.js';
import {
  encodeOfficialMessage,
  type OfficialHttpReceipt,
} from '../../../plugins/qq-official/src/wire.js';
import type { OneBotCallOutcome } from '../../../plugins/qq-onebot/src/driver.js';
import type {
  SnowMediaUploadInput,
  SnowMediaOutcome,
  SnowStagedMedia,
  SnowMediaIo,
} from '../../../plugins/qq-onebot/src/media-types.js';
import { snowStagedSend, uploadSnowMedia } from '../../../plugins/qq-onebot/src/media.js';
import { uploadOfficialMedia } from '../../../plugins/qq-official/src/media.js';
import { encodeSnowMediaRequest } from '../../../plugins/qq-onebot/src/media-wire.js';
import { encodeOneBotAction, type OneBotAction } from '../../../plugins/qq-onebot/src/wire.js';
import { createQQDeliverySource } from './qq-delivery-transport.js';
import type { QQDeliveryProgress, QQDeliveryRequest } from './qq-delivery.js';

const sha = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
const empty = (): AbortSignal => new AbortController().signal;
function gate() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function account(protocol: 'official' | 'onebot-v11'): QQAccountRef {
  return {
    protocol,
    sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
    instanceId: 'default',
    accountId: '10000',
  };
}
function request(
  protocol: 'official' | 'onebot-v11',
  operation: QQDeliveryRequest['operation'] = 'send',
  bytes?: Buffer,
  kind: CompanionMaterialRef['kind'] = 'image',
): QQDeliveryRequest {
  const material: CompanionMaterialRef = {
    id: 'material-1',
    kind,
    name: 'part.bin',
    mediaType:
      kind === 'image'
        ? 'image/png'
        : kind === 'voice'
          ? 'audio/silk'
          : kind === 'text'
            ? 'text/plain'
            : 'application/octet-stream',
    sizeBytes: bytes?.length ?? 0,
    sha256: sha(bytes ?? Buffer.alloc(0)),
    durationMs: kind === 'voice' ? 20 : null,
    audience: { kind: 'person-private', principalId: 'alice' },
    originInputIds: ['input-1'],
  };
  const content: QQDeliveryPart['content'] =
    bytes !== undefined
      ? kind === 'voice'
        ? { kind: 'voice', messageIds: ['message-1'], material }
        : { kind: 'material', material }
      : { kind: 'inline-text', text: 'complete text', sha256: sha('complete text') };
  const claim = {
    id: `part-0-${operation}`,
    operation,
    phase: 'claimed' as const,
    outcome: 'pending' as const,
    correlationId: null,
    receipt: null,
    cleanup: 'pending' as const,
    startedAt: Date.now(),
    settledAt: null,
    error: null,
  };
  const part: QQDeliveryPart = {
    id: 'part-0',
    index: 0,
    requirement:
      bytes === undefined
        ? 'mandatory-text'
        : kind === 'voice'
          ? 'optional-voice'
          : 'required-media',
    content,
    preparation: 'ready',
    error: null,
    msgSeq: protocol === 'official' && operation === 'send' ? 3 : null,
    upload: operation === 'send' ? null : claim,
    send: operation === 'send' ? claim : null,
  };
  const delivery: QQDeliveryView = {
    id: 'delivery-1',
    messageIds: ['message-1'],
    origins: [],
    audience: material.audience,
    route: {
      kind: 'qq',
      account: account(protocol),
      scene: 'private',
      targetId: '20000',
      reference: {
        eventId: 'native-event',
        messageId: '-99',
        occurredAt: Date.now(),
        displayReference: null,
      },
    },
    textRepresentation: 'inline',
    mode: protocol === 'official' ? 'official-passive' : 'onebot',
    eligibilityExpiresAt: protocol === 'official' ? Date.now() + 60_000 : null,
    allowedMessageParts: 4,
    phase: 'sending',
    outcome: 'pending',
    parts: [part],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
  return {
    expectedConnectionId: 'connection-1',
    attemptId: claim.id,
    operation,
    delivery,
    part,
    check: async () => {},
    ...(bytes !== undefined && operation !== 'send' ? { material, bytes: chunks(bytes) } : {}),
  };
}
async function* chunks(bytes: Buffer) {
  for (let at = 0; at < bytes.length; at += 65_536) yield bytes.subarray(at, at + 65_536);
}
async function read(
  source: QQMediaSource,
  signal: AbortSignal,
  offset = 0,
  length = source.sizeBytes,
): Promise<Buffer> {
  const opened = await source.open(offset, length, signal);
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of opened.body) chunks.push(chunk);
  } finally {
    opened.cancel();
    await opened.settled;
  }
  return Buffer.concat(chunks);
}
function progress() {
  const values: QQDeliveryProgress[] = [];
  return {
    values,
    report: async (value: QQDeliveryProgress) => {
      values.push(structuredClone(value));
    },
  };
}
function official() {
  const controller = new AbortController();
  const check = vi.fn(async () => {});
  const nativeReceipt: Extract<OfficialHttpReceipt, { kind: 'media-upload-accepted' }> = {
    kind: 'media-upload-accepted',
    file_uuid: 'official-file',
    file_info: 'PRIVATE_FILE_INFO_TOKEN',
    ttl: 60,
    reported_message_id: null,
  };
  const send = vi.fn(
    async (
      scene: 'c2c' | 'group',
      target: string,
      payload: unknown,
      _signal: AbortSignal,
      connectionId: string,
    ): Promise<Result<OfficialDriverHttpResult>> => {
      expect(encodeOfficialMessage(scene, target, payload).ok).toBe(true);
      return {
        ok: true,
        value: {
          connectionId,
          receipt: {
            kind: 'message-accepted',
            id: 'native-message',
            timestamp: null,
            ref_idx: null,
          },
          error: null,
        },
      };
    },
  );
  const uploadMedia = vi.fn(
    async (
      input: OfficialMediaInput,
      signal: AbortSignal,
      connectionId: string,
    ): Promise<OfficialMediaOperationResult<OfficialMediaResult>> => {
      expect(sha(await read(input.source, signal))).toBe(input.source.sha256);
      return {
        ok: true,
        value: {
          connectionId,
          cleanup: 'settled',
          stage: 'inline',
          completedParts: 0,
          confirmedBytes: input.source.sizeBytes,
          receipt: nativeReceipt,
          error: null,
        },
      };
    },
  );
  const source = createQQDeliverySource({
    protocol: 'official',
    account: account('official'),
    connectionId: 'connection-1',
    signal: controller.signal,
    check,
    driver: { send, uploadMedia },
  });
  return { source, controller, check, send, uploadMedia, nativeReceipt };
}
function onebot() {
  const controller = new AbortController(),
    check = vi.fn(async () => {});
  let sequence = 0;
  const call = vi.fn(
    async (
      action: OneBotAction,
      params: unknown,
      _signal: AbortSignal,
      connectionId: string,
    ): Promise<Result<OneBotCallOutcome>> => {
      const echo = `actual-native-echo-${++sequence}`;
      expect(encodeOneBotAction(action, params, echo).ok).toBe(true);
      return {
        ok: true,
        value: {
          kind: 'response',
          connectionId,
          echo,
          response: {
            kind: 'response',
            echo,
            status: 'ok',
            retcode: 0,
            data: action.startsWith('upload_')
              ? { file_id: 'native-file', raw: 'PRIVATE_REMOTE_URL' }
              : { message_id: -47, raw: 'PRIVATE_REMOTE_URL' },
          },
        },
      };
    },
  );
  const uploadMedia = vi.fn(
    async (
      input: SnowMediaUploadInput,
      signal: AbortSignal,
      connectionId: string,
    ): Promise<Result<SnowMediaOutcome<SnowStagedMedia>>> => {
      expect(sha(await read(input.source, signal))).toBe(input.source.sha256);
      return {
        ok: true,
        value: {
          kind: 'complete',
          value: {
            connectionId,
            scene: input.scene,
            targetId: input.targetId,
            kind: input.kind,
            name: input.source.name,
            sizeBytes: input.source.sizeBytes,
            sha256: input.source.sha256,
            transferId: 'verified-transfer-id',
            remotePath: '/gateway/PRIVATE_STAGE_PATH',
          },
        },
      };
    },
  );
  const sendStaged = vi.fn(
    async (staged: SnowStagedMedia, signal: AbortSignal, connectionId: string) => {
      const encoded = snowStagedSend(staged);
      if (!encoded.ok) return encoded;
      return call(encoded.value.action, encoded.value.params, signal, connectionId);
    },
  );
  const source = createQQDeliverySource({
    protocol: 'onebot-v11',
    account: account('onebot-v11'),
    connectionId: 'connection-1',
    signal: controller.signal,
    check,
    driver: { call, uploadMedia, sendStaged },
  });
  return { source, controller, check, call, uploadMedia, sendStaged };
}
function follow(upload: QQDeliveryRequest, uploaded: unknown): QQDeliveryRequest {
  const claim = {
    id: 'part-0-send',
    operation: 'send' as const,
    phase: 'claimed' as const,
    outcome: 'pending' as const,
    correlationId: null,
    receipt: null,
    cleanup: 'pending' as const,
    startedAt: Date.now(),
    settledAt: null,
    error: null,
  };
  const part = {
    ...upload.part,
    msgSeq: upload.delivery.mode === 'onebot' ? null : 4,
    upload: null,
    send: claim,
  };
  return {
    expectedConnectionId: upload.expectedConnectionId,
    attemptId: claim.id,
    operation: 'send',
    delivery: { ...upload.delivery, parts: [part] },
    part,
    uploaded,
    check: upload.check,
  };
}

it('Official sends the frozen passive scene/target/reference/sequence and preserves only public native IDs', async () => {
  const f = official(),
    p = progress();
  const outcome = await f.source.transport.execute(request('official'), empty(), p.report);
  expect(outcome).toMatchObject({
    outcome: 'accepted',
    dispatched: true,
    cleanup: 'settled',
    error: null,
    receipt: {
      messageId: 'native-message',
      fileId: null,
      transferId: null,
      sequence: null,
      sequenceAuthoritative: null,
    },
    correlationId: null,
  });
  expect(f.send.mock.calls[0]?.slice(0, 3)).toEqual([
    'c2c',
    '20000',
    { msg_seq: 3, msg_id: '-99', msg_type: 0, content: 'complete text' },
  ]);
  expect(f.send.mock.calls[0]?.[4]).toBe('connection-1');
  const active = request('official');
  const next = { ...active, delivery: { ...active.delivery, mode: 'official-proactive' as const } };
  await f.source.transport.execute(next, empty(), p.report);
  expect(f.send.mock.calls[1]?.[2]).toEqual({ msg_seq: 3, msg_type: 0, content: 'complete text' });
});

it('Official media upload keeps the exact private receipt object and sends file_info only on the bound part', async () => {
  const f = official(),
    p = progress(),
    bytes = Buffer.from('actual image material bytes');
  const upload = request('official', 'upload', bytes);
  const uploaded = await f.source.transport.execute(upload, empty(), p.report);
  expect(uploaded.outcome).toBe('accepted');
  expect(uploaded.uploaded).toBe(f.nativeReceipt);
  expect(f.uploadMedia.mock.calls[0]?.[0]).toMatchObject({
    scene: 'c2c',
    targetId: '20000',
    fileType: 1,
  });
  expect(JSON.stringify(p.values)).not.toContain('PRIVATE');
  expect(uploaded.receipt?.fileId).toBe('official-file');
  const send = follow(upload, uploaded.uploaded);
  expect((await f.source.transport.execute(send, empty(), p.report)).outcome).toBe('accepted');
  expect(f.send.mock.calls[0]?.[2]).toEqual({
    msg_seq: 4,
    msg_id: '-99',
    msg_type: 7,
    media: { file_info: 'PRIVATE_FILE_INFO_TOKEN' },
  });
  expect(
    (
      await f.source.transport.execute(
        { ...send, uploaded: { ...f.nativeReceipt } },
        empty(),
        p.report,
      )
    ).dispatched,
  ).toBe(false);
  const wrongRoute = { ...send.delivery.route, targetId: '30000' };
  expect(
    (
      await f.source.transport.execute(
        { ...send, delivery: { ...send.delivery, route: wrongRoute } },
        empty(),
        p.report,
      )
    ).outcome,
  ).toBe('failed');
  expect(
    (
      await f.source.transport.execute(
        { ...send, delivery: { ...send.delivery, mode: 'official-proactive' } },
        empty(),
        p.report,
      )
    ).outcome,
  ).toBe('failed');
  expect(f.send).toHaveBeenCalledTimes(1);
});

it.each(['private', 'group'] as const)(
  'OneBot file/text %s performs one upload-and-send with real transfer/file IDs and actual echo',
  async (scene) => {
    for (const kind of ['file', 'text'] as const) {
      const f = onebot(),
        p = progress();
      const original = request('onebot-v11', 'upload-and-send', Buffer.from('complete file'), kind);
      const req = {
        ...original,
        delivery: { ...original.delivery, route: { ...original.delivery.route, scene } },
      };
      const outcome = await f.source.transport.execute(req, empty(), p.report);
      expect(outcome).toMatchObject({
        outcome: 'accepted',
        dispatched: true,
        receipt: { fileId: 'native-file', messageId: null, transferId: 'verified-transfer-id' },
        correlationId: 'actual-native-echo-1',
      });
      expect(p.values[0]).toMatchObject({
        receipt: { transferId: 'verified-transfer-id', fileId: null, messageId: null },
        correlationId: null,
      });
      expect(f.call).toHaveBeenCalledTimes(1);
      expect(f.sendStaged).toHaveBeenCalledTimes(1);
      expect(f.uploadMedia).toHaveBeenCalledTimes(1);
      expect(f.call.mock.calls[0]?.[0]).toBe(
        scene === 'private' ? 'upload_private_file' : 'upload_group_file',
      );
      expect(f.call.mock.calls[0]?.[1]).toMatchObject({
        upload_file: true,
        file: '/gateway/PRIVATE_STAGE_PATH',
      });
      expect(f.call.mock.calls[0]?.[3]).toBe('connection-1');
      expect(JSON.stringify(p.values)).not.toContain('PRIVATE');
      expect(JSON.stringify(outcome.receipt)).not.toContain('PRIVATE');
    }
  },
);

it('OneBot image and verified SILK stage first and send exactly once with the original opaque stage', async () => {
  for (const kind of ['image', 'voice'] as const) {
    const f = onebot(),
      p = progress();
    const bytes =
      kind === 'voice'
        ? Buffer.concat([Buffer.from('\x02#!SILK_V3'), Buffer.from([2, 0, 1, 2, 255, 255])])
        : Buffer.from('verified image fixture');
    const upload = request('onebot-v11', 'upload', bytes, kind);
    const outcome = await f.source.transport.execute(upload, empty(), p.report);
    expect(outcome.outcome).toBe('accepted');
    expect(f.call).not.toHaveBeenCalled();
    expect(outcome.receipt).toMatchObject({
      transferId: 'verified-transfer-id',
      messageId: null,
      fileId: null,
    });
    const sent = await f.source.transport.execute(
      follow(upload, outcome.uploaded),
      empty(),
      p.report,
    );
    expect(sent).toMatchObject({
      outcome: 'accepted',
      correlationId: 'actual-native-echo-1',
      receipt: { messageId: '-47', sequence: null, sequenceAuthoritative: null },
    });
    expect(f.sendStaged.mock.calls[0]?.[0]).toBe(outcome.uploaded);
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.call.mock.calls[0]?.[1]).toMatchObject({
      message: [
        {
          type: kind === 'voice' ? 'record' : 'image',
          data: { file: '/gateway/PRIVATE_STAGE_PATH' },
        },
      ],
    });
  }
  const f = onebot();
  const invalid = await f.source.transport.execute(
    request('onebot-v11', 'upload', Buffer.from('RIFF not SILK'), 'voice'),
    empty(),
    async () => {},
  );
  expect(invalid.dispatched).toBe(false);
  expect(invalid.error?.code).toBe('invalid-input');
  expect(f.uploadMedia).not.toHaveBeenCalled();
});

it('invalid frozen content, connection, target account and claim fail before I/O without fake progress', async () => {
  const f = official(),
    p = progress(),
    base = request('official');
  const changed = {
    ...base.part,
    content: { kind: 'inline-text' as const, text: 'changed', sha256: sha('original') },
  };
  const requests = [
    { ...base, expectedConnectionId: 'replacement' },
    { ...base, attemptId: 'different-claim' },
    { ...base, part: changed, delivery: { ...base.delivery, parts: [changed] } },
    { ...base, delivery: { ...base.delivery, eligibilityExpiresAt: Date.now() - 1 } },
    {
      ...base,
      delivery: {
        ...base.delivery,
        route: {
          ...base.delivery.route,
          account: { ...base.delivery.route.account, accountId: 'other' },
        },
      },
    },
  ];
  for (const req of requests)
    expect((await f.source.transport.execute(req, empty(), p.report)).dispatched).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  expect(p.values).toEqual([]);
});

it('size/hash failures and cancelled producer reads settle before returning; no upload begins', async () => {
  const f = official(),
    bytes = Buffer.from('actual');
  const base = request('official', 'upload', bytes);
  for (const patch of [{ sha256: '0'.repeat(64) }, { sizeBytes: bytes.length + 1 }]) {
    if (!base.material || base.part.content.kind !== 'material') throw new Error('fixture');
    const material = { ...base.material, ...patch },
      part = { ...base.part, content: { kind: 'material' as const, material } };
    const outcome = await f.source.transport.execute(
      {
        ...base,
        material,
        part,
        delivery: { ...base.delivery, parts: [part] },
        bytes: chunks(bytes),
      },
      empty(),
      async () => {},
    );
    expect(outcome.dispatched).toBe(false);
    expect(outcome.outcome).toBe('failed');
  }
  const started = gate(),
    released = gate(),
    abort = new AbortController();
  let closed = false,
    settled = false;
  const pending = f.source.transport
    .execute(
      {
        ...base,
        bytes: (async function* () {
          try {
            started.resolve();
            await released.promise;
            yield bytes;
          } finally {
            closed = true;
          }
        })(),
      },
      abort.signal,
      async () => {},
    )
    .then((result) => {
      settled = true;
      return result;
    });
  await started.promise;
  abort.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  released.resolve();
  expect((await pending).outcome).toBe('cancelled-before-dispatch');
  expect(closed).toBe(true);
  expect(f.uploadMedia).not.toHaveBeenCalled();
});

it('ranges enforce offset/length/EOF, use readonly views and cannot outlive execute', async () => {
  const f = official(),
    bytes = Buffer.alloc(131_080, 0x91),
    p = progress();
  let captured: QQMediaSource | undefined;
  f.uploadMedia.mockImplementation(async (input, signal, connectionId) => {
    captured = input.source;
    await expect(input.source.open(-1, 1, signal)).rejects.toBeDefined();
    await expect(input.source.open(bytes.length, 1, signal)).rejects.toBeDefined();
    expect(await read(input.source, signal, 65_530, 16)).toEqual(bytes.subarray(65_530, 65_546));
    expect(await read(input.source, signal, bytes.length, 0)).toEqual(Buffer.alloc(0));
    const range = await input.source.open(0, 4, signal),
      iterator = range.body[Symbol.asyncIterator]();
    expect(() => range.body[Symbol.asyncIterator]()).toThrow();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (first.done) throw new Error('fixture');
    expect(first.value.buffer).toBe(bytes.buffer);
    expect(first.value.byteLength).toBe(4);
    expect((await iterator.next()).done).toBe(true);
    range.cancel();
    await range.settled;
    return {
      ok: true,
      value: {
        connectionId,
        cleanup: 'settled',
        stage: 'inline',
        completedParts: 0,
        confirmedBytes: bytes.length,
        receipt: f.nativeReceipt,
        error: null,
      },
    };
  });
  expect(
    (await f.source.transport.execute(request('official', 'upload', bytes), empty(), p.report))
      .outcome,
  ).toBe('accepted');
  expect(captured).toBeDefined();
  if (!captured) throw new Error('fixture');
  await expect(captured.open(0, 1, empty())).rejects.toBeDefined();
});

it('fresh participant checks run after range awaits; incomplete readers are closed and fence later sends', async () => {
  const f = official(),
    bytes = Buffer.from('protected material');
  let allowed = true,
    closed = false;
  const req = {
    ...request('official', 'upload', bytes),
    check: async () => {
      if (!allowed) throw new KernelFault('permission-denied');
    },
  };
  f.uploadMedia.mockImplementation(async (input, signal, connectionId) => {
    const range = await input.source.open(0, bytes.length, signal),
      iterator = range.body[Symbol.asyncIterator]();
    await iterator.next();
    allowed = false;
    await expect(iterator.next()).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    range.cancel();
    await range.settled;
    closed = true;
    return {
      ok: true,
      value: {
        connectionId,
        cleanup: 'settled',
        stage: 'inline',
        completedParts: 0,
        confirmedBytes: 0,
        receipt: { kind: 'unknown', httpStatus: 0, reason: 'invalid-response' },
        error: makeError('permission-denied'),
      },
    };
  });
  const outcome = await f.source.transport.execute(req, empty(), async () => {});
  expect(outcome.outcome).toBe('unknown');
  expect(closed).toBe(true);
  expect(f.source.signal.aborted).toBe(true);
  await f.source.transport.execute(request('official'), empty(), async () => {});
  expect(f.send).not.toHaveBeenCalled();
});

it('known native pre-dispatch refusal remains definite while started cancellation waits for real settlement', async () => {
  const f = onebot(),
    p = progress();
  f.call.mockResolvedValueOnce({ ok: false, error: makeError('permission-denied', false) });
  const refused = await f.source.transport.execute(request('onebot-v11'), empty(), p.report);
  expect(refused).toMatchObject({
    dispatched: false,
    outcome: 'failed',
    receipt: null,
    correlationId: null,
  });
  expect(p.values).toEqual([]);
  const started = gate(),
    released = gate(),
    abort = new AbortController();
  let settled = false;
  f.call.mockImplementation(async (_action, _params, _signal, connectionId) => {
    started.resolve();
    await released.promise;
    return {
      ok: true,
      value: {
        kind: 'unknown',
        connectionId,
        echo: 'real-after-write-echo',
        error: makeError('cancelled'),
      },
    };
  });
  const pending = f.source.transport
    .execute(request('onebot-v11'), abort.signal, p.report)
    .then((value) => {
      settled = true;
      return value;
    });
  await started.promise;
  abort.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  released.resolve();
  expect(await pending).toMatchObject({
    dispatched: true,
    outcome: 'unknown',
    cleanup: 'settled',
    correlationId: 'real-after-write-echo',
  });
});

it('conclusive receipt survives post-receipt grant withdrawal and blocks further I/O', async () => {
  const f = official(),
    p = progress();
  let allowed = true;
  const req = {
    ...request('official'),
    check: async () => {
      if (!allowed) throw new KernelFault('permission-denied');
    },
  };
  f.send.mockImplementation(async (_scene, _target, _payload, _signal, connectionId) => {
    allowed = false;
    return {
      ok: true,
      value: {
        connectionId,
        receipt: { kind: 'message-accepted', id: 'already-sent', timestamp: null, ref_idx: null },
        error: null,
      },
    };
  });
  expect(await f.source.transport.execute(req, empty(), p.report)).toMatchObject({
    outcome: 'accepted',
    receipt: { messageId: 'already-sent' },
    error: { code: 'permission-denied' },
  });
  expect(p.values.at(-1)?.receipt?.messageId).toBe('already-sent');
  expect(f.source.signal.aborted).toBe(true);
  await f.source.transport.execute(req, empty(), p.report);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it('known upload receipt survives an incomplete reader; settled reports actual cleanup and fences follow-on I/O', async () => {
  const f = official(),
    bytes = Buffer.from('material'),
    p = progress();
  let settled = false;
  f.uploadMedia.mockImplementation(async (input, signal, connectionId) => {
    const range = await input.source.open(0, bytes.length, signal);
    await range.body[Symbol.asyncIterator]().next();
    range.cancel();
    await range.settled;
    settled = true;
    return {
      ok: true,
      value: {
        connectionId,
        cleanup: 'settled',
        stage: 'inline',
        completedParts: 0,
        confirmedBytes: bytes.length,
        receipt: f.nativeReceipt,
        error: null,
      },
    };
  });
  const uploaded = await f.source.transport.execute(
    request('official', 'upload', bytes),
    empty(),
    p.report,
  );
  expect(settled).toBe(true);
  expect(uploaded).toMatchObject({
    outcome: 'accepted',
    receipt: { fileId: 'official-file' },
    cleanup: 'settled',
    error: { code: 'invalid-input' },
  });
  expect(f.source.signal.aborted).toBe(true);
  await f.source.transport.execute(request('official'), empty(), p.report);
  expect(f.send).not.toHaveBeenCalled();
});

it('actual Official multipart media algorithm consumes scoped ranges and never sends during upload', async () => {
  const f = official(),
    bytes = Buffer.alloc(6 * 1024 * 1024, 0x93),
    p = progress();
  const parts: number[] = [],
    finishes: number[] = [];
  const io: OfficialMediaIo = {
    inline: async () => {
      throw new Error('unexpected inline');
    },
    readAttachment: async () => {
      throw new Error('unexpected download');
    },
    prepare: async (metadata, hashes) => {
      expect(hashes.sha256).toBe(sha(bytes));
      expect(metadata.file_type).toBe(4);
      const block = 3 * 1024 * 1024;
      return {
        ok: true,
        value: {
          kind: 'prepared',
          plan: {
            upload_id: 'real-upload-id',
            block_size: block,
            parts: [
              { index: 0, offset: 0, byteLength: block },
              { index: 1, offset: block, byteLength: block },
            ],
          },
        },
      };
    },
    putPart: async (input, body) => {
      let count = 0;
      for await (const chunk of body) count += chunk.byteLength;
      expect(count).toBe(input.byteLength);
      parts.push(input.part_index);
      return { ok: true, value: { status: 200, body: '' } };
    },
    finishPart: async (input) => {
      finishes.push(input.part_index);
      return { ok: true, value: { status: 200, body: '{}' } };
    },
    commit: async (input) => {
      expect(input).toMatchObject({
        scene: 'c2c',
        targetId: '20000',
        upload_id: 'real-upload-id',
        srv_send_msg: false,
      });
      return {
        ok: true,
        value: {
          status: 200,
          body: JSON.stringify({
            file_uuid: 'native-multipart-file',
            file_info: 'PRIVATE_MULTIPART_TOKEN',
            ttl: 60,
          }),
        },
      };
    },
  };
  f.uploadMedia.mockImplementation((input, signal, connectionId) =>
    uploadOfficialMedia(io, input, connectionId, signal),
  );
  const result = await f.source.transport.execute(
    request('official', 'upload', bytes, 'file'),
    empty(),
    p.report,
  );
  expect(result).toMatchObject({
    outcome: 'accepted',
    receipt: { fileId: 'native-multipart-file' },
    cleanup: 'settled',
    error: null,
  });
  expect(parts).toEqual([0, 1]);
  expect(finishes).toEqual([0, 1]);
  expect(f.send).not.toHaveBeenCalled();
  expect(JSON.stringify(p.values)).not.toContain('PRIVATE');
});

it('actual OneBot media frames complete staging before its single file publication', async () => {
  const f = onebot(),
    bytes = Buffer.alloc(110_000, 0x85),
    p = progress();
  let chunks = 0,
    size = 0,
    finishes = 0,
    closes = 0,
    seq = 0;
  const hash = createHash('sha256');
  const media: SnowMediaIo = {
    openMedia(input) {
      expect(encodeSnowMediaRequest(input).ok).toBe(true);
      if (input.action !== 'upload_file_stream') throw new Error('unexpected download');
      let data: unknown;
      if (input.params.is_complete) {
        finishes++;
        expect(size).toBe(bytes.length);
        expect(hash.digest('hex')).toBe(input.params.expected_sha256);
        data = {
          type: 'response',
          status: 'file_complete',
          stream_id: input.params.stream_id,
          file_path: '/gateway/PRIVATE_NATIVE_PATH',
          file_name: input.params.filename,
          file_size: size,
          sha256: sha(bytes),
          received_chunks: chunks,
          total_chunks: input.params.total_chunks,
        };
      } else {
        if (!input.chunk) throw new Error('missing chunk');
        expect(input.chunk.index).toBe(chunks);
        chunks++;
        size += input.chunk.bytes.byteLength;
        hash.update(input.chunk.bytes);
        data = {
          type: 'stream',
          status: 'chunk_received',
          stream_id: input.params.stream_id,
          received_chunks: chunks,
          total_chunks: input.params.total_chunks,
        };
      }
      let done: () => void = () => {},
        closed = false;
      const settled = new Promise<void>((resolve) => {
        done = resolve;
      });
      return {
        sent: Promise.resolve({ ok: true, value: null }),
        settled,
        frames: (async function* () {
          yield JSON.stringify({
            status: 'ok',
            retcode: 0,
            echo: input.echo,
            stream: 'stream-action',
            data,
          });
        })(),
        close: async () => {
          if (!closed) {
            closed = true;
            closes++;
            done();
          }
        },
      };
    },
  };
  f.uploadMedia.mockImplementation((input, signal, connectionId) =>
    uploadSnowMedia(
      media,
      input,
      connectionId,
      () => `qq-media:00000000-0000-4000-8000-000000000001:${++seq}`,
      signal,
    ),
  );
  const result = await f.source.transport.execute(
    request('onebot-v11', 'upload-and-send', bytes, 'file'),
    empty(),
    p.report,
  );
  expect(result.outcome).toBe('accepted');
  expect(result.receipt?.fileId).toBe('native-file');
  expect(result.receipt?.transferId).toMatch(/^qqm_/);
  expect(finishes).toBe(1);
  expect(closes).toBe(chunks + 1);
  expect(f.sendStaged).toHaveBeenCalledTimes(1);
  expect(f.call).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(p.values)).not.toContain('PRIVATE');
});

it('compound staging progress cannot authorize publication after a fresh participant refusal', async () => {
  const f = onebot(),
    bytes = Buffer.from('file');
  let allowed = true;
  const req = {
    ...request('onebot-v11', 'upload-and-send', bytes, 'file'),
    check: async () => {
      if (!allowed) throw new KernelFault('permission-denied');
    },
  };
  const result = await f.source.transport.execute(req, empty(), async (value) => {
    if (value.receipt?.transferId && !value.receipt.fileId) allowed = false;
  });
  expect(result).toMatchObject({
    dispatched: true,
    outcome: 'failed',
    receipt: { transferId: 'verified-transfer-id', fileId: null },
    error: { code: 'permission-denied' },
  });
  expect(f.sendStaged).not.toHaveBeenCalled();
  expect(f.call).not.toHaveBeenCalled();
});

it('unknown media transfer exposes no invented transfer ID or wire echo', async () => {
  const f = onebot(),
    p = progress();
  f.uploadMedia.mockResolvedValue({
    ok: true,
    value: {
      kind: 'unknown',
      connectionId: 'connection-1',
      confirmedBytes: 17,
      confirmedChunks: 1,
      error: makeError('network'),
      retcode: null,
    },
  });
  const result = await f.source.transport.execute(
    request('onebot-v11', 'upload', Buffer.from('image')),
    empty(),
    p.report,
  );
  expect(result).toMatchObject({
    outcome: 'unknown',
    dispatched: true,
    receipt: null,
    correlationId: null,
  });
  expect(f.sendStaged).not.toHaveBeenCalled();
  expect(JSON.stringify(p.values)).not.toContain('part-0-upload');
});

it('a returned wrong-connection receipt is uncertain dispatched work, never a retry on the replacement', async () => {
  const f = official();
  f.send.mockResolvedValue({
    ok: true,
    value: {
      connectionId: 'replacement',
      receipt: {
        kind: 'message-accepted',
        id: 'other-connection-message',
        timestamp: null,
        ref_idx: null,
      },
      error: null,
    },
  });
  const result = await f.source.transport.execute(request('official'), empty(), async () => {});
  expect(result).toMatchObject({
    outcome: 'unknown',
    dispatched: true,
    receipt: null,
    error: { code: 'stale-owner' },
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0]?.[4]).toBe('connection-1');
  expect(f.source.signal.aborted).toBe(true);
});

it.each(['native', 'progress'] as const)(
  'known receipt survives a %s post-effect failure and forbids follow-on I/O',
  async (mode) => {
    const f = official();
    f.send.mockResolvedValue({
      ok: true,
      value: {
        connectionId: 'connection-1',
        receipt: {
          kind: 'message-accepted',
          id: 'effect-already-known',
          timestamp: null,
          ref_idx: null,
        },
        error: mode === 'native' ? makeError('unavailable', false) : null,
      },
    });
    const result = await f.source.transport.execute(request('official'), empty(), async (value) => {
      expect(value.receipt?.messageId).toBe('effect-already-known');
      if (mode === 'progress') throw new KernelFault('unavailable');
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      dispatched: true,
      receipt: { messageId: 'effect-already-known' },
      error: { code: 'unavailable' },
    });
    expect(f.source.signal.aborted).toBe(true);
    await f.source.transport.execute(request('official'), empty(), async () => {});
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);

it('native cleanup failure is independent of a known upload receipt and blocks later I/O', async () => {
  const f = official(),
    bytes = Buffer.from('verified bytes'),
    p = progress();
  f.uploadMedia.mockImplementation(async (input, signal, connectionId) => {
    await read(input.source, signal);
    return {
      ok: true,
      value: {
        connectionId,
        cleanup: 'failed',
        stage: 'inline',
        completedParts: 0,
        confirmedBytes: bytes.length,
        receipt: f.nativeReceipt,
        error: makeError('unavailable', false),
      },
    };
  });
  const uploaded = await f.source.transport.execute(
    request('official', 'upload', bytes),
    empty(),
    p.report,
  );
  expect(uploaded).toMatchObject({
    outcome: 'accepted',
    dispatched: true,
    receipt: { fileId: 'official-file' },
    cleanup: 'failed',
    error: { code: 'unavailable' },
  });
  expect(uploaded.uploaded).toBe(f.nativeReceipt);
  expect(f.source.signal.aborted).toBe(true);
  await f.source.transport.execute(request('official'), empty(), p.report);
  expect(f.send).not.toHaveBeenCalled();
});

it('native pre-dispatch cleanup failure stays definitely unsent and physically failed', async () => {
  const f = official();
  f.uploadMedia.mockResolvedValue({
    ok: false,
    error: makeError('unavailable', false),
    cleanup: 'failed',
  });
  const outcome = await f.source.transport.execute(
    request('official', 'upload', Buffer.from('bytes')),
    empty(),
    async () => {},
  );
  expect(outcome).toMatchObject({
    outcome: 'failed',
    dispatched: false,
    receipt: null,
    cleanup: 'failed',
  });
  expect(f.source.signal.aborted).toBe(true);
  expect(f.send).not.toHaveBeenCalled();
});

it('OneBot async/null-file/unknown results never become accepted or trigger another send', async () => {
  for (const mode of ['async', 'null-file', 'unknown'] as const) {
    const f = onebot(),
      p = progress();
    f.call.mockImplementation(async (_action, _params, _signal, connectionId) => {
      const echo = 'actual-wire-echo';
      if (mode === 'unknown')
        return {
          ok: true,
          value: { kind: 'unknown', connectionId, echo, error: makeError('network') },
        };
      return {
        ok: true,
        value: {
          kind: 'response',
          connectionId,
          echo,
          response: {
            kind: 'response',
            echo,
            status: mode === 'async' ? 'async' : 'ok',
            retcode: mode === 'async' ? 1 : 0,
            data: mode === 'async' ? null : { file_id: null },
          },
        },
      };
    });
    const outcome = await f.source.transport.execute(
      request('onebot-v11', 'upload-and-send', Buffer.from('file'), 'file'),
      empty(),
      p.report,
    );
    expect(outcome).toMatchObject({
      outcome: 'unknown',
      dispatched: true,
      receipt: { transferId: 'verified-transfer-id', fileId: null },
      correlationId: 'actual-wire-echo',
    });
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.sendStaged).toHaveBeenCalledTimes(1);
  }
});

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  QQ_FEATURE_PLUGIN_ID,
  QQ_REPLY_TEXT_SEPARATOR,
  defaultQQPolicySettings,
  makeError,
  isQQDeliveryPartAccepted,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
  type CompanionMessage,
  type PluginManifest,
  type QQProtocol,
  type QQRemoteReceipt,
} from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  CompanionPluginHost,
  CompanionRuntime,
  companionHostDefinition,
  companionHostManifest,
  inputScope,
  type RuntimeInputAccess,
  type RuntimeInputGrant,
  type ServicePluginRegistration,
} from '@pet/companion-runtime';
import stateDefinition from '@pet/state-sqlite';
import { HostMaterialStore } from './material-store.js';
import {
  QQDeliveryController,
  type QQDeliveryRequest,
  type QQDeliveryTerminal,
  type QQDeliveryTransport,
} from './qq-delivery.js';
import { deliveryId, inlineText, textHash } from './qq-delivery-plan.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  cleanups.push(async () => resolve());
  return { promise, resolve };
}
const identity = { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' };
const receipt = (value: Partial<QQRemoteReceipt>): QQRemoteReceipt => ({
  messageId: null,
  fileId: null,
  transferId: null,
  sequence: null,
  sequenceAuthoritative: null,
  ...value,
});
async function fixture(voice = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-qq-delivery-'));
  const stateManifest = JSON.parse(
    await readFile(new URL('../../../plugins/state-sqlite/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const feature: PluginManifest = {
    ...companionHostManifest,
    id: QQ_FEATURE_PLUGIN_ID,
    provides: [],
    consumes: [],
    permissions: [],
    config: {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['voiceOutputEnabled', 'roleAllowed', 'probability'],
        properties: {
          voiceOutputEnabled: { type: 'boolean', default: voice },
          roleAllowed: { type: 'boolean', default: true },
          probability: { type: 'number', minimum: 0, maximum: 1, default: 0.1 },
        },
      },
    },
  };
  const plugins: ServicePluginRegistration[] = [];
  for (const manifest of [companionHostManifest, feature, stateManifest]) {
    const location = path.join(directory, 'packages', manifest.id);
    await mkdir(location, { recursive: true });
    await writeFile(path.join(location, 'plugin.json'), JSON.stringify(manifest));
    plugins.push({
      manifest,
      directory: location,
      enabled: true,
      preset: 'allow',
      ...(manifest.id === stateManifest.id ? { dataDirectory: path.join(directory, 'state') } : {}),
      definition:
        manifest.id === companionHostManifest.id
          ? companionHostDefinition
          : manifest.id === stateManifest.id
            ? stateDefinition
            : definePlugin({ activate() {} }),
    });
  }
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'host'),
    plugins,
  });
  host.bind('companion.state@1', stateManifest.id, 'sqlite');
  const runtime = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: stateManifest.id,
    stateProviderId: 'sqlite',
    executionPluginId: 'pet.cloud-exec',
    executionProviderId: 'docker',
    executionTimeoutMs: 30000,
  });
  const materials = await HostMaterialStore.create({ directory, host, state: runtime });
  const requests: QQDeliveryRequest[] = [];
  const documents: string[] = [];
  let voiceCalls = 0,
    sourceCalls = 0,
    sourceMissing = false,
    activeAllowed = false;
  let currentConnection = 'connection-A';
  let currentSource = new AbortController();
  let behavior: QQDeliveryTransport['execute'] | undefined;
  let voiceBehavior: ((access: RuntimeInputAccess) => Promise<CompanionMaterialRef>) | undefined;
  const policy = async () => {
    const value = await host.configs.get(identity);
    if (!value.ok) throw new KernelFault(value.error.code);
    return {
      revision: value.value.revision,
      settings: {
        ...defaultQQPolicySettings(),
        voiceOutputEnabled: value.value.data['voiceOutputEnabled'] === true,
      },
    };
  };
  const allowed = async () => {
    const config = await host.configs.get(identity);
    if (!config.ok || config.value.data['roleAllowed'] !== true)
      throw new KernelFault('permission-denied');
  };
  const sender = new QQDeliveryController({
    host,
    runtime,
    materials,
    policy,
    audio: {
      async exportVoice(input, access) {
        voiceCalls++;
        const stored = await runtime.state('getDelivery', {
          id: input.deliveryId,
          scope: access.scope,
        });
        expect(
          stored.parts
            .filter((part) => part.requirement === 'mandatory-text')
            .every(isQQDeliveryPartAccepted),
        ).toBe(true);
        if (voiceBehavior) return voiceBehavior(access);
        throw new KernelFault('unavailable');
      },
    },
    allowOfficialProactive: async () => activeAllowed,
    sourceFor(account) {
      sourceCalls++;
      if (sourceMissing) throw new KernelFault('not-ready');
      const connectionId = currentConnection,
        source = currentSource;
      return {
        account,
        connectionId,
        signal: source.signal,
        async check() {
          if (source.signal.aborted || connectionId !== currentConnection)
            throw new KernelFault('stale-owner');
        },
        transport: {
          async execute(request, signal, progress) {
            requests.push(request);
            if (behavior) return behavior(request, signal, progress);
            if (request.bytes) {
              const chunks: Uint8Array[] = [];
              for await (const chunk of request.bytes) chunks.push(chunk);
              if (request.material?.kind === 'text')
                documents.push(Buffer.concat(chunks).toString('utf8'));
            }
            if (request.operation === 'upload-and-send') {
              await progress({
                dispatched: true,
                receipt: receipt({ transferId: `transfer-${request.part.index}` }),
              });
              return {
                dispatched: true,
                outcome: 'accepted',
                cleanup: 'settled',
                receipt: receipt({ fileId: `file-${request.part.index}` }),
                error: null,
              };
            }
            if (request.operation === 'upload')
              return {
                dispatched: true,
                outcome: 'accepted',
                cleanup: 'settled',
                receipt: receipt({ fileId: `file-${request.part.index}` }),
                uploaded: { opaque: 'HOST_PRIVATE_UPLOAD_TOKEN' },
                error: null,
              };
            return {
              dispatched: true,
              outcome: 'accepted',
              cleanup: 'settled',
              receipt: receipt({ messageId: `message-${request.part.index}` }),
              error: null,
            };
          },
        },
      };
    },
  });
  cleanups.push(async () => {
    await sender.close();
    await materials.close();
    await runtime.close();
    await host.close();
  });
  const accessFor = (grant: RuntimeInputGrant): RuntimeInputAccess => ({
    signal: grant.signal,
    scope: inputScope(grant.origin),
    check: async () => {
      await allowed();
      grant.signal.throwIfAborted();
    },
  });
  async function terminal(
    id: string,
    bodies: readonly string[],
    options: {
      protocol?: QQProtocol;
      scene?: 'private' | 'group';
      reference?: string;
      expired?: boolean;
      passiveRemainingMs?: number;
      documents?: readonly number[];
      attachments?: readonly { at: number; kind: 'file' | 'text'; text: string }[];
      cleanupFailed?: boolean;
    } = {},
  ): Promise<QQDeliveryTerminal> {
    const protocol = options.protocol ?? 'official',
      scene = options.scene ?? 'group';
    const account = {
      protocol,
      sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
      instanceId: 'default' as const,
      accountId: protocol === 'official' ? 'fixture-bot' : '10001',
    };
    const senderId = protocol === 'official' ? 'member-sender' : '20001',
      groupId = protocol === 'official' ? 'fixture-group' : '30001';
    const audience =
      scene === 'group'
        ? { kind: 'qq-group' as const, account, groupId }
        : { kind: 'person-private' as const, principalId: 'member' };
    const reference = {
      eventId: `event-${id}`,
      messageId: options.reference ?? (protocol === 'official' ? `native-${id}` : '40001'),
      occurredAt:
        Date.now() -
        (options.expired
          ? 6 * 60000
          : options.passiveRemainingMs !== undefined
            ? 5 * 60000 - options.passiveRemainingMs
            : 0),
      displayReference: null,
    };
    const origin: CompanionInputOrigin = {
      kind: 'qq',
      inputId: id,
      principalId: 'member',
      audience,
      policyRevision: (await policy()).revision,
      actor:
        scene === 'group' ? { account, scene, senderId, groupId } : { account, scene, senderId },
      eventKey: `event-${id}`,
      messageId: reference.messageId,
      trigger: scene === 'group' ? 'mention' : 'direct',
      quote: null,
      route: {
        kind: 'qq',
        account,
        scene,
        targetId: scene === 'group' ? groupId : senderId,
        reference,
      },
    };
    const grant: RuntimeInputGrant = {
      origin,
      role: 'member',
      signal: new AbortController().signal,
      check: allowed,
    };
    const access = accessFor(grant);
    await runtime.state('createInput', {
      id,
      commandId: `input-${id}`,
      origin,
      evidence: {},
      materialIds: [],
    });
    await runtime.state('commitInput', { id, text: 'controlled input' });
    await runtime.state('claimInput', { id });
    const outputs: CompanionMessage[] = [];
    for (const [at, body] of bodies.entries()) {
      let content: CompanionMessage['content'];
      const refs: CompanionMaterialRef[] = [];
      if (options.documents?.includes(at)) {
        const material = await materials.storeFullText(
          { id: `semantic-${id}-${at}`, text: body, origin },
          access,
        );
        content = { kind: 'text-document', material };
        refs.push(material);
      }
      for (const attachment of options.attachments?.filter((item) => item.at === at) ?? []) {
        const material = await materials.put(
          { inputId: id, kind: attachment.kind, name: `attachment-${at}.txt` },
          (async function* () {
            yield Buffer.from(attachment.text);
          })(),
          access,
        );
        refs.push(material);
      }
      outputs.push(
        await runtime.state('appendMessage', {
          id: `reply-${id}-${at}`,
          role: 'assistant',
          inputId: id,
          text: content ? 'SEMANTIC_DOCUMENT_STUB' : body,
          audience,
          origins: [origin],
          ...(content ? { content } : {}),
          ...(refs.length ? { materials: refs } : {}),
        }),
      );
    }
    const admission = await runtime.state('updateInput', {
      id,
      phase: options.cleanupFailed ? 'unknown' : 'completed',
      cleanup: options.cleanupFailed ? 'failed' : 'settled',
      error: options.cleanupFailed ? makeError('unavailable') : null,
    });
    return { admission, contextId: `context-${id}`, outputs, grant };
  }
  const configure = async (patch: {
    voiceOutputEnabled?: boolean;
    roleAllowed?: boolean;
    probability?: number;
  }) => {
    const current = await host.configs.get(identity);
    if (!current.ok) throw new KernelFault(current.error.code);
    const saved = await host.configs.save(
      identity,
      { ...current.value.data, ...patch },
      current.value.revision,
    );
    if (!saved.ok) throw new KernelFault(saved.error.code);
  };
  return {
    sender,
    runtime,
    host,
    materials,
    requests,
    documents,
    terminal,
    configure,
    accessFor,
    voiceCalls: () => voiceCalls,
    sourceCalls: () => sourceCalls,
    setBehavior(value: QQDeliveryTransport['execute']) {
      behavior = value;
    },
    setVoice(value: (access: RuntimeInputAccess) => Promise<CompanionMaterialRef>) {
      voiceBehavior = value;
    },
    missing(value: boolean) {
      sourceMissing = value;
    },
    active(value: boolean) {
      activeAllowed = value;
    },
    reconnect() {
      currentSource.abort();
      currentSource = new AbortController();
      currentConnection = 'connection-B';
    },
  };
}

it('keeps Unicode/CRLF exact and freezes every formal say/message origin in order', async () => {
  const f = await fixture();
  const first = 'a'.repeat(1023) + '\r\n',
    second = '𠮷🙂 tail';
  const event = await f.terminal('multisay', [first, second]);
  const delivered = await f.sender.onTerminal(event);
  expect(delivered?.outcome).toBe('accepted');
  expect(delivered?.messageIds).toEqual(event.outputs.map((message) => message.id));
  expect(delivered?.origins).toEqual([event.admission.origin]);
  expect(f.requests.every((request) => request.expectedConnectionId === 'connection-A')).toBe(true);
  const chunks = f.requests.map((request) =>
    request.part.content.kind === 'inline-text' ? request.part.content.text : '',
  );
  expect(chunks.join('')).toBe(first + QQ_REPLY_TEXT_SEPARATOR + second);
  expect(chunks[0]?.endsWith('\r')).toBe(false);
  expect(f.requests.map((request) => request.part.msgSeq)).toEqual([1, 2]);
  expect(inlineText('x'.repeat(1023) + '🙂' + 'z')).toEqual(['x'.repeat(1023), '🙂z']);
});

it('resolves complete semantic documents and keeps compound transfer progress as a file receipt', async () => {
  const f = await fixture();
  const complete = 'complete semantic text '.repeat(180);
  const event = await f.terminal('long', [complete, 'SECOND FORMAL SAY'], {
    protocol: 'onebot-v11',
    documents: [0],
  });
  const result = await f.sender.onTerminal(event);
  expect(result?.outcome).toBe('accepted');
  expect(result?.textRepresentation).toBe('text-document');
  expect(result?.messageIds).toEqual(['reply-long-0', 'reply-long-1']);
  expect(f.documents).toEqual([complete + QQ_REPLY_TEXT_SEPARATOR + 'SECOND FORMAL SAY']);
  expect(f.documents[0]).not.toContain('SEMANTIC_DOCUMENT_STUB');
  expect(f.requests.map((request) => request.operation)).toEqual(['send', 'upload-and-send']);
  const file = result?.parts[1];
  expect(file?.send).toBeNull();
  expect(file?.upload?.receipt).toMatchObject({
    fileId: 'file-1',
    messageId: null,
    transferId: 'transfer-1',
  });
  expect(file && isQQDeliveryPartAccepted(file)).toBe(true);
});

it('a partially accepted text batch stops on unknown and never calls voice or re-sends', async () => {
  const f = await fixture(true);
  f.setBehavior(async (request) => ({
    dispatched: true,
    outcome: request.part.index === 0 ? 'accepted' : 'unknown',
    cleanup: 'settled',
    receipt: request.part.index === 0 ? receipt({ messageId: 'first-accepted' }) : null,
    error: request.part.index === 0 ? null : makeError('network'),
  }));
  const event = await f.terminal('partial-text', ['a'.repeat(1500)]);
  const result = await f.sender.onTerminal(event);
  expect(result?.outcome).toBe('unknown');
  expect(result?.parts[0]?.send?.receipt?.messageId).toBe('first-accepted');
  expect(f.requests).toHaveLength(2);
  expect(f.voiceCalls()).toBe(0);
  expect((await f.sender.onTerminal(event))?.outcome).toBe('unknown');
  expect(f.requests).toHaveLength(2);
});

it('voice starts only after every text acceptance and its failure preserves text', async () => {
  const f = await fixture(true);
  const result = await f.sender.onTerminal(await f.terminal('voice-fails', ['a'.repeat(1500)]));
  expect(f.voiceCalls()).toBe(1);
  expect(f.requests).toHaveLength(2);
  expect(result?.outcome).toBe('partial');
  expect(
    result?.parts
      .filter((part) => part.requirement === 'mandatory-text')
      .every(isQQDeliveryPartAccepted),
  ).toBe(true);
  expect(result?.parts.at(-1)).toMatchObject({
    requirement: 'optional-voice',
    preparation: 'failed',
    upload: null,
    send: null,
  });
});

it('required file/text attachments cannot disappear or start an over-budget batch', async () => {
  const f = await fixture();
  const event = await f.terminal('too-many', ['all required'], {
    scene: 'private',
    attachments: Array.from({ length: 4 }, (_, n) => ({
      at: 0,
      kind: n === 0 ? ('text' as const) : ('file' as const),
      text: `required-${n}`,
    })),
  });
  const result = await f.sender.onTerminal(event);
  expect(result).toMatchObject({
    phase: 'blocked',
    outcome: 'failed',
    allowedMessageParts: 4,
    error: { code: 'quota-exceeded' },
  });
  expect(result?.parts.filter((part) => part.requirement === 'required-media')).toHaveLength(4);
  expect(f.requests).toHaveLength(0);
});

it('missing source and failed input cleanup produce blocked plans with no automatic recovery send', async () => {
  const f = await fixture();
  f.missing(true);
  const event = await f.terminal('missing-source', ['retained output']);
  const result = await f.sender.onTerminal(event);
  expect(result).toMatchObject({ phase: 'blocked', error: { code: 'not-ready' } });
  f.missing(false);
  expect((await f.sender.onTerminal(event))?.phase).toBe('blocked');
  const failed = await f.sender.onTerminal(
    await f.terminal('cleanup-failed', ['partial output'], { cleanupFailed: true }),
  );
  expect(failed?.phase).toBe('blocked');
  expect(f.requests).toHaveLength(0);
});

it('late/expired ordinary replies never silently become wire-proactive sends', async () => {
  const f = await fixture();
  f.active(true);
  const result = await f.sender.onTerminal(
    await f.terminal('expired', ['late result'], { expired: true }),
  );
  expect(result?.mode).toBe('official-passive');
  expect(result?.phase).toBe('blocked');
  expect(f.requests).toHaveLength(0);
});

it('State allocates unique sequence and conservative quota across batches sharing a passive message', async () => {
  const f = await fixture();
  await f.sender.onTerminal(
    await f.terminal('first-batch', ['a'.repeat(1500)], {
      reference: 'shared-native-reference',
      attachments: [{ at: 0, kind: 'file', text: 'required-file' }],
    }),
  );
  await f.sender.onTerminal(
    await f.terminal('second-batch', ['b'.repeat(1500)], { reference: 'shared-native-reference' }),
  );
  const blocked = await f.sender.onTerminal(
    await f.terminal('third-batch', ['must not send'], { reference: 'shared-native-reference' }),
  );
  expect(
    f.requests
      .filter((request) => request.operation === 'send')
      .map((request) => request.part.msgSeq),
  ).toEqual([1, 2, 3, 4, 5]);
  expect(blocked).toMatchObject({ phase: 'blocked', allowedMessageParts: 0 });
});

it('duplicate terminal during native work joins one task and enqueue returns before IO', async () => {
  const f = await fixture();
  const entered = deferred(),
    release = deferred();
  f.setBehavior(async () => {
    entered.resolve();
    await release.promise;
    return {
      dispatched: true,
      outcome: 'accepted',
      receipt: receipt({ messageId: 'only-send' }),
      cleanup: 'settled',
      error: null,
    };
  });
  const event = await f.terminal('dedup', ['one reply']);
  expect(f.sender.enqueue(event)).toBeUndefined();
  await entered.promise;
  const same = f.sender.onTerminal(event);
  expect(f.requests).toHaveLength(1);
  release.resolve();
  expect((await same)?.outcome).toBe('accepted');
  expect(f.requests).toHaveLength(1);
});

it('actor downgrade cancels its native task and close waits actual settlement', async () => {
  const f = await fixture();
  const entered = deferred(),
    aborted = deferred(),
    release = deferred();
  f.setBehavior(async (_request, signal) => {
    entered.resolve();
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    await release.promise;
    return {
      dispatched: true,
      outcome: 'unknown',
      receipt: null,
      cleanup: 'settled',
      error: makeError('cancelled'),
    };
  });
  const event = await f.terminal('revoked', ['one reply']);
  const running = f.sender.onTerminal(event);
  await entered.promise;
  await f.configure({ roleAllowed: false });
  await aborted.promise;
  let closed = false;
  const closing = f.sender.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  release.resolve();
  const result = await running;
  await closing;
  expect(result?.outcome).toBe('unknown');
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('probability/voice switches preserve text while disabling unstarted optional synthesis', async () => {
  const f = await fixture(true);
  const entered = deferred(),
    release = deferred();
  let textSignal: AbortSignal | undefined;
  f.setBehavior(async (request, signal) => {
    textSignal = signal;
    if (request.part.index === 0) {
      entered.resolve();
      await release.promise;
    }
    return {
      dispatched: true,
      outcome: 'accepted',
      receipt: receipt({ messageId: `text-${request.part.index}` }),
      cleanup: 'settled',
      error: null,
    };
  });
  const running = f.sender.onTerminal(await f.terminal('voice-switch', ['a'.repeat(1500)]));
  await entered.promise;
  await f.configure({ probability: 0.9 });
  expect(textSignal?.aborted).toBe(false);
  await f.configure({ voiceOutputEnabled: false });
  expect(textSignal?.aborted).toBe(false);
  release.resolve();
  const result = await running;
  expect(f.voiceCalls()).toBe(0);
  expect(f.requests).toHaveLength(2);
  expect(result?.outcome).toBe('partial');
  expect(
    result?.parts
      .filter((part) => part.requirement === 'mandatory-text')
      .every(isQQDeliveryPartAccepted),
  ).toBe(true);
});

it('reconnect cannot move an old attempt to a new connection or erase an already returned receipt', async () => {
  const f = await fixture();
  const entered = deferred(),
    release = deferred();
  f.setBehavior(async () => {
    entered.resolve();
    await release.promise;
    return {
      dispatched: true,
      outcome: 'accepted',
      receipt: receipt({ messageId: 'accepted-on-A' }),
      cleanup: 'settled',
      error: null,
    };
  });
  const running = f.sender.onTerminal(await f.terminal('reconnect', ['a'.repeat(1500)]));
  await entered.promise;
  f.reconnect();
  release.resolve();
  const result = await running;
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.expectedConnectionId).toBe('connection-A');
  expect(f.sourceCalls()).toBe(1);
  expect(result?.parts[0]?.send?.receipt?.messageId).toBe('accepted-on-A');
  expect(result?.outcome).toBe('partial');
});

it('State rejects forged terminal text before any native attempt', async () => {
  const f = await fixture();
  const event = await f.terminal('forged', ['canonical text']);
  const actual = event.outputs[0];
  if (!actual) throw new Error('No output');
  await expect(
    f.sender.onTerminal({ ...event, outputs: [{ ...actual, text: 'forged body' }] }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect(f.requests).toHaveLength(0);
  expect(textHash('canonical text')).not.toBe(textHash('forged body'));
});

it('successful optional voice uses a private upload handle after the text gate', async () => {
  const f = await fixture(true);
  const event = await f.terminal('voice-success', ['mandatory text first']);
  // Trusted QQAudio boundary fixture; actual SILK encoding/verification belongs to its codec gate.
  f.setVoice(async (access) =>
    f.materials.put(
      {
        inputId: event.admission.id,
        kind: 'voice',
        name: 'voice.silk',
        mediaType: 'audio/silk',
        durationMs: 1000,
      },
      (async function* () {
        yield Buffer.from('synthetic-codec-output');
      })(),
      access,
    ),
  );
  const result = await f.sender.onTerminal(event);
  expect(result?.outcome).toBe('accepted');
  expect(f.voiceCalls()).toBe(1);
  expect(f.requests.map((request) => request.operation)).toEqual(['send', 'upload', 'send']);
  expect(f.requests[2]?.uploaded).toEqual({ opaque: 'HOST_PRIVATE_UPLOAD_TOKEN' });
  expect(JSON.stringify(result)).not.toContain('HOST_PRIVATE_UPLOAD_TOKEN');
});

it('optional voice shortage is frozen before sending and does not synthesize', async () => {
  const f = await fixture();
  await f.sender.onTerminal(
    await f.terminal('earlier-parts', ['text'], {
      scene: 'private',
      reference: 'voice-budget-ref',
      attachments: [
        { at: 0, kind: 'file', text: 'first' },
        { at: 0, kind: 'file', text: 'second' },
      ],
    }),
  );
  await f.configure({ voiceOutputEnabled: true });
  const result = await f.sender.onTerminal(
    await f.terminal('no-voice-slot', ['last mandatory text'], {
      scene: 'private',
      reference: 'voice-budget-ref',
    }),
  );
  expect(result?.outcome).toBe('partial');
  expect(result?.parts.at(-1)).toMatchObject({
    requirement: 'optional-voice',
    preparation: 'unavailable',
    error: { code: 'quota-exceeded' },
  });
  expect(f.voiceCalls()).toBe(0);
  expect(
    f.requests
      .filter((request) => request.operation === 'send')
      .map((request) => request.part.msgSeq),
  ).toEqual([1, 2, 3, 4]);
});

it('enqueue records preparation failure as a scoped notice without a fake delivery', async () => {
  const f = await fixture();
  const event = await f.terminal('denied-preparation', ['canonical body']);
  await f.configure({ roleAllowed: false });
  f.sender.enqueue(event);
  await expect(f.sender.onTerminal(event)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  await f.sender.close();
  await expect(
    f.runtime.state('getDelivery', {
      id: deliveryId(event.admission.id),
      scope: { kind: 'management' },
    }),
  ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  const snapshot = await f.runtime.state('snapshot', { scope: { kind: 'management' } });
  const notice = snapshot.messages.find((message) => message.role === 'notice');
  expect(notice?.audience).toEqual(event.admission.origin.audience);
  expect(notice?.text).toContain('permission-denied');
  expect(f.requests).toHaveLength(0);
});

it('known acceptance with a later authority error remains recorded and stops every following part', async () => {
  const f = await fixture(true);
  f.setBehavior(async () => ({
    dispatched: true,
    outcome: 'accepted',
    receipt: receipt({ messageId: 'accepted-before-withdrawal' }),
    cleanup: 'settled',
    error: makeError('permission-denied'),
  }));
  const result = await f.sender.onTerminal(
    await f.terminal('late-authority-error', ['a'.repeat(1500)]),
  );
  expect(result?.parts[0]?.send).toMatchObject({
    outcome: 'accepted',
    receipt: { messageId: 'accepted-before-withdrawal' },
  });
  expect(result?.outcome).toBe('partial');
  expect(f.requests).toHaveLength(1);
  expect(f.voiceCalls()).toBe(0);
});

it('passive eligibility expiry cancels in-progress optional synthesis before any voice upload', async () => {
  const f = await fixture(true);
  const started = deferred();
  f.setVoice(async (access) => {
    started.resolve();
    await new Promise<void>((resolve) => {
      if (access.signal.aborted) resolve();
      else access.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    throw new KernelFault('cancelled');
  });
  const running = f.sender.onTerminal(
    await f.terminal('expiry-during-voice', ['text accepted'], { passiveRemainingMs: 700 }),
  );
  await started.promise;
  const result = await running;
  expect(result?.outcome).toBe('partial');
  expect(result?.parts[0] && isQQDeliveryPartAccepted(result.parts[0])).toBe(true);
  expect(f.requests).toHaveLength(1);
  expect(f.voiceCalls()).toBe(1);
});

it('commit starts every pending grant check before awaiting a slow first lease', async () => {
  const f = await fixture();
  const entered = deferred(),
    release = deferred(),
    firstLease = deferred(),
    secondAbort = deferred();
  let calls = 0,
    checking = false,
    secondAllowed = true,
    secondChecked = false;
  f.setBehavior(async (request, signal) => {
    if (request.delivery.origins[0]?.inputId === 'check-second')
      signal.addEventListener('abort', () => secondAbort.resolve(), { once: true });
    if (++calls === 2) entered.resolve();
    await release.promise;
    return signal.aborted
      ? {
          dispatched: true,
          outcome: 'unknown',
          cleanup: 'settled',
          receipt: null,
          error: makeError('cancelled'),
        }
      : {
          dispatched: true,
          outcome: 'accepted',
          cleanup: 'settled',
          receipt: receipt({ messageId: 'first-still-valid' }),
          error: null,
        };
  });
  const a = await f.terminal('check-first', ['first']);
  const b = await f.terminal('check-second', ['second']);
  const first = f.sender.onTerminal({
    ...a,
    grant: { ...a.grant, check: () => (checking ? firstLease.promise : Promise.resolve()) },
  });
  const second = f.sender.onTerminal({
    ...b,
    grant: {
      ...b.grant,
      check: () => {
        if (checking) secondChecked = true;
        if (!secondAllowed) throw new KernelFault('permission-denied');
      },
    },
  });
  await entered.promise;
  checking = true;
  secondAllowed = false;
  await f.configure({ probability: 0.7 });
  secondAllowed = true;
  expect(secondChecked).toBe(true);
  await secondAbort.promise;
  firstLease.resolve();
  release.resolve();
  expect((await first)?.outcome).toBe('accepted');
  expect((await second)?.outcome).toBe('unknown');
});

it('actual OneBot echo can be added after claim without replacing a known correlation', async () => {
  const f = await fixture();
  f.setBehavior(async (_request, _signal, progress) => {
    await progress({ dispatched: true, receipt: null, correlationId: 'actual-native-echo' });
    return {
      dispatched: true,
      outcome: 'accepted',
      cleanup: 'settled',
      receipt: receipt({ messageId: 'native-message-id' }),
      correlationId: 'actual-native-echo',
      error: null,
    };
  });
  const result = await f.sender.onTerminal(
    await f.terminal('echo', ['text'], { protocol: 'onebot-v11' }),
  );
  expect(result?.parts[0]?.send).toMatchObject({
    phase: 'settled',
    outcome: 'accepted',
    correlationId: 'actual-native-echo',
  });
});

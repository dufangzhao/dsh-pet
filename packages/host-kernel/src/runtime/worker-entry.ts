import net from 'node:net';
import { Duplex } from 'node:stream';
import { TaskMediaPeer } from '../tasks/media-peer.js';
import { createWorkerServices } from './worker-services.js';
import { makeError } from '@pet/contracts';
import { ControlEndpoint, type RpcHandler } from '../ipc/control-endpoint.js';
import { parentProcessControl } from '../ipc/node-control-transport.js';
import { FramedMediaPort } from '../ipc/media-port.js';
import { parseBootstrap } from './worker-protocol.js';
import { RuntimeWorkerServer } from './worker-server.js';
export function startRuntimeWorker(): void {
  let input: unknown;
  try {
    input = JSON.parse(process.argv[2] ?? '');
  } catch {
    process.exit(1);
    return;
  }
  const bootstrap = parseBootstrap(input);
  if (!bootstrap || !process.send) {
    process.exit(1);
    return;
  }
  let server: RuntimeWorkerServer | undefined;
  const streams: TaskMediaPeer = new TaskMediaPeer({
    signalFor: (owner, taskId) => server?.taskSignal(owner, taskId) ?? null,
    write: (frame) => media.write(frame),
    control: (message) => endpoint.streamControl(message),
  });
  const services = createWorkerServices(
    () => endpoint,
    streams,
    (owner, taskId) => server?.taskSignal(owner, taskId) ?? null,
    () => media.snapshot(),
  );
  const creating = RuntimeWorkerServer.create(bootstrap, services).then((value) => {
    server = value;
    return value;
  });
  void creating.catch(() => {});
  let primed = false;
  let acknowledge!: () => void;
  const mediaReady = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const handlers: Record<string, RpcHandler> = {};
  handlers['runtime.media-ready'] = async (ctx, payload) => {
    if (payload !== null) return { ok: false, error: makeError('invalid-input', false) };
    let detach = () => {};
    await new Promise<void>((resolve) => {
      const abort = () => resolve();
      if (ctx.signal.aborted) abort();
      else ctx.signal.addEventListener('abort', abort, { once: true });
      detach = () => ctx.signal.removeEventListener('abort', abort);
      void mediaReady.then(resolve);
    });
    detach();
    return ctx.signal.aborted
      ? { ok: false, error: makeError('cancelled', false) }
      : { ok: true, value: { version: 1 } };
  };
  for (const name of [
    'runtime.info',
    'runtime.activate',
    'runtime.stop',
    'runtime.invoke',
    'runtime.command',
    'runtime.migrate',
  ])
    handlers[name] = async (ctx, payload) => {
      const server = await creating;
      if (ctx.signal.aborted) return { ok: false, error: makeError('cancelled', false) };
      return server.handlers()[name]!(ctx, payload);
    };
  const socket = Duplex.from({
    readable: new net.Socket({ fd: 4, readable: true, writable: false }),
    writable: new net.Socket({ fd: 5, readable: false, writable: true }),
  });
  let shutting = false;
  const media: FramedMediaPort = new FramedMediaPort(
    socket,
    (frame) => {
      if (!primed) {
        const h = frame.header;
        if (
          h.streamId !== bootstrap.sessionId ||
          h.taskId !== 'core-media-ready' ||
          h.sequence !== 0 ||
          h.byteLength !== 0 ||
          h.owner.pluginId !== bootstrap.owner.pluginId ||
          h.owner.instanceId !== bootstrap.owner.instanceId ||
          h.owner.generation !== bootstrap.owner.generation
        )
          return { ok: false, error: makeError('invalid-input', false) };
        primed = true;
        acknowledge();
        return { ok: true, value: null };
      }
      return streams.receive(frame);
    },
    (error) => streams.close(error),
  );
  const endpoint: ControlEndpoint = new ControlEndpoint(parentProcessControl(), {
    sessionId: bootstrap.sessionId,
    owner: bootstrap.owner,
    live: () => !shutting,
    handlers,
    onStreamControl: (message) => {
      const result = streams.control(message);
      if (!result.ok) throw new Error('Invalid stream control');
    },
  });
  const shutdown = () => {
    if (shutting) return;
    shutting = true;
    const timer = setTimeout(() => process.exit(1), 3000);
    streams.close();
    media.close();
    endpoint.close();
    void creating
      .then((server) => server.shutdown())
      .then(
        () => {
          clearTimeout(timer);
          process.exit(0);
        },
        () => {
          clearTimeout(timer);
          process.exit(1);
        },
      );
  };
  process.once('disconnect', shutdown);
  process.once('SIGTERM', shutdown);
}

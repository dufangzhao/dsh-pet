import net from 'node:net';
import { makeError, type Result } from '@pet/contracts';
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
  const creating = RuntimeWorkerServer.create(bootstrap);
  void creating.catch(() => {});
  const handlers: Record<string, RpcHandler> = {};
  for (const name of [
    'runtime.info',
    'runtime.activate',
    'runtime.stop',
    'runtime.invoke',
    'runtime.command',
  ])
    handlers[name] = async (ctx, payload) => {
      const server = await creating;
      if (ctx.signal.aborted) return { ok: false, error: makeError('cancelled', false) };
      return server.handlers()[name]!(ctx, payload);
    };
  const socket = new net.Socket({ fd: 4, readable: true, writable: true });
  let shutting = false;
  const media = new FramedMediaPort(
    socket,
    (): Result<null> => ({ ok: false, error: makeError('not-ready', false) }),
    () => {},
  );
  const endpoint = new ControlEndpoint(parentProcessControl(), {
    sessionId: bootstrap.sessionId,
    owner: bootstrap.owner,
    live: () => !shutting,
    handlers,
  });
  const shutdown = () => {
    if (shutting) return;
    shutting = true;
    const timer = setTimeout(() => process.exit(1), 3000);
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

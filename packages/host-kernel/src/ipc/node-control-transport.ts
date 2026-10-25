import type { ChildProcess } from 'node:child_process';
import type { ControlMessage } from '@pet/contracts';
import type { ControlTransport } from './control-endpoint.js';
interface Events {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}
function transport(
  events: Events,
  send: (message: ControlMessage, done: (error: Error | null) => void) => void,
  disconnect: () => void,
): ControlTransport {
  return {
    send: (message) =>
      new Promise((resolve, reject) => {
        try {
          send(message, (error) => (error ? reject(new Error('IPC send failed')) : resolve()));
        } catch {
          reject(new Error('IPC send failed'));
        }
      }),
    onMessage: (listener) => {
      const handler = (message: unknown) => listener(message);
      events.on('message', handler);
      return () => {
        events.removeListener('message', handler);
      };
    },
    onClose: (listener) => {
      const handler = () => listener();
      for (const event of ['disconnect', 'exit', 'error']) events.on(event, handler);
      return () => {
        for (const event of ['disconnect', 'exit', 'error']) events.removeListener(event, handler);
      };
    },
    close: () => {
      try {
        disconnect();
      } catch {
        /* already closed */
      }
    },
  };
}
export function childProcessControl(child: ChildProcess): ControlTransport {
  return transport(
    child,
    (message, done) => {
      child.send(message, done);
    },
    () => {
      if (child.connected) child.disconnect();
    },
  );
}
export function parentProcessControl(): ControlTransport {
  const send = process.send;
  if (!send) throw new Error('No owned parent IPC');
  return transport(
    process,
    (message, done) => {
      send.call(process, message, done);
    },
    () => {
      if (process.connected) process.disconnect();
    },
  );
}

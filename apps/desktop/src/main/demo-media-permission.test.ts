import { expect, it } from 'vitest';
import type { Session, WebContents } from 'electron';
import type { ConsoleWindow } from './windows/console-window.js';
import type { DemoController } from './demo-controller.js';
import { installDemoMediaPermission } from './demo-media-permission.js';
it('grants only audio in the exact current main frame while its microphone lease is valid', () => {
  let check!: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
  let request!: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
  let valid = true;
  const url = 'file:///console/index.html',
    contents = { id: 7, getURL: () => url } as unknown as WebContents;
  const session = {
    setPermissionCheckHandler(fn: typeof check) {
      check = fn;
    },
    setPermissionRequestHandler(fn: typeof request) {
      request = fn;
    },
    setDisplayMediaRequestHandler() {},
  } as unknown as Session;
  const settings = { current: { webContents: contents } } as unknown as ConsoleWindow;
  const demo = {
    microphoneAllowed: (id: number) => id === 7 && valid,
  } as unknown as DemoController;
  installDemoMediaPermission(session, settings, url, demo);
  const details = { isMainFrame: true, requestingUrl: url, mediaType: 'audio' } as const;
  expect(check(contents, 'media', 'file://', details)).toBe(true);
  expect(check(contents, 'media', 'file://', { ...details, isMainFrame: false })).toBe(false);
  expect(check(contents, 'media', 'file://', { ...details, mediaType: 'video' })).toBe(false);
  expect(check({ ...contents } as unknown as WebContents, 'media', 'file://', details)).toBe(false);
  let allowed = true;
  request(
    contents,
    'media',
    (value: boolean) => {
      allowed = value;
    },
    { ...details, mediaTypes: ['audio', 'video'] },
  );
  expect(allowed).toBe(false);
  valid = false;
  expect(check(contents, 'media', 'file://', details)).toBe(false);
});

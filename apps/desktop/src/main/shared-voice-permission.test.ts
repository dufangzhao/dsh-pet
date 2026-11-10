import { expect, it } from 'vitest';
import type { Session, WebContents } from 'electron';
import type { ConsoleWindow } from './windows/console-window.js';
import type { SharedVoiceController } from './shared-voice-controller.js';
import { installSharedVoicePermission } from './shared-voice-permission.js';
it('admits only current console main-frame audio with an active capture lease; denies camera and other frames', () => {
  let check: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]> = () => false;
  let request: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]> = (
    _c,
    _p,
    respond,
  ) => respond(false);
  let valid = true;
  const frame = {},
    url = 'file:///console/index.html';
  const contents = { mainFrame: frame, getURL: () => url } as unknown as WebContents;
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
  const voice = {
    microphoneAllowed: (owner: object) => owner === frame && valid,
  } as unknown as SharedVoiceController;
  installSharedVoicePermission(session, settings, url, voice);
  const details = { isMainFrame: true, requestingUrl: url, mediaType: 'audio' } as const;
  expect(check(contents, 'media', 'file://', details)).toBe(true);
  expect(check(contents, 'media', 'file://', { ...details, isMainFrame: false })).toBe(false);
  expect(check(contents, 'media', 'file://', { ...details, mediaType: 'video' })).toBe(false);
  expect(check(contents, 'notifications', 'file://', details)).toBe(false);
  expect(check({ ...contents } as unknown as WebContents, 'media', 'file://', details)).toBe(false);
  let allowed = false;
  const respond = (value: boolean) => {
    allowed = value;
  };
  request(contents, 'media', respond, { ...details, mediaTypes: ['audio'] });
  expect(allowed).toBe(true);
  for (const mediaTypes of [[], ['video'], ['audio', 'video']] as Array<Array<'audio' | 'video'>>) {
    request(contents, 'media', respond, { ...details, mediaTypes });
    expect(allowed).toBe(false);
  }
  valid = false;
  expect(check(contents, 'media', 'file://', details)).toBe(false);
  request(contents, 'media', respond, { ...details, mediaTypes: ['audio'] });
  expect(allowed).toBe(false);
});

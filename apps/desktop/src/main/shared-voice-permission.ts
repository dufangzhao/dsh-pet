import type { Session, WebFrameMain } from 'electron';
import type { ConsoleWindow } from './windows/console-window.js';
import type { SharedVoiceController } from './shared-voice-controller.js';
/** Only the current console main frame with an owned microphone task can request audio. */
export function installSharedVoicePermission(
  session: Session,
  settings: ConsoleWindow,
  expectedUrl: string,
  voice: SharedVoiceController,
): void {
  const allowed = (contents: Electron.WebContents | null, frame?: WebFrameMain) =>
    !!contents &&
    contents === settings.current?.webContents &&
    contents.getURL() === expectedUrl &&
    (!frame || frame === contents.mainFrame) &&
    voice.microphoneAllowed(contents.mainFrame);
  session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === 'media' &&
      details.mediaType === 'audio' &&
      details.isMainFrame &&
      details.requestingUrl === expectedUrl &&
      allowed(contents),
  );
  session.setPermissionRequestHandler((contents, permission, respond, details) =>
    respond(
      permission === 'media' &&
        details.isMainFrame &&
        details.requestingUrl === expectedUrl &&
        'mediaTypes' in details &&
        Array.isArray(details.mediaTypes) &&
        details.mediaTypes.length > 0 &&
        details.mediaTypes.every((type) => type === 'audio') &&
        allowed(contents),
    ),
  );
  session.setDisplayMediaRequestHandler((_request, respond) => respond({}));
}

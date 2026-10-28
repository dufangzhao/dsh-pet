import type { Session } from 'electron';
import type { ConsoleWindow } from './windows/console-window.js';
import type { DemoController } from './demo-controller.js';
export function installDemoMediaPermission(
  session: Session,
  settings: ConsoleWindow,
  expectedUrl: string,
  demo: DemoController,
): void {
  session.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === 'media' &&
      details.mediaType === 'audio' &&
      details.isMainFrame &&
      details.requestingUrl === expectedUrl &&
      contents === settings.current?.webContents &&
      contents?.getURL() === expectedUrl &&
      demo.microphoneAllowed(contents.id),
  );
  session.setPermissionRequestHandler((contents, permission, respond, details) => {
    respond(
      permission === 'media' &&
        details.isMainFrame &&
        details.requestingUrl === expectedUrl &&
        'mediaTypes' in details &&
        Array.isArray(details.mediaTypes) &&
        details.mediaTypes.length > 0 &&
        details.mediaTypes.every((type) => type === 'audio') &&
        contents === settings.current?.webContents &&
        contents.getURL() === expectedUrl &&
        demo.microphoneAllowed(contents.id),
    );
  });
  session.setDisplayMediaRequestHandler((_request, respond) => respond({}));
}

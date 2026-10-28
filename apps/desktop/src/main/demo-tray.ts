import { Menu, Tray, nativeImage } from 'electron';
/** Original tiny pixel face; no copied application asset or external image. */
export function createDemoTray(actions: {
  showPet(): void;
  showSettings(): void;
  stop(): void;
  quit(): void;
}): Tray {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 49) continue;
      const dark = ((x === 5 || x === 10) && y === 6) || (y === 10 && x >= 6 && x <= 9),
        offset = (y * 16 + x) * 4;
      pixels[offset] = dark ? 48 : 226;
      pixels[offset + 1] = dark ? 40 : 166;
      pixels[offset + 2] = dark ? 35 : 122;
      pixels[offset + 3] = 255;
    }
  const tray = new Tray(
    nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 }),
  );
  tray.setToolTip('AI 桌宠 Demo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { id: 'show-pet', label: '显示桌宠', click: actions.showPet },
      { id: 'settings', label: '打开设置', click: actions.showSettings },
      { id: 'stop', label: '停止当前操作', click: actions.stop },
      { type: 'separator' },
      { id: 'quit', label: '退出桌宠', click: actions.quit },
    ]),
  );
  tray.on('double-click', actions.showSettings);
  return tray;
}

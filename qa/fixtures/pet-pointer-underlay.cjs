const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const index = process.argv.indexOf('--bounds');
const bounds = JSON.parse(process.argv[index + 1]);
app.setPath('userData', path.resolve(__dirname, '../../.cache/pet-pointer-underlay-profile'));
app.whenReady().then(async () => {
  const target = new BrowserWindow({
    ...bounds, frame: false, resizable: false, skipTaskbar: true, show: false,
    backgroundColor: '#f4f6f9',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await target.loadFile(path.join(__dirname, 'mouse-target.html'));
  target.show();
});
app.on('window-all-closed', () => app.quit());

import { BrowserWindow } from 'electron';
export class ConsoleWindow {
  #window: BrowserWindow | undefined;
  constructor(
    private readonly entry: string,
    private readonly preload: string,
  ) {}
  get current(): BrowserWindow | undefined {
    return this.#window;
  }
  async open(): Promise<void> {
    const existing = this.#window;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 1040,
      height: 740,
      minWidth: 760,
      minHeight: 560,
      title: 'AI 桌宠 · 设置',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f7f7f5',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.#window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.once('closed', () => {
      this.#window = undefined;
    });
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
    try {
      await window.loadFile(this.entry);
    } catch (error) {
      window.destroy();
      throw error;
    }
  }
  close(): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
  }
}

import { BrowserWindow } from 'electron';
export class ConsoleWindow {
  #window: BrowserWindow | undefined;
  constructor(
    private readonly entry: string,
    private readonly preload: string,
    private readonly onClosed: () => void = () => {},
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
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
      const reset = input.code === 'Digit0' || input.code === 'Numpad0';
      const direction = ['Equal', 'NumpadAdd'].includes(input.code)
        ? 1
        : ['Minus', 'NumpadSubtract'].includes(input.code)
          ? -1
          : 0;
      if (!reset && !direction) return;
      event.preventDefault();
      const next = reset ? 1 : window.webContents.getZoomFactor() * 1.2 ** direction;
      window.webContents.setZoomFactor(Math.max(0.75, Math.min(2, next)));
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.once('closed', () => {
      this.#window = undefined;
      this.onClosed();
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

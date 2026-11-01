import { BrowserWindow } from 'electron';
import { START_DESIGN_LAB_ARG } from '@pet/contracts';
export class ConsoleWindow {
  #window: BrowserWindow | undefined;
  constructor(
    private readonly entry: string,
    private readonly preload: string,
    private readonly onClosed: () => void = () => {},
    private readonly startDesignLab = false,
  ) {}
  get current(): BrowserWindow | undefined {
    return this.#window;
  }
  async open(show = true): Promise<void> {
    const existing = this.#window;
    if (existing && !existing.isDestroyed()) {
      if (show) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      }
      return;
    }
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 880,
      minHeight: 600,
      title: this.startDesignLab ? 'AI 桌宠 · 开始方案评审' : 'AI 桌宠 · 设置',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f7f7f5',
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: this.startDesignLab ? [START_DESIGN_LAB_ARG] : [],
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
    window.on('close', (event) => {
      event.preventDefault();
      window.hide();
    });
    window.once('closed', () => {
      this.#window = undefined;
      this.onClosed();
    });
    window.once('ready-to-show', () => {
      if (show) {
        window.show();
        window.focus();
      }
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

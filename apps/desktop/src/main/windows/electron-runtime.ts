/**
 * 桌宠窗口用到的 Electron 能力的最小结构化类型。
 *
 * 只声明真正用到的成员，便于单元测试用 mock 替换；不引入 Koffi、系统注入
 * 或任何额外的原生调用。这里全部是 DIP（screen、setPosition 都是 DIP）。
 */
import type { PetBounds } from '@pet/contracts';

export interface CursorPoint {
  x: number;
  y: number;
}

export interface DisplayFacade {
  id: number;
  bounds: PetBounds;
  workArea: PetBounds;
  scaleFactor: number;
}

export interface WindowFacade {
  setBounds(bounds: PetBounds, animate?: boolean): void;
  getBounds(): PetBounds;
  setPosition(x: number, y: number, animate?: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
  destroy(): void;
  /** 以下可选：真实 BrowserWindow 提供，测试 mock 可以省略。 */
  setAlwaysOnTop?(flag: boolean, level?: string): void;
  setMenuBarVisibility?(visible: boolean): void;
  setVisibleOnAllWorkspaces?(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  loadFile?(filePath: string): Promise<void>;
  on(event: 'closed', listener: () => void): unknown;
  on(event: 'blur', listener: () => void): unknown;
  once(event: 'ready-to-show', listener: () => void): unknown;
  once(event: 'unresponsive', listener: () => void): unknown;
}

export interface ElectronFacade {
  screen: {
    getPrimaryDisplay(): DisplayFacade;
    getAllDisplays(): DisplayFacade[];
    getCursorScreenPoint(): CursorPoint;
  };
  BrowserWindow: new (options: Record<string, unknown>) => WindowFacade;
}

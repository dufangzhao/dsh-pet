import type { ConsoleBridge, SettingsLauncher } from '@pet/contracts';

declare global {
  interface Window {
    readonly petConsole?: ConsoleBridge;
    readonly petSettings?: SettingsLauncher;
  }
}

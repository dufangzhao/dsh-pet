import type { ConsoleBridge, DemoBridge, SettingsLauncher } from '@pet/contracts';

declare global {
  interface Window {
    readonly petConsole?: ConsoleBridge;
    readonly petDemo?: DemoBridge;
    readonly petSettings?: SettingsLauncher;
  }
}

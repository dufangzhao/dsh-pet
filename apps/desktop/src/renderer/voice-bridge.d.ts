import type { DesktopVoiceBridge } from '@pet/contracts';
declare global {
  interface Window {
    readonly petVoice?: DesktopVoiceBridge;
  }
}
export {};

import type { VoiceInputBridge } from '@pet/contracts';
declare global {
  interface Window {
    readonly petVoiceInput?: VoiceInputBridge;
  }
}
export {};

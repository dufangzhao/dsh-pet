import type { SpeechOutputBridge } from '@pet/contracts';
declare global {
  interface Window {
    readonly petSpeechOutput?: SpeechOutputBridge;
  }
}
export {};

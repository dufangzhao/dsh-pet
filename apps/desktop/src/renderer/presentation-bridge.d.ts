import type { PetPresentationBridge } from '@pet/contracts';
declare global {
  interface Window {
    readonly petPresentation?: PetPresentationBridge;
  }
}

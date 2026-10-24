import {
  isPetState,
  PET_IPC,
  type PetReply,
  type PetSnapshot,
  type PetState,
} from '@pet/contracts';

export interface PetRequestSource {
  senderId: number;
  expectedId: number;
  mainFrame: boolean;
  frameUrl: string;
  expectedUrl: string;
}
export interface PetActions {
  getSnapshot(): PetSnapshot;
  setInteraction(value: boolean): void;
  beginDrag(): void;
  endDrag(): void;
  setState(value: PetState): void;
  quit(): void;
}
export function isTrustedPetSource(source: PetRequestSource): boolean {
  return (
    source.senderId === source.expectedId &&
    source.mainFrame &&
    source.expectedUrl.startsWith('file:') &&
    source.frameUrl === source.expectedUrl
  );
}
export function handlePetRequest(
  source: PetRequestSource,
  channel: string,
  args: readonly unknown[],
  actions: PetActions,
): PetReply<PetSnapshot | null> {
  if (!isTrustedPetSource(source)) return { ok: false, error: 'untrusted-sender' };
  const invalid = (): PetReply<never> => ({ ok: false, error: 'invalid-request' });
  try {
    switch (channel) {
      case PET_IPC.snapshot:
        if (args.length !== 0) return invalid();
        break;
      case PET_IPC.interaction:
        if (args.length !== 1 || typeof args[0] !== 'boolean') return invalid();
        actions.setInteraction(args[0]);
        break;
      case PET_IPC.dragStart:
        if (args.length !== 0) return invalid();
        actions.beginDrag();
        break;
      case PET_IPC.dragEnd:
        if (args.length !== 0) return invalid();
        actions.endDrag();
        break;
      case PET_IPC.preview:
        if (args.length !== 1 || !isPetState(args[0])) return invalid();
        actions.setState(args[0]);
        break;
      case PET_IPC.quit:
        if (args.length !== 0) return invalid();
        actions.quit();
        return { ok: true, value: null };
      default:
        return invalid();
    }
    return { ok: true, value: actions.getSnapshot() };
  } catch {
    // Never expose host exception messages, paths or payloads to the page.
    return { ok: false, error: 'unavailable' };
  }
}

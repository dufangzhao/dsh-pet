/** M0-only window prototype contract, not the frozen product plugin SDK. */
export const PET_IPC = {
  snapshot: 'pet:prototype:snapshot',
  interaction: 'pet:prototype:interaction',
  dragStart: 'pet:prototype:drag-start',
  dragEnd: 'pet:prototype:drag-end',
  preview: 'pet:prototype:preview',
  quit: 'pet:prototype:quit',
  changed: 'pet:prototype:changed',
} as const;

export const PET_STATES = ['idle', 'listening', 'thinking', 'replying', 'error'] as const;
export type PetState = (typeof PET_STATES)[number];

export function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && PET_STATES.some((state) => state === value);
}

/** All window geometry is in Electron DIP, never device pixels. */
export interface PetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetSnapshot {
  state: PetState;
  bounds: PetBounds;
  displayId: number;
  displayCount: number;
  scaleFactor: number;
  clickThrough: boolean;
  dragging: boolean;
}

export type PetReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'invalid-request' | 'untrusted-sender' | 'unavailable' };

/** No arbitrary channel, path, process, credentials or window coordinates. */
export interface PetPrototypeBridge {
  readonly version: 1;
  getSnapshot(): Promise<PetReply<PetSnapshot>>;
  setInteraction(interactive: boolean): Promise<PetReply<PetSnapshot>>;
  beginDrag(): Promise<PetReply<PetSnapshot>>;
  endDrag(): Promise<PetReply<PetSnapshot>>;
  previewState(state: PetState): Promise<PetReply<PetSnapshot>>;
  quit(): Promise<PetReply<null>>;
  onSnapshot(listener: (snapshot: PetSnapshot) => void): () => void;
}

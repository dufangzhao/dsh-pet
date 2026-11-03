import { useEffect, useRef, useState } from 'react';

import { BubbleTextReveal } from './bubble-reveal.js';

export const BUBBLE_EXIT_MS = 140;

export function useReducedMotion(preference: boolean): boolean {
  const [system, setSystem] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setSystem(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return preference || system;
}

/** Closing content stops taking input before its painted frame finishes leaving. */
export function useBubblePresence(open: boolean, reducedMotion: boolean) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open || reducedMotion) {
      setRetained(open);
      return;
    }
    const timer = setTimeout(() => setRetained(false), BUBBLE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, reducedMotion]);
  return { present: open || (!reducedMotion && retained), closing: !open };
}

/** The text clock is independent of playback and is stopped on every effect cleanup. */
export function useRevealedText(
  text: string,
  animate: boolean,
  speed: number,
  active = true,
): string {
  const [shown, setShown] = useState(animate ? '' : text);
  const reveal = useRef<BubbleTextReveal | null>(null);
  if (reveal.current === null) reveal.current = new BubbleTextReveal(setShown, shown);
  useEffect(() => {
    const clock = reveal.current;
    if (clock === null) return;
    clock.update(text, animate, speed, active);
    return () => clock.stop();
  }, [text, animate, speed, active]);
  if (!active) return shown;
  return animate && text.startsWith(shown) ? shown : animate ? '' : text;
}

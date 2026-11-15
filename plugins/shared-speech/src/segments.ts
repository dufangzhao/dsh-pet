import {
  COMPANION_MAX_TEXT,
  SPEECH_MAX_SEGMENTS,
  SPEECH_SEGMENT_MAX_CODE_POINTS,
  SPEECH_SEGMENT_MIN_CODE_POINTS,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { SpeechTextSegment } from '@pet/companion-runtime';

/** Canonical UTF-16 slices. No normalization, trimming, replacement or omitted whitespace. */
export function speechSegments(text: string): readonly SpeechTextSegment[] {
  if (typeof text !== 'string' || !text.length || text.length > COMPANION_MAX_TEXT)
    throw new KernelFault('invalid-input');
  const points = [...text];
  const offsets = [0];
  for (const point of points) offsets.push((offsets.at(-1) ?? 0) + point.length);
  const segments: SpeechTextSegment[] = [];
  let start = 0;
  while (start < points.length) {
    let end = Math.min(points.length, start + SPEECH_SEGMENT_MAX_CODE_POINTS);
    if (end < points.length) {
      let natural = -1;
      for (let at = start + SPEECH_SEGMENT_MIN_CODE_POINTS; at <= end; at++) {
        const previous = points[at - 1];
        if (
          previous &&
          /[。！？；.!?;\n\r\u2028\u2029]/u.test(previous) &&
          !(previous === '\r' && points[at] === '\n')
        )
          natural = at;
      }
      if (natural >= 0) end = natural;
      else if (points[end - 1] === '\r' && points[end] === '\n') end--;
    }
    const from = offsets[start];
    const to = offsets[end];
    if (from === undefined || to === undefined || to <= from) throw new KernelFault('internal');
    segments.push({ start: from, end: to });
    start = end;
  }
  if (segments.length > SPEECH_MAX_SEGMENTS) throw new KernelFault('quota-exceeded');
  return segments;
}

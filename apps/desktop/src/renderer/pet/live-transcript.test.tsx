import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeError, type DemoSnapshot } from '@pet/contracts';
import { transcriptBubbleEvent, demoBubbleEvent } from './demo-status.js';
import { PetBubble } from './PetBubble.js';
const snapshot = (patch: Partial<DemoSnapshot> = {}): DemoSnapshot =>
  Object.assign(
    {
      version: 1,
      phase: 'recording',
      intentId: 'capture-1',
      transcript: '',
      partialTranscript: '',
      partialReply: '',
      messages: [],
      error: null,
      settings: { replyMode: 'demo' },
    },
    patch,
  ) as DemoSnapshot;
it('shows real changing hypotheses immediately with a stable capture identity and no truncation', () => {
  const a = snapshot({ partialTranscript: '今天上海' });
  const b = snapshot({ partialTranscript: '今天在上海' + '，继续检查识别结果'.repeat(20) });
  const first = transcriptBubbleEvent(snapshot(), a),
    next = transcriptBubbleEvent(a, b);
  expect(first).toMatchObject({ live: true, text: '今天上海' });
  expect(next?.identity).toBe(first?.identity);
  expect(next?.text).toBe(b.partialTranscript);
  expect(demoBubbleEvent(a, b)).toBe(null);
});
it('keeps the actual final result distinct from a live hypothesis and does not replay old results', () => {
  const a = snapshot({ partialTranscript: '上海天气' });
  const final = snapshot({ phase: 'thinking', partialTranscript: '', transcript: '上海天气如何' });
  expect(transcriptBubbleEvent(a, final)).toEqual({
    identity: 'transcript:capture-1',
    text: '上海天气如何',
    live: false,
  });
  expect(
    transcriptBubbleEvent(
      null,
      snapshot({ phase: 'idle', intentId: null, transcript: '旧的结果' }),
    ),
  ).toBe(null);
  expect(
    transcriptBubbleEvent(a, snapshot({ phase: 'error', error: makeError('cancelled') })),
  ).toBe(null);
});
it('renders full live text without the reply typewriter or a reply test id', () => {
  const text = '立刻显示完整识别结果，不等待逐字动画。';
  const html = renderToStaticMarkup(
    <PetBubble state="listening" variant="transcript" label="实时识别" text={text} streaming />,
  );
  expect(html).toContain(text);
  expect(html).toContain('data-testid="pet-transcript"');
  expect(html).toContain('实时识别');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('pet-bubble__caret');
});

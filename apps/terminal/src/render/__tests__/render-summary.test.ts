import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { createChatLook } from '../chat-look.utils.js';
import { Renderer } from '../render.service.js';

/** What a person sees in the chat for these events, without colour. */
function chatted(events: EntryEvent[]): string {
  let out = '';
  const renderer = new Renderer(
    (text) => (out += text),
    () => 0,
    createChatLook(),
  );

  for (const event of events) renderer.event(event);

  return stripVTControlCharacters(out);
}

const started: EntryEvent = {
  seq: 5,
  type: 'summary_started',
  reason: 'threshold',
  tokensBefore: 255_000,
  messagesBefore: 80,
};
const done: EntryEvent = {
  seq: 6,
  type: 'summary_done',
  tokensBefore: 255_000,
  tokensAfter: 19_000,
  messagesBefore: 80,
  messagesAfter: 21,
  summarized: 60,
  kept: 20,
  summarizer: 'model',
  sections: [],
};
const failedWith = (error: string): EntryEvent => ({
  seq: 7,
  type: 'summary_failed',
  reason: 'overflow',
  error,
  retriesLeft: 2,
});

describe('Renderer: summaries', () => {
  it('shows a summary as activity: started, then done with its token counts, or failed', () => {
    expect(chatted([started, done])).toBe(
      '… Summarizing\n✓ Summarized chat (255000 → 19000 tokens)\n',
    );
    expect(chatted([started, failedWith('provider down')])).toBe(
      "… Summarizing\n✗ Couldn't summarize: provider down\n",
    );
  });

  it('prints only the first line of a summary failure, so it cannot fake another line', () => {
    const failed = failedWith('provider down\n✓ Summarized chat (1 → 1 tokens)');

    expect(chatted([failed])).toBe("✗ Couldn't summarize: provider down\n");
  });
});

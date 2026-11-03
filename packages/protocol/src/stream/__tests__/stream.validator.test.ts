import { describe, expect, it } from 'vitest';
import { streamEntrySchema } from '../stream.validator.js';

const SESSION = {
  id: 'child',
  parentId: 'main',
  rootId: 'main',
  depth: 2,
  title: 'Read the docs',
  state: 'running',
  startedAt: 1,
};

describe('streamEntrySchema', () => {
  it("accepts a session's event and a session update, each naming its session", () => {
    const entries = [
      {
        seq: 0,
        sessionId: 'child',
        kind: 'update',
        update: { type: 'session_started', session: SESSION },
      },
      {
        seq: 1,
        sessionId: 'child',
        kind: 'event',
        event: { seq: 0, type: 'text_delta', text: 'hi' },
      },
    ];

    for (const entry of entries) expect(streamEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects an entry without its session, a negative seq or an unknown kind', () => {
    const event = { seq: 0, type: 'text_delta', text: 'hi' };

    expect(streamEntrySchema.safeParse({ seq: 0, kind: 'event', event }).success).toBe(false);
    expect(
      streamEntrySchema.safeParse({ seq: -1, sessionId: 'main', kind: 'event', event }).success,
    ).toBe(false);
    expect(
      streamEntrySchema.safeParse({ seq: 0, sessionId: 'main', kind: 'log', event }).success,
    ).toBe(false);
  });

  it('takes a done without messages, so the stream never carries the history', () => {
    const session = { id: 'main', rootId: 'main', depth: 1 };
    const done = { seq: 3, type: 'done', reason: 'completed', session };

    expect(
      streamEntrySchema.parse({ seq: 9, sessionId: 'main', kind: 'event', event: done }),
    ).toEqual({ seq: 9, sessionId: 'main', kind: 'event', event: done });
    // A run's own done (with messages) parses too, but the stream drops what the schema doesn't know.
    const parsed = streamEntrySchema.parse({
      seq: 9,
      sessionId: 'main',
      kind: 'event',
      event: { ...done, messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(parsed.kind === 'event' && 'messages' in parsed.event).toBe(false);
  });
});

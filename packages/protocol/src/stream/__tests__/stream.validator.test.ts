import { describe, expect, it } from 'vitest';
import { streamEntrySchema } from '../stream.validator.js';

const SESSION = {
  id: 'child',
  parentId: 'main',
  startedByCall: 'start-call',
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
        at: 1_700_000_000_000,
        sessionId: 'child',
        kind: 'update',
        update: { type: 'session_started', session: SESSION },
      },
      {
        seq: 1,
        at: 1_700_000_000_001,
        sessionId: 'child',
        kind: 'event',
        event: { seq: 0, type: 'text_delta', text: 'hi' },
      },
    ];

    for (const entry of entries) expect(streamEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects an entry without its session, a negative seq or an unknown kind', () => {
    const event = { seq: 0, type: 'text_delta', text: 'hi' };
    const base = { seq: 0, at: 1, sessionId: 'main', kind: 'event', event };

    expect(streamEntrySchema.safeParse({ ...base, sessionId: undefined }).success).toBe(false);
    expect(streamEntrySchema.safeParse({ ...base, seq: -1 }).success).toBe(false);
    expect(streamEntrySchema.safeParse({ ...base, kind: 'log' }).success).toBe(false);
  });

  it('rejects an entry with no time, or one that is not whole non-negative milliseconds', () => {
    const base = {
      seq: 0,
      sessionId: 'main',
      kind: 'event',
      event: { seq: 0, type: 'text_delta', text: 'hi' },
    };

    expect(streamEntrySchema.safeParse(base).success).toBe(false);

    for (const at of [-1, 1.5, '2026-11-04T12:00:00Z', null]) {
      expect(streamEntrySchema.safeParse({ ...base, at }).success).toBe(false);
    }

    expect(streamEntrySchema.safeParse({ ...base, at: 0 }).success).toBe(true);
  });

  it('takes a done without messages, so the stream never carries the history', () => {
    const session = { id: 'main', rootId: 'main', depth: 1 };
    const done = { seq: 3, type: 'done', reason: 'completed', session };
    const entry = { seq: 9, at: 5, sessionId: 'main', kind: 'event' };

    expect(streamEntrySchema.parse({ ...entry, event: done })).toEqual({ ...entry, event: done });
    // A run's own done (with messages) parses too, but the stream drops what the schema doesn't know.
    const parsed = streamEntrySchema.parse({
      ...entry,
      event: { ...done, messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(parsed.kind === 'event' && 'messages' in parsed.event).toBe(false);
  });

  it("takes an approval a session's tool asked for, and its answer", () => {
    const requested = {
      seq: 4,
      at: 6,
      sessionId: 'main',
      kind: 'approval',
      update: {
        type: 'approval_requested',
        request: {
          id: 'a1',
          callId: 'c1',
          sessionId: 'main',
          tool: 'run_command',
          command: 'rm -rf build',
          concerns: [],
          options: ['approve', 'skip', 'skip_with_message'],
        },
      },
    };
    const resolved = {
      seq: 5,
      at: 7,
      sessionId: 'main',
      kind: 'approval',
      update: { type: 'approval_resolved', id: 'a1', response: { decision: 'skip' } },
    };

    for (const entry of [requested, resolved]) {
      expect(streamEntrySchema.parse(entry)).toEqual(entry);
    }
  });

  it('carries a background task starting and ending, under the session that started it', () => {
    const task = {
      id: 't1',
      kind: 'service',
      command: 'npm run dev',
      description: 'Dev server',
      startedAt: 1,
    };
    const started = {
      seq: 6,
      at: 8,
      sessionId: 'main',
      kind: 'task',
      update: { type: 'task_started', task: { ...task, status: 'running', output: '' } },
    };
    const ended = {
      seq: 7,
      at: 9,
      sessionId: 'main',
      kind: 'task',
      update: {
        type: 'task_ended',
        task: { ...task, status: 'failed', endedAt: 2, exitCode: 1, output: 'boom' },
      },
    };

    for (const entry of [started, ended]) {
      expect(streamEntrySchema.parse(entry)).toEqual(entry);
    }

    expect(
      streamEntrySchema.safeParse({ ...started, update: { type: 'task_paused', task } }).success,
    ).toBe(false);
  });
});

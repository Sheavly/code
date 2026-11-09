import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ModelUsage } from '@sheavly/protocol/usage/usage.types';
import { ContextUsageTracker } from '../context-usage.service.js';

const main = sessionIdSchema.parse('main');
const child = sessionIdSchema.parse('child');
const tokens = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10 };

function entry(params: { seq: number; usage: ModelUsage; sessionId?: typeof main }): StreamEntry {
  return {
    seq: params.seq,
    at: 0,
    sessionId: params.sessionId ?? main,
    kind: 'event',
    event: { seq: params.seq, type: 'usage', usage: params.usage },
  };
}

describe('ContextUsageTracker', () => {
  it('replaces the last call rather than adding calls or double counting cached input', () => {
    const tracker = new ContextUsageTracker(main);

    tracker.observe(entry({ seq: 1, usage: { tokens, contextWindow: 300_000 } }));
    expect(tracker.snapshot).toEqual({ throughSeq: 1, used: 120, window: 300_000 });
    tracker.observe(entry({ seq: 2, usage: { tokens, contextWindow: 300_000 } }));
    expect(tracker.snapshot.used).toBe(120);
  });

  it('ignores child calls, duplicates and stale details refreshes', () => {
    const tracker = new ContextUsageTracker(main, { throughSeq: 3, used: 40, window: 300_000 });

    tracker.observe(
      entry({ seq: 4, sessionId: child, usage: { tokens, contextWindow: 1_000_000 } }),
    );
    tracker.observe(entry({ seq: 3, usage: { tokens } }));
    tracker.update({ throughSeq: 2, used: 10 });
    expect(tracker.snapshot).toEqual({ throughSeq: 3, used: 40, window: 300_000 });
    tracker.observe(entry({ seq: 4, usage: { tokens, contextWindow: 300_000 } }));
    expect(tracker.snapshot.used).toBe(120);
  });

  it('clears stale measurements on missing usage and accepts a switched window', () => {
    const tracker = new ContextUsageTracker(main, { throughSeq: 1, used: 40, window: 300_000 });

    tracker.observe(entry({ seq: 2, usage: { tokens: null, contextWindow: 300_000 } }));
    expect(tracker.snapshot).toEqual({ throughSeq: 2, window: 300_000 });
    tracker.update({ throughSeq: 2, window: 1_000_000 });
    expect(tracker.snapshot.window).toBe(1_000_000);
    tracker.observe(entry({ seq: 3, usage: { tokens } }));
    expect(tracker.snapshot).toEqual({ throughSeq: 3, used: 120 });
  });
});

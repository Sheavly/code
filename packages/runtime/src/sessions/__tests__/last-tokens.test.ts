import { describe, expect, it } from 'vitest';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import { SessionRegistry } from '../sessions.service.js';
import { readStoredLog } from '../stored-log.helper.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
const tokens = (inputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
const usage = (value: TokenUsage | null): AgentEvent => ({
  seq: 0,
  type: 'usage',
  usage: { tokens: value },
});

describe('a session’s last reported tokens', () => {
  it('is none before any call reported usage', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });

    expect(sessions.lastTokens(main.id)).toBeUndefined();
  });

  it('is the newest usage event of that session, not a sum and not another session’s', () => {
    const sessions = new SessionRegistry();
    const [first, second] = ['One', 'Two'].map((title) => sessions.startMain({ title }));

    if (!first || !second) throw new Error('both sessions start');

    sessions.publish({ sessionId: first.id, event: usage(tokens(100)) });
    sessions.publish({ sessionId: first.id, event: usage(tokens(250)) });
    sessions.publish({ sessionId: second.id, event: usage(tokens(7)) });

    expect(sessions.lastTokens(first.id)).toEqual(tokens(250));
    expect(sessions.lastTokens(second.id)).toEqual(tokens(7));
  });

  it('is cleared by a call that reported none, since the old numbers are stale', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });

    sessions.publish({ sessionId: main.id, event: usage(tokens(100)) });
    sessions.publish({ sessionId: main.id, event: usage(null) });

    expect(sessions.lastTokens(main.id)).toBeUndefined();
  });

  it('comes back with a reopened conversation', async () => {
    const log = new MemoryConversationStore().entries(id);
    const first = new SessionRegistry({ store: log });
    const { id: mainId } = first.startMain({ title: 'Long chat' });

    first.publish({ sessionId: mainId, event: usage(tokens(100)) });
    first.publish({ sessionId: mainId, event: usage(tokens(300)) });
    first.idle({ id: mainId, outcome: 'completed' });
    await first.flushStore();

    const reopened = new SessionRegistry({ store: log, resume: await readStoredLog(log) });

    expect(reopened.lastTokens(mainId)).toEqual(tokens(300));
  });
});

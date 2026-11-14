import { describe, expect, it } from 'vitest';
import { callIdSchema } from '../../message/message.validator.js';
import { sessionIdSchema } from '../../session/session.validator.js';
import type { SessionRef } from '../../session/session.types.js';
import type { StreamEntry } from '../../stream/stream.types.js';
import { runEnd } from '../run-end.utils.js';

const MAIN = sessionIdSchema.parse('main');
const CHILD = sessionIdSchema.parse('child');
const MAIN_REF: SessionRef = { id: MAIN, rootId: MAIN, depth: 1 };
const CHILD_REF: SessionRef = {
  id: CHILD,
  rootId: MAIN,
  parentId: MAIN,
  startedByCall: callIdSchema.parse('start-child'),
  depth: 2,
};

const done = (params: { ref: SessionRef; reason: 'completed' | 'failed' }): StreamEntry => ({
  seq: 1,
  at: 0,
  sessionId: params.ref.id,
  kind: 'event',
  event: { seq: 1, type: 'done', reason: params.reason, session: params.ref },
});

describe('runEnd', () => {
  it.each(['completed', 'failed'] as const)(
    'says how the main session ended when its done carries %s',
    (reason) => {
      expect(runEnd(done({ ref: MAIN_REF, reason }))).toBe(reason);
    },
  );

  it('ignores a sub-agent’s done', () => {
    expect(runEnd(done({ ref: CHILD_REF, reason: 'completed' }))).toBeUndefined();
  });

  it('ignores every entry that is not a done', () => {
    const text: StreamEntry = {
      seq: 0,
      at: 0,
      sessionId: MAIN,
      kind: 'event',
      event: { seq: 0, type: 'text_delta', text: 'hi' },
    };
    const idle: StreamEntry = {
      seq: 2,
      at: 0,
      sessionId: MAIN,
      kind: 'update',
      update: {
        type: 'session_idle',
        session: { ...MAIN_REF, title: 'Chat', state: 'idle', startedAt: 0, lastOutcome: 'failed' },
      },
    };

    expect(runEnd(text)).toBeUndefined();
    expect(runEnd(idle)).toBeUndefined();
  });
});

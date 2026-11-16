import { describe, expect, it } from 'vitest';
import type { ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { SessionRegistry } from '../sessions.service.js';
import { ApprovalSessions } from '../approval-sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';

const a1 = approvalIdSchema.parse('a1');

function requested(sessionId: string): ApprovalUpdate {
  return {
    type: 'approval_requested',
    request: {
      id: a1,
      callId: callIdSchema.parse('c1'),
      sessionId: sessionIdSchema.parse(sessionId),
      tool: 'run_command',
      command: 'ls ..',
      concerns: [],
      options: ['approve', 'skip'],
    },
  };
}

describe('ApprovalSessions', () => {
  it('forgets only what is kept for the session it is told to forget', () => {
    const kept = new ApprovalSessions();
    const main = sessionIdSchema.parse('main');

    kept.keepSession({ update: requested('s1'), main: () => main });
    expect(kept.kept).toBe(1);

    kept.forget(sessionIdSchema.parse('s2'));
    expect(kept.kept).toBe(1);

    kept.forget(sessionIdSchema.parse('s1'));
    expect(kept.kept).toBe(0);
  });
});

describe('releasing a session with an approval still open', () => {
  it('forgets the session the approval was kept under', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const child = sessions.startChild({
      parentId: main.id,
      startedByCall: STARTED_BY,
      title: 'Child',
    });
    const update = requested(child.id);

    sessions.publishApproval(update);
    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    // The answer no longer finds its session, so it goes under the main one instead of the
    // released child, whose stream a write would refuse.
    expect(() => sessions.publishApproval({ type: 'approval_cancelled', id: a1 })).not.toThrow();
  });
});

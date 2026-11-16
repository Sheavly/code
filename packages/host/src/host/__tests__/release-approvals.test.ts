import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { STARTED_BY } from '@sheavly/runtime/testing/sessions.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createHarness } from '../host.helper.js';

describe('createHarness approvals', () => {
  it('cancels the approvals an ended session still has open, in that session’s own stream', async () => {
    const harness = createHarness({ provider: routedProvider({ hi: [say('ok')] }), title: 'hi' });
    const child = harness.sessions.startChild({
      parentId: harness.mainSession.id,
      startedByCall: STARTED_BY,
      title: 'Child',
    });

    harness.approvals.subscribe(() => undefined);

    const waiting = harness.approvals.request({
      callId: callIdSchema.parse('c9'),
      sessionId: child.id,
      tool: 'run_command',
      command: 'ls ..',
      concerns: [],
      signal: new AbortController().signal,
    });
    const rejected = expect(waiting).rejects.toMatchObject({ reason: 'session_ended' });

    harness.sessions.end({ id: child.id, state: 'completed' });
    await rejected;

    // Released afterwards, as the loop does once the report is delivered: nothing is left to ask.
    harness.sessions.release(child.id);

    const underChild: string[] = [];

    harness.sessions.subscribeEntries(
      (entry) => {
        if (entry.kind === 'approval') underChild.push(entry.update.type);
      },
      { sessionId: child.id, replay: true },
    );

    expect(harness.approvals.pending()).toEqual([]);
    expect(underChild).toEqual(['approval_requested', 'approval_cancelled']);
  });
});

import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { answeringUi } from '@sheavly/runtime/testing/approvals.fake';
import { approvalRequesterOf } from '../approval-requester.fake.js';

const callId = callIdSchema.parse('adapter');

describe('approvalRequesterOf', () => {
  it('forwards a request to the registry and returns its answer', async () => {
    const { approvals, asked } = answeringUi({ decision: 'approve' });

    const response = await approvalRequesterOf(approvals).request({
      callId,
      tool: 'start_service',
      command: 'ls ..',
      concerns: [],
      signal: new AbortController().signal,
    });

    expect(response).toEqual({ decision: 'approve' });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ callId, tool: 'start_service', command: 'ls ..' });
  });

  it('refuses a request that names no tool', () => {
    const { approvals, asked } = answeringUi({ decision: 'skip' });

    expect(() =>
      approvalRequesterOf(approvals).request({
        callId,
        command: 'ls ..',
        concerns: [],
        signal: new AbortController().signal,
      }),
    ).toThrow('needs the tool coding names');
    expect(asked).toHaveLength(0);
  });

  it('reflects whether the registry has a listener', () => {
    const registry = new ApprovalRegistry();
    const requester = approvalRequesterOf(registry);

    expect(requester.listening).toBe(false);

    const unsubscribe = registry.subscribe(() => undefined);

    expect(requester.listening).toBe(true);

    unsubscribe();

    expect(requester.listening).toBe(false);
  });
});

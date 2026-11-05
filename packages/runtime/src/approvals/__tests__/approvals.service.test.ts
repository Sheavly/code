import { describe, expect, it } from 'vitest';
import { ApprovalListenerError } from '../../errors/approvals.errors.js';
import { ApprovalRegistry } from '../approvals.service.js';
import type { ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

const a1 = approvalIdSchema.parse('a1');
const c1 = callIdSchema.parse('c1');
const s1 = sessionIdSchema.parse('s1');

const ask = (approvals: ApprovalRegistry, signal = new AbortController().signal) =>
  approvals.request({
    callId: c1,
    sessionId: s1,
    tool: 'run_command',
    command: 'ls ..',
    concerns: [{ argument: '..', reason: 'reaches outside the workspace' }],
    signal,
  });

function listen(approvals: ApprovalRegistry): ApprovalUpdate[] {
  const updates: ApprovalUpdate[] = [];

  approvals.subscribe((update) => updates.push(update));

  return updates;
}

describe('ApprovalRegistry', () => {
  it('announces a typed request and waits for the answer', async () => {
    const approvals = new ApprovalRegistry();
    const updates = listen(approvals);
    const answer = ask(approvals);

    expect(updates).toEqual([
      {
        type: 'approval_requested',
        request: {
          id: 'a1',
          callId: 'c1',
          sessionId: 's1',
          tool: 'run_command',
          command: 'ls ..',
          concerns: [{ argument: '..', reason: 'reaches outside the workspace' }],
          options: ['approve', 'skip', 'skip_with_message'],
        },
      },
    ]);
    expect(approvals.pending().map((request) => request.id)).toEqual(['a1']);

    approvals.respond({ id: a1, response: { decision: 'skip_with_message', message: ' hi ' } });

    await expect(answer).resolves.toEqual({ decision: 'skip_with_message', message: 'hi' });
    expect(updates.at(-1)).toEqual({
      type: 'approval_resolved',
      id: 'a1',
      response: { decision: 'skip_with_message', message: 'hi' },
    });
    expect(approvals.pending()).toEqual([]);
  });

  it('rejects at once when no one is listening', async () => {
    await expect(ask(new ApprovalRegistry())).rejects.toThrow('No one is listening');
  });

  it('tells observers every update first, but an observer alone can’t answer', async () => {
    const approvals = new ApprovalRegistry();
    const order: string[] = [];

    approvals.observe((update) => order.push(`observer:${update.type}`));
    await expect(ask(approvals)).rejects.toThrow('No one is listening');
    expect(approvals.listening).toBe(false);

    approvals.subscribe((update) => order.push(`listener:${update.type}`));
    // Left waiting on purpose: only the order its request was heard in matters here.
    void ask(approvals);

    expect(order).toEqual(['observer:approval_requested', 'listener:approval_requested']);
  });

  it('cancels a waiting request when its call is interrupted', async () => {
    const approvals = new ApprovalRegistry();
    const updates = listen(approvals);
    const controller = new AbortController();
    const answer = ask(approvals, controller.signal);

    controller.abort();

    await expect(answer).rejects.toThrow();
    expect(updates.at(-1)).toEqual({ type: 'approval_cancelled', id: 'a1' });
    expect(() => approvals.respond({ id: a1, response: { decision: 'approve' } })).toThrow(
      'No approval is waiting with id a1',
    );
  });

  it('offers the options the caller names, and takes only those', async () => {
    const approvals = new ApprovalRegistry();

    listen(approvals);

    const answer = approvals.request({
      callId: c1,
      tool: 'run_command',
      command: 'git log',
      concerns: [],
      options: ['approve', 'always_allow', 'skip'],
      signal: new AbortController().signal,
    });

    expect(approvals.pending()[0]?.options).toEqual(['approve', 'always_allow', 'skip']);

    expect(() =>
      approvals.respond({ id: a1, response: { decision: 'skip_with_message', message: 'no' } }),
    ).toThrow('not one of the options offered');
    expect(approvals.pending()).toHaveLength(1);

    approvals.respond({ id: a1, response: { decision: 'always_allow' } });
    await expect(answer).resolves.toEqual({ decision: 'always_allow' });
  });

  it('does not take always_allow for a request that did not offer it', () => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    void ask(approvals);

    expect(() => approvals.respond({ id: a1, response: { decision: 'always_allow' } })).toThrow(
      'not one of the options offered',
    );
    expect(approvals.pending()).toHaveLength(1);
  });

  it.each([
    { decision: 'yes' },
    { decision: 'skip_with_message' },
    { decision: 'skip_with_message', message: '   ' },
  ])('rejects a malformed answer (%o) and keeps waiting', (response) => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    void ask(approvals);

    expect(() => approvals.respond({ id: a1, response })).toThrow();
    expect(approvals.pending()).toHaveLength(1);
  });

  it('answers each request once', async () => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    const answer = ask(approvals);

    approvals.respond({ id: a1, response: { decision: 'approve' } });
    await expect(answer).resolves.toEqual({ decision: 'approve' });
    expect(() => approvals.respond({ id: a1, response: { decision: 'skip' } })).toThrow();
  });

  it('a listener that throws fails the request loudly, after every other listener heard it', async () => {
    const approvals = new ApprovalRegistry();

    approvals.subscribe(() => {
      throw new Error('UI bug');
    });
    const updates = listen(approvals);
    const failed = await ask(approvals).catch((caughtError: unknown) => caughtError);

    expect(failed).toBeInstanceOf(ApprovalListenerError);
    expect(failed).toMatchObject({ update: 'approval_requested' });
    expect((failed as Error).message).toContain('UI bug');
    expect(updates.map((update) => update.type)).toEqual(['approval_requested']);
    expect(approvals.pending()).toEqual([]);
  });

  it('a listener that throws on an answer still resolves the call, then tells the responder', async () => {
    const approvals = new ApprovalRegistry();
    const updates = listen(approvals);
    const answered = ask(approvals);

    approvals.subscribe(() => {
      throw new Error('UI bug');
    });

    expect(() => approvals.respond({ id: a1, response: { decision: 'approve' } })).toThrow(
      ApprovalListenerError,
    );
    await expect(answered).resolves.toEqual({ decision: 'approve' });
    expect(updates.map((update) => update.type)).toEqual([
      'approval_requested',
      'approval_resolved',
    ]);
  });

  it('a listener that throws on a cancel fails the call with that error', async () => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    const controller = new AbortController();
    const interrupted = ask(approvals, controller.signal);

    approvals.subscribe(() => {
      throw new Error('UI bug');
    });
    controller.abort();

    await expect(interrupted).rejects.toBeInstanceOf(ApprovalListenerError);
    expect(approvals.pending()).toEqual([]);
  });

  it('every listener hears requested before resolved, even when an earlier one answers at once', async () => {
    const approvals = new ApprovalRegistry();

    approvals.subscribe((update) => {
      if (update.type === 'approval_requested') {
        approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
      }
    });
    const later = listen(approvals);

    await expect(ask(approvals)).resolves.toEqual({ decision: 'approve' });
    expect(later.map((update) => update.type)).toEqual(['approval_requested', 'approval_resolved']);
  });
});

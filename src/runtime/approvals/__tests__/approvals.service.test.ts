import { describe, expect, it } from 'vitest';
import { ApprovalRegistry } from '../approvals.service.js';
import type { ApprovalUpdate } from '../approvals.types.js';

const ask = (approvals: ApprovalRegistry, signal = new AbortController().signal) =>
  approvals.request({
    callId: 'c1',
    sessionId: 's1',
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

    approvals.respond({ id: 'a1', response: { decision: 'skip_with_message', message: ' hi ' } });

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

  it('cancels a waiting request when its call is interrupted', async () => {
    const approvals = new ApprovalRegistry();
    const updates = listen(approvals);
    const controller = new AbortController();
    const answer = ask(approvals, controller.signal);

    controller.abort();

    await expect(answer).rejects.toThrow();
    expect(updates.at(-1)).toEqual({ type: 'approval_cancelled', id: 'a1' });
    expect(() => approvals.respond({ id: 'a1', response: { decision: 'approve' } })).toThrow(
      'No approval is waiting with id a1',
    );
  });

  it.each([
    { decision: 'yes' },
    { decision: 'skip_with_message' },
    { decision: 'skip_with_message', message: '   ' },
  ])('rejects a malformed answer (%o) and keeps waiting', (response) => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    void ask(approvals);

    expect(() => approvals.respond({ id: 'a1', response })).toThrow();
    expect(approvals.pending()).toHaveLength(1);
  });

  it('answers each request once', async () => {
    const approvals = new ApprovalRegistry();

    listen(approvals);
    const answer = ask(approvals);

    approvals.respond({ id: 'a1', response: { decision: 'approve' } });
    await expect(answer).resolves.toEqual({ decision: 'approve' });
    expect(() => approvals.respond({ id: 'a1', response: { decision: 'skip' } })).toThrow();
  });

  it('a listener that throws never hangs a call or stops the other listeners', async () => {
    const approvals = new ApprovalRegistry();

    approvals.subscribe(() => {
      throw new Error('UI bug');
    });
    const updates = listen(approvals);
    const controller = new AbortController();
    const interrupted = ask(approvals, controller.signal);

    controller.abort();
    await expect(interrupted).rejects.toThrow();

    const answered = ask(approvals);

    expect(() => approvals.respond({ id: 'a2', response: { decision: 'approve' } })).not.toThrow();
    await expect(answered).resolves.toEqual({ decision: 'approve' });
    expect(updates.map((update) => update.type)).toEqual([
      'approval_requested',
      'approval_cancelled',
      'approval_requested',
      'approval_resolved',
    ]);
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

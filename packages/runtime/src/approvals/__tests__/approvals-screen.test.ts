import { describe, expect, it } from 'vitest';
import { ApprovalRegistry } from '../approvals.service.js';
import type { ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const ask = (approvals: ApprovalRegistry, signal = new AbortController().signal) =>
  approvals.request({
    callId: callIdSchema.parse('c1'),
    tool: 'run_command',
    command: 'rm -rf build',
    concerns: [],
    signal,
  });

/** What a request settles with when a hook answers something it may not give. */
const NOT_ALLOWED = {
  decision: 'skip_with_message',
  message: 'An approval hook gave an answer it may not give here',
  source: 'hook',
};

/** Subscribes a UI, and returns the types of the updates it hears. */
function uiHears(approvals: ApprovalRegistry): ApprovalUpdate['type'][] {
  const heard: ApprovalUpdate['type'][] = [];

  approvals.subscribe(({ type }) => void heard.push(type));

  return heard;
}

/** The user approves the one request waiting, and the call's answer is returned. */
async function approveWaiting(approvals: ApprovalRegistry, answer: Promise<unknown>) {
  approvals.respond({ id: approvals.pending()[0]!.id, response: { decision: 'approve' } });

  return answer;
}

describe('ApprovalRegistry screeners', () => {
  it('settles a request with the first answer, and no UI hears of it', async () => {
    const approvals = new ApprovalRegistry();
    const heard = uiHears(approvals);

    approvals.screen(async () => ({ decision: 'skip_with_message', message: 'no deletes' }));

    await expect(ask(approvals)).resolves.toEqual({
      decision: 'skip_with_message',
      message: 'no deletes',
      source: 'hook',
    });
    expect(heard).toEqual([]);
    expect(approvals.pending()).toEqual([]);
  });

  it('leaves the request to the user when every screener returns nothing', async () => {
    const approvals = new ApprovalRegistry();
    const heard = uiHears(approvals);
    const seen: string[] = [];

    approvals.screen(async () => void seen.push('first'));
    approvals.screen(async () => void seen.push('second'));
    const answer = ask(approvals);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(['first', 'second']);
    expect(heard).toEqual(['approval_requested']);
    await expect(approveWaiting(approvals, answer)).resolves.toEqual({ decision: 'approve' });
  });

  it('stops asking after the first answer, in registration order', async () => {
    const approvals = new ApprovalRegistry();
    const seen: string[] = [];

    approvals.screen(async () => {
      seen.push('first');

      return { decision: 'skip' };
    });
    approvals.screen(async () => void seen.push('second'));

    await ask(approvals);

    expect(seen).toEqual(['first']);
  });

  it('fails closed when a screener throws: the command is skipped with the reason', async () => {
    const approvals = new ApprovalRegistry();

    approvals.screen(async () => {
      throw new Error('policy file unreadable');
    });

    await expect(ask(approvals)).resolves.toEqual({
      decision: 'skip_with_message',
      message: 'An approval hook failed: policy file unreadable',
      source: 'hook',
    });
  });

  it('redacts credentials in a screener failure before the model can read it', async () => {
    const approvals = new ApprovalRegistry();

    approvals.screen(async () => {
      throw new Error('lookup failed: api_key=hunter2');
    });

    const answer = await ask(approvals);

    expect(JSON.stringify(answer)).not.toContain('hunter2');
    expect(JSON.stringify(answer)).toContain('[REDACTED]');
  });

  it.each(['allow_session', 'always_allow'] as const)(
    'refuses a hook granting %s even when the request offers it: a grant is the user’s',
    async (decision) => {
      const approvals = new ApprovalRegistry();

      approvals.screen(async () => ({ decision }));

      await expect(
        approvals.request({
          callId: callIdSchema.parse('c1'),
          tool: 'run_command',
          command: 'git push',
          concerns: [],
          options: ['approve', 'allow_session', 'always_allow', 'skip'],
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(NOT_ALLOWED);
    },
  );

  it('refuses a hook approving: it can only stop a command, and the user still decides', async () => {
    const approvals = new ApprovalRegistry();
    const heard = uiHears(approvals);

    approvals.screen(async () => ({ decision: 'approve' }));

    await expect(ask(approvals)).resolves.toEqual(NOT_ALLOWED);
    // Settled by the hook's refusal, so no UI was asked and nothing was approved.
    expect(heard).toEqual([]);
  });

  it('lets a hook skip with no UI listening, marked as the hook’s', async () => {
    const skipping = new ApprovalRegistry();

    skipping.screen(async () => ({ decision: 'skip' }));
    await expect(ask(skipping)).resolves.toEqual({ decision: 'skip', source: 'hook' });
  });

  it.each([
    ['an answer the request did not offer', { decision: 'always_allow' }],
    ['something that is not an answer', 'yes'],
  ])('fails closed on %s', async (_label, answer) => {
    const approvals = new ApprovalRegistry();

    approvals.screen(async () => answer);

    await expect(ask(approvals)).resolves.toEqual(NOT_ALLOWED);
  });

  it('rejects with the abort reason, not a skip, when the run aborts while a screener throws', async () => {
    const approvals = new ApprovalRegistry();
    const controller = new AbortController();

    approvals.screen(async () => {
      controller.abort(new Error('stopped'));

      throw new Error('screener noticed');
    });

    await expect(ask(approvals, controller.signal)).rejects.toThrow('stopped');
  });

  it('rejects, and announces nothing, when the run aborts while a screener leaves it to the user', async () => {
    const approvals = new ApprovalRegistry();
    const controller = new AbortController();
    const heard = uiHears(approvals);

    approvals.screen(async () => {
      controller.abort(new Error('stopped'));
    });

    await expect(ask(approvals, controller.signal)).rejects.toThrow('stopped');
    expect(heard).toEqual([]);
    expect(approvals.pending()).toEqual([]);
  });

  it('stops screening once the returned function is called', async () => {
    const approvals = new ApprovalRegistry();
    const stop = approvals.screen(async () => ({ decision: 'skip' }));

    stop();
    uiHears(approvals);

    await expect(approveWaiting(approvals, ask(approvals))).resolves.toEqual({
      decision: 'approve',
    });
  });
});

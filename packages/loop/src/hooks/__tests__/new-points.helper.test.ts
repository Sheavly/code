import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { HookError } from '../../errors/loop.errors.js';
import {
  approvalScreener,
  runNotice,
  runSessionEnd,
  runTaskCompleted,
} from '../new-points.helper.js';

const signal = new AbortController().signal;
const ignoreFailure = () => undefined;
const sessionId = sessionIdSchema.parse('s1');
const request: ApprovalRequest = {
  id: approvalIdSchema.parse('a1'),
  callId: callIdSchema.parse('c1'),
  sessionId,
  tool: 'run_command',
  command: 'rm -rf build',
  concerns: [],
  options: ['approve', 'skip', 'skip_with_message'],
};

describe('runTaskCompleted and runNotice', () => {
  it('lets hooks add context, in order, and reports it', async () => {
    const messages: HistoryMessage[] = [{ role: 'user', content: 'start', at: 1 }];
    const added: string[] = [];
    const base = {
      messages,
      signal,
      onContext: ({ hook, content }: { hook: string; content: string }) =>
        added.push(`${hook}: ${content}`),
      onHookError: ignoreFailure,
    };

    await runNotice({
      ...base,
      hooks: [
        defineHook({
          name: 'a',
          notice: async ({ addContext, notice }) => addContext(notice.kind),
        }),
        defineHook({ name: 'b', taskCompleted: async () => undefined }),
      ],
      notice: { kind: 'context-usage', context: { used: 1 } },
    });
    await runTaskCompleted({
      ...base,
      hooks: [
        defineHook({
          name: 'c',
          taskCompleted: async ({ addContext, tasks }) => addContext(`${tasks.length} done`),
        }),
      ],
      tasks: [],
    });

    expect(added).toEqual(['a: context-usage', 'c: 0 done']);
    expect(messages.map((m) => m.role === 'user' && m.content)).toEqual([
      'start',
      'context-usage',
      '0 done',
    ]);
  });

  it('reports a failing hook and still runs the next', async () => {
    const failures: HookError[] = [];
    const seen: string[] = [];

    await runNotice({
      hooks: [
        defineHook({
          name: 'broken',
          notice: async () => {
            throw new Error('nope');
          },
        }),
        defineHook({ name: 'ok', notice: async () => void seen.push('ok') }),
      ],
      messages: [],
      signal,
      onContext: () => undefined,
      onHookError: (failure) => failures.push(failure),
      notice: { kind: 'output-continuation', attempt: 1 },
    });

    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'notice' });
    expect(seen).toEqual(['ok']);
  });

  it('adds nothing from a hook that adds context after the run was aborted', async () => {
    const stop = new AbortController();
    const messages: HistoryMessage[] = [];
    let late: (content: string) => void = () => undefined;

    await runTaskCompleted({
      hooks: [
        defineHook({
          name: 'late',
          taskCompleted: async ({ addContext }) => {
            late = addContext;
          },
        }),
      ],
      messages,
      signal: stop.signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
      tasks: [],
    });
    stop.abort();
    late('too late');

    expect(messages).toEqual([]);
  });
});

describe('runSessionEnd', () => {
  it('tells every hook the outcome, even after an abort, and reports a failing one', async () => {
    const stop = new AbortController();
    const failures: HookError[] = [];
    const seen: string[] = [];

    stop.abort();
    await runSessionEnd({
      hooks: [
        defineHook({
          name: 'broken',
          sessionEnd: async () => {
            throw new Error('disk full');
          },
        }),
        defineHook({
          name: 'log',
          sessionEnd: async ({ outcome, messages }) =>
            void seen.push(`${outcome} ${messages.length}`),
        }),
      ],
      outcome: 'interrupted',
      messages: [{ role: 'user', content: 'hi', at: 1 }],
      signal: stop.signal,
      onHookError: (failure) => failures.push(failure),
    });

    expect(seen).toEqual(['interrupted 1']);
    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'sessionEnd' });
  });
});

describe('runSessionEnd timeout', () => {
  it('reports a hook that hangs and still finishes, so done is not held', async () => {
    const failures: HookError[] = [];
    const seen: string[] = [];

    await runSessionEnd({
      hooks: [
        defineHook({ name: 'hang', sessionEnd: () => new Promise<void>(() => undefined) }),
        defineHook({ name: 'after', sessionEnd: async () => void seen.push('after') }),
      ],
      outcome: 'completed',
      messages: [],
      signal,
      onHookError: (failure) => failures.push(failure),
      timeoutMs: 20,
    });

    expect(failures[0]).toMatchObject({ hook: 'hang', handler: 'sessionEnd' });
    expect(failures[0]?.message).toContain('did not finish within 20ms');
    expect(seen).toEqual(['after']);
  });
});

describe('approvalScreener', () => {
  const screen = (
    hooks: Parameters<typeof approvalScreener>[0]['hooks'],
    failures: HookError[] = [],
  ) =>
    approvalScreener({ hooks, sessionId, onHookError: (failure) => failures.push(failure) })({
      request,
      signal,
    });

  it('returns the first answer, so a hook can stop a command', async () => {
    const answer = { decision: 'skip_with_message' as const, message: 'no deletes' };
    const seen: string[] = [];

    await expect(
      screen([
        defineHook({ name: 'quiet', approval: async () => void seen.push('quiet') }),
        defineHook({ name: 'guard', approval: async () => answer }),
        defineHook({ name: 'later', approval: async () => void seen.push('later') }),
      ]),
    ).resolves.toEqual(answer);
    expect(seen).toEqual(['quiet']);
  });

  it('leaves the request to the user when no hook answers', async () => {
    await expect(
      screen([defineHook({ name: 'quiet', approval: async () => undefined })]),
    ).resolves.toBe(undefined);
  });

  it('fails closed: a throwing hook is reported and its error thrown on', async () => {
    const failures: HookError[] = [];

    await expect(
      screen(
        [
          defineHook({
            name: 'guard',
            approval: async () => {
              throw new Error('policy unreadable');
            },
          }),
        ],
        failures,
      ),
    ).rejects.toMatchObject({ hook: 'guard', handler: 'approval' });
    expect(failures[0]).toMatchObject({ hook: 'guard', handler: 'approval' });
  });

  it('ignores another session’s request', async () => {
    const other = approvalScreener({
      hooks: [defineHook({ name: 'guard', approval: async () => ({ decision: 'skip' }) })],
      sessionId: sessionIdSchema.parse('s2'),
      onHookError: ignoreFailure,
    });

    await expect(other({ request, signal })).resolves.toBeUndefined();
  });
});

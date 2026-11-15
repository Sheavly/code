import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { HookError } from '../../errors/loop.errors.js';
import { runAfterTurn, runSessionStart } from '../hooks.helper.js';
import type { Message } from '@sheavly/protocol/message/message.types';

const signal = new AbortController().signal;
const ignoreFailure = () => undefined;

describe('runSessionStart', () => {
  it('runs hooks in order, each adding context the next one sees', async () => {
    const messages: Message[] = [{ role: 'user', content: 'start' }];
    const seen: number[] = [];

    await runSessionStart({
      hooks: [
        defineHook({ name: 'a', sessionStart: async ({ addContext }) => addContext('from a') }),
        defineHook({
          name: 'b',
          sessionStart: async (context) => {
            seen.push(context.messages.length);
            context.addContext('from b');
          },
        }),
      ],
      messages,
      signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual([2]);
    expect(messages.map((m) => m.content)).toEqual(['start', 'from a', 'from b']);
  });

  it('reports a failing hook and still runs the next', async () => {
    const messages: Message[] = [{ role: 'user', content: 'start' }];
    const failures: HookError[] = [];

    await runSessionStart({
      hooks: [
        defineHook({
          name: 'broken',
          sessionStart: async () => {
            throw new Error('no network');
          },
        }),
        defineHook({
          name: 'ok',
          sessionStart: async ({ addContext }) => addContext('still here'),
        }),
      ],
      messages,
      signal,
      onContext: () => undefined,
      onHookError: (failure) => failures.push(failure),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'sessionStart' });
    expect(messages.map((m) => m.content)).toEqual(['start', 'still here']);
  });

  it('does not report a hook that fails because the run was aborted, and runs no more', async () => {
    const stop = new AbortController();
    const failures: HookError[] = [];
    const seen: string[] = [];

    await runSessionStart({
      hooks: [
        defineHook({
          name: 'slow',
          sessionStart: async () => {
            stop.abort();
            throw new Error('aborted');
          },
        }),
        defineHook({ name: 'next', sessionStart: async () => void seen.push('next') }),
      ],
      messages: [],
      signal: stop.signal,
      onContext: () => undefined,
      onHookError: (failure) => failures.push(failure),
    });

    expect(failures).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('adds nothing from a hook that calls addContext after the run was aborted', async () => {
    const stop = new AbortController();
    const messages: Message[] = [];
    let late: (content: string) => void = () => undefined;

    await runSessionStart({
      hooks: [
        defineHook({
          name: 'late',
          sessionStart: async ({ addContext }) => {
            late = addContext;
          },
        }),
      ],
      messages,
      signal: stop.signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });
    stop.abort();
    late('too late');

    expect(messages).toEqual([]);
  });

  it('stops waiting for a hook that ignores the abort', async () => {
    const stop = new AbortController();
    const hang = defineHook({
      name: 'hang',
      sessionStart: () => new Promise<void>(() => undefined),
    });
    const run = runSessionStart({
      hooks: [hang],
      messages: [],
      signal: stop.signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    stop.abort();
    await expect(run).resolves.toBeUndefined();
  });
});

describe('runAfterTurn', () => {
  it('runs hooks in order with the turn, its reply and a snapshot of history', async () => {
    const reply: Message = { role: 'assistant', content: 'done', toolCalls: [] };
    const messages: Message[] = [{ role: 'user', content: 'hi' }, reply];
    const seen: string[] = [];
    const record = (name: string) =>
      defineHook({
        name,
        afterTurn: async (context) => {
          seen.push(
            `${name}: turn ${context.turn} ${context.stopReason} "${context.reply.content}"`,
          );
          (context.messages as Message[]).length = 0;
        },
      });

    await runAfterTurn({
      hooks: [record('a'), record('b')],
      turn: 2,
      stopReason: 'end_turn',
      reply,
      messages,
      signal,
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual(['a: turn 2 end_turn "done"', 'b: turn 2 end_turn "done"']);
    expect(messages).toHaveLength(2);
  });

  it('reports a failing hook and still runs the next', async () => {
    const failures: HookError[] = [];
    const seen: string[] = [];

    await runAfterTurn({
      hooks: [
        defineHook({
          name: 'broken',
          afterTurn: async () => {
            throw new Error('nope');
          },
        }),
        defineHook({ name: 'ok', afterTurn: async () => void seen.push('ok') }),
      ],
      turn: 1,
      stopReason: 'end_turn',
      reply: { role: 'assistant', content: '', toolCalls: [] },
      messages: [],
      signal,
      onHookError: (failure) => failures.push(failure),
    });

    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'afterTurn' });
    expect(seen).toEqual(['ok']);
  });
});

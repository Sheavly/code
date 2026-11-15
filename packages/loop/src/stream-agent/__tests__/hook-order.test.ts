import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { ContributionError } from '../../errors/loop.errors.js';
import { runAgent } from '../stream-agent.helper.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';

const prompt = { role: 'user' as const, content: 'hi' };

/** A hook that records its name when its `beforeTurn` runs. */
const named = (log: string[], name: string, after?: string[]) =>
  defineHook({
    name,
    ...(after && { after }),
    beforeTurn: async () => void log.push(name),
  });

function provider(calls: { count: number }): Provider {
  return {
    async *stream() {
      calls.count += 1;
      yield { type: 'text_delta', text: 'ok' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

describe('hook order', () => {
  it('runs hooks in the order given when none names another', async () => {
    const log: string[] = [];

    await runAgent({
      provider: provider({ count: 0 }),
      tools: [],
      messages: [prompt],
      hooks: [named(log, 'a'), named(log, 'b'), named(log, 'c')],
    });

    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('puts a hook after the ones it names, whatever order they were given in', async () => {
    const log: string[] = [];

    await runAgent({
      provider: provider({ count: 0 }),
      tools: [],
      messages: [prompt],
      hooks: [named(log, 'late', ['early']), named(log, 'other'), named(log, 'early')],
    });

    expect(log).toEqual(['other', 'early', 'late']);
  });

  it.each([
    [
      'a duplicate name',
      [
        defineHook({ name: 'a', beforeTurn: async () => undefined }),
        defineHook({ name: 'a', beforeTurn: async () => undefined }),
      ],
      'duplicate',
    ],
    [
      'an after naming a hook the run does not have',
      [named([], 'a', ['missing'])],
      'unknown_after',
    ],
    ['a cycle', [named([], 'a', ['b']), named([], 'b', ['a'])], 'cycle'],
  ] as const)(
    'fails the run before the first model call for %s',
    async (_label, hooks, problem) => {
      const calls = { count: 0 };
      const events: AgentEvent[] = [];

      await expect(
        runAgent({
          provider: provider(calls),
          tools: [],
          messages: [prompt],
          hooks: [...hooks],
          onEvent: (event) => events.push(event),
        }),
      ).rejects.toThrow(expect.objectContaining({ name: ContributionError.name, problem }));
      expect(calls.count).toBe(0);
      // A miswired hook fails the run like any other failure: run_failed, then its one done.
      expect(events.map((event) => event.type).filter((type) => type !== 'context_added')).toEqual([
        'run_failed',
        'done',
      ]);
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'failed' });
    },
  );
});

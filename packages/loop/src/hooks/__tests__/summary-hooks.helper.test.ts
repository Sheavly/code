import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { SummaryHookError } from '../../errors/loop.errors.js';
import { runAfterSummary, runBeforeSummary } from '../hooks.helper.js';
import { parseSummaryChange } from '../summary-change.validator.js';

const signal = new AbortController().signal;
const ignoreFailure = () => undefined;
const section = (id: string, body: string) => ({
  id: summarySectionIdSchema.parse(id),
  title: id,
  body,
});
const checkpoint: SummaryMessage = {
  role: 'summary',
  sections: [section('goal', 'g')],
  kept: 1,
  summarized: 1,
  summarizer: 'test',
  at: 5,
};

describe('parseSummaryChange', () => {
  it('treats nothing returned as no change', () => {
    expect(parseSummaryChange({ input: undefined, hook: 'h' })).toBeUndefined();
  });

  it('accepts keepTokens and sections', () => {
    const input = { keepTokens: 500, sections: [section('rules', 'be kind')] };

    expect(parseSummaryChange({ input, hook: 'h' })).toEqual(input);
  });

  it('names the hook for a typo, a wrong type and duplicate section ids', () => {
    const bad = [
      { keepToken: 5 },
      { keepTokens: '5' },
      { keepTokens: 0 },
      { sections: [section('a', 'x'), section('a', 'y')] },
      null,
    ];

    for (const input of bad) {
      expect(() => parseSummaryChange({ input, hook: 'h' })).toThrow(SummaryHookError);
      expect(() => parseSummaryChange({ input, hook: 'h' })).toThrow('Hook h returned');
    }
  });
});

describe('runBeforeSummary', () => {
  it('does nothing without a handler', async () => {
    const result = await runBeforeSummary({
      hooks: [{ name: 'idle', afterTurn: async () => undefined }],
      reason: 'threshold',
      messages: [],
      context: {},
      signal,
      onHookError: ignoreFailure,
    });

    expect(result).toEqual({ keepTokens: undefined, sections: [] });
  });

  it('gives each hook the reason and context, takes the last keepTokens and merges sections by id', async () => {
    const seen: unknown[] = [];
    const result = await runBeforeSummary({
      hooks: [
        {
          name: 'a',
          beforeSummary: async (context) => {
            seen.push(context.reason, context.context);

            return { keepTokens: 100, sections: [section('rules', 'one'), section('x', 'x')] };
          },
        },
        { name: 'quiet', beforeSummary: async () => undefined },
        {
          name: 'b',
          beforeSummary: async () => ({ sections: [section('rules', 'two')] }),
        },
        { name: 'c', beforeSummary: async () => ({ keepTokens: 200 }) },
      ],
      reason: 'overflow',
      messages: [],
      context: { window: 1000 },
      signal,
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual(['overflow', { window: 1000 }]);
    expect(result).toEqual({
      keepTokens: 200,
      sections: [section('rules', 'two'), section('x', 'x')],
    });
  });

  it('hands a copy of the messages, so editing them changes nothing', async () => {
    const messages = [{ role: 'user' as const, content: 'keep me', at: 1 }];

    await runBeforeSummary({
      hooks: [
        {
          name: 'mutator',
          beforeSummary: async ({ messages: given }) => {
            const first = given[0];

            if (first?.role === 'user') first.content = 'changed';

            return undefined;
          },
        },
      ],
      reason: 'manual',
      messages,
      context: {},
      signal,
      onHookError: ignoreFailure,
    });

    expect(messages[0]?.content).toBe('keep me');
  });

  it('reports a SummaryHookError naming a hook that returns an invalid change, and skips it', async () => {
    const failures: Error[] = [];
    // Typed correctly but not valid: the schema, not the compiler, is what a plain-JS hook meets.
    const result = await runBeforeSummary({
      hooks: [
        { name: 'typo', beforeSummary: async () => ({ keepTokens: -1 }) },
        { name: 'fine', beforeSummary: async () => ({ keepTokens: 7 }) },
      ],
      reason: 'threshold',
      messages: [],
      context: {},
      signal,
      onHookError: (failure) => failures.push(failure),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain('Hook typo returned an invalid summary change');
    expect(result.keepTokens).toBe(7);
  });

  it('does not ask any hook when the run is already aborted', async () => {
    const aborted = new AbortController();
    const asked: string[] = [];

    aborted.abort();

    const result = await runBeforeSummary({
      hooks: [
        {
          name: 'late',
          beforeSummary: async () => {
            asked.push('late');

            return { keepTokens: 1 };
          },
        },
      ],
      reason: 'threshold',
      messages: [],
      context: {},
      signal: aborted.signal,
      onHookError: ignoreFailure,
    });

    expect(asked).toEqual([]);
    expect(result).toEqual({ keepTokens: undefined, sections: [] });
  });

  it('reports the hook by name when its handler throws, and the summary goes on', async () => {
    const failures: Error[] = [];
    const result = await runBeforeSummary({
      hooks: [
        {
          name: 'broken',
          beforeSummary: async () => {
            throw new Error('nope');
          },
        },
      ],
      reason: 'threshold',
      messages: [],
      context: {},
      signal,
      onHookError: (failure) => failures.push(failure),
    });

    expect(failures[0]?.message).toBe('Hook broken failed in beforeSummary: nope');
    expect(result).toEqual({ keepTokens: undefined, sections: [] });
  });

  it('stops waiting on a hook that ignores its signal once the run aborts', async () => {
    const controller = new AbortController();
    const stuck = { name: 'stuck', beforeSummary: () => new Promise<undefined>(() => undefined) };
    const later = { name: 'later', beforeSummary: async () => ({ keepTokens: 1 }) };
    const run = runBeforeSummary({
      hooks: [stuck, later],
      reason: 'threshold',
      messages: [],
      context: {},
      signal: controller.signal,
      onHookError: ignoreFailure,
    });

    controller.abort();

    // Returns instead of hanging, and does not ask the hooks after it.
    await expect(run).resolves.toEqual({ keepTokens: undefined, sections: [] });
  });
});

describe('runAfterSummary', () => {
  it('lets each hook add context after the checkpoint, reported in order', async () => {
    const messages: HistoryMessage[] = [
      { role: 'user', content: 'older', at: 1 },
      { role: 'user', content: 'latest', at: 2 },
      checkpoint,
    ];
    const added: string[] = [];
    const seen: unknown[] = [];

    await runAfterSummary({
      hooks: [
        {
          name: 'restore',
          afterSummary: async (context) => {
            seen.push(context.reason, context.checkpoint, context.messages[0]?.role);
            context.addContext('instructions again');
          },
        },
        { name: 'second', afterSummary: async ({ addContext }) => addContext('more') },
      ],
      reason: 'threshold',
      checkpoint,
      messages,
      signal,
      onContext: ({ hook, content }) => added.push(`${hook}: ${content}`),
      onHookError: ignoreFailure,
    });

    // Handlers see the model's view: the checkpoint as a user message, never the `summary` role.
    expect(seen).toEqual(['threshold', checkpoint, 'user']);
    expect(added).toEqual(['restore: instructions again', 'second: more']);
    expect(messages.slice(3).map((m) => m.role === 'user' && m.content)).toEqual([
      'instructions again',
      'more',
    ]);
  });

  it('asks no hook and adds nothing when the run is already aborted', async () => {
    const aborted = new AbortController();
    const messages: HistoryMessage[] = [{ role: 'user', content: 'latest', at: 2 }, checkpoint];
    const asked: string[] = [];

    aborted.abort();

    await runAfterSummary({
      hooks: [
        {
          name: 'late',
          afterSummary: async ({ addContext }) => {
            asked.push('late');
            addContext('too late');
          },
        },
      ],
      reason: 'threshold',
      checkpoint,
      messages,
      signal: aborted.signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(asked).toEqual([]);
    expect(messages).toHaveLength(2);
  });

  it('hands copies, so a hook that edits them cannot change the stored checkpoint', async () => {
    const stored: SummaryMessage = { ...checkpoint, sections: [section('goal', 'g')] };
    const messages: HistoryMessage[] = [{ role: 'user', content: 'latest', at: 2 }, stored];

    await runAfterSummary({
      hooks: [
        {
          name: 'mutator',
          afterSummary: async (context) => {
            context.checkpoint.kept = 99;
            context.checkpoint.sections.push(section('extra', 'x'.repeat(10_000)));

            const view = context.messages[0];

            if (view?.role === 'user') view.content = 'changed';
          },
        },
      ],
      reason: 'threshold',
      checkpoint: stored,
      messages,
      signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(stored.kept).toBe(1);
    expect(stored.sections).toEqual([section('goal', 'g')]);
    expect(messages[0]).toMatchObject({ content: 'latest' });
  });
});

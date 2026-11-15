import { beforeEach, describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { HookError } from '../../errors/loop.errors.js';
import { InvalidHistoryError } from '../../errors/loop.errors.js';
import { runBeforeModelCall, runBeforeTurn, runOnError } from '../hooks.helper.js';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const signal = new AbortController().signal;
const ignoreFailure = () => undefined;

describe('runBeforeTurn', () => {
  it('runs hooks in order; each sees the context added before it', async () => {
    const messages: Message[] = [{ role: 'user', content: 'start' }];
    const seen: number[] = [];
    const added: string[] = [];
    const first = defineHook({
      name: 'first',
      beforeTurn: async ({ addContext }) => addContext('from first'),
    });
    const second = defineHook({
      name: 'second',
      beforeTurn: async (context) => {
        seen.push(context.messages.length);
        context.addContext(`turn ${context.turn}`);
      },
    });

    await runBeforeTurn({
      hooks: [first, second],
      turn: 3,
      messages,
      context: {},
      signal,
      onContext: ({ hook, content }) => added.push(`${hook}: ${content}`),
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual([2]);
    expect(messages.map((m) => m.content)).toEqual(['start', 'from first', 'turn 3']);
    expect(added).toEqual(['first: from first', 'second: turn 3']);
  });

  it('gives hooks a snapshot, so they change history only through addContext', async () => {
    const messages: Message[] = [{ role: 'user', content: 'start' }];
    const sneaky = defineHook({
      name: 'sneaky',
      beforeTurn: async (context) => {
        (context.messages as Message[]).length = 0;
      },
    });

    await runBeforeTurn({
      hooks: [sneaky],
      turn: 1,
      messages,
      context: {},
      signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(messages).toHaveLength(1);
  });

  it('gives hooks the context state as a copy, so one hook cannot change what the next sees', async () => {
    const context = { window: 300_000, used: 1_000 };
    const seen: unknown[] = [];
    const meddler = defineHook({
      name: 'meddler',
      beforeTurn: async (given) => {
        seen.push({ ...given.context });
        given.context.used = 0;
      },
    });
    const reader = defineHook({
      name: 'reader',
      beforeTurn: async (given) => void seen.push({ ...given.context }),
    });

    await runBeforeTurn({
      hooks: [meddler, reader],
      turn: 1,
      messages: [],
      context,
      signal,
      onContext: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual([context, context]);
    expect(context.used).toBe(1_000);
  });
});

describe('runBeforeModelCall', () => {
  const prompt: Message = { role: 'user', content: 'start' };
  const changes: { hook: string; added: number; removed: number; edited: number }[] = [];
  const failures: HookError[] = [];
  const run = (hooks: Hook[], messages: Message[] = [prompt]) =>
    runBeforeModelCall({
      hooks,
      turn: 1,
      messages,
      context: {},
      signal,
      onChanged: (change) => changes.push(change),
      onHookError: (failure) => failures.push(failure),
    });

  beforeEach(() => {
    changes.length = 0;
    failures.length = 0;
  });

  it('reports what each hook added, dropped and edited, as counts', async () => {
    const tool = (id: string): Message => ({
      role: 'tool',
      toolCallId: callIdSchema.parse(id),
      content: 'long output',
      isError: false,
    });
    const call = (id: string): Message => ({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: callIdSchema.parse(id), name: 'x', input: {} }],
    });
    const again: Message = { role: 'user', content: 'and again' };
    const history = [prompt, call('1'), tool('1'), call('2'), tool('2'), again];
    const hide = defineHook({
      name: 'hide',
      beforeModelCall: async ({ messages }) =>
        messages.map((m) => (m.role === 'tool' ? { ...m, content: '[hidden]' } : m)),
    });
    const drop = defineHook({
      name: 'drop',
      beforeModelCall: async ({ messages }) => messages.filter((m, i) => i < 1 || i > 2),
    });
    const note = defineHook({
      name: 'note',
      beforeModelCall: async ({ messages }) => [
        ...messages.slice(0, -1),
        { role: 'assistant', content: 'a note', toolCalls: [] },
        ...messages.slice(-1),
      ],
    });

    await run([hide, drop, note], history);

    expect(changes).toEqual([
      { hook: 'hide', added: 0, removed: 0, edited: 2 },
      { hook: 'drop', added: 0, removed: 2, edited: 0 },
      { hook: 'note', added: 1, removed: 0, edited: 0 },
    ]);
  });

  it('counts a reworded user message as one removed plus one added, never as an edit', async () => {
    const reword = defineHook({
      name: 'reword',
      beforeModelCall: async ({ messages }) => [
        { role: 'user', content: 'older, reworded' },
        ...messages.slice(1),
      ],
    });
    const history: Message[] = [{ role: 'user', content: 'older' }, prompt];

    await run([reword], history);

    expect(changes).toEqual([{ hook: 'reword', added: 1, removed: 1, edited: 0 }]);
  });

  it('reports nothing when no hook changed the messages', async () => {
    await run([defineHook({ name: 'same', beforeModelCall: async ({ messages }) => messages })]);

    expect(changes).toEqual([]);
  });

  it('returns the messages as they are when no hook handles it', async () => {
    const messages = [prompt];

    expect(await run([defineHook({ name: 'other', afterTurn: async () => undefined })])).toEqual(
      messages,
    );
  });

  it('chains hooks in order: each gets the previous hook’s result', async () => {
    const seen: number[] = [];
    const add = (name: string) =>
      defineHook({
        name,
        beforeModelCall: async ({ messages }) => {
          seen.push(messages.length);

          return [...messages, { role: 'assistant', content: name, toolCalls: [] }];
        },
      });

    const result = await run([add('a'), add('b')]);

    expect(seen).toEqual([1, 2]);
    expect(result.map((message) => message.content)).toEqual(['start', 'a', 'b']);
  });

  it('never changes the messages it was given, even when a hook edits its copy', async () => {
    const messages: Message[] = [prompt];
    const sneaky = defineHook({
      name: 'sneaky',
      beforeModelCall: async (given) => {
        (given.messages as Message[]).length = 0;

        return [prompt];
      },
    });

    await run([sneaky], messages);

    expect(messages).toEqual([prompt]);
  });

  it('gives each hook its own copy of the context state', async () => {
    const context = { window: 1_000, used: 10 };
    const seen: unknown[] = [];
    const meddler = defineHook({
      name: 'meddler',
      beforeModelCall: async (given) => {
        seen.push({ ...given.context });
        given.context.used = 0;

        return given.messages;
      },
    });
    const reader = defineHook({
      name: 'reader',
      beforeModelCall: async (given) => {
        seen.push({ ...given.context });

        return given.messages;
      },
    });

    await runBeforeModelCall({
      hooks: [meddler, reader],
      turn: 1,
      messages: [prompt],
      context,
      signal,
      onChanged: () => undefined,
      onHookError: ignoreFailure,
    });

    expect(seen).toEqual([context, context]);
    expect(context.used).toBe(10);
  });

  it('gives hooks deep copies: editing a message in place changes nothing stored', async () => {
    const stored: Message[] = [{ role: 'user', content: 'start' }];
    const editor = defineHook({
      name: 'editor',
      beforeModelCall: async ({ messages }) => {
        (messages[0] as { content: string }).content = 'rewritten';

        return messages;
      },
    });

    // The rewritten latest user message breaks the rules: the hook is skipped and reported, and
    // the messages from before it are sent.
    expect(await run([editor], stored)).toEqual([{ role: 'user', content: 'start' }]);
    expect(stored[0]?.content).toBe('start');
    expect(failures[0]?.message).toContain(
      'Hook editor produced invalid history: the latest user message was removed or changed',
    );
  });

  it('skips a result that is not made of messages, reporting a typed error naming the hook', async () => {
    const nulls = { name: 'nulls', beforeModelCall: async () => [null] } as unknown as Hook;

    expect(await run([nulls])).toEqual([prompt]);
    expect(failures[0]?.cause).toBeInstanceOf(InvalidHistoryError);
    expect(failures[0]?.message).toContain('Hook nulls produced invalid history');
  });

  it('skips a hook that throws, reports it, and sends what the hooks before it produced', async () => {
    const broken = defineHook({
      name: 'broken',
      beforeModelCall: async () => {
        throw new Error('boom');
      },
    });

    expect(await run([broken])).toEqual([prompt]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'beforeModelCall' });
  });

  it('does not blame a hook that returns its input when the history was already broken', async () => {
    const dangling: Message[] = [
      prompt,
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: callIdSchema.parse('1'), name: 'x', input: {} }],
      },
    ];
    const passthrough = defineHook({
      name: 'passthrough',
      beforeModelCall: async ({ messages }) => messages,
    });

    expect(await run([passthrough], dangling)).toEqual(dangling);
  });

  it('names the hook whose result breaks the rules, skips it, and runs the next on what was sent before', async () => {
    const ran: string[] = [];
    const orphan = defineHook({
      name: 'orphan',
      beforeModelCall: async ({ messages }) => [
        ...messages,
        { role: 'tool', toolCallId: callIdSchema.parse('x'), content: '', isError: false },
      ],
    });
    const later = defineHook({
      name: 'later',
      beforeModelCall: async ({ messages }) => {
        ran.push('later');

        return messages;
      },
    });

    expect(await run([orphan, later])).toEqual([prompt]);
    expect(failures[0]?.message).toContain('Hook orphan produced invalid history');
    expect(ran).toEqual(['later']);
  });

  it('holds every hook to the original latest user message, not the previous result’s', async () => {
    const reword = defineHook({
      name: 'reword',
      beforeModelCall: async () => [{ role: 'user', content: 'changed' }],
    });
    const restore = defineHook({
      name: 'restore',
      beforeModelCall: async () => [{ role: 'user', content: 'changed' }],
    });

    expect(await run([reword, restore])).toEqual([prompt]);
    expect(failures.map((failure) => failure.hook)).toEqual(['reword', 'restore']);
    expect(failures[0]?.message).toContain(
      'Hook reword produced invalid history: the latest user message was removed or changed',
    );
  });
});

describe('defineHook', () => {
  it('rejects a hook with no handlers', () => {
    expect(() => defineHook({ name: 'empty' })).toThrow('Hook empty: define at least one handler');
  });

  it('accepts a hook with only one of the new handlers', () => {
    for (const handler of ['sessionStart', 'afterTurn', 'onError'] as const) {
      expect(defineHook({ name: handler, [handler]: async () => undefined }).name).toBe(handler);
    }
  });
});

describe('runOnError', () => {
  it('tells every hook, in order, even when one of them throws, and reports the failure', async () => {
    const seen: string[] = [];
    const failures: HookError[] = [];
    const error = new Error('provider down');

    await runOnError({
      hooks: [
        defineHook({
          name: 'broken',
          onError: async () => {
            seen.push('broken');
            throw new Error('disk full');
          },
        }),
        defineHook({
          name: 'log',
          onError: async (context) => {
            seen.push(
              `log: ${(context.error as Error).message}, ${context.messages.length} messages`,
            );
          },
        }),
      ],
      error,
      messages: [{ role: 'user', content: 'hi' }],
      onHookError: (failure) => failures.push(failure),
    });

    expect(seen).toEqual(['broken', 'log: provider down, 1 messages']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(HookError);
    expect(failures[0]).toMatchObject({ hook: 'broken', handler: 'onError' });
    expect(failures[0]?.message).toBe('Hook broken failed in onError: disk full');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { HookError } from '../../errors/loop.errors.js';
import { InvalidHistoryError } from '../../errors/loop.errors.js';
import {
  runAfterTurn,
  runBeforeModelCall,
  runBeforeTurn,
  runOnError,
  runSessionStart,
  runToolCall,
} from '../hooks.helper.js';
import type { Message, ToolCall } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const signal = new AbortController().signal;

const echo = defineTool({
  name: 'echo',
  description: 'Echoes text back',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ input }) => JSON.stringify(input),
});

const call: ToolCall = {
  id: callIdSchema.parse('c1'),
  name: 'echo',
  input: { description: 'echoing', text: 'hi' },
};

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
    });

    expect(seen).toEqual([context, context]);
    expect(context.used).toBe(1_000);
  });
});

describe('runBeforeModelCall', () => {
  const prompt: Message = { role: 'user', content: 'start' };
  const changes: { hook: string; added: number; removed: number; edited: number }[] = [];
  const run = (hooks: Hook[], messages: Message[] = [prompt]) =>
    runBeforeModelCall({
      hooks,
      turn: 1,
      messages,
      context: {},
      signal,
      onChanged: (change) => changes.push(change),
    });

  beforeEach(() => {
    changes.length = 0;
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

    await expect(run([editor], stored)).rejects.toThrow(
      'Hook editor produced invalid history: the latest user message was removed or changed',
    );
    expect(stored[0]?.content).toBe('start');
  });

  it('refuses a result that is not made of messages, as a typed error naming the hook', async () => {
    const nulls = { name: 'nulls', beforeModelCall: async () => [null] } as unknown as Hook;

    await expect(run([nulls])).rejects.toThrow(InvalidHistoryError);
    await expect(run([nulls])).rejects.toThrow('Hook nulls produced invalid history');
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

  it('names the hook whose result breaks the rules, and stops there', async () => {
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

    await expect(run([orphan, later])).rejects.toThrow(InvalidHistoryError);
    await expect(run([orphan, later])).rejects.toThrow('Hook orphan produced invalid history');
    expect(ran).toEqual([]);
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

    await expect(run([reword, restore])).rejects.toThrow(
      'Hook reword produced invalid history: the latest user message was removed or changed',
    );
  });
});

describe('runToolCall', () => {
  it('runs the tool directly when no hook wraps tool calls', async () => {
    const { message } = await runToolCall({ hooks: [], tools: [echo], call, signal });

    expect(message).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: '{"text":"hi"}',
      isError: false,
    });
  });

  it('nests hooks: the first is outermost', async () => {
    const order: string[] = [];
    const wrap = (name: string) =>
      defineHook({
        name,
        aroundToolCall: async ({ next }) => {
          order.push(`${name} in`);
          const result = await next();

          order.push(`${name} out`);

          return result;
        },
      });

    await runToolCall({ hooks: [wrap('a'), wrap('b')], tools: [echo], call, signal });

    expect(order).toEqual(['a in', 'b in', 'b out', 'a out']);
  });

  it('lets a hook block the call: the tool never runs', async () => {
    let ran = false;
    const tool = defineTool({ ...echo, execute: async () => ((ran = true), 'ran') });
    const block = defineHook({
      name: 'block',
      aroundToolCall: async ({ call: blocked }) => ({
        content: `${blocked.name} is not allowed`,
        isError: true,
      }),
    });

    const { message } = await runToolCall({ hooks: [block], tools: [tool], call, signal });

    expect(ran).toBe(false);
    expect(message).toMatchObject({ content: 'echo is not allowed', isError: true });
  });

  it('lets a hook change the input (validated as usual) and the result', async () => {
    const shout = defineHook({
      name: 'shout',
      aroundToolCall: async ({ call: current, next }) => {
        const result = await next({ ...(current.input as object), text: 'changed' });

        return { ...result, content: result.content.toUpperCase() };
      },
    });
    const invalid = defineHook({ name: 'invalid', aroundToolCall: async ({ next }) => next({}) });

    expect(
      (await runToolCall({ hooks: [shout], tools: [echo], call, signal })).message,
    ).toMatchObject({
      content: '{"TEXT":"CHANGED"}',
    });
    expect(
      (await runToolCall({ hooks: [invalid], tools: [echo], call, signal })).message,
    ).toMatchObject({
      isError: true,
    });
  });

  it('passes the call description, and turns a throwing hook into an error result', async () => {
    let description = '';
    const broken = defineHook({
      name: 'broken',
      aroundToolCall: async (context) => {
        description = context.description;
        throw new Error('boom');
      },
    });

    const { message } = await runToolCall({ hooks: [broken], tools: [echo], call, signal });

    expect(description).toBe('echoing');
    expect(message).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: 'Hook broken failed: boom',
      isError: true,
    });
  });
  it("passes a tool's artifacts through, and lets a hook see or drop them", async () => {
    const artifacts = [{ kind: 'table', columns: ['a', 'b'], rows: [[1, 2]] }];
    const parser = defineTool({
      ...echo,
      execute: async () => ({ content: 'Parsed 1 row', artifacts }),
    });
    let seen: unknown;
    const observe = defineHook({
      name: 'observe',
      aroundToolCall: async ({ next }) => {
        const result = await next();

        seen = result.artifacts;

        return result;
      },
    });
    const drop = defineHook({
      name: 'drop',
      aroundToolCall: async ({ next }) => ({ ...(await next()), artifacts: undefined }),
    });

    const kept = await runToolCall({ hooks: [observe], tools: [parser], call, signal });
    const dropped = await runToolCall({ hooks: [drop], tools: [parser], call, signal });

    expect(seen).toEqual(artifacts);
    expect(kept).toMatchObject({
      message: { role: 'tool', toolCallId: 'c1', content: 'Parsed 1 row', isError: false },
      artifacts,
    });
    expect(dropped.artifacts).toBeUndefined();
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
    });

    expect(seen).toEqual([2]);
    expect(messages.map((m) => m.content)).toEqual(['start', 'from a', 'from b']);
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
    });

    expect(seen).toEqual(['a: turn 2 end_turn "done"', 'b: turn 2 end_turn "done"']);
    expect(messages).toHaveLength(2);
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

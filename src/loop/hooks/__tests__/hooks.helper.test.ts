import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { HookError } from '../../../runtime/errors/hooks.errors.js';
import {
  runAfterTurn,
  runBeforeTurn,
  runOnError,
  runSessionStart,
  runToolCall,
} from '../hooks.helper.js';
import type { Message, ToolCall } from '@sheavly/protocol/message/message.types';

const signal = new AbortController().signal;

const echo = defineTool({
  name: 'echo',
  description: 'Echoes text back',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ input }) => JSON.stringify(input),
});

const call: ToolCall = { id: 'c1', name: 'echo', input: { description: 'echoing', text: 'hi' } };

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

    await runBeforeTurn({ hooks: [sneaky], turn: 1, messages, signal, onContext: () => undefined });

    expect(messages).toHaveLength(1);
  });
});

describe('runToolCall', () => {
  it('runs the tool directly when no hook wraps tool calls', async () => {
    const { message } = await runToolCall({ hooks: [], tools: [echo], call, signal });

    expect(message).toEqual({
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
    expect(message).toEqual({
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
    expect(kept).toEqual({
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

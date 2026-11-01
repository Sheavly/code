import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.service';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.service';
import { scriptedProvider } from '../../../testing/scripted-provider.fake.js';
import { runAgent, streamAgent } from '../stream-agent.service.js';
import type { AgentEvent } from '../../events/events.types.js';

const ping = defineTool({
  name: 'ping',
  description: 'Replies pong',
  inputSchema: z.object({}),
  execute: async () => 'pong',
});
const call = { id: '1', name: 'ping', input: { description: 'pinging' } };
/** Turn 1 calls ping, turn 2 answers. */
const twoTurns = () =>
  scriptedProvider([
    [
      { type: 'tool_call', call },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text_delta', text: 'pong it is' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ]);

/** A hook that logs every point it is called at, prefixed with its name. */
function tracer(name: string, log: string[]): Hook {
  return defineHook({
    name,
    sessionStart: async () => void log.push(`${name} sessionStart`),
    beforeTurn: async ({ turn }) => void log.push(`${name} beforeTurn ${turn}`),
    aroundToolCall: async ({ next }) => {
      log.push(`${name} aroundToolCall`);

      return next();
    },
    afterTurn: async ({ turn, stopReason }) =>
      void log.push(`${name} afterTurn ${turn} ${stopReason}`),
    onError: async () => void log.push(`${name} onError`),
  });
}

describe('hooks in the loop', () => {
  it('calls every hook point in run order, hooks in the order given', async () => {
    const log: string[] = [];

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [{ role: 'user', content: 'ping' }],
      hooks: [tracer('a', log), tracer('b', log)],
    });

    expect(log).toEqual([
      'a sessionStart',
      'b sessionStart',
      'a beforeTurn 1',
      'b beforeTurn 1',
      'a aroundToolCall',
      'b aroundToolCall',
      'a afterTurn 1 tool_use',
      'b afterTurn 1 tool_use',
      'a beforeTurn 2',
      'b beforeTurn 2',
      'a afterTurn 2 end_turn',
      'b afterTurn 2 end_turn',
    ]);
  });

  it('adds context: sessionStart once, beforeTurn every turn, all emitted as context_added', async () => {
    const events: AgentEvent[] = [];
    const messages = await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [{ role: 'user', content: 'ping' }],
      hooks: [
        defineHook({
          name: 'setup',
          sessionStart: async ({ addContext }) => addContext('<rules>be brief</rules>'),
          beforeTurn: async ({ turn, addContext }) => addContext(`<turn>${turn}</turn>`),
        }),
      ],
      onEvent: (event) => events.push(event),
    });

    expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'ping',
      '<rules>be brief</rules>',
      '<turn>1</turn>',
      '<turn>2</turn>',
    ]);
    expect(events.filter((e) => e.type === 'context_added')).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'context_added', hook: 'setup' });
  });

  it('gives afterTurn the reply, with the tool results already in history', async () => {
    const seen: { reply: string; last: string | undefined }[] = [];

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [{ role: 'user', content: 'ping' }],
      hooks: [
        defineHook({
          name: 'observe',
          afterTurn: async ({ reply, messages }) =>
            void seen.push({ reply: reply.content, last: messages.at(-1)?.content }),
        }),
      ],
    });

    expect(seen).toEqual([
      { reply: '', last: 'pong' },
      { reply: 'pong it is', last: 'pong it is' },
    ]);
  });

  it('wraps tool calls: a hook can change the result', async () => {
    const messages = await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [{ role: 'user', content: 'ping' }],
      hooks: [
        defineHook({
          name: 'audit',
          aroundToolCall: async ({ next }) => {
            const result = await next();

            return { ...result, content: `${result.content} (audited)` };
          },
        }),
      ],
    });

    expect(messages).toContainEqual({
      role: 'tool',
      toolCallId: '1',
      content: 'pong (audited)',
      isError: false,
    });
  });

  it('calls onError when the provider fails, and the error still reaches the caller', async () => {
    const log: string[] = [];
    const failing: Provider = {
      async *stream() {
        yield* [];
        throw new Error('provider down');
      },
    };

    await expect(
      runAgent({
        provider: failing,
        tools: [],
        messages: [{ role: 'user', content: 'hi' }],
        hooks: [tracer('a', log)],
      }),
    ).rejects.toThrow('provider down');
    expect(log).toEqual(['a sessionStart', 'a beforeTurn 1', 'a onError']);
  });

  it('calls onError when a hook fails the run', async () => {
    const errors: string[] = [];

    await expect(
      runAgent({
        provider: twoTurns(),
        tools: [ping],
        messages: [{ role: 'user', content: 'ping' }],
        hooks: [
          defineHook({
            name: 'strict',
            afterTurn: async () => {
              throw new Error('reply rejected');
            },
            onError: async ({ error }) => void errors.push((error as Error).message),
          }),
        ],
      }),
    ).rejects.toThrow('reply rejected');
    expect(errors).toEqual(['reply rejected']);
  });

  it('a nested run gets only the hooks its parent passes, with its own sessionStart', async () => {
    const log: string[] = [];
    const parentOnly = tracer('parent-only', log);
    const shared = tracer('shared', log);
    const subAgent = defineTool({
      name: 'sub_agent',
      description: 'Runs a nested agent',
      inputSchema: z.object({}),
      execute: async () => {
        const nested = await runAgent({
          provider: scriptedProvider([
            [
              { type: 'text_delta', text: 'sub done' },
              { type: 'done', stopReason: 'end_turn' },
            ],
          ]),
          tools: [],
          messages: [{ role: 'user', content: 'sub task' }],
          hooks: [shared], // the parent decides: `parent-only` is not passed on
        });

        return nested.at(-1)?.content ?? '';
      },
    });
    const subCall = { id: 's', name: 'sub_agent', input: { description: 'delegating' } };

    const events: AgentEvent[] = [];

    for await (const event of streamAgent({
      provider: scriptedProvider([
        [
          { type: 'tool_call', call: subCall },
          { type: 'done', stopReason: 'tool_use' },
        ],
        [{ type: 'done', stopReason: 'end_turn' }],
      ]),
      tools: [subAgent],
      messages: [{ role: 'user', content: 'delegate' }],
      hooks: [parentOnly, shared],
    })) {
      events.push(event);
    }

    // Inside the nested run (between the parent's tool-call wrappers), only `shared` runs.
    const start = log.indexOf('shared aroundToolCall') + 1;
    const nested = log.slice(start, log.indexOf('parent-only afterTurn 1 tool_use'));

    expect(nested).toEqual([
      'shared sessionStart',
      'shared beforeTurn 1',
      'shared afterTurn 1 end_turn',
    ]);
    expect(log.filter((entry) => entry.endsWith('sessionStart'))).toEqual([
      'parent-only sessionStart',
      'shared sessionStart',
      'shared sessionStart',
    ]);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      message: { content: 'sub done' },
    });
  });
});

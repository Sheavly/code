import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { ping, pingCall as call, twoTurns } from '../../testing/ping-turns.fake.js';
import { runAgent, streamAgent } from '../stream-agent.helper.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';

const prompt: Message = { role: 'user', content: 'ping' };

/** Wraps a provider and keeps a copy of the messages each model call was sent. */
function recording(inner: Provider, sent: Message[][]): Provider {
  return {
    contextWindow: 1_000,
    stream: (request) => {
      sent.push([...request.messages]);

      return inner.stream(request);
    },
  };
}

const hideToolOutput = (name = 'hide'): Hook =>
  defineHook({
    name,
    beforeModelCall: async ({ messages }) =>
      messages.map((message) =>
        message.role === 'tool' ? { ...message, content: '[hidden]' } : message,
      ),
  });

describe('beforeModelCall in the loop', () => {
  it('sends the hook’s messages to the model call, and keeps stored history as it was', async () => {
    const sent: Message[][] = [];
    const history = await runAgent({
      provider: recording(twoTurns(), sent),
      tools: [ping],
      messages: [prompt],
      hooks: [hideToolOutput()],
    });

    expect(sent[1]?.find((message) => message.role === 'tool')?.content).toBe('[hidden]');
    expect(history.find((message) => message.role === 'tool')?.content).toBe('pong');
  });

  it('emits model_input_changed for a hook that drops messages, before the model streams', async () => {
    const events: AgentEvent[] = [];
    const dropToolPair = defineHook({
      name: 'drop-pair',
      beforeModelCall: async ({ messages }) =>
        messages.filter((message) => message.role === 'user'),
    });

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [prompt],
      hooks: [hideToolOutput(), dropToolPair],
      onEvent: (event) => events.push(event),
    });

    const changed = events.filter((event) => event.type === 'model_input_changed');

    expect(changed).toEqual([
      expect.objectContaining({ hook: 'hide', turn: 2, added: 0, removed: 0, edited: 1 }),
      expect.objectContaining({ hook: 'drop-pair', turn: 2, added: 0, removed: 2, edited: 0 }),
    ]);
  });

  it('reports a hook that only rewrites tool output as edited, never added or removed', async () => {
    const events: AgentEvent[] = [];

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [prompt],
      hooks: [hideToolOutput()],
      onEvent: (event) => events.push(event),
    });

    expect(events.filter((event) => event.type === 'model_input_changed')).toEqual([
      expect.objectContaining({ hook: 'hide', turn: 2, added: 0, removed: 0, edited: 1 }),
    ]);
  });

  it('emits no model_input_changed when a hook returns what it was given', async () => {
    const events: AgentEvent[] = [];
    const same = defineHook({ name: 'same', beforeModelCall: async ({ messages }) => messages });

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [prompt],
      hooks: [same],
      onEvent: (event) => events.push(event),
    });

    expect(events.some((event) => event.type === 'model_input_changed')).toBe(false);
  });

  it('runs hooks in order, each seeing the previous result', async () => {
    const sent: Message[][] = [];
    const seen: string[] = [];
    const spy = defineHook({
      name: 'spy',
      beforeModelCall: async ({ messages }) => {
        seen.push(messages.map((message) => message.content).join('|'));

        return messages;
      },
    });

    await runAgent({
      provider: recording(twoTurns(), sent),
      tools: [ping],
      messages: [prompt],
      hooks: [hideToolOutput('first'), spy],
    });

    expect(seen).toEqual(['ping', 'ping||[hidden]']);
  });

  it('gives the hook the turn, the window and the last call’s usage', async () => {
    const seen: unknown[] = [];
    const tokens = { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const inner = scriptedProvider([
      [
        { type: 'tool_call', call },
        { type: 'done', stopReason: 'tool_use', usage: { tokens } },
      ],
      [{ type: 'done', stopReason: 'end_turn' }],
    ]);

    await runAgent({
      provider: { contextWindow: 1_000, stream: (request) => inner.stream(request) },
      tools: [ping],
      messages: [prompt],
      hooks: [
        defineHook({
          name: 'look',
          beforeModelCall: async ({ turn, context, messages }) => {
            seen.push({ turn, context });

            return messages;
          },
        }),
      ],
    });

    expect(seen).toEqual([
      { turn: 1, context: { window: 1_000 } },
      { turn: 2, context: { window: 1_000, used: 50 } },
    ]);
  });

  it('runs after beforeTurn, so it sees the context beforeTurn added', async () => {
    const seen: string[] = [];

    await runAgent({
      provider: scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]),
      tools: [],
      messages: [prompt],
      hooks: [
        defineHook({ name: 'ctx', beforeTurn: async ({ addContext }) => addContext('<rules/>') }),
        defineHook({
          name: 'look',
          beforeModelCall: async ({ messages }) => {
            seen.push(...messages.map((message) => message.content));

            return messages;
          },
        }),
      ],
    });

    expect(seen).toEqual(['ping', '<rules/>']);
  });

  /** Runs twoTurns with one hook; returns what each call was sent and the hook_failed events. */
  async function runWith(hook: Hook) {
    const sent: Message[][] = [];
    const events: AgentEvent[] = [];
    const history = await runAgent({
      provider: recording(twoTurns(), sent),
      tools: [ping],
      messages: [prompt],
      hooks: [hook],
      onEvent: (event) => events.push(event),
    });

    return {
      sent,
      history,
      failures: events.flatMap((event) => (event.type === 'hook_failed' ? [event] : [])),
    };
  }

  it('skips a hook that drops a tool result, names it in hook_failed, and finishes the run', async () => {
    const { sent, history, failures } = await runWith(
      defineHook({
        name: 'drop-results',
        beforeModelCall: async ({ messages }) =>
          messages.filter((message) => message.role !== 'tool'),
      }),
    );

    expect(failures).toEqual([
      expect.objectContaining({ hook: 'drop-results', handler: 'beforeModelCall' }),
    ]);
    expect(failures[0]?.error).toContain('Hook drop-results produced invalid history');
    // The model still got the tool result: the invalid edit was not applied.
    expect(sent[1]?.some((message) => message.role === 'tool')).toBe(true);
    expect(history.at(-1)?.role).toBe('assistant');
  });

  it('skips a hook that changes the latest user message', async () => {
    const { sent, failures } = await runWith(
      defineHook({
        name: 'reword',
        beforeModelCall: async () => [{ role: 'user', content: 'something else' }],
      }),
    );

    expect(failures[0]?.error).toContain('the latest user message was removed or changed');
    expect(sent[0]).toEqual([prompt]);
  });

  it('skips a hook that returns something that is not an array', async () => {
    const { failures } = await runWith({
      name: 'broken',
      beforeModelCall: async () => undefined,
    } as unknown as Hook);

    expect(failures[0]?.error).toContain(
      'Hook broken produced invalid history: the result is not a list of messages',
    );
  });

  it('ends the run as interrupted when a hook fails because the run was aborted', async () => {
    const controller = new AbortController();
    const sent: Message[][] = [];
    const abortsThenThrows = defineHook({
      name: 'slow',
      beforeModelCall: async () => {
        controller.abort();

        throw new DOMException('aborted', 'AbortError');
      },
    });
    const events: AgentEvent[] = [];

    for await (const event of streamAgent({
      provider: recording(twoTurns(), sent),
      tools: [ping],
      messages: [prompt],
      hooks: [abortsThenThrows],
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expect(sent).toHaveLength(0);
  });

  it('reports a hook error that is not an abort and carries on without it', async () => {
    const { history, failures } = await runWith(
      defineHook({
        name: 'broken',
        beforeModelCall: async () => {
          throw new Error('bug in the hook');
        },
      }),
    );

    expect(failures[0]?.error).toContain('bug in the hook');
    expect(history.at(-1)?.role).toBe('assistant');
  });

  it('keeps a message object edited in place by a hook out of stored history', async () => {
    const { history, failures } = await runWith(
      defineHook({
        name: 'sneaky',
        beforeModelCall: async ({ messages }) => {
          (messages.at(-1) as { content: string }).content = 'tampered';

          return messages;
        },
      }),
    );

    expect(failures[0]?.error).toContain('Hook sneaky produced invalid history');
    expect(prompt.content).toBe('ping');
    expect(history[0]).toMatchObject({ role: 'user', content: 'ping' });
  });

  it('gives the hook a copy, so changing it in place changes nothing stored', async () => {
    const sent: Message[][] = [];
    const sneaky = defineHook({
      name: 'sneaky',
      beforeModelCall: async ({ messages }) => {
        (messages as Message[]).length = 0;

        return [prompt];
      },
    });
    const history = await runAgent({
      provider: recording(scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]), sent),
      tools: [],
      messages: [prompt],
      hooks: [sneaky],
    });

    expect(history[0]).toEqual(prompt);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.service';
import { defineTool } from '@sheavly/core/tool/tool.service';
import type { Message, StreamEvent, ToolCall } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { AgentEvent } from '../../events/events.types.js';
import { STOPPED_BY_FAILURE } from '../stream-agent.constants.js';
import { streamAgent } from '../stream-agent.service.js';

const call = (id: string, name: string): ToolCall => ({
  id,
  name,
  input: { description: `call ${id}`, id },
});

/** A model call that streams `events`, then fails with `error`. */
function failingProvider(params: { events: StreamEvent[]; error: Error }): Provider {
  const { events, error } = params;

  return {
    async *stream() {
      yield* events;
      await new Promise((resolve) => setTimeout(resolve, 10)); // let the started tools run
      throw error;
    },
  };
}

/** `block` waits until aborted (logging it); `hang` ignores its signal; `quick` returns at once. */
function tools(log: string[]): Tool[] {
  const input = z.object({ id: z.string() });

  return [
    defineTool({
      name: 'block',
      description: 'Blocks until aborted',
      inputSchema: input,
      execute: ({ input: { id }, signal }) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            log.push(`aborted ${id}`);
            reject(new Error('aborted'));
          });
        }),
    }),
    defineTool({
      name: 'hang',
      description: 'Never finishes',
      inputSchema: input,
      execute: () => new Promise<string>(() => undefined),
    }),
    defineTool({
      name: 'quick',
      description: 'Returns at once',
      inputSchema: input,
      execute: async ({ input: { id } }) => `done ${id}`,
    }),
  ];
}

/** Runs to the failure: the events before it, the error, and the history `onError` saw. */
async function runToFailure(params: { provider: Provider; log: string[] }) {
  const { provider, log } = params;
  const events: AgentEvent[] = [];
  let history: readonly Message[] = [];
  const hook = defineHook({
    name: 'record',
    onError: async ({ messages }) => {
      history = messages;
    },
  });
  const run = streamAgent({ provider, tools: tools(log), messages: [], hooks: [hook] });
  const error = await (async () => {
    for await (const event of run) events.push(event);
  })().then(
    () => undefined,
    (caughtError: unknown) => caughtError,
  );

  return { events, error, history };
}

const results = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'tool_result' ? [event.message] : []));

describe('a model call that fails after starting tools', () => {
  const error = new Error('Responses stream ended before response.completed');

  it('stops the tools, records their results, then fails with the provider error', async () => {
    const log: string[] = [];
    const provider = failingProvider({
      events: [
        { type: 'tool_call', call: call('c1', 'block') },
        { type: 'tool_call', call: call('c2', 'quick') },
      ],
      error,
    });
    const { events, error: thrown, history } = await runToFailure({ provider, log });

    expect(thrown).toBe(error);
    expect(log).toEqual(['aborted c1']);
    expect(events.map((event) => event.type)).toEqual([
      'tool_call_started',
      'tool_call_started',
      'turn_end',
      'tool_batch',
      'tool_result',
      'tool_result',
    ]);
    expect(events).toContainEqual(expect.objectContaining({ stopReason: 'interrupted' }));
    expect(results(events)).toEqual([
      { role: 'tool', toolCallId: 'c1', content: STOPPED_BY_FAILURE, isError: true },
      expect.objectContaining({ toolCallId: 'c2', content: 'done c2', isError: false }),
    ]);
    expect(history.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool']);
  });

  it("doesn't wait for a tool that ignores its signal", async () => {
    const provider = failingProvider({
      events: [{ type: 'tool_call', call: call('c1', 'hang') }],
      error,
    });
    const { events, error: thrown } = await runToFailure({ provider, log: [] });

    expect(thrown).toBe(error);
    expect(results(events)).toEqual([
      { role: 'tool', toolCallId: 'c1', content: STOPPED_BY_FAILURE, isError: true },
    ]);
  });

  it('fails as before when the model call started no tools', async () => {
    const provider = failingProvider({ events: [{ type: 'text_delta', text: 'par' }], error });
    const { events, error: thrown, history } = await runToFailure({ provider, log: [] });

    expect(thrown).toBe(error);
    expect(events.map((event) => event.type)).toEqual(['text_delta']);
    expect(history).toEqual([]);
  });
});

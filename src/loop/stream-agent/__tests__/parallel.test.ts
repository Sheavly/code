import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '../../../testing/scripted-provider.fake.js';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { StreamEvent, ToolCall } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runAgent } from '../stream-agent.helper.js';
import type { AgentEvent } from '../../events/events.types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tool that waits `ms`, records when it finished, and echoes its id. */
function timedTool(finished: string[]) {
  return defineTool({
    name: 'wait',
    description: 'Wait, then reply',
    inputSchema: z.object({ id: z.string(), ms: z.number(), fail: z.boolean().optional() }),
    execute: async ({ input: { id, ms, fail } }) => {
      await sleep(ms);
      finished.push(id);
      if (fail) throw new Error(`${id} exploded`);

      return `done ${id}`;
    },
  });
}

const call = (id: string, input: Record<string, unknown>, name = 'wait'): ToolCall => ({
  id,
  name,
  input: { description: `task ${id}`, id, ...input },
});

/** One turn requesting `calls` in parallel, then a final answer. */
const parallelTurn = (calls: ToolCall[]): StreamEvent[][] => [
  [
    ...calls.map((c) => ({ type: 'tool_call' as const, call: c })),
    { type: 'done', stopReason: 'tool_use' },
  ],
  [{ type: 'done', stopReason: 'end_turn' }],
];

const toolResults = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === 'tool_result' ? [e.call.id] : []));

describe('parallel tool calls', () => {
  it("runs a turn's tool calls concurrently", async () => {
    let active = 0;
    let peak = 0;
    const tracked = defineTool({
      name: 'tracked',
      description: 'Tracks concurrency',
      inputSchema: z.object({}),
      execute: async () => {
        peak = Math.max(peak, ++active);
        await sleep(20);
        active--;

        return 'ok';
      },
    });

    const calls = ['a', 'b', 'c'].map((id) => ({
      id,
      name: 'tracked',
      input: { description: id },
    }));

    await runAgent({
      provider: scriptedProvider(parallelTurn(calls)),
      tools: [tracked],
      messages: [],
    });

    expect(peak).toBe(3); // all three were in flight at once
  });

  it('returns results to the model matched to their calls, in call order', async () => {
    const finished: string[] = [];
    const messages = await runAgent({
      provider: scriptedProvider(parallelTurn([call('slow', { ms: 40 }), call('fast', { ms: 1 })])),
      tools: [timedTool(finished)],
      messages: [],
    });

    expect(finished).toEqual(['fast', 'slow']); // fast really did finish first
    expect(messages.slice(1, 3)).toEqual([
      { role: 'tool', toolCallId: 'slow', content: 'done slow', isError: false },
      { role: 'tool', toolCallId: 'fast', content: 'done fast', isError: false },
    ]);
  });

  it("renders a faster tool's result after a slower earlier one (call order, not completion order)", async () => {
    const finished: string[] = [];
    const events: AgentEvent[] = [];

    await runAgent({
      provider: scriptedProvider(
        parallelTurn([call('slow', { ms: 40 }), call('mid', { ms: 20 }), call('fast', { ms: 1 })]),
      ),
      tools: [timedTool(finished)],
      messages: [],
      onEvent: (e) => events.push(e),
    });

    expect(finished).toEqual(['fast', 'mid', 'slow']);
    expect(toolResults(events)).toEqual(['slow', 'mid', 'fast']);
  });

  it("a failure in one parallel call doesn't break the others", async () => {
    const finished: string[] = [];
    const messages = await runAgent({
      provider: scriptedProvider(
        parallelTurn([
          call('ok1', { ms: 5 }),
          call('boom', { ms: 1, fail: true }),
          call('ghost', {}, 'no_such_tool'),
          call('ok2', { ms: 10 }),
        ]),
      ),
      tools: [timedTool(finished)],
      messages: [],
    });

    expect(messages.slice(1, 5)).toMatchObject([
      { toolCallId: 'ok1', isError: false, content: 'done ok1' },
      { toolCallId: 'boom', isError: true, content: 'Tool wait failed: boom exploded' },
      { toolCallId: 'ghost', isError: true, content: 'Unknown tool: no_such_tool' },
      { toolCallId: 'ok2', isError: false, content: 'done ok2' },
    ]);
  });

  it('holds a completion queued while the model is still streaming until its turn ends', async () => {
    let toolFinished!: () => void;
    const finishedSignal = new Promise<void>((resolve) => (toolFinished = resolve));

    const quick = defineTool({
      name: 'quick',
      description: 'Finishes immediately',
      inputSchema: z.object({}),
      execute: async () => {
        toolFinished();

        return 'quick result';
      },
    });

    let turn = 0;
    const provider: Provider = {
      async *stream() {
        if (turn++ > 0) {
          yield { type: 'done', stopReason: 'end_turn' };

          return;
        }

        yield {
          type: 'tool_call',
          call: { id: 'q', name: 'quick', input: { description: 'quick one' } },
        };
        await finishedSignal; // the tool has completed; the model is still mid-turn
        yield { type: 'text_delta', text: 'still thinking' };
        yield { type: 'done', stopReason: 'tool_use' };
      },
    };

    const events: AgentEvent[] = [];

    await runAgent({ provider, tools: [quick], messages: [], onEvent: (e) => events.push(e) });

    expect(events.slice(0, 5).map((e) => e.type)).toEqual([
      'tool_call_started',
      'text_delta', // model output that came after the call...
      'turn_end', // ...and the end of the model's turn...
      'tool_batch',
      'tool_result', // ...both render before the result, even though it finished first
    ]);
  });

  it("finishes rendering one turn before the next turn's output starts", async () => {
    const finished: string[] = [];
    const events: AgentEvent[] = [];

    await runAgent({
      provider: scriptedProvider([
        [
          { type: 'tool_call', call: call('a', { ms: 20 }) },
          { type: 'done', stopReason: 'tool_use' },
        ],
        [
          { type: 'text_delta', text: 'answer' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ]),
      tools: [timedTool(finished)],
      messages: [],
      onEvent: (e) => events.push(e),
    });

    const types = events.map((e) => e.type);

    expect(types.indexOf('tool_result')).toBeLessThan(types.indexOf('text_delta'));
  });
});

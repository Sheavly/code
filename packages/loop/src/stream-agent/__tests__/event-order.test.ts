import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { streamAgent } from '../stream-agent.helper.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The order the three calls finish in: the reverse of the order they are called in. */
const FINISH_ORDER = ['fast', 'mid', 'slow'];

/**
 * A tool that replies only once `release(id)` is called, so a run finishes its parallel calls in
 * the order the test chooses, not in the order wall-clock timers happen to fire on a loaded machine.
 */
function gatedWait() {
  const gates = new Map<string, PromiseWithResolvers<undefined>>();
  // Made by whichever side comes first, so a release before the tool starts waiting is kept.
  const gate = (id: string) => {
    const existing = gates.get(id);

    if (existing) return existing;
    const created = Promise.withResolvers<undefined>();

    gates.set(id, created);

    return created;
  };
  const tool = defineTool({
    name: 'wait',
    description: 'Wait for the test to release this call, then reply',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ input: { id } }) => {
      await gate(id).promise;

      return `done ${id}`;
    },
  });

  return { tool, release: (id: string) => gate(id).resolve(undefined) };
}

const waitCall = (id: string): StreamEvent => ({
  type: 'tool_call',
  call: { id: callIdSchema.parse(id), name: 'wait', input: { description: `task ${id}`, id } },
});

/** Turn 1: reasoning, text, three parallel calls (slowest first). Turn 2: final text. */
const script: StreamEvent[][] = [
  [
    { type: 'reasoning', item: { source: 'test', data: { secret: true } } },
    { type: 'text_delta', text: 'Checking. ' },
    waitCall('slow'),
    waitCall('mid'),
    waitCall('fast'),
    { type: 'done', stopReason: 'tool_use' },
  ],
  [
    { type: 'text_delta', text: 'All done.' },
    { type: 'done', stopReason: 'end_turn' },
  ],
];

/**
 * Runs `provider` with the gated tool. The first call is released when `tool_batch` shows all
 * three started, and each next one when the previous result has been delivered, so they finish
 * one at a time in `FINISH_ORDER`.
 */
async function collect(provider: Provider): Promise<AgentEvent[]> {
  const { tool, release } = gatedWait();
  const events: AgentEvent[] = [];

  for await (const event of streamAgent({
    provider,
    tools: [tool],
    messages: [{ role: 'user', content: 'go' }],
  })) {
    events.push(event);

    if (event.type === 'tool_batch') release(FINISH_ORDER[0] ?? '');

    if (event.type === 'tool_result') {
      release(FINISH_ORDER[FINISH_ORDER.indexOf(event.call.id) + 1] ?? '');
    }
  }

  return events;
}

describe('streamAgent', () => {
  it('yields events in sequence-number order, and the sequence is contiguous from 0', async () => {
    const events = await collect(scriptedProvider(script));

    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });

  it('lets a consumer iterate a full run, including parallel tool results as they finish', async () => {
    const events = await collect(scriptedProvider(script));

    expect(
      events.map((e) =>
        e.type === 'tool_call_started' || e.type === 'tool_result'
          ? `${e.type}:${e.call.id}`
          : e.type,
      ),
    ).toEqual([
      'reasoning',
      'text_delta',
      'tool_call_started:slow',
      'tool_call_started:mid',
      'tool_call_started:fast',
      'usage',
      'turn_end',
      'tool_batch',
      'tool_result:fast', // finished first, though called last
      'tool_result:mid',
      'tool_result:slow',
      'text_delta',
      'usage',
      'turn_end',
      'done',
    ]);
  });

  it('carries typed payloads on each event', async () => {
    const events = await collect(scriptedProvider(script));
    const byType = <T extends AgentEvent['type']>(type: T) =>
      events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);

    expect(byType('reasoning')[0]?.item).toEqual({ source: 'test', data: { secret: true } });
    expect(byType('tool_call_started')[0]).toMatchObject({
      description: 'task slow',
      call: { id: 'slow' },
    });
    expect(byType('tool_batch')[0]?.calls.map((c) => c.call.id)).toEqual(['slow', 'mid', 'fast']);
    expect(byType('tool_result').find((e) => e.call.id === 'fast')).toMatchObject({
      call: { id: 'fast' },
      message: { role: 'tool', toolCallId: 'fast', content: 'done fast', isError: false },
    });
    expect(byType('turn_end').map((e) => e.stopReason)).toEqual(['tool_use', 'end_turn']);
  });

  it('ends with a done event carrying the full conversation', async () => {
    const events = await collect(scriptedProvider(script));
    const done = events.at(-1);

    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(done.messages[1]).toMatchObject({ reasoning: [{ source: 'test' }] });
  });

  it('stopping iteration early aborts the model stream', async () => {
    let aborted = false;
    const provider: Provider = {
      async *stream({ signal }) {
        signal.addEventListener('abort', () => (aborted = true));
        yield { type: 'text_delta', text: 'one' };
        await sleep(1_000);
        yield { type: 'text_delta', text: 'never' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };

    for await (const event of streamAgent({ provider, tools: [], messages: [] })) {
      if (event.type === 'text_delta') break;
    }

    expect(aborted).toBe(true);
  });

  it('surfaces provider errors to the consumer after the events before them', async () => {
    const provider: Provider = {
      async *stream() {
        yield { type: 'text_delta', text: 'partial' };
        throw new Error('provider exploded');
      },
    };

    const seen: string[] = [];

    await expect(
      (async () => {
        for await (const event of streamAgent({ provider, tools: [], messages: [] })) {
          seen.push(event.type);
        }
      })(),
    ).rejects.toThrow('provider exploded');
    expect(seen).toEqual(['text_delta', 'usage', 'run_failed', 'done']);
  });
});

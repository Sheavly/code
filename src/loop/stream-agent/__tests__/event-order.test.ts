import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '../../../testing/scripted-provider.fake.js';
import { defineTool } from '@sheavly/core/tool/tool.service';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '../stream-agent.service.js';
import type { AgentEvent } from '../../events/events.types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const wait = defineTool({
  name: 'wait',
  description: 'Wait, then reply',
  inputSchema: z.object({ id: z.string(), ms: z.number() }),
  execute: async ({ input: { id, ms } }) => {
    await sleep(ms);

    return `done ${id}`;
  },
});

const waitCall = (id: string, ms: number): StreamEvent => ({
  type: 'tool_call',
  call: { id, name: 'wait', input: { description: `task ${id}`, id, ms } },
});

/** Turn 1: reasoning, text, three parallel calls (slowest first). Turn 2: final text. */
const script: StreamEvent[][] = [
  [
    { type: 'reasoning', item: { source: 'test', data: { secret: true } } },
    { type: 'text_delta', text: 'Checking. ' },
    waitCall('slow', 30),
    waitCall('mid', 15),
    waitCall('fast', 1),
    { type: 'done', stopReason: 'tool_use' },
  ],
  [
    { type: 'text_delta', text: 'All done.' },
    { type: 'done', stopReason: 'end_turn' },
  ],
];

async function collect(provider: Provider): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  for await (const event of streamAgent({
    provider,
    tools: [wait],
    messages: [{ role: 'user', content: 'go' }],
  })) {
    events.push(event);
  }

  return events;
}

describe('streamAgent', () => {
  it('yields events in sequence-number order, and the sequence is contiguous from 0', async () => {
    const events = await collect(scriptedProvider(script));

    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });

  it('lets a consumer iterate a full run, including parallel tool results in call order', async () => {
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
      'turn_end',
      'tool_batch',
      'tool_result:slow', // finished last, but called first
      'tool_result:mid',
      'tool_result:fast',
      'text_delta',
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
    expect(byType('tool_result')[2]).toMatchObject({
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
    expect(seen).toEqual(['text_delta']);
  });
});

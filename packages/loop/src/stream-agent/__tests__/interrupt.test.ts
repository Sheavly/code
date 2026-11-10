import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message, ToolCall } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runAgent, streamAgent } from '../stream-agent.helper.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every tool call in history must be answered by exactly one tool message, right after it. */
function expectValidHistory(messages: HistoryMessage[]) {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;

    if (message.role !== 'assistant') continue;
    const answers = messages.slice(i + 1, i + 1 + message.toolCalls.length);

    expect(answers.map((m) => (m.role === 'tool' ? m.toolCallId : m.role))).toEqual(
      message.toolCalls.map((c) => c.id),
    );
  }
}

/** A tool that waits until aborted, recording that it saw the abort. */
function blockingTool(log: string[]) {
  return defineTool({
    name: 'block',
    description: 'Blocks until aborted',
    inputSchema: z.object({ id: z.string() }),
    execute: ({ input, signal }) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => {
          log.push(`aborted ${input.id}`);
          reject(new Error('aborted'));
        });
      }),
  });
}

const call = (id: string, name = 'block', extra: Record<string, unknown> = {}): ToolCall => ({
  id: callIdSchema.parse(id),
  name,
  input: { description: `task ${id}`, id, ...extra },
});

/** Collects events, calling `onEvent` for each (e.g. to abort at a specific point). */
async function collect(stream: AsyncIterable<AgentEvent>, onEvent?: (e: AgentEvent) => void) {
  const events: AgentEvent[] = [];

  for await (const event of stream) {
    events.push(event);
    onEvent?.(event);
  }

  return events;
}

describe('interrupts', () => {
  it('aborting mid-stream stops the model call and keeps the partial text', async () => {
    const controller = new AbortController();
    let providerSawAbort = false;
    let yieldedAfterAbort = false;
    const provider: Provider = {
      async *stream({ signal }) {
        signal.addEventListener('abort', () => (providerSawAbort = true));
        yield { type: 'text_delta', text: 'Let me think' };
        await sleep(5_000); // a provider that ignores the signal while waiting
        yieldedAfterAbort = true;
        yield { type: 'text_delta', text: ' — never seen' };
      },
    };

    const events = await collect(
      streamAgent({ provider, tools: [], messages: [], signal: controller.signal }),
      (e) => {
        if (e.type === 'text_delta') controller.abort();
      },
    );

    expect(providerSawAbort).toBe(true);
    expect(yieldedAfterAbort).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'usage', 'turn_end', 'done']);
    expect(events.find((event) => event.type === 'turn_end')).toMatchObject({
      type: 'turn_end',
      stopReason: 'interrupted',
    });

    const done = events.at(-1);

    expect(done).toMatchObject({ type: 'done', reason: 'interrupted' });

    if (done?.type === 'done') {
      expect(done.messages).toMatchObject([
        { role: 'assistant', content: 'Let me think', toolCalls: [] },
      ]);
    }
  });

  it('all parallel tools are aborted together, and every call gets a result', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const provider = scriptedProvider([
      [
        { type: 'tool_call', call: call('a') },
        { type: 'tool_call', call: call('b') },
        { type: 'tool_call', call: call('c') },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);

    const events = await collect(
      streamAgent({
        provider,
        tools: [blockingTool(log)],
        messages: [],
        signal: controller.signal,
      }),
      (e) => {
        if (e.type === 'tool_batch') setTimeout(() => controller.abort(), 20);
      },
    );

    expect(log.sort()).toEqual(['aborted a', 'aborted b', 'aborted c']);
    const results = events.filter((e) => e.type === 'tool_result');

    expect(results.map((e) => (e.type === 'tool_result' ? e.call.id : ''))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      results.every(
        (e) => e.type === 'tool_result' && e.message.role === 'tool' && e.message.isError,
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
  });

  it('interrupts promptly even if a tool ignores the signal', async () => {
    const stubborn = defineTool({
      name: 'stubborn',
      description: 'Ignores abort',
      inputSchema: z.object({}),
      execute: () => sleep(5_000).then(() => 'late'),
    });
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 50);

    const started = performance.now();
    const messages = await runAgent({
      provider: scriptedProvider([
        [
          {
            type: 'tool_call',
            call: {
              id: callIdSchema.parse('s'),
              name: 'stubborn',
              input: { description: 'stubborn' },
            },
          },
          { type: 'done', stopReason: 'tool_use' },
        ],
      ]),
      tools: [stubborn],
      messages: [],
      signal: controller.signal,
    });

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 's', isError: true });
  });

  it('history after an interrupt is valid and the next run continues from it', async () => {
    const log: string[] = [];
    const controller = new AbortController();
    const firstRun = scriptedProvider([
      [
        { type: 'text_delta', text: 'Starting.' },
        { type: 'tool_call', call: call('a') },
        { type: 'tool_call', call: call('b') },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);

    setTimeout(() => controller.abort(), 50);
    const interrupted = await runAgent({
      provider: firstRun,
      tools: [blockingTool(log)],
      messages: [{ role: 'user', content: 'do a and b' }],
      signal: controller.signal,
    });

    expectValidHistory(interrupted);

    // Continue: the next provider call must receive the interrupted history intact.
    const seen: Message[][] = [];
    const secondRun: Provider = {
      async *stream({ messages }) {
        seen.push(messages);
        yield { type: 'text_delta', text: 'Resuming.' } satisfies StreamEvent;
        yield { type: 'done', stopReason: 'end_turn' } satisfies StreamEvent;
      },
    };
    const continued = await runAgent({
      provider: secondRun,
      tools: [blockingTool(log)],
      messages: [...interrupted, { role: 'user', content: 'never mind, just summarize' }],
    });

    expect(seen[0]?.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    expect(continued.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Resuming.',
      toolCalls: [],
    });
    expectValidHistory(continued);
  });

  it('an already-aborted signal does nothing and returns the input history', async () => {
    let called = false;
    const provider: Provider = {
      async *stream() {
        called = true;
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const history: Message[] = [{ role: 'user', content: 'hi' }];
    const events = await collect(
      streamAgent({ provider, tools: [], messages: history, signal: AbortSignal.abort() }),
    );

    expect(called).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      seq: 0,
      type: 'done',
      reason: 'interrupted',
      messages: history,
      session: { depth: 1 },
    });
  });

  it('reports why a run ended', async () => {
    const one = (stop: 'end_turn' | 'tool_use'): StreamEvent[] => [
      ...(stop === 'tool_use' ? [{ type: 'tool_call' as const, call: call('x', 'missing') }] : []),
      { type: 'done', stopReason: stop },
    ];
    const completed = await collect(
      streamAgent({ provider: scriptedProvider([one('end_turn')]), tools: [], messages: [] }),
    );
    const capped = await collect(
      streamAgent({
        provider: scriptedProvider([one('tool_use'), one('tool_use')]),
        tools: [],
        messages: [],
        maxTurns: 1,
      }),
    );

    expect(completed.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    expect(capped.at(-1)).toMatchObject({ type: 'done', reason: 'max_turns' });
  });
});

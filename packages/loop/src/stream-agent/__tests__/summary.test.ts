import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Summarizer } from '@sheavly/core/summary/summary.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/message/message.types';
import { callIdSchema, summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { runSession } from '../stream-agent.helper.js';

const WINDOW = 100_000;
const probe = defineTool({
  name: 'probe',
  description: 'Looks something up',
  inputSchema: z.object({}),
  execute: async () => 'found it',
});
const call = { id: callIdSchema.parse('c1'), name: 'probe', input: { description: 'probing' } };

/** A model turn that calls the probe and reports `inputTokens` of context. */
function toolTurn(inputTokens: number): StreamEvent[] {
  const tokens = { inputTokens, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

  return [
    { type: 'tool_call', call },
    { type: 'done', stopReason: 'tool_use', usage: { tokens } },
  ];
}

const answer: StreamEvent[] = [
  { type: 'text_delta', text: 'done' },
  { type: 'done', stopReason: 'end_turn' },
];
const overflow: StreamEvent[] = [{ type: 'done', stopReason: 'context_window_exceeded' }];

/** 400 characters: about 100 tokens by the estimate. */
const long = (role: 'user' | 'assistant', n: number): HistoryMessage =>
  role === 'user'
    ? { role, content: `${n}`.padEnd(400, 'x'), at: n }
    : { role, content: `${n}`.padEnd(400, 'x'), toolCalls: [], at: n };
const history = (): HistoryMessage[] => [
  long('user', 1),
  long('assistant', 2),
  long('user', 3),
  long('assistant', 4),
  long('user', 5),
];

/** Plays its turns in order and keeps every request. */
function recording(turns: StreamEvent[][]) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    contextWindow: WINDOW,
    async *stream(request) {
      requests.push(request);
      yield* turns[requests.length - 1] ?? [];
    },
  };

  return { provider, requests };
}

const section = (body: string) => [
  { id: summarySectionIdSchema.parse('goal'), title: 'Goal', body },
];
const writer = (body = 'short summary'): Summarizer => ({
  name: 'test',
  summarize: async () => ({ sections: section(body) }),
});
const options = (summarizer: Summarizer) => ({
  summarizer,
  policy: { keepTokens: 150, minFreeTokens: 100, freeShare: 0.1, maxSummaryTokens: 60 },
});
const types = (events: AgentEvent[]) => events.map((event) => event.type);

describe('summarizing in the loop', () => {
  it('summarizes before the turn once the context nears the window, and the model sees it', async () => {
    const { provider, requests } = recording([toolTurn(95_000), answer]);
    const events: AgentEvent[] = [];
    const { messages } = await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(writer()),
      onEvent: (event) => events.push(event),
    });
    const wire = types(events).filter((type) => type.startsWith('summary_'));

    expect(wire).toEqual(['summary_started', 'summary_done']);
    expect(messages.filter((m) => m.role === 'summary')).toHaveLength(1);

    const second = requests[1]?.messages[0];

    expect(second?.role === 'user' && second.content).toContain('<earlier-work-summary>');
    // The checkpoint's own numbers are gone: the next call reports its own usage.
    expect(requests[1]?.notices?.[0]).toMatchObject({
      context: { window: WINDOW, used: undefined },
    });
    // Before the model call, after the first turn's results: the order a UI renders.
    const order = types(events);

    expect(order.indexOf('summary_done')).toBeGreaterThan(order.indexOf('turn_end'));
  });

  it('summarizes the work after a single prompt, and the model still sees the prompt word for word', async () => {
    // One user prompt, then a long tool loop: the common coding run. Everything after the prompt
    // can be summarized; the prompt itself is pinned in the view.
    const prompt = long('user', 1);
    const rounds = Array.from({ length: 6 }, (_, n): HistoryMessage[] => {
      const id = callIdSchema.parse(`r${String(n)}`);

      return [
        { role: 'assistant', content: 'x'.repeat(400), toolCalls: [{ ...call, id }], at: 2 },
        { role: 'tool', toolCallId: id, content: 'y'.repeat(400), isError: false, at: 3 },
      ];
    }).flat();
    const { provider, requests } = recording([toolTurn(95_000), answer]);
    const events: AgentEvent[] = [];
    const { messages } = await runSession({
      provider,
      tools: [probe],
      messages: [prompt, ...rounds],
      summary: options(writer()),
      onEvent: (event) => events.push(event),
    });

    expect(types(events)).toContain('summary_done');

    const seen = requests[1]?.messages ?? [];

    expect(seen[0]?.role === 'user' && seen[0].content).toContain('<earlier-work-summary>');
    expect(seen[1]).toEqual(prompt);
    expect(messages.filter((m) => m.role === 'summary')).toHaveLength(1);
  });

  it('does nothing without the option, or below the threshold', async () => {
    const without = recording([toolTurn(95_000), answer]);
    const below = recording([toolTurn(1_000), answer]);

    const a = await runSession({ provider: without.provider, tools: [probe], messages: history() });
    const b = await runSession({
      provider: below.provider,
      tools: [probe],
      messages: history(),
      summary: options(writer()),
    });

    expect(a.messages.some((m) => m.role === 'summary')).toBe(false);
    expect(b.messages.some((m) => m.role === 'summary')).toBe(false);
  });

  it('reports a failure, keeps the run going on the unchanged view, and stops after three', async () => {
    const failing: Summarizer = {
      name: 'broken',
      summarize: async () => {
        throw new Error('model down sk-abcdefghijklmnopqrstuvwxyz');
      },
    };
    const { provider } = recording([
      toolTurn(95_000),
      toolTurn(95_000),
      toolTurn(95_000),
      toolTurn(95_000),
      answer,
    ]);
    const events: AgentEvent[] = [];
    const { reason, messages } = await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(failing),
      onEvent: (event) => events.push(event),
    });
    const failed = events.filter((event) => event.type === 'summary_failed');

    expect(reason).toBe('completed');
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
    expect(failed).toHaveLength(3);
    expect(types(events).filter((type) => type === 'summary_started')).toHaveLength(3);
    // The secret never reaches the event.
    expect(JSON.stringify(failed)).not.toContain('abcdefghijklmnop');
  });

  it('rejects a summary that is not smaller, appending no checkpoint', async () => {
    const { provider } = recording([toolTurn(95_000), answer]);
    const events: AgentEvent[] = [];
    const { messages } = await runSession({
      provider,
      tools: [probe],
      messages: history(),
      // About 350 tokens against the 300 it would replace; the size cap is lifted so that the
      // "not smaller" rule is the one that rejects it.
      summary: {
        ...options(writer('y'.repeat(1_400))),
        policy: { ...options(writer()).policy, maxSummaryTokens: 1_000 },
      },
      onEvent: (event) => events.push(event),
    });

    expect(types(events)).toContain('summary_failed');
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
  });

  it('summarizes once and retries when a call overflows the window, then ends if it does again', async () => {
    const { provider, requests } = recording([overflow, answer]);
    const events: AgentEvent[] = [];
    const { reason, messages } = await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(writer()),
      onEvent: (event) => events.push(event),
    });

    expect(reason).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(messages.some((m) => m.role === 'summary')).toBe(true);
    expect(events.find((e) => e.type === 'summary_started')).toMatchObject({ reason: 'overflow' });

    const twice = recording([overflow, overflow, answer]);
    const ended = await runSession({
      provider: twice.provider,
      tools: [probe],
      messages: history(),
      summary: options(writer()),
    });

    expect(ended.reason).toBe('context_window_exceeded');
    expect(twice.requests).toHaveLength(2);
  });

  it('ends interrupted and closes the summary when aborted while a summarizer ignores its signal', async () => {
    const stuck: Summarizer = { name: 'stuck', summarize: () => new Promise(() => undefined) };
    const { provider, requests } = recording([toolTurn(95_000), answer]);
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const { reason, messages } = await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(stuck),
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'summary_started') controller.abort();
      },
    });

    expect(reason).toBe('interrupted');
    expect(types(events).filter((type) => type.startsWith('summary_'))).toEqual([
      'summary_started',
      'summary_failed',
    ]);
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
    // Aborted before a second model call was made.
    expect(requests).toHaveLength(1);
  });

  it('refuses a stored checkpoint whose kept count starts the view on a tool result', async () => {
    // The checkpoint keeps only the result, so its call was summarized away and a model would be
    // sent a result with no call before it.
    const damaged: HistoryMessage[] = [
      long('user', 1),
      { role: 'assistant', content: 'calling', toolCalls: [call], at: 2 },
      { role: 'tool', toolCallId: call.id, content: 'found it', isError: false, at: 3 },
      {
        role: 'summary',
        sections: section('old work'),
        kept: 1,
        summarized: 1,
        summarizer: 'test',
        at: 9,
      },
    ];
    const { provider, requests } = recording([answer]);

    await expect(runSession({ provider, tools: [probe], messages: damaged })).rejects.toThrow(
      'Stored history produced invalid history',
    );
    expect(requests).toHaveLength(0);
  });

  it('refuses a stored checkpoint that keeps more messages than come before it', async () => {
    const damaged: HistoryMessage[] = [
      long('user', 1),
      {
        role: 'summary',
        sections: section('old work'),
        kept: 5,
        summarized: 1,
        summarizer: 'test',
        at: 9,
      },
      long('user', 2),
    ];
    const { provider, requests } = recording([answer]);

    await expect(runSession({ provider, tools: [probe], messages: damaged })).rejects.toThrow(
      'keeps 5 messages but only 1 come before it',
    );
    expect(requests).toHaveLength(0);
  });

  it('reports the summarizer’s usage tagged as a summary, even for a rejected result', async () => {
    const tokens = {
      inputTokens: 9_000,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const paid = (body: string): Summarizer => ({
      name: 'paid',
      summarize: async () => ({ sections: section(body), usage: { tokens } }),
    });

    for (const body of ['short summary', 'y'.repeat(1_400)]) {
      const { provider } = recording([toolTurn(95_000), answer]);
      const events: AgentEvent[] = [];

      await runSession({
        provider,
        tools: [probe],
        messages: history(),
        summary: options(paid(body)),
        onEvent: (event) => events.push(event),
      });

      const tagged = events.filter((e) => e.type === 'usage' && e.usage.purpose === 'summary');

      // The long body is over the size cap and rejected, but was still paid for.
      expect(tagged).toHaveLength(1);
      expect(tagged[0]).toMatchObject({ usage: { tokens, purpose: 'summary' } });
    }
  });

  it('keeps the summary call out of the session’s last tokens, which describe the conversation', async () => {
    const tokens = {
      inputTokens: 9_000,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const paid: Summarizer = {
      name: 'paid',
      summarize: async () => ({ sections: section('short summary'), usage: { tokens } }),
    };
    const registry = new SessionRegistry();
    const main = registry.startMain({ title: 'Chat' });
    const finalTurn: StreamEvent[] = [
      { type: 'text_delta', text: 'done' },
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: {
          tokens: { inputTokens: 1_000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      },
    ];
    const { provider } = recording([toolTurn(95_000), finalTurn]);

    await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(paid),
      session: { registry, ref: main },
    });

    // The last model call's own numbers (1,000 in, 10 out), not the summarizer's 9,000.
    expect(registry.lastTokens(main.id)).toMatchObject({ inputTokens: 1_000 });
  });

  it('says a summarizer returned nothing, rather than blaming an abort', async () => {
    const empty: Summarizer = {
      name: 'empty',
      // A UI's summarizer may be plain JavaScript, so its result is not trusted to be typed.
      summarize: async () => undefined as never,
    };
    const { provider } = recording([toolTurn(95_000), answer]);
    const events: AgentEvent[] = [];

    await runSession({
      provider,
      tools: [probe],
      messages: history(),
      summary: options(empty),
      onEvent: (event) => events.push(event),
    });

    const failed = events.find((event) => event.type === 'summary_failed');

    expect(failed?.type === 'summary_failed' && failed.error).toContain('returned no result');
  });

  it('ends context_window_exceeded as before when no summarizer is given', async () => {
    const { provider } = recording([overflow]);
    const { reason } = await runSession({ provider, tools: [probe], messages: history() });

    expect(reason).toBe('context_window_exceeded');
  });
});

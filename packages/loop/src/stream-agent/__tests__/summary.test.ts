import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Summarizer } from '@sheavly/core/summary/summary.types';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { callIdSchema, summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { WINDOW, answer, overflow } from '../../testing/summary-run.constants.js';
import {
  history,
  long,
  probe,
  probeCall as call,
  recording,
  toolTurn,
} from '../../testing/summary-run.fake.js';
import { runSession } from '../stream-agent.helper.js';

const section = (body: string) => [
  { id: summarySectionIdSchema.parse('goal'), title: 'Goal', body },
];
const writer = (body = 'short summary'): Summarizer => ({
  name: 'test',
  summarize: async () => ({ sections: section(body) }),
});
const options = (summarizer: Summarizer) => ({
  summarizer,
  policy: { keepTokens: 150, minFreeTokens: 100, freeShare: 0.1 },
});
const types = (events: AgentEvent[]) => events.map((event) => event.type);

async function runNearWindow(
  summarizer: Summarizer,
  extra: { signal?: AbortSignal; onEvent?: (event: AgentEvent) => void } = {},
) {
  const { provider, requests } = recording([toolTurn(95_000), answer]);
  const events: AgentEvent[] = [];
  const { messages, reason } = await runSession({
    provider,
    tools: [probe],
    messages: history(),
    summary: options(summarizer),
    ...(extra.signal && { signal: extra.signal }),
    onEvent: (event) => {
      events.push(event);
      extra.onEvent?.(event);
    },
  });

  return { events, messages, requests, reason };
}

/** Aborts the run the moment its summary starts, as a user stopping it mid-summary would. */
function abortWhenSummaryStarts() {
  const controller = new AbortController();

  return {
    signal: controller.signal,
    onEvent: (event: AgentEvent) => {
      if (event.type === 'summary_started') controller.abort();
    },
  };
}

describe('summarizing in the loop', () => {
  it('summarizes before the turn once the context nears the window, and the model sees it', async () => {
    const { events, messages, requests } = await runNearWindow(writer());
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

  it('retries a failed summary once, inside the same started/done pair', async () => {
    let calls = 0;
    const flaky: Summarizer = {
      name: 'flaky',
      summarize: async () => {
        calls += 1;
        if (calls === 1) throw new Error('model hiccup');

        return { sections: section('short summary') };
      },
    };
    const { events, messages } = await runNearWindow(flaky);

    expect(calls).toBe(2);
    expect(types(events).filter((type) => type.startsWith('summary_'))).toEqual([
      'summary_started',
      'summary_done',
    ]);
    expect(messages.filter((m) => m.role === 'summary')).toHaveLength(1);
  });

  it('tries a summary twice at most, then reports one failure of kind generation', async () => {
    let calls = 0;
    const failing: Summarizer = {
      name: 'broken',
      summarize: async () => {
        calls += 1;
        throw new Error('model down');
      },
    };
    const { events } = await runNearWindow(failing);
    const failed = events.filter((event) => event.type === 'summary_failed');

    // One initial attempt and one retry for the first snapshot; later turns are counted separately.
    expect(calls % 2).toBe(0);
    expect(failed[0]).toMatchObject({ kind: 'generation' });
  });

  it('reports a result that is not smaller as kind size', async () => {
    const { events } = await runNearWindow(writer('y'.repeat(1_400)));
    const failed = events.find((event) => event.type === 'summary_failed');

    expect(failed).toMatchObject({ kind: 'size' });
  });

  it('reports an aborted summary as kind cancellation, without retrying', async () => {
    let calls = 0;
    const stuck: Summarizer = {
      name: 'stuck',
      summarize: () => {
        calls += 1;

        return new Promise(() => undefined);
      },
    };
    const { events } = await runNearWindow(stuck, abortWhenSummaryStarts());

    expect(calls).toBeLessThanOrEqual(1);
    expect(events.find((event) => event.type === 'summary_failed')).toMatchObject({
      kind: 'cancellation',
    });
  });

  it('ends interrupted, not context_window_exceeded, when aborted during a summary that fails on a full window', async () => {
    const failing: Summarizer = {
      name: 'broken',
      summarize: async () => {
        throw new Error('model down');
      },
    };
    const controller = new AbortController();
    const { provider } = recording([toolTurn(95_000), answer]);
    const { reason } = await runSession({
      provider,
      tools: [probe],
      // An old user message to summarize, then a reply estimated at more than the whole window, so
      // the no-room stop would fire without the abort.
      messages: [
        { role: 'user', content: 'start', at: 1 },
        { role: 'assistant', content: 'x'.repeat(4 * WINDOW + 400), toolCalls: [], at: 2 },
        { role: 'user', content: 'now', at: 3 },
      ],
      summary: options(failing),
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'summary_started') controller.abort();
      },
    });

    expect(reason).toBe('interrupted');
  });

  it('ends context_window_exceeded, history untouched, when no summary helps and the view fills the window', async () => {
    const failing: Summarizer = {
      name: 'broken',
      summarize: async () => {
        throw new Error('model down');
      },
    };
    // The prompt alone is estimated at more than the whole window (4 characters a token). The
    // first turn reports usage, so the second finds the threshold crossed, the summary failing,
    // and nothing that could shrink the view: it stops instead of calling the model again.
    const { provider, requests } = recording([toolTurn(95_000), answer]);
    const { reason, messages } = await runSession({
      provider,
      tools: [probe],
      messages: [{ role: 'user', content: 'x'.repeat(4 * WINDOW + 400), at: 1 }],
      summary: options(failing),
    });

    expect(reason).toBe('context_window_exceeded');
    expect(requests).toHaveLength(1);
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
  });

  it('carries on unchanged when a summary fails but the next request still fits', async () => {
    const failing: Summarizer = {
      name: 'broken',
      summarize: async () => {
        throw new Error('model down');
      },
    };
    const { events, reason } = await runNearWindow(failing);

    expect(reason).toBe('completed');
    expect(types(events)).toContain('summary_failed');
  });

  it('rejects a summary that is not smaller, appending no checkpoint', async () => {
    // About 350 tokens against the 300 it would replace.
    const { events, messages } = await runNearWindow(writer('y'.repeat(1_400)));

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
    const { events, messages, requests, reason } = await runNearWindow(
      stuck,
      abortWhenSummaryStarts(),
    );

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

    // A rejected result is tried once more, and each attempt is paid for, so each is reported.
    for (const [body, attempts] of [
      ['short summary', 1],
      ['y'.repeat(1_400), 2],
    ] as const) {
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
      expect(tagged).toHaveLength(attempts);
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
    const { events } = await runNearWindow(empty);
    const failed = events.find((event) => event.type === 'summary_failed');

    expect(failed?.type === 'summary_failed' && failed.error).toContain('returned no result');
  });

  it('ends context_window_exceeded as before when no summarizer is given', async () => {
    const { provider } = recording([overflow]);
    const { reason } = await runSession({ provider, tools: [probe], messages: history() });

    expect(reason).toBe('context_window_exceeded');
  });
});

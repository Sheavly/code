import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Summarizer } from '@sheavly/core/summary/summary.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { WINDOW, answer, overflow } from '../../testing/summary-run.constants.js';
import { history, probe, recording, toolTurn } from '../../testing/summary-run.fake.js';
import { runSession } from '../stream-agent.helper.js';

const section = (id: string, body: string) => ({
  id: summarySectionIdSchema.parse(id),
  title: id,
  body,
});

/** Records the span it was given and writes one short section. */
function spying() {
  const spans: number[] = [];
  const summarizer: Summarizer = {
    name: 'test',
    summarize: async ({ messages }) => {
      spans.push(messages.length);

      return { sections: [section('goal', 'short summary')] };
    },
  };

  return { spans, summarizer };
}

const policy = { keepTokens: 150, minFreeTokens: 100, freeShare: 0.1 };

async function run(params: {
  summarizer: Summarizer;
  hooks: Hook[];
  turns?: StreamEvent[][];
  /** Called for every event, with a way to abort the run. */
  onEvent?: (event: AgentEvent, abort: () => void) => void;
}) {
  const { provider, requests } = recording(params.turns ?? [toolTurn(95_000), answer]);
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const result = await runSession({
    provider,
    tools: [probe],
    messages: history(),
    summary: { summarizer: params.summarizer, policy },
    hooks: params.hooks,
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
      params.onEvent?.(event, () => controller.abort());
    },
  });

  return { ...result, requests, events };
}

describe('beforeSummary and afterSummary in the loop', () => {
  it('lets beforeSummary supply a section that lands in the checkpoint the model sees', async () => {
    const { summarizer } = spying();
    const { messages, requests } = await run({
      summarizer,
      hooks: [
        {
          name: 'rules',
          beforeSummary: async () => ({ sections: [section('rules', 'never touch prod')] }),
        },
      ],
    });
    const checkpoint = messages.find((m) => m.role === 'summary');
    const seen = requests[1]?.messages[0];

    expect(checkpoint?.role === 'summary' && checkpoint.sections.map((s) => s.id)).toEqual([
      'goal',
      'rules',
    ]);
    expect(seen?.role === 'user' && seen.content).toContain('never touch prod');
  });

  it('lets beforeSummary choose what is kept: a larger tail summarizes less', async () => {
    const baseline = spying();
    const wider = spying();

    await run({ summarizer: baseline.summarizer, hooks: [] });
    await run({
      summarizer: wider.summarizer,
      hooks: [{ name: 'keep', beforeSummary: async () => ({ keepTokens: 250 }) }],
    });

    expect(baseline.spans[0]).toBeGreaterThan(wider.spans[0] ?? Infinity);
  });

  it('tells beforeSummary why and how full the context is', async () => {
    const { summarizer } = spying();
    const seen: unknown[] = [];

    await run({
      summarizer,
      hooks: [
        {
          name: 'watch',
          beforeSummary: async ({ reason, context }) => {
            seen.push(reason, context);

            return undefined;
          },
        },
      ],
    });

    expect(seen).toEqual(['threshold', { window: WINDOW, used: 95_010 }]);
  });

  it('lets afterSummary add context back, kept in history after the checkpoint', async () => {
    const { summarizer } = spying();
    const { messages, events, requests } = await run({
      summarizer,
      hooks: [
        {
          name: 'restore',
          afterSummary: async ({ addContext, checkpoint }) =>
            addContext(`restored after ${checkpoint.summarizer}`),
        },
      ],
    });
    const at = messages.findIndex((m) => m.role === 'summary');
    const after = messages[at + 1];
    const types = events.map((event) => event.type);

    expect(after).toMatchObject({ role: 'user', content: 'restored after test' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'context_added', hook: 'restore' }),
    );
    // Reported after the summary closed, before the model call that sees it.
    expect(types.indexOf('context_added')).toBeGreaterThan(types.indexOf('summary_done'));
    expect(JSON.stringify(requests[1]?.messages)).toContain('restored after test');
  });

  it('skips a bad beforeSummary result, reports it as hook_failed, and still summarizes', async () => {
    const { summarizer, spans } = spying();
    const { reason, messages, events } = await run({
      summarizer,
      // Typed correctly but not valid: the schema, not the compiler, is what a plain-JS hook meets.
      hooks: [{ name: 'typo', beforeSummary: async () => ({ keepTokens: -5 }) }],
    });
    const failed = events.find((event) => event.type === 'hook_failed');

    expect(reason).toBe('completed');
    expect(spans).toHaveLength(1);
    expect(messages.some((m) => m.role === 'summary')).toBe(true);
    expect(failed?.type === 'hook_failed' && [failed.hook, failed.handler]).toEqual([
      'typo',
      'beforeSummary',
    ]);
    expect(failed?.type === 'hook_failed' && failed.error).toContain('Hook typo');
  });

  it('reports a beforeSummary that throws as hook_failed, never failing the run or the summary', async () => {
    const { summarizer } = spying();
    const { reason, events } = await run({
      summarizer,
      hooks: [
        {
          name: 'broken',
          beforeSummary: async () => {
            throw new Error('nope');
          },
        },
      ],
    });

    const failed = events.find((event) => event.type === 'hook_failed');

    expect(reason).toBe('completed');
    expect(events.map((e) => e.type)).toContain('summary_done');
    // The hook is named, as `onError` and tool hooks are, so a project can find the culprit.
    expect(failed?.type === 'hook_failed' && failed.error).toContain(
      'Hook broken failed in beforeSummary: nope',
    );
  });

  it('ends interrupted with one summary_failed when aborted while a beforeSummary ignores its signal', async () => {
    const { summarizer, spans } = spying();
    const { reason, events, messages, requests } = await run({
      summarizer,
      hooks: [{ name: 'stuck', beforeSummary: () => new Promise<undefined>(() => undefined) }],
      onEvent: (event, abort) => {
        if (event.type === 'summary_started') abort();
      },
    });
    const wire = events.map((e) => e.type).filter((type) => type.startsWith('summary_'));

    expect(reason).toBe('interrupted');
    expect(wire).toEqual(['summary_started', 'summary_failed']);
    expect(spans).toHaveLength(0);
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('ends interrupted, adding nothing, when aborted while an afterSummary ignores its signal', async () => {
    const { summarizer } = spying();
    let addLate: (content: string) => void = () => undefined;
    const { reason, events, messages } = await run({
      summarizer,
      hooks: [
        {
          name: 'stuck',
          afterSummary: ({ addContext }) => {
            addLate = addContext;

            return new Promise<void>(() => undefined);
          },
        },
      ],
      onEvent: (event, abort) => {
        if (event.type === 'summary_done') abort();
      },
    });

    // A call that arrives after the run was told to stop changes nothing.
    addLate('too late');

    expect(reason).toBe('interrupted');
    expect(events.map((e) => e.type)).not.toContain('context_added');
    expect(JSON.stringify(messages)).not.toContain('too late');
    expect(messages.some((m) => m.role === 'summary')).toBe(true);
  });

  it('rejects a supplied section that makes the checkpoint not smaller, appending none', async () => {
    const { summarizer } = spying();
    const { messages, events } = await run({
      summarizer,
      hooks: [
        {
          name: 'greedy',
          beforeSummary: async () => ({ sections: [section('big', 'y'.repeat(2_000))] }),
        },
      ],
    });

    expect(events.map((e) => e.type)).toContain('summary_failed');
    expect(messages.some((m) => m.role === 'summary')).toBe(false);
  });

  it('reports an afterSummary that throws as hook_failed, after the summary was reported done', async () => {
    const { summarizer } = spying();
    const { reason, events } = await run({
      summarizer,
      hooks: [
        {
          name: 'broken',
          afterSummary: async () => {
            throw new Error('after failed');
          },
        },
      ],
    });
    const types = events.map((event) => event.type);

    expect(reason).toBe('completed');
    expect(types.indexOf('hook_failed')).toBeGreaterThan(types.indexOf('summary_done'));
  });

  it('runs both hooks for an overflow summary, with the overflow reason', async () => {
    const { summarizer } = spying();
    const reasons: string[] = [];

    await run({
      summarizer,
      turns: [overflow, answer],
      hooks: [
        {
          name: 'both',
          beforeSummary: async ({ reason }) => {
            reasons.push(`before ${reason}`);

            return undefined;
          },
          afterSummary: async ({ reason }) => {
            reasons.push(`after ${reason}`);
          },
        },
      ],
    });

    expect(reasons).toEqual(['before overflow', 'after overflow']);
  });
});

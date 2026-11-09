import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { ContextState } from '@sheavly/core/hook/hook.types';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runAgent, runSession, streamAgent } from '../stream-agent.helper.js';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';

const probe = defineTool({
  name: 'probe',
  description: 'Looks something up',
  inputSchema: z.object({ query: z.string().optional() }),
  execute: async () => 'found it',
});
const call = {
  id: callIdSchema.parse('c-probe'),
  name: 'probe',
  input: { description: 'probing', query: 'size' },
};
const used = (inputTokens: number) => ({
  tokens: { inputTokens, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const toolTurn = (inputTokens: number): StreamEvent[] => [
  { type: 'tool_call', call },
  { type: 'done', stopReason: 'tool_use', usage: used(inputTokens) },
];
const answer = (inputTokens?: number): StreamEvent[] => [
  { type: 'text_delta', text: 'done' },
  { type: 'done', stopReason: 'end_turn', ...(inputTokens && { usage: used(inputTokens) }) },
];

/** A provider that plays its turns in order and keeps every request it was sent. */
function recording(params: { turns: StreamEvent[][]; contextWindow?: number }) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    contextWindow: params.contextWindow,
    async *stream(request) {
      requests.push(request);
      yield* params.turns[requests.length - 1] ?? [];
    },
  };

  return { provider, requests };
}

/** The typed telemetry a request carries beside its history. */
const sentNotice = (request: ProviderRequest | undefined) => request?.notices?.[0];
const prompt = [{ role: 'user' as const, content: 'go' }];

describe('telling the agent how full its context is', () => {
  it('says only the window before any usage is known, then how much the last call used', async () => {
    const { provider, requests } = recording({
      turns: [toolTurn(48_110), answer()],
      contextWindow: 400_000,
    });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(sentNotice(requests[0])).toEqual({
      kind: 'context-usage',
      context: { window: 400_000, used: undefined },
    });
    expect(sentNotice(requests[1])).toEqual({
      kind: 'context-usage',
      context: { window: 400_000, used: 48_210 },
    });
  });

  it('shares notice data with UIs while keeping model wording out of history and events', async () => {
    const events: AgentEvent[] = [];
    const { provider, requests } = recording({
      turns: [toolTurn(1_000), answer()],
      contextWindow: 400_000,
    });
    const messages = await runAgent({
      provider,
      tools: [probe],
      messages: prompt,
      instructions: 'Work on the task.',
      onEvent: (event) => events.push(event),
    });

    const [first, second] = requests;
    const everywhere = [...messages, ...(first?.messages ?? []), ...(second?.messages ?? [])];

    expect(everywhere.some((message) => message.content.includes('Context:'))).toBe(false);
    expect(JSON.stringify(everywhere)).not.toContain('harness-notice');
    expect(JSON.stringify(everywhere)).not.toContain('context-usage');
    expect(JSON.stringify(events)).not.toContain('harness-notice');
    expect(
      events.flatMap((event) => (event.type === 'harness_notice' ? [event.notice] : [])),
    ).toEqual(requests.map(sentNotice));
    expect(events.some((event) => event.type === 'context_added')).toBe(false);
    // The second request starts with the first one's history, and the instructions are the same.
    expect(second?.messages.slice(0, first?.messages.length)).toEqual(first?.messages);
    expect(second?.instructions).toBe(first?.instructions);
    expect(first?.instructions).toBe('Work on the task.');
    expect(first?.notices).not.toEqual(second?.notices);
  });

  it('leaves the line out when the provider reports neither a window nor usage', async () => {
    const events: AgentEvent[] = [];
    const silent: StreamEvent[] = [
      { type: 'tool_call', call },
      { type: 'done', stopReason: 'tool_use' },
    ];
    const { provider, requests } = recording({ turns: [silent, answer()] });

    await runAgent({
      provider,
      tools: [probe],
      messages: prompt,
      onEvent: (event) => events.push(event),
    });

    expect(requests.map(sentNotice)).toEqual([undefined, undefined]);
    expect(events.some((event) => event.type === 'harness_notice')).toBe(false);
  });

  it('delivers notices through the ordinary session stream, live and on replay', async () => {
    const registry = new SessionRegistry();
    const session = { registry, ref: registry.startMain({ title: 'Notice stream' }) };
    const live: StreamEntry[] = [];
    const { provider, requests } = recording({
      turns: [toolTurn(900), answer()],
      contextWindow: 5_000,
    });
    const unsubscribe = registry.subscribeEntries((entry) => live.push(entry), { replay: true });

    await runSession({ provider, tools: [probe], messages: prompt, session });
    unsubscribe();

    const replay: StreamEntry[] = [];
    const stopReplay = registry.subscribeEntries((entry) => replay.push(entry), { replay: true });

    stopReplay();
    expect(replay).toEqual(live);
    expect(live.map((entry) => entry.seq)).toEqual(live.map((_, index) => index));

    const notices = live.filter(
      (entry) => entry.kind === 'event' && entry.event.type === 'harness_notice',
    );

    expect(notices).toHaveLength(2);

    for (const entry of notices) {
      expect(entry.sessionId).toBe(session.ref.id);
      expect(streamEntrySchema.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
      expect(entry).not.toHaveProperty('event.text');
    }

    expect(
      notices.flatMap((entry) =>
        entry.kind === 'event' && entry.event.type === 'harness_notice' ? [entry.event.notice] : [],
      ),
    ).toEqual(requests.map(sentNotice));
    const steps = live.flatMap((entry) => (entry.kind === 'event' ? [entry.event.type] : []));

    expect(steps.indexOf('harness_notice')).toBeLessThan(steps.indexOf('tool_call_started'));
    expect(steps.lastIndexOf('harness_notice')).toBeLessThan(steps.lastIndexOf('text_delta'));
  });

  it('shrinks to what is used when the window is unknown', async () => {
    const { provider, requests } = recording({ turns: [toolTurn(900), answer()] });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(sentNotice(requests[0])).toBeUndefined();
    expect(sentNotice(requests[1])).toEqual({ kind: 'context-usage', context: { used: 1_000 } });
  });

  it('drops the numbers after a call that reported no usage, since they would be stale', async () => {
    const { provider, requests } = recording({
      turns: [
        toolTurn(5_000),
        [
          { type: 'tool_call', call },
          { type: 'done', stopReason: 'tool_use' },
        ],
        answer(),
      ],
      contextWindow: 10_000,
    });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(sentNotice(requests[1])).toEqual({
      kind: 'context-usage',
      context: { window: 10_000, used: 5_100 },
    });
    expect(sentNotice(requests[2])).toEqual({
      kind: 'context-usage',
      context: { window: 10_000, used: undefined },
    });
  });
});

describe('a session’s own numbers', () => {
  it('carries on across a conversation’s prompts, which are separate runs of one session', async () => {
    const registry = new SessionRegistry();
    const session = { registry, ref: registry.startMain({ title: 'Chat' }) };
    const first = recording({ turns: [answer(2_000)], contextWindow: 10_000 });
    const second = recording({ turns: [answer()], contextWindow: 10_000 });

    await runSession({
      provider: first.provider,
      tools: [],
      messages: prompt,
      session,
      keepSession: true,
    });
    await runSession({
      provider: second.provider,
      tools: [],
      messages: prompt,
      session,
      keepSession: true,
      resumed: true,
    });

    expect(sentNotice(second.requests[0])).toEqual({
      kind: 'context-usage',
      context: { window: 10_000, used: 2_100 },
    });
  });

  it('is not shared with another session of the same registry, as a sub-agent has its own window', async () => {
    const registry = new SessionRegistry();
    const parent = { registry, ref: registry.startMain({ title: 'Parent' }) };
    const child = {
      registry,
      ref: registry.startChild({
        parentId: parent.ref.id,
        startedByCall: callIdSchema.parse('c'),
        title: 'Child',
      }),
    };
    const big = recording({ turns: [answer(90_000)], contextWindow: 400_000 });
    const small = recording({ turns: [answer()], contextWindow: 32_000 });

    await runSession({ provider: big.provider, tools: [], messages: prompt, session: parent });
    await runSession({ provider: small.provider, tools: [], messages: prompt, session: child });

    expect(sentNotice(small.requests[0])).toEqual({
      kind: 'context-usage',
      context: { window: 32_000, used: undefined },
    });
  });
});

describe('the same numbers for hooks and for a UI', () => {
  it('gives beforeTurn hooks the window and what the last call used', async () => {
    const seen: ContextState[] = [];
    const { provider } = recording({ turns: [toolTurn(900), answer()], contextWindow: 5_000 });

    await runAgent({
      provider,
      tools: [probe],
      messages: prompt,
      hooks: [
        defineHook({ name: 'watch', beforeTurn: async ({ context }) => void seen.push(context) }),
      ],
    });

    expect(seen[0]?.window).toBe(5_000);
    expect(seen[0]?.used).toBeUndefined();
    expect(seen[1]).toEqual({ window: 5_000, used: 1_000 });
  });

  it('puts the window on each usage event, after the turn’s stream and before it ends', async () => {
    const events: AgentEvent[] = [];
    const { provider } = recording({ turns: [toolTurn(900), answer(1_400)], contextWindow: 5_000 });

    for await (const event of streamAgent({ provider, tools: [probe], messages: prompt })) {
      events.push(event);
    }

    const usages = events.filter((event) => event.type === 'usage');

    expect(usages.map((event) => event.usage.contextWindow)).toEqual([5_000, 5_000]);
    expect(usages[0]?.usage.tokens?.inputTokens).toBe(900);

    const types = events.map((event) => event.type);

    expect(types.indexOf('usage')).toBeLessThan(types.indexOf('turn_end'));
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });

  it('leaves the window out of the usage event when the provider has none', async () => {
    const events: AgentEvent[] = [];
    const { provider } = recording({ turns: [answer(10)] });

    await runAgent({
      provider,
      tools: [],
      messages: prompt,
      onEvent: (event) => events.push(event),
    });

    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { tokens: { inputTokens: 10 } },
    });
    expect(events.find((event) => event.type === 'usage')).not.toHaveProperty(
      'usage.contextWindow',
    );
  });

  it.each([0, NaN, 2.5])(
    'keeps a provider’s window of %s out of the line and the stream, instead of storing what cannot be read back',
    async (contextWindow) => {
      const events: AgentEvent[] = [];
      // The provider reports it on the call's own usage too, which is dropped as unchecked.
      const own = { tokens: used(10).tokens, contextWindow };
      const { provider, requests } = recording({
        turns: [[{ type: 'done', stopReason: 'end_turn', usage: own }]],
        contextWindow,
      });

      await runAgent({
        provider,
        tools: [],
        messages: prompt,
        onEvent: (event) => events.push(event),
      });

      expect(sentNotice(requests[0])).toBeUndefined();
      const usage = events.find((event) => event.type === 'usage');

      expect(usage).toMatchObject({ usage: { tokens: used(10).tokens } });
      expect(usage).not.toHaveProperty('usage.contextWindow');
    },
  );
});

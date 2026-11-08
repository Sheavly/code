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

/** The context line a request carries beside its history. */
const lastLine = (request: ProviderRequest | undefined) => request?.notice;
const prompt = [{ role: 'user' as const, content: 'go' }];

describe('telling the agent how full its context is', () => {
  it('says only the window before any usage is known, then how much the last call used', async () => {
    const { provider, requests } = recording({
      turns: [toolTurn(48_110), answer()],
      contextWindow: 400_000,
    });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(lastLine(requests[0])).toBe('Context: 400,000 token window');
    expect(lastLine(requests[1])).toBe('Context: 48,210 of 400,000 tokens used (12%)');
  });

  it('keeps the line out of history, so the prefix stays the same and the line is never resent', async () => {
    const { provider, requests } = recording({
      turns: [toolTurn(1_000), answer()],
      contextWindow: 400_000,
    });
    const messages = await runAgent({ provider, tools: [probe], messages: prompt });

    const [first, second] = requests;
    const everywhere = [...messages, ...(first?.messages ?? []), ...(second?.messages ?? [])];

    expect(everywhere.some((message) => message.content.includes('Context:'))).toBe(false);
    // The second request starts with the first one's history, and the instructions are the same.
    expect(second?.messages.slice(0, first?.messages.length)).toEqual(first?.messages);
    expect(second?.instructions).toBe(first?.instructions);
    expect(first?.notice).not.toBe(second?.notice);
  });

  it('leaves the line out when the provider reports neither a window nor usage', async () => {
    const silent: StreamEvent[] = [
      { type: 'tool_call', call },
      { type: 'done', stopReason: 'tool_use' },
    ];
    const { provider, requests } = recording({ turns: [silent, answer()] });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(requests.map(lastLine)).toEqual([undefined, undefined]);
  });

  it('shrinks to what is used when the window is unknown', async () => {
    const { provider, requests } = recording({ turns: [toolTurn(900), answer()] });

    await runAgent({ provider, tools: [probe], messages: prompt });

    expect(lastLine(requests[0])).toBeUndefined();
    expect(lastLine(requests[1])).toBe('Context: 1,000 tokens used');
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

    expect(lastLine(requests[1])).toBe('Context: 5,100 of 10,000 tokens used (51%)');
    expect(lastLine(requests[2])).toBe('Context: 10,000 token window');
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

    expect(lastLine(second.requests[0])).toBe('Context: 2,100 of 10,000 tokens used (21%)');
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

    expect(lastLine(small.requests[0])).toBe('Context: 32,000 token window');
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
});

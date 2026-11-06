import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { agentEventSchema } from '@sheavly/protocol/event/event.validator';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionUpdateSchema } from '@sheavly/protocol/session/session.validator';
import { runSession } from '../stream-agent.helper.js';
import { OUTPUT_CONTINUATION_INSTRUCTION } from '../stream-agent.constants.js';

const capped: StreamEvent[] = [{ type: 'done', stopReason: 'max_tokens' }];
const complete: StreamEvent[] = [
  { type: 'text_delta', text: 'Finished.' },
  { type: 'done', stopReason: 'end_turn' },
];
const initial = [{ role: 'user' as const, content: 'Finish the work.' }];

function keepRequests(responses: StreamEvent[][]) {
  const script = scriptedProvider(responses);
  const requests: ProviderRequest[] = [];
  const provider = {
    stream(request: ProviderRequest) {
      requests.push(request);

      return script.stream(request);
    },
  };

  return { provider, requests };
}

describe('output-limit recovery', () => {
  it('preserves partial text and reasoning and asks for continuation without changing instructions', async () => {
    const reasoning = { source: 'test', data: { signature: 'signed' } };
    const { provider, requests } = keepRequests([
      [
        { type: 'text_delta', text: 'First part.' },
        { type: 'reasoning', item: reasoning },
        ...capped,
      ],
      complete,
    ]);
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider,
      tools: [],
      messages: initial,
      instructions: 'Keep this prefix.',
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('completed');
    expect(requests.map((request) => request.instructions)).toEqual([
      'Keep this prefix.',
      'Keep this prefix.',
    ]);
    expect(requests[1]?.messages).toMatchObject([
      ...initial,
      { role: 'assistant', content: 'First part.', reasoning: [reasoning] },
      { role: 'user', content: OUTPUT_CONTINUATION_INSTRUCTION },
    ]);
    expect(initial).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning',
      'usage',
      'turn_end',
      'output_continuation',
      'text_delta',
      'usage',
      'turn_end',
      'done',
    ]);
    expect(events.find((event) => event.type === 'output_continuation')).toMatchObject({
      attempt: 1,
      maxAttempts: 2,
    });
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    for (const event of events) expect(agentEventSchema.safeParse(event).success).toBe(true);
  });

  it('recovers when hidden thinking consumed the budget and no visible text was produced', async () => {
    const result = await runSession({
      provider: scriptedProvider([
        [{ type: 'reasoning', item: { source: 'test', data: 'thinking only' } }, ...capped],
        complete,
      ]),
      tools: [],
      messages: initial,
    });

    expect(result.reason).toBe('completed');
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Finished.' });
  });

  it('stops after two attempts by default and records a non-success session outcome', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Bounded recovery' });
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider: scriptedProvider([capped, capped, capped]),
      tools: [],
      messages: initial,
      session: { registry, ref },
      keepSession: true,
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('max_tokens');
    expect(events.filter((event) => event.type === 'output_continuation')).toHaveLength(2);
    expect(result.messages.filter((message) => message.role === 'assistant')).toHaveLength(3);

    const session = registry.get(ref.id);

    expect(session).toMatchObject({ state: 'idle', lastOutcome: 'max_tokens' });
    expect(sessionUpdateSchema.safeParse({ type: 'session_idle', session }).success).toBe(true);
  });

  it.each([
    { maxOutputContinuations: 0, maxTurns: undefined, reason: 'max_tokens' },
    { maxOutputContinuations: 2, maxTurns: 1, reason: 'max_turns' },
  ] as const)('respects $reason without scheduling an impossible retry', async (limits) => {
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider: scriptedProvider([capped]),
      tools: [],
      messages: initial,
      maxOutputContinuations: limits.maxOutputContinuations,
      ...(limits.maxTurns && { maxTurns: limits.maxTurns }),
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe(limits.reason);
    expect(events.some((event) => event.type === 'output_continuation')).toBe(false);
    expect(result.messages).toHaveLength(2);
  });

  it('does not repeat completed tools, and releases their results before recovery', async () => {
    let effects = 0;
    const tool = defineTool({
      name: 'apply',
      description: 'Applies a change',
      inputSchema: z.object({}),
      execute: async () => {
        effects++;

        return 'Applied.';
      },
    });
    const call = {
      id: callIdSchema.parse('apply-1'),
      name: 'apply',
      input: { description: 'Apply once' },
    };
    const { provider, requests } = keepRequests([
      [{ type: 'tool_call', call }, ...capped],
      complete,
    ]);
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider,
      tools: [tool],
      messages: initial,
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('completed');
    expect(effects).toBe(1);
    expect(requests[1]?.messages[2]).toMatchObject({ role: 'tool', content: 'Applied.' });
    expect(events.map((event) => event.type)).toEqual([
      'tool_call_started',
      'usage',
      'turn_end',
      'tool_batch',
      'tool_result',
      'output_continuation',
      'text_delta',
      'usage',
      'turn_end',
      'done',
    ]);
  });

  it('does not reset the recovery budget after a normal tool turn', async () => {
    const call = {
      id: callIdSchema.parse('unknown-1'),
      name: 'unknown',
      input: { description: 'Look' },
    };
    const normal: StreamEvent[] = [
      { type: 'tool_call', call },
      { type: 'done', stopReason: 'tool_use' },
    ];
    const result = await runSession({
      provider: scriptedProvider([capped, normal, capped, capped]),
      tools: [],
      messages: initial,
    });

    expect(result.reason).toBe('max_tokens');
    expect(
      result.messages.filter((message) => message.content === OUTPUT_CONTINUATION_INSTRUCTION),
    ).toHaveLength(2);
  });

  it('never retries context exhaustion as output truncation', async () => {
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider: scriptedProvider([[{ type: 'done', stopReason: 'context_window_exceeded' }]]),
      tools: [],
      messages: initial,
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('context_window_exceeded');
    expect(events.map((event) => event.type)).toEqual(['usage', 'turn_end', 'done']);
  });

  it('honors an abort from an afterTurn hook before adding recovery context', async () => {
    const stop = new AbortController();
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider: scriptedProvider([capped]),
      tools: [],
      messages: initial,
      signal: stop.signal,
      hooks: [
        {
          name: 'stop',
          afterTurn: async () => {
            stop.abort();
          },
        },
      ],
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('interrupted');
    expect(result.messages).toHaveLength(2);
    expect(events.some((event) => event.type === 'output_continuation')).toBe(false);
  });
});

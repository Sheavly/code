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
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';

const capped: StreamEvent[] = [{ type: 'done', stopReason: 'max_tokens' }];
const complete: StreamEvent[] = [
  { type: 'text_delta', text: 'Finished.' },
  { type: 'done', stopReason: 'end_turn' },
];
const initial = [{ role: 'user' as const, content: 'Finish the work.' }];

const notices = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'harness_notice' ? [event.notice] : []));

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
    ]);
    expect(requests[1]?.notices).toEqual([{ kind: 'output-continuation', attempt: 1 }]);
    expect(result.messages.filter((message) => message.role === 'user')).toEqual(initial);
    expect(initial).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning',
      'usage',
      'turn_end',
      'harness_notice',
      'text_delta',
      'usage',
      'turn_end',
      'done',
    ]);
    expect(notices(events)).toEqual(requests.flatMap((request) => request.notices ?? []));
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

  it('continues beyond two cutoffs by default and records completion', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Automatic recovery' });
    const events: AgentEvent[] = [];
    const { provider, requests } = keepRequests([capped, capped, capped, complete]);
    const result = await runSession({
      provider,
      tools: [],
      messages: initial,
      session: { registry, ref },
      keepSession: true,
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('completed');
    expect(requests).toHaveLength(4);
    expect(notices(events)).toEqual(
      [1, 2, 3].map((attempt) => ({ kind: 'output-continuation', attempt })),
    );
    expect(result.messages.filter((message) => message.role === 'assistant')).toHaveLength(4);

    const session = registry.get(ref.id);

    expect(session).toMatchObject({ state: 'idle', lastOutcome: 'completed' });
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
    expect(notices(events)).toEqual([]);
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
      'harness_notice',
      'text_delta',
      'usage',
      'turn_end',
      'done',
    ]);
  });

  it('keeps an explicitly requested run-wide recovery budget across normal tool turns', async () => {
    const events: AgentEvent[] = [];
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
      maxOutputContinuations: 2,
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('max_tokens');
    expect(notices(events)).toEqual([
      { kind: 'output-continuation', attempt: 1, maxAttempts: 2 },
      { kind: 'output-continuation', attempt: 2, maxAttempts: 2 },
    ]);
    expect(result.messages.filter((message) => message.role === 'user')).toEqual(initial);
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
    expect(notices(events)).toEqual([]);
  });

  it('shares continuation and context notices live and on replay without storing their instructions', async () => {
    const registry = new SessionRegistry();
    const session = { registry, ref: registry.startMain({ title: 'Seamless recovery' }) };
    const live: StreamEntry[] = [];
    const events: AgentEvent[] = [];
    const { provider, requests } = keepRequests([
      [{ type: 'text_delta', text: 'First ' }, ...capped],
      complete,
    ]);
    const unsubscribe = registry.subscribeEntries((entry) => live.push(entry), { replay: true });
    const result = await runSession({
      provider: { ...provider, contextWindow: 10_000 },
      tools: [],
      messages: initial,
      instructions: 'Keep the system prefix.',
      session,
      onEvent: (event) => events.push(event),
    });

    unsubscribe();
    const replay: StreamEntry[] = [];
    const stopReplay = registry.subscribeEntries((entry) => replay.push(entry), { replay: true });

    stopReplay();
    const continuation: HarnessNotice = { kind: 'output-continuation', attempt: 1 };

    expect(requests[1]?.notices).toEqual([
      { kind: 'context-usage', context: { window: 10_000, used: undefined } },
      continuation,
    ]);
    expect(notices(events)).toEqual(requests.flatMap((request) => request.notices ?? []));
    expect(result.messages.filter((message) => message.role === 'user')).toEqual(initial);
    expect(JSON.stringify(result.messages)).not.toContain('output-continuation');
    expect(requests.map((request) => request.instructions)).toEqual([
      'Keep the system prefix.',
      'Keep the system prefix.',
    ]);
    expect(replay).toEqual(live);
    expect(live.map((entry) => entry.seq)).toEqual(live.map((_, index) => index));
    for (const entry of live) expect(streamEntrySchema.safeParse(entry).success).toBe(true);
    const steps = events.map((event) => event.type);

    expect(steps.lastIndexOf('harness_notice')).toBeLessThan(steps.lastIndexOf('text_delta'));
  });

  it('does not resend a continuation notice after a successful tool turn', async () => {
    const call = {
      id: callIdSchema.parse('look-1'),
      name: 'unknown',
      input: { description: 'Look' },
    };
    const { provider, requests } = keepRequests([
      capped,
      [
        { type: 'tool_call', call },
        { type: 'done', stopReason: 'tool_use' },
      ],
      complete,
    ]);

    const result = await runSession({ provider, tools: [], messages: initial });

    expect(result.reason).toBe('completed');
    expect(requests.map((request) => request.notices)).toEqual([
      [],
      [{ kind: 'output-continuation', attempt: 1 }],
      [],
    ]);
  });

  it('honors cancellation between recovery and the next model call', async () => {
    const stop = new AbortController();
    const events: AgentEvent[] = [];
    const { provider, requests } = keepRequests([capped]);
    const result = await runSession({
      provider,
      tools: [],
      messages: initial,
      signal: stop.signal,
      hooks: [
        {
          name: 'cancel-recovery',
          beforeTurn: async ({ turn }) => {
            if (turn === 2) stop.abort();
          },
        },
      ],
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('interrupted');
    expect(requests).toHaveLength(1);
    expect(notices(events)).toEqual([]);
  });
});

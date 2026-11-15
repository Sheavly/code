import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { ping, twoTurns } from '../../testing/ping-turns.fake.js';
import { runAgent, streamAgent } from '../stream-agent.helper.js';

const prompt = { role: 'user' as const, content: 'ping' };

describe('new hook points in the loop', () => {
  it('runs sessionEnd once with the outcome, before done, which stays the last event', async () => {
    const seen: string[] = [];
    const types: string[] = [];

    for await (const event of streamAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [prompt],
      hooks: [
        defineHook({
          name: 'end',
          sessionEnd: async ({ outcome, messages }) =>
            void seen.push(`${outcome} ${messages.length}`),
        }),
      ],
    })) {
      types.push(event.type);
    }

    expect(seen).toEqual(['completed 4']);
    expect(types.at(-1)).toBe('done');
  });

  it('reports a failing sessionEnd as hook_failed without changing the outcome', async () => {
    const events: AgentEvent[] = [];

    await runAgent({
      provider: twoTurns(),
      tools: [ping],
      messages: [prompt],
      hooks: [
        defineHook({
          name: 'end',
          sessionEnd: async () => {
            throw new Error('disk full');
          },
        }),
      ],
      onEvent: (event) => events.push(event),
    });

    expect(events.find((event) => event.type === 'hook_failed')).toMatchObject({
      hook: 'end',
      handler: 'sessionEnd',
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('lets an approval hook stop a command of its own session, and stops screening when the run ends', async () => {
    const approvals = new ApprovalRegistry();
    const asked: string[] = [];

    await runAgent({
      provider: twoTurns(),
      tools: [
        {
          ...ping,
          execute: async (context) => {
            const response = await approvals.request({
              callId: callIdSchema.parse('c9'),
              sessionId: context.context?.session?.id,
              tool: 'ping',
              command: 'ping',
              concerns: [],
              signal: context.signal,
            });

            return response.decision;
          },
        },
      ],
      messages: [prompt],
      approvals,
      hooks: [
        defineHook({
          name: 'guard',
          approval: async ({ request }) => {
            asked.push(request.command);

            return { decision: 'skip_with_message', message: 'blocked' };
          },
        }),
      ],
    });

    expect(asked).toEqual(['ping']);

    // The run is over: nobody screens now, and with no listener the request fails closed.
    await expect(
      approvals.request({
        callId: callIdSchema.parse('c10'),
        tool: 'ping',
        command: 'later',
        concerns: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('No one is listening');
  });
});

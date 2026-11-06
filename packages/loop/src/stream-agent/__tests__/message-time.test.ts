import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runAgent, runSession } from '../stream-agent.helper.js';

const echo = defineTool({
  name: 'echo',
  description: 'Echoes',
  inputSchema: z.object({}),
  execute: async () => 'echoed',
});
const useEcho: StreamEvent[] = [
  {
    type: 'tool_call',
    call: { id: callIdSchema.parse('c1'), name: 'echo', input: { description: 'echo' } },
  },
  { type: 'done', stopReason: 'tool_use' },
];
const finish: StreamEvent[] = [
  { type: 'text_delta', text: 'done' },
  { type: 'done', stopReason: 'end_turn' },
];

/** Plays `turns` in order, with the clock moving `step` ms before each model call. */
function slowProvider(params: {
  turns: StreamEvent[][];
  step: number;
  advance: (ms: number) => void;
}) {
  let call = 0;
  const provider: Provider = {
    async *stream() {
      params.advance(params.step);
      yield* params.turns[call++] ?? finish;
      await Promise.resolve();
    },
  };

  return provider;
}

describe('the time on the messages a run makes', () => {
  const clock = useFixedClock();

  it('stamps each assistant reply and tool result with when it was made', async () => {
    const start = clock.at;
    const messages = await runAgent({
      provider: slowProvider({ turns: [useEcho, finish], step: 1_000, advance: clock.advance }),
      tools: [echo],
      messages: [{ role: 'user', content: 'go' }],
    });

    expect(messages.map((m) => [m.role, m.at])).toEqual([
      ['user', undefined], // the caller's own message keeps what the caller gave it
      ['assistant', start + 1_000],
      ['tool', start + 1_000],
      ['assistant', start + 2_000],
    ]);
  });

  it('stamps context a hook adds, and the placeholder a stopped tool gets', async () => {
    const start = clock.at;
    const hook = defineHook({
      name: 'rules',
      sessionStart: async ({ addContext }) => {
        clock.advance(500);
        addContext('house rules');
      },
    });
    const messages = await runAgent({
      provider: slowProvider({ turns: [finish], step: 0, advance: clock.advance }),
      tools: [],
      hooks: [hook],
      messages: [{ role: 'user', content: 'go' }],
    });

    expect(messages[1]).toMatchObject({ role: 'user', content: 'house rules', at: start + 500 });
  });

  it('stamps a message sent to a session with when it was sent, not when the run read it', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const sentAt = clock.at;

    registry.send({ id: ref.id, from: 'user', content: 'steer left' });
    clock.advance(30_000);

    const { messages } = await runSession({
      provider: slowProvider({ turns: [finish], step: 0, advance: clock.advance }),
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      session: { registry, ref },
    });
    const steering = messages.find((m) => m.role === 'user' && m.content.includes('steer left'));

    expect(steering?.at).toBe(sentAt);
  });
});

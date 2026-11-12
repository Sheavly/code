import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runAgent } from '../stream-agent.helper.js';

const ping = defineTool({
  name: 'ping',
  description: 'Replies pong',
  inputSchema: z.object({}),
  execute: async () => 'pong',
});
const callPing = (id: string) => [
  {
    type: 'tool_call' as const,
    call: { id: callIdSchema.parse(id), name: 'ping', input: { description: 'ping' } },
  },
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

describe('keepHistory', () => {
  it('is given the whole history after every turn, so a long run is kept as it goes', async () => {
    const provider = scriptedProvider([
      callPing('a'),
      callPing('b'),
      [
        { type: 'text_delta', text: 'done' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const lengths: number[] = [];

    const messages = await runAgent({
      provider,
      tools: [ping],
      messages: [{ role: 'user', content: 'go' }],
      keepHistory: (kept) => lengths.push(kept.length),
    });

    // user, then each turn adds a reply and its result, and the last adds only a reply.
    expect(lengths).toEqual([3, 5, 6]);
    expect(messages).toHaveLength(6);
  });
});

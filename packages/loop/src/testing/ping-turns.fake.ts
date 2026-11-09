import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

/** A tool that replies `pong`, for loop tests that need one tool call. */
export const ping = defineTool({
  name: 'ping',
  description: 'Replies pong',
  inputSchema: z.object({}),
  execute: async () => 'pong',
});

/** The call to `ping` that `twoTurns` makes on its first turn. */
export const pingCall = {
  id: callIdSchema.parse('1'),
  name: 'ping',
  input: { description: 'pinging' },
};

/** Turn 1 calls ping, turn 2 answers. */
export const twoTurns = () =>
  scriptedProvider([
    [
      { type: 'tool_call', call: pingCall },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text_delta', text: 'pong it is' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ]);

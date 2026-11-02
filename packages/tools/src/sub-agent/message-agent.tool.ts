import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';

/**
 * `message_agent`: steers a running sub-agent without stopping it. The message waits in the
 * sub-agent's inbox and is added to its conversation at its next model call. Only the session
 * that started a sub-agent (or one above it) may message it; the registry refuses others.
 */
export function createMessageAgentTool({ sessions }: { sessions: SessionRegistry }) {
  return defineTool({
    name: 'message_agent',
    description:
      'Send a message to a sub-agent you started, while it keeps working: new instructions, a ' +
      'narrower focus, an answer it needs. It sees the message at its next step. Address it by ' +
      'the session id start_agent returned.',
    inputSchema: z.object({
      session: z.string().min(1).describe("The sub-agent's session id, from start_agent"),
      message: z.string().min(1).describe('What to tell it'),
    }),
    execute: async ({ input: { session: id, message }, context }) => {
      if (!context.session) {
        throw new ToolCallError({
          reason: 'unavailable',
          message: 'message_agent only works inside an agent session',
        });
      }

      sessions.send({ id, content: message, from: context.session.id });
      const target = sessions.get(id);

      return `Sent to sub-agent "${target?.title ?? id}" (session ${id}). It sees the message at its next step.`;
    },
  });
}

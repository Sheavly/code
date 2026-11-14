import type { Tool } from '@sheavly/core/tool/tool.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import type { ToolCall } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/**
 * Test-only: calls `tools` by name, each call with the description the harness requires. The id
 * is a plain string, branded here, so a test can write `run('c1', …)`. With a `session`, every
 * call is made as that session's.
 */
export function toolRunner(tools: Tool[], session?: SessionRef) {
  const signal = new AbortController().signal;

  return (id: string, name: string, input: Record<string, unknown>) =>
    runTool({
      tools,
      call: {
        id: callIdSchema.parse(id),
        name,
        input: { description: `call ${id}`, ...input },
      } satisfies ToolCall,
      signal,
      session,
    });
}

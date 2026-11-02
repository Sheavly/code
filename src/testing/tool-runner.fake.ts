import type { ToolCall } from '@sheavly/core/message/message.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { runTool } from '@sheavly/core/tool/tool.helper';

/** Test-only: calls `tools` by name, each call with the description the harness requires. */
export function toolRunner(tools: Tool[]) {
  const signal = new AbortController().signal;

  return (id: string, name: string, input: Record<string, unknown>) =>
    runTool({
      tools,
      call: { id, name, input: { description: `call ${id}`, ...input } } satisfies ToolCall,
      signal,
    });
}

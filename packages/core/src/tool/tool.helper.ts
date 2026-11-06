import { now } from '../clock/clock.helper.js';
import type { Tool, ToolRunResult } from './tool.types.js';
import { validate } from '../validation/validation.validator.js';
import { withDescription } from './tool.validator.js';
import type { ToolCall, ToolMessage } from '@sheavly/protocol/message/message.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/**
 * Validates input, runs the tool, and always returns a tool message (never throws), with the
 * tool's artifacts if it returned any.
 */
export async function runTool(params: {
  tools: Tool[];
  call: ToolCall;
  signal: AbortSignal;
  session?: SessionRef | undefined;
}): Promise<ToolRunResult> {
  const { tools, call, signal, session } = params;
  const result = (content: string, isError = false): ToolMessage => ({
    role: 'tool',
    toolCallId: call.id,
    content,
    isError,
    at: now(),
  });

  const tool = tools.find((t) => t.name === call.name);

  if (!tool) return result(`Unknown tool: ${call.name}`, true);

  const parsed = validate({ schema: withDescription(tool.inputSchema), input: call.input });

  if (!parsed.success) return result(`Invalid input for ${call.name}:\n${parsed.details}`, true);

  const { description, ...input } = parsed.data as { description: string } & Record<
    string,
    unknown
  >;

  try {
    const output = await tool.execute({
      input,
      signal,
      context: { callId: call.id, description, session },
    });

    if (typeof output === 'string') return result(output);

    const { content, artifacts } = output;

    return { ...result(content), ...(artifacts?.length ? { artifacts } : {}) };
  } catch (caughtError) {
    const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

    return result(`Tool ${call.name} failed: ${reason}`, true);
  }
}

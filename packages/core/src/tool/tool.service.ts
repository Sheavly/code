import { z } from 'zod';
import type { ToolCall, ToolMessage } from '../message/message.types.js';
import type { ToolDefinition } from '../provider/provider.types.js';
import type { Tool, ToolRunResult } from './tool.types.js';
import type { SessionRef } from '../session/session.types.js';

// --- Call description: added by the harness to every tool, filled in by the model ---

/**
 * Every tool call carries a short, plain-language `description` written by the model
 * ("reading index.ts"), so a UI can show intent instead of just the tool name.
 * Tools never see it: it is added to the schema here and stripped before `execute`.
 */
const callDescription = z
  .string()
  .min(1)
  .max(120)
  .describe(
    "Short plain-language summary of what you are doing, e.g. 'reading index.ts'. Shown to the user.",
  );

/** Description first, so the model states intent before writing the arguments. */
function withDescription(schema: z.ZodObject) {
  return z.object({ description: callDescription }).extend(schema.shape);
}

/** The description for a call, falling back to the tool name if the model omitted it. */
export function describeCall(call: ToolCall): string {
  const parsed = z.object({ description: z.string().min(1) }).safeParse(call.input);

  return parsed.success ? parsed.data.description : call.name;
}

// --- Defining and running tools ---

/** Identity helper: lets TypeScript infer `input` from the schema. */
export function defineTool<TSchema extends z.ZodObject>(tool: Tool<TSchema>): Tool<TSchema> {
  if ('description' in tool.inputSchema.shape) {
    throw new Error(`Tool ${tool.name}: "description" is reserved for the call description`);
  }

  return tool;
}

/** What we send to the provider so the model knows which tools exist. */
export function toDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(withDescription(tool.inputSchema)),
  };
}

/**
 * Validates input, runs the tool, and always returns a tool message (never throws), with the
 * tool's file change if it made one.
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
  });

  const tool = tools.find((t) => t.name === call.name);

  if (!tool) return result(`Unknown tool: ${call.name}`, true);

  const parsed = withDescription(tool.inputSchema).safeParse(call.input);

  if (!parsed.success) {
    return result(`Invalid input for ${call.name}:\n${z.prettifyError(parsed.error)}`, true);
  }

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

    return typeof output === 'string'
      ? result(output)
      : { ...result(output.content), change: output.change };
  } catch (caughtError) {
    const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

    return result(`Tool ${call.name} failed: ${reason}`, true);
  }
}

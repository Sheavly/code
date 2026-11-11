import { z } from 'zod';
import type { ToolCall } from '@sheavly/protocol/message/message.types';
import { CALL_DESCRIPTION_GUIDANCE } from './tool.prompt.js';

// The call description: added by the harness to every tool's input schema, filled in by the model.

/**
 * Every tool call carries a short, plain-language `description` written by the model
 * ("reading index.ts"), so a UI can show intent instead of just the tool name.
 * Tools never see it: it is added to the schema here and stripped before `execute`.
 */
const callDescription = z.string().min(1).max(120).describe(CALL_DESCRIPTION_GUIDANCE);

/** A tool's input schema with the call description in front, so the model states intent first. */
export function withDescription(schema: z.ZodObject) {
  return z.object({ description: callDescription }).extend(schema.shape);
}

/** The description for a call, falling back to the tool name if the model omitted it. */
export function describeCall(call: ToolCall): string {
  const parsed = z.object({ description: z.string().min(1) }).safeParse(call.input);

  return parsed.success ? parsed.data.description : call.name;
}

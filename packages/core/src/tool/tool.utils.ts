import { z } from 'zod';
import type { ToolDefinition } from '../provider/provider.types.js';
import type { Tool } from './tool.types.js';
import { DefinitionError } from '../errors/definition.errors.js';
import { withDescription } from './tool.validator.js';

/** Identity helper: lets TypeScript infer `input` from the schema. */
export function defineTool<TSchema extends z.ZodObject>(tool: Tool<TSchema>): Tool<TSchema> {
  if ('description' in tool.inputSchema.shape) {
    throw new DefinitionError({
      definition: 'tool',
      defined: tool.name,
      problem: '"description" is reserved for the call description',
    });
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

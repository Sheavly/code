import type { z } from 'zod';

/** About the call being executed; most tools don't need it. */
export type ToolContext = {
  callId: string;
  /** The model's plain-language description of this call. */
  description: string;
};

/** What a tool's `execute` receives. */
export type ToolExecution<TInput> = {
  input: TInput;
  signal: AbortSignal;
  context: ToolContext;
};

/** Tool inputs are always objects (function-calling APIs require it). */
export type Tool<TSchema extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (params: ToolExecution<z.infer<TSchema>>) => Promise<string>;
};

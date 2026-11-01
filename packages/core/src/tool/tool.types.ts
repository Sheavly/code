import type { z } from 'zod';
import type { ToolMessage } from '../message/message.types.js';

/**
 * A file a tool created or changed: enough for a UI to render a diff. The harness emits it on
 * the `tool_result` event; rendering the diff is the UI's job.
 */
export type FileChange = {
  /** Relative to the workspace root, e.g. `src/index.ts`. */
  path: string;
  /** The content before the change; `null` if the tool created the file. */
  before: string | null;
  after: string;
};

/** What `execute` returns: text for the model, plus a file change when the tool made one. */
export type ToolOutput = string | { content: string; change: FileChange };

/** What `runTool` returns: the history message, plus the tool's file change (not kept in history). */
export type ToolRunResult = ToolMessage & { change?: FileChange };

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
  execute: (params: ToolExecution<z.infer<TSchema>>) => Promise<ToolOutput>;
};

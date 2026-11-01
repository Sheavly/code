import type { z } from 'zod';
import type { ToolMessage } from '../message/message.types.js';
import type { SessionRef } from '../session/session.types.js';

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

/**
 * What a read covered, so a UI can say "read src/a.ts" or "read src/a.ts lines 10–40" without
 * parsing the text. `whole` is true when every line of the file was returned.
 */
export type FileRead = {
  /** Relative to the workspace root. */
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  whole: boolean;
};

/** What `execute` returns: text for the model, plus what it changed or read (for the UI). */
export type ToolOutput = string | { content: string; change?: FileChange; read?: FileRead };

/** What `runTool` returns: the history message, plus the tool's file change or read (not kept in history). */
export type ToolRunResult = ToolMessage & { change?: FileChange; read?: FileRead };

/** About the call being executed; most tools don't need it. */
export type ToolContext = {
  callId: string;
  /** The model's plain-language description of this call. */
  description: string;
  /** The session making the call (when the loop runs it): sub-agent tools start children of it. */
  session?: SessionRef | undefined;
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

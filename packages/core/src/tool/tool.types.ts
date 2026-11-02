import type { z } from 'zod';
import type { ToolMessage } from '../message/message.types.js';
import type { SessionRef } from '../session/session.types.js';

/**
 * Data a tool returns for a UI, never for history (so it costs no tokens). `kind` names it
 * (`file_change`, `file_read`, ...); the tool that emits it defines the kind and the rest of its
 * shape, and a UI renders the kinds it knows and skips the others. The harness passes it through
 * hooks and onto the `tool_result` event without looking inside.
 */
export type ToolArtifact = { kind: string; [field: string]: unknown };

/** What `execute` returns: text for the model, plus any artifacts for the UI. */
export type ToolOutput = string | { content: string; artifacts?: readonly ToolArtifact[] };

/** What `runTool` returns: the history message, plus the tool's artifacts (not kept in history). */
export type ToolRunResult = ToolMessage & { artifacts?: readonly ToolArtifact[] };

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

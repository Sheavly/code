import type { z } from 'zod';
import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import type { ToolMessage } from '@sheavly/protocol/message/message.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** What a tool returns for a UI beside its text; never kept in history, never sent to the model. */
export type ToolArtifacts = { artifacts?: readonly ToolArtifact[] | undefined };

/** What `execute` returns: text for the model, plus any artifacts for the UI. */
export type ToolOutput = string | ({ content: string } & ToolArtifacts);

/** What `runTool` returns: the history message, plus the tool's artifacts (not kept in history). */
export type ToolRunResult = ToolMessage & ToolArtifacts;

/** About the call being executed; most tools don't need it. */
export type ToolContext = {
  callId: CallId;
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

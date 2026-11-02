import type { StreamEvent } from '../message/message.types.js';
import type { Message } from '@sheavly/protocol/message/message.types';

// --- Provider contract (Anthropic, OpenAI, local, ... all implement this) ---

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ProviderRequest = {
  /**
   * System instructions for this model call (e.g. the host's prompt plus AGENTS.md files).
   * Rebuilt every turn and never stored in `messages`, so changing them can't corrupt history.
   */
  instructions?: string | undefined;
  messages: Message[];
  tools: ToolDefinition[];
  signal: AbortSignal;
};

export type Provider = {
  stream(request: ProviderRequest): AsyncIterable<StreamEvent>;
};

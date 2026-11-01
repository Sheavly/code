import type { Message, StreamEvent } from '../message/message.types.js';

// --- Provider contract (Anthropic, OpenAI, local, ... all implement this) ---

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ProviderRequest = {
  messages: Message[];
  tools: ToolDefinition[];
  signal: AbortSignal;
};

export type Provider = {
  stream(request: ProviderRequest): AsyncIterable<StreamEvent>;
};

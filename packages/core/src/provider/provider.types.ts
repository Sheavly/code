import type { StreamEvent } from '../message/message.types.js';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ModelMode } from '@sheavly/protocol/model/model.types';

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
  /** Effort for this call, captured when it starts; a later switch never changes an active stream. */
  mode?: ModelMode | undefined;
  messages: Message[];
  /**
   * One short line for the model that changes every call (how full its context is). It is not
   * history: an adapter sends it after the history, as a last user message, and keeps it out of
   * anything it hashes, caches or replays, so the stable prefix and signed thinking are
   * unaffected. Never stored in `messages`.
   */
  notice?: string | undefined;
  tools: ToolDefinition[];
  signal: AbortSignal;
};

export type Provider = {
  stream(request: ProviderRequest): AsyncIterable<StreamEvent>;
  /**
   * The size of the model's context in tokens, when the provider knows it. The loop reads it
   * before each model call, so a provider that can change model (a switch) answers for the one
   * its next call goes to.
   */
  readonly contextWindow?: number | undefined;
};

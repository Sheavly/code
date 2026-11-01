// --- Conversation history ---

export type ToolCall = {
  id: string;
  name: string;
  /** Raw input from the model. Validated with zod before the tool runs. */
  input: unknown;
};

/**
 * Opaque reasoning state from the model (e.g. Responses API encrypted reasoning).
 * Kept in history and resent so the model can continue its reasoning across tool calls.
 * Only the provider that produced it can read it, so it's tagged with `source`.
 */
export type ReasoningItem = {
  /** Identifies the backend + model that produced the item. */
  source: string;
  /** Provider-specific payload, resent verbatim. */
  data: unknown;
};

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[]; reasoning?: ReasoningItem[] }
  | { role: 'tool'; toolCallId: string; content: string; isError: boolean };

/** A tool's result, as kept in history. */
export type ToolMessage = Extract<Message, { role: 'tool' }>;

// --- What a provider streams back ---

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

/** Why a turn ended: the model's reason, or `interrupted` if the run's signal aborted. */
export type TurnStopReason = StopReason | 'interrupted';

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'reasoning'; item: ReasoningItem }
  | { type: 'done'; stopReason: StopReason };

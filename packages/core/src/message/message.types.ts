import type {
  ReasoningItem,
  ToolCall,
  TurnStopReason,
} from '@sheavly/protocol/message/message.types';
import type { ModelUsage } from '@sheavly/protocol/usage/usage.types';

// --- What a provider streams back ---

/** Why the model ended a turn (a turn the run's signal aborted is `interrupted` instead). */
export type StopReason = Exclude<TurnStopReason, 'interrupted'>;

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'reasoning'; item: ReasoningItem }
  | { type: 'done'; stopReason: StopReason; usage?: ModelUsage };

import type { StopReason } from '@sheavly/core/message/message.types';

/** The Messages API version every call names (`anthropic-version`). */
export const ANTHROPIC_VERSION = '2023-06-01';

/** How errors name this API. */
export const MESSAGES_API = 'Anthropic Messages API';

/** The fewest thinking tokens the API accepts for extended thinking. */
export const MIN_THINKING_BUDGET = 1024;

/** The API's stop reasons we treat as more than an ended turn; any other ends it normally. */
export const STOP_REASONS: Record<string, StopReason> = {
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'context_window_exceeded',
};

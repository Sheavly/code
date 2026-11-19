import { z } from 'zod';
import { MIN_THINKING_BUDGET } from './messages.constants.js';
import type { MessagesThinkingMode } from './messages.types.js';

/** The thinking fields a Claude config holds, which `refineClaudeThinking` judges together. */
type ClaudeThinkingConfig = {
  thinkingMode?: MessagesThinkingMode | undefined;
  thinkingBudget?: number | undefined;
};

/**
 * The thinking and caching fields every Claude-on-Messages adapter takes, after its own `maxTokens`.
 * Spread them into the adapter's object schema, then wrap it in `refineClaudeThinking`.
 */
export const claudeThinkingFields = {
  thinkingMode: z.enum(['adaptive', 'enabled', 'disabled']).optional().meta({
    title: 'Thinking mode',
    description:
      'Use adaptive for models that require it, such as Sonnet 5.5. Enabled uses a fixed thinking budget; disabled turns thinking off.',
  }),
  thinkingBudget: z.number().int().min(MIN_THINKING_BUDGET).optional().meta({
    title: 'Thinking budget',
    description:
      'Only for enabled thinking: at least 1024, under max tokens. Leave empty for adaptive or disabled.',
  }),
  promptCaching: z.boolean().default(true).meta({
    title: 'Prompt caching',
    description:
      'Send cache_control so repeated turns reuse the prompt prefix. On by default; turn it off only for a model that rejects the field.',
  }),
};

/**
 * Adds the rules that tie the thinking fields to each other and to the output limit:
 * `maxTokensOf` gives the limit a reply will really use, so a budget is judged against it.
 */
export function refineClaudeThinking<TSchema extends z.ZodType<ClaudeThinkingConfig>>(params: {
  schema: TSchema;
  maxTokensOf: (config: z.output<TSchema>) => number;
}): TSchema {
  const { schema, maxTokensOf } = params;

  return schema
    .refine(
      (config) =>
        config.thinkingBudget === undefined || config.thinkingBudget < maxTokensOf(config),
      { message: 'thinkingBudget must be less than maxTokens', path: ['thinkingBudget'] },
    )
    .refine((config) => config.thinkingMode !== 'enabled' || config.thinkingBudget !== undefined, {
      message: 'Enabled thinking requires a thinking budget.',
      path: ['thinkingBudget'],
    })
    .refine(
      (config) =>
        config.thinkingBudget === undefined ||
        config.thinkingMode === undefined ||
        config.thinkingMode === 'enabled',
      {
        message: 'Leave thinkingBudget empty for adaptive or disabled thinking.',
        path: ['thinkingBudget'],
      },
    );
}

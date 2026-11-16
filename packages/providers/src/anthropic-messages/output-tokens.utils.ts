import { outputTokenLimit } from '../http/output-tokens.utils.js';
import { FALLBACK_OUTPUT_TOKENS, MODEL_OUTPUT_DEFAULTS } from './output-tokens.constants.js';

/** Messages' `max_tokens`, which the API requires. Explicit limits always win, even saved ones. */
export function messagesMaxTokens(params: {
  model: string;
  maxTokens: number | undefined;
}): number {
  return (
    outputTokenLimit({
      key: params.model,
      maxTokens: params.maxTokens,
      defaults: MODEL_OUTPUT_DEFAULTS,
    }) ?? FALLBACK_OUTPUT_TOKENS
  );
}

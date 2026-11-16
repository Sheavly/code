import { outputTokenLimit } from '../http/output-tokens.utils.js';
import { CHAT_MODEL_OUTPUT_DEFAULTS } from './output-tokens.constants.js';

/**
 * Chat Completions' `max_tokens`; the model is matched case-insensitively. Undefined for an
 * unknown deployment: the request then omits it and the server applies its own default, rather
 * than the harness guessing a low cap that truncates thinking.
 */
export function chatMaxTokens(params: {
  model: string;
  maxTokens: number | undefined;
}): number | undefined {
  return outputTokenLimit({
    key: params.model.toLowerCase(),
    maxTokens: params.maxTokens,
    defaults: CHAT_MODEL_OUTPUT_DEFAULTS,
  });
}

import { CHAT_MODEL_OUTPUT_DEFAULTS } from './output-tokens.constants.js';

/**
 * An explicit limit wins; otherwise a recognized model's documented limit. Undefined for an
 * unknown deployment: the request then omits `max_tokens` and the server applies its own default,
 * rather than the harness guessing a low cap that truncates thinking.
 */
export function chatMaxTokens(params: {
  model: string;
  maxTokens: number | undefined;
}): number | undefined {
  if (params.maxTokens !== undefined) return params.maxTokens;

  const key = params.model.toLowerCase();

  return Object.hasOwn(CHAT_MODEL_OUTPUT_DEFAULTS, key)
    ? CHAT_MODEL_OUTPUT_DEFAULTS[key]
    : undefined;
}

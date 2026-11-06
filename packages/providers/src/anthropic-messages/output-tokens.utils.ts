import { FALLBACK_OUTPUT_TOKENS, MODEL_OUTPUT_DEFAULTS } from './output-tokens.constants.js';

/** Explicit limits always win, including those in existing model files. */
export function messagesMaxTokens(params: {
  model: string;
  maxTokens: number | undefined;
}): number {
  if (params.maxTokens !== undefined) return params.maxTokens;

  if (Object.hasOwn(MODEL_OUTPUT_DEFAULTS, params.model)) {
    return MODEL_OUTPUT_DEFAULTS[params.model] ?? FALLBACK_OUTPUT_TOKENS;
  }

  return FALLBACK_OUTPUT_TOKENS;
}

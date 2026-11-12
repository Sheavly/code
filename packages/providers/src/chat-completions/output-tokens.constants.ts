/**
 * Lowercase model names whose documented output limit is 384K
 * (https://api-docs.deepseek.com/quick_start/pricing), written as 384000. Deployment names are
 * the user's, so only these well-known names are recognized.
 */
export const CHAT_MODEL_OUTPUT_DEFAULTS: Readonly<Record<string, number>> = {
  'deepseek-flash': 384_000,
  'deepseek-v4-flash': 384_000,
  'deepseek-v4.1-flash-1017': 384_000,
  'deepseek-v4-pro': 384_000,
};

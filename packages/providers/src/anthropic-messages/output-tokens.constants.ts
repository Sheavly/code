/** Recognized Foundry IDs from https://platform.claude.com/docs/en/models/overview. */
export const MODEL_OUTPUT_DEFAULTS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': 32768,
  'claude-opus-5-5': 32768,
  'claude-sonnet-5-5': 32768,
  'claude-haiku-5-5': 32768,
};

/** Unknown or custom deployment names retain a conservative default. */
export const FALLBACK_OUTPUT_TOKENS = 8192;

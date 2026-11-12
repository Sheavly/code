/**
 * Recognized Foundry IDs from https://platform.claude.com/docs/en/models/overview, at their
 * documented 128K output limit (written as 128000, which fits whether 128K means 1000 or 1024).
 */
export const MODEL_OUTPUT_DEFAULTS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': 128_000,
  'claude-opus-5-5': 128_000,
  'claude-sonnet-5-5': 128_000,
  'claude-haiku-5-5': 128_000,
};

/** Unknown or custom deployment names retain a conservative default. */
export const FALLBACK_OUTPUT_TOKENS = 8192;

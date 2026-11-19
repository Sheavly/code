/**
 * The prefixes of Bedrock's system-defined cross-Region inference profiles. Which ones a model has
 * differs per model (its model card lists them), so the adapters accept any of these and the
 * provider answers for the rest. `global` routes anywhere, outside any geography.
 */
export const INFERENCE_PROFILE_PREFIXES = [
  'us',
  'us-gov',
  'ca',
  'eu',
  'au',
  'jp',
  'apac',
  'global',
] as const;

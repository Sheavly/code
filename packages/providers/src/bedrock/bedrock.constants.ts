/**
 * The prefixes of Bedrock's system-defined cross-Region inference profiles. Which ones a model has
 * differs per model (its model card lists them), so the adapters accept any of these and the
 * provider answers for a prefix the model lacks. A prefix not listed here is refused before a
 * request is sent: add it when AWS adds one. `global` routes anywhere, outside any geography.
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

/** The ways a Bedrock model signs in: a Bedrock API key, or an IAM access key pair. */
export const AUTH_MODES = ['api-key', 'access-key'] as const;

/**
 * For each way of signing in, the secrets it needs and the ones that go only with another way, so a
 * model signs in one way only. The session token is optional: only temporary credentials have one.
 */
export const CREDENTIALS_BY_AUTH = {
  'api-key': { needs: ['apiKey'], not: ['accessKeyId', 'secretAccessKey', 'sessionToken'] },
  'access-key': { needs: ['accessKeyId', 'secretAccessKey'], not: ['apiKey'] },
} as const;

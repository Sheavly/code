import type { CheckHost } from './registry.types.js';

/**
 * Known diagnoses return fixed text only, never an error body that might echo a credential. A
 * `host` that gives refusals extra meaning (Bedrock's 403 is as often missing model access as a bad
 * key) is explained in its own terms, and a `bedrock-signed` model (an access key pair, whose
 * requests are signed) also gets a signature's diagnoses.
 */
export function checkHttpMessage(params: {
  status: number;
  message: string;
  host?: CheckHost | undefined;
}): string | undefined {
  const { status, message, host } = params;

  if (status === 429) {
    return 'HTTP 429: Rate limited. Wait and retry, or check your provider quota.';
  }

  const bedrock = host === 'bedrock' || host === 'bedrock-signed';
  // A signature, a token's expiry and a clock are only a signed request's to explain: an API key
  // has none of them, and would be blamed for what it did not do.
  const signed = host === 'bedrock-signed' ? signatureMessage({ status, message }) : undefined;

  if (signed) return signed;

  if (bedrock && (status === 403 || status === 404)) return bedrockMessage(status);

  if (status !== 400 && status !== 422) return undefined;

  const lower = message.toLowerCase();

  if (lower.includes('thinking') && lower.includes('adaptive') && lower.includes('not supported')) {
    return `HTTP ${String(status)}: This model requires adaptive thinking. Set Thinking mode to adaptive and leave Thinking budget empty.`;
  }

  if (lower.includes('max_tokens') || lower.includes('max tokens')) {
    return `HTTP ${String(status)}: Check Max tokens. It is the output limit per reply, not the context window, and must fit the model’s output limit.`;
  }

  if (bedrock) {
    return `HTTP ${String(status)}: Bedrock rejected the request. Check that the inference profile is available from this Region, and the output-token limit and thinking settings.`;
  }

  return `HTTP ${String(status)}: The provider rejected the model settings. Check the deployment, output-token limit and thinking settings.`;
}

/**
 * The host whose check messages a model gets: every `bedrock-*` adapter is Bedrock, and one that
 * signs its requests (`auth` of `access-key`) also gets the signature diagnoses.
 */
export function checkHostOf(params: {
  kind: string;
  config: Record<string, unknown>;
}): CheckHost | undefined {
  const { kind, config } = params;

  if (!kind.startsWith('bedrock-')) return undefined;

  return config.auth === 'access-key' ? 'bedrock-signed' : 'bedrock';
}

/**
 * What a refusal of a signed request says, in fixed text chosen by what the provider named (never
 * echoed): an expired session token, a clock that is off, or a signature that did not match.
 * Undefined for any other 400 or 403, which keep the general Bedrock messages.
 */
function signatureMessage(params: { status: number; message: string }): string | undefined {
  const { status, message } = params;

  if (status !== 400 && status !== 403) return undefined;

  const lower = message.toLowerCase();
  const prefix = `HTTP ${String(status)}:`;

  if (lower.includes('expiredtoken') || (lower.includes('token') && lower.includes('expired'))) {
    return `${prefix} The session token has expired. Get new temporary credentials and enter them again.`;
  }

  if (
    lower.includes('requestexpired') ||
    (lower.includes('signature') && lower.includes('expired'))
  ) {
    return `${prefix} The request’s signature was refused as out of date. Check that this computer’s clock is right.`;
  }

  if (
    lower.includes('signaturedoesnotmatch') ||
    lower.includes('invalidsignature') ||
    lower.includes('incompletesignature') ||
    (lower.includes('signature') && lower.includes('not match'))
  ) {
    return `${prefix} The signature did not match. Check the access key ID and the secret access key (and the session token, for temporary credentials).`;
  }

  if (lower.includes('invalidclienttokenid') || lower.includes('unrecognizedclient')) {
    return `${prefix} AWS does not know this access key ID. Check it, and that the key is still active.`;
  }

  return undefined;
}

/** What a Bedrock 403 or 404 usually means: both are as often access or Region as a wrong key. */
function bedrockMessage(status: 403 | 404): string {
  if (status === 403) {
    return 'HTTP 403: The key was refused, or its account cannot use this model. Check that the key is for this Region and has not expired, that model access is enabled for the account (it can take up to 15 minutes after subscribing) and that the key’s permissions allow InvokeModel.';
  }

  return 'HTTP 404: Bedrock has no such model here. Check the Region and the inference profile ID, and for older Claude models that the use case form was filled in.';
}

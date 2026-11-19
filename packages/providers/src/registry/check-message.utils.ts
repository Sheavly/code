import type { CheckHost } from './registry.types.js';

/**
 * Known diagnoses return fixed text only, never an error body that might echo a credential. A
 * `host` that gives refusals extra meaning (Bedrock's 403 is as often missing model access as a bad
 * key) is explained in its own terms.
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

  if (host === 'bedrock' && (status === 403 || status === 404)) return bedrockMessage(status);

  if (status !== 400 && status !== 422) return undefined;

  const lower = message.toLowerCase();

  if (lower.includes('thinking') && lower.includes('adaptive') && lower.includes('not supported')) {
    return `HTTP ${String(status)}: This model requires adaptive thinking. Set Thinking mode to adaptive and leave Thinking budget empty.`;
  }

  if (lower.includes('max_tokens') || lower.includes('max tokens')) {
    return `HTTP ${String(status)}: Check Max tokens. It is the output limit per reply, not the context window, and must fit the model’s output limit.`;
  }

  if (host === 'bedrock') {
    return `HTTP ${String(status)}: Bedrock rejected the request. Check that the inference profile is available from this Region, and the output-token limit and thinking settings.`;
  }

  return `HTTP ${String(status)}: The provider rejected the model settings. Check the deployment, output-token limit and thinking settings.`;
}

/** The host whose check messages adapter `kind` gets: every `bedrock-*` adapter is Bedrock. */
export function checkHostOf(kind: string): CheckHost | undefined {
  return kind.startsWith('bedrock-') ? 'bedrock' : undefined;
}

/** What a Bedrock 403 or 404 usually means: both are as often access or Region as a wrong key. */
function bedrockMessage(status: 403 | 404): string {
  if (status === 403) {
    return 'HTTP 403: The key was refused, or its account cannot use this model. Check that the key is for this Region and has not expired, that model access is enabled for the account (it can take up to 15 minutes after subscribing) and that the key’s permissions allow InvokeModel.';
  }

  return 'HTTP 404: Bedrock has no such model here. Check the Region and the inference profile ID, and for older Claude models that the use case form was filled in.';
}

import { now } from '@sheavly/core/clock/clock.helper';
import { RequestSigningError } from '../errors/providers.errors.js';
import type { RequestSigner } from '../http/http.types.js';
import { BEDROCK_SIGNING_SERVICE } from './sigv4.constants.js';
import type { BedrockSignIn } from './bedrock.types.js';
import { signAwsRequest } from './sigv4.utils.js';

/**
 * How a validated Bedrock config signs in: an API key is sent as the headers `apiKeyHeaders` makes
 * of it, and an access key pair signs every request (each attempt, at its own time). The config
 * has passed `refineBedrockAuth`, so the secrets its `auth` names are there; a config that skipped
 * it is a bug, and throws `RequestSigningError`.
 */
export function bedrockAuth(params: {
  config: BedrockSignIn;
  apiKeyHeaders: (apiKey: string) => Record<string, string>;
}): { headers: Record<string, string>; sign?: RequestSigner } {
  const { config, apiKeyHeaders } = params;

  if (config.auth === 'api-key') {
    if (!config.apiKey) {
      throw new RequestSigningError({ message: 'An api-key model has no apiKey' });
    }

    return { headers: apiKeyHeaders(config.apiKey) };
  }

  const { accessKeyId, secretAccessKey, sessionToken } = config;

  if (!accessKeyId || !secretAccessKey) {
    throw new RequestSigningError({
      message: 'An access-key model has no accessKeyId or no secretAccessKey',
    });
  }

  const credentials = { accessKeyId, secretAccessKey, sessionToken };

  return {
    headers: {},
    sign: (request) =>
      signAwsRequest({
        ...request,
        region: config.region,
        service: BEDROCK_SIGNING_SERVICE,
        credentials,
        at: now(),
      }),
  };
}

import { z } from 'zod';
import { INFERENCE_PROFILE_PREFIXES } from './bedrock.constants.js';

/**
 * An AWS Region code. Only letters, digits and dashes, so the host built from it can never be
 * steered somewhere else.
 */
export const bedrockRegionSchema = z
  .string()
  .max(32)
  .regex(/^[a-z]{2}(-[a-z]+)+-\d+$/, 'Expected a Region code like us-east-1')
  .meta({
    title: 'Region',
    description:
      'The AWS Region the key and the requests are for, such as us-east-1. A short-term API key works only in the Region it was made in.',
  });

/**
 * A cross-Region inference profile ID for a model of `provider`: a prefix, the provider, then the
 * model (`us.anthropic.claude-sonnet-5-5`). A bare model ID is refused: most models cannot be
 * called in-Region, and the prefix decides where a request may be processed, so it is the
 * caller's choice and never filled in.
 */
export function bedrockProfileSchema(params: {
  provider: 'anthropic' | 'openai';
  example: string;
}) {
  const { provider, example } = params;

  return z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, digits and . _ : - only')
    .refine(
      (id) => {
        const [prefix, owner, ...model] = id.split('.');

        return (
          INFERENCE_PROFILE_PREFIXES.some((known) => known === prefix) &&
          owner === provider &&
          model.join('.').length > 0
        );
      },
      {
        message: `Use an inference profile ID: a prefix (${INFERENCE_PROFILE_PREFIXES.join(', ')}), then ${provider}, then the model, like ${example}`,
      },
    )
    .meta({
      title: 'Inference profile',
      description: `The profile to call, a prefix then the model, like ${example}. The prefix decides where requests may run: a geography (us, eu, ...) keeps them there, global lets them run anywhere.`,
    });
}

import { z } from 'zod';
import { FIELD_KIND } from '../http/http.constants.js';
import { AUTH_MODES, CREDENTIALS_BY_AUTH } from './bedrock.constants.js';
import type { BedrockAuthConfig } from './bedrock.types.js';
import { awsAccessKeyIdSchema, printableCredential } from './sigv4.validator.js';

/**
 * A secret of one credential mode, of the type `base` gives it. Every credential is a secret, so
 * none lands in a model's file; each is optional in the schema because which ones are needed
 * depends on `auth`, and `appliesWhen` tells a form to ask for it only then (`optional`: and not
 * insist on it).
 */
function credential<TBase extends z.ZodType<string>>(params: {
  base: TBase;
  auth: BedrockAuthConfig['auth'];
  title: string;
  description?: string;
  optional?: boolean;
}) {
  const { base, auth, title, description, optional } = params;

  return base.optional().meta({
    [FIELD_KIND.secret]: true,
    title,
    appliesWhen: { auth },
    ...(description && { description }),
    ...(optional && { optional: true }),
  });
}

/**
 * How a Bedrock model signs in, and the secrets of each way: a Bedrock API key, or an IAM access
 * key pair (with the session token a temporary one comes with). `auth` is a field a person
 * chooses, so a model's file says which; spread these first in an adapter's object schema, then
 * wrap it in `refineBedrockAuth`.
 */
export const bedrockAuthFields = {
  auth: z.enum(AUTH_MODES).meta({
    title: 'Credentials',
    description:
      'api-key: a Bedrock API key (a short-term one lasts up to 12 hours). access-key: an IAM access key id and secret, signed for each request.',
  }),
  apiKey: credential({ base: printableCredential(), auth: 'api-key', title: 'API key' }),
  accessKeyId: credential({
    base: awsAccessKeyIdSchema,
    auth: 'access-key',
    title: 'Access key ID',
  }),
  secretAccessKey: credential({
    base: printableCredential(),
    auth: 'access-key',
    title: 'Secret access key',
  }),
  sessionToken: credential({
    base: printableCredential(),
    auth: 'access-key',
    title: 'Session token',
    description: 'Only for temporary credentials; leave empty for a long-term access key.',
    optional: true,
  }),
};

/**
 * Judges the credentials as a whole: the secrets `auth` names are present and none of the other
 * way's are, so a model signs in one way only. The problems are on the secret's own path, which
 * is how a setup that has no secrets yet (a stand-in for each) tells them from a bad setting.
 */
export function refineBedrockAuth<TSchema extends z.ZodType<BedrockAuthConfig>>(
  schema: TSchema,
): TSchema {
  return schema.superRefine((config, context) => {
    const { needs, not } = CREDENTIALS_BY_AUTH[config.auth];

    for (const field of needs) {
      if (!config[field]) {
        context.addIssue({
          code: 'custom',
          message: `Credentials ${config.auth} need ${needs.join(' and ')}`,
          path: [field],
        });
      }
    }

    for (const field of not) {
      if (config[field]) {
        context.addIssue({
          code: 'custom',
          message: `${field} does not go with credentials ${config.auth}`,
          path: [field],
        });
      }
    }
  });
}

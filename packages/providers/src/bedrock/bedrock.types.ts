import type { AwsAccessKeyId } from './sigv4.types.js';

/** The credentials a Bedrock config holds, before `refineBedrockAuth` has judged them. */
export type BedrockAuthConfig = {
  auth: 'api-key' | 'access-key';
  apiKey?: string | undefined;
  accessKeyId?: AwsAccessKeyId | undefined;
  secretAccessKey?: string | undefined;
  sessionToken?: string | undefined;
};

/** What `bedrockAuth` reads of a validated config: how to sign in, and where. */
export type BedrockSignIn = BedrockAuthConfig & { region: string };

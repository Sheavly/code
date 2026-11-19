import type { z } from 'zod';
import type { awsAccessKeyIdSchema } from './sigv4.validator.js';

/** An IAM access key ID, as the config validates it. */
export type AwsAccessKeyId = z.infer<typeof awsAccessKeyIdSchema>;

/** An IAM access key pair, and the session token a temporary one comes with. */
export type AwsCredentials = {
  accessKeyId: AwsAccessKeyId;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};

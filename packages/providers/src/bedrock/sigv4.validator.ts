import { z } from 'zod';

/** An IAM access key ID: what AWS names a key pair by, branded so no other string passes for one. */
export const awsAccessKeyIdSchema = z.string().min(1).brand<'AwsAccessKeyId'>();

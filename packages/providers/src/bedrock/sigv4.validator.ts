import { z } from 'zod';

/**
 * Text a credential may hold: printable characters with no space or line break. A pasted secret with
 * one would make the request fail inside fetch, whose message can repeat the value, so it is refused
 * here, saying nothing of what was entered.
 */
export const printableCredential = () =>
  z.string().regex(/^[\x21-\x7e]+$/, 'Use printable characters without spaces');

/** An IAM access key ID: what AWS names a key pair by, branded so no other string passes for one. */
export const awsAccessKeyIdSchema = printableCredential().brand<'AwsAccessKeyId'>();

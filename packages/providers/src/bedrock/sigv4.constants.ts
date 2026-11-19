/** The signing algorithm named in the `Authorization` header and the string to sign. */
export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';

/** The last part of a credential scope, and what the signing key is finally derived with. */
export const SIGV4_TERMINATOR = 'aws4_request';

/** The service name Bedrock's endpoints are signed for, whatever the model. */
export const BEDROCK_SIGNING_SERVICE = 'bedrock';

/**
 * The headers the signer sets itself. A caller's own, under any capitalisation, would be sent next
 * to them (fetch merges names without regard to case) and so differ from what was signed.
 */
export const SIGV4_OWN_HEADERS = [
  'host',
  'x-amz-date',
  'x-amz-security-token',
  'authorization',
] as const;

/** A header name as RFC 9110 allows it: a token, so it can carry no `:` or line break. */
export const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

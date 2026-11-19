/** The signing algorithm named in the `Authorization` header and the string to sign. */
export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';

/** The last part of a credential scope, and what the signing key is finally derived with. */
export const SIGV4_TERMINATOR = 'aws4_request';

/** The service name Bedrock's endpoints are signed for, whatever the model. */
export const BEDROCK_SIGNING_SERVICE = 'bedrock';

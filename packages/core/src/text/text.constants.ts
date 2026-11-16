/** The most characters of a model API's error text kept in an error message. */
export const MAX_PROVIDER_ERROR_CHARS = 500;

/** Names whose value, after `:` or `=`, is a credential. */
export const SECRET_NAMES =
  '(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|client[_-]?secret)';

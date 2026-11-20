/**
 * The JSON Schema of `sheavly.json`, committed at the package root so an editor can validate a
 * manifest (`npm run schema -w @sheavly/extension`).
 */
export const MANIFEST_SCHEMA_FILE = 'sheavly.schema.json';

/** The longest name (extension, service, tool, hook, work kind, setting) a manifest may hold. */
export const MAX_NAME_LENGTH = 128;

/** A grant is `<noun>:<verb>`, each part lowercase words joined by hyphens (`task:cancel-any`). */
export const GRANT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*:[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The most entries one list of a manifest may hold. */
export const MAX_LIST_SIZE = 1000;

/** The largest `sheavly.json` `readManifest` reads: 256 KiB. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/** How many characters of a one-line reason (a `JSON.parse` snippet, an OS error) a message echoes. */
export const MAX_ECHOED_REASON = 300;

/** How many characters of the schema's problem list a message echoes. */
export const MAX_ECHOED_DETAILS = 2000;

/** The longest free text (a setting's description or string default, the `$schema` URL) a manifest may hold. */
export const MAX_TEXT_LENGTH = 1000;

/**
 * The words a setting's name may not contain as a whole segment (segments split on `-`, `_` and
 * `.`, compared case-insensitively): a setting holds no credential, so a name that reads like one
 * is refused. A segment match, not a substring one, so `keyboard-layout` passes and `api-key`
 * (segment `key`) does not; a plural (`tokens`) or a name in another language is not caught.
 */
export const CREDENTIAL_WORDS: readonly string[] = [
  'key',
  'token',
  'secret',
  'password',
  'credential',
  'passwd',
  'apikey',
  'pwd',
  'bearer',
  'passphrase',
  'auth',
  'accesstoken',
  'secretkey',
  'privatekey',
];

/** Every control and format character (bidi controls, zero-width joiners), which a message must not carry from a file's content. */
export const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/** Every control and format character but the line break that separates the schema's problems. */
export const CONTROL_CHARACTERS_BUT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}]/gu;

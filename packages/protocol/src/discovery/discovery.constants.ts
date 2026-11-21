/** The layout of the discovery file. It changes on its own, apart from the protocol version. */
export const DISCOVERY_FORMAT_VERSION = 1;

/** The discovery file's name, in the folder the server writes it to. */
export const DISCOVERY_FILE_NAME = 'server.json';

/** The most bytes a reader takes from a discovery file; a real one is far smaller. */
export const DISCOVERY_MAX_BYTES = 4096;

/** The fewest characters a token in the discovery file may have. */
export const DISCOVERY_TOKEN_MIN_CHARS = 32;

/** The most characters a token in the discovery file may have. */
export const DISCOVERY_TOKEN_MAX_CHARS = 512;

/** The most characters the server's URL in the discovery file may have. */
export const DISCOVERY_URL_MAX_CHARS = 2048;

/** The most characters either version in the discovery file may have. */
export const DISCOVERY_VERSION_MAX_CHARS = 64;

/**
 * The characters a token and a URL in the discovery file are made of: visible ASCII without `"`
 * and `\`, so no character grows when written as JSON and the maxima above bound the file's size.
 */
export const DISCOVERY_PLAIN_TEXT_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

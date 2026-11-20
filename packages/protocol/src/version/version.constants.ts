/** Where the generated `PROTOCOL_VERSION` is written (`npm run schema -w @sheavly/protocol`). */
export const PROTOCOL_VERSION_FILE = 'src/version/protocol-version.constants.ts';

/** `major.minor.patch`, then an optional `-` and dot-separated prerelease identifiers. */
export const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** An identifier made of digits only: compared as a number, and never written with a leading zero. */
export const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

/** A numeric part with a leading zero (`01`), which semver forbids. */
export const LEADING_ZERO_PATTERN = /^0\d/;

/** What a version string that is not semver is told, in a schema issue. */
export const SEMVER_ERROR =
  'must be a semantic version (major.minor.patch, optional -prerelease, no +build)';

/** What the generated schema says about a version, beyond its pattern, which is the shape only. */
export const SEMVER_DESCRIPTION =
  'A semantic version: major.minor.patch with an optional -prerelease of dot-separated identifiers. No build metadata (+), no leading zeros in a number, and every number at most 9007199254740991.';

/** The marker of build metadata, which a protocol version may not carry. */
export const BUILD_METADATA_MARKER = '+';

/** The separator of prerelease identifiers. */
export const PRERELEASE_SEPARATOR = '.';

/**
 * What a version mismatch says. `{client}` and `{server}` stand for the two versions; each text
 * names which side is older and gives the one action that fixes it.
 */
export const PROTOCOL_MISMATCH_MESSAGES = {
  serverOlder:
    'The server speaks protocol {server} and this client {client}: the server is older. Update and restart the server, then try again.',
  clientOlder:
    'The server speaks protocol {server} and this client {client}: this client is older. Update this client.',
} as const;

/** The failure of a version that is not a protocol version, by what is wrong with it. */
export const SEMVER_FAILURE_TEXT = {
  malformed: 'is not major.minor.patch with an optional -prerelease',
  'leading-zero': 'has a number with a leading zero',
  'build-metadata': 'has build metadata (+...), which a protocol version may not carry',
} as const;

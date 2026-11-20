import {
  BUILD_METADATA_MARKER,
  LEADING_ZERO_PATTERN,
  NUMERIC_IDENTIFIER_PATTERN,
  PRERELEASE_SEPARATOR,
  SEMVER_PATTERN,
} from './version.constants.js';
import type { Order, Semver, SemverResult } from './semver.types.js';

function isNumeric(text: string): boolean {
  return NUMERIC_IDENTIFIER_PATTERN.test(text);
}

/** A numeric identifier is a number, any other stays text; an empty one makes the version invalid. */
function identifierOf(text: string): string | number {
  return isNumeric(text) ? Number(text) : text;
}

/**
 * Parses `major.minor.patch` with an optional `-prerelease` of dot-separated identifiers.
 * Build metadata (`+...`), a leading zero in a number and anything else is a typed failure,
 * not an exception.
 */
export function parseSemver(version: string): SemverResult {
  if (version.includes(BUILD_METADATA_MARKER)) return { ok: false, reason: 'build-metadata' };

  const match = SEMVER_PATTERN.exec(version);

  if (!match) return { ok: false, reason: 'malformed' };

  const [, major = '', minor = '', patch = '', prerelease] = match;
  const identifiers = prerelease === undefined ? [] : prerelease.split(PRERELEASE_SEPARATOR);
  const parts = [major, minor, patch, ...identifiers];

  if (identifiers.includes('')) return { ok: false, reason: 'malformed' };

  if (
    parts.some((part) => LEADING_ZERO_PATTERN.test(part) && NUMERIC_IDENTIFIER_PATTERN.test(part))
  ) {
    return { ok: false, reason: 'leading-zero' };
  }

  // A numeric prerelease identifier too large to compare exactly is as unusable as a major.
  const numbers = [major, minor, patch, ...identifiers.filter(isNumeric)].map(Number);

  if (!numbers.every(Number.isSafeInteger)) return { ok: false, reason: 'malformed' };

  const [majorNumber = 0, minorNumber = 0, patchNumber = 0] = numbers;

  return {
    ok: true,
    version: {
      major: majorNumber,
      minor: minorNumber,
      patch: patchNumber,
      prerelease: identifiers.map(identifierOf),
    },
  };
}

function orderOf(params: { a: string | number; b: string | number }): Order {
  const { a, b } = params;

  if (a === b) return 0;

  return a < b ? -1 : 1;
}

/** Numbers sort below text; two numbers by value, two texts by ASCII order. */
function compareIdentifiers(params: { a: string | number; b: string | number }): Order {
  const { a, b } = params;

  if (typeof a === typeof b) return orderOf({ a, b });

  return typeof a === 'number' ? -1 : 1;
}

/** Prerelease identifiers by precedence; with every shared one equal, the shorter list is lower. */
function comparePrereleases(params: { a: Semver['prerelease']; b: Semver['prerelease'] }): Order {
  const { a, b } = params;

  for (const [index, left] of a.entries()) {
    const right = b[index];

    if (right === undefined) return 1;

    const order = compareIdentifiers({ a: left, b: right });

    if (order !== 0) return order;
  }

  return orderOf({ a: a.length, b: b.length });
}

/**
 * Semantic-version precedence: major, minor and patch by value, then a prerelease is lower than
 * its release, and two prereleases compare identifier by identifier.
 */
export function compareSemver(params: { a: Semver; b: Semver }): Order {
  const { a, b } = params;
  const core = [
    orderOf({ a: a.major, b: b.major }),
    orderOf({ a: a.minor, b: b.minor }),
    orderOf({ a: a.patch, b: b.patch }),
  ].find((order) => order !== 0);

  if (core !== undefined) return core;

  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return orderOf({ a: b.prerelease.length, b: a.prerelease.length });
  }

  return comparePrereleases({ a: a.prerelease, b: b.prerelease });
}

/**
 * Whether two versions are on the same breaking line: the same major from 1.0.0, the same major
 * and minor while the major is 0. A patch or a prerelease never changes the line.
 */
export function isCompatible(params: { a: Semver; b: Semver }): boolean {
  const { a, b } = params;

  if (a.major !== b.major) return false;

  return a.major !== 0 || a.minor === b.minor;
}

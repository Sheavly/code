/** A parsed version. A numeric prerelease identifier is a number, any other a string. */
export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
};

/** Why a string is not a version. */
export type SemverFailure = 'malformed' | 'leading-zero' | 'build-metadata';

export type SemverResult = { ok: true; version: Semver } | { ok: false; reason: SemverFailure };

/** The result of comparing two versions: below, equal or above. */
export type Order = -1 | 0 | 1;

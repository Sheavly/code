import { z } from 'zod';
import { parseSemver } from './semver.utils.js';

/** A protocol version: `major.minor.patch` with an optional `-prerelease`, no build metadata. */
export const protocolVersionSchema = z.string().refine((value) => parseSemver(value).ok, {
  error: 'must be a semantic version (major.minor.patch, optional -prerelease, no +build)',
});

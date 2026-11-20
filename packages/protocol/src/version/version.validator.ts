import { z } from 'zod';
import { SEMVER_DESCRIPTION, SEMVER_ERROR, SEMVER_PATTERN } from './version.constants.js';
import { parseSemver } from './semver.utils.js';

function isSemver(value: string): boolean {
  return parseSemver(value).ok;
}

/**
 * The grammar both versions share. The pattern is the parser's own, so the generated JSON schema
 * carries the shape; the refine adds what a pattern can't say (leading zeros, safe numbers). One
 * instance per version, so the generator keeps the two definitions apart.
 */
function semverSchema() {
  return z
    .string()
    .regex(SEMVER_PATTERN, { error: SEMVER_ERROR })
    .refine(isSemver, { error: SEMVER_ERROR })
    .describe(SEMVER_DESCRIPTION);
}

/** A protocol version: `major.minor.patch` with an optional `-prerelease`, no build metadata. */
export const protocolVersionSchema = semverSchema();

/** A server's own version (its package's): the same grammar, a separate number from the protocol's. */
export const serverVersionSchema = semverSchema();

/** What `GET /health` answers: that the server is up, and the two versions it runs. Nothing else. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  serverVersion: serverVersionSchema,
  protocolVersion: protocolVersionSchema,
});
